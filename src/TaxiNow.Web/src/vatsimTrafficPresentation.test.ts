import { describe, expect, it } from 'vitest';
import {
  vatsimTrafficPopupHeaderElement,
  vatsimTrafficPopupModel
} from './vatsimTrafficPresentation';

const aircraft = {
  callsign: 'ACA123',
  latitude: 43.6801,
  longitude: -79.6202,
  headingDegrees: 7,
  altitudeFeet: 12572,
  groundSpeedKnots: 414,
  aircraftType: 'A320',
  departureAirport: 'CYYZ',
  arrivalAirport: 'CYVR',
  lastUpdatedUtc: '2026-08-30T12:00:00Z'
};

describe('VATSIM aircraft popup', () => {
  it('keeps its heading outside the page-header styling contract', () => {
    expect(vatsimTrafficPopupHeaderElement).toBe('div');
  });

  it('presents the filed route with the core flight data', () => {
    expect(vatsimTrafficPopupModel(aircraft, false)).toEqual({
      callsign: 'ACA123',
      aircraftType: 'A320',
      route: 'CYYZ → CYVR',
      routeUnavailable: false,
      altitude: '12,572 FT',
      groundSpeed: '414 KT',
      heading: '007°'
    });
  });

  it('labels missing flight plans without inventing airports', () => {
    expect(vatsimTrafficPopupModel({
      ...aircraft,
      aircraftType: null,
      departureAirport: null,
      arrivalAirport: null
    }, true)).toMatchObject({
      aircraftType: '机型未知',
      route: '航路信息不可用',
      routeUnavailable: true
    });
  });
});
