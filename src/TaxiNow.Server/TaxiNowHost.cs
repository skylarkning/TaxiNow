using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using TaxiNow.Core.Airports;
using TaxiNow.Core.Telemetry;
using TaxiNow.Core.Traffic;
using TaxiNow.Server.Airports;
using TaxiNow.Server.Downloads;
using TaxiNow.Server.Gnss;
using TaxiNow.Server.XPlane;
using TaxiNow.Server.SayIntentions;
using TaxiNow.Server.Telemetry;
using TaxiNow.Server.Vatsim;
using TaxiNow.Server.SimBrief;
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
    public const string VatsimTrafficPath =
        "/api/v1/integrations/vatsim/traffic";
    public const string BeyondAtcTrafficPath =
        "/api/v1/integrations/beyondatc/traffic";
    public const string SayIntentionsTrafficPath =
        "/api/v1/integrations/sayintentions/traffic";
    public const string VatsimGlobalTrafficPath =
        "/api/v1/integrations/vatsim/traffic/global";
    public const string GnssInterferencePath =
        "/api/v1/integrations/gnss/interference";
    private const string VmasPresenceCorsPolicy = "VmasPresence";
    public const string ProductVersion = "1.6.0";
    public const string DisplayVersion = "V1.6";
    public const int InternalBuildId = 129;
    public const string BuildDate = "September 14, 2026";

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
        builder.Services.AddSingleton<AirportCatalogService>();
        builder.Services.AddSingleton<TelemetryState>();
        builder.Services.AddSingleton<TelemetryRefreshSignal>();
        builder.Services.AddSingleton<SimulatorTrafficState>();
        builder.Services.AddSingleton<DownloadJobService>();
        builder.Services.AddHttpClient<SimBriefService>(client =>
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd("TaxiNow/1.5");
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        builder.Services.AddSingleton(
            _ => VatsimTrafficService.CreateDefault(ProductVersion));
        builder.Services.AddSingleton(
            _ => SayIntentionsTrafficService.CreateDefault(ProductVersion));
        builder.Services.AddSingleton(
            _ => GnssInterferenceService.CreateDefault(ProductVersion));
        if (ResolveTelemetryMode(builder.Configuration) == "replay")
        {
            builder.Services.AddSingleton<ITelemetrySource>(services =>
            {
                var configuration = services.GetRequiredService<IConfiguration>();
                var replayPath = configuration["TaxiNow:ReplayPath"];
                if (string.IsNullOrWhiteSpace(replayPath))
                    replayPath = Path.Combine(AppContext.BaseDirectory, "fixtures", "telemetry", "cyyz-taxi.jsonl");
                return new ReplayTelemetrySource(
                    Path.GetFullPath(replayPath),
                    configuration.GetValue("TaxiNow:ReplaySpeed", 1d),
                    configuration.GetValue("TaxiNow:ReplayLoop", true));
            });
        }
        else
        {
            builder.Services.AddSingleton<ITelemetrySource>(services =>
                new ManagedSimConnectTelemetrySource(
                    services.GetRequiredService<TelemetryRefreshSignal>(),
                    services.GetRequiredService<SimulatorTrafficState>()));
            builder.Services.AddSingleton<ITelemetrySource, XPlaneTelemetrySource>();
        }
        builder.Services.AddHostedService<TelemetryPublisher>();

        var app = builder.Build();
        app.MapSimBrief();
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

        app.MapGet("/api/v1/integrations/vatsim/controllers", async (VatsimTrafficService traffic, CancellationToken token) =>
        {
            try { return Results.Ok(await traffic.GetControllersAsync(token)); }
            catch (Exception error) when (error is HttpRequestException or JsonException or TaskCanceledException)
            { return Results.Problem(title: "VATSIM controllers unavailable.", statusCode: 502); }
        });

        app.MapGet(GnssInterferencePath, async (GnssInterferenceService interference, CancellationToken token) =>
        {
            try { return Results.Ok(await interference.GetAsync(token).ConfigureAwait(false)); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception error) when (error is HttpRequestException or InvalidDataException or TaskCanceledException)
            {
                return Results.Problem(
                    title: "GNSS interference information is temporarily unavailable.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        app.MapGet(VatsimTrafficPath, async (
            double? west,
            double? south,
            double? east,
            double? north,
            VatsimTrafficService traffic,
            CancellationToken token) =>
        {
            if (!VatsimTrafficBounds.TryCreate(
                    west,
                    south,
                    east,
                    north,
                    out var bounds))
            {
                return Results.BadRequest(new
                {
                    error = "Provide valid west, south, east, and north bounds no larger than 30 degrees."
                });
            }

            try
            {
                return Results.Ok(await traffic
                    .GetTrafficAsync(bounds, token)
                    .ConfigureAwait(false));
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error) when (
                error is HttpRequestException or JsonException or TaskCanceledException)
            {
                return Results.Problem(
                    title: "VATSIM traffic is temporarily unavailable.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        app.MapGet(BeyondAtcTrafficPath, (
            double? west,
            double? south,
            double? east,
            double? north,
            SimulatorTrafficState traffic) =>
        {
            if (!VatsimTrafficBounds.TryCreate(
                    west,
                    south,
                    east,
                    north,
                    out var bounds))
            {
                return Results.BadRequest(new
                {
                    error = "Provide valid west, south, east, and north bounds no larger than 30 degrees."
                });
            }

            traffic.RequestObservation();
            var snapshot = traffic.Latest;
            var aircraft = snapshot.Aircraft
                .Where(item => bounds.Contains(
                    item.Longitude,
                    item.Latitude))
                .ToArray();
            return Results.Ok(new
            {
                snapshot.Sequence,
                snapshot.Connected,
                snapshot.RetrievedAtUtc,
                isStale = !snapshot.Connected ||
                    DateTimeOffset.UtcNow - snapshot.RetrievedAtUtc >
                    TimeSpan.FromSeconds(5),
                count = aircraft.Length,
                aircraft
            });
        });

        app.MapGet(SayIntentionsTrafficPath, async (
            double? west,
            double? south,
            double? east,
            double? north,
            SayIntentionsTrafficService sayIntentions,
            SimulatorTrafficState simulatorTraffic,
            CancellationToken token) =>
        {
            if (!VatsimTrafficBounds.TryCreate(
                    west,
                    south,
                    east,
                    north,
                    out var bounds))
            {
                return Results.BadRequest(new
                {
                    error = "Provide valid west, south, east, and north bounds no larger than 30 degrees."
                });
            }

            simulatorTraffic.RequestObservation();
            try
            {
                var feed = await sayIntentions
                    .GetTrafficAsync(token)
                    .ConfigureAwait(false);
                var simulatorSnapshot = simulatorTraffic.Latest;
                var simulatorAircraft = simulatorSnapshot.Connected &&
                    DateTimeOffset.UtcNow - simulatorSnapshot.RetrievedAtUtc <=
                    TimeSpan.FromSeconds(5)
                    ? simulatorSnapshot.Aircraft.ToDictionary(
                        item => item.ObjectId)
                    : [];
                var aircraft = feed.Aircraft
                    .Select(item =>
                    {
                        if (item.SimConnectId is { } simConnectId &&
                            simulatorAircraft.TryGetValue(
                                simConnectId,
                                out var local))
                        {
                            return item with
                            {
                                Latitude = local.Latitude,
                                Longitude = local.Longitude,
                                HeadingDegrees = local.HeadingDegrees,
                                AltitudeFeet = local.AltitudeFeet,
                                GroundSpeedKnots = local.GroundSpeedKnots,
                                OnGround = local.OnGround
                            };
                        }
                        return item;
                    })
                    .Where(item => bounds.Contains(
                        item.Longitude,
                        item.Latitude))
                    .ToArray();
                return Results.Ok(new
                {
                    feed.ClientConnected,
                    feed.ActiveFlight,
                    feed.RetrievedAtUtc,
                    feed.IsStale,
                    count = aircraft.Length,
                    aircraft
                });
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error) when (
                error is HttpRequestException or JsonException or TaskCanceledException)
            {
                return Results.Problem(
                    title: "SayIntentions traffic is temporarily unavailable.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        app.MapGet(VatsimGlobalTrafficPath, async (
            VatsimTrafficService traffic,
            CancellationToken token) =>
        {
            try
            {
                return Results.Ok(await traffic
                    .GetAllTrafficAsync(token)
                    .ConfigureAwait(false));
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error) when (
                error is HttpRequestException or JsonException or TaskCanceledException)
            {
                return Results.Problem(
                    title: "VATSIM traffic is temporarily unavailable.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

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
            "/api/v1/airports/nearest",
            async (
                double? latitude,
                double? longitude,
                AirportCatalogService catalog,
                MapAssetStore store,
                CancellationToken token) =>
            {
                if (latitude is null || longitude is null ||
                    !double.IsFinite(latitude.Value) ||
                    latitude.Value is < -90 or > 90 ||
                    !double.IsFinite(longitude.Value) ||
                    longitude.Value is < -180 or > 180)
                {
                    return Results.BadRequest(new
                    {
                        error = "Provide valid latitude and longitude coordinates."
                    });
                }

                var airport = await catalog.FindNearestAsync(
                    latitude.Value,
                    longitude.Value,
                    cancellationToken: token).ConfigureAwait(false);
                if (airport is null)
                {
                    return Results.Ok(new
                    {
                        airport = (AirportCatalogMatch?)null,
                        installed = false
                    });
                }

                return Results.Ok(new
                    {
                        airport,
                        installed = await store.ContainsAsync(
                            airport.Icao,
                            token).ConfigureAwait(false)
                    });
            });
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
                : "auto";
        }

        return string.IsNullOrWhiteSpace(configuration["TaxiNow:ReplayPath"])
            ? "auto"
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
