using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace TaxiNow.Core.Airports;

public static class AirportMapJson
{
    public static readonly JsonSerializerOptions Options = CreateOptions();

    public static AirportMap Read(string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        var root = JsonNode.Parse(json) as JsonObject
            ?? throw new AirportMapValidationException("Map root must be a JSON object.");

        var version = root["schemaVersion"]?.GetValue<int>() ?? 1;
        if (version == 1)
        {
            root = SchemaV1Adapter.Upgrade(root);
        }
        else if (version != 2)
        {
            throw new AirportMapValidationException($"Unsupported schema version {version}.");
        }

        var map = root.Deserialize<AirportMap>(Options)
            ?? throw new AirportMapValidationException("Map could not be deserialized.");
        AirportMapValidator.Validate(map);
        return map;
    }

    public static string Write(AirportMap map)
    {
        AirportMapValidator.Validate(map);
        return JsonSerializer.Serialize(map, Options);
    }

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            WriteIndented = false,
            PropertyNameCaseInsensitive = true
        };
        options.Converters.Add(new JsonStringEnumConverter<AirportFeatureKind>(
            JsonNamingPolicy.SnakeCaseLower));
        return options;
    }
}

public sealed class AirportMapValidationException(string message) : Exception(message);

