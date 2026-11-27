import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GateInputOptions, GateInputSelection, Metric, QueueResult, TargetEvaluation } from '../contracts';
import { callEngine, type EngineResult } from '../adapters/engineAdapter';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { planFromProposal, planFromScenario } from '../state/plans';
import { QUEUE_WAIT_METRIC_ID, gateScenarioAvailable } from '../festival/adapter';
import { OtherScopesNote } from '../components/WorkspaceHistory';
import type { PageId, ProcessWorkspace, ScenarioRecord } from '../state/types';
import { caseLabel, fmtInstant, fmtMinutes, fmtNumber, fmtValue, plural } from '../lib/format';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, KeyValue, Notice, PageHeader, Select, Stat, Table, Td, Th, cx } from '../components/ui';
import { StatusBadge } from './ModelPage';

export function scenarioStale(s: ScenarioRecord, ws: ProcessWorkspace, scope: ReturnType<typeof useAnalysis>['scope'], provider: string) {
  if (s.paramsRevision !== ws.paramsRevision) return 'Simulation parameters changed after this run.';
  if (isScopeStale(s.scope, scope)) return 'Dataset, process or case filter changed after this run.';
  if (s.provider !== provider) return 'Computed by a different provider.';
  return null;
}

export function RefinePage({ navigate }: { navigate: (p: PageId) => void }) {
  const { scope } = useAnalysis();
  const { state } = useStore();
  const simulation = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);
  return (
    <div>
      <PageHeader
        phase="Phase 6 · Refine & improve"
        title="Refine & Improve"
        subtitle="Evidence-linked recommendations and the computed audience gate scenario. Modeled baseline and candidate are compared on the same arrivals and service demand, kept separate from observed log KPIs."
      />
      <div className="-mt-3 mb-4"><OtherScopesNote navigate={navigate} /></div>
      <RequireData navigate={navigate}>
        <div className="space-y-4">
          {simulation ? <ScenarioSection navigate={navigate} /> : (
            <Notice tone="info" title="No quantified simulation for this process">
              The pooled gate-queue scenario is a Festival case-study model for audience entry and requires Festival adapters to be enabled for the dataset.
              Recommendations below are evidence-based proposals without numeric effect claims.
            </Notice>
          )}
          <Recommendations navigate={navigate} />
        </div>
      </RequireData>
    </div>
  );
}

function ScenarioSection({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const ws = useWorkspace()!;
  const { api, provider, scope, selectedTraces, kpis } = useAnalysis();
  const [lastRun, setLastRun] = useState<{ gate: EngineResult<GateInputSelection>; base?: EngineResult<QueueResult>; cand?: EngineResult<QueueResult> } | null>(null);
  const p = ws.scenarioParams;
  const simDesigns = ws.designs.filter((d) => d.kind === 'simulation');
  const activeDesign = ws.designs.find((d) => d.id === ws.activeDesignId) ?? null;
  const linkedDesign = activeDesign?.kind === 'simulation' ? activeDesign : null;

  const problems: string[] = [];
  if (!p.baselineGates) problems.push('baseline gate count');
  if (!p.candidateGates) problems.push('candidate gate count');
  if (p.serviceMode === 'assumed' && !(p.assumedServiceSec && p.assumedServiceSec > 0)) problems.push('assumed service seconds');

  const run = () => {
    if (problems.length || !scope) return;
    const options: GateInputOptions =
      p.serviceMode === 'observed'
        ? { serviceActivity: p.serviceActivity, mode: 'observed' }
        : { serviceActivity: p.serviceActivity, mode: 'assumed', serviceSec: p.assumedServiceSec! };
    const gate = callEngine(api, 'getGateInputs', selectedTraces, options);
    if (gate.status !== 'ok') return setLastRun({ gate });
    if (!gate.data.inputs.length) return setLastRun({ gate });
    const base = callEngine(api, 'simulateGateQueue', gate.data.inputs, p.baselineGates!);
    const cand = callEngine(api, 'simulateGateQueue', gate.data.inputs, p.candidateGates!);
    setLastRun({ gate, base, cand });
    if (base.status !== 'ok' || cand.status !== 'ok') return;
    const scenario: ScenarioRecord = {
      id: uid('scn'),
      revision: ws.scenarios.length + 1,
      designId: linkedDesign?.id ?? null,
      scope,
      paramsRevision: ws.paramsRevision,
      params: { ...p },
      inputCount: gate.data.inputs.length,
      eligibleCases: gate.data.eligibleCases,
      excludedCases: gate.data.exclusions.length,
      baseline: base.data,
      candidate: cand.data,
      createdAt: Date.now(),
      provider,
    };
    dispatch({ type: 'ADD_SCENARIO', scenario });
    dispatch({ type: 'TOAST', tone: 'success', message: `Scenario revision ${scenario.revision} computed.` });
  };

  const selected = ws.scenarios.find((s) => s.id === ws.selectedScenarioId) ?? null;
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
    const currents = ws.plans.filter((pl) => pl.state === 'current');
    if (currents.length && !confirm(`Create a new plan revision from scenario rev ${selected.revision}? ${plural(currents.length, 'current plan')} will be archived (kept for export, not deleted).`)) return;
    const design = ws.designs.find((d) => d.id === selected.designId) ?? null;
    const target = design?.targetMetricId ? ws.targets.find((t) => t.metricId === design.targetMetricId) : undefined;
    const plan = planFromScenario(selected, design, target, ws.plans.length + 1);
    dispatch({ type: 'ADD_PLAN', plan, archiveOthers: true });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Editable plan created in Implementation.' });
    navigate('implementation');
  };

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card
          title="Gate queue scenario"
          subtitle="Pooled FCFS station · identical gates · one qualified worker per gate (assumption). Parameters are edited in Model."
          actions={
            <>
              <Button size="sm" onClick={() => navigate('model')}>Edit parameters</Button>
              <Button size="sm" variant="primary" disabled={problems.length > 0} onClick={run}>Run baseline + candidate</Button>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <KeyValue
              items={[
                ['Service station', p.serviceActivity],
                ['Service demand', p.serviceMode === 'observed' ? 'Observed matched intervals' : `Assumed ${fmtNumber(p.assumedServiceSec)} s / entrant`],
                ['Baseline gates', p.baselineGates ?? <span className="text-red-600">not set</span>],
                ['Candidate gates', p.candidateGates ?? <span className="text-red-600">not set</span>],
                ['Parameter revision', ws.paramsRevision],
              ]}
            />
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Linked design record</div>
              {simDesigns.length ? (
                <Select value={linkedDesign?.id ?? ''} onChange={(e) => dispatch({ type: 'SET_ACTIVE_DESIGN', id: e.target.value || null })}>
                  <option value="">— none —</option>
                  {simDesigns.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </Select>
              ) : (
                <p className="text-sm text-slate-500">No simulation-linked design yet. <button className="text-brand-600 hover:underline" onClick={() => navigate('design')}>Create one in Design</button>.</p>
              )}
            </div>
          </div>
          {problems.length > 0 && <div className="mt-3"><Notice tone="warning">Set the {problems.join(', ')} in Model before running.</Notice></div>}
          {lastRun && <RunMessages run={lastRun} />}
        </Card>
        <Card title="Observed log KPIs" subtitle="Measured from the event log, not simulated. Shown separately on purpose.">
          <EngineGate result={kpis}>
            {(ms) => (ms.length ? (
              <ul className="space-y-1.5 text-sm">
                {ms.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-xs text-slate-600" title={m.definition}>{m.id}</span>
                    <span className="tabular font-medium">{fmtValue(m.value, m.unit)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">No KPIs returned.</p>)}
          </EngineGate>
        </Card>
      </div>

      {selected ? (
        <ScenarioResult scenario={selected} staleReason={staleReason} onApply={apply} />
      ) : (
        <EmptyState title="No scenario computed yet" icon="↻">Set baseline and candidate gate counts in Model, then run both modeled sides here.</EmptyState>
      )}

      {ws.scenarios.length > 0 && (
        <Card title="Scenario revisions" subtitle="Older revisions are kept for traceability; stale ones cannot be applied.">
          <Table>
            <thead>
              <tr><Th>Rev</Th><Th>Created</Th><Th>Gates</Th><Th>Service</Th><Th align="right">Entrants</Th><Th>State</Th><Th /></tr>
            </thead>
            <tbody>
              {[...ws.scenarios].reverse().map((s) => {
                const reason = scenarioStale(s, ws, scope, provider);
                return (
                  <tr key={s.id} className={cx(s.id === ws.selectedScenarioId && 'bg-brand-50/60')}>
                    <Td className="font-mono">{s.revision}</Td>
                    <Td className="text-xs">{fmtInstant(s.createdAt)}</Td>
                    <Td>{s.baseline.gateCount} → {s.candidate.gateCount}</Td>
                    <Td className="text-xs">{s.params.serviceMode === 'observed' ? 'observed' : `${s.params.assumedServiceSec} s`}</Td>
                    <Td align="right">{s.inputCount}</Td>
                    <Td>{reason ? <Badge tone="amber" title={reason}>stale</Badge> : <Badge tone="green">current</Badge>}{s.provider === 'ui_fixture' && <> <Badge tone="amber">fixture</Badge></>}</Td>
                    <Td align="right">
                      {s.id === ws.selectedScenarioId ? <Badge tone="brand">selected</Badge> : <Button size="sm" onClick={() => dispatch({ type: 'SELECT_SCENARIO', id: s.id })}>Select</Button>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      {provider === 'ui_fixture' && (
        <Notice tone="fixture">UI fixture: queue results exist only for 4-second service (T09 hand calculation). Other inputs show "no fixture value".</Notice>
      )}
    </>
  );
}

function RunMessages({ run }: { run: { gate: EngineResult<GateInputSelection>; base?: EngineResult<QueueResult>; cand?: EngineResult<QueueResult> } }) {
  return (
    <div className="mt-3 space-y-2">
      <EngineGate result={run.gate}>
        {(g) => (
          <>
            {g.inputs.length === 0 ? (
              <Notice tone="error" title="No usable arrivals">
                All {g.eligibleCases} eligible cases were excluded, so there is nothing to simulate.
              </Notice>
            ) : (
              <Notice tone={g.exclusions.length ? 'warning' : 'success'}>
                {plural(g.inputs.length, 'entrant')} simulated of {g.eligibleCases} eligible cases.
                {g.exclusions.length > 0 && ` ${g.exclusions.length} excluded.`}
              </Notice>
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

function ScenarioResult({ scenario, staleReason, onApply }: { scenario: ScenarioRecord; staleReason: string | null; onApply: () => void }) {
  const ws = useWorkspace()!;
  const { api } = useAnalysis();
  const { baseline: b, candidate: c } = scenario;
  const design = ws.designs.find((d) => d.id === scenario.designId);
  const target = design?.targetMetricId ? ws.targets.find((t) => t.metricId === design.targetMetricId) : undefined;

  // Target check: only the observed queue-wait KPI is comparable with the modeled mean wait.
  let check: { base: TargetEvaluation['status']; cand: TargetEvaluation['status'] } | { message: string } | null = null;
  if (target) {
    if (target.metricId !== QUEUE_WAIT_METRIC_ID) check = { message: `Target check compares modeled mean wait with ${QUEUE_WAIT_METRIC_ID} only; this design targets ${target.metricId}.` };
    else if (target.unit !== 'min') check = { message: `Target ${target.metricId} uses unit "${target.unit}", not comparable with a modeled wait in minutes.` };
    else {
      const asMetric = (q: QueueResult): Metric => ({
        id: target.metricId, value: q.meanWaitMin, unit: 'min', n: q.count, eligible: q.count,
        definition: 'Modeled mean wait (simulation, not observed)', caseKeys: [],
      });
      const rb = callEngine(api, 'evaluateTargets', [asMetric(b)], [target]);
      const rc = callEngine(api, 'evaluateTargets', [asMetric(c)], [target]);
      check = rb.status === 'ok' && rc.status === 'ok' ? { base: rb.data[0]!.status, cand: rc.data[0]!.status } : { message: rb.status !== 'ok' ? rb.message : (rc as { message: string }).message };
    }
  }

  const rows: { label: string; b: string; c: string; delta: string }[] = [
    { label: 'Gates (staffed)', b: String(b.gateCount), c: String(c.gateCount), delta: signed(c.gateCount - b.gateCount) },
    { label: 'Qualified gate workers (1 per gate)', b: String(b.gateCount), c: String(c.gateCount), delta: signed(c.gateCount - b.gateCount) },
    { label: 'Mean wait', b: fmtMinutes(b.meanWaitMin), c: fmtMinutes(c.meanWaitMin), delta: deltaMin(c.meanWaitMin - b.meanWaitMin) },
    { label: 'p95 wait (nearest rank)', b: fmtMinutes(b.p95WaitMin), c: fmtMinutes(c.p95WaitMin), delta: deltaMin(c.p95WaitMin - b.p95WaitMin) },
    { label: 'Max wait', b: fmtMinutes(b.maxWaitMin), c: fmtMinutes(c.maxWaitMin), delta: deltaMin(c.maxWaitMin - b.maxWaitMin) },
    { label: 'Finish elapsed from first arrival', b: fmtMinutes(b.finishElapsedMin), c: fmtMinutes(c.finishElapsedMin), delta: deltaMin(c.finishElapsedMin - b.finishElapsedMin) },
    {
      label: 'Throughput',
      b: b.throughputPerHour === null ? 'N/A' : `${fmtNumber(b.throughputPerHour, 1)} /h`,
      c: c.throughputPerHour === null ? 'N/A' : `${fmtNumber(c.throughputPerHour, 1)} /h`,
      delta: b.throughputPerHour === null || c.throughputPerHour === null ? '—' : signed(+(c.throughputPerHour - b.throughputPerHour).toFixed(1)),
    },
  ];
  const chart = [
    { name: 'Mean wait', baseline: b.meanWaitMin, candidate: c.meanWaitMin },
    { name: 'p95 wait', baseline: b.p95WaitMin, candidate: c.p95WaitMin },
    { name: 'Max wait', baseline: b.maxWaitMin, candidate: c.maxWaitMin },
  ];

  return (
    <Card
      title={`Scenario revision ${scenario.revision}: ${b.gateCount} → ${c.gateCount} gates`}
      subtitle={`${plural(scenario.inputCount, 'entrant')} · same arrival + service vector on both sides · ${scenario.excludedCases} excluded · computed ${fmtInstant(scenario.createdAt)}`}
      actions={
        <Button variant="primary" disabled={!!staleReason} onClick={onApply} title={staleReason ?? undefined}>
          Apply to Implementation plan →
        </Button>
      }
    >
      {staleReason && <div className="mb-3"><Notice tone="warning" title="Stale result — cannot be applied">{staleReason} Run the scenario again to create a new revision.</Notice></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Modeled mean wait · baseline" value={fmtMinutes(b.meanWaitMin)} badge={<Badge tone="violet">modeled</Badge>} />
        <Stat label="Modeled mean wait · candidate" value={fmtMinutes(c.meanWaitMin)} badge={<Badge tone="violet">modeled</Badge>} sub={deltaMin(c.meanWaitMin - b.meanWaitMin)} />
        <Stat label="Staffing delta (assumption)" value={signed(c.gateCount - b.gateCount)} sub="qualified gate workers" />
        <Stat
          label={target ? `Target ${target.direction === 'max' ? '≤' : '≥'} ${fmtValue(target.value, target.unit)}` : 'Target check'}
          value={check && 'base' in check ? <span className="flex gap-2 text-base"><StatusBadge status={check.base} /> → <StatusBadge status={check.cand} /></span> : '—'}
          sub={!target ? (design ? 'No target saved for the design KPI' : 'Link a design with a target KPI') : check && 'message' in check ? check.message : 'baseline → candidate (modeled mean wait)'}
          tone={!target ? 'muted' : 'default'}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Table>
          <thead><tr><Th>Modeled measure</Th><Th align="right">Baseline</Th><Th align="right">Candidate</Th><Th align="right">Δ</Th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.label}><Td>{r.label}</Td><Td align="right">{r.b}</Td><Td align="right">{r.c}</Td><Td align="right" className="text-slate-500">{r.delta}</Td></tr>)}
          </tbody>
        </Table>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: -8, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtMinutes(v)} width={64} />
              <Tooltip formatter={(v) => fmtMinutes(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="baseline" name={`Baseline (${b.gateCount})`} fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="candidate" name={`Candidate (${c.gateCount})`} fill="#4f46e5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Modeled comparison under stated assumptions; not a measured field result and not a claim of deployment. Observed queue wait is reported separately in the observed KPI panel.
      </p>
    </Card>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const deltaMin = (d: number) => (d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${fmtMinutes(Math.abs(d))}`);

function Recommendations({ navigate }: { navigate: (p: PageId) => void }) {
  const { findings, scope, provider } = useAnalysis();
  const { dispatch } = useStore();
  const ws = useWorkspace()!;
  const createProposalPlan = (designId: string) => {
    const design = ws.designs.find((d) => d.id === designId);
    if (!design || !scope) return;
    dispatch({ type: 'ADD_PLAN', plan: planFromProposal(design, scope, ws.plans.length + 1, provider), archiveOthers: false });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Proposal-only plan created.' });
    navigate('implementation');
  };
  return (
    <Card title="Evidence-linked recommendations" subtitle="From engine findings and saved design records. No numeric benefit is claimed without a simulation.">
      <EngineGate result={findings}>
        {(fs) => (
          <div className="space-y-2">
            {fs.length === 0 && <p className="text-sm text-slate-500">No findings for this scope.</p>}
            {fs.map((f) => {
              const designs = ws.designs.filter((d) => d.findingIds.includes(f.id));
              return (
                <div key={f.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800">{f.proposal}</div>
                      <div className="mt-0.5 text-xs text-slate-500">Evidence: {f.text} <code className="font-mono">({f.id})</code></div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {designs.length === 0 && <Button size="sm" onClick={() => navigate('analysis')}>Create design from finding</Button>}
                      {designs.map((d) => (
                        <Button key={d.id} size="sm" onClick={() => createProposalPlan(d.id)} title={d.title}>
                          Proposal-only plan from “{d.title.slice(0, 24)}{d.title.length > 24 ? '…' : ''}”
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </EngineGate>
    </Card>
  );
}
