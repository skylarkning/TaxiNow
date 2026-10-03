using System.Buffers.Binary;
using System.Text;

namespace TaxiNow.Server.XPlane;

public static class XPlaneRrefCodec
{
    public static byte[] CreateSubscription(int frequency, int index, string dataref)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataref);
        var name = Encoding.ASCII.GetBytes(dataref);
        if (name.Length > 399) throw new ArgumentOutOfRangeException(nameof(dataref));
        var packet = new byte[413];
        "RREF\0"u8.CopyTo(packet);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(5, 4), frequency);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(9, 4), index);
        name.CopyTo(packet, 13);
        return packet;
    }

    public static IReadOnlyDictionary<int, float> ParseResponse(ReadOnlySpan<byte> packet)
    {
        var values = new Dictionary<int, float>();
        if (packet.Length < 13 || !packet[..5].SequenceEqual("RREF,"u8)) return values;
        for (var offset = 5; offset + 8 <= packet.Length; offset += 8)
        {
            var index = BinaryPrimitives.ReadInt32LittleEndian(packet.Slice(offset, 4));
            var value = BinaryPrimitives.ReadSingleLittleEndian(packet.Slice(offset + 4, 4));
            if (float.IsFinite(value)) values[index] = value;
        }
        return values;
    }
}
