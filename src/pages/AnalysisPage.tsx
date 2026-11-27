import { useCallback, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DFG, Finding, GapSummary, ResourceAnalysis, Variant } from '../contracts';
import { useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { gateScenarioAvailable } from '../festival/adapter';
import type { DesignRecord, PageId } from '../state/types';
import { caseLabel, fmtMinutes, fmtNumber, fmtPct, fmtShare, fmtValue, plural, resourceLabel } from '../lib/format';
import { FlowGraph, GraphLegend, type GraphEdgeSpec, type GraphNodeSpec, type GraphSelection } from '../components/graph/FlowGraph';
import { CaseKeyList } from '../components/cases';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, Input, KeyValue, Notice, PageHeader, Stat, Table, Tabs, Td, Th, cx } from '../components/ui';

type Tab = 'map' | 'variants' | 'performance' | 'resources' | 'findings';

export function AnalysisPage({ navigate }: { navigate: (p: PageId) => void }) {
  const [tab, setTab] = useState<Tab>('map');
  const { findings, variants } = useAnalysis();
  return (
    <div>
      <PageHeader
        phase="Phase 1 · Process analysis"
        title="Analysis"
        subtitle="Directly-follows graph, variants, performance, resource workload and handoffs, and evidence-linked findings for the selected process and case scope."
      />
      <RequireData navigate={navigate}>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'map', label: 'Process map (DFG)' },
            { id: 'variants', label: 'Variants', count: variants?.status === 'ok' ? variants.data.length : undefined },
            { id: 'performance', label: 'Performance' },
            { id: 'resources', label: 'Resources & handoffs' },
            { id: 'findings', label: 'Findings', count: findings?.status === 'ok' ? findings.data.length : undefined },
          ]}
        />
        {tab === 'map' && <ProcessMap />}
        {tab === 'variants' && <Variants />}
        {tab === 'performance' && <Performance />}
        {tab === 'resources' && <Resources />}
        {tab === 'findings' && <Findings navigate={navigate} />}
      </RequireData>
    </div>
  );
}

/* ------------------------------ DFG ------------------------------ */

const START = '__start__';
const END = '__end__';
const nodeId = (activity: string) => `a:${activity}`;
const edgeId = (from: string, to: string) => `e:${JSON.stringify([from, to])}`;

function dfgGraph(dfg: DFG): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] } {
  const nodes: GraphNodeSpec[] = [
    { id: START, label: 'Start', kind: 'start' },
    ...dfg.nodes.map((n) => ({
      id: nodeId(n.activity),
      label: n.activity,
      kind: 'activity' as const,
      primary: n.count.toLocaleString('en-US'),
      secondary: plural(n.caseKeys.length, 'case'),
    })),
    { id: END, label: 'End', kind: 'end' },
  ];
  const edges: GraphEdgeSpec[] = [
    ...Object.entries(dfg.starts).map(([a, c]) => ({ id: `s:${a}`, source: START, target: nodeId(a), count: c, terminal: true })),
    ...dfg.edges.map((e) => ({ id: edgeId(e.from, e.to), source: nodeId(e.from), target: nodeId(e.to), count: e.count })),
    ...Object.entries(dfg.ends).map(([a, c]) => ({ id: `t:${a}`, source: nodeId(a), target: END, count: c, terminal: true })),
  ];
  return { nodes, edges };
}

function ProcessMap() {
  const { dfg, performance } = useAnalysis();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const onSelect = useCallback((s: GraphSelection) => setSelection(s), []);
  const graph = useMemo(() => (dfg?.status === 'ok' ? dfgGraph(dfg.data) : null), [dfg]);

  return (
    <EngineGate result={dfg}>
      {(d) =>
        d.nodes.length === 0 ? (
          <EmptyState title="No discovery events">The selected cases have no complete or point events, so there is nothing to draw.</EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <Card
              title="Directly-follows graph"
              subtitle="Nodes: activity instances (complete/point events). Edges: adjacent transitions within a case. Concurrency is approximated by order."
              bodyClassName="p-3"
            >
              <FlowGraph nodes={graph!.nodes} edges={graph!.edges} selection={selection} onSelect={onSelect} height={560} />
              <div className="mt-2">
                <GraphLegend pairs />
              </div>
            </Card>
            <DfgInspector dfg={d} selection={selection} gaps={performance?.status === 'ok' ? performance.data.gaps : null} />
          </div>
        )
      }
    </EngineGate>
  );
}

function DfgInspector({ dfg, selection, gaps }: { dfg: DFG; selection: GraphSelection; gaps: GapSummary[] | null }) {
  if (!selection) {
    return (
      <Card title="Inspector">
        <KeyValue
          items={[
            ['Activities', dfg.nodes.length],
            ['Transitions', dfg.edges.length],
            ['Self-loops', dfg.edges.filter((e) => e.from === e.to).length],
            ['Start activities', Object.keys(dfg.starts).length],
            ['End activities', Object.keys(dfg.ends).length],
          ]}
        />
        <p className="mt-3 text-xs text-slate-500">Select a node or an edge (or its count label) to inspect contributing cases.</p>
      </Card>
    );
  }
  const { id } = selection;
  if (id === START || id === END) {
    const rec = id === START ? dfg.starts : dfg.ends;
    return (
      <Card title={id === START ? 'Start activities' : 'End activities'}>
        <Table>
          <tbody>
            {Object.entries(rec).map(([a, c]) => (
              <tr key={a}><Td>{a}</Td><Td align="right">{c}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }
  if (id.startsWith('s:') || id.startsWith('t:')) {
    const activity = id.slice(2);
    const isStart = id.startsWith('s:');
    return (
      <Card title={isStart ? `Start → ${activity}` : `${activity} → End`}>
        <KeyValue items={[['Cases', (isStart ? dfg.starts : dfg.ends)[activity] ?? 0]]} />
        <p className="mt-2 text-xs text-slate-500">The engine reports start/end counts without case keys. Select the activity node for its contributing cases.</p>
      </Card>
    );
  }
  if (id.startsWith('a:')) {
    const activity = id.slice(2);
    const node = dfg.nodes.find((n) => n.activity === activity);
    if (!node) return null;
    const service = gaps?.find((g) => g.metricType === 'service' && g.from === activity);
    return (
      <Card title={activity} subtitle="Activity">
        <KeyValue
          items={[
            ['Instances', node.count],
            ['Cases', node.caseKeys.length],
            ['Starts here', dfg.starts[activity] ?? 0],
            ['Ends here', dfg.ends[activity] ?? 0],
            ['Mean service', service ? `${fmtMinutes(service.meanMin)} (n=${service.n})` : 'N/A (no matched lifecycle pairs)'],
          ]}
        />
        <div className="mt-3 text-xs font-semibold text-slate-500">Outgoing</div>
        <ul className="mt-1 text-sm">
          {dfg.edges.filter((e) => e.from === activity).map((e) => (
            <li key={e.to} className="flex justify-between"><span>→ {e.to}</span><span className="tabular text-slate-500">{e.count}</span></li>
          ))}
        </ul>
        <div className="mt-4">
          <CaseKeyList caseKeys={node.caseKeys} />
        </div>
      </Card>
    );
  }
  const [from, to] = JSON.parse(id.slice(2)) as [string, string];
  const edge = dfg.edges.find((e) => e.from === from && e.to === to);
  if (!edge) return null;
  const related = gaps?.filter((g) => g.from === from && g.to === to) ?? [];
  return (
    <Card title={`${from} → ${to}`} subtitle={from === to ? 'Self-loop' : 'Transition'}>
      <KeyValue items={[['Occurrences', edge.count], ['Cases', edge.caseKeys.length]]} />
      <div className="mt-3 text-xs font-semibold text-slate-500">Measured gaps (from getPerformance)</div>
      {related.length ? (
        <ul className="mt-1 space-y-0.5 text-sm">
          {related.map((g) => (
            <li key={g.metricType} className="flex justify-between">
              <MetricTypeBadge type={g.metricType} />
              <span className="tabular">{fmtMinutes(g.meanMin)} · n={g.n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-sm text-slate-500">N/A</div>
      )}
      <div className="mt-4">
        <CaseKeyList caseKeys={edge.caseKeys} />
      </div>
    </Card>
  );
}

/* ------------------------------ Variants ------------------------------ */

function Variants() {
  const { variants } = useAnalysis();
  const [sort, setSort] = useState<'count' | 'elapsed' | 'length'>('count');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <EngineGate result={variants}>
      {(vs) => {
        if (!vs.length) return <EmptyState title="No variants">No case in scope has a nonempty discovery sequence.</EmptyState>;
        const sorted = [...vs].sort((a, b) =>
          sort === 'count' ? b.count - a.count : sort === 'elapsed' ? b.avgElapsedMin - a.avgElapsedMin : b.activities.length - a.activities.length,
        );
        const sel = vs.find((v) => v.id === selected) ?? null;
        const chart = [...vs].sort((a, b) => b.count - a.count).slice(0, 12).map((v, i) => ({ name: `V${i + 1}`, id: v.id, share: v.share * 100, count: v.count }));
        return (
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card
              title="Exact variants"
              subtitle="Identical ordered activity sequences. Share is over cases with a nonempty sequence."
              actions={
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-slate-400">Sort</span>
                  {(['count', 'elapsed', 'length'] as const).map((s) => (
                    <Button key={s} size="sm" variant={sort === s ? 'primary' : 'secondary'} onClick={() => setSort(s)}>{s}</Button>
                  ))}
                </div>
              }
            >
              <Table className="max-h-[560px]">
                <thead>
                  <tr>
                    <Th align="right">Cases</Th>
                    <Th align="right">Share</Th>
                    <Th align="right">Mean elapsed</Th>
                    <Th align="right">Length</Th>
                    <Th>Sequence</Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((v) => (
                    <tr key={v.id} onClick={() => setSelected(v.id)} className={cx('cursor-pointer hover:bg-slate-50', selected === v.id && 'bg-brand-50')}>
                      <Td align="right">{v.count}</Td>
                      <Td align="right">{fmtShare(v.share)}</Td>
                      <Td align="right">{fmtMinutes(v.avgElapsedMin)}</Td>
                      <Td align="right">{v.activities.length}</Td>
                      <Td><SequenceChips activities={v.activities} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <div className="space-y-4">
              <Card title="Top variants by share">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={chart} margin={{ left: -16, right: 8, top: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip formatter={(v) => `${fmtNumber(Number(v), 1)}%`} />
                      <Bar dataKey="share" radius={[3, 3, 0, 0]} onClick={(d) => setSelected((d as unknown as { id: string }).id)}>
                        {chart.map((c) => <Cell key={c.id} fill={c.id === selected ? '#4338ca' : '#818cf8'} cursor="pointer" />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              {sel ? <VariantDetail v={sel} /> : <Card title="Variant detail"><p className="text-sm text-slate-500">Select a variant to list its cases.</p></Card>}
            </div>
          </div>
        );
      }}
    </EngineGate>
  );
}

function SequenceChips({ activities }: { activities: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 text-xs">
      {activities.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-slate-300">›</span>}
          <span className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">{a}</span>
        </span>
      ))}
    </div>
  );
}

function VariantDetail({ v }: { v: Variant }) {
  return (
    <Card title="Variant detail" subtitle={`${v.count} cases · ${fmtShare(v.share)} · mean ${fmtMinutes(v.avgElapsedMin)}`}>
      <SequenceChips activities={v.activities} />
      <div className="mt-3">
        <CaseKeyList caseKeys={v.caseKeys} />
      </div>
    </Card>
  );
}

/* ------------------------------ Performance ------------------------------ */

const METRIC_TYPE_COPY: Record<GapSummary['metricType'], { label: string; help: string }> = {
  inter_event: { label: 'Inter-event gap', help: 'Time between consecutive discovery events. Not necessarily waiting time.' },
  matched_gap: { label: 'Matched transition gap', help: 'Next valid paired start minus preceding completion. Overlaps are excluded and counted separately.' },
  service: { label: 'Service time', help: 'Matched complete − start of the same activity instance. Point events never get a duration.' },
};

export function MetricTypeBadge({ type }: { type: GapSummary['metricType'] }) {
  return <Badge tone={type === 'service' ? 'green' : type === 'matched_gap' ? 'violet' : 'blue'}>{METRIC_TYPE_COPY[type].label}</Badge>;
}

function Performance() {
  const { performance, durations } = useAnalysis();
  const [type, setType] = useState<GapSummary['metricType']>('inter_event');
  const [selected, setSelected] = useState<GapSummary | null>(null);
  return (
    <div className="space-y-4">
      <EngineGate result={performance}>
        {(p) => {
          const rows = p.gaps.filter((g) => g.metricType === type).sort((a, b) => b.meanMin - a.meanMin);
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Matched lifecycle pairs" value={p.matchedPairs} />
                <Stat label="Ambiguous pairs (skipped)" value={p.ambiguousPairs} tone={p.ambiguousPairs ? 'bad' : 'default'} sub="No duration assigned" />
                <Stat label="Overlaps" value={p.overlaps} sub="Excluded from matched gaps" />
                <Stat label="Summaries" value={p.gaps.length} />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                <Card
                  title="Bottleneck table"
                  subtitle={METRIC_TYPE_COPY[type].help}
                  actions={
                    <div className="flex gap-1">
                      {(Object.keys(METRIC_TYPE_COPY) as GapSummary['metricType'][]).map((t) => (
                        <Button key={t} size="sm" variant={type === t ? 'primary' : 'secondary'} onClick={() => { setType(t); setSelected(null); }}>
                          {METRIC_TYPE_COPY[t].label}
                        </Button>
                      ))}
                    </div>
                  }
                >
                  {rows.length === 0 ? (
                    <EmptyState title={`No ${METRIC_TYPE_COPY[type].label.toLowerCase()} measurements`}>
                      {type === 'inter_event' ? 'No case has two or more discovery events.' : 'This log has no valid matched start/complete pairs for this metric (N/A, not zero).'}
                    </EmptyState>
                  ) : (
                    <Table className="max-h-[480px]">
                      <thead>
                        <tr>
                          <Th>{type === 'service' ? 'Activity' : 'Transition'}</Th>
                          <Th>Metric type</Th>
                          <Th align="right">Mean</Th>
                          <Th align="right">n</Th>
                          <Th align="right">Cases</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((g, i) => (
                          <tr key={i} onClick={() => setSelected(g)} className={cx('cursor-pointer hover:bg-slate-50', selected === g && 'bg-brand-50')}>
                            <Td>{g.to !== undefined ? `${g.from} → ${g.to}` : g.from}</Td>
                            <Td><MetricTypeBadge type={g.metricType} /></Td>
                            <Td align="right">{fmtMinutes(g.meanMin)}</Td>
                            <Td align="right">
                              {g.n} {g.n < 3 && <Badge tone="amber" title="Fewer than 3 observations">low support</Badge>}
                            </Td>
                            <Td align="right">{g.caseKeys.length}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
                <Card title="Contributing cases">
                  {selected ? (
                    <>
                      <div className="mb-2 text-sm font-medium">{selected.to !== undefined ? `${selected.from} → ${selected.to}` : selected.from}</div>
                      <CaseKeyList caseKeys={selected.caseKeys} />
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">Select a row to list its cases.</p>
                  )}
                </Card>
              </div>
            </>
          );
        }}
      </EngineGate>
      <Card title="Case elapsed time distribution" subtitle="First-to-last accepted event per case (calendar time, not working time). Bins are for display only.">
        <EngineGate result={durations}>{(d) => <DurationHistogram values={d.map((x) => x.elapsedMin)} />}</EngineGate>
      </Card>
    </div>
  );
}

function DurationHistogram({ values }: { values: number[] }) {
  const data = useMemo(() => {
    if (!values.length) return [];
    const max = Math.max(...values);
    const bins = Math.min(20, Math.max(1, values.length));
    const width = max > 0 ? max / bins : 1;
    const counts = Array.from({ length: bins }, (_, i) => ({ lo: i * width, hi: (i + 1) * width, count: 0 }));
    for (const v of values) counts[Math.min(bins - 1, Math.floor(v / width))]!.count += 1;
    return counts.map((c) => ({ ...c, label: fmtMinutes(c.hi) }));
  }, [values]);
  if (!values.length) return <EmptyState title="No cases" />;
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -16, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => [`${v} cases`, 'Count']} labelFormatter={(_, p) => (p?.[0] ? `${fmtMinutes(p[0].payload.lo)} – ${fmtMinutes(p[0].payload.hi)}` : '')} />
          <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------ Resources ------------------------------ */

const rNode = (r: string) => `r:${r}`;
const hEdge = (from: string, to: string) => `h:${JSON.stringify([from, to])}`;

/**
 * Graph spec from the engine's ResourceAnalysis. `focus` is a DISPLAY filter:
 * it only hides nodes/edges not touching the chosen resources. Counts are the
 * engine's values for the whole analysis scope and are never recomputed.
 */
export function handoffGraph(ra: ResourceAnalysis, focus?: ReadonlySet<string>) {
  const connected = new Set(ra.handoffs.flatMap((h) => [h.from, h.to]));
  const edgesShown = focus?.size ? ra.handoffs.filter((h) => focus.has(h.from) || focus.has(h.to)) : ra.handoffs;
  const visible = focus?.size ? new Set([...focus, ...edgesShown.flatMap((h) => [h.from, h.to])]) : null;
  const nodes: GraphNodeSpec[] = ra.resources
    .filter((r) => !visible || visible.has(r.resource))
    .map((r) => ({
      id: rNode(r.resource),
      label: resourceLabel(r.resource),
      kind: 'resource',
      primary: `${r.instances} inst.`,
      secondary: `${r.rawEvents} raw · ${r.distinctCases} cases`,
      isolated: !connected.has(r.resource),
    }));
  const edges: GraphEdgeSpec[] = edgesShown.map((h) => ({ id: hEdge(h.from, h.to), source: rNode(h.from), target: rNode(h.to), count: h.count }));
  return { nodes, edges };
}

function ResourceFilter({ all, focus, onChange }: { all: string[]; focus: Set<string>; onChange: (s: Set<string>) => void }) {
  const [q, setQ] = useState('');
  const shown = all.filter((r) => !q || resourceLabel(r).toLowerCase().includes(q.toLowerCase()));
  const toggle = (r: string) => {
    const next = new Set(focus);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    onChange(next);
  };
  return (
    <Card
      title="Resource display filter"
      subtitle="Shows only the chosen resources and their direct handoff partners in the graph and tables. Display only: coverage, KPIs, findings, other pages and exports still use every case in the analysis scope."
      actions={
        <>
          <Input placeholder="Search resource" className="!w-44 !py-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resource" />
          {focus.size > 0 && <Button size="sm" variant="ghost" onClick={() => onChange(new Set())}>Clear ({focus.size})</Button>}
        </>
      }
    >
      <div className="flex max-h-28 flex-wrap gap-1 overflow-auto" role="group" aria-label="Resource display filter">
        {shown.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={focus.has(r)}
            onClick={() => toggle(r)}
            className={cx('rounded border px-2 py-0.5 text-xs', focus.has(r) ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}
            title={r}
          >
            {resourceLabel(r)}
          </button>
        ))}
        {!shown.length && <span className="text-xs text-slate-400">No resource matches.</span>}
      </div>
    </Card>
  );
}

function Resources() {
  const { resources } = useAnalysis();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [focus, setFocus] = useState<Set<string>>(() => new Set());
  const onSelect = useCallback((s: GraphSelection) => setSelection(s), []);
  const graph = useMemo(() => (resources?.status === 'ok' ? handoffGraph(resources.data, focus) : null), [resources, focus]);

  return (
    <EngineGate result={resources}>
      {(ra) => {
        if (!ra.resources.length) {
          return <EmptyState title="No known resources">No event in scope has a resource value (placeholders count as missing). Workload and handoffs are N/A.</EmptyState>;
        }
        const inFocus = (r: string) => !focus.size || focus.has(r);
        const handoffsShown = focus.size ? ra.handoffs.filter((h) => focus.has(h.from) || focus.has(h.to)) : ra.handoffs;
        const resourcesShown = ra.resources.filter((r) => inFocus(r.resource));
        const selResource = selection?.type === 'node' ? ra.resources.find((r) => rNode(r.resource) === selection.id) : undefined;
        const selHandoff = selection?.type === 'edge' ? ra.handoffs.find((h) => hEdge(h.from, h.to) === selection.id) : undefined;
        const chart = [...resourcesShown].sort((a, b) => b.instances - a.instances).slice(0, 15).map((r) => ({ ...r, label: resourceLabel(r.resource) }));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Known resources (scope)" value={ra.resources.length} />
              <Stat label="Raw-event coverage" value={fmtPct(ra.knownRawEvents, ra.totalRawEvents)} sub={`${ra.knownRawEvents} of ${ra.totalRawEvents} rows with a known resource`} />
              <Stat label="Instance coverage" value={fmtPct(ra.knownInstances, ra.totalInstances)} sub={`${ra.knownInstances} of ${ra.totalInstances} discovery instances`} />
              <Stat label="Directed handoff pairs (scope)" value={ra.handoffs.length} sub={`${ra.handoffs.reduce((s, h) => s + h.count, 0)} handoffs total`} />
            </div>

            <ResourceFilter all={ra.resources.map((r) => r.resource)} focus={focus} onChange={(f) => { setFocus(f); setSelection(null); }} />

            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <Card
                title="Resource handoff network"
                subtitle="Directed edges count adjacent discovery events within one case handled by two different known resources. WTN-inspired; not KGU WTN and not observed communication."
                actions={focus.size > 0 ? <Badge tone="blue">display filter: {focus.size} selected</Badge> : undefined}
                bodyClassName="p-3"
              >
                {ra.handoffs.length === 0 && (
                  <div className="mb-3">
                    <Notice tone="info" title="No eligible handoffs in this scope">
                      Adjacent events either share the same resource or have a missing endpoint, so no edge is drawn. Known resources are still shown as isolated nodes.
                    </Notice>
                  </div>
                )}
                <FlowGraph nodes={graph!.nodes} edges={graph!.edges} selection={selection} onSelect={onSelect} height={440} />
                <div className="mt-2"><GraphLegend pairs /></div>
              </Card>
              <Card title="Inspector">
                {selResource ? (
                  <>
                    <div className="text-base font-semibold" title={selResource.resource}>{resourceLabel(selResource.resource)}</div>
                    <KeyValue
                      items={[
                        ['Roles', selResource.roles.length ? selResource.roles.join(', ') : '—'],
                        ['Raw events', selResource.rawEvents],
                        ['Completed instances', selResource.instances],
                        ['Distinct cases', selResource.distinctCases],
                        ['Active time', selResource.activeMin === null ? 'N/A' : fmtMinutes(selResource.activeMin)],
                        ['Utilization', 'Per-resource value not provided (see resource_utilization KPI)'],
                        ['Outgoing handoffs', ra.handoffs.filter((h) => h.from === selResource.resource).reduce((s, h) => s + h.count, 0)],
                        ['Incoming handoffs', ra.handoffs.filter((h) => h.to === selResource.resource).reduce((s, h) => s + h.count, 0)],
                      ]}
                    />
                    <div className="mt-3"><CaseKeyList caseKeys={selResource.caseKeys} /></div>
                  </>
                ) : selHandoff ? (
                  <>
                    <div className="text-base font-semibold">{resourceLabel(selHandoff.from)} → {resourceLabel(selHandoff.to)}</div>
                    <KeyValue
                      items={[
                        ['Handoffs', selHandoff.count],
                        ['Reverse direction', ra.handoffs.find((h) => h.from === selHandoff.to && h.to === selHandoff.from)?.count ?? 0],
                      ]}
                    />
                    <div className="mt-3"><CaseKeyList caseKeys={selHandoff.caseKeys} /></div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Select a resource node or a handoff edge. The tables below use the same engine result.</p>
                )}
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Handoff table" subtitle="Same data as the network. Each direction is counted separately.">
                {handoffsShown.length === 0 ? (
                  <EmptyState title={ra.handoffs.length ? 'No handoffs touch the selected resources' : 'No handoffs'} />
                ) : (
                  <Table className="max-h-96">
                    <thead><tr><Th>From</Th><Th>To</Th><Th align="right">Count</Th><Th align="right">Cases</Th></tr></thead>
                    <tbody>
                      {[...handoffsShown].sort((a, b) => b.count - a.count).map((h) => {
                        const id = hEdge(h.from, h.to);
                        return (
                          <tr key={id} onClick={() => setSelection({ type: 'edge', id })} className={cx('cursor-pointer hover:bg-slate-50', selection?.id === id && 'bg-brand-50')}>
                            <Td>{resourceLabel(h.from)}</Td><Td>{resourceLabel(h.to)}</Td><Td align="right">{h.count}</Td><Td align="right">{h.caseKeys.length}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card>
              <Card title="Workload by resource" subtitle="Completed instances (start+complete counted once). Utilization needs validated shifts.">
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="instances" name="Instances" fill="#0ea5e9" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card title="Workload table" subtitle={focus.size ? `Showing ${resourcesShown.length} of ${ra.resources.length} resources (display filter)` : undefined}>
              <Table className="max-h-96">
                <thead>
                  <tr>
                    <Th>Resource</Th><Th>Roles</Th><Th align="right">Raw events</Th><Th align="right">Instances</Th>
                    <Th align="right">Cases</Th><Th align="right">Active time</Th><Th>Activity mix</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...resourcesShown].sort((a, b) => b.instances - a.instances).map((r) => {
                    const id = rNode(r.resource);
                    return (
                      <tr key={r.resource} onClick={() => setSelection({ type: 'node', id })} className={cx('cursor-pointer hover:bg-slate-50', selection?.id === id && 'bg-brand-50')}>
                        <Td className="font-medium" >{resourceLabel(r.resource)}</Td>
                        <Td className="text-xs">{r.roles.join(', ') || '—'}</Td>
                        <Td align="right">{r.rawEvents}</Td>
                        <Td align="right">{r.instances}</Td>
                        <Td align="right">{r.distinctCases}</Td>
                        <Td align="right">{r.activeMin === null ? 'N/A' : fmtMinutes(r.activeMin)}</Td>
                        <Td className="text-xs text-slate-600">
                          {Object.entries(r.activityCounts).sort((a, b) => b[1] - a[1]).map(([a, c]) => `${a} (${c})`).join(', ')}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          </div>
        );
      }}
    </EngineGate>
  );
}

/* ------------------------------ Findings ------------------------------ */

/** `simulation` is offered only when the Festival gate scenario applies (Festival adapters + audience). */
export function designFromFinding(f: Finding, simulationAvailable: boolean): DesignRecord {
  const now = Date.now();
  return {
    id: uid('design'),
    title: f.proposal.length > 90 ? `${f.proposal.slice(0, 87)}…` : f.proposal,
    findingIds: [f.id],
    findingText: [f.text],
    changeNote: '',
    affectedActivities: f.edge ? [...new Set([f.edge.from, f.edge.to])] : [],
    targetMetricId: f.metricId,
    asIsBpmnRef: null,
    toBeBpmnRef: null,
    kind: simulationAvailable ? 'simulation' : 'proposal_only',
    status: 'draft',
    scope: f.scope,
    createdAt: now,
    updatedAt: now,
  };
}

function Findings({ navigate }: { navigate: (p: PageId) => void }) {
  const { findings, scope } = useAnalysis();
  const { dispatch, state } = useStore();
  const ws = useWorkspace();
  return (
    <EngineGate result={findings}>
      {(fs) =>
        fs.length === 0 ? (
          <EmptyState title="No findings">The engine's deterministic evidence rules found nothing to report for this scope.</EmptyState>
        ) : (
          <div className="space-y-3">
            <Notice tone="info">
              Findings come from deterministic evidence rules in the engine. They point to where to investigate; they are not confirmed root causes or guaranteed benefits.
            </Notice>
            {fs.map((f) => {
              const linked = ws?.designs.filter((d) => d.findingIds.includes(f.id)) ?? [];
              return (
                <Card key={f.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-xs text-slate-400">{f.id}</code>
                        <Badge tone="brand">{f.metricId}</Badge>
                        {f.support === 'low' && <Badge tone="amber">low support (n &lt; 3)</Badge>}
                        {f.edge && <Badge>{f.edge.from} → {f.edge.to}</Badge>}
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">{f.text}</p>
                      <p className="mt-1 text-sm text-slate-600"><span className="font-medium text-slate-500">Suggested investigation:</span> {f.proposal}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-500 tabular">
                        <span>Value <b className="text-slate-700">{fmtValue(f.value, f.unit)}</b></span>
                        <span>n = {f.n}{f.eligible !== undefined && ` of ${f.eligible} eligible`}</span>
                        <span>{plural(f.caseKeys.length, 'case')}: {f.caseKeys.slice(0, 5).map(caseLabel).join(', ')}{f.caseKeys.length > 5 ? '…' : ''}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!scope}
                        onClick={() => {
                          dispatch({ type: 'UPSERT_DESIGN', design: designFromFinding(f, gateScenarioAvailable(state.dataset?.festival, scope!.processKey)) });
                          dispatch({ type: 'TOAST', tone: 'success', message: 'Design record created from finding.' });
                          navigate('design');
                        }}
                      >
                        Create design record →
                      </Button>
                      {linked.length > 0 && <span className="text-xs text-slate-500">{plural(linked.length, 'linked design')}</span>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      }
    </EngineGate>
  );
}
