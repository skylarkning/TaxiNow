using System.Globalization;
using System.IO.Compression;
using Microsoft.Data.Sqlite;
using TaxiNow.Core.Airports;

namespace TaxiNow.Storage;

public sealed class MapAssetStore(TaxiNowDatabase database, StoragePaths paths)
{
    public async Task<StoredMapAsset> ImportAsync(
        Stream jsonStream,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(jsonStream);
        using var reader = new StreamReader(
            jsonStream,
            leaveOpen: true);
        var json = await reader.ReadToEndAsync(cancellationToken);
        var map = AirportMapJson.Read(json);
        var icao = map.Airport.Icao.Trim().ToUpperInvariant();

        paths.EnsureCreated();
        var finalName = $"{icao}.json.gz";
        var finalPath = Path.Combine(paths.MapsPath, finalName);
        var tempPath = Path.Combine(paths.MapsPath, $".{finalName}.{Guid.NewGuid():N}.tmp");
        try
        {
            await WriteCompressedAsync(tempPath, json, cancellationToken);
            var sizeBytes = new FileInfo(tempPath).Length;
            var importedAt = DateTimeOffset.UtcNow;

            await using var connection = new SqliteConnection(database.ConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var transaction = (SqliteTransaction)
                await connection.BeginTransactionAsync(cancellationToken);
            await UpsertMetadataAsync(
                connection,
                transaction,
                map,
                finalName,
                sizeBytes,
                importedAt,
                cancellationToken);

            File.Move(tempPath, finalPath, overwrite: true);
            await transaction.CommitAsync(cancellationToken);
            return ToStoredAsset(map, finalName, sizeBytes, importedAt);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    public async Task<string?> ReadJsonAsync(
        string icao,
        CancellationToken cancellationToken = default)
    {
        var path = await GetAssetPathAsync(icao, cancellationToken);
        if (path is null || !File.Exists(path))
        {
            return null;
        }

        await using var file = File.OpenRead(path);
        await using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        return await reader.ReadToEndAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(
        string icao,
        CancellationToken cancellationToken = default)
    {
        await using var connection = new SqliteConnection(database.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        var relativePath = await ReadRelativePathAsync(connection, icao, cancellationToken);
        if (relativePath is null)
        {
            return false;
        }

        await using var transaction = (SqliteTransaction)
            await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM airports WHERE icao = $icao;";
        command.Parameters.AddWithValue("$icao", icao.Trim().ToUpperInvariant());
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var fullPath = Path.Combine(paths.MapsPath, relativePath);
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        return true;
    }

    public async Task<StorageSummary> GetSummaryAsync(
        CancellationToken cancellationToken = default)
    {
        var countries = new List<StorageGroupSummary>();
        await using var connection = new SqliteConnection(database.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT a.country_code, COUNT(*), COALESCE(SUM(m.size_bytes), 0)
            FROM map_assets m
            JOIN airports a ON a.icao = m.icao
            GROUP BY a.country_code
            ORDER BY a.country_code;
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            countries.Add(new StorageGroupSummary(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.GetInt64(2)));
        }

        var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(paths.Root))!);
        return new StorageSummary(
            countries.Sum(static group => group.SizeBytes),
            drive.AvailableFreeSpace,
            countries.Sum(static group => group.AirportCount),
            countries);
    }

    private async Task<string?> GetAssetPathAsync(
        string icao,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection(database.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        var relativePath = await ReadRelativePathAsync(connection, icao, cancellationToken);
        return relativePath is null ? null : Path.Combine(paths.MapsPath, relativePath);
    }

    private static async Task<string?> ReadRelativePathAsync(
        SqliteConnection connection,
        string icao,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT relative_path FROM map_assets WHERE icao = $icao;";
        command.Parameters.AddWithValue("$icao", icao.Trim().ToUpperInvariant());
        return (string?)await command.ExecuteScalarAsync(cancellationToken);
    }

    private static async Task WriteCompressedAsync(
        string path,
        string json,
        CancellationToken cancellationToken)
    {
        await using var file = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 64 * 1024,
            useAsync: true);
        await using var gzip = new GZipStream(file, CompressionLevel.SmallestSize);
        await using var writer = new StreamWriter(gzip);
        await writer.WriteAsync(json.AsMemory(), cancellationToken);
    }

    private static async Task UpsertMetadataAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        AirportMap map,
        string relativePath,
        long sizeBytes,
        DateTimeOffset importedAt,
        CancellationToken cancellationToken)
    {
        var airport = map.Airport;
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText =
                """
                INSERT INTO airports (
                    icao, name, country_code, region_code, municipality,
                    center_lon, center_lat, min_lon, max_lon, min_lat, max_lat)
                VALUES (
                    $icao, $name, $country, $region, $municipality,
                    $centerLon, $centerLat, $minLon, $maxLon, $minLat, $maxLat)
                ON CONFLICT(icao) DO UPDATE SET
                    name = excluded.name,
                    country_code = excluded.country_code,
                    region_code = excluded.region_code,
                    municipality = excluded.municipality,
                    center_lon = excluded.center_lon,
                    center_lat = excluded.center_lat,
                    min_lon = excluded.min_lon,
                    max_lon = excluded.max_lon,
                    min_lat = excluded.min_lat,
                    max_lat = excluded.max_lat;
                """;
            AddAirportParameters(command, airport);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText =
                """
                INSERT INTO map_assets (
                    icao, relative_path, size_bytes, generated_at, imported_at,
                    source_mix, warning)
                VALUES (
                    $icao, $path, $size, $generated, $imported, $sources, NULL)
                ON CONFLICT(icao) DO UPDATE SET
                    relative_path = excluded.relative_path,
                    size_bytes = excluded.size_bytes,
                    generated_at = excluded.generated_at,
                    imported_at = excluded.imported_at,
                    source_mix = excluded.source_mix,
                    warning = excluded.warning;
                """;
            command.Parameters.AddWithValue("$icao", airport.Icao.ToUpperInvariant());
            command.Parameters.AddWithValue("$path", relativePath);
            command.Parameters.AddWithValue("$size", sizeBytes);
            command.Parameters.AddWithValue("$generated", map.GeneratedAt.ToString("O"));
            command.Parameters.AddWithValue("$imported", importedAt.ToString("O"));
            command.Parameters.AddWithValue(
                "$sources",
                string.Join(", ", map.Sources.Select(static source => source.Name).Distinct()));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var deleteSources = connection.CreateCommand())
        {
            deleteSources.Transaction = transaction;
            deleteSources.CommandText = "DELETE FROM asset_sources WHERE icao = $icao;";
            deleteSources.Parameters.AddWithValue("$icao", airport.Icao.ToUpperInvariant());
            await deleteSources.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var source in map.Sources)
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText =
                """
                INSERT INTO asset_sources (
                    icao, name, url, license, retrieved_at, revision)
                VALUES ($icao, $name, $url, $license, $retrieved, $revision);
                """;
            command.Parameters.AddWithValue("$icao", airport.Icao.ToUpperInvariant());
            command.Parameters.AddWithValue("$name", source.Name);
            command.Parameters.AddWithValue("$url", (object?)source.Url ?? DBNull.Value);
            command.Parameters.AddWithValue("$license", (object?)source.License ?? DBNull.Value);
            command.Parameters.AddWithValue("$retrieved", source.RetrievedAt.ToString("O"));
            command.Parameters.AddWithValue("$revision", (object?)source.Revision ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static void AddAirportParameters(
        SqliteCommand command,
        AirportMetadata airport)
    {
        command.Parameters.AddWithValue("$icao", airport.Icao.ToUpperInvariant());
        command.Parameters.AddWithValue("$name", airport.Name);
        command.Parameters.AddWithValue("$country", airport.CountryCode);
        command.Parameters.AddWithValue("$region", (object?)airport.RegionCode ?? DBNull.Value);
        command.Parameters.AddWithValue(
            "$municipality",
            (object?)airport.Municipality ?? DBNull.Value);
        command.Parameters.AddWithValue("$centerLon", airport.Center[0]);
        command.Parameters.AddWithValue("$centerLat", airport.Center[1]);
        command.Parameters.AddWithValue("$minLon", airport.Bounds.MinLon);
        command.Parameters.AddWithValue("$maxLon", airport.Bounds.MaxLon);
        command.Parameters.AddWithValue("$minLat", airport.Bounds.MinLat);
        command.Parameters.AddWithValue("$maxLat", airport.Bounds.MaxLat);
    }

    private static StoredMapAsset ToStoredAsset(
        AirportMap map,
        string relativePath,
        long sizeBytes,
        DateTimeOffset importedAt) =>
        new(
            map.Airport.Icao,
            map.Airport.Name,
            map.Airport.CountryCode,
            map.Airport.RegionCode,
            map.Airport.Municipality,
            relativePath,
            sizeBytes,
            map.GeneratedAt,
            importedAt,
            string.Join(", ", map.Sources.Select(static source => source.Name).Distinct()),
            null);
}
