namespace TaxiNow.Core.Telemetry;

public static class TelemetryMath
{
    public static double NormalizeHeading(double degrees)
    {
        var result = degrees % 360;
        return result < 0 ? result + 360 : result;
    }

    public static double InterpolateHeading(double from, double to, double fraction)
    {
        var start = NormalizeHeading(from);
        var end = NormalizeHeading(to);
        var delta = ((end - start + 540) % 360) - 180;
        return NormalizeHeading(start + delta * Math.Clamp(fraction, 0, 1));
    }

    public static double DistanceMeters(
        double latitude1,
        double longitude1,
        double latitude2,
        double longitude2)
    {
        const double earthRadiusMeters = 6_371_000;
        var phi1 = latitude1 * Math.PI / 180;
        var phi2 = latitude2 * Math.PI / 180;
        var deltaPhi = (latitude2 - latitude1) * Math.PI / 180;
        var deltaLambda = (longitude2 - longitude1) * Math.PI / 180;
        var a = Math.Sin(deltaPhi / 2) * Math.Sin(deltaPhi / 2) +
                Math.Cos(phi1) * Math.Cos(phi2) *
                Math.Sin(deltaLambda / 2) * Math.Sin(deltaLambda / 2);
        return earthRadiusMeters * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}

