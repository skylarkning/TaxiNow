using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using TaxiNow.Server;
using TaxiNow.Storage;
using Forms = System.Windows.Forms;

namespace TaxiNow.App;

public partial class App : System.Windows.Application
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);

    private WebApplication? _server;
    private Mutex? _instanceMutex;
    private MainWindow? _window;
    private Forms.NotifyIcon? _trayIcon;
    private Icon? _applicationIcon;
    private bool _allowWindowClose;
    private bool _quitStarted;
    private string _storageRoot = StoragePaths.Default.Root;
    private bool _keepWindowVisible;
    private bool _vmasPresenceEnabled;

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
        var desktopSettings = DesktopSettingsStore.Load();
        _keepWindowVisible = desktopSettings.KeepWindowVisible;
        _vmasPresenceEnabled = desktopSettings.EnableVmasPresence;
        _storageRoot = ResolveStorageRoot(desktopSettings);
        _window = new MainWindow(
            _storageRoot,
            _keepWindowVisible,
            _vmasPresenceEnabled,
            ChangeStorageRootAsync,
            ChangeKeepWindowVisible,
            ChangeVmasPresenceEnabled);
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
            _server = TaxiNowHost.Build(
                args,
                builder =>
                {
                    builder.Configuration["TaxiNow:StorageRoot"] = _storageRoot;
                    builder.Configuration[
                        "TaxiNow:Integrations:VmasPresenceEnabled"] =
                        _vmasPresenceEnabled.ToString();
                });
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

    private static string ResolveStorageRoot(DesktopSettings desktopSettings)
    {
        var configured = desktopSettings.StorageRoot;
        var selected = string.IsNullOrWhiteSpace(configured)
            ? StoragePaths.Default.Root
            : configured;
        try
        {
            selected = Path.GetFullPath(selected);
            var paths = PrepareStorageRoot(selected);
            try
            {
                DesktopSettingsStore.Save(
                    desktopSettings with { StorageRoot = selected });
            }
            catch
            {
                // Storage remains usable if the optional preference pointer
                // cannot be refreshed during startup.
            }
            return selected;
        }
        catch (Exception exception)
        {
            var fallback = StoragePaths.Default.Root;
            PrepareStorageRoot(fallback);
            System.Windows.MessageBox.Show(
                $"The selected TaxiNow data folder is unavailable:\n\n" +
                $"{selected}\n\n{exception.Message}\n\n" +
                $"TaxiNow will use its default folder for this session:\n{fallback}",
                "Storage folder unavailable",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return fallback;
        }
    }

    private Task<bool> ChangeStorageRootAsync(string selectedFolder)
    {
        string selected;
        try
        {
            selected = Path.GetFullPath(selectedFolder);
            PrepareStorageRoot(selected);
        }
        catch (Exception exception)
        {
            System.Windows.MessageBox.Show(
                $"TaxiNow cannot use that folder.\n\n{exception.Message}",
                "Storage folder unavailable",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return Task.FromResult(false);
        }

        var unchanged = string.Equals(
            selected.TrimEnd(Path.DirectorySeparatorChar),
            _storageRoot.TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

        try
        {
            DesktopSettingsStore.Save(new DesktopSettings(
                selected,
                _keepWindowVisible,
                _vmasPresenceEnabled));
        }
        catch (Exception exception)
        {
            System.Windows.MessageBox.Show(
                $"TaxiNow could not save that folder choice.\n\n" +
                exception.Message,
                "Storage setting could not be saved",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return Task.FromResult(false);
        }
        _storageRoot = selected;
        if (unchanged)
        {
            return Task.FromResult(false);
        }

        var restart = System.Windows.MessageBox.Show(
            $"TaxiNow will store new map downloads at:\n\n{selected}\n\n" +
            "Existing maps remain safely in the previous folder and are not " +
            "moved or deleted. Restart TaxiNow now to use the new location?",
            "Map storage location saved",
            MessageBoxButton.YesNo,
            MessageBoxImage.Information);
        if (restart != MessageBoxResult.Yes)
        {
            return Task.FromResult(true);
        }

        Dispatcher.BeginInvoke(
            () => _ = QuitAsync(restartApplication: true));
        return Task.FromResult(true);
    }

    private bool ChangeKeepWindowVisible(bool enabled)
    {
        try
        {
            DesktopSettingsStore.Save(new DesktopSettings(
                _storageRoot,
                enabled,
                _vmasPresenceEnabled));
        }
        catch (Exception exception)
        {
            System.Windows.MessageBox.Show(
                $"TaxiNow could not save the window visibility setting.\n\n" +
                exception.Message,
                "Window setting could not be saved",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return false;
        }

        _keepWindowVisible = enabled;
        if (_window is not null)
        {
            _window.Topmost = enabled;
        }
        return true;
    }

    private bool ChangeVmasPresenceEnabled(bool enabled)
    {
        try
        {
            DesktopSettingsStore.Save(new DesktopSettings(
                _storageRoot,
                _keepWindowVisible,
                enabled));
        }
        catch (Exception exception)
        {
            System.Windows.MessageBox.Show(
                $"TaxiNow could not save the vMAS presence setting.\n\n" +
                exception.Message,
                "Integration setting could not be saved",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return false;
        }

        _vmasPresenceEnabled = enabled;
        if (_server?.Services.GetService<VmasPresenceSettings>() is { } settings)
        {
            settings.Enabled = enabled;
        }
        return true;
    }

    private static StoragePaths PrepareStorageRoot(string root)
    {
        var normalized = Path.GetFullPath(root);
        if (string.Equals(
                normalized.TrimEnd(Path.DirectorySeparatorChar),
                Path.GetPathRoot(normalized)?.TrimEnd(
                    Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Select a dedicated folder, not the root of a drive.");
        }

        var paths = new StoragePaths(normalized);
        var isDefault = string.Equals(
            normalized.TrimEnd(Path.DirectorySeparatorChar),
            StoragePaths.Default.Root.TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);
        if (!isDefault &&
            !paths.HasOwnershipMarker() &&
            !paths.CanClaimOwnership())
        {
            throw new InvalidOperationException(
                "The selected folder contains files that do not belong to " +
                "TaxiNow. Select an empty folder dedicated to TaxiNow so the " +
                "uninstaller can remove downloaded assets safely.");
        }

        paths.EnsureCreated();
        paths.WriteOwnershipMarker();
        return paths;
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
                    "pack://application:,,,/Assets/TaxiNow.png",
                    UriKind.Absolute));
            if (resource is not null)
            {
                using (resource.Stream)
                using (var bitmap = new Bitmap(resource.Stream))
                {
                    var handle = bitmap.GetHicon();
                    try
                    {
                        using var icon = Icon.FromHandle(handle);
                        return (Icon)icon.Clone();
                    }
                    finally
                    {
                        DestroyIcon(handle);
                    }
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

    private async Task QuitAsync(
        int exitCode = 0,
        bool stopServer = true,
        bool restartApplication = false)
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
        if (restartApplication)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = Environment.ProcessPath
                    ?? throw new InvalidOperationException(
                        "TaxiNow could not resolve its executable path."),
                UseShellExecute = true
            });
        }
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
