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
    public const string VmasAllowedOrigin = "https://vmas.my";
    public const string VmasPresencePath =
        "/api/v1/integrations/vmas/presence";
    private const string VmasPresenceCorsPolicy = "VmasPresence";
    public const string ProductVersion = "1.4.4";
    public const string DisplayVersion = "V1.4.4";
    public const int InternalBuildId = 122;
    public const string BuildDate = "August 22, 2026";

    public static string MapShellUrl =>
        $"http://127.0.0.1:{DefaultPort}/?build={InternalBuildId}";

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
        builder.Services.AddCors(options =>
        {
            options.AddPolicy(VmasPresenceCorsPolicy, policy =>
                policy
                    .WithOrigins(VmasAllowedOrigin)
                    .WithMethods(HttpMethods.Get)
                    .WithHeaders("Accept"));
        });
        builder.Services.AddSingleton(new VmasPresenceSettings(
            builder.Configuration.GetValue(
                "TaxiNow:Integrations:VmasPresenceEnabled",
                false)));

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
        app.Use(async (context, next) =>
        {
            var settings = context.RequestServices
                .GetRequiredService<VmasPresenceSettings>();
            var privateNetworkRequest = string.Equals(
                context.Request.Headers["Access-Control-Request-Private-Network"],
                "true",
                StringComparison.OrdinalIgnoreCase);
            if (settings.Enabled &&
                context.Request.Path.Equals(VmasPresencePath) &&
                IsVmasPresenceOriginAllowed(
                    context.Request.Headers.Origin.ToString()) &&
                privateNetworkRequest)
            {
                context.Response.OnStarting(() =>
                {
                    context.Response.Headers[
                        "Access-Control-Allow-Private-Network"] = "true";
                    return Task.CompletedTask;
                });
            }
            await next().ConfigureAwait(false);
        });
        app.UseCors();
        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = context =>
            {
                if (string.Equals(
                        context.File.Name,
                        "index.html",
                        StringComparison.OrdinalIgnoreCase))
                {
                    context.Context.Response.Headers.CacheControl =
                        "no-store,no-cache,must-revalidate,max-age=0";
                    context.Context.Response.Headers.Pragma = "no-cache";
                    context.Context.Response.Headers.Expires = "0";
                }
                else
                {
                    context.Context.Response.Headers.CacheControl =
                        "public,max-age=31536000,immutable";
                }
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
        app.MapGet(VmasPresencePath, (
            HttpContext context,
            VmasPresenceSettings settings) =>
        {
            if (!settings.Enabled)
            {
                return Results.NotFound();
            }

            var origin = context.Request.Headers.Origin.ToString();
            if (!IsVmasPresenceOriginAllowed(origin))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            return Results.Ok(new
            {
                available = true,
                version = ProductVersion,
                build = InternalBuildId
            });
        }).RequireCors(VmasPresenceCorsPolicy);

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
                version = ProductVersion,
                displayVersion = DisplayVersion,
                internalBuildId = InternalBuildId,
                buildDate = BuildDate,
                apiVersion = 1,
                localUrl = localUrls[0],
                localUrls,
                port,
                mode,
                simulator = sample?.Simulator ??
                    (mode == "replay"
                        ? SimulatorEdition.Replay
                        : SimulatorEdition.Unknown),
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
                : "msfs";
        }

        return string.IsNullOrWhiteSpace(configuration["TaxiNow:ReplayPath"])
            ? "msfs"
            : "replay";
    }

    public static bool IsVmasPresenceOriginAllowed(string? origin) =>
        string.IsNullOrEmpty(origin) || string.Equals(
            origin,
            VmasAllowedOrigin,
            StringComparison.Ordinal);

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
