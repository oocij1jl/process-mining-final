import { useEffect, useState } from 'react';
import type { Metric, Target, TargetEvaluation } from '../contracts';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { useStore, useWorkspace, useWorkspaceKey } from '../state/store';
import { gateScenarioAvailable } from '../festival/adapter';
import type { PageId, ScenarioParams } from '../state/types';
import { fmtValue, plural } from '../lib/format';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, Field, Input, Notice, PageHeader, Select, Table, Td, Th } from '../components/ui';

/**
 * Validates a target in the metric's own unit (engine convention): `%` is 0–100,
 * `min`, `cases` and `cases/bucket` are non-negative. No scale conversion.
 */
export function validateTarget(value: string, unit: string): { value?: number; error?: string } {
  if (value.trim() === '') return { error: 'Enter a number.' };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: 'Must be a finite number.' };
  if (unit === '%' && (n < 0 || n > 100)) return { error: 'Percent targets use 0–100.' };
  if ((unit === 'min' || unit === 'cases' || unit === 'cases/bucket') && n < 0) return { error: 'Must be ≥ 0.' };
  return { value: n };
}

export function StatusBadge({ status }: { status: TargetEvaluation['status'] | undefined }) {
  if (!status) return <Badge>no target</Badge>;
  return <Badge tone={status === 'met' ? 'green' : status === 'breached' ? 'red' : 'neutral'}>{status}</Badge>;
}

export function ModelPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div>
      <PageHeader
        phase="Phase 3 · Process model"
        title="Model"
        subtitle="Set KPI targets (feeds Monitor immediately) and the simulation parameters used by Refine. Targets never change measured values."
      />
      <RequireData navigate={navigate}>
        <div className="space-y-4">
          <TargetsCard navigate={navigate} />
          <ScenarioParamsCard navigate={navigate} />
        </div>
      </RequireData>
    </div>
  );
}

function TargetsCard({ navigate }: { navigate: (p: PageId) => void }) {
  const { kpis, evaluations, provider } = useAnalysis();
  const { state, dispatch } = useStore();
  const ws = useWorkspace();
  const currentKey = useWorkspaceKey();
  const targets = ws?.targets ?? [];
  // Targets saved under another case filter of the same dataset, provider and process (copy is explicit).
  const otherScopes = Object.entries(state.workspaces).filter(
    ([k, w]) =>
      k !== currentKey && !w.meta.legacy && w.targets.length > 0 && w.meta.provider === provider &&
      w.meta.scope.datasetId === ws?.meta.scope.datasetId && w.meta.scope.processKey === ws?.meta.scope.processKey,
  );
  const evalById = new Map((evaluations?.status === 'ok' ? evaluations.data : []).map((e) => [e.metricId, e.status]));
  return (
    <Card
      title="KPI targets"
      subtitle="Saved per dataset + process. Direction max = measured ≤ target; min = measured ≥ target. Unit is fixed to the metric's unit."
      actions={<Button size="sm" onClick={() => navigate('monitor')}>View in Monitor →</Button>}
    >
      <EngineGate result={kpis}>
        {(metrics) => {
          const orphans = targets.filter((t) => !metrics.some((m) => m.id === t.metricId));
          if (!metrics.length && !orphans.length) return <EmptyState title="No KPIs from the engine">getKPIs returned no metrics for this process.</EmptyState>;
          return (
            <>
              {targets.length === 0 && otherScopes.length > 0 && (
                <div className="mb-3">
                  <Notice tone="info" title="Targets exist for another case filter">
                    Targets are saved per analysis scope (dataset + process + case filter). You can copy them into this scope explicitly:
                    <div className="mt-2 flex flex-wrap gap-2">
                      {otherScopes.map(([k, w]) => (
                        <Button key={k} size="sm" onClick={() => dispatch({ type: 'COPY_TARGETS', fromKey: k })}>
                          Copy {plural(w.targets.length, 'target')} from filter {w.meta.filter.dateFrom || w.meta.filter.dateTo ? `${w.meta.filter.dateFrom || '…'} → ${w.meta.filter.dateTo || '…'}` : '(all cases)'}
                        </Button>
                      ))}
                    </div>
                  </Notice>
                </div>
              )}
              {evaluations && evaluations.status !== 'ok' && (
                <div className="mb-3"><EngineGate result={evaluations}>{() => null}</EngineGate></div>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    <Th align="right">Measured (log)</Th>
                    <Th align="right">n / eligible</Th>
                    <Th>Direction</Th>
                    <Th>Target</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <TargetRow key={m.id} metric={m} target={targets.find((t) => t.metricId === m.id)} status={evalById.get(m.id)} />
                  ))}
                  {orphans.map((t) => (
                    <TargetRow key={t.metricId} metric={null} target={t} status={evalById.get(t.metricId)} />
                  ))}
                </tbody>
              </Table>
            </>
          );
        }}
      </EngineGate>
    </Card>
  );
}

function TargetRow({ metric, target, status }: { metric: Metric | null; target?: Target; status?: TargetEvaluation['status'] }) {
  const { dispatch } = useStore();
  const unit = metric?.unit ?? target?.unit ?? '';
  const [text, setText] = useState(target ? String(target.value) : '');
  const [direction, setDirection] = useState<Target['direction']>(target?.direction ?? 'max');
  // Re-sync from the store only when the saved value differs (keeps partial input like "5.").
  useEffect(() => {
    setText((t) => (target ? (Number(t) === target.value && t.trim() !== '' ? t : String(target.value)) : validateTarget(t, unit).value === undefined ? t : ''));
    setDirection(target?.direction ?? 'max');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const check = text === '' ? {} : validateTarget(text, unit);
  const id = metric?.id ?? target!.metricId;

  const commit = (nextText: string, nextDir: Target['direction']) => {
    if (nextText.trim() === '') {
      if (target) dispatch({ type: 'REMOVE_TARGET', metricId: id });
      return;
    }
    const v = validateTarget(nextText, unit);
    if (v.value === undefined) return; // invalid inputs are blocked, never saved
    dispatch({ type: 'SET_TARGET', target: { metricId: id, value: v.value, unit, direction: nextDir } });
  };

  return (
    <tr>
      <Td>
        <div className="font-mono text-xs font-medium text-slate-800">{id}</div>
        <div className="text-xs text-slate-500">{metric?.definition ?? 'Metric not returned for the current scope.'}</div>
        {metric?.reason && <div className="text-xs text-amber-700">{metric.reason}</div>}
      </Td>
      <Td align="right">{metric ? fmtValue(metric.value, metric.unit) : 'N/A'}</Td>
      <Td align="right">{metric ? `${metric.n} / ${metric.eligible}` : '—'}</Td>
      <Td>
        <Select
          className="!w-24 !py-1 text-xs"
          value={direction}
          onChange={(e) => {
            const d = e.target.value as Target['direction'];
            setDirection(d);
            commit(text, d);
          }}
        >
          <option value="max">≤ max</option>
          <option value="min">≥ min</option>
        </Select>
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <Input
            className="!w-28 !py-1 text-xs"
            inputMode="decimal"
            value={text}
            invalid={!!check.error}
            placeholder="no target"
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value, direction);
            }}
            aria-label={`Target for ${id}`}
          />
          <span className="text-xs text-slate-500">{unit}</span>
        </div>
        {check.error && <div className="mt-0.5 text-[11px] text-red-600">{check.error}</div>}
      </Td>
      <Td><StatusBadge status={target ? status : undefined} /></Td>
      <Td>
        {target && (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'REMOVE_TARGET', metricId: id })}>
            Clear
          </Button>
        )}
      </Td>
    </tr>
  );
}

function intOrNull(s: string): number | null | 'invalid' {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 'invalid';
}

function ScenarioParamsCard({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const ws = useWorkspace();
  const { scope, performance } = useAnalysis();
  const p = ws!.scenarioParams;
  const [baseline, setBaseline] = useState(p.baselineGates?.toString() ?? '');
  const [candidate, setCandidate] = useState(p.candidateGates?.toString() ?? '');
  const [sec, setSec] = useState(p.assumedServiceSec?.toString() ?? '');
  // Re-sync from the store only when the saved value differs from the typed text.
  const sync = (saved: number | null) => (t: string) => {
    const typed = t.trim() === '' ? null : Number(t);
    return typed === saved || (typed !== null && !Number.isFinite(typed)) || (saved === null && typed !== null && !(typed > 0)) ? t : saved?.toString() ?? '';
  };
  useEffect(() => setBaseline(sync(p.baselineGates)), [p.baselineGates]);
  useEffect(() => setCandidate(sync(p.candidateGates)), [p.candidateGates]);
  useEffect(() => setSec(sync(p.assumedServiceSec)), [p.assumedServiceSec]);

  const isAudience = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);
  const update = (params: Partial<ScenarioParams>) => dispatch({ type: 'SET_SCENARIO_PARAMS', params });
  const serviceActivities =
    performance?.status === 'ok' ? [...new Set(performance.data.gaps.filter((g) => g.metricType === 'service').map((g) => g.from))] : [];
  const b = intOrNull(baseline);
  const c = intOrNull(candidate);
  const s = sec.trim() === '' ? null : Number(sec);
  const secInvalid = s !== null && !(Number.isFinite(s) && s > 0);
  const manifestGates = state.dataset?.metadata?.baselineGateCount;
  const latest = ws?.scenarios.at(-1);
  const latestStale = latest && (latest.paramsRevision !== ws!.paramsRevision || isScopeStale(latest.scope, scope));

  if (!isAudience) {
    return (
      <Card title="Simulation parameters">
        <Notice tone="info">
          The quantified scenario (pooled FCFS gate queue) is a Festival case-study model for the <b>audience</b> entry process and needs Festival adapters enabled for the dataset.
          For this process, use proposal-only design records and plans — no numeric improvement is claimed without a simulation.
        </Notice>
      </Card>
    );
  }

  return (
    <Card
      title="Simulation parameters · audience gate queue"
      subtitle="One pooled FCFS service station with identical staffed gates and one qualified worker per gate (assumption). Both sides use the same arrival and service vector."
      actions={<Button size="sm" onClick={() => navigate('refine')}>Run in Refine →</Button>}
    >
      {latest && (
        <div className="mb-3">
          {latestStale ? (
            <Notice tone="warning">Parameters changed since the last run (revision {latest.paramsRevision} → {ws!.paramsRevision}). Existing results are stale and cannot be applied until you re-run.</Notice>
          ) : (
            <Notice tone="success">The latest scenario result matches these parameters.</Notice>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Service station activity" hint="Arrival = Join Entry Queue. Service = this activity's matched start→complete.">
          <Select value={p.serviceActivity} onChange={(e) => update({ serviceActivity: e.target.value })}>
            {[...new Set([p.serviceActivity, ...serviceActivities])].map((a) => <option key={a}>{a}</option>)}
          </Select>
        </Field>
        <Field label="Service demand" hint={p.serviceMode === 'observed' ? 'Cases without a positive matched interval are excluded and reported.' : 'The same explicit seconds apply to every valid arrival.'}>
          <Select value={p.serviceMode} onChange={(e) => update({ serviceMode: e.target.value as ScenarioParams['serviceMode'] })}>
            <option value="observed">Observed matched service</option>
            <option value="assumed">Assumed seconds per entrant</option>
          </Select>
        </Field>
        <Field label="Assumed service (seconds)" error={secInvalid ? 'Must be a positive number.' : p.serviceMode === 'assumed' && s === null ? 'Required in assumed mode.' : null}>
          <Input
            disabled={p.serviceMode !== 'assumed'}
            value={sec}
            invalid={secInvalid}
            inputMode="decimal"
            onChange={(e) => {
              setSec(e.target.value);
              const v = e.target.value.trim() === '' ? null : Number(e.target.value);
              if (v === null || (Number.isFinite(v) && v > 0)) update({ assumedServiceSec: v });
            }}
          />
        </Field>
        <div />
        <Field
          label="Baseline gates"
          hint={manifestGates !== undefined ? `Manifest value: ${manifestGates}` : 'User input. Never inferred from distinct gate IDs.'}
          error={b === 'invalid' ? 'Integer from 1 to 500.' : b === null ? 'Required.' : null}
        >
          <Input
            value={baseline}
            invalid={b === 'invalid'}
            inputMode="numeric"
            onChange={(e) => {
              setBaseline(e.target.value);
              const v = intOrNull(e.target.value);
              if (v !== 'invalid') update({ baselineGates: v });
            }}
          />
        </Field>
        <Field label="Candidate gates" error={c === 'invalid' ? 'Integer from 1 to 500.' : c === null ? 'Required.' : null}>
          <Input
            value={candidate}
            invalid={c === 'invalid'}
            inputMode="numeric"
            onChange={(e) => {
              setCandidate(e.target.value);
              const v = intOrNull(e.target.value);
              if (v !== 'invalid') update({ candidateGates: v });
            }}
          />
        </Field>
        <Field label="Staffing delta (assumption)">
          <div className="py-1.5 text-sm font-medium tabular">
            {typeof b === 'number' && typeof c === 'number' ? `${c - b >= 0 ? '+' : ''}${c - b} gate(s) · ${c - b >= 0 ? '+' : ''}${c - b} qualified worker(s)` : '—'}
          </div>
        </Field>
        <Field label="Parameter revision">
          <div className="py-1.5 font-mono text-sm">{ws!.paramsRevision}</div>
        </Field>
      </div>
    </Card>
  );
}
