export interface FirCallsign { prefix: string; id: string }
export interface Controller { callsign: string; frequency: string }
// Prefer the most specific published callsign mapping; never infer coverage from distance.
export function controllersForFir(id: string, controllers: Controller[], mappings: FirCallsign[]): Controller[] {
  return controllers.filter(controller => {
    const base = controller.callsign.replace(/_(CTR|FSS)$/, '');
    if (base === controller.callsign) return false;
    const matches = mappings.filter(m => base === m.prefix || base.startsWith(m.prefix + '_'));
    const longest = Math.max(0, ...matches.map(m => m.prefix.length));
    return matches.some(m => m.prefix.length === longest && m.id === id);
  }).sort((a, b) => a.callsign.localeCompare(b.callsign));
}

export function onlineFirIds(controllers: Controller[], mappings: FirCallsign[]): string[] {
  const ids = new Set<string>();
  for (const controller of controllers) {
    const base = controller.callsign.replace(/_(CTR|FSS)$/, '');
    if (base === controller.callsign) continue;
    const matches = mappings.filter(mapping => base === mapping.prefix || base.startsWith(mapping.prefix + '_'));
    const longest = Math.max(0, ...matches.map(mapping => mapping.prefix.length));
    matches.filter(mapping => mapping.prefix.length === longest).forEach(mapping => ids.add(mapping.id));
  }
  return [...ids].sort();
}
