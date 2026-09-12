using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.Server.XPlane;

public sealed class XPlaneTelemetrySource(IConfiguration configuration) : ITelemetrySource
{
    private static readonly string[] Datarefs =
    [
        "sim/flightmodel/position/latitude",
        "sim/flightmodel/position/longitude",
        "sim/flightmodel/position/psi",
        "sim/flightmodel/position/groundspeed",
        "sim/flightmodel/failures/onground_any"
    ];

    public async IAsyncEnumerable<TelemetrySnapshot> ReadAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var host = configuration["TaxiNow:XPlane:Host"] ?? "127.0.0.1";
        var port = configuration.GetValue("TaxiNow:XPlane:Port", 49000);
        var addresses = await Dns.GetHostAddressesAsync(host, cancellationToken);
        var endpoint = new IPEndPoint(addresses.First(a => a.AddressFamily == AddressFamily.InterNetwork), port);
        using var udp = new UdpClient(AddressFamily.InterNetwork);
        udp.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
        var values = new Dictionary<int, float>();
        var clock = Stopwatch.StartNew();
        long sequence = 0;

        while (!cancellationToken.IsCancellationRequested)
        {
            for (var index = 0; index < Datarefs.Length; index++)
            {
                var packet = XPlaneRrefCodec.CreateSubscription(5, index, Datarefs[index]);
                await udp.SendAsync(packet, endpoint, cancellationToken);
            }

            var gotPosition = false;
            var receivedUntil = clock.ElapsedMilliseconds + 3_000;
            while (clock.ElapsedMilliseconds < receivedUntil && !cancellationToken.IsCancellationRequested)
            {
                var response = await ReceiveWithTimeoutAsync(udp, cancellationToken);
                if (response is null) break;
                foreach (var pair in XPlaneRrefCodec.ParseResponse(response.Value.Buffer)) values[pair.Key] = pair.Value;
                if (!Enumerable.Range(0, Datarefs.Length).All(values.ContainsKey)) continue;
                gotPosition = true;
                var now = DateTimeOffset.UtcNow;
                yield return new TelemetrySnapshot(
                    ++sequence, SimulatorEdition.XPlane12, true, values[4] > 0.5f,
                    values[0], values[1], values[2], values[3] * 1.94384449,
                    now, now, clock.ElapsedMilliseconds, HasPosition: true,
                    State: TrackingState.Connected);
            }

            if (!gotPosition)
            {
                var now = DateTimeOffset.UtcNow;
                yield return new TelemetrySnapshot(
                    ++sequence, SimulatorEdition.XPlane12, false, false, 0, 0, 0, 0,
                    now, now, clock.ElapsedMilliseconds, HasPosition: false,
                    State: TrackingState.Disconnected);
            }
        }
    }

    private static async Task<UdpReceiveResult?> ReceiveWithTimeoutAsync(UdpClient udp, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(1));
        try { return await udp.ReceiveAsync(timeout.Token); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }
}
