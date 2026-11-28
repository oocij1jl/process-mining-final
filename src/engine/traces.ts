import type { EventRow, Issue, ProcessKey, Trace } from '../contracts';

export const MINUTE_MS = 60_000;

export function compareEvents(a: EventRow, b: EventRow): number {
  return a.timestampMs - b.timestampMs || a.sourceOrder - b.sourceOrder;
}

export function groupCases(events: readonly EventRow[]): Trace[] {
  const cases = new Map<string, EventRow[]>();
  for (const event of events) {
    const existing = cases.get(event.caseKey);
    if (existing) existing.push(event);
    else cases.set(event.caseKey, [event]);
  }

  return Array.from(cases, ([caseKey, caseEvents]) => {
    caseEvents.sort(compareEvents);
    const first = caseEvents[0];
    return {
      caseKey,
      processType: first.processType,
      events: caseEvents,
      sequence: caseEvents.filter(event => event.lifecycle !== 'start'),
      elapsedMin: (caseEvents[caseEvents.length - 1].timestampMs - first.timestampMs) / MINUTE_MS,
    };
  });
}

export function assertProcessScope(traces: readonly Trace[], processKey = traces[0]?.processType) {
  if (traces.some(trace => trace.processType !== processKey)) {
    throw new RangeError('Select one process before analyzing its traces.');
  }
}

interface LifecyclePair {
  start: EventRow;
  complete: EventRow;
}

export function matchLifecycle(trace: Trace, issues?: Issue[]) {
  const groups = new Map<string, EventRow[]>();
  for (const event of trace.events) {
    if (event.lifecycle === 'point') continue;
    const key = JSON.stringify([event.activity, event.instanceId ?? null]);
    const existing = groups.get(key);
    if (existing) existing.push(event);
    else groups.set(key, [event]);
  }

  const pairs: LifecyclePair[] = [];
  let ambiguousPairs = 0;

  for (const events of groups.values()) {
    const starts = events.filter(event => event.lifecycle === 'start');
    const completes = events.filter(event => event.lifecycle === 'complete');
    const report = (code: string, message: string) => {
      for (const event of events) {
        issues?.push({ row: event.sourceOrder, field: 'lifecycle', code, severity: 'warning', message });
      }
    };

    if (starts.length > 1 || completes.length > 1) {
      ambiguousPairs++;
      report('ambiguous_lifecycle', 'Activity instance cannot be paired unambiguously.');
    } else if (starts.length === 1 && completes.length === 0) {
      report('missing_lifecycle_partner', 'Activity start has no matching completion.');
    } else if (starts.length === 1 && completes.length === 1) {
      const [start] = starts;
      const [complete] = completes;
      if (complete.timestampMs < start.timestampMs) {
        report('negative_lifecycle_duration', 'Activity completion precedes its start.');
      } else {
        pairs.push({ start, complete });
      }
    }
  }

  return { pairs, ambiguousPairs };
}

export function firstOccurrence(trace: Trace, activity: string): EventRow | undefined {
  return trace.sequence.find(event => event.activity === activity);
}

export function firstStart(trace: Trace, activity: string): EventRow | undefined {
  return trace.events.find(event => event.activity === activity && event.lifecycle === 'start');
}

export function hasRework(
  trace: Trace,
  explicitActivities: ReadonlySet<string>,
  repeatedActivities: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  for (const { activity } of trace.sequence) {
    if (explicitActivities.has(activity)) return true;
    if (repeatedActivities.has(activity)) {
      if (seen.has(activity)) return true;
      seen.add(activity);
    }
  }
  return false;
}

export function hasRepeatedActivity(trace: Trace): boolean {
  const seen = new Set<string>();
  for (const { activity } of trace.sequence) {
    if (seen.has(activity)) return true;
    seen.add(activity);
  }
  return false;
}

export function buildCaseKey(processType: ProcessKey, caseId: string): string {
  return JSON.stringify([processType, caseId]);
}
