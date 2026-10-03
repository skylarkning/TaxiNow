namespace TaxiNow.Core.Traffic;

public sealed record SimulatorTrafficAircraft(
    uint ObjectId,
    string Callsign,
    double Latitude,
    double Longitude,
    double HeadingDegrees,
    int AltitudeFeet,
    int GroundSpeedKnots,
    bool OnGround,
    string? AircraftType,
    string? Title);

public sealed record SimulatorTrafficSnapshot(
    long Sequence,
    bool Connected,
    DateTimeOffset RetrievedAtUtc,
    IReadOnlyList<SimulatorTrafficAircraft> Aircraft)
{
    public int Count => Aircraft.Count;
}

public sealed class SimulatorTrafficState
{
    private static readonly TimeSpan ObservationLease =
        TimeSpan.FromSeconds(5);
    private readonly TimeProvider _timeProvider;
    private long _sequence;
    private long _observationRequestedUntilUtcTicks;
    private SimulatorTrafficSnapshot _latest;

    public SimulatorTrafficState(TimeProvider? timeProvider = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _latest = new SimulatorTrafficSnapshot(
            0,
            false,
            _timeProvider.GetUtcNow(),
            []);
    }

    public SimulatorTrafficSnapshot Latest => Volatile.Read(ref _latest);

    public bool IsObservationRequested =>
        Volatile.Read(ref _observationRequestedUntilUtcTicks) >=
        _timeProvider.GetUtcNow().UtcTicks;

    public void RequestObservation()
    {
        Interlocked.Exchange(
            ref _observationRequestedUntilUtcTicks,
            (_timeProvider.GetUtcNow() + ObservationLease).UtcTicks);
    }

    public void Publish(
        bool connected,
        IEnumerable<SimulatorTrafficAircraft>? aircraft = null)
    {
        var items = aircraft?.ToArray() ?? [];
        Volatile.Write(
            ref _latest,
            new SimulatorTrafficSnapshot(
                Interlocked.Increment(ref _sequence),
                connected,
                _timeProvider.GetUtcNow(),
                items));
    }
}
