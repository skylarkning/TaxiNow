using System.Threading;

namespace TaxiNow.Server;

public sealed class VmasPresenceSettings(bool enabled = false)
{
    private int _enabled = enabled ? 1 : 0;

    public bool Enabled
    {
        get => Volatile.Read(ref _enabled) == 1;
        set => Volatile.Write(ref _enabled, value ? 1 : 0);
    }
}
