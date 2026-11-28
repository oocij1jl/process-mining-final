import type { EventRow, Trace } from '../contracts';

const RESOURCE_PREFIX = '@resource:';

export function resourceKeyForTrace(trace: Trace): (event: EventRow) => string | null {
  const festivals = new Set<string>();
  for (const event of trace.events) {
    const festival = event.attrs.festival_id?.trim();
    if (festival) festivals.add(festival);
  }
  const soleFestival = festivals.size === 1 ? festivals.values().next().value : undefined;
  const scopedKey = (parts: string[]) => RESOURCE_PREFIX + JSON.stringify(parts);
  return ({ attrs, resource }) => {
    const shared = attrs.resource_id?.trim();
    if (shared) return scopedKey(['shared', shared]);
    if (resource === null) return null;
    const festival = attrs.festival_id?.trim() || soleFestival;
    if (festival) return scopedKey(['festival', festival, resource]);
    if (festivals.size > 1) return scopedKey(['unresolved', trace.caseKey, resource]);
    return resource.startsWith(RESOURCE_PREFIX) ? scopedKey(['literal', resource]) : resource;
  };
}
