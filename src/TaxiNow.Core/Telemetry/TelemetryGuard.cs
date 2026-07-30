namespace TaxiNow.Core.Telemetry;

public sealed class TelemetryGuard(
    int onGroundSamplesToResume = 3,
    double maximumJumpMeters = 1_000,
    TimeSpan? staleAfter = null)
{
    private readonly TimeSpan _staleAfter = staleAfter ?? TimeSpan.FromSeconds(2);
    private TelemetrySnapshot? _lastAccepted;
    private int _onGroundStreak;
    private bool _groundTracking;

    public TelemetrySnapshot? Accept(TelemetrySnapshot sample)
    {
        if (!sample.HasPosition)
        {
            _lastAccepted = null;
            _onGroundStreak = 0;
            _groundTracking = false;
            return sample with { IsStale = true };
        }

        if (!IsCoordinateValid(sample.Latitude, sample.Longitude) ||
            !double.IsFinite(sample.TrueHeadingDegrees) ||
            !double.IsFinite(sample.GroundSpeedKnots))
        {
            return null;
        }

        if (_lastAccepted is not null)
        {
            var distance = TelemetryMath.DistanceMeters(
                _lastAccepted.Latitude,
                _lastAccepted.Longitude,
                sample.Latitude,
                sample.Longitude);
            if (distance > maximumJumpMeters)
            {
                return null;
            }
        }

        if (sample.OnGround)
        {
            _onGroundStreak++;
            if (_onGroundStreak >= onGroundSamplesToResume)
            {
                _groundTracking = true;
            }
        }
        else
        {
            _onGroundStreak = 0;
            _groundTracking = false;
        }

        var age = sample.ServerTimestampUtc - sample.SourceTimestampUtc;
        var guarded = sample with
        {
            TrueHeadingDegrees = TelemetryMath.NormalizeHeading(sample.TrueHeadingDegrees),
            IsStale = age > _staleAfter,
            State = !sample.Connected
                ? TrackingState.Disconnected
                : _groundTracking
                    ? TrackingState.GroundTracking
                    : TrackingState.Airborne
        };
        _lastAccepted = guarded;
        return guarded;
    }

    private static bool IsCoordinateValid(double latitude, double longitude) =>
        double.IsFinite(latitude) &&
        double.IsFinite(longitude) &&
        latitude is >= -90 and <= 90 &&
        longitude is >= -180 and <= 180;
}
