namespace TaxiNow.Server;

internal static class OpenApiDocument
{
    public static readonly object Value = new
    {
        openapi = "3.1.0",
        info = new
        {
            title = "TaxiNow local API",
            version = "1.0.0",
            description = "Loopback-only API for the TaxiNow desktop and browser map."
        },
        servers = new[] { new { url = "http://127.0.0.1:8780" } },
        paths = new Dictionary<string, object>
        {
            ["/api/v1/integrations/vmas/presence"] = Get(
                "Minimal opt-in TaxiNow presence for the authorized vMAS origin"),
            ["/api/v1/integrations/vatsim/traffic"] = Get(
                "Nearby VATSIM aircraft from the official public network feed"),
            ["/api/v1/integrations/vatsim/traffic/global"] = Get(
                "Global VATSIM aircraft from the official public network feed"),
            ["/api/v1/integrations/gnss/interference"] = Get(
                "FIRs affected by GNSS interference in EASA's latest seven-day analysis"),
            ["/api/v1/elevation/profile"] = Post(
                "Sample and cache terrain elevations along a route"),
            ["/api/v1/integrations/beyondatc/traffic"] = Get(
                "Nearby AI aircraft injected into MSFS by BeyondATC"),
            ["/api/v1/integrations/sayintentions/traffic"] = Get(
                "Nearby SayIntentions AI traffic with official callsigns"),
            ["/api/v1/status"] = Get("Application and simulator status"),
            ["/api/v1/telemetry"] = Get("Latest telemetry snapshot"),
            ["/api/v1/telemetry/refresh"] =
                Post("Request an immediate aircraft position refresh"),
            ["/api/v1/airports"] = Get("Search installed airports"),
            ["/api/v1/airports/nearest"] = Get(
                "Find the airport nearest a ground position and report whether its map is installed"),
            ["/api/v1/airports/{icao}"] = Get("Airport metadata"),
            ["/api/v1/airports/{icao}/map"] = Get("Normalized airport map"),
            ["/api/v1/downloads"] = new
            {
                get = Operation("List download jobs"),
                post = Operation("Create a download job")
            },
            ["/api/v1/downloads/completed"] = new
            {
                delete = Operation("Clear finished download jobs")
            },
            ["/api/v1/downloads/{jobId}"] = Get("Download job status"),
            ["/api/v1/downloads/{jobId}/cancel"] = new
            {
                post = Operation("Cancel a download job")
            },
            ["/api/v1/assets/{icao}"] = new
            {
                delete = Operation("Delete an installed map asset")
            },
            ["/api/v1/storage"] = Get(
                "Storage summary and installed airport-map assets")
        }
    };

    private static object Get(string summary) => new { get = Operation(summary) };

    private static object Post(string summary) =>
        new { post = Operation(summary) };

    private static object Operation(string summary) => new
    {
        summary,
        responses = new Dictionary<string, object>
        {
            ["200"] = new { description = "Success" }
        }
    };
}
