using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using TaxiNow.Storage;

namespace TaxiNow.Server.Elevation;

public sealed record ElevationCoordinate(double Longitude, double Latitude);

public sealed record ElevationProfileRequest(
    IReadOnlyList<ElevationCoordinate> Route);

public sealed record ElevationSample(
    double Longitude,
    double Latitude,
    double CumulativeNauticalMiles,
    double ElevationFeet);

public sealed record ElevationProfileResponse(
    IReadOnlyList<ElevationSample> Samples,
    string CacheState,
    DateTimeOffset GeneratedAt,
    string Source,
    string Attribution);

public sealed class ElevationProfileValidationException(string message)
    : ArgumentException(message);

public sealed class ElevationProfileUnavailableException(
    string message,
    Exception? innerException = null)
    : Exception(message, innerException);

public sealed class ElevationProfileService : IDisposable
{
    public const string HttpClientName = "TaxiNow.Elevation";
    public const int MaximumSerializedRequestBytes = 256 * 1024;
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private const string DefaultBaseUrl =
        "https://api.open-meteo.com/v1/elevation";
    private const string CacheSchemaVersion = "elevation-profile-v1";
    private const string SourceName = "Open-Meteo / Copernicus DEM";
    private const string AttributionText =
        "Elevation: Open-Meteo · Copernicus DEM";
    private const int ResolutionMetres = 90;
    private const int MaximumRoutePoints = 3_000;
    private const int MaximumSamples = 600;
    private const int BatchSize = 100;
    private const int MaximumResponseBytes = 1024 * 1024;
    private const double DesiredSpacingNauticalMiles = 2;
    private const double EarthRadiusNauticalMiles = 3_440.065;
    private const double MetresToFeet = 3.28083989501312;
    private static readonly TimeSpan CacheFreshness = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    private readonly HttpClient _client;
    private readonly StoragePaths _paths;
    private readonly TimeProvider _timeProvider;
    private readonly Uri _baseUri;
    private readonly string? _apiKey;
    private readonly SemaphoreSlim _requestLock = new(1, 1);
    private bool _disposed;

    public ElevationProfileService(
        HttpClient client,
        StoragePaths paths,
        IConfiguration configuration,
        TimeProvider? timeProvider = null)
    {
        _client = client;
        _client.Timeout = RequestTimeout;
        _paths = paths;
        _timeProvider = timeProvider ?? TimeProvider.System;
        var configuredUrl = configuration["TaxiNow:Elevation:BaseUrl"];
        _baseUri = ParseBaseUri(
            string.IsNullOrWhiteSpace(configuredUrl)
                ? DefaultBaseUrl
                : configuredUrl.Trim());
        var configuredApiKey = configuration["TaxiNow:Elevation:ApiKey"];
        _apiKey = string.IsNullOrWhiteSpace(configuredApiKey)
            ? null
            : configuredApiKey;
    }

    public async Task<ElevationProfileResponse> GetAsync(
        ElevationProfileRequest request,
        CancellationToken token)
    {
        Validate(request);
        var cachePath = GetCachePath(request.Route);
        var now = _timeProvider.GetUtcNow();
        var cached = await TryReadCacheAsync(cachePath, token)
            .ConfigureAwait(false);
        if (cached is not null && IsFresh(cached, now))
        {
            return ToResponse(cached, "fresh");
        }

        await _requestLock.WaitAsync(token).ConfigureAwait(false);
        try
        {
            now = _timeProvider.GetUtcNow();
            cached = await TryReadCacheAsync(cachePath, token)
                .ConfigureAwait(false);
            if (cached is not null && IsFresh(cached, now))
            {
                return ToResponse(cached, "fresh");
            }

            var sampledRoute = SampleRoute(request.Route);
            try
            {
                var elevations = await FetchElevationsAsync(sampledRoute, token)
                    .ConfigureAwait(false);
                var samples = sampledRoute
                    .Select((point, index) => new ElevationSample(
                        point.Coordinate.Longitude,
                        point.Coordinate.Latitude,
                        point.CumulativeNauticalMiles,
                        ConvertMetresToFeet(elevations[index])))
                    .ToArray();
                var entry = new ElevationCacheEntry(
                    CacheSchemaVersion,
                    ResolutionMetres,
                    now,
                    SourceName,
                    AttributionText,
                    samples);
                await WriteCacheAsync(cachePath, entry, token)
                    .ConfigureAwait(false);
                return ToResponse(entry, "fresh");
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error) when (IsAcquisitionFailure(error))
            {
                if (cached is not null)
                {
                    return ToResponse(cached, "cachedOffline");
                }

                throw new ElevationProfileUnavailableException(
                    "Terrain elevation is temporarily unavailable.",
                    error);
            }
        }
        finally
        {
            _requestLock.Release();
        }
    }

    private static Uri ParseBaseUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp &&
             uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException(
                "TaxiNow:Elevation:BaseUrl must be an absolute HTTP or HTTPS URL.");
        }

        return uri;
    }

    private static void Validate(ElevationProfileRequest? request)
    {
        if (request?.Route is null ||
            request.Route.Count is < 2 or > MaximumRoutePoints)
        {
            throw new ElevationProfileValidationException(
                "Route must contain between 2 and 3000 coordinates.");
        }

        foreach (var coordinate in request.Route)
        {
            if (coordinate is null ||
                !double.IsFinite(coordinate.Longitude) ||
                coordinate.Longitude is < -180 or > 180 ||
                !double.IsFinite(coordinate.Latitude) ||
                coordinate.Latitude is < -90 or > 90)
            {
                throw new ElevationProfileValidationException(
                    "Route coordinates must be finite WGS84 longitude and latitude values.");
            }
        }

        if (JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions).Length >
            MaximumSerializedRequestBytes)
        {
            throw new ElevationProfileValidationException(
                "Route request must not exceed 256 KiB of UTF-8 JSON.");
        }
    }

    private string GetCachePath(IReadOnlyList<ElevationCoordinate> route)
    {
        var identity = new StringBuilder(CacheSchemaVersion).Append('\n');
        foreach (var coordinate in route)
        {
            identity
                .Append(Math.Round(
                    coordinate.Longitude,
                    5,
                    MidpointRounding.AwayFromZero).ToString(
                        "F5",
                        CultureInfo.InvariantCulture))
                .Append(',')
                .Append(Math.Round(
                    coordinate.Latitude,
                    5,
                    MidpointRounding.AwayFromZero).ToString(
                        "F5",
                        CultureInfo.InvariantCulture))
                .Append('\n');
        }

        var hash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(identity.ToString())))
            .ToLowerInvariant();
        return Path.Combine(_paths.ElevationProfilesPath, $"{hash}.json");
    }

    private async Task<double[]> FetchElevationsAsync(
        IReadOnlyList<SampledCoordinate> route,
        CancellationToken token)
    {
        var elevations = new List<double>(route.Count);
        for (var offset = 0; offset < route.Count; offset += BatchSize)
        {
            var count = Math.Min(BatchSize, route.Count - offset);
            var batch = route.Skip(offset).Take(count).ToArray();
            var parameters = new Dictionary<string, string?>
            {
                ["latitude"] = string.Join(
                    ',',
                    batch.Select(point => point.Coordinate.Latitude.ToString(
                        "G17",
                        CultureInfo.InvariantCulture))),
                ["longitude"] = string.Join(
                    ',',
                    batch.Select(point => point.Coordinate.Longitude.ToString(
                        "G17",
                        CultureInfo.InvariantCulture)))
            };
            if (_apiKey is not null)
            {
                parameters["apikey"] = _apiKey;
            }

            var requestUri = QueryHelpers.AddQueryString(
                _baseUri.AbsoluteUri,
                parameters);
            using var response = await _client.GetAsync(
                    requestUri,
                    HttpCompletionOption.ResponseHeadersRead,
                    token)
                .ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var payload = await ReadBoundedResponseAsync(response.Content, token)
                .ConfigureAwait(false);
            var batchElevations = ParseElevations(payload, count);
            elevations.AddRange(batchElevations);
        }

        return elevations.ToArray();
    }

    private static async Task<byte[]> ReadBoundedResponseAsync(
        HttpContent content,
        CancellationToken token)
    {
        if (content.Headers.ContentLength > MaximumResponseBytes)
        {
            throw new InvalidDataException(
                "Elevation response exceeds the 1 MB limit.");
        }

        await using var stream = await content.ReadAsStreamAsync(token)
            .ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[81_920];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, token).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            if (buffer.Length + read > MaximumResponseBytes)
            {
                throw new InvalidDataException(
                    "Elevation response exceeds the 1 MB limit.");
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private static double[] ParseElevations(byte[] payload, int expectedCount)
    {
        using var document = JsonDocument.Parse(payload, new JsonDocumentOptions
        {
            MaxDepth = 8
        });
        if (!document.RootElement.TryGetProperty("elevation", out var elevation) ||
            elevation.ValueKind != JsonValueKind.Array ||
            elevation.GetArrayLength() != expectedCount)
        {
            throw new InvalidDataException(
                "Elevation response does not match the requested coordinates.");
        }

        var values = new double[expectedCount];
        var index = 0;
        foreach (var value in elevation.EnumerateArray())
        {
            if (!value.TryGetDouble(out var metres) || !double.IsFinite(metres))
            {
                throw new InvalidDataException(
                    "Elevation response contains an invalid elevation.");
            }

            values[index++] = metres;
        }

        return values;
    }

    private static double ConvertMetresToFeet(double metres)
    {
        var feet = metres * MetresToFeet;
        if (!double.IsFinite(feet))
        {
            throw new InvalidDataException(
                "Elevation response contains an invalid elevation.");
        }

        return feet;
    }

    private static IReadOnlyList<SampledCoordinate> SampleRoute(
        IReadOnlyList<ElevationCoordinate> route)
    {
        var segmentDistances = new double[route.Count - 1];
        var cumulative = new double[route.Count];
        for (var index = 0; index < segmentDistances.Length; index++)
        {
            segmentDistances[index] = DistanceNauticalMiles(
                route[index],
                route[index + 1]);
            cumulative[index + 1] = cumulative[index] + segmentDistances[index];
        }

        var total = cumulative[^1];
        if (total <= double.Epsilon)
        {
            return
            [
                new SampledCoordinate(route[0], 0),
                new SampledCoordinate(route[^1], 0)
            ];
        }

        var intervalCount = Math.Min(
            MaximumSamples - 1,
            Math.Max(1, (int)Math.Ceiling(
                total / DesiredSpacingNauticalMiles)));
        var result = new List<SampledCoordinate>(intervalCount + 1);
        var segmentIndex = 0;
        for (var sampleIndex = 0; sampleIndex <= intervalCount; sampleIndex++)
        {
            var target = sampleIndex == intervalCount
                ? total
                : total * sampleIndex / intervalCount;
            while (segmentIndex < segmentDistances.Length - 1 &&
                   cumulative[segmentIndex + 1] < target)
            {
                segmentIndex++;
            }

            while (segmentIndex < segmentDistances.Length - 1 &&
                   segmentDistances[segmentIndex] <= double.Epsilon)
            {
                segmentIndex++;
            }

            var segmentDistance = segmentDistances[segmentIndex];
            var fraction = segmentDistance <= double.Epsilon
                ? 0
                : Math.Clamp(
                    (target - cumulative[segmentIndex]) / segmentDistance,
                    0,
                    1);
            var coordinate = sampleIndex switch
            {
                0 => route[0],
                _ when sampleIndex == intervalCount => route[^1],
                _ => InterpolateGreatCircle(
                    route[segmentIndex],
                    route[segmentIndex + 1],
                    fraction)
            };
            result.Add(new SampledCoordinate(coordinate, target));
        }

        return result;
    }

    private static double DistanceNauticalMiles(
        ElevationCoordinate first,
        ElevationCoordinate second)
    {
        var latitude1 = DegreesToRadians(first.Latitude);
        var latitude2 = DegreesToRadians(second.Latitude);
        var latitudeDelta = latitude2 - latitude1;
        var longitudeDelta = DegreesToRadians(
            NormalizeLongitudeDelta(second.Longitude - first.Longitude));
        var a = Math.Pow(Math.Sin(latitudeDelta / 2), 2) +
            Math.Cos(latitude1) * Math.Cos(latitude2) *
            Math.Pow(Math.Sin(longitudeDelta / 2), 2);
        var angularDistance = 2 * Math.Atan2(
            Math.Sqrt(a),
            Math.Sqrt(Math.Max(0, 1 - a)));
        return EarthRadiusNauticalMiles * angularDistance;
    }

    private static ElevationCoordinate InterpolateGreatCircle(
        ElevationCoordinate first,
        ElevationCoordinate second,
        double fraction)
    {
        var angularDistance = DistanceNauticalMiles(first, second) /
            EarthRadiusNauticalMiles;
        var sinDistance = Math.Sin(angularDistance);
        if (Math.Abs(sinDistance) < 1e-12)
        {
            var longitude = first.Longitude +
                NormalizeLongitudeDelta(second.Longitude - first.Longitude) *
                fraction;
            return new ElevationCoordinate(
                NormalizeLongitude(longitude),
                first.Latitude + (second.Latitude - first.Latitude) * fraction);
        }

        var latitude1 = DegreesToRadians(first.Latitude);
        var longitude1 = DegreesToRadians(first.Longitude);
        var latitude2 = DegreesToRadians(second.Latitude);
        var longitude2 = DegreesToRadians(second.Longitude);
        var firstWeight = Math.Sin((1 - fraction) * angularDistance) /
            sinDistance;
        var secondWeight = Math.Sin(fraction * angularDistance) /
            sinDistance;
        var x = firstWeight * Math.Cos(latitude1) * Math.Cos(longitude1) +
            secondWeight * Math.Cos(latitude2) * Math.Cos(longitude2);
        var y = firstWeight * Math.Cos(latitude1) * Math.Sin(longitude1) +
            secondWeight * Math.Cos(latitude2) * Math.Sin(longitude2);
        var z = firstWeight * Math.Sin(latitude1) +
            secondWeight * Math.Sin(latitude2);
        return new ElevationCoordinate(
            RadiansToDegrees(Math.Atan2(y, x)),
            RadiansToDegrees(Math.Atan2(z, Math.Sqrt(x * x + y * y))));
    }

    private async Task<ElevationCacheEntry?> TryReadCacheAsync(
        string path,
        CancellationToken token)
    {
        try
        {
            if (!File.Exists(path))
            {
                return null;
            }

            var info = new FileInfo(path);
            if (info.Length is <= 0 or > MaximumResponseBytes)
            {
                return null;
            }

            var bytes = await File.ReadAllBytesAsync(path, token)
                .ConfigureAwait(false);
            var entry = JsonSerializer.Deserialize<ElevationCacheEntry>(
                bytes,
                JsonOptions);
            return IsValidCacheEntry(entry) ? entry : null;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private async Task WriteCacheAsync(
        string path,
        ElevationCacheEntry entry,
        CancellationToken token)
    {
        Directory.CreateDirectory(_paths.ElevationProfilesPath);
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(entry, JsonOptions);
            await File.WriteAllBytesAsync(temporaryPath, bytes, token)
                .ConfigureAwait(false);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private static bool IsValidCacheEntry(ElevationCacheEntry? entry)
    {
        if (entry is null ||
            entry.SchemaVersion != CacheSchemaVersion ||
            entry.ResolutionMetres != ResolutionMetres ||
            entry.GeneratedAt == default ||
            entry.Source != SourceName ||
            entry.Attribution != AttributionText ||
            entry.Samples is null ||
            entry.Samples.Count is < 2 or > MaximumSamples)
        {
            return false;
        }

        var previousDistance = -1d;
        foreach (var sample in entry.Samples)
        {
            if (!double.IsFinite(sample.Longitude) ||
                sample.Longitude is < -180 or > 180 ||
                !double.IsFinite(sample.Latitude) ||
                sample.Latitude is < -90 or > 90 ||
                !double.IsFinite(sample.CumulativeNauticalMiles) ||
                sample.CumulativeNauticalMiles < previousDistance ||
                !double.IsFinite(sample.ElevationFeet))
            {
                return false;
            }

            previousDistance = sample.CumulativeNauticalMiles;
        }

        return true;
    }

    private static bool IsFresh(
        ElevationCacheEntry entry,
        DateTimeOffset now) =>
        entry.GeneratedAt <= now &&
        now - entry.GeneratedAt <= CacheFreshness;

    private static ElevationProfileResponse ToResponse(
        ElevationCacheEntry entry,
        string cacheState) =>
        new(
            entry.Samples,
            cacheState,
            entry.GeneratedAt,
            entry.Source,
            entry.Attribution);

    private static bool IsAcquisitionFailure(Exception error) =>
        error is HttpRequestException or InvalidDataException or JsonException or
            TaskCanceledException or IOException;

    private static double DegreesToRadians(double value) => value * Math.PI / 180;

    private static double RadiansToDegrees(double value) => value * 180 / Math.PI;

    private static double NormalizeLongitudeDelta(double value)
    {
        while (value > 180)
        {
            value -= 360;
        }

        while (value < -180)
        {
            value += 360;
        }

        return value;
    }

    private static double NormalizeLongitude(double value)
    {
        while (value > 180)
        {
            value -= 360;
        }

        while (value < -180)
        {
            value += 360;
        }

        return value;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _requestLock.Dispose();
        _client.Dispose();
    }

    private sealed record SampledCoordinate(
        ElevationCoordinate Coordinate,
        double CumulativeNauticalMiles);

    private sealed record ElevationCacheEntry(
        string SchemaVersion,
        int ResolutionMetres,
        DateTimeOffset GeneratedAt,
        string Source,
        string Attribution,
        IReadOnlyList<ElevationSample> Samples);
}
