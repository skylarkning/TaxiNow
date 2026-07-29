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
    public void SkyChartsSchemaV1_MetadataAndWidthsAreUpgraded()
    {
        const string json =
            """
            {
              "schemaVersion": 1,
              "ident": "CYYZ",
              "name": "Toronto Pearson International Airport",
              "countryCode": "CA",
              "center": [-79.6306, 43.6762],
              "bounds": {
                "minLon": -79.7,
                "maxLon": -79.5,
                "minLat": 43.5,
                "maxLat": 43.8
              },
              "generatedAt": "2026-07-29T12:00:00Z",
              "source": "OpenStreetMap contributors",
              "sourceURL": "https://www.openstreetmap.org/copyright",
              "counts": {
                "runway": 99
              },
              "features": [
                {
                  "kind": "runway",
                  "points": [[-79.66, 43.67], [-79.59, 43.69]],
                  "ref": "05/23",
                  "width": "61 m"
                },
                {
                  "kind": "terminal",
                  "points": [
                    [-79.63, 43.67],
                    [-79.62, 43.67],
                    [-79.62, 43.68],
                    [-79.63, 43.67]
                  ],
                  "label": "Terminal 1",
                  "closed": true
                }
              ]
            }
            """;

        var map = AirportMapJson.Read(json);

        Assert.Equal("CYYZ", map.Airport.Icao);
        Assert.Equal("Toronto Pearson International Airport", map.Airport.Name);
        Assert.Equal("CA", map.Airport.CountryCode);
        Assert.Equal(61, map.Features[0].WidthMeters);
        Assert.Equal("Terminal 1", map.Features[1].Name);
        Assert.False(map.Features[1].Closed);
        Assert.Equal(1, map.Counts.Runways);
        Assert.Equal(1, map.Counts.Terminals);
        Assert.Equal("ODbL 1.0", map.Sources[0].License);
    }

    [Fact]
    public void BundledCyyzFixture_HasAirportScaleGeometry()
    {
        var path = Path.Combine(
            AppContext.BaseDirectory,
            "fixtures",
            "airport-maps",
            "CYYZ.v2.json");

        var map = AirportMapJson.Read(File.ReadAllText(path));

        Assert.Equal("CYYZ", map.Airport.Icao);
        Assert.Equal(5, map.Counts.Runways);
        Assert.Equal(400, map.Counts.Taxiways);
        Assert.Equal(402, map.Counts.Stands);
        Assert.Equal(4, map.Counts.Terminals);
        Assert.True(map.Features.Count >= 1_100);
        Assert.Equal(
            5,
            map.Features
                .Where(feature => feature.Kind == AirportFeatureKind.Runway)
                .Select(feature => feature.Ref)
                .Distinct()
                .Count());
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
