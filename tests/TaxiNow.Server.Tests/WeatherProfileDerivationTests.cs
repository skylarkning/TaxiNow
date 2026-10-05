using TaxiNow.Server.Weather;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class WeatherProfileDerivationTests
{
    private static readonly DateTimeOffset Now =
        DateTimeOffset.Parse("2026-10-05T12:00:00Z");

    [Fact]
    public void SampleRoute_LimitsTheWindowToFiveHundredNmAndThirtyTwoSamples()
    {
        var window = WeatherProfileDerivation.SampleRoute(
            Request([Point(0), Point(10)]),
            Now);

        Assert.Equal(0, window.StartDistanceNm, 6);
        Assert.Equal(500, window.EndDistanceNm, 6);
        Assert.InRange(window.Samples.Count, 2, 32);
        Assert.Equal(0, window.Samples[0].DistanceNm, 6);
        Assert.Equal(500, window.Samples[^1].DistanceNm, 6);
        Assert.All(
            window.Samples.Zip(window.Samples.Skip(1)),
            pair => Assert.True(pair.First.DistanceNm < pair.Second.DistanceNm));
    }

    [Fact]
    public void SampleRoute_StartsAtCurrentDistanceAndIncludesCriticalAltitudePoints()
    {
        var window = WeatherProfileDerivation.SampleRoute(
            Request(
                [
                    Point(0, altitude: 10_000),
                    Point(2.5, altitude: 34_000, critical: true, ident: "STEP1"),
                    Point(10, altitude: 36_000)
                ],
                currentDistanceNm: 100),
            Now);

        Assert.Equal(100, window.StartDistanceNm, 6);
        Assert.Equal(600, window.EndDistanceNm, 6);
        var critical = Assert.Single(window.Samples, sample => sample.Critical);
        Assert.Equal("STEP1", critical.Ident);
        Assert.InRange(critical.DistanceNm, 149.5, 150.7);
        Assert.Equal(34_000, critical.PlannedAltitudeFeet);
    }

    [Fact]
    public void SampleRoute_UsesScheduledAverageThenLiveSpeedThenFourHundredFiftyKnots()
    {
        var scheduled = WeatherProfileDerivation.SampleRoute(
            Request(
                [Point(0), Point(10)],
                groundSpeedKnots: 250,
                departureTimeUtc: Now,
                estimatedEnrouteSeconds: 7_200),
            Now);
        Assert.Equal("scheduled", scheduled.EtaBasis);
        Assert.InRange(
            (scheduled.Samples[^1].ValidAt - Now.AddSeconds(5_995.96)).TotalSeconds,
            -0.01,
            0.01);

        var live = WeatherProfileDerivation.SampleRoute(
            Request([Point(0), Point(10)], groundSpeedKnots: 250),
            Now);
        Assert.Equal("liveGroundSpeed", live.EtaBasis);
        Assert.Equal(Now.AddHours(2), live.Samples[^1].ValidAt);

        foreach (var invalidSpeed in new double?[] { null, -1, 0, 49, 751 })
        {
            var fallback = WeatherProfileDerivation.SampleRoute(
                Request([Point(0), Point(10)], groundSpeedKnots: invalidSpeed),
                Now);
            Assert.Equal("fallback450Kt", fallback.EtaBasis);
            Assert.Equal(
                Now.AddSeconds(500d / 450d * 3600d),
                fallback.Samples[^1].ValidAt);
        }
    }

    [Fact]
    public void SampleRoute_NormalizesDatelineDuplicateAndZeroLengthLegs()
    {
        var window = WeatherProfileDerivation.SampleRoute(
            Request([Point(179), Point(179), Point(-179)]),
            Now);

        Assert.InRange(window.EndDistanceNm, 119, 121);
        Assert.All(window.Samples, sample =>
        {
            Assert.True(double.IsFinite(sample.Longitude));
            Assert.True(double.IsFinite(sample.Latitude));
            Assert.InRange(sample.Longitude, -180, 180);
            Assert.InRange(sample.Latitude, -90, 90);
        });
        Assert.All(
            window.Samples.Zip(window.Samples.Skip(1)),
            pair => Assert.True(pair.First.DistanceNm < pair.Second.DistanceNm));
    }

    [Theory]
    [InlineData(35_000d, 31_000d, 33_000d, WeatherPathRelation.OnPath)]
    [InlineData(35_000d, 5_000d, 20_000d, WeatherPathRelation.OffPath)]
    [InlineData(35_000d, null, 20_000d, WeatherPathRelation.Unknown)]
    [InlineData(35_000d, 31_000d, null, WeatherPathRelation.Unknown)]
    public void ClassifyPathRelation_UsesTheFourThousandFootEnvelope(
        double plannedAltitudeFeet,
        double? baseFeet,
        double? topFeet,
        WeatherPathRelation expected)
    {
        Assert.Equal(
            expected,
            WeatherProfileDerivation.ClassifyPathRelation(
                plannedAltitudeFeet,
                baseFeet,
                topFeet));
    }

    [Fact]
    public void SampleRoute_RejectsInvalidOrOversizedRequests()
    {
        Assert.Throws<WeatherProfileValidationException>(() =>
            WeatherProfileDerivation.SampleRoute(
                Request(Enumerable.Range(0, 201).Select(index => Point(index / 10d)).ToArray()),
                Now));
        Assert.Throws<WeatherProfileValidationException>(() =>
            WeatherProfileDerivation.SampleRoute(Request([Point(0), Point(1, latitude: 91)]), Now));
        Assert.Throws<WeatherProfileValidationException>(() =>
            WeatherProfileDerivation.SampleRoute(Request([Point(0), Point(1, altitude: 100_001)]), Now));
        Assert.Throws<WeatherProfileValidationException>(() =>
            WeatherProfileDerivation.SampleRoute(Request([Point(0), Point(180), Point(0)]), Now));

        var largeIdent = new string('X', 2_000);
        var oversized = Enumerable.Range(0, 200)
            .Select(index => Point(index / 100d, ident: largeIdent))
            .ToArray();
        Assert.Throws<WeatherProfileValidationException>(() =>
            WeatherProfileDerivation.SampleRoute(Request(oversized), Now));
    }

    private static WeatherProfileRequest Request(
        IReadOnlyList<WeatherRoutePoint> route,
        double? currentDistanceNm = null,
        double? groundSpeedKnots = null,
        DateTimeOffset? departureTimeUtc = null,
        double? estimatedEnrouteSeconds = null) =>
        new(
            route,
            currentDistanceNm,
            groundSpeedKnots,
            departureTimeUtc,
            estimatedEnrouteSeconds);

    private static WeatherRoutePoint Point(
        double longitude,
        double latitude = 0,
        double? altitude = null,
        bool critical = false,
        string? ident = null) =>
        new(ident, longitude, latitude, altitude, critical);
}
