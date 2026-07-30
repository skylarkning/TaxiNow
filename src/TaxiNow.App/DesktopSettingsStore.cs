using System.IO;
using System.Text.Json;

namespace TaxiNow.App;

internal sealed record DesktopSettings(string? StorageRoot = null);

internal static class DesktopSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public static string SettingsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TaxiNow",
        "desktop-settings.json");

    public static DesktopSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath))
            {
                return new DesktopSettings();
            }

            return JsonSerializer.Deserialize<DesktopSettings>(
                File.ReadAllText(SettingsPath),
                JsonOptions) ?? new DesktopSettings();
        }
        catch
        {
            // A damaged preference must not prevent TaxiNow from opening.
            return new DesktopSettings();
        }
    }

    public static void Save(DesktopSettings settings)
    {
        var directory = Path.GetDirectoryName(SettingsPath)
            ?? throw new InvalidOperationException(
                "TaxiNow could not resolve its settings directory.");
        Directory.CreateDirectory(directory);

        var temporaryPath = SettingsPath + ".tmp";
        File.WriteAllText(
            temporaryPath,
            JsonSerializer.Serialize(settings, JsonOptions));
        File.Move(temporaryPath, SettingsPath, overwrite: true);
    }
}
