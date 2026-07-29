using System.Text.Json;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.SimConnect.Recording;

public sealed class JsonLinesTelemetryRecorder : ITelemetrySink, IAsyncDisposable
{
    private readonly StreamWriter _writer;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private long? _firstMonotonicMilliseconds;

    public JsonLinesTelemetryRecorder(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        _writer = new StreamWriter(new FileStream(
            fullPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 16 * 1024,
            useAsync: true));
    }

    public async ValueTask WriteAsync(
        TelemetrySnapshot snapshot,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _firstMonotonicMilliseconds ??= snapshot.SourceMonotonicMilliseconds;
            var frame = new RecorderFrame(
                snapshot.SourceMonotonicMilliseconds - _firstMonotonicMilliseconds.Value,
                snapshot.Latitude,
                snapshot.Longitude,
                snapshot.TrueHeadingDegrees,
                snapshot.GroundSpeedKnots,
                snapshot.OnGround);
            await _writer.WriteLineAsync(
                JsonSerializer.Serialize(frame, JsonOptions).AsMemory(),
                cancellationToken);
            await _writer.FlushAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await _writer.DisposeAsync();
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record RecorderFrame(
        long TMs,
        double Lat,
        double Lon,
        double Heading,
        double GroundSpeed,
        bool OnGround);
}

