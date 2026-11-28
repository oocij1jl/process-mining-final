import type { CaseKey, Metric, Target, Trace } from '../contracts';

interface Observation {
  caseKey: CaseKey;
  value: number;
}

type Observe = (trace: Trace) => number | undefined;
type CaseMetricKind = 'mean' | 'count' | 'rate';

const nonNumeratorCases = new WeakMap<Metric, CaseKey[]>();

export function targetEvidence(metric: Metric, direction: Target['direction']): CaseKey[] {
  return direction === 'min' ? nonNumeratorCases.get(metric) ?? metric.caseKeys : metric.caseKeys;
}

export function compareMeasured(measured: number, target: number): number {
  const difference = measured - target;
  // Use relative machine precision, with no absolute tolerance around zero.
  const tolerance = Number.EPSILON * Math.max(Math.abs(measured), Math.abs(target));
  return Math.abs(difference) <= tolerance ? 0 : Math.sign(difference);
}

export function caseMetric(
  id: string,
  unit: string,
  definition: string,
  reason: string,
  traces: readonly Trace[],
  kind: CaseMetricKind,
  observe: Observe,
): Metric {
  const observations: Observation[] = [];
  for (const trace of traces) {
    const value = observe(trace);
    if (value !== undefined) observations.push({ caseKey: trace.caseKey, value });
  }
  const n = observations.length;
  const sum = observations.reduce((total, observation) => total + observation.value, 0);
  const metric: Metric = {
    id, unit, definition, n, eligible: traces.length,
    value: n ? (kind === 'count' ? sum : (sum * (kind === 'rate' ? 100 : 1)) / n) : null,
    caseKeys: observations.filter(observation => kind === 'mean' || observation.value > 0)
      .map(observation => observation.caseKey),
    ...(n ? {} : { reason }),
  };
  if (kind !== 'mean') {
    nonNumeratorCases.set(metric, observations.filter(observation => observation.value === 0)
      .map(observation => observation.caseKey));
  }
  return metric;
}
