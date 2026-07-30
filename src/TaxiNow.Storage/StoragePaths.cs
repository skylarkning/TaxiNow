namespace TaxiNow.Storage;

public sealed record StoragePaths(string Root)
{
    public const string OwnershipMarkerFileName = ".taxinow-data-root";
    public const string OwnershipMarkerContents = "TaxiNow Storage Root v1";

    public string DatabasePath => Path.Combine(Root, "TaxiNow.db");
    public string MapsPath => Path.Combine(Root, "maps");
    public string SourceCachePath => Path.Combine(Root, "source-cache");
    public string PipelinePath => Path.Combine(Root, "pipeline");
    public string WebPath => Path.Combine(Root, "web");
    public string LogsPath => Path.Combine(Root, "logs");
    public string OwnershipMarkerPath =>
        Path.Combine(Root, OwnershipMarkerFileName);

    public static StoragePaths Default =>
        new(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TaxiNow"));

    public void EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(MapsPath);
        Directory.CreateDirectory(SourceCachePath);
        Directory.CreateDirectory(PipelinePath);
        Directory.CreateDirectory(WebPath);
        Directory.CreateDirectory(LogsPath);
    }

    public bool HasOwnershipMarker()
    {
        try
        {
            return File.Exists(OwnershipMarkerPath) &&
                string.Equals(
                    File.ReadAllText(OwnershipMarkerPath).Trim(),
                    OwnershipMarkerContents,
                    StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    public bool CanClaimOwnership()
    {
        if (!Directory.Exists(Root))
        {
            return true;
        }

        var allowedNames = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            OwnershipMarkerFileName,
            "TaxiNow.db",
            "TaxiNow.db-shm",
            "TaxiNow.db-wal",
            "TaxiNow.db-journal",
            "maps",
            "source-cache",
            "pipeline",
            "web",
            "logs"
        };
        return Directory
            .EnumerateFileSystemEntries(Root)
            .All(entry => allowedNames.Contains(Path.GetFileName(entry)));
    }

    public void WriteOwnershipMarker()
    {
        Directory.CreateDirectory(Root);
        File.WriteAllText(OwnershipMarkerPath, OwnershipMarkerContents);
    }
}
