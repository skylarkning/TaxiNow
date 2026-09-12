import { describe, expect, it } from 'vitest';
import { parseSimBrief, distanceNm, routeCoordinates, routeSections, activeRouteLeg } from './flightPlan';

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

  it('normalizes planned altitudes, restrictions, and airport elevations independently', () => {
    const value = {
      ...plan(),
      origin: { icao_code: 'CYYZ', pos_long: '-79.63', pos_lat: '43.67', elevation: '569' },
      destination: { icao_code: 'CYQT', pos_long: '-89.32', pos_lat: '48.37', elevation: 653 },
      navlog: { fix: [
        { ident: 'CLB', pos_long: '-79', pos_lat: '43', altitude_feet: '12000', altitude_desc: '2', altitude1: '10000' },
        { ident: 'CRZ', pos_long: '-78', pos_lat: '44', altitude_feet: 35000, altitude_desc: '4', altitude1: '33000', altitude2: '35000' }
      ] }
    };

    const result = parseSimBrief(value);
    expect(result.originElevationFeet).toBe(569);
    expect(result.destinationElevationFeet).toBe(653);
    expect(result.points[1]).toMatchObject({
      plannedAltitudeFeet: 12000,
      constraintKind: 'atOrAbove',
      minimumAltitudeFeet: 10000
    });
    expect(result.points[1]!.maximumAltitudeFeet).toBeUndefined();
    expect(result.points[2]).toMatchObject({
      plannedAltitudeFeet: 35000,
      constraintKind: 'between',
      minimumAltitudeFeet: 33000,
      maximumAltitudeFeet: 35000
    });
  });

  it('supports every SimBrief constraint descriptor and omits invalid required bounds', () => {
    const value = {
      ...plan(),
      navlog: { fix: [
        { ident: 'AT', pos_long: '115', pos_lat: '30', altitude_desc: '1', altitude1: '12000' },
        { ident: 'ABV', pos_long: '114', pos_lat: '29', altitude_desc: 'AT_OR_ABOVE', altitude1: '10000' },
        { ident: 'BLW', pos_long: '113', pos_lat: '28', altitude_desc: 3, altitude1: '8000' },
        { ident: 'BAD-BELOW', pos_long: '112', pos_lat: '27', altitude_feet: '-2001', altitude_desc: '3', altitude1: '-2001' },
        { ident: 'BAD-HIGH', pos_long: '111', pos_lat: '26', altitude_feet: '100001', altitude_desc: '1', altitude1: '100001' },
        { ident: 'BAD-NAN', pos_long: '110', pos_lat: '25', altitude_feet: 'NaN', altitude_desc: '4', altitude1: 'NaN', altitude2: '35000' }
      ] }
    };

    const points = parseSimBrief(value).points;
    expect(points[1]).toMatchObject({ constraintKind: 'at', minimumAltitudeFeet: 12000, maximumAltitudeFeet: 12000 });
    expect(points[2]).toMatchObject({ constraintKind: 'atOrAbove', minimumAltitudeFeet: 10000 });
    expect(points[3]).toMatchObject({ constraintKind: 'atOrBelow', maximumAltitudeFeet: 8000 });
    expect(points[4]).not.toHaveProperty('constraintKind');
    expect(points[4]).not.toHaveProperty('plannedAltitudeFeet');
    expect(points[5]).not.toHaveProperty('constraintKind');
    expect(points[5]).not.toHaveProperty('plannedAltitudeFeet');
    expect(points[6]).not.toHaveProperty('constraintKind');
    expect(points[6]).not.toHaveProperty('plannedAltitudeFeet');
  });

  it('keeps later vertical fields when adjacent duplicate coordinates collapse', () => {
    const value = {
      ...plan(),
      navlog: { fix: [
        { ident: 'FIRST', pos_long: '115', pos_lat: '30', altitude_feet: '11000', altitude_desc: '1', altitude1: '11000' },
        { ident: 'SECOND', pos_long: '115.00001', pos_lat: '30', altitude_feet: '12000', altitude_desc: '2', altitude1: '10000' }
      ] }
    };

    const points = parseSimBrief(value).points;
    expect(points.map(point => point.ident)).toEqual(['ZBAA', 'FIRST', 'VHHH']);
    expect(points[1]).toMatchObject({
      plannedAltitudeFeet: 12000,
      constraintKind: 'atOrAbove',
      minimumAltitudeFeet: 10000
    });
    expect(points[1]!.maximumAltitudeFeet).toBeUndefined();
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

it('selects the next waypoint and draws only the live remainder of the active leg', () => {
  const points = [
    { ident: 'PEPMA', position: [0, 0] as [number, number], airway: '' },
    { ident: 'MUSIT', position: [2, 0] as [number, number], airway: '' },
    { ident: 'NEXT', position: [4, 0] as [number, number], airway: '' }
  ];

  const active = activeRouteLeg(points, [0.8, 0]);
  expect(active?.nextIndex).toBe(1);
  expect(active?.coordinates[0]).toEqual([0.8, 0]);
  expect(active?.coordinates.at(-1)?.[0]).toBeCloseTo(2);
});
