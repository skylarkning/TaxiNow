namespace TaxiNow.Core.Updates;

public static class OfficialReleaseDownloads
{
    public static bool IsInstallerUri(Uri uri)
    {
        return uri.IsAbsoluteUri &&
            uri.Scheme == Uri.UriSchemeHttps &&
            uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) &&
            uri.IsDefaultPort &&
            string.IsNullOrEmpty(uri.UserInfo) &&
            (uri.AbsolutePath.StartsWith(
                "/skylarkning/TaxiNow/releases/download/",
                StringComparison.OrdinalIgnoreCase) ||
             uri.AbsolutePath.StartsWith(
                "/skylarkning/TaxiNow-Release/releases/download/",
                StringComparison.OrdinalIgnoreCase)) &&
            uri.AbsolutePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
    }
}
