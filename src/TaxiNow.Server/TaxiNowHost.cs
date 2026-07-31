using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using TaxiNow.Core.Airports;
using TaxiNow.Core.Telemetry;
using TaxiNow.Server.Airports;
using TaxiNow.Server.Downloads;
using TaxiNow.Server.Telemetry;
using TaxiNow.SimConnect.Managed;
using TaxiNow.SimConnect.Replay;
using TaxiNow.Storage;

namespace TaxiNow.Server;

public static class TaxiNowHost
{
    public const int DefaultPort = 8780;

    public static WebApplication Build(
        string[]? args = null,
        Action<WebApplicationBuilder>? configure = null)
    {
        var options = new WebApplicationOptions
        {
            Args = args ?? [],
            ContentRootPath = AppContext.BaseDirectory,
            WebRootPath = ResolveWebRoot()
        };
        var builder = WebApplication.CreateBuilder(options);
        configure?.Invoke(builder);
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            var port =
                builder.Configuration.GetValue("TaxiNow:Port", DefaultPort);
            kestrel.ListenLocalhost(port);
            foreach (var address in LocalNetworkAddresses.GetAddresses())
            {
                kestrel.Listen(address, port);
            }
        });
        builder.Services.Configure<JsonOptions>(json =>
        {
            json.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            json.SerializerOptions.Converters.Add(
                new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        });
        builder.Services.AddSignalR().AddJsonProtocol(protocol =>
        {
            protocol.PayloadSerializerOptions.PropertyNamingPolicy =
                JsonNamingPolicy.CamelCase;
            protocol.PayloadSerializerOptions.Converters.Add(
                new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        });

        var storageRoot = builder.Configuration["TaxiNow:StorageRoot"];
        var storagePaths = string.IsNullOrWhiteSpace(storageRoot)
            ? StoragePaths.Default
            : new StoragePaths(Path.GetFullPath(storageRoot));
        builder.Services.AddSingleton(storagePaths);
        builder.Services.AddSingleton<TaxiNowDatabase>();
        builder.Services.AddSingleton<MapAssetStore>();
        builder.Services.AddSingleton<AirportFixtureService>();
        builder.Services.AddSingleton<TelemetryState>();
        builder.Services.AddSingleton<TelemetryRefreshSignal>();
        builder.Services.AddSingleton<DownloadJobService>();
        builder.Services.AddSingleton<ITelemetrySource>(services =>
        {
            var configuration = services.GetRequiredService<IConfiguration>();
            var replayPath = configuration["TaxiNow:ReplayPath"];
            var mode = ResolveTelemetryMode(configuration);
            if (mode != "replay")
            {
                return new ManagedSimConnectTelemetrySource(
                    services.GetRequiredService<TelemetryRefreshSignal>());
            }

            if (string.IsNullOrWhiteSpace(replayPath))
            {
                replayPath = Path.Combine(
                    AppContext.BaseDirectory,
                    "fixtures",
                    "telemetry",
                    "cyyz-taxi.jsonl");
            }

            return new ReplayTelemetrySource(
                Path.GetFullPath(replayPath),
                configuration.GetValue("TaxiNow:ReplaySpeed", 1d),
                configuration.GetValue("TaxiNow:ReplayLoop", true));
        });
        builder.Services.AddHostedService<TelemetryPublisher>();

        var app = builder.Build();
        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = context =>
            {
                context.Context.Response.Headers.CacheControl =
                    string.Equals(
                        context.File.Name,
                        "index.html",
                        StringComparison.OrdinalIgnoreCase)
                        ? "no-cache"
                        : "public,max-age=31536000,immutable";
            }
        });

        MapApi(app);
        app.MapHub<TelemetryHub>("/hubs/telemetry");
        app.MapFallbackToFile("index.html");

        Task.Run(() => Initialize(app)).GetAwaiter().GetResult();
        return app;
    }

    private static async Task Initialize(WebApplication app)
    {
        await app.Services
            .GetRequiredService<TaxiNowDatabase>()
            .InitializeAsync()
            .ConfigureAwait(false);
        await app.Services
            .GetRequiredService<AirportFixtureService>()
            .EnsureImportedAsync()
            .ConfigureAwait(false);
    }

    private static void MapApi(WebApplication app)
    {
        app.MapGet("/api/v1/status", (
            TelemetryState telemetry,
            IConfiguration configuration) =>
        {
            var sample = telemetry.Latest;
            var port = configuration.GetValue("TaxiNow:Port", DefaultPort);
            var localUrls = LocalNetworkAddresses.GetUrls(port);
            var mode = ResolveTelemetryMode(configuration);
            return Results.Ok(new
            {
                product = "TaxiNow",
                version = "1.0.0-beta.5",
                displayVersion = "V1.0 Beta 5",
                internalBuildId = 100,
                buildDate = "July 30, 2026",
                apiVersion = 1,
                localUrl = localUrls[0],
                localUrls,
                port,
                mode,
                simulator = sample?.Simulator ??
                    (mode == "replay"
                        ? SimulatorEdition.Replay
                        : SimulatorEdition.Msfs2024),
                state = sample?.State ?? TrackingState.Connecting,
                connected = sample?.Connected ?? false,
                selectedAirport = "CYYZ",
                lanEnabled = true
            });
        });

        app.MapGet("/api/v1/telemetry", (TelemetryState telemetry) =>
            telemetry.Latest is { } sample
                ? Results.Ok(sample)
                : Results.Json(
                    new { error = "Telemetry has not produced a sample yet." },
                    statusCode: StatusCodes.Status503ServiceUnavailable));
        app.MapPost(
            "/api/v1/telemetry/refresh",
            (TelemetryRefreshSignal refreshSignal) =>
            {
                refreshSignal.Request();
                return Results.Accepted(
                    "/api/v1/telemetry",
                    new { requested = true });
            });

        app.MapGet(
            "/api/v1/airports",
            (string? query, AirportFixtureService airports) =>
                Results.Ok(airports.Search(query)));
        app.MapGet(
            "/api/v1/airports/{icao}",
            (string icao, AirportFixtureService airports) =>
                airports.Get(icao) is { } airport
                    ? Results.Ok(airport)
                    : Results.NotFound());
        app.MapGet(
            "/api/v1/airports/{icao}/map",
            async (string icao, AirportFixtureService airports, CancellationToken token) =>
                await airports.ReadMapJsonAsync(icao, token) is { } json
                    ? Results.Text(json, "application/json")
                    : Results.NotFound());

        app.MapGet(
            "/api/v1/storage",
            async (MapAssetStore store, CancellationToken token) =>
                Results.Ok(await store.GetSummaryAsync(token)));
        app.MapDelete(
            "/api/v1/assets/{icao}",
            async (string icao, MapAssetStore store, CancellationToken token) =>
                await store.DeleteAsync(icao, token)
                    ? Results.NoContent()
                    : Results.NotFound());

        app.MapPost(
            "/api/v1/downloads",
            (DownloadRequest request, DownloadJobService jobs) =>
            {
                try
                {
                    var job = jobs.Create(request);
                    return Results.Accepted(
                        $"/api/v1/downloads/{job.JobId}",
                        job);
                }
                catch (ArgumentException error)
                {
                    return Results.BadRequest(new { error = error.Message });
                }
            });
        app.MapGet(
            "/api/v1/downloads",
            (DownloadJobService jobs) => Results.Ok(jobs.List()));
        app.MapDelete(
            "/api/v1/downloads/completed",
            (DownloadJobService jobs) =>
                Results.Ok(new { removed = jobs.ClearFinished() }));
        app.MapGet(
            "/api/v1/downloads/{jobId:guid}",
            (Guid jobId, DownloadJobService jobs) =>
                jobs.Get(jobId) is { } job ? Results.Ok(job) : Results.NotFound());
        app.MapPost(
            "/api/v1/downloads/{jobId:guid}/cancel",
            (Guid jobId, DownloadJobService jobs) =>
                jobs.Cancel(jobId) is { } job ? Results.Ok(job) : Results.NotFound());

        app.MapGet("/openapi/v1.json", () => Results.Json(OpenApiDocument.Value));

        if (app.Configuration.GetValue("TaxiNow:EnableTestShutdown", false))
        {
            app.MapPost(
                "/api/v1/test/shutdown",
                (IHostApplicationLifetime lifetime) =>
                {
                    _ = Task.Run(async () =>
                    {
                        await Task.Delay(100).ConfigureAwait(false);
                        lifetime.StopApplication();
                    });
                    return Results.Accepted();
                });
        }
    }

    private static string ResolveTelemetryMode(IConfiguration configuration)
    {
        var configured = configuration["TaxiNow:TelemetryMode"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured.Trim().Equals(
                "replay",
                StringComparison.OrdinalIgnoreCase)
                ? "replay"
                : "msfs2024";
        }

        return string.IsNullOrWhiteSpace(configuration["TaxiNow:ReplayPath"])
            ? "msfs2024"
            : "replay";
    }

    private static string ResolveWebRoot()
    {
        var deployed = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (File.Exists(Path.Combine(deployed, "index.html")))
        {
            return deployed;
        }

        var sourceCandidate = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..",
            "..",
            "..",
            "..",
            "TaxiNow.Web",
            "dist"));
        return Directory.Exists(sourceCandidate) ? sourceCandidate : deployed;
    }
}
