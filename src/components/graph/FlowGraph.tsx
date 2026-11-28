/**
 * Shared directed-graph view used by the DFG, the performance map and the
 * resource hand-over network. Renders engine outputs only: counts, labels and
 * case keys are passed in by the caller. Layout (dagre), stroke widths and
 * colours are presentation, not analysis.
 *
 * Layout is keyed by graph STRUCTURE (node and edge ids), so highlighting,
 * selection and label changes never re-layout or move the viewport.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { cx } from '../ui';

export type GraphNodeKind = 'activity' | 'start' | 'end' | 'resource';

export interface GraphNodeSpec {
  id: string;
  label: string;
  kind: GraphNodeKind;
  primary?: string;
  secondary?: string;
  /** Visually marks nodes without any edge (e.g. isolated resources). */
  isolated?: boolean;
  /** Optional accent colour for the left bar (e.g. repeat highlight). */
  accent?: string;
  /** Optional small badge rendered at the top-right (e.g. "+2 repeats", replay token count). */
  badge?: string;
  badgeTone?: 'amber' | 'brand' | 'green' | 'slate' | 'red';
  dim?: boolean;
  highlight?: boolean;
}

export interface GraphEdgeSpec {
  id: string;
  source: string;
  target: string;
  count: number;
  /** Start/end connectors are drawn lighter and excluded from width scaling. */
  terminal?: boolean;
  /** Label text; defaults to the count. */
  label?: string;
  /** Stroke colour override (e.g. performance heat). */
  color?: string;
  /** Dashed "no measurement" style. */
  noData?: boolean;
  dim?: boolean;
  highlight?: boolean;
}

export type GraphSelection = { type: 'node' | 'edge'; id: string } | null;

interface NodeData extends Record<string, unknown> {
  spec: GraphNodeSpec;
  selected: boolean;
  dir: 'LR' | 'TB';
}
interface EdgeData extends Record<string, unknown> {
  spec: GraphEdgeSpec;
  width: number;
  shape: 'normal' | 'self' | 'pair';
  pairRole?: 'a' | 'b';
  selected: boolean;
  dir: 'LR' | 'TB';
  onSelect: (id: string) => void;
  /** Dagre-routed waypoints plus the handle positions they were computed for. */
  route?: { points: Pt[]; source: Pt; target: Pt };
}
type Pt = { x: number; y: number };

const SIZE: Record<GraphNodeKind, { w: number; h: number }> = {
  activity: { w: 196, h: 54 },
  resource: { w: 184, h: 54 },
  start: { w: 64, h: 36 },
  end: { w: 64, h: 36 },
};

const COLORS = {
  edge: '#64748b',
  pairB: '#d97706',
  terminal: '#94a3b8',
  selected: '#4338ca',
  highlight: '#4f46e5',
};

const BADGE: Record<NonNullable<GraphNodeSpec['badgeTone']>, string> = {
  amber: 'bg-amber-500 text-white',
  brand: 'bg-brand-600 text-white',
  green: 'bg-emerald-600 text-white',
  slate: 'bg-slate-600 text-white',
  red: 'bg-red-600 text-white',
};

function PPNode({ data }: NodeProps<Node<NodeData>>) {
  const { spec, selected, dir } = data;
  const handles = (
    <>
      <Handle type="target" position={dir === 'TB' ? Position.Top : Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle type="source" position={dir === 'TB' ? Position.Bottom : Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-300" />
    </>
  );
  if (spec.kind === 'start' || spec.kind === 'end') {
    return (
      <div
        className={cx(
          'flex h-9 w-16 items-center justify-center rounded-full border text-[11px] font-semibold uppercase tracking-wide transition-opacity',
          spec.kind === 'start' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-400 bg-slate-100 text-slate-600',
          selected && 'ring-2 ring-brand-500',
          spec.dim && 'opacity-35',
        )}
      >
        {spec.label}
        {handles}
      </div>
    );
  }
  return (
    <div
      className={cx(
        'relative flex h-[54px] flex-col justify-center rounded-lg border bg-white px-3 shadow-sm transition-opacity',
        spec.kind === 'resource' ? 'w-[184px]' : 'w-[196px]',
        spec.isolated ? 'border-dashed border-slate-300' : spec.highlight ? 'border-brand-400' : 'border-slate-300',
        selected && 'ring-2 ring-brand-500 ring-offset-1',
        spec.dim && 'opacity-35',
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: spec.accent ?? (spec.kind === 'resource' ? '#0ea5e9' : '#6366f1') }}
      title={spec.label}
    >
      <div className="truncate text-[13.5px] font-semibold leading-tight text-slate-800">{spec.label}</div>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500 tabular">
        {spec.primary && <span className="rounded bg-slate-100 px-1.5 font-semibold text-slate-700">{spec.primary}</span>}
        {spec.secondary && <span className="truncate">{spec.secondary}</span>}
      </div>
      {spec.badge && (
        <span className={cx('absolute -right-2 -top-2.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold shadow-sm tabular', BADGE[spec.badgeTone ?? 'brand'])}>{spec.badge}</span>
      )}
      {handles}
    </div>
  );
}

function CountEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  if (!data) return null;
  const { spec } = data;
  let path: string;
  let lx: number;
  let ly: number;
  if (data.shape === 'self' && data.dir === 'TB') {
    // Loop around the right side of the box (source = bottom centre, target = top centre).
    const out = 150;
    path = `M ${sourceX} ${sourceY} C ${sourceX + out} ${sourceY + 40}, ${targetX + out} ${targetY - 40}, ${targetX} ${targetY}`;
    lx = sourceX + out * 0.76;
    ly = (sourceY + targetY) / 2;
  } else if (data.shape === 'self') {
    const lift = 72;
    path = `M ${sourceX} ${sourceY} C ${sourceX + 60} ${sourceY - lift}, ${targetX - 60} ${targetY - lift}, ${targetX} ${targetY}`;
    lx = (sourceX + targetX) / 2;
    ly = sourceY - lift * 0.78;
  } else if (data.shape === 'pair') {
    const mx = (sourceX + targetX) / 2;
    const my = (sourceY + targetY) / 2;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    const off = 34;
    const nx = (-dy / len) * off;
    const ny = (dx / len) * off;
    path = `M ${sourceX} ${sourceY} Q ${mx + nx * 2} ${my + ny * 2} ${targetX} ${targetY}`;
    lx = mx + nx;
    ly = my + ny;
  } else if (
    data.route &&
    Math.hypot(data.route.source.x - sourceX, data.route.source.y - sourceY) < 8 &&
    Math.hypot(data.route.target.x - targetX, data.route.target.y - targetY) < 8
  ) {
    // Follow dagre's route so long edges bend around intermediate nodes (until a node is dragged).
    const pts = [{ x: sourceX, y: sourceY }, ...data.route.points, { x: targetX, y: targetY }];
    path = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const n = pts[i + 1]!;
      path += ` Q ${p.x} ${p.y} ${(p.x + n.x) / 2} ${(p.y + n.y) / 2}`;
    }
    path += ` L ${targetX} ${targetY}`;
    const mid = data.route.points[Math.floor(data.route.points.length / 2)] ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
    lx = mid.x;
    ly = mid.y;
  } else {
    [path, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  }
  const color = edgeColor(data);
  const emphasised = data.selected || spec.highlight;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: emphasised ? data.width + 1.5 : data.width,
          strokeDasharray: spec.terminal || spec.noData ? '4 4' : data.pairRole === 'b' && !spec.color ? '7 4' : undefined,
          opacity: spec.dim ? 0.16 : 1,
          transition: 'opacity 150ms',
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => data.onSelect(id)}
          className={cx(
            'nodrag nopan absolute rounded-md border px-1.5 py-px text-[11.5px] font-semibold shadow-sm tabular transition-opacity',
            data.selected
              ? 'border-brand-600 bg-brand-600 text-white'
              : spec.highlight
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : spec.noData
                  ? 'border-slate-200 bg-white text-slate-400'
                  : 'border-slate-200 bg-white text-slate-700',
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
            pointerEvents: 'all',
            opacity: spec.dim ? 0.3 : 1,
            ...(spec.color && !data.selected && !spec.highlight ? { borderColor: spec.color, color: '#0f172a' } : {}),
          }}
          aria-label={`Transition ${spec.label ?? spec.count}`}
        >
          {spec.label ?? spec.count.toLocaleString('en-US')}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

function edgeColor(data: EdgeData): string {
  const { spec } = data;
  if (data.selected) return COLORS.selected;
  if (spec.highlight) return COLORS.highlight;
  if (spec.color) return spec.color;
  if (spec.terminal) return COLORS.terminal;
  if (data.pairRole === 'b') return COLORS.pairB;
  return COLORS.edge;
}

const nodeTypes = { pp: PPNode };
const edgeTypes = { count: CountEdge };

function layout(nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], rankdir: 'LR' | 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph(rankdir === 'TB' ? { rankdir, nodesep: 60, ranksep: 42, marginx: 16, marginy: 16 } : { rankdir, nodesep: 48, ranksep: 96, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: SIZE[n.kind].w, height: SIZE[n.kind].h });
  for (const e of edges) if (e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos = new Map<string, Pt>();
  for (const n of nodes) {
    const p = g.node(n.id) as Pt | undefined;
    pos.set(n.id, { x: (p?.x ?? 0) - SIZE[n.kind].w / 2, y: (p?.y ?? 0) - SIZE[n.kind].h / 2 });
  }
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const routes = new Map<string, { points: Pt[]; source: Pt; target: Pt }>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const pts = (g.edge(e.source, e.target) as { points?: Pt[] } | undefined)?.points;
    const sp = pos.get(e.source);
    const tp = pos.get(e.target);
    if (!pts || pts.length < 3 || !sp || !tp) continue;
    const ss = SIZE[kind.get(e.source)!];
    const ts = SIZE[kind.get(e.target)!];
    routes.set(`${e.source}\u0000${e.target}`, {
      points: pts.slice(1, -1),
      source: rankdir === 'TB' ? { x: sp.x + ss.w / 2, y: sp.y + ss.h } : { x: sp.x + ss.w, y: sp.y + ss.h / 2 },
      target: rankdir === 'TB' ? { x: tp.x + ts.w / 2, y: tp.y } : { x: tp.x, y: tp.y + ts.h / 2 },
    });
  }
  return { pos, routes };
}

export interface FlowGraphProps {
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
  selection: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  height?: number | string;
  rankdir?: 'LR' | 'TB';
  /** Changing this value re-fits the view (e.g. entering fullscreen). */
  fitKey?: string | number;
}

function FlowGraphInner({ nodes, edges, selection, onSelect, height = 520, rankdir = 'TB', fitKey }: FlowGraphProps) {
  const { fitView } = useReactFlow();
  const structureKey = useMemo(
    () => `${rankdir}|${nodes.map((n) => `${n.id}:${n.kind}`).join('\u0001')}|${edges.map((e) => `${e.source}>${e.target}`).join('\u0001')}`,
    [nodes, edges, rankdir],
  );
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { pos: positions, routes } = useMemo(() => layout(latest.current.nodes, latest.current.edges, rankdir), [structureKey]);

  const maxCount = useMemo(() => Math.max(1, ...edges.filter((e) => !e.terminal).map((e) => e.count)), [edges]);

  const rfNodes = useMemo<Node<NodeData>[]>(
    () =>
      nodes.map((spec) => ({
        id: spec.id,
        type: 'pp',
        position: positions.get(spec.id) ?? { x: 0, y: 0 },
        data: { spec, selected: selection?.type === 'node' && selection.id === spec.id, dir: rankdir },
      })),
    [nodes, positions, selection, rankdir],
  );

  const rfEdges = useMemo<Edge<EdgeData>[]>(() => {
    const ids = new Set(edges.map((e) => `${e.source}\u0000${e.target}`));
    const selectEdge = (id: string) => onSelect({ type: 'edge', id });
    return edges.map((e) => {
      const self = e.source === e.target;
      const hasReverse = !self && ids.has(`${e.target}\u0000${e.source}`);
      const selected = selection?.type === 'edge' && selection.id === e.id;
      const width = e.terminal ? 1.25 : 1.5 + 5 * (e.count / maxCount);
      const data: EdgeData = {
        spec: e,
        width,
        shape: self ? 'self' : hasReverse ? 'pair' : 'normal',
        pairRole: hasReverse ? (e.source < e.target ? 'a' : 'b') : undefined,
        selected,
        dir: rankdir,
        onSelect: selectEdge,
        route: !self && !hasReverse ? routes.get(`${e.source}\u0000${e.target}`) : undefined,
      };
      const color = edgeColor(data);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'count',
        zIndex: selected || e.highlight ? 10 : 0,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color, markerUnits: 'userSpaceOnUse' },
        data,
      };
    });
  }, [edges, maxCount, selection, onSelect, routes, rankdir]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.06, duration: 200, maxZoom: 1.1 }), 40);
    return () => clearTimeout(t);
  }, [structureKey, fitKey, fitView]);

  // Re-fit when the canvas itself changes size (window resize, layout settling on small screens).
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - last.w) < 8 && Math.abs(h - last.h) < 8) return;
      last = { w, h };
      clearTimeout(t);
      t = setTimeout(() => fitView({ padding: 0.06, duration: 150, maxZoom: 1.1 }), 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [fitView]);

  return (
    <div ref={box} style={{ height }} className="relative">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => onSelect({ type: 'node', id: n.id })}
        onEdgeClick={(_, e) => onSelect({ type: 'edge', id: e.id })}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        edgesFocusable
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.15 }}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} position="bottom-left" />
        {nodes.length > 12 && <MiniMap pannable zoomable className="!rounded-lg !border !border-slate-200" nodeColor="#c7d2fe" maskColor="rgba(241,245,249,0.7)" />}
      </ReactFlow>
    </div>
  );
}

export function FlowGraph(props: FlowGraphProps) {
  return (
    <ReactFlowProvider>
      <FlowGraphInner {...props} />
    </ReactFlowProvider>
  );
}

export function GraphLegend({ pairs }: { pairs?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-6 rounded bg-slate-500" /> Line width = how often
      </span>
      {pairs && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-6 border-t-2 border-dashed border-amber-600" /> Opposite direction (counted separately)
        </span>
      )}
      <span>Click a box, arrow or number for the cases behind it</span>
    </div>
  );
}
