namespace TaxiNow.Core.Airports;

public static class AirportMapValidator
{
    private const int MaximumFeatures = 250_000;

    public static void Validate(AirportMap map)
    {
        ArgumentNullException.ThrowIfNull(map);
        if (map.SchemaVersion != 2)
        {
            throw new AirportMapValidationException("TaxiNow writes schema version 2 only.");
        }

        if (string.IsNullOrWhiteSpace(map.Airport.Icao) ||
            map.Airport.Icao.Length is < 3 or > 5)
        {
            throw new AirportMapValidationException("Airport ICAO must contain 3 to 5 characters.");
        }

        if (map.Airport.Center.Length != 2)
        {
            throw new AirportMapValidationException("Airport center must be [longitude, latitude].");
        }

        ValidateCoordinate(map.Airport.Center, "airport center");
        ValidateBounds(map.Airport.Bounds);

        if (!map.Airport.Bounds.Contains(map.Airport.Center[0], map.Airport.Center[1]))
        {
            throw new AirportMapValidationException("Airport center must lie inside its bounds.");
        }

        if (map.Features.Count > MaximumFeatures)
        {
            throw new AirportMapValidationException(
                $"Feature count exceeds the safety limit of {MaximumFeatures}.");
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var feature in map.Features)
        {
            if (string.IsNullOrWhiteSpace(feature.Id) || !ids.Add(feature.Id))
            {
                throw new AirportMapValidationException(
                    $"Feature IDs must be non-empty and unique: '{feature.Id}'.");
            }

            if (string.IsNullOrWhiteSpace(feature.Source))
            {
                throw new AirportMapValidationException(
                    $"Feature '{feature.Id}' has no source provenance.");
            }

            if (feature.Points.Length == 0)
            {
                throw new AirportMapValidationException(
                    $"Feature '{feature.Id}' has no coordinates.");
            }

            foreach (var point in feature.Points)
            {
                ValidateCoordinate(point, $"feature '{feature.Id}'");
            }

            if (feature.WidthMeters is < 0 or > 500)
            {
                throw new AirportMapValidationException(
                    $"Feature '{feature.Id}' has an invalid width.");
            }
        }
    }

    private static void ValidateBounds(GeoBounds bounds)
    {
        if (!IsLongitude(bounds.MinLon) || !IsLongitude(bounds.MaxLon) ||
            !IsLatitude(bounds.MinLat) || !IsLatitude(bounds.MaxLat) ||
            bounds.MinLon >= bounds.MaxLon || bounds.MinLat >= bounds.MaxLat)
        {
            throw new AirportMapValidationException("Airport bounds are invalid.");
        }
    }

    private static void ValidateCoordinate(double[] point, string context)
    {
        if (point.Length < 2 || !IsLongitude(point[0]) || !IsLatitude(point[1]))
        {
            throw new AirportMapValidationException(
                $"Invalid [longitude, latitude] coordinate in {context}.");
        }
    }

    private static bool IsLongitude(double value) =>
        double.IsFinite(value) && value is >= -180 and <= 180;

    private static bool IsLatitude(double value) =>
        double.IsFinite(value) && value is >= -90 and <= 90;
}

