import type { EventRow, Trace } from '../contracts';
import type {
  CompletionDefinition, EventEvidenceRef, LifecycleIntervalEvidence, ReplayEvent, ReplayFrame, ReplayIndex, ReplayQuery,
} from '../v03-contracts';
import { completionActivities, completionMarker } from './completion';
import { observationWindow, validateWindow, validInstant } from './time';
import { assertProcessScope, matchLifecycle } from './traces';

function evidence({ caseKey, timestampMs, sourceOrder }: EventRow): EventEvidenceRef {
  return { caseKey, timestampMs, sourceOrder };
}

function replayEvent(event: EventRow): ReplayEvent {
  return { ...evidence(event), activity: event.activity, lifecycle: event.lifecycle };
}

export function buildReplayIndex(traces: readonly Trace[], completion?: CompletionDefinition): ReplayIndex {
  assertProcessScope(traces);
  const terminal = completion === undefined ? undefined : completionActivities(completion);
  return {
    observationWindow: observationWindow(traces),
    cases: traces.map(trace => {
      const events = trace.events.map(replayEvent);
      const marker = completionMarker(trace, terminal);
      const intervals: LifecycleIntervalEvidence[] = [];
      for (const { start, complete } of matchLifecycle(trace).pairs) {
        if (start.timestampMs < complete.timestampMs) {
          intervals.push({ activity: complete.activity, start: evidence(start), complete: evidence(complete) });
        }
      }
      return {
        caseKey: trace.caseKey, events, intervals, completion: marker ? replayEvent(marker) : null,
        variantId: trace.sequence.length ? JSON.stringify(trace.sequence.map(event => event.activity)) : null,
      };
    }),
  };
}

function lastObserved(events: readonly ReplayEvent[], cursorMs: number): number {
  let left = 0;
  let right = events.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (events[mid].timestampMs <= cursorMs) left = mid + 1;
    else right = mid;
  }
  return left - 1;
}

export function getReplayFrame(index: ReplayIndex, { window, cursorMs, variantIds }: ReplayQuery): ReplayFrame {
  validateWindow(window);
  if (!validInstant(cursorMs) || cursorMs < window.startMs || cursorMs >= window.endMs) {
    throw new RangeError('The replay cursor must be inside the replay window.');
  }
  const ids = variantIds === undefined ? null : new Set(variantIds);
  if (ids?.size) {
    const known = new Set(index.cases.map(item => item.variantId));
    if ([...ids].some(id => !known.has(id))) throw new RangeError('Choose variants from this replay index.');
  }

  const frame: ReplayFrame = {
    cursorMs, selectedCases: 0, cases: [],
    counts: { active: 0, latest_observation: 0, last_observation: 0, completed: 0, not_yet_observed: 0 },
  };
  for (const item of index.cases) {
    if (ids && (item.variantId === null || !ids.has(item.variantId))) continue;
    frame.selectedCases++;
    const last = lastObserved(item.events, cursorMs);
    if (last < 0) {
      frame.counts.not_yet_observed++;
      continue;
    }
    const active = item.intervals.filter(interval => interval.start.timestampMs <= cursorMs && cursorMs < interval.complete.timestampMs);
    const state = item.completion && item.completion.timestampMs <= cursorMs ? 'completed'
      : active.length ? 'active' : last + 1 < item.events.length ? 'latest_observation' : 'last_observation';
    frame.counts[state]++;
    frame.cases.push({ caseKey: item.caseKey, state, latest: item.events[last], active });
  }
  return frame;
}
