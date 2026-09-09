import { describe, expect, it } from 'vitest';
import { latestRadarFrame } from './weatherRadar';

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
