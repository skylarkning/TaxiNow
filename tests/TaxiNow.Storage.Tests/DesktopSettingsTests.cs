using System.Text.Json;
using TaxiNow.App;
using Xunit;

namespace TaxiNow.Storage.Tests;

public sealed class DesktopSettingsTests
{
    [Fact]
    public void ExistingSettings_DefaultToTaskbarWithoutLosingOtherPreferences()
    {
        var settings = JsonSerializer.Deserialize<DesktopSettings>(
            """{"StorageRoot":"D:/TaxiNow","KeepWindowVisible":true,"EnableVmasPresence":true}""")!;
        Assert.False(settings.MinimizeToTray);
        Assert.Equal("D:/TaxiNow", settings.StorageRoot);
        Assert.True(settings.KeepWindowVisible);
        Assert.True(settings.EnableVmasPresence);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void MinimizePreference_RoundTripsWithOtherDesktopSettings(bool minimizeToTray)
    {
        var original = new DesktopSettings("D:/TaxiNow", true, true, minimizeToTray);
        var restored = JsonSerializer.Deserialize<DesktopSettings>(JsonSerializer.Serialize(original));
        Assert.Equal(original, restored);
    }
}
