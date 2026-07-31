using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using MessageBox = System.Windows.MessageBox;
using OpenFileDialog = Microsoft.Win32.OpenFileDialog;

namespace TaxiNow.MapPackBuilder;

public partial class MainWindow : Window
{
    private readonly string _pipelineDirectory;
    private CancellationTokenSource? _cancellation;
    private Process? _activeProcess;

    public MainWindow()
    {
        InitializeComponent();
        _pipelineDirectory = Path.Combine(
            AppContext.BaseDirectory,
            "pipeline");
        VersionTextBox.Text = $"{DateTime.Now:yyyy.MM.dd}.1";
        OutputPathTextBox.Text = Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.MyDocuments),
            "TaxiNow-MapPacks",
            $"{DateTime.Now:yyyy-MM-dd}-CA-BC");
        PythonPathTextBox.Text = FindPython();
        OsmiumPathTextBox.Text =
            FindOsmiumForPython(PythonPathTextBox.Text)
            ?? FindExecutable("osmium.exe")
            ?? "";
    }

    private static string FindPython()
    {
        var profile = Environment.GetFolderPath(
            Environment.SpecialFolder.UserProfile);
        var candidates = new[]
        {
            Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "TaxiNow Map Pack Builder",
                "environment",
                "python.exe"),
            Path.Combine(
                profile,
                "miniforge3",
                "envs",
                "taxinow-map-packs",
                "python.exe"),
            Path.Combine(
                profile,
                "miniconda3",
                "envs",
                "taxinow-map-packs",
                "python.exe"),
            Path.Combine(
                profile,
                "anaconda3",
                "envs",
                "taxinow-map-packs",
                "python.exe"),
        };
        return candidates.FirstOrDefault(File.Exists)
            ?? FindExecutable("python.exe")
            ?? "";
    }

    private static string? FindExecutable(string name)
    {
        foreach (var directory in (
            Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(
                Path.PathSeparator,
                StringSplitOptions.RemoveEmptyEntries
                | StringSplitOptions.TrimEntries))
        {
            try
            {
                var path = Path.Combine(directory.Trim('"'), name);
                if (File.Exists(path))
                {
                    return path;
                }
            }
            catch
            {
                // Ignore malformed PATH entries.
            }
        }
        return null;
    }

    private static string? FindOsmiumForPython(string pythonPath)
    {
        if (!File.Exists(pythonPath))
        {
            return null;
        }
        var environment = Path.GetDirectoryName(pythonPath)!;
        var candidates = new[]
        {
            Path.Combine(environment, "Library", "bin", "osmium.exe"),
            Path.Combine(environment, "Scripts", "osmium.exe"),
            Path.Combine(environment, "osmium.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private void BrowsePython_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "Python executable|python.exe|Executable files|*.exe",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog(this) == true)
        {
            PythonPathTextBox.Text = dialog.FileName;
            var osmium = FindOsmiumForPython(dialog.FileName);
            if (osmium is not null)
            {
                OsmiumPathTextBox.Text = osmium;
            }
        }
    }

    private void BrowseOsmium_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "Osmium executable|osmium.exe|Executable files|*.exe",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog(this) == true)
        {
            OsmiumPathTextBox.Text = dialog.FileName;
        }
    }

    private void BrowseOutput_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "Select the TaxiNow map-pack build workspace",
            SelectedPath = OutputPathTextBox.Text,
            ShowNewFolderButton = true,
        };
        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            OutputPathTextBox.Text = dialog.SelectedPath;
        }
    }

    private async void ValidatePrerequisites_Click(
        object sender,
        RoutedEventArgs e)
    {
        try
        {
            SetBusy(true, "Checking prerequisites");
            _cancellation = new CancellationTokenSource();
            ValidateFields(requireScope: false);
            await RunProcessAsync(
                PythonPathTextBox.Text.Trim(),
                ["--version"],
                _cancellation.Token);
            var osmium = ResolveOsmium();
            await RunProcessAsync(
                osmium,
                ["--version"],
                _cancellation.Token);
            if (OvertureCheckBox.IsChecked == true)
            {
                await RunProcessAsync(
                    PythonPathTextBox.Text.Trim(),
                    ["-m", "pip", "show", "overturemaps"],
                    _cancellation.Token);
            }
            AppendLog(
                "Prerequisites are ready. Python, osmium-tool, and selected "
                + "optional dependencies were found.");
            StatusTextBlock.Text = "Prerequisites ready";
        }
        catch (Exception error)
        {
            ReportError(error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void Build_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            ValidateFields(requireScope: true);
            SetBusy(true, "Preparing local build");
            LogTextBox.Clear();
            _cancellation = new CancellationTokenSource();
            var token = _cancellation.Token;
            var python = PythonPathTextBox.Text.Trim();
            var country = CountryTextBox.Text.Trim().ToUpperInvariant();
            var subdivision = SubdivisionTextBox.Text
                .Trim()
                .ToUpperInvariant();
            var releaseTag = ReleaseTagTextBox.Text.Trim();
            var workspace = Path.GetFullPath(
                OutputPathTextBox.Text.Trim());
            var output = Path.Combine(workspace, "output");
            var plan = Path.Combine(workspace, "plan.json");
            Directory.CreateDirectory(workspace);

            AppendLog("TaxiNow local map-pack build");
            AppendLog($"Country/Region: {country}");
            AppendLog(
                $"Province/State: "
                + (string.IsNullOrEmpty(subdivision)
                    ? "(whole country/region)"
                    : subdivision));
            AppendLog($"Workspace: {workspace}");
            AppendLog("");

            StatusTextBlock.Text = "Creating preprocessing plan";
            await RunPythonAsync(
                python,
                [
                    Pipeline("global_map_pack_builder.py"),
                    "plan",
                    "--country",
                    country,
                    "--output",
                    plan,
                ],
                token);

            var baseUrl =
                "https://github.com/skylarkning/TaxiNow-Release/"
                + $"releases/download/{releaseTag}";
            var buildArguments = new List<string>
            {
                Pipeline("global_map_pack_builder.py"),
                "build",
                "--plan",
                plan,
                "--output",
                output,
                "--version",
                VersionTextBox.Text.Trim(),
                "--base-url",
                baseUrl,
            };
            if (!string.IsNullOrEmpty(subdivision))
            {
                buildArguments.Add("--only");
                buildArguments.Add(subdivision);
            }
            if (OvertureCheckBox.IsChecked != true)
            {
                buildArguments.Add("--skip-overture");
            }
            if (MicrosoftCheckBox.IsChecked != true)
            {
                buildArguments.Add("--skip-microsoft");
            }
            if (ForceCheckBox.IsChecked == true)
            {
                buildArguments.Add("--force");
            }

            StatusTextBlock.Text =
                "Building regional maps (resumable)";
            await RunPythonAsync(python, buildArguments, token);

            var validationArguments = new List<string>
            {
                Pipeline("validate_map_pack_release.py"),
                "--plan",
                plan,
                "--output",
                output,
                "--release-tag",
                releaseTag,
                "--max-rejected-airports",
                "10",
                "--max-rejected-percent",
                "2",
                "--allow-quality-warnings",
            };
            if (!string.IsNullOrEmpty(subdivision))
            {
                validationArguments.Add("--only");
                validationArguments.Add(subdivision);
            }
            StatusTextBlock.Text = "Running controlled publication gate";
            await RunPythonAsync(python, validationArguments, token);

            StatusTextBlock.Text = "Ready to publish";
            AppendLog("");
            AppendLog(
                "SUCCESS: the regional package passed archive integrity and "
                + "the controlled airport-quality policy. Open PUBLISHING.md "
                + "for exclusions, warnings, and the exact GitHub steps.");
            OpenPublishingButton.IsEnabled = true;
            MessageBox.Show(
                this,
                "The local build completed. Any safe airport omissions or "
                + "non-blocking warnings are recorded in PUBLISHING.md; "
                + "damaged archives and excessive omissions remain blocked.",
                "TaxiNow map packs ready",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }
        catch (OperationCanceledException)
        {
            StatusTextBlock.Text = "Cancelled";
            AppendLog("Build cancelled. Existing downloaded source data and "
                + "completed regions remain available for the next run.");
        }
        catch (Exception error)
        {
            ReportError(error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private string Pipeline(string fileName)
    {
        var path = Path.Combine(_pipelineDirectory, fileName);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"Required pipeline file is missing: {path}");
        }
        return path;
    }

    private void ValidateFields(bool requireScope)
    {
        var python = PythonPathTextBox.Text.Trim();
        if (!File.Exists(python))
        {
            throw new InvalidOperationException(
                "Select python.exe from the taxinow-map-packs Conda "
                + "environment.");
        }
        ResolveOsmium();
        if (!requireScope)
        {
            return;
        }
        var country = CountryTextBox.Text.Trim();
        if (country.Length != 2 || !country.All(char.IsLetter))
        {
            throw new InvalidOperationException(
                "Country/Region must be a two-letter ISO code.");
        }
        var subdivision = SubdivisionTextBox.Text.Trim();
        if (!string.IsNullOrEmpty(subdivision)
            && !subdivision.StartsWith(
                country + "-",
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Province/State must use an ISO subdivision such as CA-BC "
                + "and must match the country code.");
        }
        if (string.IsNullOrWhiteSpace(VersionTextBox.Text)
            || string.IsNullOrWhiteSpace(ReleaseTagTextBox.Text)
            || string.IsNullOrWhiteSpace(OutputPathTextBox.Text))
        {
            throw new InvalidOperationException(
                "Version, release tag, and output directory are required.");
        }
    }

    private string ResolveOsmium()
    {
        var selected = OsmiumPathTextBox.Text.Trim();
        if (!string.IsNullOrEmpty(selected))
        {
            if (File.Exists(selected))
            {
                return selected;
            }
            throw new InvalidOperationException(
                "The selected osmium.exe does not exist.");
        }
        return FindExecutable("osmium.exe")
            ?? throw new InvalidOperationException(
                "osmium-tool was not found. Create the documented "
                + "taxinow-map-packs Conda environment, then select "
                + "its osmium.exe.");
    }

    private Task<int> RunPythonAsync(
        string python,
        IReadOnlyList<string> arguments,
        CancellationToken token) =>
        RunProcessAsync(python, arguments, token);

    private async Task<int> RunProcessAsync(
        string executable,
        IReadOnlyList<string> arguments,
        CancellationToken token)
    {
        var start = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = _pipelineDirectory,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        var osmium = OsmiumPathTextBox.Text.Trim();
        var pathDirectories = new List<string>();
        var pythonDirectory = Path.GetDirectoryName(
            PythonPathTextBox.Text.Trim());
        if (!string.IsNullOrEmpty(pythonDirectory))
        {
            pathDirectories.Add(pythonDirectory);
            pathDirectories.Add(
                Path.Combine(pythonDirectory, "Scripts"));
            pathDirectories.Add(
                Path.Combine(pythonDirectory, "Library", "bin"));
        }
        if (File.Exists(osmium))
        {
            pathDirectories.Insert(0, Path.GetDirectoryName(osmium)!);
        }
        start.Environment["PATH"] =
            string.Join(
                Path.PathSeparator,
                pathDirectories
                    .Where(Directory.Exists)
                    .Distinct(StringComparer.OrdinalIgnoreCase))
            + Path.PathSeparator
            + (start.Environment["PATH"] ?? "");
        start.Environment["PYTHONUTF8"] = "1";
        start.Environment["PYTHONUNBUFFERED"] = "1";

        AppendLog(
            $"> {Path.GetFileName(executable)} "
            + string.Join(
                " ",
                arguments.Select(QuoteForLog)));
        using var process = new Process { StartInfo = start };
        _activeProcess = process;
        if (!process.Start())
        {
            throw new InvalidOperationException(
                $"Could not start {executable}.");
        }
        var stdout = PumpAsync(
            process.StandardOutput,
            token);
        var stderr = PumpAsync(
            process.StandardError,
            token);
        try
        {
            await process.WaitForExitAsync(token);
            await Task.WhenAll(stdout, stderr);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            throw;
        }
        finally
        {
            if (ReferenceEquals(_activeProcess, process))
            {
                _activeProcess = null;
            }
        }
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"{Path.GetFileName(executable)} exited with code "
                + $"{process.ExitCode}. See the build log for details.");
        }
        return process.ExitCode;
    }

    private async Task PumpAsync(
        StreamReader reader,
        CancellationToken token)
    {
        while (await reader.ReadLineAsync(token) is { } line)
        {
            AppendLog(line);
        }
    }

    private static string QuoteForLog(string value) =>
        value.Any(char.IsWhiteSpace) ? $"\"{value}\"" : value;

    private void AppendLog(string value)
    {
        Dispatcher.Invoke(() =>
        {
            LogTextBox.AppendText(value + Environment.NewLine);
            LogTextBox.ScrollToEnd();
        });
    }

    private void ReportError(Exception error)
    {
        StatusTextBlock.Text = "Failed";
        AppendLog("");
        AppendLog($"ERROR: {error.Message}");
        MessageBox.Show(
            this,
            error.Message,
            "TaxiNow map-pack build failed",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
    }

    private void SetBusy(bool busy, string? status = null)
    {
        BuildButton.IsEnabled = !busy;
        CancelButton.IsEnabled = busy;
        if (status is not null)
        {
            StatusTextBlock.Text = status;
        }
        if (!busy)
        {
            _cancellation?.Dispose();
            _cancellation = null;
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        _cancellation?.Cancel();
        if (_activeProcess is not null)
        {
            TryKill(_activeProcess);
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // The process may have exited between the checks.
        }
    }

    private void OpenOutput_Click(object sender, RoutedEventArgs e)
    {
        var path = Path.GetFullPath(OutputPathTextBox.Text.Trim());
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true,
        });
    }

    private void OpenPublishing_Click(object sender, RoutedEventArgs e)
    {
        var path = Path.Combine(
            Path.GetFullPath(OutputPathTextBox.Text.Trim()),
            "output",
            "PUBLISHING.md");
        if (!File.Exists(path))
        {
            MessageBox.Show(
                this,
                "PUBLISHING.md is created only after a build passes the "
                + "controlled publication gate.",
                "No publishable build",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true,
        });
    }

    private void OpenEnvironmentGuide_Click(
        object sender,
        RoutedEventArgs e)
    {
        var environmentFile = Path.Combine(
            _pipelineDirectory,
            "environment-map-pack-windows.yml");
        var message = new StringBuilder()
            .AppendLine("Install Miniforge or Miniconda, then run:")
            .AppendLine()
            .AppendLine(
                "conda env create --file "
                + $"\"{environmentFile}\"")
            .AppendLine()
            .AppendLine(
                "Select python.exe and osmium.exe from the created "
                + "taxinow-map-packs environment.")
            .ToString();
        System.Windows.Clipboard.SetText(message);
        MessageBox.Show(
            this,
            message + Environment.NewLine
                + "The command has been copied to the clipboard.",
            "TaxiNow map-pack environment",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    protected override void OnClosed(EventArgs e)
    {
        _cancellation?.Cancel();
        if (_activeProcess is not null)
        {
            TryKill(_activeProcess);
        }
        base.OnClosed(e);
    }
}
