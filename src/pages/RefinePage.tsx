/**
 * Refine & Improve — what-if scenarios with parameters and results on one
 * page, value–effort ranking from shared Implementation records, and the next
 * cycle. Modeled values are labelled as modeled and never as achieved benefit.
 * Drawing BPMN does not change any input here.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GateInputOptions, GateInputSelection, Lifecycle, Metric, QueueResult, TargetEvaluation } from '../contracts';
import type { QueueComparison, QueueInputSelection, ServerQueueResult } from '../v03-contracts';
import { callEngine, hasCapability, type EngineResult } from '../adapters/engineAdapter';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { defaultGenericQueueParams, uid, useStore, useWorkspace } from '../state/store';
import { planFromGenericScenario, planFromScenario } from '../state/plans';
import { QUEUE_WAIT_METRIC_ID, gateScenarioAvailable } from '../festival/adapter';
import { OtherScopesNote } from '../components/WorkspaceHistory';
import type { GenericQueueParams, GenericScenarioRecord, PageId, ProcessWorkspace, ScenarioParams, ScenarioRecord } from '../state/types';
import { caseLabel, fmtInstant, fmtMinutes, fmtNumber, fmtValue, plural } from '../lib/format';
import { kpiName } from '../lib/kpiCatalog';
import { RequireData } from '../components/layout';
import { ImpactMatrix, quadrant, QUADRANT_LABEL } from '../components/ImpactMatrix';
import { Badge, Button, Card, EmptyState, EngineGate, Field, InfoTip, Input, Notice, PageHeader, Segmented, Select, Table, Td, Th, Unavailable, cx } from '../components/ui';
import { StatusBadge } from './MonitorPage';

export function scenarioStale(s: ScenarioRecord, ws: ProcessWorkspace, scope: ReturnType<typeof useAnalysis>['scope'], provider: string) {
  if (s.paramsRevision !== ws.paramsRevision) return 'Simulation parameters changed after this run.';
  if (isScopeStale(s.scope, scope)) return 'Dataset, process or case filter changed after this run.';
  if (s.provider !== provider) return 'Computed by a different provider.';
  return null;
}

export function genericStale(s: GenericScenarioRecord, ws: ProcessWorkspace, scope: ReturnType<typeof useAnalysis>['scope'], provider: string) {
  if (s.paramsRevision !== (ws.genericParamsRevision ?? 0)) return 'Queue parameters changed after this run.';
  if (isScopeStale(s.scope, scope)) return 'Dataset, process or case filter changed after this run.';
  if (s.provider !== provider) return 'Computed by a different provider.';
  return null;
}

type Model = 'gate' | 'queue';

export function RefinePage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div>
      <PageHeader
        phase="6 · Refine & Improve"
        title="What-if scenarios and priorities"
        subtitle="Change servers or service time and compare a baseline with a candidate on the same arrivals. Results are modeled under stated assumptions — not measured savings."
      />
      <OtherScopesNote navigate={navigate} />
      <RequireData navigate={navigate}>
        <Content navigate={navigate} />
      </RequireData>
    </div>
  );
}

function Content({ navigate }: { navigate: (p: PageId) => void }) {
  const { scope, api } = useAnalysis();
  const { state } = useStore();
  const gate = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);
  const generic = hasCapability(api, 'extractQueueInputs') && hasCapability(api, 'compareQueues');
  const [model, setModel] = useState<Model>(gate ? 'gate' : 'queue');
  useEffect(() => setModel(gate ? 'gate' : 'queue'), [gate]);
  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold text-slate-800">Model</span>
        <Segmented<Model>
          value={model}
          onChange={setModel}
          ariaLabel="Scenario model"
          options={[
            { id: 'gate', label: 'Festival entry gates', disabled: !gate, title: gate ? 'Festival preset for the audience entry process' : 'Only for the Festival audience process with Festival rules on' },
            { id: 'queue', label: 'General queue model' },
          ]}
        />
        <span className="text-xs text-slate-500">One pooled first-come-first-served queue with identical servers, fixed arrivals from the log.</span>
      </div>
      {model === 'gate' && gate ? <GateScenario navigate={navigate} /> : generic ? <GenericScenario navigate={navigate} /> : (
        <Unavailable fn="extractQueueInputs" title="The general queue model is not available in this build">
          {gate ? 'Use the Festival entry gate model above.' : 'For this process, rate impact and effort below and create a qualitative plan. No modeled number is shown.'}
        </Unavailable>
      )}
      <ValueEffort navigate={navigate} />
      <NextCycle navigate={navigate} />
    </div>
  );
}

/* ------------------------------ Shared result view ------------------------------ */

interface SideResult {
  servers: number;
  meanWaitMin: number;
  p95WaitMin: number;
  maxWaitMin: number;
  finishElapsedMin: number;
  throughputPerHour: number | null;
  count: number;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const deltaMin = (d: number) => (Math.abs(d) < 1e-12 ? '±0' : `${d > 0 ? '+' : '−'}${fmtMinutes(Math.abs(d))}`);

function ComparisonView({ b, c, serverLabel, staffing, target }: { b: SideResult; c: SideResult; serverLabel: string; staffing: ReactNode; target?: ReactNode }) {
  const rows: [string, string, string, string][] = [
    [serverLabel, String(b.servers), String(c.servers), signed(c.servers - b.servers)],
    ['Mean wait', fmtMinutes(b.meanWaitMin), fmtMinutes(c.meanWaitMin), deltaMin(c.meanWaitMin - b.meanWaitMin)],
    ['95th-percentile wait', fmtMinutes(b.p95WaitMin), fmtMinutes(c.p95WaitMin), deltaMin(c.p95WaitMin - b.p95WaitMin)],
    ['Longest wait', fmtMinutes(b.maxWaitMin), fmtMinutes(c.maxWaitMin), deltaMin(c.maxWaitMin - b.maxWaitMin)],
    ['Time to finish all (from first arrival)', fmtMinutes(b.finishElapsedMin), fmtMinutes(c.finishElapsedMin), deltaMin(c.finishElapsedMin - b.finishElapsedMin)],
    [
      'Modeled throughput',
      b.throughputPerHour === null ? 'N/A' : `${fmtNumber(b.throughputPerHour, 1)} /h`,
      c.throughputPerHour === null ? 'N/A' : `${fmtNumber(c.throughputPerHour, 1)} /h`,
      b.throughputPerHour === null || c.throughputPerHour === null ? '—' : signed(+(c.throughputPerHour - b.throughputPerHour).toFixed(1)),
    ],
  ];
  const chart = [
    { name: 'Mean wait', baseline: b.meanWaitMin, candidate: c.meanWaitMin },
    { name: 'p95 wait', baseline: b.p95WaitMin, candidate: c.p95WaitMin },
    { name: 'Longest wait', baseline: b.maxWaitMin, candidate: c.maxWaitMin },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Big label="Mean wait · baseline" value={fmtMinutes(b.meanWaitMin)} />
        <Big label="Mean wait · candidate" value={fmtMinutes(c.meanWaitMin)} sub={deltaMin(c.meanWaitMin - b.meanWaitMin)} accent />
        <Big label="p95 wait" value={`${fmtMinutes(b.p95WaitMin)} → ${fmtMinutes(c.p95WaitMin)}`} />
        <Big label="Staffing" value={staffing} />
      </div>
      {target}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Table>
          <thead><tr><Th>Modeled measure</Th><Th align="right">Baseline</Th><Th align="right">Candidate</Th><Th align="right">Change</Th></tr></thead>
          <tbody>
            {rows.map(([l, x, y, d]) => <tr key={l}><Td>{l}</Td><Td align="right">{x}</Td><Td align="right" className="font-semibold">{y}</Td><Td align="right" className="text-slate-500">{d}</Td></tr>)}
          </tbody>
        </Table>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: -6, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtMinutes(v)} width={60} />
              <Tooltip formatter={(v) => fmtMinutes(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="baseline" name={`Baseline (${b.servers})`} fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="candidate" name={`Candidate (${c.servers})`} fill="#4f46e5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-[11.5px] text-slate-500">Both sides use the same {plural(b.count, 'arrival')} and service demand from the log. Modeled under the stated assumptions; not a measured result.</p>
    </div>
  );
}

function Big({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={cx('rounded-xl border px-3.5 py-2.5', accent ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-white')}>
      <div className="flex items-center justify-between text-xs text-slate-500">{label}<Badge tone="violet">modeled</Badge></div>
      <div className="mt-0.5 text-lg font-semibold text-slate-900 tabular">{value}</div>
      {sub && <div className="text-xs text-slate-600 tabular">{sub}</div>}
    </div>
  );
}

/* ------------------------------ Festival gate preset ------------------------------ */

function intOrNull(s: string): number | null | 'invalid' {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 'invalid';
}

function GateScenario({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const ws = useWorkspace()!;
  const { api, provider, scope, selectedTraces, kpis, performance } = useAnalysis();
  const [lastRun, setLastRun] = useState<{ gate: EngineResult<GateInputSelection>; base?: EngineResult<QueueResult>; cand?: EngineResult<QueueResult> } | null>(null);
  const p = ws.scenarioParams;
  const [baseline, setBaseline] = useState(p.baselineGates?.toString() ?? '');
  const [candidate, setCandidate] = useState(p.candidateGates?.toString() ?? '');
  const [sec, setSec] = useState(p.assumedServiceSec?.toString() ?? '');
  useEffect(() => setBaseline(p.baselineGates?.toString() ?? ''), [p.baselineGates]);
  useEffect(() => setCandidate(p.candidateGates?.toString() ?? ''), [p.candidateGates]);
  const update = (params: Partial<ScenarioParams>) => dispatch({ type: 'SET_SCENARIO_PARAMS', params });
  const serviceActivities = performance?.status === 'ok' ? [...new Set(performance.data.gaps.filter((g) => g.metricType === 'service').map((g) => g.from))] : [];
  const b = intOrNull(baseline);
  const c = intOrNull(candidate);
  const s = sec.trim() === '' ? null : Number(sec);
  const secInvalid = s !== null && !(Number.isFinite(s) && s > 0);
  const simDesigns = ws.designs.filter((d) => d.kind === 'simulation');
  const activeDesign = ws.designs.find((d) => d.id === ws.activeDesignId) ?? null;
  const linkedDesign = activeDesign?.kind === 'simulation' ? activeDesign : null;
  const problems: string[] = [];
  if (!p.baselineGates) problems.push('baseline gates');
  if (!p.candidateGates) problems.push('candidate gates');
  if (p.serviceMode === 'assumed' && !(p.assumedServiceSec && p.assumedServiceSec > 0)) problems.push('assumed service seconds');

  const run = () => {
    if (problems.length || !scope) return;
    const options: GateInputOptions = p.serviceMode === 'observed' ? { serviceActivity: p.serviceActivity, mode: 'observed' } : { serviceActivity: p.serviceActivity, mode: 'assumed', serviceSec: p.assumedServiceSec! };
    const g = callEngine(api, 'getGateInputs', selectedTraces, options);
    if (g.status !== 'ok' || !g.data.inputs.length) return setLastRun({ gate: g });
    const base = callEngine(api, 'simulateGateQueue', g.data.inputs, p.baselineGates!);
    const cand = callEngine(api, 'simulateGateQueue', g.data.inputs, p.candidateGates!);
    setLastRun({ gate: g, base, cand });
    if (base.status !== 'ok' || cand.status !== 'ok') return;
    const scenario: ScenarioRecord = {
      id: uid('scn'),
      revision: ws.scenarios.length + 1,
      designId: linkedDesign?.id ?? null,
      scope,
      paramsRevision: ws.paramsRevision,
      params: { ...p },
      inputCount: g.data.inputs.length,
      eligibleCases: g.data.eligibleCases,
      excludedCases: g.data.exclusions.length,
      baseline: base.data,
      candidate: cand.data,
      createdAt: Date.now(),
      provider,
    };
    dispatch({ type: 'ADD_SCENARIO', scenario });
    dispatch({ type: 'TOAST', tone: 'success', message: `Scenario revision ${scenario.revision} computed.` });
  };

  const selected = ws.scenarios.find((x) => x.id === ws.selectedScenarioId) ?? null;
  const staleReason = selected ? scenarioStale(selected, ws, scope, provider) : null;
  const apply = () => {
    if (!selected || staleReason) return;
    const existing = ws.plans.find((pl) => pl.state === 'current' && pl.source.kind === 'scenario' && pl.source.scenarioId === selected.id);
    if (existing) {
      dispatch({ type: 'SET_ACTIVE_PLAN', id: existing.id });
      dispatch({ type: 'TOAST', tone: 'info', message: 'This scenario already has a current plan; your edits are kept.' });
      navigate('implementation');
      return;
    }
    const currents = ws.plans.filter((pl) => pl.state === 'current' && pl.source.kind === 'scenario');
    if (currents.length && !confirm(`Create a new plan from scenario rev ${selected.revision}? ${plural(currents.length, 'current scenario plan')} will be archived (kept, not deleted).`)) return;
    const design = ws.designs.find((d) => d.id === selected.designId) ?? null;
    const target = design?.targetMetricId ? ws.targets.find((t) => t.metricId === design.targetMetricId) : undefined;
    dispatch({ type: 'ADD_PLAN', plan: planFromScenario(selected, design, target, ws.plans.length + 1), archiveOthers: true });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Editable rollout plan created.' });
    navigate('implementation');
  };

  const observedWait = kpis?.status === 'ok' ? kpis.data.find((m) => m.id === QUEUE_WAIT_METRIC_ID) : undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card title="Parameters" subtitle="Festival audience entry · one qualified worker per gate (assumption)">
        <div className="space-y-3">
          <Field label="Service step" hint="Arrival = Join Entry Queue. Service = matched start → complete of this step.">
            <Select value={p.serviceActivity} onChange={(e) => update({ serviceActivity: e.target.value })}>
              {[...new Set([p.serviceActivity, ...serviceActivities])].map((a) => <option key={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="Service time">
            <Segmented size="sm" value={p.serviceMode} onChange={(m) => update({ serviceMode: m })} options={[{ id: 'observed', label: 'From the log' }, { id: 'assumed', label: 'Assumed seconds' }]} />
          </Field>
          {p.serviceMode === 'assumed' && (
            <Field label="Seconds per entrant" error={secInvalid ? 'Must be a positive number.' : null}>
              <Input value={sec} inputMode="decimal" invalid={secInvalid} onChange={(e) => {
                setSec(e.target.value);
                const v = e.target.value.trim() === '' ? null : Number(e.target.value);
                if (v === null || (Number.isFinite(v) && v > 0)) update({ assumedServiceSec: v });
              }} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Baseline gates" hint={state.dataset?.metadata?.baselineGateCount !== undefined ? `manifest: ${state.dataset.metadata.baselineGateCount}` : 'your input'} error={b === 'invalid' ? '1–500' : null}>
              <Input value={baseline} inputMode="numeric" invalid={b === 'invalid'} onChange={(e) => { setBaseline(e.target.value); const v = intOrNull(e.target.value); if (v !== 'invalid') update({ baselineGates: v }); }} />
            </Field>
            <Field label="Candidate gates" error={c === 'invalid' ? '1–500' : null}>
              <Input value={candidate} inputMode="numeric" invalid={c === 'invalid'} onChange={(e) => { setCandidate(e.target.value); const v = intOrNull(e.target.value); if (v !== 'invalid') update({ candidateGates: v }); }} />
            </Field>
          </div>
          <Field label="Linked design">
            {simDesigns.length ? (
              <Select value={linkedDesign?.id ?? ''} onChange={(e) => dispatch({ type: 'SET_ACTIVE_DESIGN', id: e.target.value || null })}>
                <option value="">— none —</option>
                {simDesigns.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
            ) : (
              <button type="button" className="text-[13px] font-medium text-brand-600 hover:underline" onClick={() => navigate('design')}>Create a quantitative design →</button>
            )}
          </Field>
          {problems.length > 0 && <Notice tone="warning">Set {problems.join(', ')} to run.</Notice>}
          <Button variant="primary" className="w-full" icon="play" disabled={problems.length > 0} onClick={run}>Run baseline + candidate</Button>
          {lastRun && <GateRunMessages run={lastRun} />}
          {observedWait && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Observed in the log (not modeled): {kpiName(observedWait.id)} <b>{fmtValue(observedWait.value, observedWait.unit)}</b> (n = {observedWait.n})
            </div>
          )}
        </div>
      </Card>
      <div className="min-w-0 space-y-4">
        {selected ? (
          <Card
            title={`Scenario r${selected.revision}: ${selected.baseline.gateCount} → ${selected.candidate.gateCount} gates`}
            subtitle={`${plural(selected.inputCount, 'entrant')} · ${selected.excludedCases} excluded · computed ${fmtInstant(selected.createdAt)}`}
            actions={<Button variant="primary" iconRight="arrowRight" disabled={!!staleReason} title={staleReason ?? undefined} onClick={apply}>Send to rollout plan</Button>}
          >
            {staleReason && <Notice tone="warning" title="Out of date — run again to use it" className="mb-3">{staleReason}</Notice>}
            <ComparisonView
              b={{ ...selected.baseline, servers: selected.baseline.gateCount }}
              c={{ ...selected.candidate, servers: selected.candidate.gateCount }}
              serverLabel="Staffed gates"
              staffing={`${signed(selected.candidate.gateCount - selected.baseline.gateCount)} worker(s)`}
              target={<GateTargetCheck scenario={selected} />}
            />
          </Card>
        ) : (
          <EmptyState icon="flask" title="No scenario computed yet">Set the gate counts on the left and run both sides.</EmptyState>
        )}
        <ScenarioHistory
          rows={[...ws.scenarios].reverse().map((s) => ({
            id: s.id,
            rev: s.revision,
            created: s.createdAt,
            change: `${s.baseline.gateCount} → ${s.candidate.gateCount} gates`,
            service: s.params.serviceMode === 'observed' ? 'from log' : `${s.params.assumedServiceSec} s`,
            n: s.inputCount,
            stale: scenarioStale(s, ws, scope, provider),
            selected: s.id === ws.selectedScenarioId,
          }))}
          onSelect={(id) => dispatch({ type: 'SELECT_SCENARIO', id })}
        />
      </div>
    </div>
  );
}

function GateRunMessages({ run }: { run: { gate: EngineResult<GateInputSelection>; base?: EngineResult<QueueResult>; cand?: EngineResult<QueueResult> } }) {
  return (
    <div className="space-y-2">
      <EngineGate result={run.gate}>
        {(g) => (
          <>
            {g.inputs.length === 0 ? (
              <Notice tone="error" title="No usable arrivals">All {g.eligibleCases} eligible cases were excluded, so there is nothing to simulate.</Notice>
            ) : (
              <Notice tone={g.exclusions.length ? 'warning' : 'success'}>{plural(g.inputs.length, 'entrant')} used of {g.eligibleCases}.{g.exclusions.length > 0 && ` ${g.exclusions.length} excluded.`}</Notice>
            )}
            {g.exclusions.length > 0 && (
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Excluded cases</summary>
                <ul className="mt-1 max-h-32 overflow-auto font-mono">
                  {g.exclusions.slice(0, 200).map((x) => <li key={x.caseKey}>{caseLabel(x.caseKey)} — {x.reason.replaceAll('_', ' ')}</li>)}
                </ul>
              </details>
            )}
          </>
        )}
      </EngineGate>
      {run.base && <EngineGate result={run.base}>{() => null}</EngineGate>}
      {run.cand && run.cand.status !== 'ok' && run.base?.status === 'ok' && <EngineGate result={run.cand}>{() => null}</EngineGate>}
    </div>
  );
}

function GateTargetCheck({ scenario }: { scenario: ScenarioRecord }) {
  const ws = useWorkspace()!;
  const { api } = useAnalysis();
  const design = ws.designs.find((d) => d.id === scenario.designId);
  const target = design?.targetMetricId ? ws.targets.find((t) => t.metricId === design.targetMetricId) : undefined;
  if (!target) return <p className="text-[12px] text-slate-500">{design ? 'The linked design has no saved target.' : 'Link a design with a target to compare against it.'}</p>;
  if (target.metricId !== QUEUE_WAIT_METRIC_ID || target.unit !== 'min') {
    return <p className="text-[12px] text-slate-500">Target check compares the modeled mean wait with {kpiName(QUEUE_WAIT_METRIC_ID)} only; this design targets {kpiName(target.metricId)}.</p>;
  }
  const asMetric = (q: QueueResult): Metric => ({ id: target.metricId, value: q.meanWaitMin, unit: 'min', n: q.count, eligible: q.count, definition: 'Modeled mean wait (simulation, not observed)', caseKeys: [] });
  const rb = callEngine(api, 'evaluateTargets', [asMetric(scenario.baseline)], [target]);
  const rc = callEngine(api, 'evaluateTargets', [asMetric(scenario.candidate)], [target]);
  const s = (r: typeof rb): TargetEvaluation['status'] | undefined => (r.status === 'ok' ? r.data[0]?.status : undefined);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
      Target {target.direction === 'max' ? '≤' : '≥'} {fmtValue(target.value, target.unit)} (modeled mean wait):
      <StatusBadge status={s(rb)} /> → <StatusBadge status={s(rc)} />
    </div>
  );
}

/* ------------------------------ General queue ------------------------------ */

const REASON: Record<string, string> = {
  missing_arrival: 'no arrival step',
  ambiguous_arrival: 'more than one arrival',
  missing_service: 'no service step',
  ambiguous_service: 'ambiguous service records',
  invalid_service: 'invalid service interval',
  service_before_arrival: 'service before arrival',
};

function GenericScenario({ navigate }: { navigate: (p: PageId) => void }) {
  const { dispatch } = useStore();
  const ws = useWorkspace()!;
  const { api, provider, scope, selectedTraces, dfg, performance } = useAnalysis();
  const p: GenericQueueParams = ws.genericQueueParams ?? defaultGenericQueueParams();
  const set = (x: Partial<GenericQueueParams>) => dispatch({ type: 'SET_GENERIC_PARAMS', params: x });
  const activities = dfg?.status === 'ok' ? dfg.data.nodes.map((n) => n.activity) : [];
  const serviceActs = performance?.status === 'ok' ? [...new Set(performance.data.gaps.filter((g) => g.metricType === 'service').map((g) => g.from))] : [];
  const [run, setRun] = useState<{ sel: EngineResult<QueueInputSelection>; cmp?: EngineResult<QueueComparison> } | null>(null);
  const [sec, setSec] = useState(p.assumedServiceSec?.toString() ?? '');
  const design = ws.designs.find((d) => d.id === ws.activeDesignId) ?? null;

  const problems: string[] = [];
  if (!p.arrivalActivity) problems.push('arrival step');
  if (p.serviceMode === 'observed' && !p.serviceActivity) problems.push('service step');
  if (p.serviceMode === 'assumed' && !(p.assumedServiceSec && p.assumedServiceSec > 0)) problems.push('service seconds');
  if (!p.baselineServers) problems.push('baseline servers');
  if (!p.candidateServers) problems.push('candidate servers');
  if (!(p.serviceMultiplier > 0)) problems.push('service time factor');

  const go = () => {
    if (problems.length || !scope) return;
    const sel = callEngine(api, 'extractQueueInputs', selectedTraces, {
      arrival: { activity: p.arrivalActivity, ...(p.arrivalLifecycle ? { lifecycle: p.arrivalLifecycle } : {}) },
      service: p.serviceMode === 'observed' ? { mode: 'observed', activity: p.serviceActivity } : { mode: 'assumed', serviceSec: p.assumedServiceSec! },
    });
    if (sel.status !== 'ok' || !sel.data.inputs.length) return setRun({ sel });
    const cmp = callEngine(api, 'compareQueues', sel.data.inputs, {
      baselineServers: p.baselineServers!,
      candidateServers: p.candidateServers!,
      candidateServiceMultiplier: p.serviceMultiplier,
      assumeOneQualifiedWorkerPerServer: p.assumeOneWorkerPerServer,
    });
    setRun({ sel, cmp });
    if (cmp.status !== 'ok') return;
    const record: GenericScenarioRecord = {
      id: uid('gq'),
      kind: 'generic_queue',
      revision: (ws.genericScenarios?.length ?? 0) + 1,
      designId: design?.id ?? null,
      scope,
      provider,
      paramsRevision: ws.genericParamsRevision ?? 0,
      params: { ...p },
      inputCount: sel.data.inputs.length,
      eligibleCases: sel.data.eligibleCases,
      exclusions: sel.data.exclusions,
      comparison: cmp.data,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_GENERIC_SCENARIO', scenario: record });
    setPick(record.id);
    dispatch({ type: 'TOAST', tone: 'success', message: `Queue scenario r${record.revision} computed.` });
  };

  const list = ws.genericScenarios ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const selected = list.find((s) => s.id === pick) ?? list.at(-1) ?? null;
  const stale = selected ? genericStale(selected, ws, scope, provider) : null;
  const apply = () => {
    if (!selected || stale) return;
    const existing = ws.plans.find((pl) => pl.state === 'current' && pl.source.kind === 'generic_scenario' && pl.source.scenarioId === selected.id);
    if (existing) {
      dispatch({ type: 'SET_ACTIVE_PLAN', id: existing.id });
      navigate('implementation');
      return;
    }
    dispatch({ type: 'ADD_PLAN', plan: planFromGenericScenario(selected, ws.designs.find((d) => d.id === selected.designId) ?? null, ws.plans.length + 1), archiveOthers: false });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Editable rollout plan created.' });
    navigate('implementation');
  };
  const side = (r: ServerQueueResult): SideResult => ({ ...r, servers: r.serverCount });

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card title="Parameters" subtitle="Each case contributes one arrival and one service; ambiguous cases are excluded and listed.">
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Arrival step" hint="When a case joins the queue">
              <Select value={p.arrivalActivity} onChange={(e) => set({ arrivalActivity: e.target.value })}>
                <option value="">— choose —</option>
                {activities.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Recorded as">
              <Select value={p.arrivalLifecycle} onChange={(e) => set({ arrivalLifecycle: e.target.value as Lifecycle | '' })}>
                <option value="">complete/point</option>
                <option value="start">start</option>
                <option value="complete">complete</option>
                <option value="point">point</option>
              </Select>
            </Field>
          </div>
          <Field label="Service time">
            <Segmented size="sm" value={p.serviceMode} onChange={(m) => set({ serviceMode: m })} options={[{ id: 'observed', label: 'From the log' }, { id: 'assumed', label: 'Assumed seconds' }]} />
          </Field>
          {p.serviceMode === 'observed' ? (
            <Field label="Service step" hint={serviceActs.length ? 'Needs one matched start/complete per case' : 'No activity has matched start/complete in this log — use assumed seconds.'}>
              <Select value={p.serviceActivity} onChange={(e) => set({ serviceActivity: e.target.value })}>
                <option value="">— choose —</option>
                {serviceActs.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Seconds per case (assumption)">
              <Input value={sec} inputMode="decimal" onChange={(e) => { setSec(e.target.value); const v = Number(e.target.value); set({ assumedServiceSec: e.target.value.trim() && Number.isFinite(v) && v > 0 ? v : null }); }} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Baseline servers">
              <Input inputMode="numeric" value={p.baselineServers ?? ''} onChange={(e) => { const v = intOrNull(e.target.value); set({ baselineServers: v === 'invalid' ? null : v }); }} />
            </Field>
            <Field label="Candidate servers">
              <Input inputMode="numeric" value={p.candidateServers ?? ''} onChange={(e) => { const v = intOrNull(e.target.value); set({ candidateServers: v === 'invalid' ? null : v }); }} />
            </Field>
          </div>
          <Field label={<span className="inline-flex items-center gap-1">Candidate service time factor <InfoTip>1 = unchanged. 0.8 means every candidate service takes 80% of its baseline time (an explicit assumption, e.g. for a simplified step). Arrivals stay identical.</InfoTip></span>}>
            <Input inputMode="decimal" value={String(p.serviceMultiplier)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) set({ serviceMultiplier: v }); }} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-1" checked={p.assumeOneWorkerPerServer} onChange={(e) => set({ assumeOneWorkerPerServer: e.target.checked })} />
            Assume one qualified worker per server (enables a staffing change)
          </label>
          {problems.length > 0 && <Notice tone="warning">Set {problems.join(', ')} to run.</Notice>}
          <Button variant="primary" className="w-full" icon="play" disabled={problems.length > 0} onClick={go}>Run baseline + candidate</Button>
          {run && (
            <EngineGate result={run.sel}>
              {(s) => (
                <div className="space-y-1">
                  <Notice tone={s.inputs.length === 0 ? 'error' : s.exclusions.length ? 'warning' : 'success'}>
                    {s.inputs.length === 0 ? `No usable case: all ${s.eligibleCases} were excluded.` : `${plural(s.inputs.length, 'case')} used of ${s.eligibleCases}.${s.exclusions.length ? ` ${s.exclusions.length} excluded.` : ''}`}
                  </Notice>
                  {s.exclusions.length > 0 && (
                    <details className="text-xs text-slate-600">
                      <summary className="cursor-pointer">Why were cases excluded?</summary>
                      <ul className="mt-1 max-h-32 overflow-auto">
                        {s.exclusions.slice(0, 200).map((x) => <li key={x.caseKey}><span className="font-mono">{caseLabel(x.caseKey)}</span> — {REASON[x.reason] ?? x.reason}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </EngineGate>
          )}
          {run?.cmp && run.cmp.status !== 'ok' && <EngineGate result={run.cmp}>{() => null}</EngineGate>}
        </div>
      </Card>
      <div className="min-w-0 space-y-4">
        {selected ? (
          <Card
            title={`Queue scenario r${selected.revision}: ${selected.comparison.baseline.serverCount} → ${selected.comparison.candidate.serverCount} servers${selected.comparison.candidateServiceMultiplier !== 1 ? ` · service ×${selected.comparison.candidateServiceMultiplier}` : ''}`}
            subtitle={`${plural(selected.inputCount, 'case')} · ${selected.exclusions.length} excluded · computed ${fmtInstant(selected.createdAt)}`}
            actions={<Button variant="primary" iconRight="arrowRight" disabled={!!stale} title={stale ?? undefined} onClick={apply}>Send to rollout plan</Button>}
          >
            {stale && <Notice tone="warning" title="Out of date — run again to use it" className="mb-3">{stale}</Notice>}
            <ComparisonView
              b={side(selected.comparison.baseline)}
              c={side(selected.comparison.candidate)}
              serverLabel="Servers"
              staffing={selected.comparison.staffingDelta === null ? 'not assumed' : `${signed(selected.comparison.staffingDelta)} worker(s)`}
            />
          </Card>
        ) : (
          <EmptyState icon="flask" title="No queue scenario yet">Choose the arrival and service steps, set server counts and run both sides.</EmptyState>
        )}
        <ScenarioHistory
          rows={[...list].reverse().map((s) => ({
            id: s.id,
            rev: s.revision,
            created: s.createdAt,
            change: `${s.comparison.baseline.serverCount} → ${s.comparison.candidate.serverCount}${s.comparison.candidateServiceMultiplier !== 1 ? ` · ×${s.comparison.candidateServiceMultiplier}` : ''}`,
            service: s.params.serviceMode === 'observed' ? s.params.serviceActivity : `${s.params.assumedServiceSec} s`,
            n: s.inputCount,
            stale: genericStale(s, ws, scope, provider),
            selected: s.id === selected?.id,
          }))}
          onSelect={setPick}
        />
      </div>
    </div>
  );
}

function ScenarioHistory({ rows, onSelect }: { rows: { id: string; rev: number; created: number; change: string; service: string; n: number; stale: string | null; selected: boolean }[]; onSelect: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <Card title="Saved scenarios" subtitle="Earlier runs are kept; out-of-date runs cannot be sent to a plan.">
      <Table className="max-h-64">
        <thead><tr><Th>Rev</Th><Th>Run</Th><Th>Change</Th><Th>Service</Th><Th align="right">Cases</Th><Th>State</Th><Th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cx(r.selected && 'bg-brand-50/50')}>
              <Td className="font-mono">{r.rev}</Td>
              <Td className="text-xs">{fmtInstant(r.created)}</Td>
              <Td>{r.change}</Td>
              <Td className="text-xs">{r.service}</Td>
              <Td align="right">{r.n}</Td>
              <Td>{r.stale ? <Badge tone="amber" title={r.stale}>out of date</Badge> : <Badge tone="green">current</Badge>}</Td>
              <Td align="right">{r.selected ? <Badge tone="brand">shown</Badge> : <Button size="sm" onClick={() => onSelect(r.id)}>Show</Button>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/* ------------------------------ Value–effort ------------------------------ */

function ValueEffort({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace()!;
  const cands = ws.automation ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const items = useMemo(
    () =>
      cands.map((c) => ({
        id: c.id,
        label: c.activity,
        impact: c.impact,
        difficulty: c.assessment.implementationDifficulty,
        review: c.scoreSnapshot ? c.scoreSnapshot.requiresHumanReview : c.assessment.safetyRisk !== 'low' && c.assessment.safetyRisk !== 'medium',
      })),
    [cands],
  );
  const order: Record<string, number> = { quick_win: 0, major: 1, fill_in: 2, reconsider: 3 };
  const ranked = [...items].sort((a, b) => (order[quadrant(a.impact, a.difficulty) ?? 'z'] ?? 9) - (order[quadrant(b.impact, b.difficulty) ?? 'z'] ?? 9));
  return (
    <Card
      title="Value–effort ranking"
      subtitle="Improvement ideas rated in Implementation (impact and difficulty 1–5, your judgment). Shared with Implementation — rate there."
      actions={<Button size="sm" onClick={() => navigate('implementation')}>Rate ideas in Implementation</Button>}
    >
      {!items.length ? (
        <p className="text-[13px] text-slate-500">No rated ideas yet. Assess activities in Implementation to place them here.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <ImpactMatrix items={items} selected={sel} onSelect={setSel} />
          <ol className="space-y-1">
            {ranked.map((i, k) => {
              const q = quadrant(i.impact, i.difficulty);
              return (
                <li key={i.id} className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px]', sel === i.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200')}>
                  <span className="w-4 text-xs text-slate-400 tabular">{k + 1}</span>
                  <span className="flex-1 truncate">{i.label}</span>
                  {q ? <Badge tone={q === 'quick_win' ? 'green' : q === 'major' ? 'brand' : q === 'reconsider' ? 'amber' : 'neutral'}>{QUADRANT_LABEL[q]}</Badge> : <Badge>not rated</Badge>}
                  {i.review && <Badge tone="red">review</Badge>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

function NextCycle({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3">
      <div className="flex-1 text-[13px] text-slate-600">
        <b className="text-slate-800">Next cycle.</b> After the change is rolled out, load the new event log and compare — or revise the strategy if the modeled effect is too small.
      </div>
      <Button onClick={() => navigate('design')}>Revise strategy</Button>
      <Button onClick={() => navigate('overview')} icon="upload">Load a new log</Button>
      <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('implementation')}>Go to rollout plan</Button>
    </div>
  );
}
