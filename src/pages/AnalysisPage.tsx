/**
 * Analysis — Process Explorer. One graph-first workspace with seven modes and a
 * right-hand Inspector that always shows the cases behind a selected number.
 * All values come from engine DTOs via useAnalysis(); this page only selects,
 * highlights and formats them.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DFG, Finding, GapSummary, ResourceAnalysis, Variant } from '../contracts';
import type { ReplayFrame } from '../v03-contracts';
import { useAnalysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import { gateScenarioAvailable } from '../festival/adapter';
import type { AnalysisMode, PageId } from '../state/types';
import { fmtMinutes, fmtNumber, fmtPct, fmtShare, plural, resourceLabel } from '../lib/format';
import { FlowGraph, type GraphSelection } from '../components/graph/FlowGraph';
import { RequireData } from '../components/layout';
import { Icon, type IconName } from '../components/icons';
import { Badge, Button, EngineGate, InfoTip, Meter, Metric, Notice, SectionLabel, Segmented, Unavailable, cx } from '../components/ui';
import {
  END,
  START,
  dfgGraph,
  edgeId,
  edgesHighlight,
  endEdgeId,
  fmtGap,
  gapFor,
  handoffGraph,
  hEdge,
  heatColor,
  nodeId,
  parseEdgeId,
  pathHighlight,
  rNode,
  serviceFor,
  startEdgeId,
  type GapType,
  type Highlight,
} from './analysis/graphs';
import { CaseList, CaseTimeline, FindingCard, designFromFinding, findingRule } from './analysis/inspector';
import { PatternsPanel, ReplayBar, ReworkPanel, VariantList } from './analysis/modes';

const MODES: { id: AnalysisMode; label: string; icon: IconName; help: string }[] = [
  { id: 'frequency', label: 'Frequency', icon: 'graph', help: 'Boxes are activities, arrows are what directly followed what in the same case. Numbers count how often.' },
  { id: 'performance', label: 'Performance', icon: 'clock', help: 'Arrows are coloured by the average time between steps. Red = slower. Each value shows how many observations it is based on.' },
  { id: 'variants', label: 'Variants', icon: 'route', help: 'A variant is one exact path through the process. Pick one to see it on the map and the cases that followed it.' },
  { id: 'rework', label: 'Rework', icon: 'repeat', help: 'Where the same activity happens more than once in a case. Repetition is not automatically an error.' },
  { id: 'handover', label: 'Hand-overs', icon: 'users', help: 'Who passes work to whom: an arrow means one resource’s step was directly followed by another resource’s step in the same case (WTN-inspired).' },
  { id: 'patterns', label: 'Patterns', icon: 'branch', help: 'Observed sequences, alternative next steps, loops and overlapping activities (ICN-inspired). Candidates only — not proven gateways.' },
  { id: 'replay', label: 'Replay', icon: 'play', help: 'Play the log over time: each case sits on its latest recorded activity. Only recorded states are shown; no waiting is invented.' },
];

type InspectorView =
  | { kind: 'none' }
  | { kind: 'case'; caseKey: string; back: InspectorView }
  | { kind: 'finding'; id: string };

export function AnalysisPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <RequireData navigate={navigate}>
      <Explorer navigate={navigate} />
    </RequireData>
  );
}

function Explorer({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const ws = useWorkspace();
  const a = useAnalysis();
  const { dfg, performance, resources, variants, findings, kpis, scope, traceByKey, activityEvidence } = a;
  const mode: AnalysisMode = state.view.analysisMode ?? 'frequency';
  const setMode = useCallback((m: AnalysisMode) => dispatch({ type: 'SET_VIEW', view: { analysisMode: m } }), [dispatch]);

  const [selection, setSelection] = useState<GraphSelection>(null);
  const [inspector, setInspector] = useState<InspectorView>({ kind: 'none' });
  const [minDfg, setMinDfg] = useState(1);
  const [minWtn, setMinWtn] = useState(1);
  const [perfMetric, setPerfMetric] = useState<GapType>('inter_event');
  const [variantId, setVariantId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Set<string>>(() => new Set());
  const [patternHl, setPatternHl] = useState<Highlight | null>(null);
  const [replayFrame, setReplayFrame] = useState<ReplayFrame | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [rankdir, setRankdir] = useState<'TB' | 'LR'>('TB');

  // Reset transient selection when the analysis scope changes.
  useEffect(() => {
    setSelection(null);
    setInspector({ kind: 'none' });
    setVariantId(null);
    setFocus(new Set());
    setPatternHl(null);
  }, [scope?.datasetId, scope?.processKey, scope?.analysisFilterFingerprint]);

  const changeMode = (m: AnalysisMode) => {
    setMode(m);
    setSelection(null);
    setPatternHl(null);
    if (inspector.kind === 'case') setInspector({ kind: 'none' });
  };

  // Cross-page focus request (e.g. Monitor → "show on map").
  const focusReq = state.view.analysisFocus;
  useEffect(() => {
    if (!focusReq) return;
    setMode(focusReq.mode);
    if (focusReq.edge) setSelection({ type: 'edge', id: edgeId(focusReq.edge.from, focusReq.edge.to) });
    else if (focusReq.activity) setSelection({ type: 'node', id: nodeId(focusReq.activity) });
    if (focusReq.findingId) setInspector({ kind: 'finding', id: focusReq.findingId });
    dispatch({ type: 'SET_VIEW', view: { analysisFocus: null } });
  }, [focusReq, dispatch, setMode]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const dfgData = dfg?.status === 'ok' ? dfg.data : null;
  const perf = performance?.status === 'ok' ? performance.data : null;
  const ra = resources?.status === 'ok' ? resources.data : null;
  const vs = variants?.status === 'ok' ? variants.data : null;
  const fs = useMemo(() => (findings?.status === 'ok' ? findings.data : []), [findings]);
  const ae = activityEvidence?.status === 'ok' ? activityEvidence.data : null;
  const selectedVariant = vs?.find((v) => v.id === variantId) ?? null;
  const caseKey = inspector.kind === 'case' ? inspector.caseKey : null;
  const activeFinding = inspector.kind === 'finding' ? fs.find((f) => f.id === inspector.id) ?? null : null;

  /* ---------- highlight (case path > variant > finding > pattern) ---------- */
  const highlight = useMemo<Highlight | null>(() => {
    if (caseKey) {
      const t = traceByKey.get(caseKey);
      if (!t) return null;
      if (mode === 'handover') {
        const nodes = new Set<string>();
        const edges = new Set<string>();
        let prev: string | null = null;
        for (const e of t.sequence) {
          if (!e.resource) {
            prev = null;
            continue;
          }
          nodes.add(rNode(e.resource));
          if (prev && prev !== e.resource) edges.add(hEdge(prev, e.resource));
          prev = e.resource;
        }
        return { nodes, edges };
      }
      return pathHighlight(t.sequence.map((e) => e.activity));
    }
    if (mode === 'variants' && selectedVariant) return pathHighlight(selectedVariant.activities);
    if (activeFinding?.edge && mode !== 'handover') return edgesHighlight([activeFinding.edge]);
    if (mode === 'patterns' && patternHl) return patternHl;
    if (mode === 'rework' && dfgData) {
      const loops = dfgData.edges.filter((e) => e.from === e.to);
      const repeated = ae ? ae.activities.filter((x) => x.extraOccurrenceCount > 0).map((x) => x.activity) : [];
      if (loops.length || repeated.length) return edgesHighlight(loops, repeated);
    }
    return null;
  }, [caseKey, traceByKey, mode, selectedVariant, activeFinding, patternHl, dfgData, ae]);

  /* ---------- graph spec ---------- */
  const perfScale = useMemo(() => {
    if (!perf || !dfgData) return null;
    const vals = dfgData.edges
      .filter((e) => e.count >= minDfg)
      .map((e) => gapFor(perf.gaps, perfMetric, e.from, e.to)?.meanMin)
      .filter((v): v is number => v !== undefined);
    if (!vals.length) return { min: 0, max: 0, any: false };
    return { min: Math.min(...vals), max: Math.max(...vals), any: true };
  }, [perf, dfgData, perfMetric, minDfg]);

  const replayBadges = useMemo(() => {
    if (mode !== 'replay' || !replayFrame) return null;
    const by = new Map<string, { latest: number; active: number; done: number }>();
    for (const c of replayFrame.cases) {
      const act = c.active[0]?.activity ?? c.latest.activity;
      const r = by.get(act) ?? { latest: 0, active: 0, done: 0 };
      if (c.state === 'active') r.active += 1;
      else if (c.state === 'completed') r.done += 1;
      else r.latest += 1;
      by.set(act, r);
    }
    return by;
  }, [mode, replayFrame]);

  const graph = useMemo(() => {
    if (mode === 'handover') return ra ? handoffGraph(ra, focus, minWtn, highlight) : null;
    if (!dfgData) return null;
    const gaps = perf?.gaps ?? null;
    const aeBy = ae ? new Map(ae.activities.map((x) => [x.activity, x])) : null;
    return dfgGraph(dfgData, {
      minCount: minDfg,
      highlight,
      edgeLabel:
        mode === 'performance'
          ? (e) => {
              const g = gapFor(gaps, perfMetric, e.from, e.to);
              return g ? fmtMinutes(g.meanMin) : 'no data';
            }
          : undefined,
      edgeColor:
        mode === 'performance' && perfScale?.any
          ? (e) => {
              const g = gapFor(gaps, perfMetric, e.from, e.to);
              if (!g) return undefined;
              const span = perfScale.max - perfScale.min;
              return heatColor(span > 0 ? (g.meanMin - perfScale.min) / span : 0.5);
            }
          : undefined,
      edgeNoData: mode === 'performance' ? (e) => !gapFor(gaps, perfMetric, e.from, e.to) : undefined,
      nodeText: (n) => {
        if (mode === 'performance') {
          const s = serviceFor(gaps, n.activity);
          return { primary: n.count.toLocaleString('en-US'), secondary: s ? `service ${fmtMinutes(s.meanMin)} · n=${s.n}` : 'no service time' };
        }
        if (mode === 'rework' && aeBy) {
          const x = aeBy.get(n.activity);
          if (x && x.extraOccurrenceCount > 0) {
            return { badge: `+${x.extraOccurrenceCount}`, badgeTone: 'amber', accent: '#f59e0b', secondary: `${plural(x.repeatedCaseKeys.length, 'case')} repeat` };
          }
        }
        if (mode === 'replay' && replayBadges) {
          const r = replayBadges.get(n.activity);
          const total = r ? r.latest + r.active + r.done : 0;
          return total
            ? { badge: String(total), badgeTone: r!.active ? 'brand' : r!.done === total ? 'green' : 'slate', secondary: [r!.active && `${r!.active} active`, r!.latest && `${r!.latest} here`, r!.done && `${r!.done} done`].filter(Boolean).join(' · ') }
            : { secondary: 'no cases here now' };
        }
        return {};
      },
    });
  }, [mode, ra, focus, minWtn, highlight, dfgData, perf, ae, minDfg, perfMetric, perfScale, replayBadges]);

  const onSelect = useCallback((s: GraphSelection) => {
    setSelection(s);
    setInspector((cur) => (cur.kind === 'case' ? { kind: 'none' } : cur.kind === 'finding' ? { kind: 'none' } : cur));
  }, []);

  const pickCase = (k: string) => setInspector((cur) => ({ kind: 'case', caseKey: k, back: cur.kind === 'case' ? cur.back : cur }));

  /* ---------- findings → design / show on map ---------- */
  const metrics = kpis?.status === 'ok' ? kpis.data : [];
  const createDesign = (f: Finding) => {
    if (!scope) return;
    dispatch({ type: 'UPSERT_DESIGN', design: designFromFinding(f, metrics, gateScenarioAvailable(state.dataset?.festival, scope.processKey)) });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Design started from this finding.' });
    navigate('design');
  };
  const showFinding = (f: Finding) => {
    const rule = findingRule(f);
    if (f.edge) {
      changeMode('performance');
      if (f.metricId === 'matched_gap') setPerfMetric('matched_gap');
      else if (f.metricId === 'inter_event') setPerfMetric('inter_event');
      setSelection({ type: 'edge', id: edgeId(f.edge.from, f.edge.to) });
    } else if (rule === 'rework') changeMode('rework');
    else if (rule === 'workload') changeMode('handover');
    setInspector({ kind: 'finding', id: f.id });
  };

  const modeMeta = MODES.find((m) => m.id === mode)!;
  const minMax = mode === 'handover' ? Math.max(1, ...(ra?.handoffs.map((h) => h.count) ?? [1])) : Math.max(1, ...(dfgData?.edges.map((e) => e.count) ?? [1]));

  /* ---------- inspector ---------- */
  let inspectorBody: ReactNode;
  if (inspector.kind === 'case') {
    inspectorBody = <CaseTimeline caseKey={inspector.caseKey} onBack={() => setInspector(inspector.back)} backLabel="Back" />;
  } else if (activeFinding) {
    inspectorBody = (
      <div className="space-y-3">
        <button type="button" onClick={() => setInspector({ kind: 'none' })} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          <Icon name="arrowLeft" className="h-3.5 w-3.5" /> All findings
        </button>
        <FindingCard f={activeFinding} active onDesign={() => createDesign(activeFinding)} linkedDesigns={ws?.designs.filter((d) => d.findingIds.includes(activeFinding.id)).length ?? 0} />
        <CaseList caseKeys={activeFinding.caseKeys} onPick={pickCase} label={activeFinding.evidenceKind === 'metric_contributors' ? 'Cases contributing to the metric' : 'Evidence cases'} />
      </div>
    );
  } else if (mode === 'handover' && ra) {
    inspectorBody = <HandoverInspector ra={ra} selection={selection} onSelect={setSelection} onPick={pickCase} />;
  } else if (mode === 'variants' && vs && selectedVariant) {
    inspectorBody = <VariantInspector v={selectedVariant} onPick={pickCase} />;
  } else if (mode === 'rework' && !selection) {
    inspectorBody = <ReworkPanel dfg={dfgData} onPick={pickCase} onSelectActivity={(act) => setSelection({ type: 'node', id: nodeId(act) })} />;
  } else if (mode === 'patterns' && !selection) {
    inspectorBody = <PatternsPanel onHighlight={setPatternHl} onPick={pickCase} />;
  } else if (selection && dfgData) {
    inspectorBody = (
      <DfgInspector
        dfg={dfgData}
        selection={selection}
        gaps={perf?.gaps ?? null}
        coverage={perf?.transitionCoverage}
        onSelect={setSelection}
        onPick={pickCase}
        repeat={ae?.activities}
      />
    );
  } else if (mode === 'replay' && replayFrame) {
    inspectorBody = <ReplayInspector frame={replayFrame} onPick={pickCase} />;
  } else {
    inspectorBody = (
      <DefaultInspector
        mode={mode}
        findings={fs}
        onShow={showFinding}
        onDesign={createDesign}
        linked={(id) => ws?.designs.filter((d) => d.findingIds.includes(id)).length ?? 0}
        dfg={dfgData}
        ra={ra}
      />
    );
  }

  /* ---------- toolbar ---------- */
  const stats = graph?.stats;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-3 py-2">
      {(mode === 'frequency' || mode === 'performance' || mode === 'handover' || mode === 'rework') && (
        <label className="flex items-center gap-2 text-xs text-slate-600" title="Display filter only. Calculations, findings and exports always use every transition.">
          <Icon name="filter" className="h-3.5 w-3.5 text-slate-400" />
          Hide arrows seen fewer than
          <input
            type="range"
            min={1}
            max={minMax}
            value={mode === 'handover' ? minWtn : minDfg}
            onChange={(e) => (mode === 'handover' ? setMinWtn : setMinDfg)(Number(e.target.value))}
            className="w-28 accent-brand-600"
            aria-label="Minimum arrow count"
          />
          <b className="w-6 tabular text-slate-800">{mode === 'handover' ? minWtn : minDfg}×</b>
        </label>
      )}
      {mode === 'performance' && (
        <Segmented<GapType>
          size="sm"
          ariaLabel="Time measure"
          value={perfMetric}
          onChange={setPerfMetric}
          options={[
            { id: 'inter_event', label: 'Time between steps', title: 'Inter-event gap: time between consecutive recorded steps (not necessarily waiting).' },
            { id: 'matched_gap', label: 'Wait before next start', title: 'Matched gap: from a completion to the next activity’s recorded start. Needs start/complete events.' },
          ]}
        />
      )}
      {mode === 'handover' && ra && <ResourceFocus all={ra.resources.map((r) => r.resource)} focus={focus} onChange={(f) => { setFocus(f); setSelection(null); }} />}
      {stats && (mode === 'frequency' || mode === 'performance' || mode === 'handover' || mode === 'rework') && (
        <span className="text-xs text-slate-500 tabular">
          Showing <b className="text-slate-700">{stats.shownEdges}</b> of {plural(stats.totalEdges, mode === 'handover' ? 'hand-over pair' : 'transition')}
          {stats.shownEdges < stats.totalEdges && <Badge tone="brand" className="ml-1.5">display filter · results unchanged</Badge>}
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {mode === 'performance' && perfScale?.any && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 tabular">
            {fmtMinutes(perfScale.min)}
            <span className="h-2 w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
            {fmtMinutes(perfScale.max)}
          </span>
        )}
        <span className="hidden items-center gap-1 text-[11px] text-slate-500 2xl:flex">
          <span className="inline-block h-[3px] w-5 rounded bg-slate-500" /> width = frequency
        </span>
        <Segmented<'TB' | 'LR'>
          size="sm"
          ariaLabel="Layout direction"
          value={rankdir}
          onChange={setRankdir}
          options={[{ id: 'TB', label: '↓', title: 'Top to bottom' }, { id: 'LR', label: '→', title: 'Left to right' }]}
        />
        <Button size="sm" variant="ghost" icon={fullscreen ? 'minimize' : 'maximize'} onClick={() => setFullscreen((v) => !v)} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? 'Exit' : ''}
        </Button>
      </div>
    </div>
  );

  const canvas = (() => {
    const result = mode === 'handover' ? resources : dfg;
    if (!result || result.status !== 'ok') return <div className="p-4"><EngineGate result={result}>{() => null}</EngineGate></div>;
    if (mode === 'handover' && ra && !ra.resources.length) {
      return (
        <CanvasEmpty title="No resource information in this log" icon="users">
          Hand-over analysis needs a resource column (who performed each step). Map a resource column in Overview & Data, or use a log that records performers.
        </CanvasEmpty>
      );
    }
    if (mode !== 'handover' && dfgData && !dfgData.nodes.length) {
      return <CanvasEmpty title="No recorded steps to draw" icon="graph">The selected cases have no complete or point events.</CanvasEmpty>;
    }
    if (mode === 'performance' && perfScale && !perfScale.any) {
      return (
        <>
          <Notice tone="info" className="m-3 mb-0">
            {perfMetric === 'matched_gap'
              ? 'No “wait before next start” values: this measure needs start and complete events. Switch to “Time between steps”.'
              : 'No transition has two consecutive recorded steps in this scope.'}
          </Notice>
          {graph && <FlowGraph nodes={graph.nodes} edges={graph.edges} selection={selection} onSelect={onSelect} height="100%" rankdir={rankdir} fitKey={`${fullscreen}`} />}
        </>
      );
    }
    return graph ? <FlowGraph nodes={graph.nodes} edges={graph.edges} selection={selection} onSelect={onSelect} height="100%" rankdir={rankdir} fitKey={`${fullscreen}`} /> : null;
  })();

  return (
    <div className="flex min-h-[calc(100vh-76px)] flex-col gap-3 xl:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-600">1 · Analysis</div>
          <h1 className="text-lg font-semibold leading-tight text-slate-900">Process Explorer</h1>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Analysis mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => changeMode(m.id)}
              className={cx(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition',
                mode === m.id ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon name={m.icon} className="h-4 w-4" />
              {m.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('design')}>
            Design an improvement
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section
          className={cx(
            'flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white',
            fullscreen && 'fixed inset-0 z-[55] m-0 rounded-none border-0',
          )}
          aria-label="Process graph"
        >
          {toolbar}
          <div className="flex min-h-0 flex-1">
            {mode === 'variants' && vs && (
              <VariantList variants={vs} selected={variantId} onSelect={(id) => { setVariantId(id); setInspector({ kind: 'none' }); setSelection(null); }} />
            )}
            <div className="relative min-h-[440px] min-w-0 flex-1 bg-slate-50/40">
              {canvas}
              <div className="pointer-events-none absolute bottom-6 right-3 max-w-xs rounded-lg bg-white/90 px-2.5 py-1.5 text-[11.5px] leading-snug text-slate-600 shadow-sm ring-1 ring-slate-200">
                <b className="font-semibold text-slate-800">{modeMeta.label}.</b> {modeMeta.help}
              </div>
            </div>
          </div>
          {mode === 'replay' && <ReplayBar variants={vs ?? []} onFrame={setReplayFrame} />}
        </section>

        <aside className="pp-scroll min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-4" aria-label="Inspector">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Inspector</div>
            {(selection || inspector.kind !== 'none') && (
              <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => { setSelection(null); setInspector({ kind: 'none' }); }}>
                Clear
              </button>
            )}
          </div>
          {inspectorBody}
        </aside>
      </div>
    </div>
  );
}

function CanvasEmpty({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name={icon} className="h-5 w-5" /></div>
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------ Default inspector ------------------------------ */

function DefaultInspector({
  mode,
  findings,
  onShow,
  onDesign,
  linked,
  dfg,
  ra,
}: {
  mode: AnalysisMode;
  findings: Finding[];
  onShow: (f: Finding) => void;
  onDesign: (f: Finding) => void;
  linked: (id: string) => number;
  dfg: DFG | null;
  ra: ResourceAnalysis | null;
}) {
  const { findings: fr } = useAnalysis();
  return (
    <div className="space-y-4">
      {dfg && mode !== 'handover' && (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Activities" value={dfg.nodes.length} />
          <Metric label="Transitions" value={dfg.edges.length} />
          <Metric label="Self-loops" value={dfg.edges.filter((e) => e.from === e.to).length} />
        </div>
      )}
      {ra && mode === 'handover' && (
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Resources" value={ra.resources.length} />
          <Metric label="Hand-overs" value={ra.handoffs.reduce((s, h) => s + h.count, 0)} sub={plural(ra.handoffs.length, 'direction pair')} />
          <Metric label="Steps with a resource" value={fmtPct(ra.knownInstances, ra.totalInstances)} sub={`${ra.knownInstances} of ${ra.totalInstances}`} />
          <Metric label="Rows with a resource" value={fmtPct(ra.knownRawEvents, ra.totalRawEvents)} sub={`${ra.knownRawEvents} of ${ra.totalRawEvents}`} />
        </div>
      )}
      <p className="text-[12.5px] leading-relaxed text-slate-500">
        Click any box, arrow or number on the map to see its measures and the actual cases behind it.
      </p>
      <div>
        <SectionLabel right={<InfoTip>Findings come from deterministic rules in the engine. They point to where to look; they are not proven causes or guaranteed savings.</InfoTip>}>
          Findings ({findings.length})
        </SectionLabel>
        <EngineGate result={fr}>
          {() =>
            findings.length ? (
              <div className="space-y-2">
                {findings.map((f) => (
                  <FindingCard key={f.id} f={f} active={false} onShow={() => onShow(f)} onDesign={() => onDesign(f)} linkedDesigns={linked(f.id)} />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-slate-500">No rule flagged anything in this scope.</p>
            )
          }
        </EngineGate>
      </div>
    </div>
  );
}

/* ------------------------------ DFG inspector ------------------------------ */

function DfgInspector({
  dfg,
  selection,
  gaps,
  coverage,
  onSelect,
  onPick,
  repeat,
}: {
  dfg: DFG;
  selection: NonNullable<GraphSelection>;
  gaps: GapSummary[] | null;
  coverage?: { from: string; to: string; transitionCount: number; matchedGapCount: number; overlapCount: number }[];
  onSelect: (s: GraphSelection) => void;
  onPick: (k: string) => void;
  repeat?: { activity: string; extraOccurrenceCount: number; repeatedCaseKeys: string[]; occurrenceCount: number }[];
}) {
  const { id } = selection;
  if (id === START || id === END) {
    const rec = id === START ? dfg.starts : dfg.ends;
    const cases = id === START ? dfg.startCases : dfg.endCases;
    return (
      <div className="space-y-3">
        <Title kicker={id === START ? 'Where cases begin' : 'Where cases end'} title={id === START ? 'Start' : 'End'} />
        <ul className="space-y-1">
          {Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([act, c]) => (
            <li key={act}>
              <button type="button" className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] hover:bg-slate-50" onClick={() => onSelect({ type: 'edge', id: id === START ? startEdgeId(act) : endEdgeId(act) })}>
                <span>{act}</span>
                <span className="tabular text-slate-500">{plural(c, 'case')}</span>
              </button>
            </li>
          ))}
        </ul>
        {!cases && <p className="text-xs text-slate-500">Case lists for start/end are not provided by this engine build.</p>}
      </div>
    );
  }
  if (id.startsWith('s:') || id.startsWith('t:')) {
    const activity = id.slice(2);
    const isStart = id.startsWith('s:');
    const count = (isStart ? dfg.starts : dfg.ends)[activity] ?? 0;
    const cases = (isStart ? dfg.startCases : dfg.endCases)?.[activity];
    return (
      <div className="space-y-3">
        <Title kicker={isStart ? 'Cases start with' : 'Cases end with'} title={activity} />
        <Metric label="Cases" value={count} />
        {cases ? <CaseList caseKeys={cases} onPick={onPick} /> : <p className="text-xs text-slate-500">Case list for start/end is not available in this engine build. Select the activity box to see all of its cases.</p>}
      </div>
    );
  }
  if (id.startsWith('a:')) {
    const activity = id.slice(2);
    const node = dfg.nodes.find((n) => n.activity === activity);
    if (!node) return null;
    const service = serviceFor(gaps, activity);
    const rep = repeat?.find((r) => r.activity === activity);
    const out = dfg.edges.filter((e) => e.from === activity).sort((x, y) => y.count - x.count);
    const inc = dfg.edges.filter((e) => e.to === activity).sort((x, y) => y.count - x.count);
    return (
      <div className="space-y-4">
        <Title kicker="Activity" title={activity} />
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Times recorded" value={node.count} />
          <Metric label="Cases" value={node.caseKeys.length} />
          <Metric label="Starts here" value={dfg.starts[activity] ?? 0} />
          <Metric label="Ends here" value={dfg.ends[activity] ?? 0} />
          <Metric
            label="Average service time"
            value={service ? fmtMinutes(service.meanMin) : 'N/A'}
            sub={service ? `n = ${service.n} matched start/complete` : 'needs start + complete events'}
          />
          {rep ? <Metric label="Extra repeats" value={rep.extraOccurrenceCount} sub={plural(rep.repeatedCaseKeys.length, 'case')} /> : <div />}
        </div>
        <EdgeList title="Next steps" edges={out} dir="to" onSelect={(f, t) => onSelect({ type: 'edge', id: edgeId(f, t) })} />
        <EdgeList title="Previous steps" edges={inc} dir="from" onSelect={(f, t) => onSelect({ type: 'edge', id: edgeId(f, t) })} />
        <CaseList caseKeys={node.caseKeys} onPick={onPick} />
      </div>
    );
  }
  const pair = parseEdgeId(id);
  if (!pair) return null;
  const [from, to] = pair;
  const edge = dfg.edges.find((e) => e.from === from && e.to === to);
  if (!edge) return null;
  const ie = gapFor(gaps, 'inter_event', from, to);
  const mg = gapFor(gaps, 'matched_gap', from, to);
  const cov = coverage?.find((c) => c.from === from && c.to === to);
  return (
    <div className="space-y-4">
      <Title kicker={from === to ? 'Repeat (self-loop)' : 'Transition'} title={`${from} → ${to}`} />
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <Metric label="Times observed" value={edge.count} />
        <Metric label="Cases" value={edge.caseKeys.length} />
      </div>
      <div>
        <SectionLabel right={<InfoTip>Three different time measures are kept separate. “Time between steps” uses every occurrence; “wait before next start” needs a completion followed by a recorded start; service time is start→complete of one activity.</InfoTip>}>
          Timing
        </SectionLabel>
        <div className="space-y-2 text-[13px]">
          <TimingRow label="Time between steps" value={fmtGap(ie)} n={ie?.n} of={cov?.transitionCount ?? edge.count} lowSupport={!!ie && ie.n < 3} />
          <TimingRow label="Wait before next start" value={fmtGap(mg)} n={mg?.n ?? (cov ? cov.matchedGapCount : undefined)} of={cov?.transitionCount ?? edge.count} lowSupport={!!mg && mg.n < 3} note={cov && cov.overlapCount ? `${cov.overlapCount} overlapping (excluded)` : undefined} />
          <TimingRow label={`Service of “${from}”`} value={fmtGap(serviceFor(gaps, from))} n={serviceFor(gaps, from)?.n} />
        </div>
      </div>
      <CaseList caseKeys={edge.caseKeys} onPick={onPick} />
    </div>
  );
}

function TimingRow({ label, value, n, of, lowSupport, note }: { label: string; value: string; n?: number; of?: number; lowSupport?: boolean; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900 tabular">{value}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 tabular">
        {n !== undefined ? <span>n = {n}{of !== undefined && ` of ${of}`}</span> : <span>no observations</span>}
        {n !== undefined && of ? <Meter value={n} max={of} className="w-16" tone="slate" /> : null}
        {lowSupport && <Badge tone="amber">low support</Badge>}
        {note && <span>{note}</span>}
      </div>
    </div>
  );
}

function EdgeList({ title, edges, dir, onSelect }: { title: string; edges: { from: string; to: string; count: number }[]; dir: 'to' | 'from'; onSelect: (f: string, t: string) => void }) {
  if (!edges.length) return null;
  const max = Math.max(...edges.map((e) => e.count));
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-0.5">
        {edges.map((e) => (
          <li key={`${e.from}>${e.to}`}>
            <button type="button" onClick={() => onSelect(e.from, e.to)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-slate-50">
              <span className="truncate">{dir === 'to' ? `→ ${e.to}` : `${e.from} →`}</span>
              <span className="tabular text-slate-500">{e.count}</span>
              <Meter value={e.count} max={max} className="col-span-2" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Title({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-600">{kicker}</div>
      <div className="text-[16px] font-semibold leading-snug text-slate-900">{title}</div>
    </div>
  );
}

/* ------------------------------ Variant inspector ------------------------------ */

function VariantInspector({ v, onPick }: { v: Variant; onPick: (k: string) => void }) {
  return (
    <div className="space-y-4">
      <Title kicker="Variant" title={`${fmtShare(v.share)} of cases`} />
      <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <Metric label="Cases" value={v.count} />
        <Metric label="Steps" value={v.activities.length} />
        <Metric label="Avg span" value={fmtMinutes(v.avgElapsedMin)} />
      </div>
      <ol className="space-y-1">
        {v.activities.map((act, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px]">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[10.5px] font-semibold text-brand-700 tabular">{i + 1}</span>
            {act}
          </li>
        ))}
      </ol>
      <CaseList caseKeys={v.caseKeys} onPick={onPick} />
    </div>
  );
}

/* ------------------------------ Hand-over inspector ------------------------------ */

function HandoverInspector({ ra, selection, onSelect, onPick }: { ra: ResourceAnalysis; selection: GraphSelection; onSelect: (s: GraphSelection) => void; onPick: (k: string) => void }) {
  const selResource = selection?.type === 'node' ? ra.resources.find((r) => rNode(r.resource) === selection.id) : undefined;
  const selHandoff = selection?.type === 'edge' ? ra.handoffs.find((h) => hEdge(h.from, h.to) === selection.id) : undefined;
  if (selResource) {
    const out = ra.handoffs.filter((h) => h.from === selResource.resource).sort((a, b) => b.count - a.count);
    const inc = ra.handoffs.filter((h) => h.to === selResource.resource).sort((a, b) => b.count - a.count);
    return (
      <div className="space-y-4">
        <Title kicker={selResource.roles.length ? `Resource · ${selResource.roles.join(', ')}` : 'Resource'} title={resourceLabel(selResource.resource)} />
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Steps performed" value={selResource.instances} sub="completed activity instances" />
          <Metric label="Cases" value={selResource.distinctCases} />
          <Metric label="Rows recorded" value={selResource.rawEvents} />
          <Metric label="Measured active time" value={selResource.activeMin === null ? 'N/A' : fmtMinutes(selResource.activeMin)} sub="matched intervals only" />
        </div>
        <p className="text-[11.5px] text-slate-500">Utilization and overload need shift/capacity data; they are not inferred from hand-over counts.</p>
        <div>
          <SectionLabel>Activity mix</SectionLabel>
          <ul className="space-y-0.5 text-[13px]">
            {Object.entries(selResource.activityCounts).sort((a, b) => b[1] - a[1]).map(([act, c]) => (
              <li key={act} className="flex justify-between"><span className="truncate">{act}</span><span className="tabular text-slate-500">{c}</span></li>
            ))}
          </ul>
        </div>
        {[['Passes work to', out, 'to'] as const, ['Receives work from', inc, 'from'] as const].map(([title, list, dir]) =>
          list.length ? (
            <div key={title}>
              <SectionLabel>{title}</SectionLabel>
              <ul className="space-y-0.5">
                {list.map((h) => (
                  <li key={`${h.from}>${h.to}`}>
                    <button type="button" className="flex w-full justify-between rounded-md px-2 py-1 text-left text-[13px] hover:bg-slate-50" onClick={() => onSelect({ type: 'edge', id: hEdge(h.from, h.to) })}>
                      <span className="truncate">{resourceLabel(dir === 'to' ? h.to : h.from)}</span>
                      <span className="tabular text-slate-500">{h.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        <CaseList caseKeys={selResource.caseKeys} onPick={onPick} />
      </div>
    );
  }
  if (selHandoff) {
    const reverse = ra.handoffs.find((h) => h.from === selHandoff.to && h.to === selHandoff.from);
    return (
      <div className="space-y-4">
        <Title kicker="Hand-over" title={`${resourceLabel(selHandoff.from)} → ${resourceLabel(selHandoff.to)}`} />
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Hand-overs" value={selHandoff.count} />
          <Metric label="Opposite direction" value={reverse?.count ?? 0} />
        </div>
        <div>
          <SectionLabel right={<InfoTip>The pair of activities on each side of the hand-over, as recorded. A hand-over is an observed sequence, not proof of communication.</InfoTip>}>Which steps were handed over</SectionLabel>
          {selHandoff.activityPairs ? (
            <ul className="space-y-1">
              {selHandoff.activityPairs.map((p) => (
                <li key={`${p.from}>${p.to}`} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px]">
                  <div className="flex justify-between gap-2"><span>{p.from} → {p.to}</span><span className="tabular text-slate-500">{p.count}</span></div>
                  <div className="text-[11px] text-slate-500">{plural(p.caseKeys.length, 'case')}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable fn="getResourceAnalysis" title="Activity pairs not provided by this engine build">
              The hand-over count and its cases are shown; the per-activity breakdown arrives with the v0.3 engine (HandoffSummary.activityPairs).
            </Unavailable>
          )}
        </div>
        <CaseList caseKeys={selHandoff.caseKeys} onPick={onPick} />
      </div>
    );
  }
  const top = [...ra.handoffs].sort((a, b) => b.count - a.count).slice(0, 8);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <Metric label="Resources" value={ra.resources.length} />
        <Metric label="Hand-overs" value={ra.handoffs.reduce((s, h) => s + h.count, 0)} />
        <Metric label="Steps with a resource" value={fmtPct(ra.knownInstances, ra.totalInstances)} sub={`${ra.knownInstances} of ${ra.totalInstances}`} />
        <Metric label="Rows with a resource" value={fmtPct(ra.knownRawEvents, ra.totalRawEvents)} sub={`${ra.knownRawEvents} of ${ra.totalRawEvents}`} />
      </div>
      <p className="text-[12px] leading-relaxed text-slate-500">Counted only when two consecutive steps of a case have two different known resources. Steps without a resource break the chain.</p>
      {top.length ? (
        <div>
          <SectionLabel>Most frequent hand-overs</SectionLabel>
          <ul className="space-y-0.5">
            {top.map((h) => (
              <li key={`${h.from}>${h.to}`}>
                <button type="button" className="flex w-full justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-slate-50" onClick={() => onSelect({ type: 'edge', id: hEdge(h.from, h.to) })}>
                  <span className="truncate">{resourceLabel(h.from)} → {resourceLabel(h.to)}</span>
                  <span className="tabular text-slate-500">{h.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Notice tone="info" title="No hand-overs in this scope">Consecutive steps share a resource or have a missing one, so no arrow is drawn.</Notice>
      )}
    </div>
  );
}

function ResourceFocus({ all, focus, onChange }: { all: string[]; focus: Set<string>; onChange: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = all.filter((r) => !q || resourceLabel(r).toLowerCase().includes(q.toLowerCase()));
  const toggle = (r: string) => {
    const next = new Set(focus);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    onChange(next);
  };
  return (
    <div className="relative">
      <Button size="sm" variant={focus.size ? 'subtle' : 'secondary'} icon="users" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {focus.size ? `Focus: ${focus.size}` : 'Focus on resources'}
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-xs text-slate-500">Display only: shows the chosen resources and their direct partners. Counts stay the same.</p>
          <input className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resource" />
          <div className="pp-scroll flex max-h-48 flex-wrap gap-1 overflow-auto">
            {shown.map((r) => (
              <button key={r} type="button" aria-pressed={focus.has(r)} onClick={() => toggle(r)} className={cx('rounded-md border px-2 py-0.5 text-xs', focus.has(r) ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                {resourceLabel(r)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            <Button size="sm" variant="ghost" disabled={!focus.size} onClick={() => onChange(new Set())}>Clear</Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Replay inspector ------------------------------ */

function ReplayInspector({ frame, onPick }: { frame: ReplayFrame; onPick: (k: string) => void }) {
  const c = frame.counts;
  const rows: [string, number, string][] = [
    ['Active (between recorded start and complete)', c.active, 'bg-brand-500'],
    ['At latest recorded step, more to come', c.latest_observation, 'bg-slate-400'],
    ['Last recorded step (no completion defined/observed)', c.last_observation, 'bg-slate-300'],
    ['Completed (completion activity observed)', c.completed, 'bg-emerald-500'],
    ['Not yet started', c.not_yet_observed, 'bg-white ring-1 ring-slate-300'],
  ];
  return (
    <div className="space-y-4">
      <Title kicker="Replay at cursor" title={`${plural(frame.selectedCases, 'case')} in replay`} />
      <ul className="space-y-1.5 text-[13px]">
        {rows.map(([label, n, cls]) => (
          <li key={label} className="flex items-center gap-2">
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', cls)} />
            <span className="flex-1 text-slate-600">{label}</span>
            <span className="font-semibold tabular">{fmtNumber(n)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-slate-500">Exact counts from the engine. A case is placed on its latest recorded activity; no waiting or service time is interpolated.</p>
      <CaseList caseKeys={frame.cases.map((x) => x.caseKey)} onPick={onPick} label="Cases visible now" />
    </div>
  );
}
