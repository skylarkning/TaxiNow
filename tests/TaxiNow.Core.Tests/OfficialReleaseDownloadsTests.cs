using TaxiNow.Core.Updates;
using Xunit;

namespace TaxiNow.Core.Tests;

public sealed class OfficialReleaseDownloadsTests
{
    [Theory]
    [InlineData("https://github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com/skylarkning/TaxiNow-Release/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.EXE")]
    public void AcceptsOfficialInstallersFromUnifiedAndLegacyRepositories(string url)
    {
        Assert.True(OfficialReleaseDownloads.IsInstallerUri(new Uri(url)));
    }

    [Theory]
    [InlineData("http://github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com.evil.example/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com/another-user/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com/skylarkning/TaxiNow-Other/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Portable.zip")]
    [InlineData("https://github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe.txt")]
    [InlineData("https://github.com/skylarkning/TaxiNow/blob/main/Setup.exe")]
    [InlineData("https://github.com/skylarkning/TaxiNow/releases/download/../../../../other/Setup.exe")]
    [InlineData("https://github.com:444/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    [InlineData("https://user@github.com/skylarkning/TaxiNow/releases/download/v2.0.0/Setup.exe")]
    public void RejectsUnofficialAndNonInstallerUrls(string url)
    {
        Assert.False(OfficialReleaseDownloads.IsInstallerUri(new Uri(url)));
    }

    [Fact]
    public void RejectsRelativeUri()
    {
        Assert.False(OfficialReleaseDownloads.IsInstallerUri(new Uri("Setup.exe", UriKind.Relative)));
    }
}
