using System.Buffers.Binary;
using System.Text;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Configuration;
using TaxiNow.Core.Telemetry;
using TaxiNow.Server.XPlane;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class XPlaneTelemetryTests
{
    [Fact]
    public void SubscriptionPacket_UsesTheOfficialRrefLayout()
    {
        var packet = XPlaneRrefCodec.CreateSubscription(20, 7, "sim/flightmodel/position/latitude");

        Assert.Equal(413, packet.Length);
        Assert.Equal("RREF\0", Encoding.ASCII.GetString(packet, 0, 5));
        Assert.Equal(20, BinaryPrimitives.ReadInt32LittleEndian(packet.AsSpan(5, 4)));
        Assert.Equal(7, BinaryPrimitives.ReadInt32LittleEndian(packet.AsSpan(9, 4)));
        Assert.Equal("sim/flightmodel/position/latitude", Encoding.ASCII.GetString(packet, 13, 33));
    }

    [Fact]
    public void ResponsePacket_ReturnsIndexedFloatValues()
    {
        var packet = new byte[21];
        "RREF,"u8.CopyTo(packet);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(5, 4), 0);
        BinaryPrimitives.WriteSingleLittleEndian(packet.AsSpan(9, 4), 43.68466f);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(13, 4), 3);
        BinaryPrimitives.WriteSingleLittleEndian(packet.AsSpan(17, 4), 237.5f);

        var values = XPlaneRrefCodec.ParseResponse(packet);

        Assert.Equal(43.68466f, values[0]);
        Assert.Equal(237.5f, values[3]);
    }

    [Fact]
    public async Task XPlaneTelemetrySource_ReceivesAnXPlane12PositionOverUdp()
    {
        using var simulator = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var port = ((IPEndPoint)simulator.Client.LocalEndPoint!).Port;
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["TaxiNow:XPlane:Port"] = port.ToString()
        }).Build();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var source = new XPlaneTelemetrySource(configuration);
        await using var samples = source.ReadAllAsync(timeout.Token).GetAsyncEnumerator(timeout.Token);

        var next = samples.MoveNextAsync().AsTask();
        var request = await simulator.ReceiveAsync(timeout.Token);
        await simulator.SendAsync(
            CreateResponse(
                43.68f,
                -79.62f,
                237.5f,
                10f,
                0f,
                3762.756f,
                914.4f),
            request.RemoteEndPoint,
            timeout.Token);

        Assert.True(await next);
        Assert.Equal(SimulatorEdition.XPlane12, samples.Current.Simulator);
        Assert.Equal(43.68, samples.Current.Latitude, 2);
        Assert.Equal(-79.62, samples.Current.Longitude, 2);
        Assert.Equal(237.5, samples.Current.TrueHeadingDegrees, 1);
        Assert.Equal(19.44, samples.Current.GroundSpeedKnots, 2);
        Assert.False(samples.Current.OnGround);
        Assert.Equal(12_345, samples.Current.AltitudeMslFeet!.Value, 0);
        Assert.Equal(3_000, samples.Current.AltitudeAglFeet!.Value, 0);
    }

    private static byte[] CreateResponse(params float[] values)
    {
        var packet = new byte[5 + values.Length * 8];
        "RREF,"u8.CopyTo(packet);
        for (var index = 0; index < values.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(5 + index * 8, 4), index);
            BinaryPrimitives.WriteSingleLittleEndian(packet.AsSpan(9 + index * 8, 4), values[index]);
        }
        return packet;
    }
}
