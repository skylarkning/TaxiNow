using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using TaxiNow.Server.Weather;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class AviationWeatherProviderTests
{
    [Fact]
    public async Task GetAsync_ParsesMetarTafAndSigmetFamilies()
    {
        var handler = new StubHandler((request, _) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            return Task.FromResult(path.EndsWith("/metar", StringComparison.Ordinal)
                ? JsonResponse(MetarJson)
                : path.EndsWith("/taf", StringComparison.Ordinal)
                    ? JsonResponse(TafJson)
                    : path.EndsWith("/airsigmet", StringComparison.Ordinal)
                        ? JsonResponse(AirSigmetJson)
                        : JsonResponse(InternationalSigmetJson));
        });
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Equal(2, result.CloudReports.Count);
        var metar = Assert.Single(result.CloudReports, report => report.Source == "METAR");
        Assert.Equal(600, metar.BaseFeet);
        Assert.Equal(WeatherValueKind.Observed, metar.ValueKind);
        var taf = Assert.Single(result.CloudReports, report => report.Source == "TAF");
        Assert.Equal(800, taf.BaseFeet);
        Assert.Equal(WeatherValueKind.Forecast, taf.ValueKind);

        Assert.Equal(2, result.Hazards.Count);
        Assert.Contains(result.Hazards, hazard => hazard.Source == "SIGMET" && hazard.TopFeet == 45_000);
        Assert.Contains(result.Hazards, hazard => hazard.Source == "International SIGMET" && hazard.TopFeet == 55_000);
        Assert.Empty(result.Warnings);
        Assert.Equal(4, handler.Requests.Count);
        Assert.All(handler.Requests, request =>
            Assert.Contains("format=json", request.RequestUri!.Query));
        Assert.Contains(handler.Requests, request =>
            request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal) &&
            Uri.UnescapeDataString(request.RequestUri.Query).Contains("ids=KJFK", StringComparison.Ordinal));
        Assert.All(handler.Requests, request =>
            Assert.False(string.IsNullOrWhiteSpace(request.Headers.UserAgent.ToString())));
    }

    [Fact]
    public async Task GetAsync_TreatsNoContentAsValidEmptyData()
    {
        var provider = CreateProvider(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent))));

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Empty(result.CloudReports);
        Assert.Empty(result.Hazards);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task GetAsync_ReportsPartialRateLimitWithoutRetryingOrDiscardingOtherFamilies()
    {
        var handler = new StubHandler((request, _) => Task.FromResult(
            request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal)
                ? new HttpResponseMessage(HttpStatusCode.TooManyRequests)
                : request.RequestUri.AbsolutePath.EndsWith("/taf", StringComparison.Ordinal)
                    ? JsonResponse(TafJson)
                    : new HttpResponseMessage(HttpStatusCode.NoContent)));
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Single(result.CloudReports);
        Assert.Contains(result.Warnings, warning =>
            warning.Contains("METAR", StringComparison.Ordinal) &&
            warning.Contains("rate", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(4, handler.Requests.Count);
        Assert.Single(handler.Requests, request =>
            request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetAsync_ReportsMalformedFamilyWithoutDiscardingOtherFamilies()
    {
        var handler = new StubHandler((request, _) => Task.FromResult(
            request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal)
                ? JsonResponse("not-json")
                : request.RequestUri.AbsolutePath.EndsWith("/taf", StringComparison.Ordinal)
                    ? JsonResponse(TafJson)
                    : new HttpResponseMessage(HttpStatusCode.NoContent)));
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Single(result.CloudReports);
        Assert.Contains(result.Warnings, warning =>
            warning.Contains("METAR", StringComparison.Ordinal) &&
            warning.Contains("malformed", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetAsync_ReportsProviderTimeoutSeparatelyFromCallerCancellation()
    {
        var handler = new StubHandler((request, _) =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal))
            {
                throw new TaskCanceledException("provider timeout");
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
        });
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Contains(result.Warnings, warning =>
            warning.Contains("METAR", StringComparison.Ordinal) &&
            warning.Contains("timed out", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetAsync_RejectsOversizedFamilyAsAPartialFailure()
    {
        var handler = new StubHandler((request, _) => Task.FromResult(
            request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal)
                ? JsonResponse(new string(' ', 2 * 1024 * 1024 + 1))
                : new HttpResponseMessage(HttpStatusCode.NoContent)));
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Contains(result.Warnings, warning =>
            warning.Contains("METAR", StringComparison.Ordinal) &&
            warning.Contains("two MiB", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetAsync_PropagatesCallerCancellation()
    {
        var provider = CreateProvider(new StubHandler(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            provider.GetAsync(Window(), cancellation.Token));
    }

    private static AviationWeatherProvider CreateProvider(HttpMessageHandler handler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TaxiNow:Weather:AviationBaseUrl"] = "https://aviation.test/api/data"
            })
            .Build();
        return new AviationWeatherProvider(new HttpClient(handler), configuration);
    }

    private static WeatherRouteWindow Window() => new(
        60,
        0,
        60,
        "fallback450Kt",
        [
            new TimedRouteSample("KJFK", -73.7639, 40.6392, 0, 30_000, true, DateTimeOffset.Parse("2026-10-05T12:00:00Z")),
            new TimedRouteSample("DCT", -72.8, 40.7, 60, 32_000, false, DateTimeOffset.Parse("2026-10-05T13:00:00Z"))
        ]);

    private static HttpResponseMessage JsonResponse(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private const string MetarJson = """
        [{"icaoId":"KJFK","receiptTime":"2026-10-05T11:54:08Z","obsTime":1791201060,"reportTime":"2026-10-05T12:00:00Z","lat":40.6392,"lon":-73.7639,"clouds":[{"cover":"BKN","base":600},{"cover":"BKN","base":2300}]}]
        """;

    private const string TafJson = """
        [{"icaoId":"KJFK","issueTime":"2026-10-05T11:29:00Z","validTimeFrom":1791201600,"validTimeTo":1791309600,"lat":40.6392,"lon":-73.7639,"fcsts":[{"timeFrom":1791201600,"timeTo":1791208800,"clouds":[{"cover":"SCT","base":800},{"cover":"BKN","base":2500}]}]}]
        """;

    private const string AirSigmetJson = """
        [{"icaoId":"KKCI","seriesId":"29C","validTimeFrom":1791201300,"validTimeTo":1791208500,"airSigmetType":"SIGMET","hazard":"CONVECTIVE","altitudeHi1":45000,"altitudeLow1":null,"coords":[{"lon":-74.5,"lat":40.0},{"lon":-72.0,"lat":40.0},{"lon":-72.0,"lat":41.5},{"lon":-74.5,"lat":41.5}]}]
        """;

    private const string InternationalSigmetJson = """
        [{"icaoId":"RJTD","firId":"RJJJ","validTimeFrom":1791184140,"validTimeTo":1791205740,"seriesId":"F02","hazard":"TC","base":null,"top":55000,"geom":"AREA","coords":[{"lon":147.0,"lat":23.0},{"lon":148.0,"lat":23.0},{"lon":148.0,"lat":24.0}]}]
        """;

    private sealed class StubHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response)
        : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return response(request, cancellationToken);
        }
    }
}
