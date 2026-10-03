export const flightDeckTabs = ['flight', 'route'] as const;

export type FlightDeckTab = typeof flightDeckTabs[number];

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}°${value < 0 ? negative : positive}`;
}

export function formatWaypointCoordinates(position: readonly [number, number]): string {
  return `${coordinate(position[1], 'N', 'S')} · ${coordinate(position[0], 'E', 'W')}`;
}
