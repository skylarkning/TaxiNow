using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.SimConnect.Replay;

public sealed class ReplayTelemetrySource(
    string path,
    double speed = 1,
    bool loop = true,
    TimeProvider? timeProvider = null) : ITelemetrySource
{
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    public async IAsyncEnumerable<TelemetrySnapshot> ReadAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (speed is not (0.5 or 1 or 2))
        {
            throw new ArgumentOutOfRangeException(
                nameof(speed),
                "Replay speed must be 0.5, 1, or 2.");
        }

        var frames = await ReadFramesAsync(path, cancellationToken);
        if (frames.Count == 0)
        {
            throw new InvalidDataException($"Replay '{path}' contains no telemetry frames.");
        }

        long sequence = 0;
        do
        {
            var stopwatch = Stopwatch.StartNew();
            var replayStarted = _timeProvider.GetUtcNow();
            foreach (var frame in frames)
            {
                var due = TimeSpan.FromMilliseconds(frame.TMs / speed);
                var remaining = due - stopwatch.Elapsed;
                if (remaining > TimeSpan.Zero)
                {
                    await Task.Delay(remaining, _timeProvider, cancellationToken);
                }

                var now = _timeProvider.GetUtcNow();
                yield return new TelemetrySnapshot(
                    ++sequence,
                    SimulatorEdition.Replay,
                    Connected: true,
                    frame.OnGround,
                    frame.Latitude,
                    frame.Longitude,
                    frame.Heading,
                    frame.GroundSpeed,
                    replayStarted + TimeSpan.FromMilliseconds(frame.TMs / speed),
                    now,
                    (long)stopwatch.Elapsed.TotalMilliseconds,
                    AltitudeMslFeet: frame.AltitudeMslFeet,
                    AltitudeAglFeet: frame.AltitudeAglFeet);
            }
        } while (loop && !cancellationToken.IsCancellationRequested);
    }

    private static async Task<IReadOnlyList<ReplayFrame>> ReadFramesAsync(
        string replayPath,
        CancellationToken cancellationToken)
    {
        var frames = new List<ReplayFrame>();
        await using var stream = File.OpenRead(replayPath);
        using var reader = new StreamReader(stream);
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var frame = JsonSerializer.Deserialize<ReplayFrame>(line, JsonOptions)
                ?? throw new InvalidDataException("Replay frame cannot be null.");
            if (frame.TMs < 0 ||
                !double.IsFinite(frame.Latitude) ||
                !double.IsFinite(frame.Longitude) ||
                frame.Latitude is < -90 or > 90 ||
                frame.Longitude is < -180 or > 180)
            {
                throw new InvalidDataException($"Invalid replay frame: {line}");
            }

            frames.Add(frame);
        }

        return frames.OrderBy(static frame => frame.TMs).ToArray();
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private sealed record ReplayFrame(
        [property: JsonPropertyName("tMs")] long TMs,
        [property: JsonPropertyName("lat")] double Latitude,
        [property: JsonPropertyName("lon")] double Longitude,
        [property: JsonPropertyName("heading")] double Heading,
        [property: JsonPropertyName("groundSpeed")] double GroundSpeed,
        [property: JsonPropertyName("onGround")] bool OnGround,
        [property: JsonPropertyName("altitudeMslFeet")] double? AltitudeMslFeet = null,
        [property: JsonPropertyName("altitudeAglFeet")] double? AltitudeAglFeet = null);
}

