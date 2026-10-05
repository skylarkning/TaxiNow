using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Storage.Tests;

public sealed class ElevationStorageTests
{
    [Fact]
    public void WeatherProfilesPath_IsUnderTheStorageRoot()
    {
        var paths = new StoragePaths(Path.Combine("root", "taxinow"));

        Assert.Equal(
            Path.Combine("root", "taxinow", "weather-profiles"),
            paths.WeatherProfilesPath);
    }

    [Fact]
    public void EnsureCreated_CreatesTheWeatherProfilesDirectory()
    {
        WithStorage(paths =>
        {
            paths.EnsureCreated();

            Assert.True(Directory.Exists(paths.WeatherProfilesPath));
        });
    }

    [Fact]
    public void WeatherProfilesDirectory_IsRecognizedAsOwnedStorage()
    {
        WithStorage(paths =>
        {
            Directory.CreateDirectory(paths.WeatherProfilesPath);

            Assert.True(paths.CanClaimOwnership());
        });
    }

    [Fact]
    public void ElevationProfilesPath_IsUnderTheStorageRoot()
    {
        var paths = new StoragePaths(Path.Combine("root", "taxinow"));

        Assert.Equal(
            Path.Combine("root", "taxinow", "elevation-profiles"),
            paths.ElevationProfilesPath);
    }

    [Fact]
    public void EnsureCreated_CreatesTheElevationProfilesDirectory()
    {
        WithStorage(paths =>
        {
            paths.EnsureCreated();

            Assert.True(Directory.Exists(paths.ElevationProfilesPath));
        });
    }

    [Fact]
    public void ElevationProfilesDirectory_IsRecognizedAsOwnedStorage()
    {
        WithStorage(paths =>
        {
            Directory.CreateDirectory(paths.ElevationProfilesPath);

            Assert.True(paths.CanClaimOwnership());
        });
    }

    private static void WithStorage(Action<StoragePaths> action)
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow.Tests",
            Guid.NewGuid().ToString("N"));
        try
        {
            action(new StoragePaths(root));
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
