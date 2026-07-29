namespace TaxiNow.Storage;

public sealed record StoragePaths(string Root)
{
    public string DatabasePath => Path.Combine(Root, "TaxiNow.db");
    public string MapsPath => Path.Combine(Root, "maps");
    public string SourceCachePath => Path.Combine(Root, "source-cache");
    public string PipelinePath => Path.Combine(Root, "pipeline");
    public string WebPath => Path.Combine(Root, "web");
    public string LogsPath => Path.Combine(Root, "logs");

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
}

