import type { KPIContext, Metric, Target, TargetEvaluation, Trace } from '../contracts';
import { festivalKPIs } from './festival-kpis';
import { caseMetric, compareMeasured } from './metrics';
import { resourceKeyForTrace } from './resource-identity';
import { intersectMs, intervalMs, resourceIntervals, unionIntervals } from './resources';
import type { Interval } from './resources';
import { assertProcessScope, MINUTE_MS } from './traces';

function shiftMetrics(traces: readonly Trace[], context: KPIContext): Metric[] {
  const known = new Set<string>();
  for (const trace of traces) {
    const resourceKey = resourceKeyForTrace(trace);
    for (const event of trace.events) {
      const resource = resourceKey(event);
      if (resource !== null) known.add(resource);
    }
  }
  const shifts = new Map<string, Interval[]>();
  for (const { resource, startMs, endMs } of context.shifts ?? []) {
    if (!known.has(resource) || !Number.isFinite(startMs) || !Number.isFinite(endMs) ||
        Math.abs(startMs) > 8.64e15 || Math.abs(endMs) > 8.64e15 || endMs <= startMs) continue;
    const intervals = shifts.get(resource) ?? [];
    intervals.push({ startMs, endMs });
    shifts.set(resource, intervals);
  }

  const busyCases = new Set<string>();
  const conflictCases = new Set<string>();
  let n = 0;
  let availableMs = 0;
  let clippedMs = 0;
  let outOfShiftMs = 0;
  for (const [resource, intervals] of resourceIntervals(traces)) {
    const resourceShifts = shifts.get(resource);
    if (!resourceShifts) continue;
    n++;
    const available = unionIntervals(resourceShifts);
    const busy = unionIntervals(intervals);
    const withinShiftMs = intersectMs(available, busy);
    availableMs += intervalMs(available);
    clippedMs += withinShiftMs;
    outOfShiftMs += intervalMs(busy) - withinShiftMs;
    for (const interval of intervals) {
      busyCases.add(interval.caseKey);
      // Find the last merged shift beginning at or before the interval.
      let left = 0;
      let right = available.length;
      while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (available[middle].startMs <= interval.startMs) left = middle + 1;
        else right = middle;
      }
      if (interval.endMs > interval.startMs && (left === 0 || available[left - 1].endMs < interval.endMs)) {
        conflictCases.add(interval.caseKey);
      }
    }
  }

  const coverage = {
    eligible: known.size, n,
    ...(n ? {} : { reason: 'No known resources have both measured activity intervals and valid shifts.' }),
  };
  return [
    {
      ...coverage, id: 'resource_utilization', unit: '%', value: n ? (clippedMs * 100) / availableMs : null,
      definition: 'Unioned busy time within unioned shifts divided by available shift time for resources with both types of evidence.',
      caseKeys: [...busyCases],
    },
    {
      ...coverage, id: 'resource_out_of_shift_minutes', unit: 'min', value: n ? outOfShiftMs / MINUTE_MS : null,
      definition: 'Unioned measured busy minutes outside validated shifts across measured resources.',
      caseKeys: [...conflictCases],
    },
  ];
}

export function getKPIs(traces: readonly Trace[], context: KPIContext): Metric[] {
  assertProcessScope(traces, context.processKey);
  return [
    caseMetric(
      'case_elapsed_mean', 'min', 'Mean first-to-last elapsed time across all accepted events in each case.',
      'No cases in the current selection.', traces, 'mean', trace => trace.elapsedMin,
    ),
    ...shiftMetrics(traces, context),
    ...festivalKPIs(traces, context),
  ];
}

export function evaluateTargets(metrics: readonly Metric[], targets: readonly Target[]): TargetEvaluation[] {
  const byId = new Map(metrics.map(metric => [metric.id, metric]));
  return targets.map(({ metricId, unit, direction, value }) => {
    const metric = byId.get(metricId);
    if (!metric || metric.value === null || !Number.isFinite(metric.value) ||
        !Number.isFinite(value) || unit !== metric.unit ||
        (direction !== 'max' && direction !== 'min')) return { metricId, status: 'unknown' };
    const order = compareMeasured(metric.value, value);
    const met = direction === 'max' ? order <= 0 : order >= 0;
    return { metricId, status: met ? 'met' : 'breached' };
  });
}
