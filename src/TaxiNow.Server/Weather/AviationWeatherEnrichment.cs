namespace TaxiNow.Server.Weather;

public sealed record WeatherEnrichmentResult(
    IReadOnlyList<WeatherBand> Bands,
    IReadOnlyList<WeatherSourceInfo> Sources,
    IReadOnlyList<string> Warnings);

public static class AviationWeatherEnrichment
{
    private const double AirportRadiusNm = 25;

    public static WeatherEnrichmentResult Apply(
        IReadOnlyList<WeatherBand> forecast,
        AviationWeatherData reports,
        WeatherRouteWindow window)
    {
        var warnings = new List<string>(reports.Warnings);
        var output = new List<WeatherBand>(forecast.Count);

        foreach (var report in reports.CloudReports.Where(report =>
                     window.Samples.Any(sample =>
                         string.Equals(sample.Ident, report.StationId, StringComparison.OrdinalIgnoreCase))))
        {
            if (!forecast.SelectMany(band => band.Columns).Any(column =>
                    column.ValidAt >= report.ValidFrom && column.ValidAt <= report.ValidTo))
            {
                warnings.Add($"{report.Source} report for {report.StationId} was expired for this route time.");
            }
        }
        foreach (var hazard in reports.Hazards)
        {
            if (!forecast.SelectMany(band => band.Columns).Any(column =>
                    column.ValidAt >= hazard.ValidFrom && column.ValidAt <= hazard.ValidTo))
            {
                warnings.Add($"{hazard.Source} {hazard.Id} was expired for this route time.");
            }
        }

        foreach (var band in forecast)
        {
            var changedBy = new HashSet<string>(StringComparer.Ordinal);
            var valueKind = band.ValueKind;
            var confidence = band.Confidence;
            var columns = new WeatherBandColumn[band.Columns.Count];

            for (var index = 0; index < band.Columns.Count; index++)
            {
                var original = band.Columns[index];
                var adjusted = original;

                if (band.Kind == WeatherFeatureKind.Cloud)
                {
                    var candidates = reports.CloudReports
                        .Where(report =>
                            original.ValidAt >= report.ValidFrom &&
                            original.ValidAt <= report.ValidTo &&
                            DistanceNm(original.Latitude, original.Longitude, report.Latitude, report.Longitude) <= AirportRadiusNm)
                        .OrderBy(report => report.ValueKind == WeatherValueKind.Observed ? 0 : 1)
                        .ThenBy(report => DistanceNm(original.Latitude, original.Longitude, report.Latitude, report.Longitude))
                        .ThenByDescending(report => report.ValidFrom)
                        .ToArray();
                    if (candidates.Length > 1 &&
                        candidates.Skip(1).Any(candidate => candidate.BaseFeet != candidates[0].BaseFeet))
                    {
                        warnings.Add($"Conflicting aviation cloud bases near {candidates[0].StationId}; {candidates[0].Source} was preferred.");
                    }
                    var cloud = candidates.FirstOrDefault(candidate => candidate.BaseFeet is not null);
                    if (cloud is not null)
                    {
                        adjusted = adjusted with { BaseFeet = cloud.BaseFeet };
                        changedBy.Add(cloud.Source);
                        valueKind = StrongerValueKind(valueKind, cloud.ValueKind);
                        confidence = WeatherConfidence.High;
                    }
                }

                var hazards = reports.Hazards.Where(hazard =>
                    original.ValidAt >= hazard.ValidFrom &&
                    original.ValidAt <= hazard.ValidTo &&
                    PointInPolygon(original.Longitude, original.Latitude, hazard.Polygon));
                foreach (var hazard in hazards)
                {
                    if (hazard.BaseFeet is not null)
                    {
                        adjusted = adjusted with { BaseFeet = hazard.BaseFeet };
                    }
                    if (hazard.TopFeet is not null)
                    {
                        adjusted = adjusted with { TopFeet = hazard.TopFeet };
                    }
                    if (hazard.BaseFeet is not null || hazard.TopFeet is not null)
                    {
                        changedBy.Add(hazard.Source);
                        confidence = WeatherConfidence.High;
                    }
                }
                columns[index] = adjusted;
            }

            var relation = AggregatePathRelation(columns);
            output.Add(band with
            {
                Columns = columns,
                PathRelation = relation,
                Confidence = confidence,
                ValueKind = valueKind,
                Source = changedBy.Count == 0
                    ? band.Source
                    : string.Join(" + ", new[] { band.Source }.Concat(changedBy))
            });
        }

        return new WeatherEnrichmentResult(
            output,
            reports.Sources,
            warnings.Distinct(StringComparer.Ordinal).ToArray());
    }

    private static WeatherValueKind StrongerValueKind(
        WeatherValueKind current,
        WeatherValueKind candidate)
    {
        static int Rank(WeatherValueKind value) => value switch
        {
            WeatherValueKind.Observed => 3,
            WeatherValueKind.Forecast => 2,
            _ => 1
        };
        return Rank(candidate) > Rank(current) ? candidate : current;
    }

    private static WeatherPathRelation AggregatePathRelation(
        IEnumerable<WeatherBandColumn> columns)
    {
        var relations = columns.Select(column =>
            WeatherProfileDerivation.ClassifyPathRelation(
                column.PlannedAltitudeFeet ?? double.NaN,
                column.BaseFeet,
                column.TopFeet)).ToArray();
        if (relations.Contains(WeatherPathRelation.OnPath))
        {
            return WeatherPathRelation.OnPath;
        }
        return relations.Contains(WeatherPathRelation.Unknown)
            ? WeatherPathRelation.Unknown
            : WeatherPathRelation.OffPath;
    }

    private static bool PointInPolygon(
        double longitude,
        double latitude,
        IReadOnlyList<WeatherCoordinate> polygon)
    {
        if (polygon.Count < 3)
        {
            return false;
        }
        var inside = false;
        for (int current = 0, previous = polygon.Count - 1;
             current < polygon.Count;
             previous = current++)
        {
            var currentLongitude = NormalizeAround(polygon[current].Longitude, longitude);
            var previousLongitude = NormalizeAround(polygon[previous].Longitude, longitude);
            var currentLatitude = polygon[current].Latitude;
            var previousLatitude = polygon[previous].Latitude;
            var crosses = (currentLatitude > latitude) != (previousLatitude > latitude) &&
                longitude < (previousLongitude - currentLongitude) *
                    (latitude - currentLatitude) /
                    (previousLatitude - currentLatitude) + currentLongitude;
            if (crosses)
            {
                inside = !inside;
            }
        }
        return inside;
    }

    private static double NormalizeAround(double value, double reference)
    {
        while (value - reference > 180)
        {
            value -= 360;
        }
        while (value - reference < -180)
        {
            value += 360;
        }
        return value;
    }

    private static double DistanceNm(
        double firstLatitude,
        double firstLongitude,
        double secondLatitude,
        double secondLongitude)
    {
        const double EarthRadiusNm = 3_440.065;
        var latitudeDelta = DegreesToRadians(secondLatitude - firstLatitude);
        var longitudeDelta = DegreesToRadians(secondLongitude - firstLongitude);
        var firstLatitudeRadians = DegreesToRadians(firstLatitude);
        var secondLatitudeRadians = DegreesToRadians(secondLatitude);
        var a = Math.Pow(Math.Sin(latitudeDelta / 2), 2) +
            Math.Cos(firstLatitudeRadians) * Math.Cos(secondLatitudeRadians) *
            Math.Pow(Math.Sin(longitudeDelta / 2), 2);
        return EarthRadiusNm * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double DegreesToRadians(double value) => value * Math.PI / 180;
}
