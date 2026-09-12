using TaxiNow.Core.Telemetry;
using TaxiNow.SimConnect.Replay;
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

    [Fact]
    public void TelemetrySnapshot_AltitudeIsOptionalForExistingCallers()
    {
        var sample = Sample(1, true);

        Assert.Null(sample.AltitudeMslFeet);
        Assert.Null(sample.AltitudeAglFeet);
    }

    [Fact]
    public async Task ReplayTelemetrySource_ForwardsAltitudeWhenPresent()
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            $"taxinow-altitude-{Guid.NewGuid():N}.jsonl");
        await File.WriteAllTextAsync(
            path,
            """
            {"tMs":0,"lat":43.68,"lon":-79.62,"heading":237.5,"groundSpeed":10,"onGround":false,"altitudeMslFeet":12345,"altitudeAglFeet":3000}
            """,
            TestContext.Current.CancellationToken);

        try
        {
            var source = new ReplayTelemetrySource(path, loop: false);
            await using var samples = source
                .ReadAllAsync(TestContext.Current.CancellationToken)
                .GetAsyncEnumerator(TestContext.Current.CancellationToken);

            Assert.True(await samples.MoveNextAsync());
            Assert.Equal(12_345, samples.Current.AltitudeMslFeet);
            Assert.Equal(3_000, samples.Current.AltitudeAglFeet);
        }
        finally
        {
            File.Delete(path);
        }
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
