using System.Net;
using System.Text;
using TaxiNow.Server.SayIntentions;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class SayIntentionsTrafficServiceTests
{
    private const string FlightJson = """
        {
          "flight_details": {
            "flight_id": 883016523,
            "api_key": "must-not-leave-the-service",
            "Email": "private@example.com"
          }
        }
        """;

    private const string TrafficJson = """
        [
          {
            "id": 47418,
            "simconnect_id": 1331200009,
            "callsign": "RYR41YE",
            "tail_number": "EI-ABC",
            "lat": 39.5512,
            "lon": 2.7388,
            "hdg": 367.5,
            "alt": 31.7,
            "tas": 12.4,
            "type": "B738 ",
            "title": "FSLTL B738 Ryanair",
            "on_ground": 1
          },
          {
            "id": 47419,
            "callsign": "BADPOS",
            "lat": 190,
            "lon": 2.7
          }
        ]
        """;

    [Fact]
    public async Task Traffic_UsesLocalFlightIdAndOfficialCallsigns()
    {
        var handler = new SayIntentionsHandler(FlightJson, TrafficJson);
        var time = new MutableTimeProvider(
            new DateTimeOffset(2026, 9, 14, 12, 0, 0, TimeSpan.Zero));
        using var service = new SayIntentionsTrafficService(
            new HttpClient(handler),
            time);

        var first = await service.GetTrafficAsync(CancellationToken.None);
        var cached = await service.GetTrafficAsync(CancellationToken.None);

        Assert.Equal(2, handler.CallCount);
        Assert.True(first.ClientConnected);
        Assert.True(first.ActiveFlight);
        Assert.Equal(883016523, first.FlightId);
        Assert.False(first.IsStale);
        var aircraft = Assert.Single(first.Aircraft);
        Assert.Equal("47418", aircraft.Id);
        Assert.Equal(1331200009u, aircraft.SimConnectId);
        Assert.Equal("RYR41YE", aircraft.Callsign);
        Assert.Equal(7.5, aircraft.HeadingDegrees);
        Assert.Equal(32, aircraft.AltitudeFeet);
        Assert.Equal(12, aircraft.GroundSpeedKnots);
        Assert.True(aircraft.OnGround);
        Assert.Equal("B738", aircraft.AircraftType);
        Assert.Same(first, cached);
        Assert.Equal(
            new Uri("https://tracker.sayintentions.ai/traffic/883016523"),
            handler.Requests[1]);
    }

    [Fact]
    public async Task MissingLocalClient_ReturnsAnInactiveEmptyFeed()
    {
        using var service = new SayIntentionsTrafficService(
            new HttpClient(new OfflineHandler()));

        var feed = await service.GetTrafficAsync(CancellationToken.None);

        Assert.False(feed.ClientConnected);
        Assert.False(feed.ActiveFlight);
        Assert.Null(feed.FlightId);
        Assert.Empty(feed.Aircraft);
    }

    [Fact]
    public async Task TrackerFailure_ReturnsMatchingCachedFlightAsStale()
    {
        var handler = new SayIntentionsHandler(
            FlightJson,
            TrafficJson,
            failSecondTrackerRequest: true);
        var time = new MutableTimeProvider(
            new DateTimeOffset(2026, 9, 14, 12, 0, 0, TimeSpan.Zero));
        using var service = new SayIntentionsTrafficService(
            new HttpClient(handler),
            time);

        var fresh = await service.GetTrafficAsync(CancellationToken.None);
        time.Advance(TimeSpan.FromSeconds(61));
        var stale = await service.GetTrafficAsync(CancellationToken.None);
        var cachedStale = await service.GetTrafficAsync(CancellationToken.None);

        Assert.False(fresh.IsStale);
        Assert.True(stale.IsStale);
        Assert.True(cachedStale.IsStale);
        Assert.Equal(fresh.Aircraft, stale.Aircraft);
        Assert.Equal(4, handler.CallCount);
    }

    private sealed class SayIntentionsHandler(
        string flightJson,
        string trafficJson,
        bool failSecondTrackerRequest = false) : HttpMessageHandler
    {
        private int _trackerCalls;
        public int CallCount { get; private set; }
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            Requests.Add(request.RequestUri!);
            if (request.RequestUri == SayIntentionsTrafficService.FlightJsonUri)
            {
                return Json(flightJson);
            }

            _trackerCalls++;
            if (failSecondTrackerRequest && _trackerCalls > 1)
            {
                throw new HttpRequestException("Tracker unavailable.");
            }
            return Json(trafficJson);
        }

        private static Task<HttpResponseMessage> Json(string json) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
    }

    private sealed class OfflineHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            throw new HttpRequestException("Connection refused.");
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now += duration;
    }
}
