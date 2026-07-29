using System.Text.Json;
using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Storage.Tests;

public sealed class MapAssetStoreTests : IAsyncLifetime
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), "TaxiNow.Tests", Guid.NewGuid().ToString("N"));
    private StoragePaths _paths = null!;
    private MapAssetStore _store = null!;

    public async ValueTask InitializeAsync()
    {
        _paths = new StoragePaths(_root);
        var database = new TaxiNowDatabase(_paths);
        await database.InitializeAsync(TestContext.Current.CancellationToken);
        _store = new MapAssetStore(database, _paths);
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
    public async Task Import_IsCompressedReadableAndAggregated()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        await using var fixture = File.OpenRead(
            Path.Combine(AppContext.BaseDirectory, "fixtures", "CYYZ.v2.json"));

        var asset = await _store.ImportAsync(fixture, cancellationToken);
        var json = await _store.ReadJsonAsync("cyyz", cancellationToken);
        var summary = await _store.GetSummaryAsync(cancellationToken);

        Assert.Equal("CYYZ", asset.Icao);
        Assert.NotNull(json);
        using var document = JsonDocument.Parse(json);
        Assert.Equal(
            2,
            document.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.True(File.Exists(Path.Combine(_paths.MapsPath, "CYYZ.json.gz")));
        Assert.Equal(1, summary.AirportCount);
        Assert.True(summary.TotalBytes > 0);
        var stored = Assert.Single(summary.Assets);
        Assert.Equal("CYYZ", stored.Icao);
        Assert.Equal("CA", Assert.Single(summary.Countries).Code);
    }

    [Fact]
    public async Task Delete_RemovesDatabaseRowAndAsset()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        await using var fixture = File.OpenRead(
            Path.Combine(AppContext.BaseDirectory, "fixtures", "CYYZ.v2.json"));
        await _store.ImportAsync(fixture, cancellationToken);

        Assert.True(await _store.DeleteAsync("CYYZ", cancellationToken));
        Assert.Null(await _store.ReadJsonAsync("CYYZ", cancellationToken));
        Assert.False(File.Exists(Path.Combine(_paths.MapsPath, "CYYZ.json.gz")));
    }
}
