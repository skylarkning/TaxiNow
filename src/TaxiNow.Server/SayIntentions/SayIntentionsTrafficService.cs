using System.Net.Http.Headers;
using System.Text.Json;

namespace TaxiNow.Server.SayIntentions;

public sealed record SayIntentionsTrafficAircraft(
    string Id,
    uint? SimConnectId,
    string Callsign,
    double Latitude,
    double Longitude,
    double HeadingDegrees,
    int AltitudeFeet,
    int GroundSpeedKnots,
    bool OnGround,
    string? AircraftType,
    string? Title);

public sealed record SayIntentionsTrafficFeed(
    bool ClientConnected,
    bool ActiveFlight,
    long? FlightId,
    DateTimeOffset RetrievedAtUtc,
    bool IsStale,
    IReadOnlyList<SayIntentionsTrafficAircraft> Aircraft);

public sealed class SayIntentionsTrafficService : IDisposable
{
    public static readonly Uri FlightJsonUri =
        new("http://localhost:43117/flightJSON");
    public static readonly Uri TrackerBaseUri =
        new("https://tracker.sayintentions.ai/");
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan InactiveRefreshInterval = TimeSpan.FromSeconds(3);

    private readonly HttpClient _httpClient;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private SayIntentionsTrafficFeed? _cache;
    private DateTimeOffset? _lastRefreshAttemptUtc;
    private bool _disposed;

    public SayIntentionsTrafficService(
        HttpClient httpClient,
        TimeProvider? timeProvider = null)
    {
        _httpClient = httpClient;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public static SayIntentionsTrafficService CreateDefault(
        string productVersion)
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(15)
        };
        client.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            $"TaxiNow/{productVersion}");
        return new SayIntentionsTrafficService(client);
    }

    public async Task<SayIntentionsTrafficFeed> GetTrafficAsync(
        CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        if (IsCacheFresh(_cache, now))
        {
            return _cache!;
        }

        await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            now = _timeProvider.GetUtcNow();
            if (IsCacheFresh(_cache, now))
            {
                return _cache!;
            }

            _lastRefreshAttemptUtc = now;

            long? flightId;
            try
            {
                flightId = await ReadActiveFlightIdAsync(cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception error) when (
                (error is HttpRequestException or JsonException or TaskCanceledException) &&
                !cancellationToken.IsCancellationRequested)
            {
                return _cache = EmptyFeed(now, clientConnected: false);
            }

            if (flightId is null)
            {
                return _cache = EmptyFeed(now, clientConnected: true);
            }

            try
            {
                using var response = await _httpClient.GetAsync(
                    new Uri(TrackerBaseUri, $"traffic/{flightId.Value}"),
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content
                    .ReadAsStreamAsync(cancellationToken)
                    .ConfigureAwait(false);
                using var document = await JsonDocument.ParseAsync(
                    stream,
                    cancellationToken: cancellationToken)
                    .ConfigureAwait(false);
                var aircraft = ParseTraffic(document.RootElement);
                return _cache = new SayIntentionsTrafficFeed(
                    true,
                    true,
                    flightId,
                    now,
                    false,
                    aircraft);
            }
            catch (Exception error) when (
                (error is HttpRequestException or JsonException or TaskCanceledException) &&
                !cancellationToken.IsCancellationRequested &&
                _cache is { ActiveFlight: true } cached &&
                cached.FlightId == flightId)
            {
                return _cache = cached with { IsStale = true };
            }
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private bool IsCacheFresh(
        SayIntentionsTrafficFeed? cache,
        DateTimeOffset now)
    {
        if (cache is null)
        {
            return false;
        }

        var interval = cache.ActiveFlight
            ? RefreshInterval
            : InactiveRefreshInterval;
        return _lastRefreshAttemptUtc is { } lastAttempt &&
            now - lastAttempt < interval;
    }

    private async Task<long?> ReadActiveFlightIdAsync(
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(
            FlightJsonUri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content
            .ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        var root = document.RootElement;
        if (!root.TryGetProperty("flight_details", out var details) ||
            details.ValueKind != JsonValueKind.Object ||
            !details.TryGetProperty("flight_id", out var flightIdElement) ||
            !TryReadPositiveInt64(flightIdElement, out var flightId))
        {
            return null;
        }

        return flightId;
    }

    internal static IReadOnlyList<SayIntentionsTrafficAircraft> ParseTraffic(
        JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            throw new JsonException(
                "The SayIntentions traffic response was not an array.");
        }

        var aircraft = new List<SayIntentionsTrafficAircraft>();
        foreach (var item in root.EnumerateArray())
        {
            if (TryReadAircraft(item, out var parsed))
            {
                aircraft.Add(parsed);
            }
        }
        return aircraft;
    }

    private static bool TryReadAircraft(
        JsonElement item,
        out SayIntentionsTrafficAircraft aircraft)
    {
        aircraft = default!;
        if (!TryGetDouble(item, "lat", out var latitude) ||
            !TryGetDouble(item, "lon", out var longitude) ||
            latitude is < -90 or > 90 || longitude is < -180 or > 180)
        {
            return false;
        }

        var callsign = ReadTrimmedString(item, "callsign") ??
            ReadTrimmedString(item, "tail_number");
        if (string.IsNullOrWhiteSpace(callsign))
        {
            return false;
        }

        var id = TryGetInt64(item, "id", out var numericId)
            ? numericId.ToString(System.Globalization.CultureInfo.InvariantCulture)
            : callsign;
        uint? simConnectId = null;
        if (TryGetInt64(item, "simconnect_id", out var rawSimConnectId) &&
            rawSimConnectId is > 0 and <= uint.MaxValue)
        {
            simConnectId = (uint)rawSimConnectId;
        }

        var heading = TryGetDouble(item, "hdg", out var headingValue)
            ? ((headingValue % 360) + 360) % 360
            : 0;
        var altitude = TryGetDouble(item, "alt", out var altitudeValue)
            ? RoundToInt32(altitudeValue)
            : 0;
        var speed = TryGetDouble(item, "tas", out var speedValue)
            ? Math.Max(0, RoundToInt32(speedValue))
            : 0;
        var onGround = item.TryGetProperty("on_ground", out var onGroundElement) &&
            ((onGroundElement.ValueKind == JsonValueKind.True) ||
             (onGroundElement.TryGetInt32(out var onGroundValue) &&
              onGroundValue != 0));

        aircraft = new SayIntentionsTrafficAircraft(
            id,
            simConnectId,
            callsign,
            latitude,
            longitude,
            heading,
            altitude,
            speed,
            onGround,
            ReadTrimmedString(item, "type"),
            ReadTrimmedString(item, "title"));
        return true;
    }

    private static bool TryReadPositiveInt64(
        JsonElement element,
        out long value)
    {
        value = default;
        if (element.TryGetInt64(out value))
        {
            return value > 0;
        }

        return element.ValueKind == JsonValueKind.String &&
            long.TryParse(
                element.GetString(),
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out value) &&
            value > 0;
    }

    private static bool TryGetDouble(
        JsonElement element,
        string propertyName,
        out double value)
    {
        value = default;
        return element.TryGetProperty(propertyName, out var property) &&
            property.TryGetDouble(out value) &&
            double.IsFinite(value);
    }

    private static bool TryGetInt64(
        JsonElement element,
        string propertyName,
        out long value)
    {
        value = default;
        return element.TryGetProperty(propertyName, out var property) &&
            property.TryGetInt64(out value);
    }

    private static string? ReadTrimmedString(
        JsonElement element,
        string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var value = property.GetString()?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static int RoundToInt32(double value) =>
        (int)Math.Clamp(Math.Round(value), int.MinValue, int.MaxValue);

    private static SayIntentionsTrafficFeed EmptyFeed(
        DateTimeOffset now,
        bool clientConnected) =>
        new(clientConnected, false, null, now, false, []);

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        _refreshLock.Dispose();
        _httpClient.Dispose();
    }
}
