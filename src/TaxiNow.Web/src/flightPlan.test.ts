import { describe, expect, it } from 'vitest';
import { parseSimBrief, distanceNm, routeCoordinates, routeSections } from './flightPlan';

const plan = () => ({
  origin: { icao_code: 'ZBAA', name: 'Beijing', pos_long: '116.6', pos_lat: '40.1' },
  destination: { icao_code: 'VHHH', name: 'Hong Kong', pos_long: '113.9', pos_lat: '22.3' },
  general: { route: 'TEST DCT', flight_number: '123', icao_airline: 'CCA', initial_altitude: '35000' },
  navlog: { fix: [{ ident: 'TEST', pos_long: '115', pos_lat: '30' }] }
});
describe('SimBrief flight plans', () => {
  it('retains ordered coordinates and includes endpoints', () => {
    const result = parseSimBrief(plan());
    expect(result.points.map(p => p.ident)).toEqual(['ZBAA', 'TEST', 'VHHH']);
    expect(result.callsign).toBe('CCA123');
    expect(result.distance).toBeGreaterThan(1000);
  });
  it('rejects missing coordinates instead of drawing a shortcut', () => {
    const value = plan(); value.navlog.fix[0]!.pos_lat = '';
    expect(() => parseSimBrief(value)).toThrow();
  });
  it('rejects out of range and malformed plans', () => {
    const value = plan(); value.origin.pos_lat = '91';
    expect(() => parseSimBrief(value)).toThrow();
    expect(() => parseSimBrief({})).toThrow();
  });
  it('accepts a single fix object and removes consecutive duplicate endpoints', () => {
    const value = plan();
    const result = parseSimBrief({ ...value, navlog: { fix: { ident: 'ZBAA', pos_lat: '40.1', pos_long: '116.6' } } });
    expect(result.points).toHaveLength(2);
  });
  it('requires a navlog so unavailable route data cannot silently become direct', () => {
    expect(() => parseSimBrief({ ...plan(), navlog: null })).toThrow();
  });
});
describe('route geometry', () => {
  it('measures one degree on the equator as about 60 NM', () => {
    expect(distanceNm([0, 0], [1, 0])).toBeCloseTo(60.04, 1);
    expect(distanceNm([0, 0], [0, 0])).toBe(0);
  });
  it('takes the short path across the date line', () => {
    const coords = routeCoordinates([[179, 30], [-179, 30]]);
    expect(coords.length).toBeGreaterThan(2);
    for (let i = 1; i < coords.length; i++) expect(Math.abs(coords[i]![0] - coords[i - 1]![0])).toBeLessThan(5);
    expect(coords.at(-1)![0]).toBeCloseTo(181);
  });
  it('curves a long route toward the pole', () => {
    const coords = routeCoordinates([[-80, 45], [80, 45]]);
    expect(Math.max(...coords.map(c => c[1]))).toBeGreaterThan(70);
  });
});


it('accepts the json=v2 navlog array returned by SimBrief', () => {
 const value = plan();
 expect(parseSimBrief({ ...value, navlog: value.navlog.fix }).points).toEqual(parseSimBrief(value).points);
 expect(() => parseSimBrief({ ...value, navlog: [] })).toThrow();
});

it('separates SID and STAR legs using incoming fix flags and keeps enroute solid', () => {
 const value = plan();
 const parsed = parseSimBrief({...value, navlog:[
 {ident:'SID',pos_lat:'39',pos_long:'116',is_sid_star:'1'},
 {ident:'ENR',pos_lat:'32',pos_long:'115',is_sid_star:'0'},
 {ident:'STAR',pos_lat:'24',pos_long:'114',is_sid_star:1}
 ]});
 const sections = routeSections(parsed.points);
 expect(sections.map(s=>s.procedure)).toEqual([true,false,true]);
 expect(sections[0]!.coordinates[0]).toEqual(parsed.points[0]!.position);
 expect(sections.at(-1)!.coordinates.at(-1)![1]).toBeCloseTo(22.3);
 expect(routeSections(parseSimBrief(value).points).map(s=>s.procedure)).toEqual([false]);
});
