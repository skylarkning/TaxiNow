using System.Text.Json.Nodes;
using System.Globalization;

namespace TaxiNow.Core.Airports;

internal static class SchemaV1Adapter
{
    public static JsonObject Upgrade(JsonObject source)
    {
        var upgraded = (JsonObject)source.DeepClone();
        upgraded["schemaVersion"] = 2;

        var airport = upgraded["airport"] as JsonObject ?? new JsonObject();
        upgraded["airport"] = airport;

        airport["icao"] ??=
            upgraded["ident"]?.DeepClone() ??
            upgraded["icao"]?.DeepClone() ??
            "UNKNOWN";
        airport["name"] ??=
            upgraded["name"]?.DeepClone() ??
            airport["icao"]?.DeepClone() ??
            "Unknown airport";
        airport["countryCode"] ??= upgraded["countryCode"]?.DeepClone() ?? "ZZ";
        airport["regionCode"] ??= upgraded["regionCode"]?.DeepClone();
        airport["municipality"] ??= upgraded["municipality"]?.DeepClone();

        var features = upgraded["features"] as JsonArray ?? [];
        upgraded["features"] = features;
        var points = features
            .OfType<JsonObject>()
            .SelectMany(ReadPoints)
            .ToArray();

        airport["center"] ??=
            upgraded["center"]?.DeepClone() ??
            (points.Length == 0
                ? new JsonArray(0d, 0d)
                : new JsonArray(
                    points.Average(static p => p[0]),
                    points.Average(static p => p[1])));
        airport["bounds"] ??= upgraded["bounds"]?.DeepClone() ?? CreateBounds(points);
        upgraded["generatedAt"] ??= DateTimeOffset.UnixEpoch;
        var sourceName = upgraded["source"]?.GetValue<string>() ??
            "SkyCharts schema v1 import";
        var sourceUrl = upgraded["sourceURL"]?.GetValue<string>();
        upgraded["sources"] ??= new JsonArray
        {
            new JsonObject
            {
                ["name"] = sourceName,
                ["url"] = sourceUrl,
                ["license"] = sourceName.Contains(
                    "OpenStreetMap",
                    StringComparison.OrdinalIgnoreCase)
                    ? "ODbL 1.0"
                    : null,
                ["retrievedAt"] = upgraded["generatedAt"]?.DeepClone() ??
                    DateTimeOffset.UnixEpoch,
                ["revision"] = null
            }
        };

        var index = 0;
        foreach (var feature in features.OfType<JsonObject>())
        {
            var kind = NormalizeKind(feature["kind"]?.GetValue<string>());
            feature["kind"] = kind;
            feature["id"] ??= $"v1-{index++:D5}-{kind}";
            feature["source"] ??=
                feature["operator"]?.DeepClone() ??
                sourceName;
            feature["closed"] = false;
            feature["widthMeters"] ??= ReadWidthMeters(feature["width"]);
            feature["headingDegrees"] ??= null;
            if (kind == "terminal")
            {
                feature["name"] ??= feature["label"]?.DeepClone();
            }
        }

        upgraded["counts"] = CountFeatures(features);
        return upgraded;
    }

    private static JsonNode? ReadWidthMeters(JsonNode? value)
    {
        if (value is JsonValue jsonValue &&
            jsonValue.TryGetValue<double>(out var number))
        {
            return number;
        }
        if (value is JsonValue stringValue &&
            stringValue.TryGetValue<string>(out var text))
        {
            text = text.Trim().TrimEnd('m', 'M').Trim();
            if (double.TryParse(
                    text,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out number))
            {
                return number;
            }
        }
        return null;
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
