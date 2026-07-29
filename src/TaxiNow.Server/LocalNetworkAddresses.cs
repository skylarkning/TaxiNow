using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace TaxiNow.Server;

internal static class LocalNetworkAddresses
{
    public static IReadOnlyList<string> GetUrls(int port)
    {
        var addresses = GetAddresses();
        return addresses.Count > 0
            ? addresses.Select(address => $"http://{address}:{port}").ToArray()
            : [$"http://localhost:{port}"];
    }

    public static IReadOnlyList<IPAddress> GetAddresses()
    {
        var preferred = GetPreferredAddress();
        var addresses = NetworkInterface
            .GetAllNetworkInterfaces()
            .Where(static network =>
                network.OperationalStatus == OperationalStatus.Up &&
                network.NetworkInterfaceType is not
                    NetworkInterfaceType.Loopback and not
                    NetworkInterfaceType.Tunnel)
            .SelectMany(static network =>
                network.GetIPProperties().UnicastAddresses)
            .Select(static address => address.Address)
            .Where(static address =>
                address.AddressFamily == AddressFamily.InterNetwork &&
                !IPAddress.IsLoopback(address) &&
                !address.Equals(IPAddress.Any) &&
                IsPrivateAddress(address) &&
                !address.ToString().StartsWith(
                    "169.254.",
                    StringComparison.Ordinal))
            .Distinct()
            .OrderByDescending(address => address.Equals(preferred))
            .ThenByDescending(IsPrivateAddress)
            .ThenBy(static address => address.ToString(), StringComparer.Ordinal)
            .ToArray();

        return addresses;
    }

    private static IPAddress? GetPreferredAddress()
    {
        try
        {
            using var socket = new Socket(
                AddressFamily.InterNetwork,
                SocketType.Dgram,
                ProtocolType.Udp);
            socket.Connect(IPAddress.Parse("8.8.8.8"), 65530);
            return (socket.LocalEndPoint as IPEndPoint)?.Address;
        }
        catch (SocketException)
        {
            return null;
        }
    }

    private static bool IsPrivateAddress(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes[0] == 10 ||
               bytes[0] == 192 && bytes[1] == 168 ||
               bytes[0] == 172 && bytes[1] is >= 16 and <= 31;
    }
}
