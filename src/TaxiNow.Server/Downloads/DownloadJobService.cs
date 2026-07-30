using System.Collections.Concurrent;
using TaxiNow.Pipeline;
using TaxiNow.Storage;

namespace TaxiNow.Server.Downloads;

public sealed record DownloadRequest(
    string Mode,
    string? Icao,
    string? CountryCode,
    string? RegionCode = null,
    int MaxParallel = 4);

public sealed record DownloadJob(
    Guid JobId,
    string State,
    string Phase,
    int AirportsCompleted,
    int AirportsTotal,
    int MaxParallel,
    long BytesWritten,
    long BytesDownloaded,
    long? DownloadBytesTotal,
    double? DownloadBytesPerSecond,
    string? CurrentIcao,
    double Percentage,
    TimeSpan Elapsed,
    TimeSpan? EstimatedRemaining,
    string? CurrentSource,
    IReadOnlyList<string> Warnings,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public static class DownloadRequestValidator
{
    public static DownloadRequest NormalizeAndValidate(DownloadRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.Mode))
        {
            throw new ArgumentException("Download mode must be 'icao' or 'country'.");
        }
        var normalized = request with
        {
            Mode = request.Mode.Trim().ToLowerInvariant(),
            Icao = request.Icao?.Trim().ToUpperInvariant(),
            CountryCode = request.CountryCode?.Trim().ToUpperInvariant(),
            RegionCode = request.RegionCode?.Trim().ToUpperInvariant()
        };

        if (normalized.Mode == "icao")
        {
            if (string.IsNullOrWhiteSpace(normalized.Icao) ||
                normalized.Icao.Length is < 3 or > 5)
            {
                throw new ArgumentException("ICAO mode requires a valid ICAO code.");
            }
            return normalized with { MaxParallel = 1 };
        }

        if (normalized.Mode == "country")
        {
            if (normalized.CountryCode?.Length != 2)
            {
                throw new ArgumentException(
                    "Country/region mode requires an ISO 3166-1 alpha-2 code.");
            }
            if (normalized.RegionCode is { Length: > 0 } regionCode &&
                (!regionCode.StartsWith(
                    $"{normalized.CountryCode}-",
                    StringComparison.Ordinal) ||
                 regionCode.Length is < 4 or > 7))
            {
                throw new ArgumentException(
                    "Province/state code must match the country/region, " +
                    "for example CA-ON.");
            }
            if (normalized.MaxParallel is not (1 or 2 or 4 or 8 or 16))
            {
                throw new ArgumentException(
                    "Maximum parallel downloads must be 1, 2, 4, 8, or 16.");
            }
            return normalized;
        }

        throw new ArgumentException("Download mode must be 'icao' or 'country'.");
    }
}

public sealed class DownloadJobService(
    IConfiguration configuration,
    StoragePaths storagePaths,
    MapAssetStore assets,
    ILogger<DownloadJobService> logger) : IAsyncDisposable
{
    private readonly ConcurrentDictionary<Guid, DownloadJob> _jobs = new();
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _cancellations = new();

    public DownloadJob Create(DownloadRequest request)
    {
        request = DownloadRequestValidator.NormalizeAndValidate(request);
        var now = DateTimeOffset.UtcNow;
        var job = new DownloadJob(
            Guid.NewGuid(),
            "queued",
            "queued",
            0,
            request.Mode.Equals("icao", StringComparison.OrdinalIgnoreCase) ? 1 : 0,
            request.MaxParallel,
            0,
            0,
            null,
            null,
            request.Icao,
            0,
            TimeSpan.Zero,
            null,
            null,
            [],
            null,
            now,
            now);
        _jobs[job.JobId] = job;
        var cancellation = new CancellationTokenSource();
        _cancellations[job.JobId] = cancellation;
        _ = Task.Run(
            () => RunAsync(job.JobId, request, cancellation.Token),
            CancellationToken.None);
        return job;
    }

    public IReadOnlyList<DownloadJob> List() =>
        _jobs.Values.OrderByDescending(static job => job.CreatedAt).ToArray();

    public DownloadJob? Get(Guid id) => _jobs.GetValueOrDefault(id);

    public int ClearFinished()
    {
        var removed = 0;
        foreach (var (id, job) in _jobs)
        {
            if (job.State is "completed" or "failed" or "cancelled" &&
                _jobs.TryRemove(id, out _))
            {
                removed++;
            }
        }
        return removed;
    }

    public DownloadJob? Cancel(Guid id)
    {
        _cancellations.GetValueOrDefault(id)?.Cancel();
        return Update(id, existing => existing with
        {
            State = "cancelled",
            Phase = "cancelled",
            UpdatedAt = DateTimeOffset.UtcNow
        });
    }

    public ValueTask DisposeAsync()
    {
        foreach (var cancellation in _cancellations.Values)
        {
            cancellation.Cancel();
            cancellation.Dispose();
        }
        _cancellations.Clear();
        return ValueTask.CompletedTask;
    }

    private async Task RunAsync(
        Guid jobId,
        DownloadRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            Update(jobId, job => job with
            {
                State = "running",
                Phase = "starting",
                UpdatedAt = DateTimeOffset.UtcNow
            });
            var (executable, prefix) = ResolvePipelineCommand();
            var client = new PipelineProcessClient(executable, prefix);
            var outputDirectory = Path.Combine(
                storagePaths.PipelinePath,
                "jobs",
                jobId.ToString("N"));
            Directory.CreateDirectory(outputDirectory);
            var excludedIcaos = request.Mode == "country"
                ? (await assets.GetSummaryAsync(cancellationToken))
                    .Assets
                    .Select(static asset => asset.Icao)
                    .ToArray()
                : null;
            var pipelineRequest = new PipelineRequest(
                ProtocolVersion: "1",
                RequestId: jobId.ToString("N"),
                Command: request.Mode == "icao"
                    ? "download_icao"
                    : "download_country",
                Icao: request.Icao,
                CountryCode: request.CountryCode,
                OutputDirectory: outputDirectory,
                CacheDirectory: storagePaths.SourceCachePath,
                RegionCode: request.RegionCode,
                ExcludeIcaos: excludedIcaos,
                MaxParallel: request.MaxParallel);

            PipelineEvent? completed = null;
            await foreach (var pipelineEvent in client.RunAsync(
                               pipelineRequest,
                               cancellationToken))
            {
                if (pipelineEvent.Event == "failed")
                {
                    throw new InvalidOperationException(
                        pipelineEvent.Error ?? "Map pipeline failed.");
                }
                if (pipelineEvent.Event == "completed")
                {
                    completed = pipelineEvent;
                }
                ApplyProgress(jobId, pipelineEvent);
            }

            if (completed is null)
            {
                throw new InvalidOperationException(
                    "Map pipeline exited without a completion event.");
            }

            var outputPaths = completed.OutputPaths ??
                (completed.OutputPath is null ? [] : [completed.OutputPath]);
            var imported = 0;
            foreach (var outputPath in outputPaths.Where(File.Exists))
            {
                await using var stream = File.OpenRead(outputPath);
                await assets.ImportAsync(stream, cancellationToken);
                imported++;
            }

            if (imported == 0 && completed.AirportsTotal != 0)
            {
                throw new InvalidOperationException(
                    completed.Warnings?.Count > 0
                        ? string.Join("; ", completed.Warnings)
                        : "The pipeline produced no valid airport maps.");
            }

            Update(jobId, job => job with
            {
                State = "completed",
                Phase = "completed",
                Percentage = 100,
                DownloadBytesPerSecond = 0,
                EstimatedRemaining = null,
                Warnings = completed.Warnings ?? job.Warnings,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            Update(jobId, job => job with
            {
                State = "cancelled",
                Phase = "cancelled",
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Download job {JobId} failed.", jobId);
            Update(jobId, job => job with
            {
                State = "failed",
                Phase = "failed",
                Error = exception.Message,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }
        finally
        {
            if (_cancellations.TryRemove(jobId, out var cancellation))
            {
                cancellation.Dispose();
            }
        }
    }

    private void ApplyProgress(Guid jobId, PipelineEvent pipelineEvent)
    {
        Update(jobId, job => job with
        {
            Phase = pipelineEvent.Phase ?? job.Phase,
            AirportsCompleted =
                pipelineEvent.AirportsCompleted ?? job.AirportsCompleted,
            AirportsTotal = pipelineEvent.AirportsTotal ?? job.AirportsTotal,
            BytesWritten = pipelineEvent.BytesWritten ?? job.BytesWritten,
            BytesDownloaded =
                pipelineEvent.BytesDownloaded ?? job.BytesDownloaded,
            DownloadBytesTotal =
                pipelineEvent.BytesDownloaded is not null
                    ? pipelineEvent.DownloadBytesTotal
                    : job.DownloadBytesTotal,
            DownloadBytesPerSecond =
                pipelineEvent.Event == "completed"
                    ? 0
                    : pipelineEvent.DownloadBytesPerSecond ??
                      job.DownloadBytesPerSecond,
            CurrentIcao = pipelineEvent.CurrentIcao ?? job.CurrentIcao,
            Percentage = pipelineEvent.Percentage ?? job.Percentage,
            Elapsed = pipelineEvent.ElapsedSeconds is { } elapsed
                ? TimeSpan.FromSeconds(elapsed)
                : job.Elapsed,
            EstimatedRemaining =
                pipelineEvent.Event == "completed"
                    ? null
                    : pipelineEvent.EstimatedRemainingSeconds is { } remaining
                    ? TimeSpan.FromSeconds(remaining)
                    : job.EstimatedRemaining,
            CurrentSource = pipelineEvent.CurrentSource ?? job.CurrentSource,
            Warnings = pipelineEvent.Warnings ?? job.Warnings,
            UpdatedAt = DateTimeOffset.UtcNow
        });
    }

    private (string Executable, IReadOnlyList<string> Prefix) ResolvePipelineCommand()
    {
        var packaged = configuration["TaxiNow:PipelineExecutable"];
        if (!string.IsNullOrWhiteSpace(packaged))
        {
            return (Path.GetFullPath(packaged), []);
        }

        var bundled = Path.Combine(
            AppContext.BaseDirectory,
            "pipeline",
            "taxinow-map-pipeline.exe");
        if (File.Exists(bundled))
        {
            return (bundled, []);
        }

        var python = configuration["TaxiNow:PythonExecutable"] ?? "python";
        var script = configuration["TaxiNow:PipelineScript"] ??
            Path.Combine(
                AppContext.BaseDirectory,
                "pipeline",
                "taxinow_map_pipeline.py");
        if (!File.Exists(script))
        {
            throw new FileNotFoundException("TaxiNow map pipeline script was not found.", script);
        }
        return (python, [Path.GetFullPath(script)]);
    }

    private DownloadJob? Update(
        Guid id,
        Func<DownloadJob, DownloadJob> update)
    {
        while (_jobs.TryGetValue(id, out var existing))
        {
            var updated = update(existing);
            if (_jobs.TryUpdate(id, updated, existing))
            {
                return updated;
            }
        }
        return null;
    }

}
