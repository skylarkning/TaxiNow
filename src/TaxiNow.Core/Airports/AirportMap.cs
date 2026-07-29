namespace TaxiNow.Core.Airports;

public sealed record GeoBounds(
    double MinLon,
    double MaxLon,
    double MinLat,
    double MaxLat)
{
    public bool Contains(double longitude, double latitude, double paddingDegrees = 0) =>
        longitude >= MinLon - paddingDegrees &&
        longitude <= MaxLon + paddingDegrees &&
        latitude >= MinLat - paddingDegrees &&
        latitude <= MaxLat + paddingDegrees;
}

public sealed record AirportMetadata(
    string Icao,
    string Name,
    string CountryCode,
    string? RegionCode,
    string? Municipality,
    double[] Center,
    GeoBounds Bounds);

public sealed record MapSource(
    string Name,
    string? Url,
    string? License,
    DateTimeOffset RetrievedAt,
    string? Revision);

public enum AirportFeatureKind
{
    Runway,
    Taxiway,
    Taxilane,
    Apron,
    ParkingPosition,
    Gate,
    HoldingPosition,
    Terminal,
    Hangar,
    Jetway,
    Pavement
}

public sealed record AirportFeature(
    string Id,
    AirportFeatureKind Kind,
    double[][] Points,
    string? Ref,
    string? Name,
    string? Surface,
    double? WidthMeters,
    double? HeadingDegrees,
    bool Closed,
    string Source);

public sealed record AirportFeatureCounts(
    int Runways,
    int Taxiways,
    int Stands,
    int Terminals);

public sealed record AirportMap(
    int SchemaVersion,
    AirportMetadata Airport,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<MapSource> Sources,
    AirportFeatureCounts Counts,
    IReadOnlyList<AirportFeature> Features);
