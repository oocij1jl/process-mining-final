import type { Trace } from '../contracts';
import type { CaseThroughputMetric, CaseThroughputOptions, HistoricalTrendBucket, HistoricalTrends, TimeBucketOptions } from '../v03-contracts';
import { completionActivities, completionMarker } from './completion';
import { assertProcessScope, hasRepeatedActivity } from './traces';
import { bucketGrid, observationWindow } from './time';

export function getHistoricalTrends(traces: readonly Trace[], buckets: TimeBucketOptions): HistoricalTrends {
  assertProcessScope(traces);
  const grid = bucketGrid(buckets);
  const window = observationWindow(traces, true);
  if (!window) return { observationWindow: null, buckets: [], unavailable: 'empty_scope' };
  const dense = grid.dense(window);
  if (!dense) return { observationWindow: window, buckets: [], unavailable: 'bucket_limit' };

  const trend = dense.windows.map(bounds => ({
    ...bounds, totalElapsed: 0, elapsedCaseKeys: [] as string[], repeatN: 0, repeatedCaseKeys: [] as string[],
  }));
  for (const trace of traces) {
    const slot = trend[dense.slot(trace.events[0].timestampMs)];
    slot.totalElapsed += trace.elapsedMin;
    slot.elapsedCaseKeys.push(trace.caseKey);
    if (trace.sequence.length) {
      slot.repeatN++;
      if (hasRepeatedActivity(trace)) slot.repeatedCaseKeys.push(trace.caseKey);
    }
  }
  return {
    observationWindow: window, unavailable: null,
    buckets: trend.map(({ totalElapsed, ...bucket }): HistoricalTrendBucket => {
      const n = bucket.elapsedCaseKeys.length;
      return {
        ...bucket, elapsedN: n, caseCount: n, meanElapsedMin: n ? totalElapsed / n : null,
        repeatRatePct: bucket.repeatN ? 100 * bucket.repeatedCaseKeys.length / bucket.repeatN : null,
      };
    }),
  };
}

export function getCaseThroughput(traces: readonly Trace[], options: CaseThroughputOptions): CaseThroughputMetric {
  assertProcessScope(traces);
  const grid = bucketGrid(options.buckets);
  const window = observationWindow(traces);
  const terminal = options.completion === undefined ? undefined : completionActivities(options.completion);
  const base = {
    id: 'case_throughput' as const,
    unit: 'cases/bucket' as const,
    eligible: traces.length,
    observationWindow: window,
    problemCaseKeys: { min: null, max: null },
    definition: `Mean recorded completions per ${options.buckets.bucketMinutes}-minute bucket. Each case contributes at its first matching complete or point event.`,
    ...(terminal ? { definitionKey: JSON.stringify(['case_throughput', [...terminal].sort(), grid.widthMs, grid.anchorResidue]) } : {}),
  };
  function unavailable(
    code: NonNullable<CaseThroughputMetric['unavailable']>, reason: string,
  ): CaseThroughputMetric {
    return { ...base, value: null, n: 0, caseKeys: [], buckets: [], unavailable: code, reason };
  }
  if (!terminal) return unavailable('missing_completion', 'Choose completion activities to measure throughput.');
  if (!window) return unavailable('empty_scope', 'No accepted events in the current selection.');
  const dense = grid.dense(window);
  if (!dense) return unavailable('bucket_limit', 'Choose a wider bucket or smaller log scope within the supported date range.');

  const buckets = dense.windows.map(bounds => ({ ...bounds, count: 0, caseKeys: [] as string[] }));
  const caseKeys: string[] = [];
  for (const trace of traces) {
    const marker = completionMarker(trace, terminal);
    if (!marker) continue;
    const bucket = buckets[dense.slot(marker.timestampMs)];
    bucket.count++;
    bucket.caseKeys.push(trace.caseKey);
    caseKeys.push(trace.caseKey);
  }
  return { ...base, value: caseKeys.length / buckets.length, n: caseKeys.length, caseKeys, buckets, unavailable: null };
}
