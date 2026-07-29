using System.Text;
using TaxiNow.Core.Airports;
using TaxiNow.Storage;

namespace TaxiNow.Server.Airports;

public sealed class AirportFixtureService(MapAssetStore assets)
{
    private AirportMap? _map;

    public async Task EnsureImportedAsync(CancellationToken cancellationToken = default)
    {
        var fixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "fixtures",
            "airport-maps",
            "CYYZ.v2.json");
        var json = await File.ReadAllTextAsync(fixturePath, cancellationToken);
        _map = AirportMapJson.Read(json);
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        await assets.ImportAsync(stream, cancellationToken);
    }

    public IReadOnlyList<AirportMetadata> Search(string? query)
    {
        if (_map is null)
        {
            return [];
        }

        if (string.IsNullOrWhiteSpace(query))
        {
            return [_map.Airport];
        }

        return _map.Airport.Icao.Contains(query, StringComparison.OrdinalIgnoreCase) ||
               _map.Airport.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
               (_map.Airport.Municipality?.Contains(
                   query,
                   StringComparison.OrdinalIgnoreCase) ?? false)
            ? [_map.Airport]
            : [];
    }

    public AirportMetadata? Get(string icao) =>
        _map is not null &&
        string.Equals(_map.Airport.Icao, icao, StringComparison.OrdinalIgnoreCase)
            ? _map.Airport
            : null;

    public Task<string?> ReadMapJsonAsync(
        string icao,
        CancellationToken cancellationToken) =>
        assets.ReadJsonAsync(icao, cancellationToken);
}

