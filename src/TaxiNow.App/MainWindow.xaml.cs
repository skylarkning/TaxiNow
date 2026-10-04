using System.IO;
using System.Diagnostics;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using TaxiNow.Server;
using Forms = System.Windows.Forms;

namespace TaxiNow.App;

public partial class MainWindow : Window
{
    private readonly Func<string, Task<bool>> _changeStorageRootAsync;
    private readonly Func<bool, bool> _changeKeepWindowVisible;
    private readonly Func<bool, bool> _changeVmasPresenceEnabled;
    private readonly Func<bool, bool> _changeMinimizeToTray;
    private string _storageRoot;
    private bool _keepWindowVisible;
    private bool _vmasPresenceEnabled;
    private bool _minimizeToTray;
    private bool _updateInstallInProgress;

    public MainWindow(
        string storageRoot,
        bool keepWindowVisible,
        bool vmasPresenceEnabled,
        bool minimizeToTray,
        Func<string, Task<bool>> changeStorageRootAsync,
        Func<bool, bool> changeKeepWindowVisible,
        Func<bool, bool> changeVmasPresenceEnabled,
        Func<bool, bool> changeMinimizeToTray)
    {
        _storageRoot = storageRoot;
        _keepWindowVisible = keepWindowVisible;
        _vmasPresenceEnabled = vmasPresenceEnabled;
        _minimizeToTray = minimizeToTray;
        _changeMinimizeToTray = changeMinimizeToTray;
        _changeStorageRootAsync = changeStorageRootAsync;
        _changeKeepWindowVisible = changeKeepWindowVisible;
        _changeVmasPresenceEnabled = changeVmasPresenceEnabled;
        InitializeComponent();
        Title = $"TaxiNow {TaxiNowHost.DisplayVersion}";
        Topmost = keepWindowVisible;
    }

    public async Task LoadMapAsync()
    {
        try
        {
            var webViewData = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "TaxiNow",
                "WebView2");
            Directory.CreateDirectory(webViewData);
            // WebView2 154 can misinterpret wide-gamut SDR display primaries and tint
            // neutral UI colours yellow. Keep this app's web content in sRGB rather
            // than changing the user's display profile or global WebView2 settings.
            var webViewOptions = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--force-color-profile=srgb"
            };
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: webViewData,
                options: webViewOptions);
            await MapView.EnsureCoreWebView2Async(environment);
            MapView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            MapView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            MapView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            MapView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                if (args.Uri != "https://github.com/skylarkning/TaxiNow-Release/issues/new/choose") return;
                args.Handled = true;
                try { Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true }); }
                catch (Exception error) { System.Diagnostics.Debug.WriteLine(error); }
            };
            MapView.NavigationCompleted += OnNavigationCompleted;
            MapView.Source = new Uri(TaxiNowHost.MapShellUrl);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            System.Windows.MessageBox.Show(
                "Microsoft Edge WebView2 Runtime is required to display TaxiNow.",
                "WebView2 Runtime missing",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    private async void OnWebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) ||
            !source.IsLoopback ||
            source.Port != TaxiNowHost.DefaultPort)
        {
            return;
        }

        string? type;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            type = document.RootElement.GetProperty("type").GetString();
        }
        catch (Exception exception)
            when (exception is JsonException or KeyNotFoundException)
        {
            return;
        }

        if (type == "storage-location:get")
        {
            PostStorageLocation(restartRequired: false);
            return;
        }
        if (type == "window-settings:get")
        {
            PostWindowSettings();
            return;
        }
        if (type == "integration-settings:get")
        {
            PostIntegrationSettings();
            return;
        }
        if (type == "integration-settings:set")
        {
            bool enabled;
            try
            {
                using var document = JsonDocument.Parse(e.WebMessageAsJson);
                enabled = document.RootElement.GetProperty("vmasPresenceEnabled")
                    .GetBoolean();
            }
            catch (Exception exception)
                when (exception is JsonException or KeyNotFoundException or
                    InvalidOperationException)
            {
                return;
            }

            if (_changeVmasPresenceEnabled(enabled))
            {
                _vmasPresenceEnabled = enabled;
            }
            PostIntegrationSettings();
            return;
        }
        if (type == "window-settings:set")
        {
            bool enabled;
            try
            {
                using var document = JsonDocument.Parse(e.WebMessageAsJson);
                var root = document.RootElement;
                if (root.TryGetProperty("minimizeToTray", out var minimize))
                {
                    var minimizeToTray = minimize.GetBoolean();
                    if (_changeMinimizeToTray(minimizeToTray)) _minimizeToTray = minimizeToTray;
                    PostWindowSettings();
                    return;
                }
                enabled = root.GetProperty("keepVisible").GetBoolean();
            }
            catch (Exception exception)
                when (exception is JsonException or KeyNotFoundException or
                    InvalidOperationException)
            {
                return;
            }

            if (_changeKeepWindowVisible(enabled))
            {
                _keepWindowVisible = enabled;
                Topmost = enabled;
            }
            PostWindowSettings();
            return;
        }
        if (type == "update-install:start")
        {
            if (_updateInstallInProgress)
            {
                PostUpdateInstallStatus(
                    "error",
                    "An update download is already in progress.");
                return;
            }

            string? downloadUrl;
            string? digest;
            try
            {
                using var document = JsonDocument.Parse(e.WebMessageAsJson);
                downloadUrl = document.RootElement
                    .GetProperty("downloadUrl")
                    .GetString();
                digest = document.RootElement.TryGetProperty("digest", out var value)
                    ? value.GetString()
                    : null;
            }
            catch (Exception exception)
                when (exception is JsonException or KeyNotFoundException)
            {
                PostUpdateInstallStatus("error", "The update request was invalid.");
                return;
            }

            _updateInstallInProgress = true;
            try
            {
                PostUpdateInstallStatus(
                    "downloading",
                    "Downloading the verified TaxiNow installer…");
                var installer = await DownloadUpdateInstallerAsync(
                    downloadUrl,
                    digest);
                PostUpdateInstallStatus(
                    "launching",
                    "Download complete. Opening the TaxiNow installer…");
                Process.Start(new ProcessStartInfo(installer)
                {
                    UseShellExecute = true
                });
            }
            catch (Exception exception)
            {
                PostUpdateInstallStatus("error", exception.Message);
            }
            finally
            {
                _updateInstallInProgress = false;
            }
            return;
        }
        if (type != "storage-location:choose")
        {
            return;
        }

        using var picker = new Forms.FolderBrowserDialog
        {
            Description = "Select the folder where TaxiNow stores downloaded maps",
            InitialDirectory = _storageRoot,
            ShowNewFolderButton = true,
            UseDescriptionForTitle = true
        };
        if (picker.ShowDialog() != Forms.DialogResult.OK)
        {
            return;
        }

        var changed = await _changeStorageRootAsync(picker.SelectedPath);
        if (!changed)
        {
            PostStorageLocation(restartRequired: false);
            return;
        }

        _storageRoot = Path.GetFullPath(picker.SelectedPath);
        PostStorageLocation(restartRequired: true);
    }

    private async Task<string> DownloadUpdateInstallerAsync(
        string? downloadUrl,
        string? digest)
    {
        if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith(
                "/skylarkning/TaxiNow-Release/releases/download/",
                StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "TaxiNow only installs official HTTPS release installers from skylarkning/TaxiNow-Release.");
        }

        var expected = digest?.StartsWith(
            "sha256:",
            StringComparison.OrdinalIgnoreCase) == true
            ? digest[7..].Trim()
            : null;
        if (expected is null || expected.Length != 64 ||
            expected.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidDataException(
                "GitHub did not provide a valid SHA-256 digest for this installer. Use an official download button instead.");
        }

        var directory = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow",
            "Updates");
        Directory.CreateDirectory(directory);
        var fileName = Path.GetFileName(Uri.UnescapeDataString(uri.AbsolutePath));
        var destination = Path.Combine(directory, fileName);
        var temporary = destination + ".download";

        using var client = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(15)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            $"TaxiNow/{TaxiNowHost.ProductVersion}");
        using var response = await client.GetAsync(
            uri,
            HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        await using (var input = await response.Content.ReadAsStreamAsync())
        await using (var output = new FileStream(
            temporary,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            81920,
            useAsync: true))
        {
            await input.CopyToAsync(output);
        }

        if (new FileInfo(temporary).Length < 2)
        {
            File.Delete(temporary);
            throw new InvalidDataException("The downloaded installer is empty.");
        }
        await using (var stream = File.OpenRead(temporary))
        {
            if (stream.ReadByte() != 'M' || stream.ReadByte() != 'Z')
            {
                stream.Close();
                File.Delete(temporary);
                throw new InvalidDataException(
                    "The downloaded file is not a valid Windows installer.");
            }
        }

        await using (var stream = File.OpenRead(temporary))
        {
            var actual = Convert.ToHexString(
                await SHA256.HashDataAsync(stream));
            if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            {
                stream.Close();
                File.Delete(temporary);
                throw new InvalidDataException(
                    "The installer SHA-256 verification failed. Use the GitHub download button instead.");
            }
        }

        File.Move(temporary, destination, overwrite: true);
        return destination;
    }

    private void PostUpdateInstallStatus(string state, string message)
    {
        MapView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "update-install:status",
            state,
            message
        }));
    }

    private void PostWindowSettings()
    {
        MapView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "window-settings",
            keepVisible = _keepWindowVisible,
            minimizeToTray = _minimizeToTray
        }));
    }

    private void PostIntegrationSettings()
    {
        MapView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "integration-settings",
            vmasPresenceEnabled = _vmasPresenceEnabled
        }));
    }

    private void PostStorageLocation(bool restartRequired)
    {
        MapView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "storage-location",
            path = _storageRoot,
            restartRequired
        }));
    }

    private void OnNavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingOverlay.Visibility = e.IsSuccess ? Visibility.Collapsed : Visibility.Visible;
        if (!e.IsSuccess)
        {
            System.Windows.MessageBox.Show(
                $"The local TaxiNow map could not be loaded ({e.WebErrorStatus}).",
                "Map load failed",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }
}
