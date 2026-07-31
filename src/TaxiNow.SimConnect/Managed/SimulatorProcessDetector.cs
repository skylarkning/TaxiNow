using System.Diagnostics;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.SimConnect.Managed;

public static class SimulatorProcessDetector
{
    private const string Msfs2020ProcessName = "FlightSimulator";
    private const string Msfs2024ProcessName = "FlightSimulator2024";

    public static SimulatorEdition GetRunningEdition()
    {
        // Preserve the existing MSFS 2024 path when both editions happen to
        // be running. A subsequent connection attempt re-detects the edition.
        if (IsProcessRunning(Msfs2024ProcessName))
        {
            return SimulatorEdition.Msfs2024;
        }

        return IsProcessRunning(Msfs2020ProcessName)
            ? SimulatorEdition.Msfs2020
            : SimulatorEdition.Unknown;
    }

    public static bool IsRunning(SimulatorEdition edition) => edition switch
    {
        SimulatorEdition.Msfs2020 => IsProcessRunning(Msfs2020ProcessName),
        SimulatorEdition.Msfs2024 => IsProcessRunning(Msfs2024ProcessName),
        _ => false
    };

    public static SimulatorEdition SelectEdition(
        IEnumerable<string> processNames)
    {
        var names = processNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (names.Contains(Msfs2024ProcessName) ||
            names.Contains($"{Msfs2024ProcessName}.exe"))
        {
            return SimulatorEdition.Msfs2024;
        }

        return names.Contains(Msfs2020ProcessName) ||
               names.Contains($"{Msfs2020ProcessName}.exe")
            ? SimulatorEdition.Msfs2020
            : SimulatorEdition.Unknown;
    }

    private static bool IsProcessRunning(string processName)
    {
        try
        {
            var processes = Process.GetProcessesByName(processName);
            try
            {
                return processes.Length > 0;
            }
            finally
            {
                foreach (var process in processes)
                {
                    process.Dispose();
                }
            }
        }
        catch
        {
            return false;
        }
    }
}
