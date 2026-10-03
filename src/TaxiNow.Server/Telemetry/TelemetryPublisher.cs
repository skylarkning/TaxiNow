using Microsoft.AspNetCore.SignalR;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.Server.Telemetry;

public sealed class TelemetryPublisher(
    IEnumerable<ITelemetrySource> sources,
    TelemetryState state,
    IHubContext<TelemetryHub> hub,
    ILogger<TelemetryPublisher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var sourceList = sources.ToArray();
        var guards = sourceList.Select(_ => new TelemetryGuard()).ToArray();
        var channel = System.Threading.Channels.Channel.CreateUnbounded<(int Source, TelemetrySnapshot Sample)>();
        var pumps = sourceList.Select((source, index) => Task.Run(async () =>
        {
            await foreach (var sample in source.ReadAllAsync(stoppingToken))
                await channel.Writer.WriteAsync((index, sample), stoppingToken);
        }, stoppingToken)).ToArray();
        _ = Task.WhenAll(pumps).ContinueWith(_ => channel.Writer.TryComplete(), CancellationToken.None);
        var activeSource = -1;
        var lastPositionAt = DateTimeOffset.MinValue;
        long publishedSequence = 0;
        try
        {
            await foreach (var item in channel.Reader.ReadAllAsync(stoppingToken))
            {
                var accepted = guards[item.Source].Accept(item.Sample);
                if (accepted is null)
                {
                    logger.LogWarning(
                        "Rejected telemetry sequence {Sequence}.",
                        item.Sample.Sequence);
                    continue;
                }

                if (accepted.HasPosition && accepted.Connected)
                {
                    if (activeSource >= 0 && activeSource != item.Source &&
                        DateTimeOffset.UtcNow - lastPositionAt < TimeSpan.FromSeconds(5)) continue;
                    activeSource = item.Source;
                    lastPositionAt = DateTimeOffset.UtcNow;
                }
                else if (item.Source != activeSource &&
                         DateTimeOffset.UtcNow - lastPositionAt < TimeSpan.FromSeconds(5)) continue;

                accepted = accepted with { Sequence = ++publishedSequence };

                state.Update(accepted);
                await hub.Clients.All.SendAsync(
                    "TelemetryUpdated",
                    accepted,
                    stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Telemetry source stopped unexpectedly.");
        }
    }
}

