using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using TaxiNow.Core.Telemetry;
using TaxiNow.Server;
using TaxiNow.Server.Downloads;
using TaxiNow.Server.Elevation;
using TaxiNow.Server.Weather;
using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class ServerContractTests
{
    [Fact]
    public void ProductMetadata_UsesBuildSpecificMapShellUrl()
    {
        Assert.Equal("2.0.0", TaxiNowHost.ProductVersion);
        Assert.Equal("V2.0", TaxiNowHost.DisplayVersion);
        Assert.Equal(207, TaxiNowHost.InternalBuildId);
        Assert.Equal(
            "http://127.0.0.1:8780/?build=207",
            TaxiNowHost.MapShellUrl);
    }

    [Fact]
    public void VmasPresence_UsesAnExactOriginAllowlist()
    {
        Assert.True(TaxiNowHost.IsVmasPresenceOriginAllowed(null));
        Assert.True(TaxiNowHost.IsVmasPresenceOriginAllowed(""));
        Assert.True(TaxiNowHost.IsVmasPresenceOriginAllowed("https://vmas.my"));
        Assert.False(TaxiNowHost.IsVmasPresenceOriginAllowed("http://vmas.my"));
        Assert.False(TaxiNowHost.IsVmasPresenceOriginAllowed("https://www.vmas.my"));
        Assert.False(TaxiNowHost.IsVmasPresenceOriginAllowed("https://vmas.my.evil.test"));
    }

    [Fact]
    public void VmasPresence_IsDisabledByDefaultAndCanBeEnabledAtRuntime()
    {
        var settings = new VmasPresenceSettings();

        Assert.False(settings.Enabled);
        settings.Enabled = true;
        Assert.True(settings.Enabled);
    }

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

    [Theory]
    [InlineData("FlightSimulator", SimulatorEdition.Msfs2020)]
    [InlineData("FlightSimulator.exe", SimulatorEdition.Msfs2020)]
    [InlineData("FlightSimulator2024", SimulatorEdition.Msfs2024)]
    [InlineData("FlightSimulator2024.exe", SimulatorEdition.Msfs2024)]
    [InlineData("SomeOtherProcess", SimulatorEdition.Unknown)]
    public void SimulatorDetection_RecognizesBothEditions(
        string processName,
        SimulatorEdition expected)
    {
        Assert.Equal(
            expected,
            TaxiNow.SimConnect.Managed.SimulatorProcessDetector.SelectEdition(
                [processName]));
    }

    [Fact]
    public void SimulatorDetection_Preserves2024PriorityWhenBothRun()
    {
        Assert.Equal(
            SimulatorEdition.Msfs2024,
            TaxiNow.SimConnect.Managed.SimulatorProcessDetector.SelectEdition(
                ["FlightSimulator", "FlightSimulator2024"]));
    }

    [Fact]
    public void SimConnectClient_IsIncludedWithoutADeveloperSdkInstallation()
    {
        Assert.True(
            TaxiNow.SimConnect.Managed.ManagedSimConnectTelemetrySource
                .IsRuntimeAvailable);
    }

    [Fact]
    public void TelemetryContract_SerializesMsfs2020Edition()
    {
        var now = DateTimeOffset.UtcNow;
        var sample = new TelemetrySnapshot(
            1,
            SimulatorEdition.Msfs2020,
            true,
            true,
            43.68466,
            -79.62334,
            328.58,
            0,
            now,
            now,
            1,
            State: TrackingState.GroundTracking);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

        var json = JsonSerializer.Serialize(sample, options);

        Assert.Contains("\"simulator\":\"msfs2020\"", json);
        Assert.Contains("\"state\":\"groundTracking\"", json);
    }

    [Fact]
    public void TelemetryContract_SerializesAltitude()
    {
        var now = DateTimeOffset.UtcNow;
        var sample = new TelemetrySnapshot(
            1,
            SimulatorEdition.Msfs2024,
            true,
            false,
            43.0,
            -79.0,
            90,
            250,
            now,
            now,
            10,
            AltitudeMslFeet: 12_345,
            AltitudeAglFeet: 10_900);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

        var json = JsonSerializer.Serialize(sample, options);

        Assert.Contains("\"altitudeMslFeet\":12345", json);
        Assert.Contains("\"altitudeAglFeet\":10900", json);
    }

    [Fact]
    public void ElevationContract_UsesFrontendDistanceNmWireName()
    {
        var response = new ElevationProfileResponse(
            [new ElevationSample(-79.6, 43.6, 12.5, 900)],
            "fresh",
            DateTimeOffset.Parse("2026-09-12T00:00:00Z"),
            "Open-Meteo / Copernicus DEM",
            "Elevation: Open-Meteo · Copernicus DEM");

        var json = JsonSerializer.Serialize(
            response,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        using var document = JsonDocument.Parse(json);
        var sample = document.RootElement.GetProperty("samples")[0];
        Assert.Equal(12.5, sample.GetProperty("distanceNm").GetDouble());
        Assert.False(sample.TryGetProperty(
            "cumulativeNauticalMiles",
            out _));
    }

    [Fact]
    public void WeatherContract_UsesCamelCaseEnumsNullableBoundsAndDistanceNm()
    {
        var now = DateTimeOffset.Parse("2026-10-06T00:00:00Z");
        var response = new WeatherProfileResponse(
            0, 25, now, now, now.AddMinutes(10), "scheduled", "fresh",
            [
                new WeatherBand(
                    "cloud-0", WeatherFeatureKind.Cloud, WeatherIntensity.Moderate,
                    WeatherPathRelation.OnPath, WeatherConfidence.High,
                    WeatherValueKind.Estimated,
                    [new WeatherBandColumn(-79, 43, 12.5, now, null, 20_000, 1_000, null, 18_000)],
                    "Open-Meteo + METAR")
            ],
            [new WeatherSourceInfo("Open-Meteo", "Weather: Open-Meteo", now, now, now)],
            ["partial"]);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

        var json = JsonSerializer.Serialize(response, options);

        using var document = JsonDocument.Parse(json);
        var band = document.RootElement.GetProperty("bands")[0];
        var column = band.GetProperty("columns")[0];
        Assert.Equal("cloud", band.GetProperty("kind").GetString());
        Assert.Equal("onPath", band.GetProperty("pathRelation").GetString());
        Assert.Equal("estimated", band.GetProperty("valueKind").GetString());
        Assert.Equal(12.5, column.GetProperty("distanceNm").GetDouble());
        Assert.Equal(JsonValueKind.Null, column.GetProperty("originalBaseFeet").ValueKind);
        Assert.Equal(JsonValueKind.Null, column.GetProperty("topFeet").ValueKind);
        Assert.Contains("Open-Meteo", document.RootElement.GetProperty("sources")[0].GetProperty("attribution").GetString());
        Assert.Equal("/api/v1/weather/profile", TaxiNowHost.WeatherProfilePath);
    }

    [Fact]
    public async Task WeatherEndpoint_IsMappedOnlyWhenFeatureFlagIsEnabled()
    {
        var disabledRoot = TempRoot();
        var enabledRoot = TempRoot();
        try
        {
            await using var disabled = TaxiNowHost.Build(configure: builder =>
            {
                builder.Configuration["TaxiNow:StorageRoot"] = disabledRoot;
                builder.Configuration["TaxiNow:Features:VerticalWeatherProfileEnabled"] = "false";
            });
            await using var enabled = TaxiNowHost.Build(configure: builder =>
            {
                builder.Configuration["TaxiNow:StorageRoot"] = enabledRoot;
                builder.Configuration["TaxiNow:Features:VerticalWeatherProfileEnabled"] = "true";
            });

            Assert.DoesNotContain(((IEndpointRouteBuilder)disabled).DataSources.SelectMany(source => source.Endpoints),
                endpoint => endpoint.DisplayName?.Contains(TaxiNowHost.WeatherProfilePath, StringComparison.Ordinal) == true);
            Assert.Contains(((IEndpointRouteBuilder)enabled).DataSources.SelectMany(source => source.Endpoints),
                endpoint => endpoint.DisplayName?.Contains(TaxiNowHost.WeatherProfilePath, StringComparison.Ordinal) == true);
            Assert.NotNull(enabled.Services.GetRequiredService<WeatherProfileService>());
        }
        finally
        {
            if (Directory.Exists(disabledRoot)) Directory.Delete(disabledRoot, recursive: true);
            if (Directory.Exists(enabledRoot)) Directory.Delete(enabledRoot, recursive: true);
        }
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
        Assert.Equal(1, request.MaxParallel);
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

    private static string TempRoot() => Path.Combine(
        Path.GetTempPath(), "TaxiNow.Tests", Guid.NewGuid().ToString("N"));
}
