using Microsoft.AspNetCore.SignalR;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.Server.Telemetry;

public sealed class TelemetryPublisher(
    ITelemetrySource source,
    TelemetryState state,
    IHubContext<TelemetryHub> hub,
    ILogger<TelemetryPublisher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var guard = new TelemetryGuard();
        try
        {
            await foreach (var sample in source.ReadAllAsync(stoppingToken))
            {
                var accepted = guard.Accept(sample);
                if (accepted is null)
                {
                    logger.LogWarning(
                        "Rejected telemetry sequence {Sequence}.",
                        sample.Sequence);
                    continue;
                }

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

