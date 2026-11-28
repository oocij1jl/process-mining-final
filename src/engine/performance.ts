import type { GapSummary, PerformanceAnalysis, Trace } from '../contracts';
import { assertProcessScope, matchLifecycle, MINUTE_MS } from './traces';

export function getPerformance(traces: readonly Trace[]): PerformanceAnalysis {
  assertProcessScope(traces);
  const summaries = new Map<string, {
    metricType: GapSummary['metricType'];
    from: string;
    to?: string;
    totalMs: number;
    n: number;
    cases: Set<string>;
  }>();
  let matchedPairs = 0;
  let ambiguousPairs = 0;
  let overlaps = 0;

  function record(
    metricType: GapSummary['metricType'], from: string, to: string | undefined, ms: number, caseKey: string,
  ) {
    const key = JSON.stringify([metricType, from, to]);
    const summary = summaries.get(key) ?? {
      metricType, from, ...(to === undefined ? {} : { to }), totalMs: 0, n: 0, cases: new Set<string>(),
    };
    summary.totalMs += ms;
    summary.n++;
    summary.cases.add(caseKey);
    summaries.set(key, summary);
  }

  for (const trace of traces) {
    const { pairs, ambiguousPairs: ambiguous } = matchLifecycle(trace);
    matchedPairs += pairs.length;
    ambiguousPairs += ambiguous;
    const pairedStarts = new Map(pairs.map(({ start, complete }) => [complete, start]));
    for (const { start, complete } of pairs) {
      record('service', complete.activity, undefined, complete.timestampMs - start.timestampMs, trace.caseKey);
    }

    for (let index = 1; index < trace.sequence.length; index++) {
      const previous = trace.sequence[index - 1];
      const current = trace.sequence[index];
      record('inter_event', previous.activity, current.activity, current.timestampMs - previous.timestampMs, trace.caseKey);
      const start = pairedStarts.get(current);
      if (!start || previous.lifecycle !== 'complete') continue;
      const gap = start.timestampMs - previous.timestampMs;
      if (gap < 0) overlaps++;
      else record('matched_gap', previous.activity, current.activity, gap, trace.caseKey);
    }
  }

  return {
    gaps: Array.from(summaries.values(), ({ totalMs, cases, ...summary }) => ({
      ...summary, meanMin: totalMs / summary.n / MINUTE_MS, caseKeys: [...cases],
    })),
    overlaps,
    matchedPairs,
    ambiguousPairs,
  };
}
