export function parseCustomTaxiRouteInput(value: string): string[] {
  const tokens = value
    .trim()
    .toUpperCase()
    .split(/[,\s]+/)
    .filter(Boolean);

  const gateIndex = tokens.length - 2;
  if (gateIndex >= 0 && tokens[gateIndex] === "GATE") {
    return [
      ...tokens.slice(0, gateIndex),
      `GATE ${tokens[gateIndex + 1]}`
    ];
  }

  return tokens;
}
