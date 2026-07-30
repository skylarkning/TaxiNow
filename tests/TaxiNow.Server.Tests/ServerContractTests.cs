using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using TaxiNow.Core.Telemetry;
using TaxiNow.Server;
using TaxiNow.Server.Downloads;
using TaxiNow.Storage;
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
        Assert.Contains("\"hasPosition\":true", json);
    }

    [Fact]
    public void IcaoDownload_IsNormalized()
    {
        var request = DownloadRequestValidator.NormalizeAndValidate(
            new DownloadRequest(" ICAO ", " cyyz ", null));

        Assert.Equal("icao", request.Mode);
        Assert.Equal("CYYZ", request.Icao);
        Assert.Equal(1, request.MaxParallel);
    }

    [Fact]
    public void InvalidCountryCode_IsRejected()
    {
        Assert.Throws<ArgumentException>(() =>
            DownloadRequestValidator.NormalizeAndValidate(
                new DownloadRequest("country", null, "CAN")));
    }

    [Fact]
    public void RegionDownload_IsNormalized()
    {
        var request = DownloadRequestValidator.NormalizeAndValidate(
            new DownloadRequest(" country ", null, " ca ", " ca-on "));

        Assert.Equal("country", request.Mode);
        Assert.Equal("CA", request.CountryCode);
        Assert.Equal("CA-ON", request.RegionCode);
        Assert.Equal(4, request.MaxParallel);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    [InlineData(16)]
    public void DownloadRequest_AcceptsSupportedParallelLimits(int maxParallel)
    {
        var request = DownloadRequestValidator.NormalizeAndValidate(
            new DownloadRequest(
                "country",
                null,
                "CA",
                MaxParallel: maxParallel));

        Assert.Equal(maxParallel, request.MaxParallel);
    }

    [Fact]
    public void DownloadRequest_RejectsUnsupportedParallelLimit()
    {
        Assert.Throws<ArgumentException>(() =>
            DownloadRequestValidator.NormalizeAndValidate(
                new DownloadRequest(
                    "country",
                    null,
                    "CA",
                    MaxParallel: 3)));
    }

    [Fact]
    public void RegionMustBelongToCountry()
    {
        Assert.Throws<ArgumentException>(() =>
            DownloadRequestValidator.NormalizeAndValidate(
                new DownloadRequest("country", null, "CA", "US-NY")));
    }

    [Fact]
    public async Task BuilderConfiguration_SelectsStorageRootBeforeInitialization()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow.Tests",
            Guid.NewGuid().ToString("N"));
        try
        {
            await using var app = TaxiNowHost.Build(
                configure: builder =>
                    builder.Configuration["TaxiNow:StorageRoot"] = root);

            var paths = app.Services.GetRequiredService<StoragePaths>();

            Assert.Equal(Path.GetFullPath(root), paths.Root);
            Assert.True(File.Exists(paths.DatabasePath));
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }
}
