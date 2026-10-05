using System.Text.Json;

namespace TaxiNow.Server.Weather;

public static class WeatherProfileDerivation
{
    public const int MaximumSerializedRequestBytes = 256 * 1024;
    public const int MaximumRoutePoints = 200;
    public const int MaximumSamples = 32;
    public const double MaximumRouteDistanceNm = 10_000;
    public const double MaximumWeatherHorizonNm = 500;
    public const double NominalSampleSpacingNm = 25;

    private const double EarthRadiusNm = 3_440.065;
    private const double DegreesToRadians = Math.PI / 180;
    private const double FallbackGroundSpeedKnots = 450;
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    public static WeatherRouteWindow SampleRoute(
        WeatherProfileRequest request,
        DateTimeOffset now)
    {
        Validate(request);
        var cumulative = CumulativeDistances(request.Route);
        var totalDistance = cumulative[^1];
        if (totalDistance > MaximumRouteDistanceNm)
        {
            throw new WeatherProfileValidationException(
                "Route distance must not exceed 10000 nautical miles.");
        }

        var start = Math.Clamp(request.CurrentDistanceNm ?? 0, 0, totalDistance);
        var end = Math.Min(totalDistance, start + MaximumWeatherHorizonNm);
        var (etaBasis, speed, scheduledDeparture) = EtaParameters(
            request,
            totalDistance,
            now);

        var candidates = new List<SampleCandidate>();
        AddCandidate(candidates, new SampleCandidate(start, false, null));
        for (var distance = start + NominalSampleSpacingNm;
             distance < end - 1e-6;
             distance += NominalSampleSpacingNm)
        {
            AddCandidate(candidates, new SampleCandidate(distance, false, null));
        }
        AddCandidate(candidates, new SampleCandidate(end, false, null));

        for (var index = 0; index < request.Route.Count; index++)
        {
            var point = request.Route[index];
            var distance = cumulative[index];
            if (!point.Critical || distance < start - 1e-6 || distance > end + 1e-6)
            {
                continue;
            }

            AddCandidate(
                candidates,
                new SampleCandidate(distance, true, point.Ident));
        }

        candidates.Sort((left, right) => left.DistanceNm.CompareTo(right.DistanceNm));
        candidates = ReduceCandidates(candidates);
        var samples = candidates
            .Select(candidate =>
            {
                var interpolated = InterpolateAt(
                    request.Route,
                    cumulative,
                    candidate.DistanceNm);
                var validAt = scheduledDeparture is not null
                    ? scheduledDeparture.Value.AddSeconds(
                        candidate.DistanceNm / speed * 3600)
                    : now.AddSeconds(
                        Math.Max(0, candidate.DistanceNm - start) / speed * 3600);
                return new TimedRouteSample(
                    candidate.Ident ?? interpolated.Ident,
                    interpolated.Longitude,
                    interpolated.Latitude,
                    candidate.DistanceNm,
                    interpolated.PlannedAltitudeFeet,
                    candidate.Critical,
                    validAt);
            })
            .ToArray();

        return new WeatherRouteWindow(
            totalDistance,
            start,
            end,
            etaBasis,
            samples);
    }

    public static WeatherPathRelation ClassifyPathRelation(
        double plannedAltitudeFeet,
        double? baseFeet,
        double? topFeet)
    {
        if (!double.IsFinite(plannedAltitudeFeet) ||
            !IsFinite(baseFeet) ||
            !IsFinite(topFeet))
        {
            return WeatherPathRelation.Unknown;
        }

        var envelopeBase = plannedAltitudeFeet - 4_000;
        var envelopeTop = plannedAltitudeFeet + 4_000;
        return topFeet >= envelopeBase && baseFeet <= envelopeTop
            ? WeatherPathRelation.OnPath
            : WeatherPathRelation.OffPath;
    }

    private static void Validate(WeatherProfileRequest? request)
    {
        if (request?.Route is null ||
            request.Route.Count is < 2 or > MaximumRoutePoints)
        {
            throw new WeatherProfileValidationException(
                "Route must contain between 2 and 200 points.");
        }

        foreach (var point in request.Route)
        {
            if (point is null ||
                !double.IsFinite(point.Longitude) ||
                point.Longitude is < -180 or > 180 ||
                !double.IsFinite(point.Latitude) ||
                point.Latitude is < -90 or > 90 ||
                (point.PlannedAltitudeFeet is { } altitude &&
                    (!double.IsFinite(altitude) || altitude is < -2_000 or > 100_000)))
            {
                throw new WeatherProfileValidationException(
                    "Route points must contain finite WGS84 coordinates and valid optional altitudes.");
            }
        }

        if (request.CurrentDistanceNm is { } currentDistance &&
            (!double.IsFinite(currentDistance) || currentDistance < 0))
        {
            throw new WeatherProfileValidationException(
                "Current route distance must be a finite non-negative value.");
        }

        if (request.GroundSpeedKnots is { } groundSpeed &&
            !double.IsFinite(groundSpeed))
        {
            throw new WeatherProfileValidationException(
                "Ground speed must be finite when supplied.");
        }

        if (request.EstimatedEnrouteSeconds is { } estimatedSeconds &&
            !double.IsFinite(estimatedSeconds))
        {
            throw new WeatherProfileValidationException(
                "Estimated enroute seconds must be finite when supplied.");
        }

        if (JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions).Length >
            MaximumSerializedRequestBytes)
        {
            throw new WeatherProfileValidationException(
                "Weather profile request must not exceed 256 KiB of UTF-8 JSON.");
        }
    }

    private static (string Basis, double Speed, DateTimeOffset? Departure)
        EtaParameters(
            WeatherProfileRequest request,
            double totalDistance,
            DateTimeOffset now)
    {
        if (request.DepartureTimeUtc is { } departure &&
            request.EstimatedEnrouteSeconds is > 0 and { } duration &&
            totalDistance > 0)
        {
            return ("scheduled", totalDistance / (duration / 3600), departure);
        }

        if (request.GroundSpeedKnots is >= 50 and <= 750 and { } liveSpeed)
        {
            return ("liveGroundSpeed", liveSpeed, null);
        }

        return ("fallback450Kt", FallbackGroundSpeedKnots, null);
    }

    private static double[] CumulativeDistances(
        IReadOnlyList<WeatherRoutePoint> route)
    {
        var cumulative = new double[route.Count];
        for (var index = 1; index < route.Count; index++)
        {
            cumulative[index] = cumulative[index - 1] +
                DistanceNm(route[index - 1], route[index]);
        }
        return cumulative;
    }

    private static double DistanceNm(
        WeatherRoutePoint start,
        WeatherRoutePoint end)
    {
        var deltaLatitude = (end.Latitude - start.Latitude) * DegreesToRadians;
        var deltaLongitude = ShortLongitudeDelta(
            start.Longitude,
            end.Longitude) * DegreesToRadians;
        var startLatitude = start.Latitude * DegreesToRadians;
        var endLatitude = end.Latitude * DegreesToRadians;
        var haversine = Math.Pow(Math.Sin(deltaLatitude / 2), 2) +
            Math.Cos(startLatitude) * Math.Cos(endLatitude) *
            Math.Pow(Math.Sin(deltaLongitude / 2), 2);
        return EarthRadiusNm * 2 * Math.Asin(
            Math.Sqrt(Math.Clamp(haversine, 0, 1)));
    }

    private static WeatherRoutePoint InterpolateAt(
        IReadOnlyList<WeatherRoutePoint> route,
        IReadOnlyList<double> cumulative,
        double distanceNm)
    {
        if (distanceNm <= 0)
        {
            return route[0];
        }

        for (var index = 1; index < cumulative.Count; index++)
        {
            if (distanceNm > cumulative[index] + 1e-9)
            {
                continue;
            }

            var start = route[index - 1];
            var end = route[index];
            var span = cumulative[index] - cumulative[index - 1];
            var fraction = span <= 1e-9
                ? 0
                : Math.Clamp(
                    (distanceNm - cumulative[index - 1]) / span,
                    0,
                    1);
            if (fraction <= 1e-9)
            {
                return start;
            }
            if (fraction >= 1 - 1e-9)
            {
                return end;
            }

            var longitude = NormalizeLongitude(
                start.Longitude +
                fraction * ShortLongitudeDelta(start.Longitude, end.Longitude));
            var latitude = start.Latitude +
                fraction * (end.Latitude - start.Latitude);
            double? altitude = null;
            if (IsFinite(start.PlannedAltitudeFeet) &&
                IsFinite(end.PlannedAltitudeFeet))
            {
                altitude = start.PlannedAltitudeFeet!.Value +
                    fraction * (end.PlannedAltitudeFeet!.Value -
                        start.PlannedAltitudeFeet.Value);
            }

            return new WeatherRoutePoint(
                null,
                longitude,
                latitude,
                altitude,
                false);
        }

        return route[^1];
    }

    private static void AddCandidate(
        List<SampleCandidate> candidates,
        SampleCandidate candidate)
    {
        var existingIndex = candidates.FindIndex(
            item => Math.Abs(item.DistanceNm - candidate.DistanceNm) < 1e-6);
        if (existingIndex < 0)
        {
            candidates.Add(candidate);
            return;
        }

        var existing = candidates[existingIndex];
        if (candidate.Critical && !existing.Critical)
        {
            candidates[existingIndex] = candidate;
        }
    }

    private static List<SampleCandidate> ReduceCandidates(
        List<SampleCandidate> candidates)
    {
        if (candidates.Count <= MaximumSamples)
        {
            return candidates;
        }

        var endpoints = new[] { candidates[0], candidates[^1] };
        var critical = candidates
            .Skip(1)
            .SkipLast(1)
            .Where(candidate => candidate.Critical)
            .ToList();
        var ordinary = candidates
            .Skip(1)
            .SkipLast(1)
            .Where(candidate => !candidate.Critical)
            .ToList();
        var capacity = MaximumSamples - endpoints.Length;
        var selectedCritical = SelectEvenly(critical, Math.Min(capacity, critical.Count));
        capacity -= selectedCritical.Count;
        var selectedOrdinary = SelectEvenly(ordinary, Math.Min(capacity, ordinary.Count));
        return endpoints
            .Concat(selectedCritical)
            .Concat(selectedOrdinary)
            .DistinctBy(candidate => candidate.DistanceNm)
            .OrderBy(candidate => candidate.DistanceNm)
            .ToList();
    }

    private static List<SampleCandidate> SelectEvenly(
        IReadOnlyList<SampleCandidate> values,
        int count)
    {
        if (count <= 0 || values.Count == 0)
        {
            return [];
        }
        if (count >= values.Count)
        {
            return [.. values];
        }

        return Enumerable.Range(0, count)
            .Select(index => values[
                (int)Math.Round(
                    index * (values.Count - 1d) / Math.Max(1, count - 1),
                    MidpointRounding.AwayFromZero)])
            .DistinctBy(candidate => candidate.DistanceNm)
            .ToList();
    }

    private static double ShortLongitudeDelta(double from, double to) =>
        ((to - from + 540) % 360) - 180;

    private static double NormalizeLongitude(double longitude) =>
        ((longitude + 540) % 360) - 180;

    private static bool IsFinite(double? value) =>
        value is { } number && double.IsFinite(number);

    private sealed record SampleCandidate(
        double DistanceNm,
        bool Critical,
        string? Ident);
}
