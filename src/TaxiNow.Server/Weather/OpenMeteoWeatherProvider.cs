using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace TaxiNow.Server.Weather;

public interface IWeatherForecastProvider
{
    Task<ForecastProfileData> GetAsync(
        WeatherRouteWindow window,
        CancellationToken token);
}

public sealed record ForecastLevel(
    int PressureHpa,
    double CloudCoverPercent,
    double GeopotentialHeightMetres);

public sealed record ForecastColumn(
    TimedRouteSample RouteSample,
    IReadOnlyList<ForecastLevel> Levels,
    double? PrecipitationMillimetres,
    double? ShowersMillimetres,
    int? WeatherCode,
    double? CapeJoulesPerKilogram);

public sealed record ForecastProfileData(
    IReadOnlyList<ForecastColumn> Columns,
    WeatherSourceInfo Source);

public sealed class WeatherProviderException(
    string message,
    Exception? innerException = null)
    : Exception(message, innerException);

public sealed class OpenMeteoWeatherProvider : IWeatherForecastProvider
{
    public const string HttpClientName = "TaxiNow.Weather.Forecast";
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private const string DefaultBaseUrl =
        "https://api.open-meteo.com/v1/forecast";
    private const int MaximumResponseBytes = 2 * 1024 * 1024;
    private static readonly int[] PressureLevels =
        [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150];

    private readonly HttpClient _client;
    private readonly Uri _baseUri;
    private readonly TimeProvider _timeProvider;

    public OpenMeteoWeatherProvider(
        HttpClient client,
        IConfiguration configuration,
        TimeProvider? timeProvider = null)
    {
        _client = client;
        _client.Timeout = RequestTimeout;
        _timeProvider = timeProvider ?? TimeProvider.System;
        var configured = configuration["TaxiNow:Weather:ForecastBaseUrl"];
        _baseUri = ParseBaseUri(
            string.IsNullOrWhiteSpace(configured)
                ? DefaultBaseUrl
                : configured.Trim());
    }

    public async Task<ForecastProfileData> GetAsync(
        WeatherRouteWindow window,
        CancellationToken token)
    {
        if (window.Samples.Count == 0)
        {
            return Empty(window);
        }

        try
        {
            var variables = PressureLevels
                .SelectMany(level => new[]
                {
                    $"cloud_cover_{level}hPa",
                    $"geopotential_height_{level}hPa"
                })
                .Concat(["precipitation", "showers", "weather_code", "cape"]);
            var validFrom = window.Samples.Min(sample => sample.ValidAt);
            var validTo = window.Samples.Max(sample => sample.ValidAt);
            var parameters = new Dictionary<string, string?>
            {
                ["latitude"] = string.Join(',', window.Samples.Select(sample =>
                    sample.Latitude.ToString("G17", CultureInfo.InvariantCulture))),
                ["longitude"] = string.Join(',', window.Samples.Select(sample =>
                    sample.Longitude.ToString("G17", CultureInfo.InvariantCulture))),
                ["hourly"] = string.Join(',', variables),
                ["timezone"] = "UTC",
                ["timeformat"] = "iso8601",
                ["start_date"] = validFrom.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["end_date"] = validTo.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            };
            var requestUri = QueryHelpers.AddQueryString(
                _baseUri.AbsoluteUri,
                parameters);
            using var response = await _client.GetAsync(
                    requestUri,
                    HttpCompletionOption.ResponseHeadersRead,
                    token)
                .ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.NoContent)
            {
                return Empty(window);
            }
            response.EnsureSuccessStatusCode();
            var payload = await ReadBoundedResponseAsync(response.Content, token)
                .ConfigureAwait(false);
            using var document = JsonDocument.Parse(payload);
            var locations = document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.EnumerateArray().ToArray()
                : [document.RootElement];
            if (locations.Length != window.Samples.Count)
            {
                throw new WeatherProviderException(
                    "Forecast location count did not match the requested route samples.");
            }

            var columns = new ForecastColumn[locations.Length];
            for (var index = 0; index < locations.Length; index++)
            {
                columns[index] = ParseColumn(locations[index], window.Samples[index]);
            }

            return new ForecastProfileData(
                columns,
                new WeatherSourceInfo(
                    "Open-Meteo",
                    "Weather forecast: Open-Meteo",
                    _timeProvider.GetUtcNow(),
                    validFrom,
                    validTo));
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (WeatherProviderException)
        {
            throw;
        }
        catch (Exception error) when (
            error is HttpRequestException or
                TaskCanceledException or
                JsonException or
                IOException or
                InvalidOperationException)
        {
            throw new WeatherProviderException(
                "Weather forecast is temporarily unavailable.",
                error);
        }
    }

    private ForecastProfileData Empty(WeatherRouteWindow window)
    {
        DateTimeOffset? validFrom = window.Samples.Count == 0
            ? null
            : window.Samples.Min(sample => sample.ValidAt);
        DateTimeOffset? validTo = window.Samples.Count == 0
            ? null
            : window.Samples.Max(sample => sample.ValidAt);
        return new ForecastProfileData(
            [],
            new WeatherSourceInfo(
                "Open-Meteo",
                "Weather forecast: Open-Meteo",
                _timeProvider.GetUtcNow(),
                validFrom,
                validTo));
    }

    private static ForecastColumn ParseColumn(
        JsonElement location,
        TimedRouteSample sample)
    {
        if (!location.TryGetProperty("hourly", out var hourly) ||
            !hourly.TryGetProperty("time", out var timesElement) ||
            timesElement.ValueKind != JsonValueKind.Array)
        {
            throw new WeatherProviderException(
                "Forecast payload did not contain an hourly time axis.");
        }

        var times = timesElement.EnumerateArray()
            .Select(element => ParseUtcTime(element.GetString()))
            .ToArray();
        if (times.Length == 0)
        {
            throw new WeatherProviderException(
                "Forecast payload contained an empty hourly time axis.");
        }
        var timeIndex = Enumerable.Range(0, times.Length)
            .MinBy(index => Math.Abs((times[index] - sample.ValidAt).Ticks));

        var levels = new List<ForecastLevel>();
        foreach (var pressure in PressureLevels)
        {
            var coverName = $"cloud_cover_{pressure}hPa";
            var heightName = $"geopotential_height_{pressure}hPa";
            var hasCover = hourly.TryGetProperty(coverName, out var coverValues);
            var hasHeight = hourly.TryGetProperty(heightName, out var heightValues);
            if (!hasCover && !hasHeight)
            {
                continue;
            }
            if (!hasCover || !hasHeight ||
                coverValues.ValueKind != JsonValueKind.Array ||
                heightValues.ValueKind != JsonValueKind.Array ||
                coverValues.GetArrayLength() != times.Length ||
                heightValues.GetArrayLength() != times.Length)
            {
                throw new WeatherProviderException(
                    $"Forecast pressure-level arrays were misaligned at {pressure} hPa.");
            }

            var cover = ReadNumber(coverValues[timeIndex], coverName);
            var height = ReadNumber(heightValues[timeIndex], heightName);
            levels.Add(new ForecastLevel(pressure, cover, height));
        }

        return new ForecastColumn(
            sample,
            levels.OrderBy(level => level.GeopotentialHeightMetres).ToArray(),
            ReadOptionalSeries(hourly, "precipitation", times.Length, timeIndex),
            ReadOptionalSeries(hourly, "showers", times.Length, timeIndex),
            ReadOptionalSeries(hourly, "weather_code", times.Length, timeIndex) is { } code
                ? (int)Math.Round(code)
                : null,
            ReadOptionalSeries(hourly, "cape", times.Length, timeIndex));
    }

    private static double? ReadOptionalSeries(
        JsonElement hourly,
        string name,
        int expectedLength,
        int index)
    {
        if (!hourly.TryGetProperty(name, out var values))
        {
            return null;
        }
        if (values.ValueKind != JsonValueKind.Array ||
            values.GetArrayLength() != expectedLength)
        {
            throw new WeatherProviderException(
                $"Forecast array '{name}' was misaligned.");
        }
        var value = values[index];
        return value.ValueKind == JsonValueKind.Null
            ? null
            : ReadNumber(value, name);
    }

    private static double ReadNumber(JsonElement element, string name)
    {
        if (!element.TryGetDouble(out var value) || !double.IsFinite(value))
        {
            throw new WeatherProviderException(
                $"Forecast value '{name}' was not finite.");
        }
        return value;
    }

    private static DateTimeOffset ParseUtcTime(string? value)
    {
        if (!DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var result))
        {
            throw new WeatherProviderException(
                "Forecast payload contained an invalid time value.");
        }
        return result;
    }

    private static async Task<byte[]> ReadBoundedResponseAsync(
        HttpContent content,
        CancellationToken token)
    {
        if (content.Headers.ContentLength is > MaximumResponseBytes)
        {
            throw new WeatherProviderException(
                "Forecast response exceeded the two MiB limit.");
        }

        await using var input = await content.ReadAsStreamAsync(token)
            .ConfigureAwait(false);
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
                throw new WeatherProviderException(
                    "Forecast response exceeded the two MiB limit.");
            }
            output.Write(buffer, 0, read);
        }
    }

    private static Uri ParseBaseUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException(
                "TaxiNow:Weather:ForecastBaseUrl must be an absolute HTTP or HTTPS URL.");
        }
        return uri;
    }
}
