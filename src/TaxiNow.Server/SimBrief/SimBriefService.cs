using System.Net;
using System.Text.Json;

namespace TaxiNow.Server.SimBrief;

public sealed class SimBriefService(HttpClient client)
{
    private const int MaximumBytes = 8 * 1024 * 1024;

    public async Task<JsonElement> FetchAsync(string kind, string identifier, CancellationToken token)
    {
        identifier = identifier.Trim();
        if (kind is not ("username" or "userid") || identifier.Length is < 1 or > 100 ||
            identifier.Any(char.IsControl) ||
            (kind == "userid" && (identifier.Length > 7 || !identifier.All(char.IsAsciiDigit))))
            throw new ArgumentException("Invalid SimBrief identifier.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var uri = new Uri($"https://www.simbrief.com/api/xml.fetcher.php?{kind}={Uri.EscapeDataString(identifier)}&json=v2");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("SimBrief could not return a flight plan.", null, response.StatusCode);
        if (response.Content.Headers.ContentLength > MaximumBytes)
            throw new InvalidDataException("SimBrief response is too large.");
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var buffer = new MemoryStream();
        var bytes = new byte[16384];
        int count;
        while ((count = await stream.ReadAsync(bytes, timeout.Token)) > 0)
        {
            if (buffer.Length + count > MaximumBytes) throw new InvalidDataException("SimBrief response is too large.");
            buffer.Write(bytes, 0, count);
        }
        buffer.Position = 0;
        using var document = await JsonDocument.ParseAsync(buffer, new JsonDocumentOptions { MaxDepth = 64 }, timeout.Token);
        if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.TryGetProperty("origin", out _))
            throw new InvalidDataException("No generated SimBrief flight plan is available.");
        // Only navigation fields leave the local service; omit pilot details and OFP files.
        var navigation = new Dictionary<string, JsonElement>();
        foreach (var name in new[] { "origin", "destination", "general", "navlog", "aircraft" })
            if (document.RootElement.TryGetProperty(name, out var value)) navigation[name] = value.Clone();
        return JsonSerializer.SerializeToElement(navigation);
    }
}

public static class SimBriefEndpoints
{
    public static void MapSimBrief(this WebApplication app)
    {
        app.MapGet("/api/v1/integrations/simbrief/plan", async (
            string kind, string identifier, SimBriefService service, HttpContext context, CancellationToken token) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            try { return Results.Json(await service.FetchAsync(kind, identifier, token)); }
            catch (ArgumentException) { return Results.BadRequest(new { error = "Invalid SimBrief identifier." }); }
            catch (OperationCanceledException) { return Results.Json(new { error = "SimBrief request timed out." }, statusCode: 504); }
            catch (HttpRequestException e) { return Results.Json(new { error = "SimBrief plan unavailable. Check your account and generate a plan." }, statusCode: e.StatusCode == HttpStatusCode.BadRequest ? 400 : 502); }
            catch (Exception e) when (e is JsonException or InvalidDataException or IOException)
            { return Results.Json(new { error = "Invalid SimBrief response." }, statusCode: 502); }
        });
    }
}
