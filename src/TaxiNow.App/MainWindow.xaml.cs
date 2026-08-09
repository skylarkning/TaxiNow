using System.IO;
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
    private string _storageRoot;
    private bool _keepWindowVisible;

    public MainWindow(
        string storageRoot,
        bool keepWindowVisible,
        Func<string, Task<bool>> changeStorageRootAsync,
        Func<bool, bool> changeKeepWindowVisible)
    {
        _storageRoot = storageRoot;
        _keepWindowVisible = keepWindowVisible;
        _changeStorageRootAsync = changeStorageRootAsync;
        _changeKeepWindowVisible = changeKeepWindowVisible;
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
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: webViewData);
            await MapView.EnsureCoreWebView2Async(environment);
            MapView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            MapView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            MapView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
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
        if (type == "window-settings:set")
        {
            bool enabled;
            try
            {
                using var document = JsonDocument.Parse(e.WebMessageAsJson);
                enabled = document.RootElement.GetProperty("keepVisible")
                    .GetBoolean();
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

    private void PostWindowSettings()
    {
        MapView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "window-settings",
            keepVisible = _keepWindowVisible
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
