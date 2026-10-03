using System.Net;
using TaxiNow.Server.SimBrief;
using Xunit;

namespace TaxiNow.Server.Tests;

public sealed class SimBriefTests
{
    [Fact]
    public async Task EncodesAliasAndUsesFixedUpstream()
    {
        var handler = new Handler("{\"origin\":{\"icao_code\":\"ZBAA\"}}");
        var service = new SimBriefService(new HttpClient(handler));
        var result = await service.FetchAsync("username", "a&userid=4", CancellationToken.None);
        Assert.Equal("www.simbrief.com", handler.Uri!.Host);
        Assert.Contains("username=a%26userid%3D4", handler.Uri.Query);
        Assert.Contains("json=v2", handler.Uri.Query);
        Assert.Equal("ZBAA", result.GetProperty("origin").GetProperty("icao_code").GetString());
    }

    [Theory]
    [InlineData("userid", "abc")]
    [InlineData("url", "https://example.com")]
    [InlineData("username", "")]
    public async Task InvalidIdentifiersNeverReachUpstream(string kind, string value)
    {
        var handler = new Handler("{}");
        var service = new SimBriefService(new HttpClient(handler));
        await Assert.ThrowsAsync<ArgumentException>(() => service.FetchAsync(kind, value, CancellationToken.None));
        Assert.Null(handler.Uri);
    }

    [Fact]
    public async Task MalformedOrMissingPlanIsRejected()
    {
        var malformed = new SimBriefService(new HttpClient(new Handler("not JSON")));
        await Assert.ThrowsAnyAsync<System.Text.Json.JsonException>(() => malformed.FetchAsync("username", "test", CancellationToken.None));
        var missing = new SimBriefService(new HttpClient(new Handler("{}")));
        await Assert.ThrowsAsync<InvalidDataException>(() => missing.FetchAsync("username", "test", CancellationToken.None));
    }

    [Fact]
    public async Task DoesNotReturnPilotOrOFPFiles()
    {
        var service = new SimBriefService(new HttpClient(new Handler("{\"origin\":{},\"pilot\":{\"name\":\"Private\"},\"files\":{}}")));
        var result = await service.FetchAsync("userid", "1234567", CancellationToken.None);
        Assert.False(result.TryGetProperty("pilot", out _));
        Assert.False(result.TryGetProperty("files", out _));
    }

    private sealed class Handler(string body) : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uri = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
        }
    }
}
