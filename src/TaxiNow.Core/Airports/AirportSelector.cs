namespace TaxiNow.Core.Airports;

public sealed class AirportSelector(double paddingDegrees = 0.01, double switchMarginMeters = 500)
{
    private string? _selectedIcao;

    public string? Select(
        double latitude,
        double longitude,
        IReadOnlyCollection<AirportMetadata> installedAirports,
        bool onGround)
    {
        if (!onGround || installedAirports.Count == 0)
        {
            return _selectedIcao;
        }

        var candidates = installedAirports
            .Select(airport => new Candidate(
                airport,
                airport.Bounds.Contains(longitude, latitude, paddingDegrees),
                DistanceMeters(latitude, longitude, airport.Center[1], airport.Center[0])))
            .OrderByDescending(static candidate => candidate.Contains)
            .ThenBy(static candidate => candidate.DistanceMeters)
            .ToArray();

        var best = candidates[0];
        var current = candidates.FirstOrDefault(candidate =>
            string.Equals(candidate.Airport.Icao, _selectedIcao, StringComparison.OrdinalIgnoreCase));
        if (current is not null &&
            (current.Contains || current.DistanceMeters <= best.DistanceMeters + switchMarginMeters))
        {
            return _selectedIcao;
        }

        _selectedIcao = best.Airport.Icao;
        return _selectedIcao;
    }

    public void Override(string icao) => _selectedIcao = icao.Trim().ToUpperInvariant();

    public void ResumeAutomatic() => _selectedIcao = null;

    private static double DistanceMeters(
        double latitude1,
        double longitude1,
        double latitude2,
        double longitude2)
    {
        const double earthRadiusMeters = 6_371_000;
        var lat1 = DegreesToRadians(latitude1);
        var lat2 = DegreesToRadians(latitude2);
        var deltaLat = DegreesToRadians(latitude2 - latitude1);
        var deltaLon = DegreesToRadians(longitude2 - longitude1);
        var a = Math.Sin(deltaLat / 2) * Math.Sin(deltaLat / 2) +
                Math.Cos(lat1) * Math.Cos(lat2) *
                Math.Sin(deltaLon / 2) * Math.Sin(deltaLon / 2);
        return earthRadiusMeters * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180;

    private sealed record Candidate(
        AirportMetadata Airport,
        bool Contains,
        double DistanceMeters);
}

