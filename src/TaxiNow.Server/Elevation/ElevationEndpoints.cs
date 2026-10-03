using Microsoft.AspNetCore.Mvc;

namespace TaxiNow.Server.Elevation;

public static class ElevationEndpoints
{
    public static RouteHandlerBuilder MapElevationProfile(
        this IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(
                TaxiNowHost.ElevationProfilePath,
                async (
                    ElevationProfileRequest request,
                    ElevationProfileService service,
                    CancellationToken token) =>
                {
                    try
                    {
                        return Results.Ok(await service
                            .GetAsync(request, token)
                            .ConfigureAwait(false));
                    }
                    catch (ElevationProfileValidationException error)
                    {
                        return Results.BadRequest(new { error = error.Message });
                    }
                    catch (ElevationProfileUnavailableException)
                    {
                        return Results.Problem(
                            title: "Terrain elevation is temporarily unavailable.",
                            statusCode: StatusCodes.Status502BadGateway);
                    }
                })
            .WithMetadata(new RequestSizeLimitAttribute(
                ElevationProfileService.MaximumSerializedRequestBytes));
}
