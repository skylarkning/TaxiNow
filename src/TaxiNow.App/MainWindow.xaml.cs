using System.Windows;
using Microsoft.Web.WebView2.Core;
using TaxiNow.Server;

namespace TaxiNow.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    public async Task LoadMapAsync()
    {
        try
        {
            await MapView.EnsureCoreWebView2Async();
            MapView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            MapView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            MapView.NavigationCompleted += OnNavigationCompleted;
            MapView.Source = new Uri($"http://127.0.0.1:{TaxiNowHost.DefaultPort}/");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(
                "Microsoft Edge WebView2 Runtime is required to display TaxiNow.",
                "WebView2 Runtime missing",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    private void OnNavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingOverlay.Visibility = e.IsSuccess ? Visibility.Collapsed : Visibility.Visible;
        if (!e.IsSuccess)
        {
            MessageBox.Show(
                $"The local TaxiNow map could not be loaded ({e.WebErrorStatus}).",
                "Map load failed",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }
}
