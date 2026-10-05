using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using TaxiNow.Server.Weather;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class OpenMeteoWeatherProviderTests
{
    [Fact]
    public async Task GetAsync_BatchesLocationsAndSelectsEachSamplesForecastHour()
    {
        var handler = new StubHandler((request, _) =>
            Task.FromResult(JsonResponse("""
                [
                  {
                    "latitude": 0,
                    "longitude": 0,
                    "hourly": {
                      "time": ["2026-10-05T12:00", "2026-10-05T13:00"],
                      "cloud_cover_1000hPa": [20, 21],
                      "geopotential_height_1000hPa": [100, 110],
                      "cloud_cover_850hPa": [70, 71],
                      "geopotential_height_850hPa": [1500, 1510],
                      "precipitation": [1.2, 1.3],
                      "showers": [0.4, 0.5],
                      "weather_code": [61, 63],
                      "cape": [300, 350]
                    }
                  },
                  {
                    "latitude": 0,
                    "longitude": 1,
                    "hourly": {
                      "time": ["2026-10-05T12:00", "2026-10-05T13:00"],
                      "cloud_cover_1000hPa": [30, 31],
                      "geopotential_height_1000hPa": [120, 130],
                      "cloud_cover_850hPa": [80, 81],
                      "geopotential_height_850hPa": [1520, 1530],
                      "precipitation": [2.2, 2.3],
                      "showers": [1.4, 1.5],
                      "weather_code": [80, 81],
                      "cape": [500, 550]
                    }
                  }
                ]
                """)));
        var provider = CreateProvider(handler);

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Equal(2, result.Columns.Count);
        Assert.Equal(20, result.Columns[0].Levels.Single(level => level.PressureHpa == 1000).CloudCoverPercent);
        Assert.Equal(1_500, result.Columns[0].Levels.Single(level => level.PressureHpa == 850).GeopotentialHeightMetres);
        Assert.Equal(2.3, result.Columns[1].PrecipitationMillimetres);
        Assert.Equal(550, result.Columns[1].CapeJoulesPerKilogram);
        Assert.Equal("Open-Meteo", result.Source.Name);
        Assert.Contains("Open-Meteo", result.Source.Attribution);

        var uri = Assert.Single(handler.Requests).RequestUri!;
        var query = Uri.UnescapeDataString(uri.Query);
        Assert.Contains("latitude=0,0", query);
        Assert.Contains("longitude=0,1", query);
        Assert.Contains("cloud_cover_1000hPa", query);
        Assert.Contains("geopotential_height_850hPa", query);
        Assert.Contains("timezone=UTC", query);
    }

    [Fact]
    public async Task GetAsync_TreatsNoContentAsAValidEmptyForecast()
    {
        var provider = CreateProvider(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent))));

        var result = await provider.GetAsync(Window(), CancellationToken.None);

        Assert.Empty(result.Columns);
        Assert.Equal("Open-Meteo", result.Source.Name);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("[{\"hourly\":{\"time\":[\"2026-10-05T12:00\"],\"cloud_cover_1000hPa\":[],\"geopotential_height_1000hPa\":[100]}}]")]
    public async Task GetAsync_RejectsMalformedOrMisalignedPayloads(string body)
    {
        var provider = CreateProvider(new StubHandler((_, _) =>
            Task.FromResult(JsonResponse(body))));

        await Assert.ThrowsAsync<WeatherProviderException>(() =>
            provider.GetAsync(Window(), CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_RejectsResponsesOverTwoMebibytes()
    {
        var provider = CreateProvider(new StubHandler((_, _) =>
            Task.FromResult(JsonResponse(new string(' ', 2 * 1024 * 1024 + 1)))));

        await Assert.ThrowsAsync<WeatherProviderException>(() =>
            provider.GetAsync(Window(), CancellationToken.None));
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

    private static OpenMeteoWeatherProvider CreateProvider(HttpMessageHandler handler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TaxiNow:Weather:ForecastBaseUrl"] = "https://forecast.test/v1/forecast"
            })
            .Build();
        return new OpenMeteoWeatherProvider(new HttpClient(handler), configuration);
    }

    private static WeatherRouteWindow Window() => new(
        60,
        0,
        60,
        "fallback450Kt",
        [
            new TimedRouteSample("START", 0, 0, 0, 30_000, true, DateTimeOffset.Parse("2026-10-05T12:00:00Z")),
            new TimedRouteSample("END", 1, 0, 60, 32_000, true, DateTimeOffset.Parse("2026-10-05T13:00:00Z"))
        ]);

    private static HttpResponseMessage JsonResponse(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

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
