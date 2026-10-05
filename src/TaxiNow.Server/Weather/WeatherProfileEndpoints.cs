using Microsoft.AspNetCore.Mvc;

namespace TaxiNow.Server.Weather;

public static class WeatherProfileEndpoints
{
    public static RouteHandlerBuilder MapWeatherProfile(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(
                TaxiNowHost.WeatherProfilePath,
                async (
                    WeatherProfileRequest request,
                    WeatherProfileService service,
                    CancellationToken token) =>
                {
                    try
                    {
                        return Results.Ok(await service.GetAsync(request, token).ConfigureAwait(false));
                    }
                    catch (WeatherProfileValidationException error)
                    {
                        return Results.BadRequest(new { error = error.Message });
                    }
                    catch (WeatherProfileUnavailableException)
                    {
                        return Results.Problem(
                            title: "Route weather is temporarily unavailable.",
                            statusCode: StatusCodes.Status502BadGateway);
                    }
                })
            .WithMetadata(new RequestSizeLimitAttribute(
                WeatherProfileService.MaximumSerializedRequestBytes));
}
