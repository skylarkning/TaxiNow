using TaxiNow.Server.Weather;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class WeatherBandBuilderTests
{
    [Fact]
    public void Build_InterpolatesTheSixtyPercentCloudBoundary()
    {
        var forecast = Forecast([
            Column(0, 35_000, [
                Level(1000, 40, 0),
                Level(925, 80, 1_000),
                Level(850, 80, 2_000),
                Level(700, 40, 3_000)
            ])
        ]);

        var band = Assert.Single(WeatherBandBuilder.Build(forecast, Window(0)));

        Assert.Equal(WeatherFeatureKind.Cloud, band.Kind);
        Assert.Equal(WeatherConfidence.High, band.Confidence);
        var column = Assert.Single(band.Columns);
        Assert.InRange(column.BaseFeet!.Value, 1_640, 1_641);
        Assert.InRange(column.TopFeet!.Value, 8_202, 8_203);
        Assert.Equal(column.BaseFeet, column.OriginalBaseFeet);
        Assert.Equal(column.TopFeet, column.OriginalTopFeet);
    }

    [Fact]
    public void Build_PreservesSeparateDecksAndMarksSingleLevelLowConfidence()
    {
        var bands = WeatherBandBuilder.Build(Forecast([
            Column(0, 20_000, [
                Level(1000, 70, 0),
                Level(925, 70, 1_000),
                Level(850, 20, 2_000),
                Level(700, 75, 3_000),
                Level(600, 20, 4_000)
            ])
        ]), Window(0));

        Assert.Equal(2, bands.Count);
        Assert.Contains(bands, band => band.Confidence == WeatherConfidence.Low);
        Assert.Contains(bands, band => band.Columns[0].BaseFeet is null);
    }

    [Fact]
    public void Build_RetainsUnknownTopInsteadOfInventingABoundary()
    {
        var band = Assert.Single(WeatherBandBuilder.Build(Forecast([
            Column(0, 20_000, [
                Level(850, 20, 2_000),
                Level(700, 70, 3_000),
                Level(600, 80, 4_000)
            ])
        ]), Window(0)));

        Assert.NotNull(band.Columns[0].BaseFeet);
        Assert.Null(band.Columns[0].TopFeet);
        Assert.Equal(WeatherPathRelation.Unknown, band.PathRelation);
    }

    [Fact]
    public void Build_SplitsMatchingLayersAcrossGapsGreaterThanFiftyNm()
    {
        var bands = WeatherBandBuilder.Build(Forecast([
            Column(0, 10_000, [Level(1000, 20, 0), Level(925, 80, 1_000), Level(850, 20, 2_000)]),
            Column(75, 10_000, [Level(1000, 20, 0), Level(925, 80, 1_000), Level(850, 20, 2_000)])
        ]), Window(0, 75));

        Assert.Equal(2, bands.Count);
        Assert.All(bands, band => Assert.Single(band.Columns));
    }

    [Theory]
    [InlineData(0, 0, 0, WeatherIntensity.None)]
    [InlineData(0.1, 0, 0, WeatherIntensity.Weak)]
    [InlineData(2.5, 0, 0, WeatherIntensity.Moderate)]
    [InlineData(10, 0, 0, WeatherIntensity.Strong)]
    [InlineData(0, 0, 95, WeatherIntensity.Strong)]
    public void NormalizeIntensity_UsesOneProviderBoundary(
        double precipitation,
        double showers,
        int weatherCode,
        WeatherIntensity expected)
    {
        Assert.Equal(
            expected,
            WeatherBandBuilder.NormalizeIntensity(
                precipitation,
                showers,
                weatherCode,
                capeJoulesPerKilogram: 500));
    }

    [Fact]
    public void Build_EmitsPrecipitationBandsWithOnAndOffPathRelations()
    {
        var bands = WeatherBandBuilder.Build(Forecast([
            Column(0, 8_000, [Level(1000, 20, 0), Level(925, 80, 1_000), Level(850, 20, 2_000)], precipitation: 3),
            Column(25, 35_000, [Level(1000, 20, 0), Level(925, 80, 1_000), Level(850, 20, 2_000)], precipitation: 12)
        ]), Window(0, 25));

        var precipitation = bands.Where(band => band.Kind == WeatherFeatureKind.Precipitation).ToArray();
        Assert.Equal(2, precipitation.Length);
        Assert.Contains(precipitation, band => band.Intensity == WeatherIntensity.Moderate && band.PathRelation == WeatherPathRelation.OnPath);
        Assert.Contains(precipitation, band => band.Intensity == WeatherIntensity.Strong && band.PathRelation == WeatherPathRelation.OffPath);
    }

    private static ForecastProfileData Forecast(IReadOnlyList<ForecastColumn> columns) => new(
        columns,
        new WeatherSourceInfo(
            "Open-Meteo",
            "Weather: Open-Meteo",
            DateTimeOffset.Parse("2026-10-05T12:00:00Z"),
            columns.Min(column => column.RouteSample.ValidAt),
            columns.Max(column => column.RouteSample.ValidAt)));

    private static ForecastColumn Column(
        double distanceNm,
        double plannedAltitudeFeet,
        IReadOnlyList<ForecastLevel> levels,
        double precipitation = 0,
        double showers = 0,
        int weatherCode = 0) => new(
        new TimedRouteSample(
            null,
            distanceNm / 60,
            0,
            distanceNm,
            plannedAltitudeFeet,
            false,
            DateTimeOffset.Parse("2026-10-05T12:00:00Z").AddMinutes(distanceNm)),
        levels,
        precipitation,
        showers,
        weatherCode,
        500);

    private static ForecastLevel Level(
        int pressureHpa,
        double cover,
        double heightMetres) =>
        new(pressureHpa, cover, heightMetres);

    private static WeatherRouteWindow Window(params double[] distances) => new(
        distances.Length == 0 ? 0 : distances[^1],
        distances.Length == 0 ? 0 : distances[0],
        distances.Length == 0 ? 0 : distances[^1],
        "fallback450Kt",
        distances.Select(distance => new TimedRouteSample(
            null,
            distance / 60,
            0,
            distance,
            10_000,
            false,
            DateTimeOffset.Parse("2026-10-05T12:00:00Z").AddMinutes(distance))).ToArray());
}
