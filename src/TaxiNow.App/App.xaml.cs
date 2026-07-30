using System.ComponentModel;
using System.Drawing;
using System.Windows;
using Microsoft.AspNetCore.Builder;
using TaxiNow.Server;
using Forms = System.Windows.Forms;

namespace TaxiNow.App;

public partial class App : System.Windows.Application
{
    private WebApplication? _server;
    private Mutex? _instanceMutex;
    private MainWindow? _window;
    private Forms.NotifyIcon? _trayIcon;
    private Icon? _applicationIcon;
    private bool _allowWindowClose;
    private bool _quitStarted;

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
            System.Windows.MessageBox.Show(
                "TaxiNow is already running.",
                "TaxiNow",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        CreateTrayIcon();
        _window = new MainWindow();
        MainWindow = _window;
        _window.Closing += OnWindowClosing;
        _window.StateChanged += OnWindowStateChanged;
        _window.Show();
        _ = InitializeAsync(e.Args, _window);
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
            System.Windows.MessageBox.Show(
                $"TaxiNow could not start its local map service.\n\n{exception.Message}",
                "TaxiNow startup error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            await QuitAsync(1, stopServer: false);
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
            await server.DisposeAsync()
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch
        {
            // Preserve the original startup failure shown to the user.
        }
    }

    private void CreateTrayIcon()
    {
        var menu = new Forms.ContextMenuStrip();
        var restore = menu.Items.Add("Open TaxiNow");
        restore.Click += (_, _) => Dispatcher.BeginInvoke(RestoreWindow);
        menu.Items.Add(new Forms.ToolStripSeparator());
        var quit = menu.Items.Add("Quit");
        quit.Click += (_, _) => Dispatcher.BeginInvoke(() => _ = QuitAsync());

        _applicationIcon = LoadApplicationIcon();
        _trayIcon = new Forms.NotifyIcon
        {
            ContextMenuStrip = menu,
            Icon = _applicationIcon,
            Text = "TaxiNow",
            Visible = false
        };
        _trayIcon.MouseClick += (_, args) =>
        {
            if (args.Button == Forms.MouseButtons.Left)
            {
                Dispatcher.BeginInvoke(RestoreWindow);
            }
        };
    }

    private static Icon LoadApplicationIcon()
    {
        try
        {
            var resource = GetResourceStream(
                new Uri(
                    "pack://application:,,,/Assets/TaxiNow.ico",
                    UriKind.Absolute));
            if (resource is not null)
            {
                using (resource.Stream)
                using (var icon = new Icon(resource.Stream))
                {
                    return (Icon)icon.Clone();
                }
            }
        }
        catch
        {
            // The executable still starts with a safe system icon if a
            // packaged branding resource cannot be read.
        }

        return (Icon)SystemIcons.Application.Clone();
    }

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        if (_window?.WindowState != WindowState.Minimized)
        {
            return;
        }

        _window.Hide();
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = true;
            _trayIcon.ShowBalloonTip(
                2500,
                "TaxiNow is still running",
                "Click the tray icon to reopen the airport map.",
                Forms.ToolTipIcon.Info);
        }
    }

    private void RestoreWindow()
    {
        if (_window is null)
        {
            return;
        }

        _window.Show();
        _window.WindowState = WindowState.Normal;
        _window.Activate();
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false;
        }
    }

    private void OnWindowClosing(object? sender, CancelEventArgs e)
    {
        if (_allowWindowClose)
        {
            return;
        }

        e.Cancel = true;
        _ = QuitAsync();
    }

    private async Task QuitAsync(int exitCode = 0, bool stopServer = true)
    {
        if (_quitStarted)
        {
            return;
        }
        _quitStarted = true;

        _window?.Hide();
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false;
        }

        // Close WebView2 first so its SignalR/WebSocket connection cannot hold
        // Kestrel's graceful shutdown open until the timeout expires.
        _allowWindowClose = true;
        var window = _window;
        _window = null;
        window?.Close();

        var server = _server;
        _server = null;
        if (stopServer && server is not null)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await server.StopAsync(timeout.Token);
            }
            catch
            {
                // Shutdown continues even if the local host exceeds its grace period.
            }

            try
            {
                await server.DisposeAsync()
                    .AsTask()
                    .WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch
            {
                // Never leave an invisible desktop process behind after Close/Quit.
            }
        }

        _trayIcon?.Dispose();
        _trayIcon = null;
        _applicationIcon?.Dispose();
        _applicationIcon = null;
        ReleaseInstanceMutex();
        Shutdown(exitCode);
    }

    private void ReleaseInstanceMutex()
    {
        var mutex = _instanceMutex;
        _instanceMutex = null;
        if (mutex is null)
        {
            return;
        }

        try
        {
            mutex.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // It was not owned by this thread; disposal still releases the handle.
        }
        mutex.Dispose();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _trayIcon = null;
        }
        _applicationIcon?.Dispose();
        _applicationIcon = null;
        ReleaseInstanceMutex();
        base.OnExit(e);
    }
}
