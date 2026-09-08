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
