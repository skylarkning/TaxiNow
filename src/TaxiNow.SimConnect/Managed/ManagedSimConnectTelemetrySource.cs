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
    private readonly TelemetryRefreshSignal refreshSignal;

    public ManagedSimConnectTelemetrySource(TelemetryRefreshSignal refreshSignal)
    {
        this.refreshSignal = refreshSignal;
    }

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

    private void RunOwner(
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

    private static TelemetrySnapshot StatusSample(
        ref long sequence,
        SimulatorEdition edition,
        bool connected,
        TrackingState state,
        Stopwatch clock)
    {
        var now = DateTimeOffset.UtcNow;
        return new TelemetrySnapshot(
            ++sequence,
            edition,
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
        UserAircraft = 1,
        UserAircraftRefresh = 2
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
        public double AltitudeMslFeet;
        public double AltitudeAglFeet;
    }

    private void RunManagedOwner(
        ChannelWriter<TelemetrySnapshot> writer,
        ManualResetEvent stop)
    {
        var sequence = 0L;
        var clock = Stopwatch.StartNew();
        var lastStatus = string.Empty;
        void PublishStatus(
            string key,
            SimulatorEdition edition,
            bool connected,
            TrackingState state)
        {
            var editionKey = $"{edition}:{key}";
            if (editionKey == lastStatus)
            {
                return;
            }

            lastStatus = editionKey;
            writer.TryWrite(
                StatusSample(
                    ref sequence,
                    edition,
                    connected,
                    state,
                    clock));
        }

        while (!stop.WaitOne(0))
        {
            var edition = SimulatorProcessDetector.GetRunningEdition();
            if (edition == SimulatorEdition.Unknown)
            {
                PublishStatus(
                    "simulator-not-running",
                    SimulatorEdition.Unknown,
                    connected: false,
                    TrackingState.Disconnected);
                stop.WaitOne(TimeSpan.FromSeconds(1));
                continue;
            }

            PublishStatus(
                "waiting-for-flight",
                edition,
                connected: false,
                TrackingState.Connecting);
            using var notification = new AutoResetEvent(false);
            var connectionStage = "opening connection";
            try
            {
                using var connection = new FlightSimConnect(
                    "TaxiNow",
                    IntPtr.Zero,
                    0,
                    notification,
                    0);
                connectionStage = "configuring telemetry";
                var quitReceived = false;
                var simulationRunning = false;
                UserAircraftData? lastPublished = null;
                var lastPublishedAt = -1L;
                var lastDataReceivedAt = -1L;
                var positionHealthy = false;

                connection.OnRecvOpen += (_, _) =>
                    PublishStatus(
                        "flight-not-started",
                        edition,
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
                        lastDataReceivedAt = -1;
                        positionHealthy = false;
                        PublishStatus(
                            "flight-not-started",
                            edition,
                            connected: true,
                            TrackingState.Connecting);
                    }
                };
                connection.OnRecvSimobjectData += (_, message) =>
                {
                    var forced =
                        message.dwRequestID ==
                        (uint)DataRequest.UserAircraftRefresh;
                    if ((!forced &&
                         message.dwRequestID !=
                         (uint)DataRequest.UserAircraft) ||
                        message.dwData.Length == 0 ||
                        message.dwData[0] is not UserAircraftData data ||
                        !simulationRunning)
                    {
                        return;
                    }

                    var sampleTime = clock.ElapsedMilliseconds;
                    lastDataReceivedAt = sampleTime;
                    positionHealthy = true;
                    if (lastPublished is { } previous &&
                        !forced &&
                        sampleTime - lastPublishedAt < 1_000 &&
                        !HasMeaningfulChange(previous, data))
                    {
                        return;
                    }

                    lastPublished = data;
                    lastPublishedAt = sampleTime;
                    lastStatus = $"{edition}:position-synced";
                    var now = DateTimeOffset.UtcNow;
                    writer.TryWrite(new TelemetrySnapshot(
                        ++sequence,
                        edition,
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
                        State: TrackingState.Connected,
                        AltitudeMslFeet: data.AltitudeMslFeet,
                        AltitudeAglFeet: data.AltitudeAglFeet));
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
                    SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT,
                    0,
                    4,
                    0);
                connectionStage = "receiving messages";

                var handles = new[]
                {
                    notification,
                    refreshSignal.WaitHandle,
                    stop
                };
                var nextProcessCheckAt = clock.ElapsedMilliseconds + 1_000;
                while (!quitReceived)
                {
                    var signaled = WaitHandle.WaitAny(
                        handles,
                        TimeSpan.FromSeconds(1));
                    if (signaled == 2)
                    {
                        return;
                    }
                    if (signaled == 0 ||
                        signaled == WaitHandle.WaitTimeout)
                    {
                        // MSFS 2020 can occasionally leave the managed
                        // notification event unsignaled even though a
                        // SimConnect message is waiting. The one-second
                        // timeout keeps 2024 event-driven and provides a
                        // low-cost compatibility pump for 2020.
                        connection.ReceiveMessage();
                    }
                    else if (signaled == 1)
                    {
                        connection.RequestDataOnSimObject(
                            DataRequest.UserAircraftRefresh,
                            DataDefinition.UserAircraft,
                            FlightSimConnect.SIMCONNECT_OBJECT_ID_USER,
                            SIMCONNECT_PERIOD.ONCE,
                            SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT,
                            0,
                            0,
                            0);
                    }

                    var loopTime = clock.ElapsedMilliseconds;
                    if (loopTime >= nextProcessCheckAt)
                    {
                        nextProcessCheckAt = loopTime + 1_000;
                        if (!SimulatorProcessDetector.IsRunning(edition))
                        {
                            break;
                        }
                    }

                    if (simulationRunning &&
                        positionHealthy &&
                        lastDataReceivedAt >= 0 &&
                        loopTime - lastDataReceivedAt > 4_000)
                    {
                        lastPublished = null;
                        positionHealthy = false;
                        PublishStatus(
                            "flight-not-started",
                            edition,
                            connected: true,
                            TrackingState.Connecting);
                    }
                }
            }
            catch (COMException error)
            {
                Console.Error.WriteLine(
                    $"TaxiNow SimConnect ({edition}) COM error " +
                    $"while {connectionStage}, 0x{error.HResult:X8}: " +
                    error.Message);
                PublishStatus(
                    "flight-not-started",
                    edition,
                    connected: false,
                    TrackingState.Connecting);
            }
            catch (DllNotFoundException error)
            {
                Console.Error.WriteLine(
                    $"TaxiNow SimConnect ({edition}) runtime error: " +
                    error.Message);
                PublishStatus(
                    "flight-not-started",
                    edition,
                    connected: false,
                    TrackingState.Connecting);
            }
            catch (BadImageFormatException error)
            {
                Console.Error.WriteLine(
                    $"TaxiNow SimConnect ({edition}) architecture error: " +
                    error.Message);
                PublishStatus(
                    "flight-not-started",
                    edition,
                    connected: false,
                    TrackingState.Connecting);
            }

            var nextEdition = SimulatorProcessDetector.GetRunningEdition();
            PublishStatus(
                nextEdition != SimulatorEdition.Unknown
                    ? "waiting-for-flight"
                    : "simulator-not-running",
                nextEdition,
                connected: false,
                nextEdition != SimulatorEdition.Unknown
                    ? TrackingState.Connecting
                    : TrackingState.Disconnected);
            WaitHandle.WaitAny(
                new[] { refreshSignal.WaitHandle, stop },
                TimeSpan.FromSeconds(1));
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
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "PLANE ALTITUDE",
            "feet",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            5);
        connection.AddToDataDefinition(
            DataDefinition.UserAircraft,
            "PLANE ALT ABOVE GROUND",
            "feet",
            SIMCONNECT_DATATYPE.FLOAT64,
            0,
            6);
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
               Math.Abs(
                   current.AltitudeMslFeet -
                   previous.AltitudeMslFeet) >= 1 ||
               Math.Abs(
                   current.AltitudeAglFeet -
                   previous.AltitudeAglFeet) >= 1 ||
               (current.OnGround != 0) != (previous.OnGround != 0);
    }
#endif
    private void RunWithoutRuntime(
        ChannelWriter<TelemetrySnapshot> writer,
        ManualResetEvent stop)
    {
        var sequence = 0L;
        var clock = Stopwatch.StartNew();
        while (!stop.WaitOne(0))
        {
            var edition = SimulatorProcessDetector.GetRunningEdition();
            writer.TryWrite(StatusSample(
                ref sequence,
                edition,
                connected: false,
                edition != SimulatorEdition.Unknown
                    ? TrackingState.Connecting
                    : TrackingState.Disconnected,
                clock));
            WaitHandle.WaitAny(
                new[] { refreshSignal.WaitHandle, stop },
                TimeSpan.FromSeconds(1));
        }
    }
}
