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
    private string _storageRoot;

    public MainWindow(
        string storageRoot,
        Func<string, Task<bool>> changeStorageRootAsync)
    {
        _storageRoot = storageRoot;
        _changeStorageRootAsync = changeStorageRootAsync;
        InitializeComponent();
    }

    public async Task LoadMapAsync()
    {
        try
        {
            await MapView.EnsureCoreWebView2Async();
            MapView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            MapView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            MapView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            MapView.NavigationCompleted += OnNavigationCompleted;
            MapView.Source = new Uri($"http://127.0.0.1:{TaxiNowHost.DefaultPort}/");
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
