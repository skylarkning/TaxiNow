using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TaxiNow.Server.Gnss;

public sealed record GnssInterferenceRegion(
    int Rank,
    string Region,
    string Icao,
    string Name,
    bool Spoofing,
    bool Reported);

public sealed record GnssInterferenceResponse(
    DateOnly ObservedOn,
    DateTimeOffset RetrievedAtUtc,
    bool IsStale,
    IReadOnlyList<GnssInterferenceRegion> Regions);

public sealed class GnssInterferenceService : IDisposable
{
    public static readonly Uri SourceUri = new("https://www.easa.europa.eu/en/domains/air-operations/global-navigation-satellite-system-outages-and-alterations");
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(6);
    private const int MaximumPageCharacters = 5 * 1024 * 1024;
    private static readonly Regex DatePattern = new(
        @"impacted\s+FIRs\s+in\s+the\s+last\s+7\s+days\s+on\s+(?<date>\d{2}/\d{2}/\d{4})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));
    private static readonly Regex RowPattern = new(
        @"<tr\b[^>]*>(?<row>.*?)</tr>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));
    private static readonly Regex TagsPattern = new(
        @"<[^>]+>",
        RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));

    private readonly HttpClient _client;
    private readonly TimeProvider _timeProvider;
    private readonly GnssInterferenceResponse? _fallback;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private GnssInterferenceResponse? _cache;
    private bool _disposed;

    public GnssInterferenceService(
        HttpClient client,
        TimeProvider? timeProvider = null,
        GnssInterferenceResponse? fallback = null)
    {
        _client = client;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _fallback = fallback;
    }

    public static GnssInterferenceService CreateDefault(string productVersion)
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"TaxiNow/{productVersion}");
        var fallbackPath = Path.Combine(AppContext.BaseDirectory, "Gnss", "easa-gnss-seven-day.json");
        GnssInterferenceResponse? fallback = null;
        if (File.Exists(fallbackPath))
        {
            fallback = JsonSerializer.Deserialize<GnssInterferenceResponse>(
                File.ReadAllText(fallbackPath),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        return new GnssInterferenceService(client, fallback: fallback);
    }

    public async Task<GnssInterferenceResponse> GetAsync(CancellationToken token)
    {
        var now = _timeProvider.GetUtcNow();
        if (_cache is { } cached && now - cached.RetrievedAtUtc < RefreshInterval) return cached;
        await _refreshLock.WaitAsync(token).ConfigureAwait(false);
        try
        {
            now = _timeProvider.GetUtcNow();
            if (_cache is { } refreshed && now - refreshed.RetrievedAtUtc < RefreshInterval) return refreshed;
            try
            {
                using var response = await _client.GetAsync(SourceUri, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                var html = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
                if (html.Length > MaximumPageCharacters) throw new InvalidDataException("EASA page is too large.");
                _cache = Parse(html, now);
                return _cache;
            }
            catch (Exception error) when (
                error is HttpRequestException or InvalidDataException or TaskCanceledException &&
                !token.IsCancellationRequested && (_cache is not null || _fallback is not null))
            {
                return (_cache ?? _fallback)! with { IsStale = true };
            }
        }
        finally { _refreshLock.Release(); }
    }

    private static GnssInterferenceResponse Parse(string html, DateTimeOffset retrievedAtUtc)
    {
        var dateMatch = DatePattern.Match(html);
        if (!dateMatch.Success || !DateOnly.TryParseExact(
                dateMatch.Groups["date"].Value,
                "dd/MM/yyyy",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var observedOn))
            throw new InvalidDataException("EASA seven-day observation date is missing.");

        var tableStart = html.IndexOf("<table", dateMatch.Index + dateMatch.Length, StringComparison.OrdinalIgnoreCase);
        var tableEnd = tableStart < 0 ? -1 : html.IndexOf("</table>", tableStart, StringComparison.OrdinalIgnoreCase);
        if (tableStart < 0 || tableEnd < 0) throw new InvalidDataException("EASA seven-day FIR table is missing.");
        var table = html[tableStart..(tableEnd + "</table>".Length)];
        var regions = new List<GnssInterferenceRegion>();
        foreach (Match match in RowPattern.Matches(table))
        {
            var row = match.Groups["row"].Value;
            var rankText = Cell(row, "col-rank");
            var region = Cell(row, "col-region").ToUpperInvariant();
            var icao = Cell(row, "col-icao").ToUpperInvariant();
            var name = Cell(row, "col-name");
            if (!int.TryParse(rankText, NumberStyles.None, CultureInfo.InvariantCulture, out var rank) ||
                icao.Length != 4 || !icao.All(char.IsAsciiLetterOrDigit) || string.IsNullOrWhiteSpace(name)) continue;
            regions.Add(new GnssInterferenceRegion(
                rank,
                region,
                icao,
                name,
                Cell(row, "col-spoofing").Contains('*', StringComparison.Ordinal),
                Cell(row, "col-reported").Contains('*', StringComparison.Ordinal)));
        }
        if (regions.Count == 0) throw new InvalidDataException("EASA seven-day FIR table is empty.");
        return new GnssInterferenceResponse(observedOn, retrievedAtUtc, false, regions);
    }

    private static string Cell(string row, string className)
    {
        var match = Regex.Match(
            row,
            $@"<td\b[^>]*class=[""'][^""']*\b{Regex.Escape(className)}\b[^""']*[""'][^>]*>(?<value>.*?)</td>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant,
            TimeSpan.FromSeconds(1));
        return match.Success
            ? WebUtility.HtmlDecode(TagsPattern.Replace(match.Groups["value"].Value, string.Empty)).Replace('\u00a0', ' ').Trim()
            : string.Empty;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _refreshLock.Dispose();
        _client.Dispose();
    }
}
