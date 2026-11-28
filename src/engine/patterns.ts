import type { CaseKey, Edge, Trace } from '../contracts';
import type { EventEvidenceRef, LifecycleIntervalEvidence, OverlapCaseEvidence, PatternAnalysis } from '../v03-contracts';
import { buildDFG } from './discovery';
import { matchLifecycle } from './traces';

type Interval = LifecycleIntervalEvidence;
type Overlap = { activities: [string, string]; count: number; cases: OverlapCaseEvidence[] };

function compareRef(a: EventEvidenceRef, b: EventEvidenceRef) {
  return a.timestampMs - b.timestampMs || a.sourceOrder - b.sourceOrder;
}

function compareIntervals(a: Interval, b: Interval) {
  return compareRef(a.start, b.start) || compareRef(a.complete, b.complete);
}

function countOverlaps(intervals: Interval[], caseKey: CaseKey, results: Map<string, Overlap>) {
  intervals.sort(compareIntervals);
  const byEnd = [...intervals].sort((a, b) => compareRef(a.complete, b.complete));
  const active = new Map<string, Set<Interval>>();
  const casePatterns = new Map<string, OverlapCaseEvidence>();
  let expired = 0;
  for (const interval of intervals) {
    while (expired < byEnd.length && byEnd[expired].complete.timestampMs <= interval.start.timestampMs) {
      const previous = byEnd[expired++];
      const group = active.get(previous.activity)!;
      group.delete(previous);
      if (!group.size) active.delete(previous.activity);
    }
    for (const [activity, group] of active) {
      if (activity === interval.activity) continue;
      const earliest = group.values().next().value!;
      const example: [Interval, Interval] = activity < interval.activity ? [earliest, interval] : [interval, earliest];
      const activities: [string, string] = [example[0].activity, example[1].activity];
      const key = JSON.stringify(activities);
      let result = results.get(key);
      if (!result) {
        result = { activities, count: 0, cases: [] };
        results.set(key, result);
      }
      result.count += group.size;
      const prior = casePatterns.get(key);
      if (prior) {
        prior.count += group.size;
        if ((compareIntervals(example[0], prior.example[0]) || compareIntervals(example[1], prior.example[1])) < 0) {
          prior.example = example;
        }
      } else {
        const evidence = { caseKey, count: group.size, example };
        casePatterns.set(key, evidence);
        result.cases.push(evidence);
      }
    }
    const group = active.get(interval.activity) ?? new Set();
    group.add(interval);
    active.set(interval.activity, group);
  }
}

export function getPatternEvidence(traces: readonly Trace[]): PatternAnalysis {
  const { edges } = buildDFG(traces);
  const traceIndex = new Map(traces.map(({ caseKey }, index) => [caseKey, index]));
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const alternatives = outgoing.get(edge.from) ?? [];
    alternatives.push(edge);
    outgoing.set(edge.from, alternatives);
  }
  const divergences: PatternAnalysis['divergences'] = [];
  for (const [from, alternatives] of outgoing) {
    if (alternatives.length < 2) continue;
    const seen = new Set<CaseKey>();
    let outgoingCount = 0;
    for (const edge of alternatives) {
      outgoingCount += edge.count;
      for (const caseKey of edge.caseKeys) seen.add(caseKey);
    }
    const caseKeys = [...seen].sort((a, b) => traceIndex.get(a)! - traceIndex.get(b)!);
    divergences.push({ from, outgoingCount, alternatives, caseKeys });
  }

  const loops = new Map<string, { outer: string; via: string; count: number; cases: Set<CaseKey> }>();
  const overlaps = new Map<string, Overlap>();
  let matchedPairs = 0;
  let ambiguousPairs = 0;
  for (const trace of traces) {
    const { caseKey, sequence } = trace;
    for (let i = 2; i < sequence.length; i++) {
      const outer = sequence[i - 2].activity;
      const via = sequence[i - 1].activity;
      if (outer === via || outer !== sequence[i].activity) continue;
      const key = JSON.stringify([outer, via]);
      const loop = loops.get(key) ?? { outer, via, count: 0, cases: new Set() };
      loop.count++;
      loop.cases.add(caseKey);
      loops.set(key, loop);
    }
    const { pairs, ambiguousPairs: ambiguous } = matchLifecycle(trace);
    matchedPairs += pairs.length;
    ambiguousPairs += ambiguous;
    const intervals: Interval[] = [];
    for (const { start, complete } of pairs) {
      if (start.timestampMs >= complete.timestampMs) continue;
      intervals.push({
        activity: complete.activity,
        start: { caseKey, timestampMs: start.timestampMs, sourceOrder: start.sourceOrder },
        complete: { caseKey, timestampMs: complete.timestampMs, sourceOrder: complete.sourceOrder },
      });
    }
    countOverlaps(intervals, caseKey, overlaps);
  }

  return {
    sequences: edges, divergences, selfLoops: edges.filter(edge => edge.from === edge.to),
    shortLoops: Array.from(loops.values(), ({ cases, ...loop }) => ({ ...loop, caseKeys: [...cases] })),
    overlaps: [...overlaps.values()], matchedPairs, ambiguousPairs,
  };
}
