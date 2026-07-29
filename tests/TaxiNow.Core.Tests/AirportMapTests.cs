using TaxiNow.Core.Airports;
using Xunit;

namespace TaxiNow.Core.Tests;

public sealed class AirportMapTests
{
    [Fact]
    public void SchemaV1_IsUpgradedToSchemaV2()
    {
        const string json =
            """
            {
              "icao": "TEST",
              "features": [
                {
                  "kind": "parking",
                  "coordinates": [[-79.1, 43.1]],
                  "ref": "1"
                },
                {
                  "kind": "runway",
                  "coordinates": [[-79.2, 43.0], [-79.0, 43.2]]
                }
              ]
            }
            """;

        var map = AirportMapJson.Read(json);

        Assert.Equal(2, map.SchemaVersion);
        Assert.Equal("TEST", map.Airport.Icao);
        Assert.Contains(
            map.Features,
            feature => feature.Kind == AirportFeatureKind.ParkingPosition);
        Assert.Equal(1, map.Counts.Runways);
    }

    [Fact]
    public void InvalidLongitude_IsRejected()
    {
        var map = ValidMap() with
        {
            Features =
            [
                ValidMap().Features[0] with
                {
                    Points = [[181, 43]]
                }
            ]
        };

        Assert.Throws<AirportMapValidationException>(() =>
            AirportMapValidator.Validate(map));
    }

    [Fact]
    public void SerializedCoordinates_RemainLongitudeLatitude()
    {
        var roundTrip = AirportMapJson.Read(AirportMapJson.Write(ValidMap()));

        Assert.Equal(-79.6, roundTrip.Features[0].Points[0][0]);
        Assert.Equal(43.6, roundTrip.Features[0].Points[0][1]);
    }

    private static AirportMap ValidMap() =>
        new(
            2,
            new AirportMetadata(
                "TEST",
                "Test Airport",
                "CA",
                "CA-ON",
                "Test",
                [-79.6, 43.6],
                new GeoBounds(-79.7, -79.5, 43.5, 43.7)),
            DateTimeOffset.UtcNow,
            [new MapSource("Fixture", null, "CC0", DateTimeOffset.UtcNow, null)],
            new AirportFeatureCounts(1, 0, 0, 0),
            [
                new AirportFeature(
                    "runway-1",
                    AirportFeatureKind.Runway,
                    [[-79.6, 43.6], [-79.59, 43.61]],
                    "01/19",
                    null,
                    "asphalt",
                    45,
                    10,
                    false,
                    "Fixture")
            ]);
}
