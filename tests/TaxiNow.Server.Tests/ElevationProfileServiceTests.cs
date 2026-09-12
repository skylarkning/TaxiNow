using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TaxiNow.Server.Elevation;
using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class ElevationProfileServiceTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 12, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetAsync_BatchesAtOneHundredCoordinates()
    {
        using var fixture = new ServiceFixture();
        var route = Enumerable.Range(0, 201)
            .Select(index => new ElevationCoordinate(-79, -3.33 + index * 0.0333))
            .ToArray();

        var result = await fixture.Service.GetAsync(
            new ElevationProfileRequest(route),
            CancellationToken.None);

        Assert.Equal(201, result.Samples.Count);
        Assert.Equal(new[] { 100, 100, 1 }, fixture.Handler.BatchSizes);
        Assert.Equal(32.8083989501312, result.Samples[0].ElevationFeet, 10);
        Assert.Equal("fresh", result.CacheState);
        Assert.Equal("Open-Meteo / Copernicus DEM", result.Source);
        Assert.Equal("Elevation: Open-Meteo · Copernicus DEM", result.Attribution);
        Assert.Equal(Now, result.GeneratedAt);
        Assert.Equal(0, result.Samples[0].CumulativeNauticalMiles);
        Assert.True(result.Samples[^1].CumulativeNauticalMiles > 399);
    }

    [Fact]
    public async Task GetAsync_AdaptivelyResamplesLongRouteWithoutTruncatingTail()
    {
        using var fixture = new ServiceFixture();
        var route = new[]
        {
            new ElevationCoordinate(-20, 0),
            new ElevationCoordinate(0, 0),
            new ElevationCoordinate(20, 0)
        };

        var result = await fixture.Service.GetAsync(
            new ElevationProfileRequest(route),
            CancellationToken.None);

        Assert.Equal(600, result.Samples.Count);
        Assert.Equal(-20, result.Samples[0].Longitude, 10);
        Assert.Equal(20, result.Samples[^1].Longitude, 10);
        Assert.Equal(6, fixture.Handler.BatchSizes.Count);
        Assert.All(fixture.Handler.BatchSizes, size => Assert.InRange(size, 1, 100));
    }

    [Fact]
    public async Task GetAsync_ReturnsFreshCacheWithoutNetwork()
    {
        using var fixture = new ServiceFixture();
        var request = SimpleRequest();
        var fresh = await fixture.Service.GetAsync(request, CancellationToken.None);
        var offlineHandler = new RecordingHandler { Failure = new HttpRequestException("offline") };
        using var cachedService = fixture.CreateService(offlineHandler);

        var cached = await cachedService.GetAsync(request, CancellationToken.None);

        Assert.Equal(0, offlineHandler.CallCount);
        Assert.Equal("fresh", cached.CacheState);
        Assert.Equal(fresh.GeneratedAt, cached.GeneratedAt);
        Assert.Equal(fresh.Samples, cached.Samples);
    }

    [Fact]
    public async Task GetAsync_ReturnsStaleCacheWhenNetworkFails()
    {
        using var fixture = new ServiceFixture();
        var request = SimpleRequest();
        var fresh = await fixture.Service.GetAsync(request, CancellationToken.None);
        fixture.Time.Advance(TimeSpan.FromDays(31));
        var offlineHandler = new RecordingHandler { Failure = new HttpRequestException("offline") };
        using var cachedService = fixture.CreateService(offlineHandler);

        var cached = await cachedService.GetAsync(request, CancellationToken.None);

        Assert.Equal(1, offlineHandler.CallCount);
        Assert.Equal("cachedOffline", cached.CacheState);
        Assert.Equal(fresh.GeneratedAt, cached.GeneratedAt);
        Assert.Equal(fresh.Attribution, cached.Attribution);
        Assert.Equal(fresh.Samples, cached.Samples);
    }

    [Fact]
    public async Task GetAsync_ReturnsFreshTerrainWhenCachePersistenceFails()
    {
        using var fixture = new ServiceFixture();
        var request = SimpleRequest();
        var stale = await fixture.Service.GetAsync(request, CancellationToken.None);
        fixture.Time.Advance(TimeSpan.FromDays(31));
        var freshHandler = new RecordingHandler
        {
            ElevationValue = 20,
            BeforeResponse = () =>
            {
                Directory.Delete(
                    fixture.Paths.ElevationProfilesPath,
                    recursive: true);
                File.WriteAllText(
                    fixture.Paths.ElevationProfilesPath,
                    "blocks cache directory creation");
            }
        };
        using var freshService = fixture.CreateService(freshHandler);

        var result = await freshService.GetAsync(request, CancellationToken.None);

        Assert.Equal("fresh", result.CacheState);
        Assert.Equal(1, freshHandler.CallCount);
        Assert.NotEqual(stale.GeneratedAt, result.GeneratedAt);
        Assert.NotEqual(stale.Samples, result.Samples);
        Assert.Equal(65.6167979002624, result.Samples[0].ElevationFeet, 10);
    }

    [Fact]
    public async Task GetAsync_RejectsMismatchedElevationCount()
    {
        using var fixture = new ServiceFixture(
            new RecordingHandler { ElevationCountAdjustment = -1 });

        await Assert.ThrowsAsync<ElevationProfileUnavailableException>(() =>
            fixture.Service.GetAsync(SimpleRequest(), CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_RejectsElevationThatOverflowsFeet()
    {
        using var fixture = new ServiceFixture(
            new RecordingHandler { ElevationValue = 1e308 });

        await Assert.ThrowsAsync<ElevationProfileUnavailableException>(() =>
            fixture.Service.GetAsync(SimpleRequest(), CancellationToken.None));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3001)]
    public async Task GetAsync_RejectsInvalidRoutePointCount(int count)
    {
        using var fixture = new ServiceFixture();
        var route = Enumerable.Repeat(new ElevationCoordinate(-79, 43), count).ToArray();

        await Assert.ThrowsAsync<ElevationProfileValidationException>(() =>
            fixture.Service.GetAsync(
                new ElevationProfileRequest(route),
                CancellationToken.None));

        Assert.Equal(0, fixture.Handler.CallCount);
    }

    [Theory]
    [InlineData(double.NaN, 43)]
    [InlineData(-181, 43)]
    [InlineData(-79, double.PositiveInfinity)]
    [InlineData(-79, 91)]
    public async Task GetAsync_RejectsInvalidCoordinates(double longitude, double latitude)
    {
        using var fixture = new ServiceFixture();
        var request = new ElevationProfileRequest(
            [new ElevationCoordinate(-79, 43), new ElevationCoordinate(longitude, latitude)]);

        await Assert.ThrowsAsync<ElevationProfileValidationException>(() =>
            fixture.Service.GetAsync(request, CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_RejectsNullCoordinate()
    {
        using var fixture = new ServiceFixture();
        var request = new ElevationProfileRequest(
            [new ElevationCoordinate(-79, 43), null!]);

        await Assert.ThrowsAsync<ElevationProfileValidationException>(() =>
            fixture.Service.GetAsync(request, CancellationToken.None));

        Assert.Equal(0, fixture.Handler.CallCount);
    }

    [Fact]
    public async Task GetAsync_SendsConfiguredApiKeyWithoutPersistingOrReturningIt()
    {
        const string apiKey = "private key+/=";
        using var fixture = new ServiceFixture(apiKey: apiKey);

        var result = await fixture.Service.GetAsync(SimpleRequest(), CancellationToken.None);

        Assert.Contains("apikey=private%20key%2B%2F%3D", fixture.Handler.Urls.Single().Query);
        Assert.DoesNotContain(apiKey, JsonSerializer.Serialize(result));
        var cacheJson = await File.ReadAllTextAsync(
            Assert.Single(Directory.EnumerateFiles(fixture.Paths.ElevationProfilesPath)),
            TestContext.Current.CancellationToken);
        Assert.DoesNotContain(apiKey, cacheJson);
        Assert.Contains("Copernicus DEM", cacheJson);
        Assert.Contains("90", cacheJson);
    }

    private static ElevationProfileRequest SimpleRequest() => new(
        [new ElevationCoordinate(-79, 43), new ElevationCoordinate(-78.98, 43.02)]);

    private sealed class ServiceFixture : IDisposable
    {
        private readonly string _root;
        private readonly IConfiguration _configuration;

        public ServiceFixture(RecordingHandler? handler = null, string? apiKey = null)
        {
            _root = Path.Combine(
                Path.GetTempPath(),
                "TaxiNow.Tests",
                Guid.NewGuid().ToString("N"));
            Paths = new StoragePaths(_root);
            Paths.EnsureCreated();
            Handler = handler ?? new RecordingHandler();
            Time = new MutableTimeProvider(Now);
            var values = new Dictionary<string, string?>
            {
                ["TaxiNow:Elevation:BaseUrl"] = "https://elevation.test/v1/elevation",
                ["TaxiNow:Elevation:ApiKey"] = apiKey
            };
            _configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(values)
                .Build();
            Service = CreateService(Handler);
        }

        public StoragePaths Paths { get; }
        public RecordingHandler Handler { get; }
        public MutableTimeProvider Time { get; }
        public ElevationProfileService Service { get; }

        public ElevationProfileService CreateService(RecordingHandler handler) =>
            new(new HttpClient(handler), Paths, _configuration, Time);

        public void Dispose()
        {
            Service.Dispose();
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<Uri> Urls { get; } = [];
        public List<int> BatchSizes { get; } = [];
        public Exception? Failure { get; init; }
        public int ElevationCountAdjustment { get; init; }
        public double? ElevationValue { get; init; }
        public Action? BeforeResponse { get; init; }
        public int CallCount => Urls.Count;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Urls.Add(request.RequestUri!);
            if (Failure is not null)
            {
                throw Failure;
            }

            BeforeResponse?.Invoke();
            var query = ParseQuery(request.RequestUri!.Query);
            var count = query["latitude"].Split(',').Length;
            BatchSizes.Add(count);
            var elevations = Enumerable.Range(0, count + ElevationCountAdjustment)
                .Select(index => ElevationValue ?? 10d + index)
                .ToArray();
            var json = JsonSerializer.Serialize(new { elevation = elevations });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }

        private static Dictionary<string, string> ParseQuery(string query) =>
            query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Split('=', 2))
                .ToDictionary(
                    part => Uri.UnescapeDataString(part[0]),
                    part => Uri.UnescapeDataString(part[1]));
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now += duration;
    }

}
