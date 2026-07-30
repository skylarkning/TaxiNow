using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Threading.Channels;
using TaxiNow.Core.Telemetry;

#if TAXINOW_MANAGED_SIMCONNECT
using Microsoft.FlightSimulator.SimConnect;
using FlightSimConnect = Microsoft.FlightSimulator.SimConnect.SimConnect;
#endif

namespace TaxiNow.SimConnect.Managed;

public sealed class ManagedSimConnectTelemetrySource : ITelemetrySource
{
#if TAXINOW_MANAGED_SIMCONNECT
    public static bool IsRuntimeAvailable => true;

    static ManagedSimConnectTelemetrySource()
    {
        AssemblyLoadContext.Default.Resolving += ResolveManagedWrapper;
    }

    private static Assembly? ResolveManagedWrapper(
        AssemblyLoadContext context,
        AssemblyName assemblyName)
    {
        if (!string.Equals(
                assemblyName.Name,
                "Microsoft.FlightSimulator.SimConnect",
                StringComparison.Ordinal))
        {
            return null;
        }

        var path = Path.Combine(
            AppContext.BaseDirectory,
            "Microsoft.FlightSimulator.SimConnect.dll");
        return File.Exists(path)
            ? context.LoadFromAssemblyPath(path)
            : null;
    }
#else
    public static bool IsRuntimeAvailable => false;
#endif

    public async IAsyncEnumerable<TelemetrySnapshot> ReadAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var channel = Channel.CreateBounded<TelemetrySnapshot>(
            new BoundedChannelOptions(16)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = true
            });
        using var stop = new ManualResetEvent(false);
        using var registration = cancellationToken.Register(() => stop.Set());
        var owner = new Thread(() => RunOwner(channel.Writer, stop))
        {
            IsBackground = true,
            Name = "TaxiNow SimConnect"
        };
        owner.Start();

        try
        {
            await foreach (var sample in channel.Reader.ReadAllAsync(
                               cancellationToken))
            {
                yield return sample;
            }
        }
        finally
        {
            stop.Set();
            owner.Join(TimeSpan.FromSeconds(5));
        }
    }

    private static void RunOwner(
        ChannelWriter<TelemetrySnapshot> writer,
        ManualResetEvent stop)
    {
        try
        {
#if TAXINOW_MANAGED_SIMCONNECT
            RunManagedOwner(writer, stop);
#else
            RunWithoutRuntime(writer, stop);
#endif
        }
        catch
        {
            RunWithoutRuntime(writer, stop);
        }
        finally
        {
            writer.TryComplete();
        }
    }

    private static bool IsMsfs2024Running()
    {
        try
        {
            var processes = Process.GetProcessesByName("FlightSimulator2024");
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

    private static TelemetrySnapshot StatusSample(
        ref long sequence,
        bool connected,
        TrackingState state,
        Stopwatch clock)
    {
        var now = DateTimeOffset.UtcNow;
        return new TelemetrySnapshot(
            ++sequence,
            SimulatorEdition.Msfs2024,
            connected,
            false,
            0,
            0,
            0,
            0,
            now,
            now,
            clock.ElapsedMilliseconds,
            HasPosition: false,
            State: state);
    }

#if TAXINOW_MANAGED_SIMCONNECT
    private enum DataDefinition
    {
        UserAircraft = 1
    }

    private enum DataRequest
    {
        UserAircraft = 1
    }

    private enum SystemEvent
    {
        Simulation = 1
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct UserAircraftData
    {
        public double Latitude;
        public double Longitude;
        public double TrueHeadingDegrees;
        public double OnGround;
        public double GroundSpeedKnots;
    }

    private static void RunManagedOwner(
        ChannelWriter<TelemetrySnapshot> writer,
        ManualResetEvent stop)
    {
        var sequence = 0L;
        var clock = Stopwatch.StartNew();
        var lastStatus = string.Empty;
        void PublishStatus(
            string key,
            bool connected,
            TrackingState state)
        {
            if (key == lastStatus)
            {
                return;
            }

            lastStatus = key;
            writer.TryWrite(
                StatusSample(ref sequence, connected, state, clock));
        }

        while (!stop.WaitOne(0))
        {
            if (!IsMsfs2024Running())
            {
                PublishStatus(
                    "simulator-not-running",
                    connected: false,
                    TrackingState.Disconnected);
                stop.WaitOne(TimeSpan.FromSeconds(1));
                continue;
            }

            PublishStatus(
                "waiting-for-flight",
                connected: false,
                TrackingState.Connecting);
            using var notification = new AutoResetEvent(false);
            try
            {
                using var connection = new FlightSimConnect(
                    "TaxiNow",
                    IntPtr.Zero,
                    0,
                    notification,
                    0);
                var quitReceived = false;
                var simulationRunning = false;
                UserAircraftData? lastPublished = null;
                var lastPublishedAt = -1L;

                connection.OnRecvOpen += (_, _) =>
                    PublishStatus(
                        "flight-not-started",
                        connected: true,
                        TrackingState.Connecting);
                connection.OnRecvQuit += (_, _) => quitReceived = true;
                connection.OnRecvException += (_, _) =>
                {
                    // SimConnect remains authoritative. A failed request will
                    // be retried by recreating this connection.
                    quitReceived = true;
                };
                connection.OnRecvEvent += (_, message) =>
                {
                    if (message.uEventID != (uint)SystemEvent.Simulation)
                    {
                        return;
                    }

                    simulationRunning = message.dwData != 0;
                    if (!simulationRunning)
                    {
                        lastPublished = null;
                        PublishStatus(
                            "flight-not-started",
                            connected: true,
                            TrackingState.Connecting);
                    }
                };
                connection.OnRecvSimobjectData += (_, message) =>
                {
                    if (message.dwRequestID != (uint)DataRequest.UserAircraft ||
                        message.dwData.Length == 0 ||
                        message.dwData[0] is not UserAircraftData data ||
                        !simulationRunning)
                    {
                        return;
                    }

                    var sampleTime = clock.ElapsedMilliseconds;
                    if (lastPublished is { } previous &&
                        sampleTime - lastPublishedAt < 1_000 &&
                        !HasMeaningfulChange(previous, data))
                    {
                        return;
                    }

                    lastPublished = data;
                    lastPublishedAt = sampleTime;
                    lastStatus = "position-synced";
                    var now = DateTimeOffset.UtcNow;
                    writer.TryWrite(new TelemetrySnapshot(
                        ++sequence,
                        SimulatorEdition.Msfs2024,
                        true,
                        data.OnGround != 0,
                        data.Latitude,
                        data.Longitude,
                        data.TrueHeadingDegrees,
                        data.GroundSpeedKnots,
                        now,
                        now,
                        clock.ElapsedMilliseconds,
                        HasPosition: true,
                        State: TrackingState.Connected));
                };

                AddTelemetryDefinitions(connection);
                connection.RegisterDataDefineStruct<UserAircraftData>(
                    DataDefinition.UserAircraft);
                connection.SubscribeToSystemEvent(
                    SystemEvent.Simulation,
                    "Sim");
                connection.RequestDataOnSimObject(
                    DataRequest.UserAircraft,
                    DataDefinition.UserAircraft,
                    FlightSimConnect.SIMCONNECT_OBJECT_ID_USER,
                    SIMCONNECT_PERIOD.VISUAL_FRAME,
                    SIMCONNECT_DATA_REQUEST_FLAG.CHANGED,
                    0,
                    4,
                    0);

                var handles = new WaitHandle[] { notification, stop };
                while (!quitReceived && IsMsfs2024Running())
                {
                    var signaled = WaitHandle.WaitAny(
                        handles,
                        TimeSpan.FromSeconds(1));
                    if (signaled == 1)
                    {
                        return;
                    }
                    if (signaled == 0)
                    {
                        connection.ReceiveMessage();
                    }
                }
            }
            catch (COMException)
            {
                PublishStatus(
                    "flight-not-started",
                    connected: false,
                    TrackingState.Connecting);
            }
            catch (DllNotFoundException)
            {
                PublishStatus(
                    "flight-not-started",
                    connected: false,
                    TrackingState.Connecting);
            }
            catch (BadImageFormatException)
            {
                PublishStatus(
                    "flight-not-started",
                    connected: false,
                    TrackingState.Connecting);
            }

            stop.WaitOne(TimeSpan.FromSeconds(1));
        }
    }

    private static void AddTelemetryDefinitions(FlightSimConnect connection)
    {
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "PLANE LATITUDE",
            "degrees",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            0);
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "PLANE LONGITUDE",
            "degrees",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            1);
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "PLANE HEADING DEGREES TRUE",
            "degrees",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            2);
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "SIM ON GROUND",
            "bool",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            3);
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "GROUND VELOCITY",
            "knots",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            4);
    }

    private static bool HasMeaningfulChange(
        UserAircraftData previous,
        UserAircraftData current)
    {
        var headingDelta = Math.Abs(
            ((current.TrueHeadingDegrees -
              previous.TrueHeadingDegrees + 540) % 360) - 180);
        return TelemetryMath.DistanceMeters(
                   previous.Latitude,
                   previous.Longitude,
                   current.Latitude,
                   current.Longitude) >= 0.02 ||
               headingDelta >= 0.05 ||
               Math.Abs(
                   current.GroundSpeedKnots -
                   previous.GroundSpeedKnots) >= 0.05 ||
               (current.OnGround != 0) != (previous.OnGround != 0);
    }
#endif
    private static void RunWithoutRuntime(
        ChannelWriter<TelemetrySnapshot> writer,
        ManualResetEvent stop)
    {
        var sequence = 0L;
        var clock = Stopwatch.StartNew();
        while (!stop.WaitOne(0))
        {
            writer.TryWrite(StatusSample(
                ref sequence,
                connected: false,
                IsMsfs2024Running()
                    ? TrackingState.Connecting
                    : TrackingState.Disconnected,
                clock));
            stop.WaitOne(TimeSpan.FromSeconds(1));
        }
    }
}
