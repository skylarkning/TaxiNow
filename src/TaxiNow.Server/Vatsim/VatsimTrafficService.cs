using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;

namespace TaxiNow.Server.Vatsim;

public sealed record VatsimTrafficAircraft(
    string Callsign,
    double Latitude,
    double Longitude,
    double HeadingDegrees,
    int AltitudeFeet,
    int GroundSpeedKnots,
    string? AircraftType,
    DateTimeOffset? LastUpdatedUtc);

public sealed record VatsimTrafficResponse(
    DateTimeOffset? FeedUpdatedAtUtc,
    DateTimeOffset RetrievedAtUtc,
    bool IsStale,
    int Count,
    IReadOnlyList<VatsimTrafficAircraft> Aircraft);

public readonly record struct VatsimTrafficBounds(
    double West,
    double South,
    double East,
    double North)
{
    private const double MaximumSpanDegrees = 30;

    public bool Contains(double longitude, double latitude) =>
        longitude >= West && longitude <= East &&
        latitude >= South && latitude <= North;

    public static bool TryCreate(
        double? west,
        double? south,
        double? east,
        double? north,
        out VatsimTrafficBounds bounds)
    {
        bounds = default;
        if (west is not { } westValue || south is not { } southValue ||
            east is not { } eastValue || north is not { } northValue ||
            !double.IsFinite(westValue) || !double.IsFinite(southValue) ||
            !double.IsFinite(eastValue) || !double.IsFinite(northValue) ||
            westValue < -180 || eastValue > 180 ||
            southValue < -90 || northValue > 90 ||
            westValue >= eastValue || southValue >= northValue ||
            eastValue - westValue > MaximumSpanDegrees ||
            northValue - southValue > MaximumSpanDegrees)
        {
            return false;
        }

        bounds = new VatsimTrafficBounds(
            westValue,
            southValue,
            eastValue,
            northValue);
        return true;
    }
}

public sealed record VatsimController(string Callsign, string Frequency);
public sealed record VatsimControllersResponse(DateTimeOffset? FeedUpdatedAtUtc, bool IsStale, IReadOnlyList<VatsimController> Controllers);

public sealed class VatsimTrafficService : IDisposable
{
    public static readonly Uri FeedUri =
        new("https://data.vatsim.net/v3/vatsim-data.json");
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(15);

    private readonly HttpClient _httpClient;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private CachedFeed? _cache;
    private bool _disposed;

    public VatsimTrafficService(
        HttpClient httpClient,
        TimeProvider? timeProvider = null)
    {
        _httpClient = httpClient;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public static VatsimTrafficService CreateDefault(string productVersion)
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        client.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            $"TaxiNow/{productVersion}");
        return new VatsimTrafficService(client);
    }

    public async Task<VatsimTrafficResponse> GetTrafficAsync(
        VatsimTrafficBounds bounds,
        CancellationToken cancellationToken)
    {
        var (feed, isStale) = await GetFeedAsync(cancellationToken)
            .ConfigureAwait(false);
        var aircraft = feed.Aircraft
            .Where(item => bounds.Contains(item.Longitude, item.Latitude))
            .ToArray();
        return new VatsimTrafficResponse(
            feed.FeedUpdatedAtUtc,
            feed.RetrievedAtUtc,
            isStale,
            aircraft.Length,
            aircraft);
    }

    public async Task<VatsimControllersResponse> GetControllersAsync(CancellationToken token)
    {
        var (feed, stale) = await GetFeedAsync(token).ConfigureAwait(false);
        if (feed.Controllers is null) throw new JsonException("Missing controllers array.");
        stale |= feed.FeedUpdatedAtUtc is null || _timeProvider.GetUtcNow() - feed.FeedUpdatedAtUtc > TimeSpan.FromMinutes(2);
        return new VatsimControllersResponse(feed.FeedUpdatedAtUtc, stale, feed.Controllers);
    }

    private async Task<(CachedFeed Feed, bool IsStale)> GetFeedAsync(
        CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        if (_cache is { } cached &&
            now - cached.RetrievedAtUtc < RefreshInterval)
        {
            return (cached, false);
        }

        await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            now = _timeProvider.GetUtcNow();
            if (_cache is { } refreshedByAnotherRequest &&
                now - refreshedByAnotherRequest.RetrievedAtUtc < RefreshInterval)
            {
                return (refreshedByAnotherRequest, false);
            }

            try
            {
                using var response = await _httpClient.GetAsync(
                    FeedUri,
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
                var parsed = ParseFeed(document.RootElement, now);
                _cache = parsed;
                return (parsed, false);
            }
            catch (Exception error) when (
                (error is HttpRequestException or JsonException or TaskCanceledException) &&
                !cancellationToken.IsCancellationRequested &&
                _cache is not null)
            {
                return (_cache, true);
            }
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private static CachedFeed ParseFeed(
        JsonElement root,
        DateTimeOffset retrievedAtUtc)
    {
        DateTimeOffset? updatedAtUtc = null;
        if (root.TryGetProperty("general", out var general) &&
            general.TryGetProperty("update_timestamp", out var updateElement) &&
            updateElement.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(
                updateElement.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsedUpdate))
        {
            updatedAtUtc = parsedUpdate;
        }

        var aircraft = new List<VatsimTrafficAircraft>();
        if (!root.TryGetProperty("pilots", out var pilots) ||
            pilots.ValueKind != JsonValueKind.Array)
        {
            throw new JsonException("The VATSIM feed did not include a pilots array.");
        }

        foreach (var pilot in pilots.EnumerateArray())
        {
            if (!TryReadAircraft(pilot, out var item))
            {
                continue;
            }
            aircraft.Add(item);
        }

        List<VatsimController>? controllers = null;
        if (root.TryGetProperty("controllers", out var entries) && entries.ValueKind == JsonValueKind.Array)
        {
            controllers = [];
            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("callsign", out var call) || call.ValueKind != JsonValueKind.String ||
                    !entry.TryGetProperty("frequency", out var freq) || freq.ValueKind != JsonValueKind.String) continue;
                var callsign = call.GetString()!.Trim().ToUpperInvariant();
                var frequency = freq.GetString();
                if (!(callsign.EndsWith("_CTR", StringComparison.Ordinal) || callsign.EndsWith("_FSS", StringComparison.Ordinal)) ||
                    !decimal.TryParse(frequency, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var mhz) || mhz is < 118 or >= 137) continue;
                controllers.Add(new VatsimController(callsign, mhz.ToString("F3", CultureInfo.InvariantCulture)));
            }
        }
        return new CachedFeed(updatedAtUtc, retrievedAtUtc, aircraft, controllers);
    }

    private static bool TryReadAircraft(
        JsonElement pilot,
        out VatsimTrafficAircraft aircraft)
    {
        aircraft = default!;
        if (!pilot.TryGetProperty("callsign", out var callsignElement) ||
            callsignElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(callsignElement.GetString()) ||
            !TryGetDouble(pilot, "latitude", out var latitude) ||
            !TryGetDouble(pilot, "longitude", out var longitude) ||
            !TryGetDouble(pilot, "heading", out var heading) ||
            latitude is < -90 or > 90 || longitude is < -180 or > 180)
        {
            return false;
        }

        var altitude = TryGetInt32(pilot, "altitude", out var altitudeValue)
            ? altitudeValue
            : 0;
        var groundSpeed = TryGetInt32(pilot, "groundspeed", out var speedValue)
            ? speedValue
            : 0;
        string? aircraftType = null;
        if (pilot.TryGetProperty("flight_plan", out var flightPlan) &&
            flightPlan.ValueKind == JsonValueKind.Object &&
            flightPlan.TryGetProperty("aircraft_short", out var typeElement) &&
            typeElement.ValueKind == JsonValueKind.String)
        {
            aircraftType = typeElement.GetString();
        }

        DateTimeOffset? lastUpdatedUtc = null;
        if (pilot.TryGetProperty("last_updated", out var lastUpdatedElement) &&
            lastUpdatedElement.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(
                lastUpdatedElement.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsedLastUpdated))
        {
            lastUpdatedUtc = parsedLastUpdated;
        }

        aircraft = new VatsimTrafficAircraft(
            callsignElement.GetString()!.Trim(),
            latitude,
            longitude,
            ((heading % 360) + 360) % 360,
            altitude,
            groundSpeed,
            string.IsNullOrWhiteSpace(aircraftType) ? null : aircraftType.Trim(),
            lastUpdatedUtc);
        return true;
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

    private static bool TryGetInt32(
        JsonElement element,
        string propertyName,
        out int value)
    {
        value = default;
        return element.TryGetProperty(propertyName, out var property) &&
            property.TryGetInt32(out value);
    }

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

    private sealed record CachedFeed(
        DateTimeOffset? FeedUpdatedAtUtc,
        DateTimeOffset RetrievedAtUtc,
        IReadOnlyList<VatsimTrafficAircraft> Aircraft, IReadOnlyList<VatsimController>? Controllers);
}
