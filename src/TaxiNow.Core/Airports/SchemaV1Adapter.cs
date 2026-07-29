using System.Text.Json.Nodes;

namespace TaxiNow.Core.Airports;

internal static class SchemaV1Adapter
{
    public static JsonObject Upgrade(JsonObject source)
    {
        var upgraded = (JsonObject)source.DeepClone();
        upgraded["schemaVersion"] = 2;

        var airport = upgraded["airport"] as JsonObject ?? new JsonObject();
        upgraded["airport"] = airport;

        if (airport["icao"] is null && upgraded["icao"] is not null)
        {
            airport["icao"] = upgraded["icao"]!.DeepClone();
        }

        airport["name"] ??= airport["icao"]?.DeepClone() ?? "Unknown airport";
        airport["countryCode"] ??= "ZZ";
        airport["regionCode"] ??= null;
        airport["municipality"] ??= null;

        var features = upgraded["features"] as JsonArray ?? [];
        upgraded["features"] = features;
        var points = features
            .OfType<JsonObject>()
            .SelectMany(ReadPoints)
            .ToArray();

        airport["center"] ??= points.Length == 0
            ? new JsonArray(0d, 0d)
            : new JsonArray(points.Average(static p => p[0]), points.Average(static p => p[1]));
        airport["bounds"] ??= CreateBounds(points);
        upgraded["generatedAt"] ??= DateTimeOffset.UnixEpoch;
        upgraded["sources"] ??= new JsonArray
        {
            new JsonObject
            {
                ["name"] = "SkyCharts schema v1 import",
                ["url"] = null,
                ["license"] = null,
                ["retrievedAt"] = DateTimeOffset.UnixEpoch,
                ["revision"] = null
            }
        };

        foreach (var feature in features.OfType<JsonObject>())
        {
            feature["id"] ??= $"v1-{Guid.NewGuid():N}";
            feature["source"] ??= "SkyCharts schema v1 import";
            feature["closed"] ??= false;
            feature["kind"] = NormalizeKind(feature["kind"]?.GetValue<string>());
        }

        upgraded["counts"] ??= CountFeatures(features);
        return upgraded;
    }

    private static IEnumerable<double[]> ReadPoints(JsonObject feature)
    {
        var values = feature["points"] as JsonArray ?? feature["coordinates"] as JsonArray;
        if (values is null)
        {
            yield break;
        }

        feature["points"] ??= values.DeepClone();
        foreach (var item in values.OfType<JsonArray>())
        {
            if (item.Count >= 2 &&
                item[0] is JsonValue lon &&
                item[1] is JsonValue lat &&
                lon.TryGetValue<double>(out var longitude) &&
                lat.TryGetValue<double>(out var latitude))
            {
                yield return [longitude, latitude];
            }
        }
    }

    private static JsonObject CreateBounds(IReadOnlyList<double[]> points)
    {
        if (points.Count == 0)
        {
            return new JsonObject
            {
                ["minLon"] = -0.001,
                ["maxLon"] = 0.001,
                ["minLat"] = -0.001,
                ["maxLat"] = 0.001
            };
        }

        var minLon = points.Min(static p => p[0]);
        var maxLon = points.Max(static p => p[0]);
        var minLat = points.Min(static p => p[1]);
        var maxLat = points.Max(static p => p[1]);
        const double padding = 0.0001;
        return new JsonObject
        {
            ["minLon"] = minLon - padding,
            ["maxLon"] = maxLon + padding,
            ["minLat"] = minLat - padding,
            ["maxLat"] = maxLat + padding
        };
    }

    private static JsonObject CountFeatures(JsonArray features)
    {
        var kinds = features
            .OfType<JsonObject>()
            .Select(static f => f["kind"]?.GetValue<string>() ?? string.Empty)
            .ToArray();
        return new JsonObject
        {
            ["runways"] = kinds.Count(static k => k == "runway"),
            ["taxiways"] = kinds.Count(static k => k is "taxiway" or "taxilane"),
            ["stands"] = kinds.Count(static k => k is "parking_position" or "gate"),
            ["terminals"] = kinds.Count(static k => k == "terminal")
        };
    }

    private static string NormalizeKind(string? value) =>
        value?.Trim().ToLowerInvariant().Replace(' ', '_') switch
        {
            "parking" or "parkingposition" => "parking_position",
            "holding" or "hold_short" => "holding_position",
            "taxi_lane" => "taxilane",
            null or "" => "pavement",
            var normalized => normalized
        };
}

