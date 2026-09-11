using System.Net;
using System.Text;
using TaxiNow.Server.Gnss;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class GnssInterferenceServiceTests
{
    private const string Page = """
        <h2 class="center">impacted FIRs in the last 7 days on 09/09/2026</h2>
        <table class="table easa-table"><thead><tr><th>rank</th></tr></thead><tbody>
        <tr class="eur-row"><td class="col-rank">1</td><td class="col-region">EUR</td><td class="col-icao">LTAA</td><td class="col-name">ANKARA</td><td class="col-spoofing">&nbsp;</td><td class="col-reported">*</td></tr>
        <tr class="eur-row"><td class="col-rank">2</td><td class="col-region">EUR</td><td class="col-icao">EPWW</td><td class="col-name">WARSZAWA</td><td class="col-spoofing">*</td><td class="col-reported">*</td></tr>
        </tbody></table>
        <h2 class="center">impacted FIRs in the last 30 days on 09/09/2026</h2>
        <table><tbody><tr><td class="col-rank">1</td><td class="col-region">MID</td><td class="col-icao">OMAE</td><td class="col-name">EMIRATES</td><td class="col-spoofing">*</td><td class="col-reported">*</td></tr></tbody></table>
        """;

    [Fact]
    public async Task Feed_ParsesOnlyTheSevenDayTableAndCachesIt()
    {
        var handler = new CountingHandler(Page);
        var time = new MutableTimeProvider(new DateTimeOffset(2026, 9, 11, 0, 0, 0, TimeSpan.Zero));
        using var service = new GnssInterferenceService(new HttpClient(handler), time);

        var first = await service.GetAsync(CancellationToken.None);
        var cached = await service.GetAsync(CancellationToken.None);

        Assert.Equal(1, handler.CallCount);
        Assert.False(first.IsStale);
        Assert.Equal(new DateOnly(2026, 9, 9), first.ObservedOn);
        Assert.Equal(2, first.Regions.Count);
        Assert.Equal(new GnssInterferenceRegion(1, "EUR", "LTAA", "ANKARA", false, true), first.Regions[0]);
        Assert.Equal(new GnssInterferenceRegion(2, "EUR", "EPWW", "WARSZAWA", true, true), first.Regions[1]);
        Assert.DoesNotContain(first.Regions, region => region.Icao == "OMAE");
        Assert.Equal(first, cached);
    }

    [Fact]
    public async Task Feed_ReturnsCachedDataAsStaleWhenRefreshFails()
    {
        var handler = new SucceedsOnceHandler(Page);
        var time = new MutableTimeProvider(new DateTimeOffset(2026, 9, 11, 0, 0, 0, TimeSpan.Zero));
        using var service = new GnssInterferenceService(new HttpClient(handler), time);
        var first = await service.GetAsync(CancellationToken.None);
        time.Advance(TimeSpan.FromHours(7));

        var stale = await service.GetAsync(CancellationToken.None);

        Assert.True(stale.IsStale);
        Assert.Equal(first.Regions, stale.Regions);
        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task Feed_ReturnsBundledSnapshotAsStaleWhenFirstRefreshFails()
    {
        var fallback = new GnssInterferenceResponse(
            new DateOnly(2026, 9, 9),
            new DateTimeOffset(2026, 9, 9, 12, 0, 0, TimeSpan.Zero),
            false,
            [new GnssInterferenceRegion(1, "EUR", "LTAA", "ANKARA", false, true)]);
        using var service = new GnssInterferenceService(
            new HttpClient(new AlwaysFailsHandler()),
            fallback: fallback);

        var result = await service.GetAsync(CancellationToken.None);

        Assert.True(result.IsStale);
        Assert.Equal(fallback.ObservedOn, result.ObservedOn);
        Assert.Equal(fallback.Regions, result.Regions);
    }

    private sealed class CountingHandler(string html) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            Assert.Equal(GnssInterferenceService.SourceUri, request.RequestUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") });
        }
    }

    private sealed class SucceedsOnceHandler(string html) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            if (CallCount > 1) throw new HttpRequestException("Offline");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") });
        }
    }

    private sealed class AlwaysFailsHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("Offline");
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan duration) => _now += duration;
    }
}
