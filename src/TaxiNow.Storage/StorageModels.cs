namespace TaxiNow.Storage;

public sealed record StoredMapAsset(
    string Icao,
    string Name,
    string CountryCode,
    string? RegionCode,
    string? Municipality,
    string RelativePath,
    long SizeBytes,
    DateTimeOffset GeneratedAt,
    DateTimeOffset ImportedAt,
    string SourceMix,
    string? Warning);

public sealed record StorageSummary(
    long TotalBytes,
    long FreeBytes,
    int AirportCount,
    IReadOnlyList<StorageGroupSummary> Countries,
    IReadOnlyList<StoredMapAsset> Assets);

public sealed record StorageGroupSummary(
    string Code,
    int AirportCount,
    long SizeBytes);
