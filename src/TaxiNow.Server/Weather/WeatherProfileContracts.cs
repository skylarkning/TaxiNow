namespace TaxiNow.Server.Weather;

public sealed record WeatherProfileRequest(
    IReadOnlyList<WeatherRoutePoint> Route,
    double? CurrentDistanceNm = null,
    double? GroundSpeedKnots = null,
    DateTimeOffset? DepartureTimeUtc = null,
    double? EstimatedEnrouteSeconds = null);

public sealed record WeatherRoutePoint(
    string? Ident,
    double Longitude,
    double Latitude,
    double? PlannedAltitudeFeet,
    bool Critical);

public sealed record TimedRouteSample(
    string? Ident,
    double Longitude,
    double Latitude,
    double DistanceNm,
    double? PlannedAltitudeFeet,
    bool Critical,
    DateTimeOffset ValidAt);

public sealed record WeatherRouteWindow(
    double TotalDistanceNm,
    double StartDistanceNm,
    double EndDistanceNm,
    string EtaBasis,
    IReadOnlyList<TimedRouteSample> Samples);

public enum WeatherFeatureKind
{
    Cloud,
    Precipitation,
    Convective
}

public enum WeatherIntensity
{
    None,
    Weak,
    Moderate,
    Strong
}

public enum WeatherPathRelation
{
    Unknown,
    OnPath,
    OffPath
}

public enum WeatherConfidence
{
    Low,
    Medium,
    High
}

public enum WeatherValueKind
{
    Observed,
    Forecast,
    Estimated
}

public sealed record WeatherBandColumn(
    double Longitude,
    double Latitude,
    double DistanceNm,
    DateTimeOffset ValidAt,
    double? OriginalBaseFeet,
    double? OriginalTopFeet,
    double? BaseFeet,
    double? TopFeet,
    double? PlannedAltitudeFeet);

public sealed record WeatherBand(
    string Id,
    WeatherFeatureKind Kind,
    WeatherIntensity Intensity,
    WeatherPathRelation PathRelation,
    WeatherConfidence Confidence,
    WeatherValueKind ValueKind,
    IReadOnlyList<WeatherBandColumn> Columns,
    string Source);

public sealed record WeatherSourceInfo(
    string Name,
    string Attribution,
    DateTimeOffset GeneratedAt,
    DateTimeOffset? ValidFrom,
    DateTimeOffset? ValidTo);

public sealed record WeatherProfileResponse(
    double StartDistanceNm,
    double EndDistanceNm,
    DateTimeOffset GeneratedAt,
    DateTimeOffset? ValidFrom,
    DateTimeOffset? ValidTo,
    string EtaBasis,
    string CacheState,
    IReadOnlyList<WeatherBand> Bands,
    IReadOnlyList<WeatherSourceInfo> Sources,
    IReadOnlyList<string> Warnings);

public sealed class WeatherProfileValidationException(string message)
    : ArgumentException(message);

public sealed class WeatherProfileUnavailableException(
    string message,
    Exception? innerException = null)
    : Exception(message, innerException);
