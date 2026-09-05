using System.Globalization;
using System.IO.Compression;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.Server.Airports;

public sealed record AirportCatalogMatch(
    string Icao,
    string Name,
    string CountryCode,
    string? RegionCode,
    string? Municipality,
    double Latitude,
    double Longitude,
    double DistanceMeters);

public sealed class AirportCatalogService
{
    public const double DefaultMaximumDistanceMeters = 12_000;

    private static readonly HashSet<string> SupportedTypes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "large_airport",
            "medium_airport",
            "small_airport",
            "seaplane_base"
        };

    private readonly Lazy<Task<IReadOnlyList<AirportCatalogEntry>>> _airports;

    public AirportCatalogService()
        : this(Path.Combine(
            AppContext.BaseDirectory,
            "pipeline",
            "data",
            "airports.csv.gz"))
    {
    }

    public AirportCatalogService(string catalogPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(catalogPath);
        _airports = new Lazy<Task<IReadOnlyList<AirportCatalogEntry>>>(
            () => LoadAsync(Path.GetFullPath(catalogPath)),
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public async Task<AirportCatalogMatch?> FindNearestAsync(
        double latitude,
        double longitude,
        double maximumDistanceMeters = DefaultMaximumDistanceMeters,
        CancellationToken cancellationToken = default)
    {
        if (!double.IsFinite(latitude) || latitude is < -90 or > 90 ||
            !double.IsFinite(longitude) || longitude is < -180 or > 180 ||
            !double.IsFinite(maximumDistanceMeters) || maximumDistanceMeters <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(latitude),
                "Coordinates and maximum distance must be valid.");
        }

        var airports = await _airports.Value
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        AirportCatalogEntry? nearest = null;
        var nearestDistance = maximumDistanceMeters;
        foreach (var airport in airports)
        {
            var distance = TelemetryMath.DistanceMeters(
                latitude,
                longitude,
                airport.Latitude,
                airport.Longitude);
            if (distance > nearestDistance)
            {
                continue;
            }

            nearest = airport;
            nearestDistance = distance;
        }

        return nearest is null
            ? null
            : new AirportCatalogMatch(
                nearest.Icao,
                nearest.Name,
                nearest.CountryCode,
                nearest.RegionCode,
                nearest.Municipality,
                nearest.Latitude,
                nearest.Longitude,
                nearestDistance);
    }

    private static async Task<IReadOnlyList<AirportCatalogEntry>> LoadAsync(
        string catalogPath)
    {
        if (!File.Exists(catalogPath))
        {
            return [];
        }

        var airports = new List<AirportCatalogEntry>();
        await using var file = File.OpenRead(catalogPath);
        await using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        var headerLine = await reader.ReadLineAsync().ConfigureAwait(false);
        if (headerLine is null)
        {
            return airports;
        }

        var headers = ParseCsvLine(headerLine);
        var indexes = headers
            .Select((name, index) => (name, index))
            .ToDictionary(
                static item => item.name,
                static item => item.index,
                StringComparer.OrdinalIgnoreCase);
        var required = new[]
        {
            "ident", "type", "name", "latitude_deg", "longitude_deg",
            "iso_country", "iso_region", "municipality"
        };
        if (required.Any(field => !indexes.ContainsKey(field)))
        {
            return airports;
        }

        while (await reader.ReadLineAsync().ConfigureAwait(false) is { } line)
        {
            var fields = ParseCsvLine(line);
            if (!TryGet(fields, indexes["ident"], out var icao) ||
                icao.Length != 4 ||
                !icao.All(char.IsLetterOrDigit) ||
                !TryGet(fields, indexes["type"], out var type) ||
                !SupportedTypes.Contains(type) ||
                !TryGet(fields, indexes["name"], out var name) ||
                !TryParseCoordinate(fields, indexes["latitude_deg"], out var latitude) ||
                !TryParseCoordinate(fields, indexes["longitude_deg"], out var longitude))
            {
                continue;
            }

            airports.Add(new AirportCatalogEntry(
                icao.ToUpperInvariant(),
                name,
                GetOptional(fields, indexes["iso_country"]) ?? string.Empty,
                GetOptional(fields, indexes["iso_region"]),
                GetOptional(fields, indexes["municipality"]),
                latitude,
                longitude));
        }

        return airports;
    }

    private static bool TryParseCoordinate(
        IReadOnlyList<string> fields,
        int index,
        out double value)
    {
        value = 0;
        return TryGet(fields, index, out var text) &&
            double.TryParse(
                text,
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out value) &&
            double.IsFinite(value);
    }

    private static bool TryGet(
        IReadOnlyList<string> fields,
        int index,
        out string value)
    {
        if (index >= 0 && index < fields.Count)
        {
            value = fields[index].Trim();
            return value.Length > 0;
        }

        value = string.Empty;
        return false;
    }

    private static string? GetOptional(IReadOnlyList<string> fields, int index) =>
        TryGet(fields, index, out var value) ? value : null;

    private static List<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new System.Text.StringBuilder();
        var quoted = false;
        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];
            if (character == '"')
            {
                if (quoted && index + 1 < line.Length && line[index + 1] == '"')
                {
                    current.Append('"');
                    index++;
                }
                else
                {
                    quoted = !quoted;
                }
            }
            else if (character == ',' && !quoted)
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(character);
            }
        }

        fields.Add(current.ToString());
        return fields;
    }

    private sealed record AirportCatalogEntry(
        string Icao,
        string Name,
        string CountryCode,
        string? RegionCode,
        string? Municipality,
        double Latitude,
        double Longitude);
}
