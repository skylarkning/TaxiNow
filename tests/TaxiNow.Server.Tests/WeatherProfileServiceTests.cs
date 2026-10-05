using Microsoft.Extensions.Configuration;
using TaxiNow.Server.Weather;
using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class WeatherProfileServiceTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-06T00:00:00Z");

    [Fact]
    public async Task GetAsync_ReturnsFreshCacheForFifteenMinutes()
    {
        using var fixture = new Fixture();

        var first = await fixture.Service.GetAsync(Request(), CancellationToken.None);
        fixture.Time.Advance(TimeSpan.FromMinutes(14));
        var second = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        Assert.Equal("fresh", first.CacheState);
        Assert.Equal("freshCache", second.CacheState);
        Assert.Equal(1, fixture.Forecast.CallCount);
        Assert.Equal(1, fixture.Aviation.CallCount);
        Assert.Equal(first.Bands.Count, second.Bands.Count);
        Assert.Equal(first.Bands[0].Columns[0], second.Bands[0].Columns[0]);
    }

    [Fact]
    public async Task GetAsync_ReturnsStaleCacheOnFailureOnlyThroughTwoHours()
    {
        using var fixture = new Fixture();
        var fresh = await fixture.Service.GetAsync(Request(), CancellationToken.None);
        fixture.Time.Advance(TimeSpan.FromMinutes(16));
        fixture.Forecast.Failure = new WeatherProviderException("offline");
        fixture.Aviation.Failure = new HttpRequestException("offline");

        var stale = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        Assert.Equal("stale", stale.CacheState);
        Assert.Equal(fresh.GeneratedAt, stale.GeneratedAt);
        Assert.Contains(stale.Warnings, warning => warning.Contains("stale", StringComparison.OrdinalIgnoreCase));

        fixture.Time.Advance(TimeSpan.FromHours(2));
        await Assert.ThrowsAsync<WeatherProfileUnavailableException>(() =>
            fixture.Service.GetAsync(Request(), CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_UsesTwoMinuteNegativeCacheAfterTotalFailure()
    {
        using var fixture = new Fixture(forecastFailure: new WeatherProviderException("offline"), aviationFailure: new HttpRequestException("offline"));

        await Assert.ThrowsAsync<WeatherProfileUnavailableException>(() =>
            fixture.Service.GetAsync(Request(), CancellationToken.None));
        await Assert.ThrowsAsync<WeatherProfileUnavailableException>(() =>
            fixture.Service.GetAsync(Request(), CancellationToken.None));

        Assert.Equal(1, fixture.Forecast.CallCount);
        Assert.Equal(1, fixture.Aviation.CallCount);

        fixture.Time.Advance(TimeSpan.FromMinutes(3));
        await Assert.ThrowsAsync<WeatherProfileUnavailableException>(() =>
            fixture.Service.GetAsync(Request(), CancellationToken.None));
        Assert.Equal(2, fixture.Forecast.CallCount);
        Assert.Equal(2, fixture.Aviation.CallCount);
    }

    [Fact]
    public async Task GetAsync_DoesNotNegativeCacheCancellation()
    {
        using var fixture = new Fixture(
            forecastFailure: new OperationCanceledException(),
            aviationFailure: new OperationCanceledException());

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            fixture.Service.GetAsync(Request(), CancellationToken.None));
        fixture.Forecast.Failure = null;
        fixture.Aviation.Failure = null;

        var result = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        Assert.Equal("fresh", result.CacheState);
        Assert.Equal(2, fixture.Forecast.CallCount);
        Assert.Equal(2, fixture.Aviation.CallCount);
    }

    [Fact]
    public async Task GetAsync_SharesOneInFlightAcquisitionForIdenticalKeys()
    {
        using var fixture = new Fixture();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.Forecast.BeforeResult = () => release.Task;
        fixture.Aviation.BeforeResult = () => release.Task;

        var first = fixture.Service.GetAsync(Request(), CancellationToken.None);
        var second = fixture.Service.GetAsync(Request(), CancellationToken.None);
        await WaitUntilAsync(() => fixture.Forecast.CallCount == 1 && fixture.Aviation.CallCount == 1);
        release.SetResult();
        await Task.WhenAll(first, second);

        Assert.Equal(1, fixture.Forecast.CallCount);
        Assert.Equal(1, fixture.Aviation.CallCount);
    }

    [Fact]
    public async Task GetAsync_RemovesSharedAcquisitionAfterWaitingCallerCancels()
    {
        using var fixture = new Fixture();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.Forecast.BeforeResult = () => release.Task;
        fixture.Aviation.BeforeResult = () => release.Task;
        using var cancellation = new CancellationTokenSource();
        var abandoned = fixture.Service.GetAsync(Request(), cancellation.Token);
        await WaitUntilAsync(() => fixture.Forecast.CallCount == 1 && fixture.Aviation.CallCount == 1);

        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => abandoned);
        release.SetResult();
        await WaitUntilAsync(() => Directory.GetFiles(fixture.Paths.WeatherProfilesPath, "*.json").Length == 1);
        fixture.Forecast.Failure = new WeatherProviderException("offline");
        fixture.Aviation.Failure = new HttpRequestException("offline");
        fixture.Time.Advance(TimeSpan.FromMinutes(16));

        var result = await fixture.Service.GetAsync(Request(), CancellationToken.None);
        Assert.Equal("stale", result.CacheState);
        Assert.Equal(2, fixture.Forecast.CallCount);
        Assert.Equal(2, fixture.Aviation.CallCount);
    }

    [Fact]
    public async Task GetAsync_ReturnsForecastOnlyPartialSuccess()
    {
        using var fixture = new Fixture(aviationFailure: new HttpRequestException("offline"));

        var result = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        Assert.NotEmpty(result.Bands);
        Assert.Equal("partial", result.CacheState);
        Assert.Contains(result.Warnings, warning => warning.Contains("aviation", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetAsync_ReturnsReportOnlyPartialSuccess()
    {
        var report = new AviationCloudReport(
            "KJFK", -73.7639, 40.6392,
            Now.AddMinutes(-30), Now.AddMinutes(90),
            700, WeatherValueKind.Observed, "METAR");
        using var fixture = new Fixture(
            forecastFailure: new WeatherProviderException("offline"),
            aviationData: Aviation([report]));

        var result = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        var band = Assert.Single(result.Bands);
        Assert.Equal("partial", result.CacheState);
        Assert.Equal(700, Assert.Single(band.Columns).BaseFeet);
        Assert.Null(band.Columns[0].OriginalBaseFeet);
        Assert.Equal(WeatherValueKind.Observed, band.ValueKind);
    }

    [Fact]
    public async Task GetAsync_AtomicallyReplacesCacheWithoutLeavingTemporaryFiles()
    {
        using var fixture = new Fixture();
        await fixture.Service.GetAsync(Request(), CancellationToken.None);
        fixture.Time.Advance(TimeSpan.FromMinutes(16));
        fixture.Forecast.CloudBaseMetres = 2_000;

        var refreshed = await fixture.Service.GetAsync(Request(), CancellationToken.None);

        Assert.Equal("fresh", refreshed.CacheState);
        var files = Directory.GetFiles(fixture.Paths.WeatherProfilesPath);
        Assert.Single(files);
        Assert.EndsWith(".json", files[0], StringComparison.Ordinal);
        Assert.DoesNotContain(files, file => file.EndsWith(".tmp", StringComparison.Ordinal));
        Assert.Contains("weather-profile-v1", await File.ReadAllTextAsync(files[0], TestContext.Current.CancellationToken));
    }

    private static WeatherProfileRequest Request() => new(
        [
            new WeatherRoutePoint("KJFK", -73.7639, 40.6392, 30_000, true),
            new WeatherRoutePoint("KBOS", -71.0096, 42.3656, 32_000, true)
        ],
        0, 450, Now, 2_400);

    private static AviationWeatherData Aviation(IReadOnlyList<AviationCloudReport>? reports = null) => new(
        reports ?? [], [],
        [new WeatherSourceInfo("AviationWeather.gov", "NOAA Aviation Weather Center", Now, null, null)],
        []);

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition())
        {
            await Task.Delay(10, timeout.Token);
        }
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root;

        public Fixture(
            Exception? forecastFailure = null,
            Exception? aviationFailure = null,
            AviationWeatherData? aviationData = null)
        {
            _root = Path.Combine(Path.GetTempPath(), "TaxiNow.Tests", Guid.NewGuid().ToString("N"));
            Paths = new StoragePaths(_root);
            Paths.EnsureCreated();
            Time = new MutableTimeProvider(Now);
            Forecast = new FakeForecastProvider { Failure = forecastFailure };
            Aviation = new FakeAviationProvider(aviationData ?? WeatherProfileServiceTests.Aviation())
            {
                Failure = aviationFailure
            };
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TaxiNow:Weather:ForecastBaseUrl"] = "https://forecast.test/v1/forecast",
                    ["TaxiNow:Weather:AviationBaseUrl"] = "https://aviation.test/api/data"
                })
                .Build();
            Service = new WeatherProfileService(Forecast, Aviation, Paths, configuration, Time);
        }

        public StoragePaths Paths { get; }
        public MutableTimeProvider Time { get; }
        public FakeForecastProvider Forecast { get; }
        public FakeAviationProvider Aviation { get; }
        public WeatherProfileService Service { get; }

        public void Dispose()
        {
            Service.Dispose();
            if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        }
    }

    private sealed class FakeForecastProvider : IWeatherForecastProvider
    {
        private int _callCount;
        public int CallCount => Volatile.Read(ref _callCount);
        public Exception? Failure { get; set; }
        public Func<Task>? BeforeResult { get; set; }
        public double CloudBaseMetres { get; set; } = 1_000;

        public async Task<ForecastProfileData> GetAsync(WeatherRouteWindow window, CancellationToken token)
        {
            Interlocked.Increment(ref _callCount);
            if (BeforeResult is not null) await BeforeResult();
            if (Failure is not null) throw Failure;
            var columns = window.Samples.Select(sample => new ForecastColumn(
                sample,
                [
                    new ForecastLevel(925, 20, CloudBaseMetres - 500),
                    new ForecastLevel(850, 80, CloudBaseMetres),
                    new ForecastLevel(700, 20, CloudBaseMetres + 1_000)
                ],
                2.5, 0, 63, 500)).ToArray();
            return new ForecastProfileData(columns,
                new WeatherSourceInfo("Open-Meteo", "Weather: Open-Meteo", Now,
                    window.Samples.Min(sample => sample.ValidAt),
                    window.Samples.Max(sample => sample.ValidAt)));
        }
    }

    private sealed class FakeAviationProvider(AviationWeatherData data) : IAviationWeatherProvider
    {
        private int _callCount;
        public int CallCount => Volatile.Read(ref _callCount);
        public Exception? Failure { get; set; }
        public Func<Task>? BeforeResult { get; set; }

        public async Task<AviationWeatherData> GetAsync(WeatherRouteWindow window, CancellationToken token)
        {
            Interlocked.Increment(ref _callCount);
            if (BeforeResult is not null) await BeforeResult();
            if (Failure is not null) throw Failure;
            return data;
        }
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan duration) => _now += duration;
    }
}
