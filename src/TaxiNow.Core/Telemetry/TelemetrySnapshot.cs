namespace TaxiNow.Core.Telemetry;

public enum SimulatorEdition
{
    Replay,
    Msfs2020,
    Msfs2024,
    XPlane12,
    Unknown
}

public enum TrackingState
{
    Disconnected,
    Connecting,
    Connected,
    Airborne,
    GroundTracking,
    Reconnecting
}

public sealed record TelemetrySnapshot(
    long Sequence,
    SimulatorEdition Simulator,
    bool Connected,
    bool OnGround,
    double Latitude,
    double Longitude,
    double TrueHeadingDegrees,
    double GroundSpeedKnots,
    DateTimeOffset SourceTimestampUtc,
    DateTimeOffset ServerTimestampUtc,
    long SourceMonotonicMilliseconds,
    bool HasPosition = true,
    bool IsStale = false,
    TrackingState State = TrackingState.Connected,
    double? AltitudeMslFeet = null,
    double? AltitudeAglFeet = null);

public interface ITelemetrySource
{
    IAsyncEnumerable<TelemetrySnapshot> ReadAllAsync(CancellationToken cancellationToken);
}

public interface ITelemetrySink
{
    ValueTask WriteAsync(TelemetrySnapshot snapshot, CancellationToken cancellationToken);
}
