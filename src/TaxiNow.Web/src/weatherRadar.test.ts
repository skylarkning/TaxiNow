import { describe, expect, it } from 'vitest';
import { hasRadarEcho, latestRadarFrame, parseWeatherMotion, radarTilePoint } from './weatherRadar';

describe('latestRadarFrame', () => {
  it('selects the newest past radar frame and builds a MapLibre tile URL', () => {
    expect(latestRadarFrame({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [
        { time: 100, path: '/v2/radar/100' },
        { time: 200, path: '/v2/radar/200' }
      ] }
    })).toEqual({
      observedAtUnix: 200,
      tileUrl: 'https://tilecache.rainviewer.com/v2/radar/200/256/{z}/{x}/{y}/2/1_1.png'
    });
  });

  it('rejects malformed or insecure metadata', () => {
    expect(latestRadarFrame({ host: 'http://example.com', radar: { past: [] } })).toBeNull();
    expect(latestRadarFrame({ host: 'https://example.com', radar: { past: [] } })).toBeNull();
  });
});

describe('parseWeatherMotion', () => {
  it('turns 700 hPa wind into weather movement arrows', () => {
    expect(parseWeatherMotion([
      { latitude: 40, longitude: 116, current: { wind_speed_700hPa: 42, wind_direction_700hPa: 270, precipitation: 3.4, weather_code: 95 } },
      { latitude: 31, longitude: 121, current: { wind_speed_700hPa: 18, wind_direction_700hPa: 180, precipitation: 0.8, weather_code: 61 } }
    ])).toEqual([
      { position: [116, 40], speedKnots: 42, bearingDegrees: 90 },
      { position: [121, 31], speedKnots: 18, bearingDegrees: 0 }
    ]);
  });

  it('ignores malformed wind samples', () => {
    expect(parseWeatherMotion({ latitude: 40, longitude: 116, current: {} })).toEqual([]);
  });
});

describe('RainViewer echo sampling', () => {
  it('maps a coordinate to a radar tile and pixel', () => {
    expect(radarTilePoint([-88, 41], 5)).toEqual({ tileX: 8, tileY: 11, pixelX: 45, pixelY: 255 });
  });

  it('detects a nearby visible radar pixel and ignores clear pixels', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    pixels[((2 * 4) + 2) * 4 + 3] = 25;
    expect(hasRadarEcho(pixels, 4, 4, 1, 1, 1)).toBe(true);
    expect(hasRadarEcho(pixels, 4, 4, 0, 0, 0)).toBe(false);
  });
});
