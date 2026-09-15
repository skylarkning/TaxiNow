using System.IO.Compression;
using System.Text;
using TaxiNow.Server.Airports;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class AirportCatalogServiceTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "TaxiNow.Tests",
        Guid.NewGuid().ToString("N"));
    private string _catalogPath = null!;

    public async ValueTask InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        _catalogPath = Path.Combine(_root, "airports.csv.gz");
        await using var file = File.Create(_catalogPath);
        await using var gzip = new GZipStream(file, CompressionLevel.SmallestSize);
        await using var writer = new StreamWriter(gzip, Encoding.UTF8);
        await writer.WriteAsync(
            "\"ident\",\"type\",\"name\",\"latitude_deg\",\"longitude_deg\",\"iso_country\",\"iso_region\",\"municipality\"\n" +
            "\"CYYZ\",\"large_airport\",\"Toronto Pearson International Airport\",43.6777,-79.6248,\"CA\",\"CA-ON\",\"Toronto\"\n" +
            "\"CYTZ\",\"medium_airport\",\"Billy Bishop, Toronto City Airport\",43.6275,-79.3962,\"CA\",\"CA-ON\",\"Toronto\"\n" +
            "\"CPAD\",\"heliport\",\"Ignored Heliport\",43.6778,-79.6249,\"CA\",\"CA-ON\",\"Toronto\"\n");
    }

    public ValueTask DisposeAsync()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
        return ValueTask.CompletedTask;
    }

    [Fact]
    public async Task FindNearest_ReturnsAirportAndParsesQuotedComma()
    {
        var catalog = new AirportCatalogService(_catalogPath);
        var cancellationToken = TestContext.Current.CancellationToken;

        var pearson = await catalog.FindNearestAsync(
            43.68,
            -79.62,
            cancellationToken: cancellationToken);
        var island = await catalog.FindNearestAsync(
            43.628,
            -79.397,
            cancellationToken: cancellationToken);

        Assert.NotNull(pearson);
        Assert.Equal("CYYZ", pearson!.Icao);
        Assert.NotNull(island);
        Assert.Equal("CYTZ", island!.Icao);
        Assert.Equal("Billy Bishop, Toronto City Airport", island.Name);
    }

    [Fact]
    public async Task FindNearest_ReturnsNullOutsideAirportRadius()
    {
        var catalog = new AirportCatalogService(_catalogPath);

        var result = await catalog.FindNearestAsync(
            45.5,
            -73.6,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Null(result);
    }

    [Fact]
    public async Task BundledCatalog_FindsPearson()
    {
        var catalog = new AirportCatalogService();

        var result = await catalog.FindNearestAsync(
            43.6777,
            -79.6248,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.NotNull(result);
        Assert.Equal("CYYZ", result!.Icao);
    }
}
