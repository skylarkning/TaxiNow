using System.Net;
using System.Text;
using TaxiNow.Server.Vatsim;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class VatsimTrafficServiceTests
{
    private const string FeedJson = """
        {
          "general": {
            "update_timestamp": "2026-08-30T12:00:00Z"
          },
          "pilots": [
            {
              "cid": 1234567,
              "name": "Private Person",
              "callsign": "ACA123",
              "latitude": 43.6801,
              "longitude": -79.6202,
              "altitude": 572,
              "groundspeed": 14,
              "heading": 367,
              "flight_plan": {
                "aircraft_short": "A320",
                "departure": "cyyz",
                "arrival": "cyvr"
              },
              "last_updated": "2026-08-30T12:00:00Z"
            },
            {
              "cid": 7654321,
              "name": "Another Person",
              "callsign": "BAW99",
              "latitude": 51.4700,
              "longitude": -0.4543,
              "altitude": 83,
              "groundspeed": 0,
              "heading": 90,
              "flight_plan": null,
              "last_updated": "2026-08-30T12:00:00Z"
            }
          ]
        }
        """;

    [Fact]
    public async Task Controllers_ExposeOnlyAreaRadioFieldsAndRejectInvalidFrequencies()
    {
        const string json = """
            {"general":{"update_timestamp":"2026-08-30T12:00:00Z"},"pilots":[],"controllers":[
            {"callsign":"TOR_CTR","frequency":"128.3","name":"Private Name","cid":123},
            {"callsign":"TOR_N_CTR","frequency":"199.999"},
            {"callsign":"CYYZ_TWR","frequency":"118.700"}]}
            """;
        var handler = new CountingHandler(json);
        var time = new MutableTimeProvider(new DateTimeOffset(2026, 8, 30, 12, 0, 1, TimeSpan.Zero));
        using var service = new VatsimTrafficService(new HttpClient(handler), time);
        var result = await service.GetControllersAsync(CancellationToken.None);
        Assert.False(result.IsStale);
        Assert.Equal(new VatsimController("TOR_CTR", "128.300"), Assert.Single(result.Controllers));
        var serialized = System.Text.Json.JsonSerializer.Serialize(result);
        Assert.DoesNotContain("Private Name", serialized);
        Assert.DoesNotContain("cid", serialized);
        time.Advance(TimeSpan.FromMinutes(3));
        Assert.True((await service.GetControllersAsync(CancellationToken.None)).IsStale);
    }

    [Fact]
    public async Task Traffic_IsFilteredAndCachedForTheOfficialFeedInterval()
    {
        var handler = new CountingHandler(FeedJson);
        var time = new MutableTimeProvider(
            new DateTimeOffset(2026, 8, 30, 12, 0, 1, TimeSpan.Zero));
        using var service = new VatsimTrafficService(
            new HttpClient(handler),
            time);
        var bounds = new VatsimTrafficBounds(-80, 43, -79, 44);

        var first = await service.GetTrafficAsync(bounds, CancellationToken.None);
        var cached = await service.GetTrafficAsync(bounds, CancellationToken.None);

        Assert.Equal(1, handler.CallCount);
        Assert.False(first.IsStale);
        Assert.Equal(1, first.Count);
        var aircraft = Assert.Single(first.Aircraft);
        Assert.Equal("ACA123", aircraft.Callsign);
        Assert.Equal(7, aircraft.HeadingDegrees);
        Assert.Equal("A320", aircraft.AircraftType);
        Assert.Equal("CYYZ", aircraft.DepartureAirport);
        Assert.Equal("CYVR", aircraft.ArrivalAirport);
        Assert.Equal(first.FeedUpdatedAtUtc, cached.FeedUpdatedAtUtc);
        Assert.Equal(first.RetrievedAtUtc, cached.RetrievedAtUtc);
        Assert.Equal(first.IsStale, cached.IsStale);
        Assert.Equal(first.Aircraft, cached.Aircraft);

        time.Advance(TimeSpan.FromSeconds(16));
        await service.GetTrafficAsync(bounds, CancellationToken.None);

        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task GlobalTraffic_ReturnsEveryAircraftWithoutPersonalFields()
    {
        var handler = new CountingHandler(FeedJson);
        var time = new MutableTimeProvider(
            new DateTimeOffset(2026, 8, 30, 12, 0, 1, TimeSpan.Zero));
        using var service = new VatsimTrafficService(new HttpClient(handler), time);

        var result = await service.GetAllTrafficAsync(CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Equal(new[] { "ACA123", "BAW99" }, result.Aircraft.Select(item => item.Callsign));
        var serialized = System.Text.Json.JsonSerializer.Serialize(result);
        Assert.DoesNotContain("Private Person", serialized);
        Assert.DoesNotContain("Another Person", serialized);
        Assert.DoesNotContain("cid", serialized, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null, 43d, -79d, 44d)]
    [InlineData(-200d, 43d, -79d, 44d)]
    [InlineData(-80d, 44d, -79d, 43d)]
    [InlineData(-80d, 43d, -40d, 44d)]
    public void Bounds_RejectMissingOrUnreasonablyLargeQueries(
        double? west,
        double? south,
        double? east,
        double? north)
    {
        Assert.False(VatsimTrafficBounds.TryCreate(
            west,
            south,
            east,
            north,
            out _));
    }

    [Fact]
    public async Task RefreshFailure_ReturnsTheLastSuccessfulFeedAsStale()
    {
        var handler = new SucceedsOnceHandler(FeedJson);
        var time = new MutableTimeProvider(
            new DateTimeOffset(2026, 8, 30, 12, 0, 1, TimeSpan.Zero));
        using var service = new VatsimTrafficService(
            new HttpClient(handler),
            time);
        var bounds = new VatsimTrafficBounds(-80, 43, -79, 44);

        var fresh = await service.GetTrafficAsync(bounds, CancellationToken.None);
        time.Advance(TimeSpan.FromSeconds(16));
        var stale = await service.GetTrafficAsync(bounds, CancellationToken.None);

        Assert.False(fresh.IsStale);
        Assert.True(stale.IsStale);
        Assert.Equal(fresh.RetrievedAtUtc, stale.RetrievedAtUtc);
        Assert.Equal(fresh.Aircraft, stale.Aircraft);
        Assert.Equal(2, handler.CallCount);
    }

    private sealed class CountingHandler(string json) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            Assert.Equal(VatsimTrafficService.FeedUri, request.RequestUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class SucceedsOnceHandler(string json) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            if (CallCount > 1)
            {
                throw new HttpRequestException("The test feed is unavailable.");
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now += duration;
    }
}
