using TaxiNow.Core.Airports;
using Xunit;

namespace TaxiNow.Core.Tests;

public sealed class AirportSelectorTests
{
    [Fact]
    public void Selection_IsHeldByHysteresis()
    {
        var selector = new AirportSelector(paddingDegrees: 0, switchMarginMeters: 2_000);
        var first = Airport("AAAA", -79.6, 43.6);
        var second = Airport("BBBB", -79.58, 43.6);

        Assert.Equal(
            "AAAA",
            selector.Select(43.6, -79.6, [first, second], onGround: true));
        Assert.Equal(
            "AAAA",
            selector.Select(43.6, -79.589, [first, second], onGround: true));
    }

    [Fact]
    public void AirportDoesNotSwitchWhileAirborne()
    {
        var selector = new AirportSelector();
        var first = Airport("AAAA", -79.6, 43.6);
        var second = Airport("BBBB", -80.6, 44.6);
        selector.Select(43.6, -79.6, [first, second], onGround: true);

        Assert.Equal(
            "AAAA",
            selector.Select(44.6, -80.6, [first, second], onGround: false));
    }

    private static AirportMetadata Airport(string icao, double lon, double lat) =>
        new(
            icao,
            icao,
            "CA",
            null,
            null,
            [lon, lat],
            new GeoBounds(lon - 0.01, lon + 0.01, lat - 0.01, lat + 0.01));
}
