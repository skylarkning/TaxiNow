namespace TaxiNow.Server.Weather;

public static class WeatherBandBuilder
{
    private const double CloudThresholdPercent = 60;
    private const double MetresToFeet = 3.28083989501312;
    private const double MaximumJoinGapNm = 50;

    public static IReadOnlyList<WeatherBand> Build(
        ForecastProfileData forecast,
        WeatherRouteWindow window)
    {
        var cloudRuns = new List<BandRun>();
        var precipitationRuns = new List<BandRun>();
        var cloudSerial = 0;
        var precipitationSerial = 0;

        foreach (var column in forecast.Columns
            .OrderBy(item => item.RouteSample.DistanceNm))
        {
            var layers = DeriveLayers(column.Levels);
            for (var layerIndex = 0; layerIndex < layers.Count; layerIndex++)
            {
                var layer = layers[layerIndex];
                var weatherColumn = ToBandColumn(column, layer);
                var relation = WeatherProfileDerivation.ClassifyPathRelation(
                    column.RouteSample.PlannedAltitudeFeet ?? double.NaN,
                    layer.BaseFeet,
                    layer.TopFeet);
                Append(
                    cloudRuns,
                    ref cloudSerial,
                    "cloud",
                    WeatherFeatureKind.Cloud,
                    WeatherIntensity.None,
                    relation,
                    layer.Confidence,
                    layerIndex,
                    weatherColumn,
                    forecast.Source.Name);

                var intensity = NormalizeIntensity(
                    column.PrecipitationMillimetres,
                    column.ShowersMillimetres,
                    column.WeatherCode,
                    column.CapeJoulesPerKilogram);
                if (intensity == WeatherIntensity.None)
                {
                    continue;
                }
                var kind = column.WeatherCode is 95 or 96 or 99
                    ? WeatherFeatureKind.Convective
                    : WeatherFeatureKind.Precipitation;
                Append(
                    precipitationRuns,
                    ref precipitationSerial,
                    "weather",
                    kind,
                    intensity,
                    relation,
                    layer.Confidence,
                    layerIndex,
                    weatherColumn,
                    forecast.Source.Name);
            }
        }

        return cloudRuns
            .Concat(precipitationRuns)
            .Select(run => run.ToBand())
            .ToArray();
    }

    public static WeatherIntensity NormalizeIntensity(
        double? precipitationMillimetres,
        double? showersMillimetres,
        int? weatherCode,
        double? capeJoulesPerKilogram)
    {
        if (weatherCode is 95 or 96 or 99)
        {
            return WeatherIntensity.Strong;
        }

        var amount = Math.Max(
            Math.Max(0, precipitationMillimetres ?? 0),
            Math.Max(0, showersMillimetres ?? 0));
        if (amount >= 10)
        {
            return WeatherIntensity.Strong;
        }
        if (amount >= 2.5 || weatherCode is 80 or 81 or 82)
        {
            return WeatherIntensity.Moderate;
        }
        if (amount > 0)
        {
            return WeatherIntensity.Weak;
        }
        return WeatherIntensity.None;
    }

    private static List<DerivedLayer> DeriveLayers(
        IReadOnlyList<ForecastLevel> levels)
    {
        var ordered = levels
            .Where(level =>
                double.IsFinite(level.CloudCoverPercent) &&
                double.IsFinite(level.GeopotentialHeightMetres))
            .OrderBy(level => level.GeopotentialHeightMetres)
            .ToArray();
        var layers = new List<DerivedLayer>();
        for (var index = 0; index < ordered.Length; index++)
        {
            if (ordered[index].CloudCoverPercent < CloudThresholdPercent)
            {
                continue;
            }

            var start = index;
            while (index + 1 < ordered.Length &&
                   ordered[index + 1].CloudCoverPercent >= CloudThresholdPercent)
            {
                index++;
            }
            var end = index;
            double? baseFeet = start == 0
                ? null
                : InterpolateThresholdHeight(ordered[start - 1], ordered[start]);
            double? topFeet = end == ordered.Length - 1
                ? null
                : InterpolateThresholdHeight(ordered[end], ordered[end + 1]);
            layers.Add(new DerivedLayer(
                baseFeet,
                topFeet,
                start == end ? WeatherConfidence.Low : WeatherConfidence.High));
        }
        return layers;
    }

    private static double InterpolateThresholdHeight(
        ForecastLevel first,
        ForecastLevel second)
    {
        var coverSpan = second.CloudCoverPercent - first.CloudCoverPercent;
        var fraction = Math.Abs(coverSpan) < 1e-9
            ? 0.5
            : (CloudThresholdPercent - first.CloudCoverPercent) / coverSpan;
        var metres = first.GeopotentialHeightMetres +
            Math.Clamp(fraction, 0, 1) *
            (second.GeopotentialHeightMetres - first.GeopotentialHeightMetres);
        return metres * MetresToFeet;
    }

    private static WeatherBandColumn ToBandColumn(
        ForecastColumn forecast,
        DerivedLayer layer) =>
        new(
            forecast.RouteSample.Longitude,
            forecast.RouteSample.Latitude,
            forecast.RouteSample.DistanceNm,
            forecast.RouteSample.ValidAt,
            layer.BaseFeet,
            layer.TopFeet,
            layer.BaseFeet,
            layer.TopFeet,
            forecast.RouteSample.PlannedAltitudeFeet);

    private static void Append(
        List<BandRun> runs,
        ref int serial,
        string idPrefix,
        WeatherFeatureKind kind,
        WeatherIntensity intensity,
        WeatherPathRelation relation,
        WeatherConfidence confidence,
        int layerIndex,
        WeatherBandColumn column,
        string source)
    {
        var current = runs.LastOrDefault(run =>
            run.Kind == kind &&
            run.Intensity == intensity &&
            run.Relation == relation &&
            run.LayerIndex == layerIndex &&
            column.DistanceNm - run.Columns[^1].DistanceNm <= MaximumJoinGapNm);
        if (current is null)
        {
            current = new BandRun(
                $"{idPrefix}-{serial++}",
                kind,
                intensity,
                relation,
                confidence,
                layerIndex,
                source);
            runs.Add(current);
        }
        current.Columns.Add(column);
        if (confidence < current.Confidence)
        {
            current.Confidence = confidence;
        }
    }

    private sealed record DerivedLayer(
        double? BaseFeet,
        double? TopFeet,
        WeatherConfidence Confidence);

    private sealed class BandRun(
        string id,
        WeatherFeatureKind kind,
        WeatherIntensity intensity,
        WeatherPathRelation relation,
        WeatherConfidence confidence,
        int layerIndex,
        string source)
    {
        public string Id { get; } = id;
        public WeatherFeatureKind Kind { get; } = kind;
        public WeatherIntensity Intensity { get; } = intensity;
        public WeatherPathRelation Relation { get; } = relation;
        public WeatherConfidence Confidence { get; set; } = confidence;
        public int LayerIndex { get; } = layerIndex;
        public string Source { get; } = source;
        public List<WeatherBandColumn> Columns { get; } = [];

        public WeatherBand ToBand() => new(
            Id,
            Kind,
            Intensity,
            Relation,
            Confidence,
            WeatherValueKind.Forecast,
            Columns,
            Source);
    }
}
