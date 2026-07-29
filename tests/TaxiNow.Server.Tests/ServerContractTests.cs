using System.Text.Json;
using System.Text.Json.Serialization;
using TaxiNow.Core.Telemetry;
using TaxiNow.Server.Downloads;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class ServerContractTests
{
    [Fact]
    public void TelemetryContract_UsesCamelCaseStringEnums()
    {
        var now = DateTimeOffset.UtcNow;
        var sample = new TelemetrySnapshot(
            42,
            SimulatorEdition.Msfs2024,
            true,
            true,
            43.6,
            -79.6,
            237,
            14,
            now,
            now,
            123,
            State: TrackingState.GroundTracking);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

        var json = JsonSerializer.Serialize(sample, options);

        Assert.Contains("\"simulator\":\"msfs2024\"", json);
        Assert.Contains("\"state\":\"groundTracking\"", json);
        Assert.Contains("\"trueHeadingDegrees\":237", json);
    }

    [Fact]
    public void IcaoDownload_IsNormalized()
    {
        var request = DownloadRequestValidator.NormalizeAndValidate(
            new DownloadRequest(" ICAO ", " cyyz ", null, null));

        Assert.Equal("icao", request.Mode);
        Assert.Equal("CYYZ", request.Icao);
    }

    [Fact]
    public void InvalidCountryCode_IsRejected()
    {
        Assert.Throws<ArgumentException>(() =>
            DownloadRequestValidator.NormalizeAndValidate(
                new DownloadRequest("country", null, "CAN", null)));
    }

    [Fact]
    public void RegionDownload_IsNormalized()
    {
        var request = DownloadRequestValidator.NormalizeAndValidate(
            new DownloadRequest(" country ", null, " ca ", 25, " ca-on "));

        Assert.Equal("country", request.Mode);
        Assert.Equal("CA", request.CountryCode);
        Assert.Equal("CA-ON", request.RegionCode);
        Assert.Equal(25, request.MaximumCount);
    }

    [Fact]
    public void RegionMustBelongToCountry()
    {
        Assert.Throws<ArgumentException>(() =>
            DownloadRequestValidator.NormalizeAndValidate(
                new DownloadRequest("country", null, "CA", 25, "US-NY")));
    }
}
