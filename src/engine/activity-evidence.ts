import type { CaseKey, Trace } from '../contracts';
import type { ActivityEvidence, ActivityEvidenceAnalysis } from '../v03-contracts';
import { assertProcessScope, matchLifecycle, MINUTE_MS } from './traces';

interface ActivityCounter {
  occurrenceCount: number;
  occurrenceCaseKeys: CaseKey[];
  repeatedCaseKeys: CaseKey[];
  extraOccurrenceCount: number;
  matchedCount: number;
  serviceMs: number;
  serviceCases: Set<CaseKey>;
}

export function getActivityEvidence(traces: readonly Trace[]): ActivityEvidenceAnalysis {
  assertProcessScope(traces);
  const byActivity = new Map<string, ActivityCounter>();
  const discoveredCaseKeys: CaseKey[] = [];
  const repeatedCaseKeys: CaseKey[] = [];
  let extraOccurrenceCount = 0;

  for (const trace of traces) {
    if (!trace.sequence.length) continue;
    discoveredCaseKeys.push(trace.caseKey);
    const counts = new Map<string, number>();
    for (const { activity } of trace.sequence) counts.set(activity, (counts.get(activity) ?? 0) + 1);

    let repeats = false;
    for (const [activity, count] of counts) {
      const counter = byActivity.get(activity) ?? {
        occurrenceCount: 0, occurrenceCaseKeys: [], repeatedCaseKeys: [], extraOccurrenceCount: 0,
        matchedCount: 0, serviceMs: 0, serviceCases: new Set<CaseKey>(),
      };
      counter.occurrenceCount += count;
      counter.occurrenceCaseKeys.push(trace.caseKey);
      if (count > 1) {
        repeats = true;
        counter.repeatedCaseKeys.push(trace.caseKey);
        counter.extraOccurrenceCount += count - 1;
        extraOccurrenceCount += count - 1;
      }
      byActivity.set(activity, counter);
    }
    if (repeats) repeatedCaseKeys.push(trace.caseKey);

    for (const { start, complete } of matchLifecycle(trace).pairs) {
      const counter = byActivity.get(complete.activity)!;
      counter.matchedCount++;
      counter.serviceMs += complete.timestampMs - start.timestampMs;
      counter.serviceCases.add(trace.caseKey);
    }
  }

  const activities = Array.from(byActivity, ([activity, counter]): ActivityEvidence => ({
    activity,
    occurrenceCount: counter.occurrenceCount,
    occurrenceCaseKeys: counter.occurrenceCaseKeys,
    repeatedCaseKeys: counter.repeatedCaseKeys,
    extraOccurrenceCount: counter.extraOccurrenceCount,
    service: {
      n: counter.matchedCount,
      eligible: counter.occurrenceCount,
      totalMin: counter.matchedCount ? counter.serviceMs / MINUTE_MS : null,
      meanMin: counter.matchedCount ? counter.serviceMs / counter.matchedCount / MINUTE_MS : null,
      caseKeys: [...counter.serviceCases],
    },
  }));
  return {
    selectedCases: traces.length, discoveredCases: discoveredCaseKeys.length, discoveredCaseKeys, repeatedCaseKeys,
    repeatRatePct: discoveredCaseKeys.length ? 100 * repeatedCaseKeys.length / discoveredCaseKeys.length : null,
    extraOccurrenceCount, activities,
  };
}
