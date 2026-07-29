using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.SimConnect.Native;

public sealed class NativeTelemetrySource(TimeSpan? pollingInterval = null) : ITelemetrySource
{
    private readonly TimeSpan _pollingInterval =
        pollingInterval ?? TimeSpan.FromMilliseconds(50);

    public async IAsyncEnumerable<TelemetrySnapshot> ReadAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var handle = NativeMethods.Create();
        if (handle.IsInvalid || NativeMethods.Start(handle) != 0)
        {
            throw new InvalidOperationException("The native SimConnect bridge could not start.");
        }

        try
        {
            ulong lastSequence = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                var native = new NativeMethods.NativeTelemetrySnapshot
                {
                    Size = (uint)Marshal.SizeOf<NativeMethods.NativeTelemetrySnapshot>(),
                    AbiVersion = 1
                };
                if (NativeMethods.Latest(handle, ref native) == 0 &&
                    native.Sequence > lastSequence)
                {
                    lastSequence = native.Sequence;
                    var now = DateTimeOffset.UtcNow;
                    yield return new TelemetrySnapshot(
                        checked((long)native.Sequence),
                        native.SimulatorEdition switch
                        {
                            2020 => SimulatorEdition.Msfs2020,
                            2024 => SimulatorEdition.Msfs2024,
                            _ => SimulatorEdition.Unknown
                        },
                        native.Connected != 0,
                        native.OnGround != 0,
                        native.Latitude,
                        native.Longitude,
                        native.TrueHeadingDegrees,
                        native.GroundSpeedKnots,
                        now,
                        now,
                        native.SourceMonotonicMilliseconds);
                }

                await Task.Delay(_pollingInterval, cancellationToken);
            }
        }
        finally
        {
            NativeMethods.Stop(handle);
        }
    }
}

