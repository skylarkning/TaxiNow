using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace TaxiNow.Pipeline;

public sealed class PipelineProcessClient(
    string executablePath,
    IReadOnlyList<string>? argumentPrefix = null)
{
    public async IAsyncEnumerable<PipelineEvent> RunAsync(
        PipelineRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executablePath);
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in argumentPrefix ?? [])
        {
            startInfo.ArgumentList.Add(argument);
        }
        startInfo.ArgumentList.Add("serve");
        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
        {
            throw new InvalidOperationException("The map pipeline process could not start.");
        }

        await process.StandardInput.WriteLineAsync(
            JsonSerializer.Serialize(request, PipelineJson.Options).AsMemory(),
            cancellationToken);
        await process.StandardInput.FlushAsync(cancellationToken);
        process.StandardInput.Close();

        try
        {
            while (await process.StandardOutput.ReadLineAsync(cancellationToken) is { } line)
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                var pipelineEvent = JsonSerializer.Deserialize<PipelineEvent>(
                    line,
                    PipelineJson.Options)
                    ?? throw new InvalidDataException("Pipeline returned a null event.");
                if (!string.Equals(
                        pipelineEvent.ProtocolVersion,
                        request.ProtocolVersion,
                        StringComparison.Ordinal) ||
                    !string.Equals(
                        pipelineEvent.RequestId,
                        request.RequestId,
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "Pipeline response did not match the request.");
                }
                yield return pipelineEvent;
            }

            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0)
            {
                var error = await process.StandardError.ReadToEndAsync(cancellationToken);
                throw new InvalidOperationException(
                    $"Map pipeline exited with code {process.ExitCode}: {error}");
            }
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None);
            }
        }
    }
}
