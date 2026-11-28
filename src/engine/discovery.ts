import type { CaseDuration, DFG, Edge, Trace, Variant } from '../contracts';
import { assertProcessScope } from './traces';

interface Count {
  count: number;
  cases: Set<string>;
}

function countCase(counter: Count, caseKey: string) {
  counter.count++;
  counter.cases.add(caseKey);
}

export function buildDFG(traces: readonly Trace[]): DFG {
  assertProcessScope(traces);
  const nodes = new Map<string, Count>();
  const edges = new Map<string, Count & Pick<Edge, 'from' | 'to'>>();
  const starts = new Map<string, string[]>();
  const ends = new Map<string, string[]>();

  function recordEndpoint(map: Map<string, string[]>, activity: string, caseKey: string) {
    const cases = map.get(activity);
    if (cases) cases.push(caseKey);
    else map.set(activity, [caseKey]);
  }

  for (const { caseKey, sequence } of traces) {
    if (!sequence.length) continue;
    const start = sequence[0].activity;
    const end = sequence[sequence.length - 1].activity;
    recordEndpoint(starts, start, caseKey);
    recordEndpoint(ends, end, caseKey);

    for (let index = 0; index < sequence.length; index++) {
      const to = sequence[index].activity;
      const node = nodes.get(to) ?? { count: 0, cases: new Set<string>() };
      nodes.set(to, node);
      countCase(node, caseKey);
      if (index === 0) continue;
      const from = sequence[index - 1].activity;
      const key = JSON.stringify([from, to]);
      const edge = edges.get(key) ?? { from, to, count: 0, cases: new Set<string>() };
      edges.set(key, edge);
      countCase(edge, caseKey);
    }
  }

  return {
    nodes: Array.from(nodes, ([activity, { count, cases }]) => ({ activity, count, caseKeys: [...cases] })),
    edges: Array.from(edges.values(), ({ from, to, count, cases }) => ({ from, to, count, caseKeys: [...cases] })),
    starts: Object.fromEntries(Array.from(starts, ([activity, cases]) => [activity, cases.length])),
    ends: Object.fromEntries(Array.from(ends, ([activity, cases]) => [activity, cases.length])),
    startCases: Object.fromEntries(starts),
    endCases: Object.fromEntries(ends),
  };
}

export function getVariants(traces: readonly Trace[]): Variant[] {
  assertProcessScope(traces);
  const variants = new Map<string, { activities: string[]; totalMin: number; caseKeys: string[] }>();
  let discoveredCases = 0;

  for (const trace of traces) {
    if (!trace.sequence.length) continue;
    discoveredCases++;
    const activities = trace.sequence.map(event => event.activity);
    const id = JSON.stringify(activities);
    const variant = variants.get(id) ?? { activities, totalMin: 0, caseKeys: [] };
    variant.totalMin += trace.elapsedMin;
    variant.caseKeys.push(trace.caseKey);
    variants.set(id, variant);
  }

  return Array.from(variants, ([id, { activities, totalMin, caseKeys }]) => ({
    id, activities, caseKeys, count: caseKeys.length,
    share: caseKeys.length / discoveredCases,
    avgElapsedMin: totalMin / caseKeys.length,
  })).sort((a, b) => b.count - a.count);
}

export function getCaseDurations(traces: readonly Trace[]): CaseDuration[] {
  assertProcessScope(traces);
  return traces.map(({ caseKey, elapsedMin }) => ({ caseKey, elapsedMin }));
}
