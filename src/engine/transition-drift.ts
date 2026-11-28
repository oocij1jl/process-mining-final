import type { CaseKey, Trace } from '../contracts';
import type { DriftPeriodEvidence, EventWindow, TransitionDrift, TransitionDriftRow } from '../v03-contracts';
import { validateWindow } from './time';
import { assertProcessScope, MINUTE_MS } from './traces';

interface EdgeCount {
  count: number;
  totalGapMs: number;
  cases: Set<CaseKey>;
}

function periodEvidence(edge: EdgeCount | undefined, outgoingCount: number): DriftPeriodEvidence {
  const count = edge?.count ?? 0;
  return {
    count, outgoingCount, sharePct: outgoingCount ? 100 * count / outgoingCount : null,
    meanGapMin: edge ? edge.totalGapMs / edge.count / MINUTE_MS : null, gapN: count,
    caseKeys: edge ? [...edge.cases] : [],
  };
}

function delta(previous: number | null, current: number | null): number | null {
  return previous === null || current === null ? null : current - previous;
}

function support(change: number | null, previousN: number, currentN: number): TransitionDriftRow['shareSupport'] {
  return change === null ? 'unavailable' : Math.min(previousN, currentN) < 3 ? 'low' : 'sufficient';
}

export function getTransitionDrift(traces: readonly Trace[], baseline: EventWindow, recent: EventWindow): TransitionDrift {
  assertProcessScope(traces);
  validateWindow(baseline);
  validateWindow(recent);
  if (baseline.endMs > recent.startMs) throw new RangeError('Choose a baseline window ending before or at the recent window.');

  const periods = [baseline, recent].map(window => ({ window, outgoing: new Map<string, number>(), edges: new Map<string, EdgeCount>() }));
  const pairs = new Map<string, { from: string; to: string }>();
  for (const { caseKey, sequence } of traces) {
    for (let i = 1; i < sequence.length; i++) {
      const [previous, current] = [sequence[i - 1], sequence[i]];
      const period = periods.find(({ window }) => current.timestampMs >= window.startMs && current.timestampMs < window.endMs);
      if (!period) continue;
      const from = previous.activity;
      const to = current.activity;
      const edgeKey = JSON.stringify([from, to]);
      if (!pairs.has(edgeKey)) pairs.set(edgeKey, { from, to });
      const edge = period.edges.get(edgeKey) ?? { count: 0, totalGapMs: 0, cases: new Set() };
      edge.count++;
      edge.totalGapMs += current.timestampMs - previous.timestampMs;
      edge.cases.add(caseKey);
      period.edges.set(edgeKey, edge);
      period.outgoing.set(from, (period.outgoing.get(from) ?? 0) + 1);
    }
  }
  const transitions = Array.from(pairs, ([key, { from, to }]): TransitionDriftRow => {
    const [before, after] = periods.map(period => periodEvidence(period.edges.get(key), period.outgoing.get(from) ?? 0));
    const deltaSharePp = delta(before.sharePct, after.sharePct);
    const deltaMeanGapMin = delta(before.meanGapMin, after.meanGapMin);
    return {
      from, to, baseline: before, recent: after, deltaSharePp, deltaMeanGapMin,
      shareSupport: support(deltaSharePp, before.outgoingCount, after.outgoingCount),
      gapSupport: support(deltaMeanGapMin, before.gapN, after.gapN),
    };
  });
  return { baseline: { ...baseline }, recent: { ...recent }, transitions };
}
