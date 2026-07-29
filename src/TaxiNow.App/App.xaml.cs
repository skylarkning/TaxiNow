using System.Windows;
using Microsoft.AspNetCore.Builder;
using TaxiNow.Server;

namespace TaxiNow.App;

public partial class App : Application
{
    private WebApplication? _server;
    private Mutex? _instanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _instanceMutex = new Mutex(
            initiallyOwned: true,
            name: @"Local\TaxiNow.Desktop",
            createdNew: out var isFirstInstance);
        if (!isFirstInstance)
        {
            _instanceMutex.Dispose();
            _instanceMutex = null;
            MessageBox.Show(
                "TaxiNow is already running.",
                "TaxiNow",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        var window = new MainWindow();
        MainWindow = window;
        window.Show();
        _ = InitializeAsync(e.Args, window);
    }

    private async Task InitializeAsync(string[] args, MainWindow window)
    {
        try
        {
            _server = TaxiNowHost.Build(args);
            await _server.StartAsync();
            await window.LoadMapAsync();
        }
        catch (Exception exception)
        {
            await DisposeServerAfterFailedStartAsync();
            MessageBox.Show(
                $"TaxiNow could not start its local map service.\n\n{exception.Message}",
                "TaxiNow startup error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private async Task DisposeServerAfterFailedStartAsync()
    {
        var server = _server;
        _server = null;
        if (server is null)
        {
            return;
        }

        try
        {
            await server.DisposeAsync();
        }
        catch
        {
            // Preserve the original startup failure shown to the user.
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        var server = _server;
        _server = null;
        if (server is not null)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                server.StopAsync(timeout.Token).GetAwaiter().GetResult();
                server.DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
            catch
            {
                // WPF cannot await shutdown. Never turn cleanup into a CLR crash dialog.
            }
        }

        if (_instanceMutex is not null)
        {
            _instanceMutex.ReleaseMutex();
            _instanceMutex.Dispose();
            _instanceMutex = null;
        }

        base.OnExit(e);
    }
}
