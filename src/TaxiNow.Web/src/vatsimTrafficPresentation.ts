import type { VatsimTrafficAircraft } from './contracts';

export const vatsimTrafficPopupHeaderElement = 'div';

export interface VatsimTrafficPopupModel {
  callsign: string;
  aircraftType: string;
  route: string;
  routeUnavailable: boolean;
  altitude: string;
  groundSpeed: string;
  heading: string;
}

function wholeNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function vatsimTrafficPopupModel(
  aircraft: VatsimTrafficAircraft,
  zh: boolean
): VatsimTrafficPopupModel {
  const hasRoute = !!aircraft.departureAirport && !!aircraft.arrivalAirport;
  return {
    callsign: aircraft.callsign,
    aircraftType: aircraft.aircraftType || (zh ? '机型未知' : 'Type unknown'),
    route: hasRoute
      ? `${aircraft.departureAirport} → ${aircraft.arrivalAirport}`
      : (zh ? '航路信息不可用' : 'Route unavailable'),
    routeUnavailable: !hasRoute,
    altitude: `${wholeNumber(aircraft.altitudeFeet)} FT`,
    groundSpeed: `${wholeNumber(aircraft.groundSpeedKnots)} KT`,
    heading: `${String(Math.round(aircraft.headingDegrees)).padStart(3, '0')}°`
  };
}
