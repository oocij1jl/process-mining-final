/**
 * Shared directed-graph view used by the DFG and the resource handoff network.
 * Renders engine outputs only: counts and case keys are passed in by the caller.
 * Layout (dagre) and stroke widths are presentation, not analysis.
 */
import { useEffect, useMemo } from 'react';
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
}

export interface GraphEdgeSpec {
  id: string;
  source: string;
  target: string;
  count: number;
  /** Start/end connectors are drawn lighter and excluded from width scaling. */
  terminal?: boolean;
}

export type GraphSelection = { type: 'node' | 'edge'; id: string } | null;

interface NodeData extends Record<string, unknown> {
  spec: GraphNodeSpec;
  selected: boolean;
}
interface EdgeData extends Record<string, unknown> {
  count: number;
  width: number;
  shape: 'normal' | 'self' | 'pair';
  pairRole?: 'a' | 'b';
  terminal: boolean;
  highlighted: boolean;
  onSelect: (id: string) => void;
  /** Dagre-routed waypoints plus the handle positions they were computed for. */
  route?: { points: Pt[]; source: Pt; target: Pt };
}
type Pt = { x: number; y: number };

const SIZE: Record<GraphNodeKind, { w: number; h: number }> = {
  activity: { w: 190, h: 58 },
  resource: { w: 180, h: 58 },
  start: { w: 64, h: 36 },
  end: { w: 64, h: 36 },
};

const COLORS = {
  edge: '#64748b',
  pairB: '#d97706',
  terminal: '#94a3b8',
  selected: '#4338ca',
};

function PPNode({ data }: NodeProps<Node<NodeData>>) {
  const { spec, selected } = data;
  const handles = (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-300" />
    </>
  );
  if (spec.kind === 'start' || spec.kind === 'end') {
    return (
      <div
        className={cx(
          'flex h-9 w-16 items-center justify-center rounded-full border text-[11px] font-semibold uppercase tracking-wide',
          spec.kind === 'start' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-400 bg-slate-100 text-slate-600',
          selected && 'ring-2 ring-brand-500',
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
        'flex h-[58px] flex-col justify-center rounded-md border bg-white px-3 shadow-sm',
        spec.kind === 'resource' ? 'w-[180px] border-l-4 border-l-sky-500' : 'w-[190px] border-l-4 border-l-brand-500',
        spec.isolated ? 'border-dashed border-slate-300' : 'border-slate-300',
        selected && 'ring-2 ring-brand-500 ring-offset-1',
      )}
      title={spec.label}
    >
      <div className="truncate text-[13px] font-semibold text-slate-800">{spec.label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 tabular">
        {spec.primary && <span className="rounded bg-slate-100 px-1 font-medium text-slate-700">{spec.primary}</span>}
        {spec.secondary && <span className="truncate">{spec.secondary}</span>}
      </div>
      {handles}
    </div>
  );
}

function CountEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  if (!data) return null;
  let path: string;
  let lx: number;
  let ly: number;
  if (data.shape === 'self') {
    const lift = 70;
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
  const color = data.highlighted
    ? COLORS.selected
    : data.terminal
      ? COLORS.terminal
      : data.pairRole === 'b'
        ? COLORS.pairB
        : COLORS.edge;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: data.highlighted ? data.width + 1 : data.width,
          strokeDasharray: data.terminal ? '4 4' : data.pairRole === 'b' ? '7 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => data.onSelect(id)}
          className={cx(
            'nodrag nopan absolute rounded border px-1.5 py-px text-[11px] font-semibold shadow-sm tabular',
            data.highlighted
              ? 'border-brand-500 bg-brand-600 text-white'
              : data.pairRole === 'b'
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-700',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all' }}
          aria-label={`Edge count ${data.count}`}
        >
          {data.count.toLocaleString('en-US')}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { pp: PPNode };
const edgeTypes = { count: CountEdge };

function layout(nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], rankdir: 'LR' | 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 46, ranksep: 90, marginx: 20, marginy: 20 });
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
      source: { x: sp.x + ss.w, y: sp.y + ss.h / 2 },
      target: { x: tp.x, y: tp.y + ts.h / 2 },
    });
  }
  return { pos, routes };
}

interface FlowGraphProps {
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
  selection: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  height?: number;
  rankdir?: 'LR' | 'TB';
}

function FlowGraphInner({ nodes, edges, selection, onSelect, height = 520, rankdir = 'LR' }: FlowGraphProps) {
  const { fitView } = useReactFlow();
  const { pos: positions, routes } = useMemo(() => layout(nodes, edges, rankdir), [nodes, edges, rankdir]);

  const maxCount = useMemo(() => Math.max(1, ...edges.filter((e) => !e.terminal).map((e) => e.count)), [edges]);

  const rfNodes = useMemo<Node<NodeData>[]>(
    () =>
      nodes.map((spec) => ({
        id: spec.id,
        type: 'pp',
        position: positions.get(spec.id) ?? { x: 0, y: 0 },
        data: { spec, selected: selection?.type === 'node' && selection.id === spec.id },
      })),
    [nodes, positions, selection],
  );

  const rfEdges = useMemo<Edge<EdgeData>[]>(() => {
    const ids = new Set(edges.map((e) => `${e.source}\u0000${e.target}`));
    const selectEdge = (id: string) => onSelect({ type: 'edge', id });
    return edges.map((e) => {
      const self = e.source === e.target;
      const hasReverse = !self && ids.has(`${e.target}\u0000${e.source}`);
      const highlighted = selection?.type === 'edge' && selection.id === e.id;
      const width = e.terminal ? 1.25 : 1.25 + 4.75 * (e.count / maxCount);
      const color = highlighted ? COLORS.selected : e.terminal ? COLORS.terminal : hasReverse && e.source > e.target ? COLORS.pairB : COLORS.edge;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'count',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color, markerUnits: 'userSpaceOnUse' },
        data: {
          count: e.count,
          width,
          shape: self ? 'self' : hasReverse ? 'pair' : 'normal',
          pairRole: hasReverse ? (e.source < e.target ? 'a' : 'b') : undefined,
          terminal: !!e.terminal,
          highlighted,
          onSelect: selectEdge,
          route: rankdir === 'LR' && !self && !hasReverse ? routes.get(`${e.source}\u0000${e.target}`) : undefined,
        },
      };
    });
  }, [edges, maxCount, selection, onSelect, routes, rankdir]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 200, maxZoom: 1.1 }), 30);
    return () => clearTimeout(t);
  }, [positions, fitView]);

  return (
    <div style={{ height }} className="rounded-md border border-slate-200 bg-slate-50/50">
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
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={18} color="#e2e8f0" />
        <Controls showInteractive={false} position="bottom-left" />
        {nodes.length > 10 && <MiniMap pannable zoomable className="!rounded-md !border !border-slate-200" nodeColor="#c7d2fe" maskColor="rgba(241,245,249,0.7)" />}
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
        <span className="inline-block h-[3px] w-6 rounded bg-slate-500" /> Edge width ∝ count
      </span>
      {pairs && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-6 border-t-2 border-dashed border-amber-600" /> Reverse direction of a bidirectional pair (counted separately)
        </span>
      )}
      <span>Scroll to zoom · drag to pan · click a node, edge or count for contributing cases</span>
    </div>
  );
}
