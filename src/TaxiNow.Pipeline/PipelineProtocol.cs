using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaxiNow.Pipeline;

public sealed record PipelineRequest(
    string ProtocolVersion,
    string RequestId,
    string Command,
    string? Icao,
    string? CountryCode,
    string OutputDirectory,
    string CacheDirectory,
    string? RegionCode,
    IReadOnlyList<string>? ExcludeIcaos);

public sealed record PipelineEvent(
    string ProtocolVersion,
    string RequestId,
    string Event,
    string? Phase,
    int? AirportsCompleted,
    int? AirportsTotal,
    long? BytesWritten,
    long? BytesDownloaded,
    long? DownloadBytesTotal,
    double? DownloadBytesPerSecond,
    string? CurrentIcao,
    double? Percentage,
    double? ElapsedSeconds,
    double? EstimatedRemainingSeconds,
    string? CurrentSource,
    string? OutputPath,
    IReadOnlyList<string>? OutputPaths,
    IReadOnlyList<string>? Warnings,
    string? Error);

internal static class PipelineJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
