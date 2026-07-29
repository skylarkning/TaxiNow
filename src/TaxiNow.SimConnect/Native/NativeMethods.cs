using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using TaxiNow.Core.Telemetry;

namespace TaxiNow.SimConnect.Native;

internal static partial class NativeMethods
{
    private const string LibraryName = "TaxiNow.SimConnect.Native";

    [LibraryImport(LibraryName, EntryPoint = "taxinow_simconnect_create")]
    private static partial nint CreateRaw();

    internal static NativeBridgeHandle Create() => new(CreateRaw());

    [LibraryImport(LibraryName, EntryPoint = "taxinow_simconnect_start")]
    internal static partial int Start(NativeBridgeHandle handle);

    [LibraryImport(LibraryName, EntryPoint = "taxinow_simconnect_stop")]
    internal static partial void Stop(NativeBridgeHandle handle);

    [LibraryImport(LibraryName, EntryPoint = "taxinow_simconnect_latest")]
    internal static partial int Latest(
        NativeBridgeHandle handle,
        ref NativeTelemetrySnapshot snapshot);

    [LibraryImport(LibraryName, EntryPoint = "taxinow_simconnect_destroy")]
    private static partial void Destroy(nint handle);

    internal sealed class NativeBridgeHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal NativeBridgeHandle(nint nativeHandle) : base(ownsHandle: true)
        {
            SetHandle(nativeHandle);
        }

        protected override bool ReleaseHandle()
        {
            Destroy(handle);
            return true;
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 8)]
    internal struct NativeTelemetrySnapshot
    {
        public uint Size;
        public uint AbiVersion;
        public ulong Sequence;
        public int Connected;
        public int OnGround;
        public double Latitude;
        public double Longitude;
        public double TrueHeadingDegrees;
        public double GroundSpeedKnots;
        public long SourceMonotonicMilliseconds;
        public int SimulatorEdition;
    }
}
