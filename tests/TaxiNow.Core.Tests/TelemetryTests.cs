using TaxiNow.Core.Telemetry;
using Xunit;

namespace TaxiNow.Core.Tests;

public sealed class TelemetryTests
{
    [Fact]
    public void HeadingInterpolation_CrossesNorthByShortestArc()
    {
        Assert.Equal(0, TelemetryMath.InterpolateHeading(359, 1, 0.5), 8);
        Assert.Equal(0, TelemetryMath.InterpolateHeading(1, 359, 0.5), 8);
    }

    [Fact]
    public void GroundTracking_RequiresThreeConsecutiveSamples()
    {
        var guard = new TelemetryGuard(onGroundSamplesToResume: 3);

        Assert.Equal(TrackingState.Airborne, guard.Accept(Sample(1, true))!.State);
        Assert.Equal(TrackingState.Airborne, guard.Accept(Sample(2, true))!.State);
        Assert.Equal(TrackingState.GroundTracking, guard.Accept(Sample(3, true))!.State);
        Assert.Equal(TrackingState.Airborne, guard.Accept(Sample(4, false))!.State);
    }

    [Fact]
    public void ImpossibleJump_IsRejected()
    {
        var guard = new TelemetryGuard(maximumJumpMeters: 100);

        Assert.NotNull(guard.Accept(Sample(1, true)));
        Assert.Null(guard.Accept(Sample(2, true) with { Latitude = 44.6 }));
    }

    [Fact]
    public void ConsistentPositionAfterLargeGap_ReestablishesTracking()
    {
        var guard = new TelemetryGuard(
            onGroundSamplesToResume: 3,
            maximumJumpMeters: 100,
            jumpRecoverySamples: 3);

        Assert.NotNull(guard.Accept(Sample(1, false)));

        var destination = Sample(2, true) with { Latitude = 44.6 };
        Assert.Null(guard.Accept(destination));
        Assert.Null(guard.Accept(destination with
        {
            Sequence = 3,
            Longitude = destination.Longitude + 0.000001
        }));

        var recovered = guard.Accept(destination with
        {
            Sequence = 4,
            Longitude = destination.Longitude + 0.000002
        });

        Assert.NotNull(recovered);
        Assert.True(recovered!.OnGround);
        Assert.Equal(TrackingState.Airborne, recovered.State);
        Assert.Equal(
            TrackingState.Airborne,
            guard.Accept(destination with
            {
                Sequence = 5,
                Longitude = destination.Longitude + 0.000003
            })!.State);
        Assert.Equal(
            TrackingState.GroundTracking,
            guard.Accept(destination with
            {
                Sequence = 6,
                Longitude = destination.Longitude + 0.000004
            })!.State);
    }

    [Fact]
    public void SingleBadJump_DoesNotReplaceLastKnownPosition()
    {
        var guard = new TelemetryGuard(maximumJumpMeters: 100);

        Assert.NotNull(guard.Accept(Sample(1, true)));
        Assert.Null(guard.Accept(Sample(2, true) with { Latitude = 44.6 }));
        Assert.NotNull(guard.Accept(Sample(3, true)));
    }

    [Fact]
    public void ConnectionStatus_ResetsPositionJumpHistory()
    {
        var guard = new TelemetryGuard(maximumJumpMeters: 100);
        var status = Sample(2, false) with
        {
            Connected = false,
            HasPosition = false,
            State = TrackingState.Disconnected
        };

        Assert.NotNull(guard.Accept(Sample(1, true)));
        Assert.Equal(
            TrackingState.Disconnected,
            guard.Accept(status)!.State);
        Assert.NotNull(guard.Accept(
            Sample(3, true) with { Latitude = 44.6 }));
    }

    [Fact]
    public void RefreshSignal_IsAutoReset()
    {
        using var signal = new TelemetryRefreshSignal();

        signal.Request();

        Assert.True(signal.WaitHandle.WaitOne(0));
        Assert.False(signal.WaitHandle.WaitOne(0));
    }

    private static TelemetrySnapshot Sample(long sequence, bool onGround)
    {
        var now = DateTimeOffset.UtcNow;
        return new TelemetrySnapshot(
            sequence,
            SimulatorEdition.Replay,
            true,
            onGround,
            43.6762,
            -79.6306 + sequence * 0.000001,
            359 + sequence,
            5,
            now,
            now,
            sequence * 100);
    }
}
