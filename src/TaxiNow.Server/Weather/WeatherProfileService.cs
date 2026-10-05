using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TaxiNow.Storage;

namespace TaxiNow.Server.Weather;

public sealed class WeatherProfileService : IDisposable
{
    public const int MaximumSerializedRequestBytes = 256 * 1024;

    private const string CacheSchemaVersion = "weather-profile-v1";
    private const int MaximumCacheBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan FreshDuration = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan StaleDuration = TimeSpan.FromHours(2);
    private static readonly TimeSpan NegativeDuration = TimeSpan.FromMinutes(2);
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    private readonly IWeatherForecastProvider _forecastProvider;
    private readonly IAviationWeatherProvider _aviationProvider;
    private readonly StoragePaths _paths;
    private readonly TimeProvider _timeProvider;
    private readonly string _providerIdentity;
    private readonly ConcurrentDictionary<string, Lazy<Task<WeatherCacheEntry>>> _inFlight = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _negativeCache = new();
    private bool _disposed;

    public WeatherProfileService(
        IWeatherForecastProvider forecastProvider,
        IAviationWeatherProvider aviationProvider,
        StoragePaths paths,
        IConfiguration configuration,
        TimeProvider? timeProvider = null)
    {
        _forecastProvider = forecastProvider;
        _aviationProvider = aviationProvider;
        _paths = paths;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _providerIdentity = string.Join('|',
            configuration["TaxiNow:Weather:ForecastBaseUrl"] ?? "default-forecast",
            configuration["TaxiNow:Weather:AviationBaseUrl"] ?? "default-aviation");
    }

    public async Task<WeatherProfileResponse> GetAsync(
        WeatherProfileRequest request,
        CancellationToken token)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var now = _timeProvider.GetUtcNow();
        var window = WeatherProfileDerivation.SampleRoute(request, now);
        var key = CreateCacheKey(window);
        var cachePath = Path.Combine(_paths.WeatherProfilesPath, $"{key}.json");
        var cached = await TryReadCacheAsync(cachePath, token).ConfigureAwait(false);
        if (cached is not null && IsWithin(cached.GeneratedAt, now, FreshDuration))
        {
            return ToResponse(cached, "freshCache");
        }

        if (_negativeCache.TryGetValue(key, out var retryAt))
        {
            if (retryAt > now)
            {
                throw new WeatherProfileUnavailableException(
                    "Route weather is temporarily unavailable (negative cache).");
            }
            _negativeCache.TryRemove(key, out _);
        }

        var lazy = _inFlight.GetOrAdd(key, _ => new Lazy<Task<WeatherCacheEntry>>(
            () => AcquireAsync(key, cachePath, window),
            LazyThreadSafetyMode.ExecutionAndPublication));
        Task<WeatherCacheEntry> acquisition;
        try
        {
            acquisition = lazy.Value;
            _ = acquisition.ContinueWith(
                (_, state) =>
                {
                    var removal = ((WeatherProfileService Service, string Key,
                        Lazy<Task<WeatherCacheEntry>> Lazy))state!;
                    removal.Service._inFlight.TryRemove(
                        new KeyValuePair<string, Lazy<Task<WeatherCacheEntry>>>(
                            removal.Key,
                            removal.Lazy));
                },
                (this, key, lazy),
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }
        catch
        {
            _inFlight.TryRemove(new KeyValuePair<string, Lazy<Task<WeatherCacheEntry>>>(key, lazy));
            throw;
        }

        try
        {
            var entry = await acquisition.WaitAsync(token).ConfigureAwait(false);
            return ToResponse(entry, entry.CacheState);
        }
        finally
        {
            if (acquisition.IsCompleted)
            {
                _inFlight.TryRemove(new KeyValuePair<string, Lazy<Task<WeatherCacheEntry>>>(key, lazy));
            }
        }
    }

    private async Task<WeatherCacheEntry> AcquireAsync(
        string key,
        string cachePath,
        WeatherRouteWindow window)
    {
        var now = _timeProvider.GetUtcNow();
        var cached = await TryReadCacheAsync(cachePath, CancellationToken.None)
            .ConfigureAwait(false);
        if (cached is not null && IsWithin(cached.GeneratedAt, now, FreshDuration))
        {
            return cached with { CacheState = "freshCache" };
        }

        var forecastTask = CaptureAsync(() =>
            _forecastProvider.GetAsync(window, CancellationToken.None));
        var aviationTask = CaptureAsync(() =>
            _aviationProvider.GetAsync(window, CancellationToken.None));
        await Task.WhenAll(forecastTask, aviationTask).ConfigureAwait(false);
        var forecast = await forecastTask.ConfigureAwait(false);
        var aviation = await aviationTask.ConfigureAwait(false);

        if (forecast.Error is OperationCanceledException &&
            aviation.Error is OperationCanceledException)
        {
            throw new OperationCanceledException(
                "Weather acquisition was canceled.",
                forecast.Error);
        }

        var warnings = new List<string>();
        var sources = new List<WeatherSourceInfo>();
        IReadOnlyList<WeatherBand> bands = [];
        var forecastSucceeded = forecast.Value is not null;
        var aviationSucceeded = aviation.Value is not null;

        if (forecast.Value is not null)
        {
            bands = WeatherBandBuilder.Build(forecast.Value, window);
            sources.Add(forecast.Value.Source);
        }
        else if (forecast.Error is not null)
        {
            warnings.Add("Forecast model acquisition failed; aviation reports were used when available.");
        }

        if (aviation.Value is not null)
        {
            if (bands.Count == 0)
            {
                bands = BuildReportOnlyBands(aviation.Value, window);
            }
            else
            {
                var enriched = AviationWeatherEnrichment.Apply(bands, aviation.Value, window);
                bands = enriched.Bands;
                warnings.AddRange(enriched.Warnings);
            }
            sources.AddRange(aviation.Value.Sources);
            warnings.AddRange(aviation.Value.Warnings);
        }
        else if (aviation.Error is not null)
        {
            warnings.Add("Aviation weather acquisition failed; model forecast remains available.");
        }

        var hasUsableAcquisition = forecastSucceeded ||
            (aviationSucceeded && bands.Count > 0);
        if (!hasUsableAcquisition)
        {
            if (cached is not null && IsWithin(cached.GeneratedAt, now, StaleDuration))
            {
                return cached with
                {
                    CacheState = "stale",
                    Warnings = cached.Warnings
                        .Concat(["Stale weather cache is shown because providers are unavailable."])
                        .Distinct(StringComparer.Ordinal)
                        .ToArray()
                };
            }

            if (forecast.Error is not OperationCanceledException &&
                aviation.Error is not OperationCanceledException)
            {
                _negativeCache[key] = now + NegativeDuration;
            }
            if (forecast.Error is OperationCanceledException ||
                aviation.Error is OperationCanceledException)
            {
                throw new OperationCanceledException("Weather acquisition was canceled.");
            }
            throw new WeatherProfileUnavailableException(
                "Route weather is temporarily unavailable.",
                forecast.Error ?? aviation.Error);
        }

        var partial = !forecastSucceeded || !aviationSucceeded ||
            (aviation.Value?.Warnings.Count ?? 0) > 0;
        if (partial)
        {
            warnings.Add("Weather profile is partial because one or more sources were unavailable.");
        }
        var entry = new WeatherCacheEntry(
            CacheSchemaVersion,
            now,
            window.Samples.Count == 0 ? null : window.Samples.Min(sample => sample.ValidAt),
            window.Samples.Count == 0 ? null : window.Samples.Max(sample => sample.ValidAt),
            window.StartDistanceNm,
            window.EndDistanceNm,
            window.EtaBasis,
            partial ? "partial" : "fresh",
            bands,
            sources
                .GroupBy(source => new { source.Name, source.Attribution })
                .Select(group => group.First())
                .ToArray(),
            warnings.Distinct(StringComparer.Ordinal).ToArray());

        try
        {
            await WriteCacheAsync(cachePath, entry, CancellationToken.None)
                .ConfigureAwait(false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Fresh acquisition remains usable when persistence is unavailable.
        }
        _negativeCache.TryRemove(key, out _);
        return entry;
    }

    private static async Task<Outcome<T>> CaptureAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return new Outcome<T>(await action().ConfigureAwait(false), null);
        }
        catch (Exception error) when (error is not StackOverflowException and not OutOfMemoryException)
        {
            return new Outcome<T>(default, error);
        }
    }

    private static IReadOnlyList<WeatherBand> BuildReportOnlyBands(
        AviationWeatherData reports,
        WeatherRouteWindow window)
    {
        var bands = new List<WeatherBand>();
        var serial = 0;
        foreach (var report in reports.CloudReports)
        {
            var columns = window.Samples
                .Where(sample => sample.ValidAt >= report.ValidFrom && sample.ValidAt <= report.ValidTo)
                .Where(sample => DistanceNm(sample.Latitude, sample.Longitude, report.Latitude, report.Longitude) <= 25)
                .Select(sample => new WeatherBandColumn(
                    sample.Longitude, sample.Latitude, sample.DistanceNm, sample.ValidAt,
                    null, null, report.BaseFeet, null, sample.PlannedAltitudeFeet))
                .ToArray();
            if (columns.Length == 0 || report.BaseFeet is null)
            {
                continue;
            }
            bands.Add(new WeatherBand(
                $"report-cloud-{serial++}",
                WeatherFeatureKind.Cloud,
                WeatherIntensity.None,
                WeatherPathRelation.Unknown,
                report.ValueKind == WeatherValueKind.Observed
                    ? WeatherConfidence.High
                    : WeatherConfidence.Medium,
                report.ValueKind,
                columns,
                report.Source));
        }
        foreach (var hazard in reports.Hazards)
        {
            if (hazard.BaseFeet is null && hazard.TopFeet is null)
            {
                continue;
            }
            var columns = window.Samples
                .Where(sample => sample.ValidAt >= hazard.ValidFrom && sample.ValidAt <= hazard.ValidTo)
                .Where(sample => PointInPolygon(sample.Longitude, sample.Latitude, hazard.Polygon))
                .Select(sample => new WeatherBandColumn(
                    sample.Longitude, sample.Latitude, sample.DistanceNm, sample.ValidAt,
                    null, null, hazard.BaseFeet, hazard.TopFeet, sample.PlannedAltitudeFeet))
                .ToArray();
            if (columns.Length == 0)
            {
                continue;
            }
            bands.Add(new WeatherBand(
                $"report-hazard-{serial++}",
                WeatherFeatureKind.Convective,
                WeatherIntensity.Strong,
                WeatherPathRelation.Unknown,
                WeatherConfidence.High,
                WeatherValueKind.Forecast,
                columns,
                hazard.Source));
        }
        return bands;
    }

    private string CreateCacheKey(WeatherRouteWindow window)
    {
        var identity = new StringBuilder(CacheSchemaVersion)
            .Append('|').Append(_providerIdentity)
            .Append('|').Append(window.EtaBasis).AppendLine();
        foreach (var sample in window.Samples)
        {
            identity
                .Append(Math.Round(sample.Longitude, 4).ToString("F4", CultureInfo.InvariantCulture)).Append(',')
                .Append(Math.Round(sample.Latitude, 4).ToString("F4", CultureInfo.InvariantCulture)).Append(',')
                .Append(Math.Round(sample.DistanceNm, 1).ToString("F1", CultureInfo.InvariantCulture)).Append(',')
                .Append(sample.PlannedAltitudeFeet is null
                    ? "null"
                    : (Math.Round(sample.PlannedAltitudeFeet.Value / 100) * 100).ToString("F0", CultureInfo.InvariantCulture)).Append(',')
                .Append(sample.ValidAt.UtcDateTime.ToString("yyyyMMddHH", CultureInfo.InvariantCulture))
                .AppendLine();
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity.ToString())))
            .ToLowerInvariant();
    }

    private async Task<WeatherCacheEntry?> TryReadCacheAsync(string path, CancellationToken token)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var info = new FileInfo(path);
            if (info.Length is <= 0 or > MaximumCacheBytes) return null;
            var bytes = await File.ReadAllBytesAsync(path, token).ConfigureAwait(false);
            var entry = JsonSerializer.Deserialize<WeatherCacheEntry>(bytes, JsonOptions);
            return IsValid(entry) ? entry : null;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private async Task WriteCacheAsync(string path, WeatherCacheEntry entry, CancellationToken token)
    {
        Directory.CreateDirectory(_paths.WeatherProfilesPath);
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(entry, JsonOptions);
            if (bytes.Length > MaximumCacheBytes)
            {
                throw new IOException("Weather cache entry exceeded four MiB.");
            }
            await File.WriteAllBytesAsync(temporaryPath, bytes, token).ConfigureAwait(false);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static bool IsValid(WeatherCacheEntry? entry) =>
        entry is not null &&
        entry.SchemaVersion == CacheSchemaVersion &&
        entry.GeneratedAt != default &&
        double.IsFinite(entry.StartDistanceNm) &&
        double.IsFinite(entry.EndDistanceNm) &&
        entry.StartDistanceNm >= 0 &&
        entry.EndDistanceNm >= entry.StartDistanceNm &&
        entry.Bands is not null &&
        entry.Sources is not null &&
        entry.Warnings is not null;

    private static bool IsWithin(DateTimeOffset generatedAt, DateTimeOffset now, TimeSpan duration) =>
        generatedAt <= now && now - generatedAt <= duration;

    private static WeatherProfileResponse ToResponse(WeatherCacheEntry entry, string cacheState) => new(
        entry.StartDistanceNm,
        entry.EndDistanceNm,
        entry.GeneratedAt,
        entry.ValidFrom,
        entry.ValidTo,
        entry.EtaBasis,
        cacheState,
        entry.Bands,
        entry.Sources,
        entry.Warnings);

    private static double DistanceNm(double lat1, double lon1, double lat2, double lon2)
    {
        const double radius = 3_440.065;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var first = lat1 * Math.PI / 180;
        var second = lat2 * Math.PI / 180;
        var a = Math.Pow(Math.Sin(dLat / 2), 2) +
            Math.Cos(first) * Math.Cos(second) * Math.Pow(Math.Sin(dLon / 2), 2);
        return radius * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(Math.Max(0, 1 - a)));
    }

    private static bool PointInPolygon(double longitude, double latitude, IReadOnlyList<WeatherCoordinate> polygon)
    {
        if (polygon.Count < 3) return false;
        var inside = false;
        for (int current = 0, previous = polygon.Count - 1; current < polygon.Count; previous = current++)
        {
            var a = polygon[current];
            var b = polygon[previous];
            if ((a.Latitude > latitude) != (b.Latitude > latitude) &&
                longitude < (b.Longitude - a.Longitude) * (latitude - a.Latitude) /
                    (b.Latitude - a.Latitude) + a.Longitude)
            {
                inside = !inside;
            }
        }
        return inside;
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _inFlight.Clear();
        _negativeCache.Clear();
    }

    private sealed record Outcome<T>(T? Value, Exception? Error);

    private sealed record WeatherCacheEntry(
        string SchemaVersion,
        DateTimeOffset GeneratedAt,
        DateTimeOffset? ValidFrom,
        DateTimeOffset? ValidTo,
        double StartDistanceNm,
        double EndDistanceNm,
        string EtaBasis,
        string CacheState,
        IReadOnlyList<WeatherBand> Bands,
        IReadOnlyList<WeatherSourceInfo> Sources,
        IReadOnlyList<string> Warnings);
}
