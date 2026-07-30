namespace TaxiNow.Core.Telemetry;

public sealed class TelemetryRefreshSignal : IDisposable
{
    private readonly AutoResetEvent requested = new(false);
    private bool disposed;

    public WaitHandle WaitHandle => requested;

    public void Request()
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        requested.Set();
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        requested.Dispose();
    }
}
