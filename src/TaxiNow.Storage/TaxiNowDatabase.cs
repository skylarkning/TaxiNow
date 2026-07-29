using Microsoft.Data.Sqlite;

namespace TaxiNow.Storage;

public sealed class TaxiNowDatabase(StoragePaths paths)
{
    public string ConnectionString => new SqliteConnectionStringBuilder
    {
        DataSource = paths.DatabasePath,
        Mode = SqliteOpenMode.ReadWriteCreate,
        Cache = SqliteCacheMode.Shared,
        ForeignKeys = true,
        Pooling = false
    }.ToString();

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        paths.EnsureCreated();
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS airports (
                icao TEXT PRIMARY KEY COLLATE NOCASE,
                name TEXT NOT NULL,
                country_code TEXT NOT NULL,
                region_code TEXT NULL,
                municipality TEXT NULL,
                center_lon REAL NOT NULL,
                center_lat REAL NOT NULL,
                min_lon REAL NOT NULL,
                max_lon REAL NOT NULL,
                min_lat REAL NOT NULL,
                max_lat REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS map_assets (
                icao TEXT PRIMARY KEY COLLATE NOCASE
                    REFERENCES airports(icao) ON DELETE CASCADE,
                relative_path TEXT NOT NULL UNIQUE,
                size_bytes INTEGER NOT NULL,
                generated_at TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                source_mix TEXT NOT NULL,
                warning TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS asset_sources (
                icao TEXT NOT NULL COLLATE NOCASE
                    REFERENCES map_assets(icao) ON DELETE CASCADE,
                name TEXT NOT NULL,
                url TEXT NULL,
                license TEXT NULL,
                retrieved_at TEXT NOT NULL,
                revision TEXT NULL,
                PRIMARY KEY (icao, name)
            );

            CREATE TABLE IF NOT EXISTS source_attempts (
                cache_key TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                succeeded INTEGER NOT NULL,
                failure_kind TEXT NULL,
                reason TEXT NULL,
                retry_after TEXT NULL,
                attempted_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS download_jobs (
                job_id TEXT PRIMARY KEY,
                mode TEXT NOT NULL,
                state TEXT NOT NULL,
                request_json TEXT NOT NULL,
                progress_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS airport_bounds USING rtree(
                row_id,
                min_lon,
                max_lon,
                min_lat,
                max_lat
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
