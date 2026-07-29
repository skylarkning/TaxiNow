using TaxiNow.Core.Telemetry;

namespace TaxiNow.Server.Telemetry;

public sealed class TelemetryState
{
    private TelemetrySnapshot? _latest;

    public TelemetrySnapshot? Latest => Volatile.Read(ref _latest);

    public void Update(TelemetrySnapshot snapshot) =>
        Volatile.Write(ref _latest, snapshot);
}

