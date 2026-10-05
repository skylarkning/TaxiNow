using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace TaxiNow.Server.Weather;

public interface IAviationWeatherProvider
{
    Task<AviationWeatherData> GetAsync(
        WeatherRouteWindow window,
        CancellationToken token);
}

public sealed record WeatherCoordinate(double Longitude, double Latitude);

public sealed record AviationCloudReport(
    string StationId,
    double Longitude,
    double Latitude,
    DateTimeOffset ValidFrom,
    DateTimeOffset ValidTo,
    double? BaseFeet,
    WeatherValueKind ValueKind,
    string Source);

public sealed record AviationHazardReport(
    string Id,
    string Hazard,
    DateTimeOffset ValidFrom,
    DateTimeOffset ValidTo,
    double? BaseFeet,
    double? TopFeet,
    IReadOnlyList<WeatherCoordinate> Polygon,
    string Source);

public sealed record AviationWeatherData(
    IReadOnlyList<AviationCloudReport> CloudReports,
    IReadOnlyList<AviationHazardReport> Hazards,
    IReadOnlyList<WeatherSourceInfo> Sources,
    IReadOnlyList<string> Warnings);

public sealed class AviationWeatherProvider : IAviationWeatherProvider
{
    public const string HttpClientName = "TaxiNow.Weather.Aviation";
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private const string DefaultBaseUrl = "https://aviationweather.gov/api/data";
    private const int MaximumResponseBytes = 2 * 1024 * 1024;
    private readonly HttpClient _client;
    private readonly Uri _baseUri;
    private readonly TimeProvider _timeProvider;

    public AviationWeatherProvider(
        HttpClient client,
        IConfiguration configuration,
        TimeProvider? timeProvider = null)
    {
        _client = client;
        _client.Timeout = RequestTimeout;
        if (!_client.DefaultRequestHeaders.UserAgent.Any())
        {
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("TaxiNow-Pro/1.0 (+https://github.com/stewieqi-del/TaxiNow-Stewie)");
        }
        _timeProvider = timeProvider ?? TimeProvider.System;
        var configured = configuration["TaxiNow:Weather:AviationBaseUrl"];
        _baseUri = ParseBaseUri(string.IsNullOrWhiteSpace(configured)
            ? DefaultBaseUrl
            : configured.Trim());
    }

    public async Task<AviationWeatherData> GetAsync(
        WeatherRouteWindow window,
        CancellationToken token)
    {
        var stationIds = window.Samples
            .Where(sample => IsAirportIdentifier(sample.Ident))
            .Select(sample => sample.Ident!.Trim().ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var clouds = new List<AviationCloudReport>();
        var hazards = new List<AviationHazardReport>();
        var warnings = new List<string>();
        var sources = new List<WeatherSourceInfo>();

        if (stationIds.Length > 0)
        {
            await LoadFamilyAsync(
                "METAR",
                "metar",
                new Dictionary<string, string?>
                {
                    ["ids"] = string.Join(',', stationIds),
                    ["format"] = "json"
                },
                root => clouds.AddRange(ParseMetars(root)),
                sources,
                warnings,
                token).ConfigureAwait(false);
            await LoadFamilyAsync(
                "TAF",
                "taf",
                new Dictionary<string, string?>
                {
                    ["ids"] = string.Join(',', stationIds),
                    ["format"] = "json"
                },
                root => clouds.AddRange(ParseTafs(root)),
                sources,
                warnings,
                token).ConfigureAwait(false);
        }

        await LoadFamilyAsync(
            "SIGMET",
            "airsigmet",
            new Dictionary<string, string?> { ["format"] = "json" },
            root => hazards.AddRange(ParseAirSigmets(root)),
            sources,
            warnings,
            token).ConfigureAwait(false);
        await LoadFamilyAsync(
            "International SIGMET",
            "isigmet",
            new Dictionary<string, string?> { ["format"] = "json" },
            root => hazards.AddRange(ParseInternationalSigmets(root)),
            sources,
            warnings,
            token).ConfigureAwait(false);

        return new AviationWeatherData(clouds, hazards, sources, warnings);
    }

    private async Task LoadFamilyAsync(
        string family,
        string endpoint,
        IReadOnlyDictionary<string, string?> parameters,
        Action<JsonElement> consume,
        List<WeatherSourceInfo> sources,
        List<string> warnings,
        CancellationToken token)
    {
        try
        {
            var endpointUri = new Uri(_baseUri.AbsoluteUri.TrimEnd('/') + "/" + endpoint);
            var requestUri = QueryHelpers.AddQueryString(endpointUri.AbsoluteUri, parameters);
            using var response = await _client.GetAsync(
                    requestUri,
                    HttpCompletionOption.ResponseHeadersRead,
                    token)
                .ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.NoContent)
            {
                AddSource(sources, family);
                return;
            }
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                warnings.Add($"{family} acquisition was rate limited; no retry was attempted.");
                return;
            }
            if (!response.IsSuccessStatusCode)
            {
                warnings.Add($"{family} acquisition failed with HTTP {(int)response.StatusCode}.");
                return;
            }

            var payload = await ReadBoundedResponseAsync(response.Content, token)
                .ConfigureAwait(false);
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new JsonException("The response root was not an array.");
            }
            consume(document.RootElement);
            AddSource(sources, family);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (error is
            HttpRequestException or TaskCanceledException or JsonException or IOException or InvalidOperationException)
        {
            warnings.Add($"{family} acquisition failed: {DescribeFailure(error)}.");
        }
    }

    private void AddSource(List<WeatherSourceInfo> sources, string family)
    {
        sources.Add(new WeatherSourceInfo(
            family,
            $"{family}: NOAA Aviation Weather Center",
            _timeProvider.GetUtcNow(),
            null,
            null));
    }

    private static IEnumerable<AviationCloudReport> ParseMetars(JsonElement root)
    {
        foreach (var item in root.EnumerateArray())
        {
            if (!TryReadStation(item, out var station, out var longitude, out var latitude) ||
                !TryReadCloudBase(item, out var cloudBase))
            {
                continue;
            }
            var observedAt = ReadEpochOrIsoTime(item, "obsTime", "reportTime");
            if (observedAt is null)
            {
                continue;
            }
            yield return new AviationCloudReport(
                station,
                longitude,
                latitude,
                observedAt.Value.AddMinutes(-30),
                observedAt.Value.AddMinutes(90),
                cloudBase,
                WeatherValueKind.Observed,
                "METAR");
        }
    }

    private static IEnumerable<AviationCloudReport> ParseTafs(JsonElement root)
    {
        foreach (var item in root.EnumerateArray())
        {
            if (!TryReadStation(item, out var station, out var longitude, out var latitude) ||
                !item.TryGetProperty("fcsts", out var forecasts) ||
                forecasts.ValueKind != JsonValueKind.Array)
            {
                continue;
            }
            foreach (var forecast in forecasts.EnumerateArray())
            {
                if (!TryReadCloudBase(forecast, out var cloudBase) ||
                    !TryReadEpoch(forecast, "timeFrom", out var validFrom) ||
                    !TryReadEpoch(forecast, "timeTo", out var validTo) ||
                    validTo <= validFrom)
                {
                    continue;
                }
                yield return new AviationCloudReport(
                    station,
                    longitude,
                    latitude,
                    validFrom,
                    validTo,
                    cloudBase,
                    WeatherValueKind.Forecast,
                    "TAF");
            }
        }
    }

    private static IEnumerable<AviationHazardReport> ParseAirSigmets(JsonElement root)
    {
        foreach (var item in root.EnumerateArray())
        {
            var parsed = ParseHazard(
                item,
                "SIGMET",
                ReadNullableNumber(item, "altitudeLow1") ?? ReadNullableNumber(item, "altitudeLow2"),
                Maximum(ReadNullableNumber(item, "altitudeHi1"), ReadNullableNumber(item, "altitudeHi2")));
            if (parsed is not null)
            {
                yield return parsed;
            }
        }
    }

    private static IEnumerable<AviationHazardReport> ParseInternationalSigmets(JsonElement root)
    {
        foreach (var item in root.EnumerateArray())
        {
            var parsed = ParseHazard(
                item,
                "International SIGMET",
                ReadNullableNumber(item, "base"),
                ReadNullableNumber(item, "top"));
            if (parsed is not null)
            {
                yield return parsed;
            }
        }
    }

    private static AviationHazardReport? ParseHazard(
        JsonElement item,
        string source,
        double? baseFeet,
        double? topFeet)
    {
        if (!TryReadEpoch(item, "validTimeFrom", out var validFrom) ||
            !TryReadEpoch(item, "validTimeTo", out var validTo) ||
            validTo <= validFrom ||
            !item.TryGetProperty("coords", out var coordinates) ||
            coordinates.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        var polygon = coordinates.EnumerateArray()
            .Where(coordinate =>
                coordinate.TryGetProperty("lon", out var lon) && lon.TryGetDouble(out _) &&
                coordinate.TryGetProperty("lat", out var lat) && lat.TryGetDouble(out _))
            .Select(coordinate => new WeatherCoordinate(
                coordinate.GetProperty("lon").GetDouble(),
                coordinate.GetProperty("lat").GetDouble()))
            .Where(coordinate =>
                double.IsFinite(coordinate.Longitude) &&
                double.IsFinite(coordinate.Latitude))
            .ToArray();
        if (polygon.Length < 3)
        {
            return null;
        }
        return new AviationHazardReport(
            ReadString(item, "seriesId") ?? ReadString(item, "icaoId") ?? "unknown",
            ReadString(item, "hazard") ?? "unknown",
            validFrom,
            validTo,
            baseFeet,
            topFeet,
            polygon,
            source);
    }

    private static bool TryReadStation(
        JsonElement item,
        out string station,
        out double longitude,
        out double latitude)
    {
        station = ReadString(item, "icaoId")?.Trim().ToUpperInvariant() ?? string.Empty;
        longitude = ReadNullableNumber(item, "lon") ?? double.NaN;
        latitude = ReadNullableNumber(item, "lat") ?? double.NaN;
        return IsAirportIdentifier(station) &&
            double.IsFinite(longitude) && longitude is >= -180 and <= 180 &&
            double.IsFinite(latitude) && latitude is >= -90 and <= 90;
    }

    private static bool TryReadCloudBase(JsonElement item, out double? cloudBase)
    {
        cloudBase = null;
        if (!item.TryGetProperty("clouds", out var clouds) ||
            clouds.ValueKind != JsonValueKind.Array)
        {
            return false;
        }
        cloudBase = clouds.EnumerateArray()
            .Where(cloud =>
            {
                var cover = ReadString(cloud, "cover");
                return cover is not null && cover is not ("CLR" or "SKC" or "NSC" or "NCD");
            })
            .Select(cloud => ReadNullableNumber(cloud, "base"))
            .Where(value => value is >= -2_000 and <= 100_000)
            .Min();
        return cloudBase is not null;
    }

    private static DateTimeOffset? ReadEpochOrIsoTime(
        JsonElement item,
        string epochProperty,
        string isoProperty)
    {
        if (TryReadEpoch(item, epochProperty, out var epoch))
        {
            return epoch;
        }
        var text = ReadString(item, isoProperty);
        return DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    private static bool TryReadEpoch(
        JsonElement item,
        string property,
        out DateTimeOffset value)
    {
        value = default;
        if (!item.TryGetProperty(property, out var element) ||
            !element.TryGetInt64(out var seconds))
        {
            return false;
        }
        try
        {
            value = DateTimeOffset.FromUnixTimeSeconds(seconds);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }

    private static double? ReadNullableNumber(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) &&
        value.ValueKind != JsonValueKind.Null &&
        value.TryGetDouble(out var number) &&
        double.IsFinite(number)
            ? number
            : null;

    private static string? ReadString(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static double? Maximum(double? first, double? second) =>
        first is null ? second : second is null ? first : Math.Max(first.Value, second.Value);

    private static bool IsAirportIdentifier(string? value) =>
        value is { Length: 4 } && value.All(character => char.IsAsciiLetterOrDigit(character));

    private static async Task<byte[]> ReadBoundedResponseAsync(
        HttpContent content,
        CancellationToken token)
    {
        if (content.Headers.ContentLength is > MaximumResponseBytes)
        {
            throw new InvalidOperationException("response exceeded the two MiB limit");
        }
        await using var input = await content.ReadAsStreamAsync(token).ConfigureAwait(false);
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await input.ReadAsync(buffer, token).ConfigureAwait(false);
            if (read == 0)
            {
                return output.ToArray();
            }
            if (output.Length + read > MaximumResponseBytes)
            {
                throw new InvalidOperationException("response exceeded the two MiB limit");
            }
            output.Write(buffer, 0, read);
        }
    }

    private static string DescribeFailure(Exception error) => error switch
    {
        TaskCanceledException => "request timed out",
        JsonException => "response contained malformed JSON",
        InvalidOperationException => error.Message,
        _ => "service was unavailable"
    };

    private static Uri ParseBaseUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException(
                "TaxiNow:Weather:AviationBaseUrl must be an absolute HTTP or HTTPS URL.");
        }
        return uri;
    }
}
