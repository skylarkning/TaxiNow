export type TrafficSource = "vatsim" | "beyondatc" | "sayintentions";

export interface LegacyTrafficPreferences {
  vatsim: boolean;
  beyondAtc: boolean;
  sayIntentions: boolean;
}

export function resolveTrafficSource(
  preferences: LegacyTrafficPreferences
): TrafficSource | null {
  if (preferences.sayIntentions) {
    return "sayintentions";
  }
  if (preferences.beyondAtc) {
    return "beyondatc";
  }
  return preferences.vatsim ? "vatsim" : null;
}

export function isTrafficSourceEnabled(
  selected: TrafficSource | null,
  source: TrafficSource
): boolean {
  return selected === source;
}
