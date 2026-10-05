using TaxiNow.Server.Weather;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class AviationWeatherEnrichmentTests
{
    private static readonly DateTimeOffset ValidAt = DateTimeOffset.Parse("2026-10-05T12:00:00Z");

    [Fact]
    public void Apply_UsesNearbyCurrentMetarForBaseWithoutInventingATop()
    {
        var input = Band(baseFeet: 1_000, topFeet: null);
        var data = Data(clouds:
        [
            new AviationCloudReport(
                "KJFK", -73.7639, 40.6392,
                ValidAt.AddMinutes(-30), ValidAt.AddMinutes(90),
                600, WeatherValueKind.Observed, "METAR")
        ]);

        var result = AviationWeatherEnrichment.Apply([input], data, Window());

        var band = Assert.Single(result.Bands);
        var column = Assert.Single(band.Columns);
        Assert.Equal(600, column.BaseFeet);
        Assert.Equal(1_000, column.OriginalBaseFeet);
        Assert.Null(column.TopFeet);
        Assert.Null(column.OriginalTopFeet);
        Assert.Equal(WeatherValueKind.Observed, band.ValueKind);
        Assert.Equal(WeatherConfidence.High, band.Confidence);
        Assert.Contains("METAR", band.Source);
    }

    [Fact]
    public void Apply_UsesTafOnlyInsideItsForecastPeriod()
    {
        var current = new AviationCloudReport(
            "KJFK", -73.7639, 40.6392,
            ValidAt.AddHours(-1), ValidAt.AddHours(1),
            800, WeatherValueKind.Forecast, "TAF");
        var expired = current with
        {
            ValidFrom = ValidAt.AddHours(-3),
            ValidTo = ValidAt.AddHours(-2),
            BaseFeet = 400
        };

        var result = AviationWeatherEnrichment.Apply(
            [Band(1_000, 8_000)],
            Data(clouds: [expired, current]),
            Window());

        var band = Assert.Single(result.Bands);
        Assert.Equal(800, Assert.Single(band.Columns).BaseFeet);
        Assert.Equal(WeatherValueKind.Forecast, band.ValueKind);
        Assert.Contains(result.Warnings, warning =>
            warning.Contains("expired", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Apply_UsesValidIntersectingSigmetExplicitTop()
    {
        var hazard = new AviationHazardReport(
            "29C", "CONVECTIVE",
            ValidAt.AddMinutes(-15), ValidAt.AddHours(2),
            null, 45_000,
            [
                new WeatherCoordinate(-74.5, 40.0),
                new WeatherCoordinate(-72.0, 40.0),
                new WeatherCoordinate(-72.0, 41.5),
                new WeatherCoordinate(-74.5, 41.5)
            ],
            "SIGMET");

        var result = AviationWeatherEnrichment.Apply(
            [Band(1_000, 8_000)],
            Data(hazards: [hazard]),
            Window());

        var band = Assert.Single(result.Bands);
        var column = Assert.Single(band.Columns);
        Assert.Equal(45_000, column.TopFeet);
        Assert.Equal(8_000, column.OriginalTopFeet);
        Assert.Equal(WeatherConfidence.High, band.Confidence);
        Assert.Contains("SIGMET", band.Source);
    }

    [Fact]
    public void Apply_LeavesForecastUntouchedForExpiredOrNonIntersectingHazards()
    {
        var expired = new AviationHazardReport(
            "OLD", "CONVECTIVE",
            ValidAt.AddHours(-3), ValidAt.AddHours(-2),
            null, 45_000,
            [
                new WeatherCoordinate(-74.5, 40.0),
                new WeatherCoordinate(-72.0, 40.0),
                new WeatherCoordinate(-72.0, 41.5)
            ],
            "SIGMET");
        var away = expired with
        {
            Id = "AWAY",
            ValidFrom = ValidAt.AddHours(-1),
            ValidTo = ValidAt.AddHours(1),
            Polygon =
            [
                new WeatherCoordinate(10, 10),
                new WeatherCoordinate(11, 10),
                new WeatherCoordinate(11, 11)
            ]
        };

        var result = AviationWeatherEnrichment.Apply(
            [Band(1_000, 8_000)],
            Data(hazards: [expired, away]),
            Window());

        var band = Assert.Single(result.Bands);
        Assert.Equal(8_000, Assert.Single(band.Columns).TopFeet);
        Assert.Equal("Open-Meteo", band.Source);
        Assert.Contains(result.Warnings, warning =>
            warning.Contains("expired", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Apply_DoesNotUseACloudReportFarFromTheAirportColumn()
    {
        var report = new AviationCloudReport(
            "KJFK", -120, 35,
            ValidAt.AddMinutes(-30), ValidAt.AddMinutes(30),
            500, WeatherValueKind.Observed, "METAR");

        var result = AviationWeatherEnrichment.Apply(
            [Band(1_000, 8_000)],
            Data(clouds: [report]),
            Window());

        var band = Assert.Single(result.Bands);
        Assert.Equal(1_000, Assert.Single(band.Columns).BaseFeet);
        Assert.Equal("Open-Meteo", band.Source);
    }

    [Fact]
    public void Apply_DoesNotInventUnknownSigmetBounds()
    {
        var hazard = new AviationHazardReport(
            "UNKNOWN", "CONVECTIVE",
            ValidAt.AddMinutes(-30), ValidAt.AddMinutes(30),
            null, null,
            [
                new WeatherCoordinate(-74.5, 40.0),
                new WeatherCoordinate(-72.0, 40.0),
                new WeatherCoordinate(-72.0, 41.5)
            ],
            "SIGMET");

        var result = AviationWeatherEnrichment.Apply(
            [Band(null, null)],
            Data(hazards: [hazard]),
            Window());

        var band = Assert.Single(result.Bands);
        var column = Assert.Single(band.Columns);
        Assert.Null(column.BaseFeet);
        Assert.Null(column.TopFeet);
        Assert.Null(column.OriginalBaseFeet);
        Assert.Null(column.OriginalTopFeet);
        Assert.Equal("Open-Meteo", band.Source);
    }

    private static WeatherBand Band(double? baseFeet, double? topFeet) => new(
        "cloud-0",
        WeatherFeatureKind.Cloud,
        WeatherIntensity.None,
        WeatherPathRelation.OffPath,
        WeatherConfidence.Medium,
        WeatherValueKind.Forecast,
        [
            new WeatherBandColumn(
                -73.7639, 40.6392, 0, ValidAt,
                baseFeet, topFeet, baseFeet, topFeet, 30_000)
        ],
        "Open-Meteo");

    private static AviationWeatherData Data(
        IReadOnlyList<AviationCloudReport>? clouds = null,
        IReadOnlyList<AviationHazardReport>? hazards = null) => new(
        clouds ?? [],
        hazards ?? [],
        [new WeatherSourceInfo("AviationWeather.gov", "NOAA Aviation Weather Center", ValidAt, null, null)],
        []);

    private static WeatherRouteWindow Window() => new(
        60, 0, 60, "fallback450Kt",
        [new TimedRouteSample("KJFK", -73.7639, 40.6392, 0, 30_000, true, ValidAt)]);
}
