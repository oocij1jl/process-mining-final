/**
 * Graph specs built from engine DTOs (presentation only). Counts, means and
 * case keys are the engine's values; the minimum edge count is a DISPLAY
 * filter that never changes analysis, findings or exports (V03_CONTRACT §2).
 */
import type { DFG, Edge, GapSummary, ResourceAnalysis } from '../../contracts';
import type { GraphEdgeSpec, GraphNodeSpec } from '../../components/graph/FlowGraph';
import { fmtMinutes, plural, resourceLabel } from '../../lib/format';

export const START = '__start__';
export const END = '__end__';
export const nodeId = (activity: string) => `a:${activity}`;
export const edgeId = (from: string, to: string) => `e:${JSON.stringify([from, to])}`;
export const startEdgeId = (a: string) => `s:${a}`;
export const endEdgeId = (a: string) => `t:${a}`;
export const rNode = (r: string) => `r:${r}`;
export const hEdge = (from: string, to: string) => `h:${JSON.stringify([from, to])}`;

export function parseEdgeId(id: string): [string, string] | null {
  if (!id.startsWith('e:') && !id.startsWith('h:')) return null;
  try {
    const v = JSON.parse(id.slice(2)) as unknown;
    return Array.isArray(v) && v.length === 2 ? [String(v[0]), String(v[1])] : null;
  } catch {
    return null;
  }
}

export interface Highlight {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface DisplayStats {
  shownEdges: number;
  totalEdges: number;
  shownTerminal: number;
  totalTerminal: number;
}

export interface DfgGraphOptions {
  minCount: number;
  edgeLabel?: (e: Edge) => string | undefined;
  edgeColor?: (e: Edge) => string | undefined;
  edgeNoData?: (e: Edge) => boolean;
  nodeText?: (n: DFG['nodes'][number]) => Pick<GraphNodeSpec, 'primary' | 'secondary' | 'accent' | 'badge' | 'badgeTone'>;
  highlight?: Highlight | null;
}

export function dfgGraph(dfg: DFG, o: DfgGraphOptions): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[]; stats: DisplayStats } {
  const hl = o.highlight && (o.highlight.nodes.size || o.highlight.edges.size) ? o.highlight : null;
  const nodes: GraphNodeSpec[] = [
    { id: START, label: 'Start', kind: 'start', dim: !!hl && !hl.nodes.has(START) },
    ...dfg.nodes.map((n) => ({
      id: nodeId(n.activity),
      label: n.activity,
      kind: 'activity' as const,
      primary: n.count.toLocaleString('en-US'),
      secondary: plural(n.caseKeys.length, 'case'),
      ...(o.nodeText ? o.nodeText(n) : {}),
      dim: !!hl && !hl.nodes.has(nodeId(n.activity)),
      highlight: !!hl && hl.nodes.has(nodeId(n.activity)),
    })),
    { id: END, label: 'End', kind: 'end', dim: !!hl && !hl.nodes.has(END) },
  ];
  const starts = Object.entries(dfg.starts);
  const ends = Object.entries(dfg.ends);
  const visibleStarts = starts.filter(([, c]) => c >= o.minCount);
  const visibleEnds = ends.filter(([, c]) => c >= o.minCount);
  const visible = dfg.edges.filter((e) => e.count >= o.minCount);
  const flag = (id: string) => ({ dim: !!hl && !hl.edges.has(id), highlight: !!hl && hl.edges.has(id) });
  const edges: GraphEdgeSpec[] = [
    ...visibleStarts.map(([a, c]) => ({ id: startEdgeId(a), source: START, target: nodeId(a), count: c, terminal: true, ...flag(startEdgeId(a)) })),
    ...visible.map((e) => {
      const id = edgeId(e.from, e.to);
      return {
        id,
        source: nodeId(e.from),
        target: nodeId(e.to),
        count: e.count,
        label: o.edgeLabel?.(e),
        color: o.edgeColor?.(e),
        noData: o.edgeNoData?.(e),
        ...flag(id),
      };
    }),
    ...visibleEnds.map(([a, c]) => ({ id: endEdgeId(a), source: nodeId(a), target: END, count: c, terminal: true, ...flag(endEdgeId(a)) })),
  ];
  return {
    nodes,
    edges,
    stats: { shownEdges: visible.length, totalEdges: dfg.edges.length, shownTerminal: visibleStarts.length + visibleEnds.length, totalTerminal: starts.length + ends.length },
  };
}

/** Highlight for one ordered activity sequence (a variant or a case path). */
export function pathHighlight(activities: readonly string[]): Highlight {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!activities.length) return { nodes, edges };
  nodes.add(START);
  nodes.add(END);
  edges.add(startEdgeId(activities[0]!));
  edges.add(endEdgeId(activities[activities.length - 1]!));
  activities.forEach((a, i) => {
    nodes.add(nodeId(a));
    if (i > 0) edges.add(edgeId(activities[i - 1]!, a));
  });
  return { nodes, edges };
}

export function edgesHighlight(pairs: readonly { from: string; to: string }[], extraNodes: readonly string[] = []): Highlight {
  const nodes = new Set<string>(extraNodes.map(nodeId));
  const edges = new Set<string>();
  for (const p of pairs) {
    nodes.add(nodeId(p.from));
    nodes.add(nodeId(p.to));
    edges.add(edgeId(p.from, p.to));
  }
  return { nodes, edges };
}

/** Sequential warm scale for performance display (presentation of engine means). */
export function heatColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [148, 163, 184]],
    [0.5, [245, 158, 11]],
    [1, [220, 38, 38]],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0 || 1);
      const c = c0.map((v, j) => Math.round(v + (c1[j]! - v) * k));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(220,38,38)';
}

export type GapType = 'inter_event' | 'matched_gap';

export function gapFor(gaps: readonly GapSummary[] | null, type: GapSummary['metricType'], from: string, to?: string): GapSummary | undefined {
  return gaps?.find((g) => g.metricType === type && g.from === from && (to === undefined ? g.to === undefined : g.to === to));
}

export function serviceFor(gaps: readonly GapSummary[] | null, activity: string): GapSummary | undefined {
  return gaps?.find((g) => g.metricType === 'service' && g.from === activity);
}

export const fmtGap = (g: GapSummary | undefined) => (g ? fmtMinutes(g.meanMin) : '—');

/**
 * Hand-over network spec. `focus` and `minCount` are DISPLAY filters only:
 * counts are the engine's values for the whole analysis scope.
 */
export function handoffGraph(ra: ResourceAnalysis, focus: ReadonlySet<string>, minCount: number, highlight?: Highlight | null) {
  const connected = new Set(ra.handoffs.flatMap((h) => [h.from, h.to]));
  const byFocus = focus.size ? ra.handoffs.filter((h) => focus.has(h.from) || focus.has(h.to)) : ra.handoffs;
  const edgesShown = byFocus.filter((h) => h.count >= minCount);
  const visible = focus.size ? new Set([...focus, ...edgesShown.flatMap((h) => [h.from, h.to])]) : null;
  const hl = highlight && (highlight.nodes.size || highlight.edges.size) ? highlight : null;
  const nodes: GraphNodeSpec[] = ra.resources
    .filter((r) => !visible || visible.has(r.resource))
    .map((r) => ({
      id: rNode(r.resource),
      label: resourceLabel(r.resource),
      kind: 'resource',
      primary: `${r.instances} steps`,
      secondary: `${plural(r.distinctCases, 'case')}${r.roles.length ? ` · ${r.roles.join(', ')}` : ''}`,
      isolated: !connected.has(r.resource),
      dim: !!hl && !hl.nodes.has(rNode(r.resource)),
      highlight: !!hl && hl.nodes.has(rNode(r.resource)),
    }));
  const edges: GraphEdgeSpec[] = edgesShown.map((h) => {
    const id = hEdge(h.from, h.to);
    return { id, source: rNode(h.from), target: rNode(h.to), count: h.count, dim: !!hl && !hl.edges.has(id), highlight: !!hl && hl.edges.has(id) };
  });
  return { nodes, edges, stats: { shownEdges: edgesShown.length, totalEdges: ra.handoffs.length, shownTerminal: 0, totalTerminal: 0 } };
}
