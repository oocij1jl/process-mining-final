import type { CaseKey, ResourceAnalysis, ResourceSummary, Trace } from '../contracts';
import { resourceKeyForTrace } from './resource-identity';
import { assertProcessScope, matchLifecycle, MINUTE_MS } from './traces';

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface OwnedInterval extends Interval {
  caseKey: CaseKey;
}

export function resourceIntervals(traces: readonly Trace[]): Map<string, OwnedInterval[]> {
  const resources = new Map<string, OwnedInterval[]>();
  for (const trace of traces) {
    const resourceKey = resourceKeyForTrace(trace);
    for (const { start, complete } of matchLifecycle(trace).pairs) {
      const resource = resourceKey(start);
      if (resource === null || resource !== resourceKey(complete)) continue;
      const intervals = resources.get(resource) ?? [];
      intervals.push({ startMs: start.timestampMs, endMs: complete.timestampMs, caseKey: trace.caseKey });
      resources.set(resource, intervals);
    }
  }
  return resources;
}

export function unionIntervals(intervals: readonly Interval[]): Interval[] {
  const union: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    const last = union[union.length - 1];
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      union.push({ ...interval });
    }
  }
  return union;
}

export function intervalMs(intervals: readonly Interval[]): number {
  return intervals.reduce((total, { startMs, endMs }) => total + (endMs - startMs), 0);
}

export function intersectMs(a: readonly Interval[], b: readonly Interval[]): number {
  let total = 0;
  let left = 0;
  let right = 0;
  while (left < a.length && right < b.length) {
    total += Math.max(0, Math.min(a[left].endMs, b[right].endMs) - Math.max(a[left].startMs, b[right].startMs));
    if (a[left].endMs < b[right].endMs) left++;
    else right++;
  }
  return total;
}

export function getResourceAnalysis(traces: readonly Trace[]): ResourceAnalysis {
  assertProcessScope(traces);
  const resources = new Map<string, {
    rawEvents: number;
    instances: number;
    cases: Set<CaseKey>;
    activities: Map<string, number>;
    roles: Set<string>;
  }>();
  const handoffs = new Map<string, { from: string; to: string; count: number; cases: Set<CaseKey> }>();
  let knownRawEvents = 0;
  let totalRawEvents = 0;
  let knownInstances = 0;
  let totalInstances = 0;

  for (const trace of traces) {
    const { caseKey, events, sequence } = trace;
    const resourceKey = resourceKeyForTrace(trace);
    totalRawEvents += events.length;
    totalInstances += sequence.length;
    for (const event of events) {
      const resource = resourceKey(event);
      if (resource === null) continue;
      knownRawEvents++;
      const summary = resources.get(resource) ?? {
        rawEvents: 0, instances: 0, cases: new Set(), activities: new Map(), roles: new Set(),
      };
      summary.rawEvents++;
      summary.cases.add(caseKey);
      const role = event.attrs.resource_role?.trim();
      if (role) summary.roles.add(role);
      resources.set(resource, summary);
    }
    for (let index = 0; index < sequence.length; index++) {
      const event = sequence[index];
      const { activity } = event;
      const resource = resourceKey(event);
      if (resource === null) continue;
      knownInstances++;
      const summary = resources.get(resource)!;
      summary.instances++;
      summary.activities.set(activity, (summary.activities.get(activity) ?? 0) + 1);
      if (index === 0) continue;
      const from = resourceKey(sequence[index - 1]);
      if (from === null || from === resource) continue;
      const key = JSON.stringify([from, resource]);
      const handoff = handoffs.get(key) ?? { from, to: resource, count: 0, cases: new Set() };
      handoff.count++;
      handoff.cases.add(caseKey);
      handoffs.set(key, handoff);
    }
  }

  const busy = resourceIntervals(traces);
  return {
    resources: Array.from(resources, ([resource, summary]): ResourceSummary => {
      const intervals = busy.get(resource);
      return {
        resource,
        rawEvents: summary.rawEvents,
        instances: summary.instances,
        distinctCases: summary.cases.size,
        activityCounts: Object.fromEntries(summary.activities),
        activeMin: intervals ? intervalMs(unionIntervals(intervals)) / MINUTE_MS : null,
        caseKeys: [...summary.cases],
        roles: [...summary.roles],
      };
    }),
    handoffs: Array.from(handoffs.values(), ({ cases, ...handoff }) => ({ ...handoff, caseKeys: [...cases] })),
    knownRawEvents, totalRawEvents, knownInstances, totalInstances,
  };
}
