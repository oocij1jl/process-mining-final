/**
 * Monitor & Control — KPIs from the loaded historical log against saved
 * targets, with evidence cases, historical trends, completion throughput and
 * transition drift. Not live monitoring; no control limits or deadline
 * prediction are shown (not part of this release).
 */
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metric, Target, TargetEvaluation, ThroughputBucket } from '../contracts';
import type { EventWindow, TransitionDriftRow } from '../v03-contracts';
import { callEngine } from '../adapters/engineAdapter';
import { targetBreachFinding } from '../lib/evidence';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import type { PageId } from '../state/types';
import { fmtInstant, fmtMinutes, fmtNumber, fmtTime, fmtValue, plural } from '../lib/format';
import { kpiName, kpiQuestion } from '../lib/kpiCatalog';
import { THROUGHPUT_METRIC_ID } from '../festival/adapter';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, Field, InfoTip, Input, Notice, PageHeader, Segmented, Select, Table, Tabs, Td, Th, cx } from '../components/ui';
import { CaseList, CaseTimeline } from './analysis/inspector';

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
  return <Badge tone={status === 'met' ? 'green' : status === 'breached' ? 'red' : 'neutral'}>{status === 'met' ? 'on target' : status === 'breached' ? 'off target' : 'unknown'}</Badge>;
}

type Drill = { title: string; subtitle?: string; caseKeys: string[] };

export function MonitorPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div>
      <PageHeader
        phase="5 · Monitor & Control"
        title="Targets, trends and change"
        subtitle="KPIs measured from the loaded historical log, compared with your targets. Updates instantly when targets or the case scope change. This is not live monitoring."
        actions={<Button variant="primary" iconRight="arrowRight" onClick={() => navigate('refine')}>Plan the next improvement</Button>}
      />
      <RequireData navigate={navigate}>
        <Content navigate={navigate} />
      </RequireData>
    </div>
  );
}

function Content({ navigate }: { navigate: (p: PageId) => void }) {
  const { kpis, evaluations, findings } = useAnalysis();
  const ws = useWorkspace()!;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'trend' | 'throughput' | 'drift'>('trend');
  const evalMap = new Map((evaluations?.status === 'ok' ? evaluations.data : []).map((e) => [e.metricId, e.status]));
  const fs = findings?.status === 'ok' ? findings.data : undefined;
  const open = (d: Drill) => {
    setDrill(d);
    setCaseKey(null);
  };

  return (
    <div className="space-y-5">
      <EngineGate result={kpis}>
        {(metrics) => {
          if (!metrics.length) return <EmptyState title="No KPIs for this process">The engine returned no metrics for this process and scope.</EmptyState>;
          const breached = ws.targets.filter((t) => evalMap.get(t.metricId) === 'breached').length;
          const met = ws.targets.filter((t) => evalMap.get(t.metricId) === 'met').length;
          return (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-semibold text-slate-800">KPIs</span>
                  <span className="text-slate-500">{plural(metrics.length, 'measure')} · {plural(ws.targets.length, 'target')}</span>
                  {breached > 0 && <Badge tone="red">{breached} off target</Badge>}
                  {met > 0 && <Badge tone="green">{met} on target</Badge>}
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {metrics.map((m) => (
                    <KpiCard key={m.id} metric={m} target={ws.targets.find((t) => t.metricId === m.id)} status={evalMap.get(m.id)} onDrill={(keys, title) => open({ title, subtitle: m.definition, caseKeys: keys })} findings={fs} />
                  ))}
                </div>
                {ws.targets.filter((t) => !metrics.some((m) => m.id === t.metricId)).map((t) => (
                  <Notice key={t.metricId} tone="neutral">Target for {kpiName(t.metricId)} is saved, but this KPI is not measured in the current scope (status unknown).</Notice>
                ))}
              </div>
              <aside className="space-y-3">
                <Card title="Evidence" subtitle="The cases behind a KPI or a chart bar" className="xl:sticky xl:top-16">
                  {caseKey ? (
                    <CaseTimeline caseKey={caseKey} onBack={() => setCaseKey(null)} backLabel="Back to the list" />
                  ) : drill ? (
                    <div className="space-y-2">
                      <div className="text-[13.5px] font-semibold text-slate-800">{drill.title}</div>
                      {drill.subtitle && <p className="text-[12px] text-slate-500">{drill.subtitle}</p>}
                      <CaseList caseKeys={drill.caseKeys} onPick={setCaseKey} />
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-500">Click “show cases” on a KPI, or a bar in a chart below.</p>
                  )}
                </Card>
              </aside>
            </div>
          );
        }}
      </EngineGate>

      <Card bodyClassName="pt-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'trend', label: 'Historical trend', icon: 'pulse' },
            { id: 'throughput', label: 'Throughput', icon: 'gauge' },
            { id: 'drift', label: 'Transition drift', icon: 'compare' },
          ]}
        />
        {tab === 'trend' && <TrendPanel onDrill={open} />}
        {tab === 'throughput' && <ThroughputPanel onDrill={open} />}
        {tab === 'drift' && <DriftPanel onDrill={open} />}
      </Card>

      <PlanStatus navigate={navigate} />
      <p className="text-xs text-slate-500">Statistical control limits and deadline-risk prediction are not part of this release; targets are your own thresholds, not industry standards.</p>
    </div>
  );
}

/* ------------------------------ KPI card ------------------------------ */

function KpiCard({ metric: m, target, status, onDrill, findings }: { metric: Metric; target?: Target; status?: TargetEvaluation['status']; onDrill: (keys: string[], title: string) => void; findings?: Parameters<typeof targetBreachFinding>[0] }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(target ? String(target.value) : '');
  const [dir, setDir] = useState<Target['direction']>(target?.direction ?? 'max');
  useEffect(() => {
    setText(target ? String(target.value) : '');
    setDir(target?.direction ?? 'max');
  }, [target]);
  const check = text ? validateTarget(text, m.unit) : {};
  const save = () => {
    if (!text.trim()) {
      if (target) dispatch({ type: 'REMOVE_TARGET', metricId: m.id });
      setEditing(false);
      return;
    }
    if (check.value === undefined) return;
    dispatch({ type: 'SET_TARGET', target: { metricId: m.id, value: check.value, unit: m.unit, direction: dir, ...(m.definitionKey ? { definitionKey: m.definitionKey } : {}) } });
    setEditing(false);
  };
  const breach = target && status === 'breached' ? targetBreachFinding(findings, target) : undefined;
  const directional = target && m.problemCaseKeys ? m.problemCaseKeys[target.direction] : undefined;
  const problemKeys = breach?.evidenceKind === 'unavailable' ? null : breach ? breach.caseKeys : directional ?? null;
  const question = kpiQuestion(m.id);
  return (
    <div className={cx('flex flex-col rounded-xl border bg-white px-4 py-3', status === 'breached' ? 'border-red-200' : status === 'met' ? 'border-emerald-200' : 'border-slate-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-800">{kpiName(m.id)}</div>
          {question && <div className="text-[11.5px] leading-snug text-slate-500">{question}</div>}
        </div>
        <StatusBadge status={target ? status : undefined} />
      </div>
      <div className={cx('mt-2 text-[24px] font-semibold tracking-tight tabular', m.value === null ? 'text-slate-400' : 'text-slate-900')}>{fmtValue(m.value, m.unit)}</div>
      <div className="text-[11.5px] text-slate-500 tabular">
        n = {m.n} of {m.eligible}
        {target && <> · target {target.direction === 'max' ? '≤' : '≥'} {fmtValue(target.value, target.unit)}</>}
      </div>
      {m.reason && <div className="mt-1 text-[11.5px] text-amber-700">{m.reason}</div>}
      {editing ? (
        <div className="mt-2 flex items-start gap-1.5">
          <Select className="!w-auto !py-1 text-xs" value={dir} onChange={(e) => setDir(e.target.value as Target['direction'])} aria-label="Direction">
            <option value="max">≤ at most</option>
            <option value="min">≥ at least</option>
          </Select>
          <div className="flex-1">
            <Input className="!py-1 text-xs" inputMode="decimal" value={text} invalid={!!check.error} onChange={(e) => setText(e.target.value)} placeholder={`value in ${m.unit}`} aria-label={`Target for ${kpiName(m.id)}`} />
            {check.error && <div className="mt-0.5 text-[11px] text-red-600">{check.error}</div>}
          </div>
          <Button size="sm" variant="primary" onClick={save} disabled={!!check.error}>Save</Button>
        </div>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs">
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setEditing(true)}>{target ? 'Edit target' : 'Set target'}</button>
          {target && <button type="button" className="text-slate-500 hover:underline" onClick={() => dispatch({ type: 'REMOVE_TARGET', metricId: m.id })}>Remove</button>}
          {status === 'breached' && problemKeys && problemKeys.length > 0 && (
            <button type="button" className="font-medium text-red-700 hover:underline" onClick={() => onDrill(problemKeys, `${kpiName(m.id)} · cases off target`)}>
              {plural(problemKeys.length, 'problem case')} →
            </button>
          )}
          {m.caseKeys.length > 0 && (
            <button type="button" className="text-slate-600 hover:underline" onClick={() => onDrill(m.caseKeys, `${kpiName(m.id)} · contributing cases`)}>
              show cases ({m.caseKeys.length})
            </button>
          )}
          <InfoTip label="Definition">{m.definition}{status === 'breached' && !problemKeys ? ' This is an aggregate target; no individual case is singled out.' : ''}</InfoTip>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Trends ------------------------------ */

const BUCKETS = [
  { id: 15, label: '15 min' },
  { id: 60, label: '1 hour' },
  { id: 360, label: '6 hours' },
  { id: 1440, label: '1 day' },
  { id: 10080, label: '1 week' },
];

function TrendPanel({ onDrill }: { onDrill: (d: Drill) => void }) {
  const { api, selectedTraces } = useAnalysis();
  const [bucket, setBucket] = useState(60);
  const result = useMemo(() => callEngine(api, 'getHistoricalTrends', selectedTraces, { bucketMinutes: bucket, anchorMs: 0 }), [api, selectedTraces, bucket]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[12.5px] text-slate-500">Cases are placed in the time bucket of their <b>first</b> recorded event. Average span is first→last recorded event (not a confirmed completion). Empty buckets show no value, not zero.</p>
        <BucketPicker value={bucket} onChange={setBucket} />
      </div>
      <EngineGate result={result}>
        {(t) =>
          t.unavailable ? (
            <Notice tone="neutral">{t.unavailable === 'empty_scope' ? 'No cases in the current scope.' : 'Too many buckets for this width. Choose a wider bucket.'}</Notice>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={t.buckets.map((b, i) => ({ ...b, i }))} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="startMs" tickFormatter={(v: number) => (bucket >= 1440 ? new Date(v).toLocaleDateString() : fmtTime(v))} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="c" allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                  <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtMinutes(v)} width={64} />
                  <Tooltip labelFormatter={(v) => fmtInstant(Number(v))} formatter={(v, name) => (name === 'Average span' ? [v === null ? 'N/A' : fmtMinutes(Number(v)), name] : [v, name])} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="c" dataKey="caseCount" name="Cases started" fill="#a5b4fc" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d) => {
                    const b = d as unknown as { elapsedCaseKeys: string[]; startMs: number };
                    onDrill({ title: `Cases starting ${fmtInstant(b.startMs)}`, caseKeys: b.elapsedCaseKeys });
                  }} />
                  <Line yAxisId="m" dataKey="meanElapsedMin" name="Average span" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        }
      </EngineGate>
    </div>
  );
}

function BucketPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Bucket
      <Select className="!w-auto !py-1 text-xs" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </Select>
    </label>
  );
}

/* ------------------------------ Throughput ------------------------------ */

function ThroughputPanel({ onDrill }: { onDrill: (d: Drill) => void }) {
  const { api, selectedTraces, dfg, kpis } = useAnalysis();
  const { state, dispatch } = useStore();
  const ws = useWorkspace()!;
  const [bucket, setBucket] = useState(60);
  const completion = ws.completionActivities ?? [];
  const activities = dfg?.status === 'ok' ? dfg.data.nodes.map((n) => n.activity) : [];
  const festivalSeries = kpis?.status === 'ok' ? kpis.data.find((m) => m.id === THROUGHPUT_METRIC_ID) : undefined;
  const result = useMemo(
    () => callEngine(api, 'getCaseThroughput', selectedTraces, { buckets: { bucketMinutes: bucket, anchorMs: 0 }, ...(completion.length ? { completion: { completionActivities: completion } } : {}) }),
    [api, selectedTraces, bucket, completion],
  );
  const toggle = (a: string) => dispatch({ type: 'SET_COMPLETION', activities: completion.includes(a) ? completion.filter((x) => x !== a) : [...completion, a] });
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-slate-800">
          What counts as a completed case?
          <InfoTip>ProcessPilot never guesses success or completion. Choose the activity (or activities) that mark a finished case; the first one recorded in a case is counted, once.</InfoTip>
        </div>
        <div className="flex flex-wrap gap-1">
          {activities.map((a) => (
            <button key={a} type="button" aria-pressed={completion.includes(a)} onClick={() => toggle(a)} className={cx('rounded-md border px-2 py-0.5 text-xs', completion.includes(a) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              {a}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-slate-500">{completion.length ? `Completion = first of: ${completion.join(', ')}. Also used by Replay.` : 'Not defined yet — throughput stays N/A until you choose.'}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-slate-500">Completions per time bucket, assigned to the completion timestamp. Zero means none was recorded in that bucket of the observed period.</span>
        <BucketPicker value={bucket} onChange={setBucket} />
      </div>
      <EngineGate result={result}>
        {(t) =>
          t.unavailable ? (
            <Notice tone="neutral">
              {t.unavailable === 'missing_completion' ? 'Choose a completion activity above to see throughput.' : t.unavailable === 'empty_scope' ? 'No cases in the current scope.' : 'Too many buckets for this width. Choose a wider bucket.'}
            </Notice>
          ) : (
            <>
              <div className="text-[13px] text-slate-600">
                Average <b>{fmtNumber(t.value)}</b> completed cases per {BUCKETS.find((b) => b.id === bucket)?.label} · {t.n} of {t.eligible} cases completed
              </div>
              <BucketChart buckets={t.buckets} onDrill={(b) => onDrill({ title: `Completed ${fmtInstant(b.startMs)}`, caseKeys: b.caseKeys })} />
            </>
          )
        }
      </EngineGate>
      {state.dataset?.festival && festivalSeries?.buckets && (
        <div className="border-t border-slate-100 pt-3">
          <div className="text-[13px] font-semibold text-slate-800">{kpiName(festivalSeries.id)} <Badge tone="violet">Festival rule</Badge></div>
          <p className="text-[12px] text-slate-500">{festivalSeries.definition} Bucket {state.view.throughputBucketMin} min.</p>
          <BucketChart buckets={festivalSeries.buckets} onDrill={(b) => onDrill({ title: `Entries completed ${fmtInstant(b.startMs)}`, caseKeys: b.caseKeys })} />
        </div>
      )}
    </div>
  );
}

function BucketChart({ buckets, onDrill }: { buckets: ThroughputBucket[]; onDrill: (b: ThroughputBucket) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const data = buckets.map((b, i) => ({ ...b, i }));
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -12, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="startMs" tickFormatter={(v: number) => fmtTime(v)} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => fmtInstant(Number(v))} formatter={(v) => [v, 'Completed']} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} onClick={(d) => { const b = d as unknown as ThroughputBucket & { i: number }; setActive(b.i); onDrill(b); }}>
            {data.map((d) => <Cell key={d.i} cursor="pointer" fill={active === d.i ? '#4338ca' : '#6366f1'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------ Drift ------------------------------ */

const toLocal = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
};

function DriftPanel({ onDrill }: { onDrill: (d: Drill) => void }) {
  const { api, selectedTraces } = useAnalysis();
  // Default periods: the two halves of the selected cases' recorded time span (UI default, editable).
  const span = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of selectedTraces) for (const e of t.events) {
      if (e.timestampMs < lo) lo = e.timestampMs;
      if (e.timestampMs > hi) hi = e.timestampMs;
    }
    return Number.isFinite(lo) ? { lo, hi: hi + 60_000 } : null;
  }, [selectedTraces]);
  const mid = span ? Math.floor((span.lo + span.hi) / 2 / 60_000) * 60_000 : 0;
  const [p, setP] = useState(() => (span ? { b0: toLocal(span.lo), b1: toLocal(mid), r0: toLocal(mid), r1: toLocal(span.hi) } : { b0: '', b1: '', r0: '', r1: '' }));
  const b: EventWindow | null = fromLocal(p.b0) !== null && fromLocal(p.b1) !== null ? { startMs: fromLocal(p.b0)!, endMs: fromLocal(p.b1)! } : null;
  const r: EventWindow | null = fromLocal(p.r0) !== null && fromLocal(p.r1) !== null ? { startMs: fromLocal(p.r0)!, endMs: fromLocal(p.r1)! } : null;
  const invalid = !b || !r ? 'Enter all four times.' : b.endMs <= b.startMs || r.endMs <= r.startMs ? 'Each period must end after it starts.' : b.endMs > r.startMs ? 'The baseline must end before the recent period starts.' : null;
  const result = useMemo(() => (invalid || !b || !r ? null : callEngine(api, 'getTransitionDrift', selectedTraces, b, r)), [api, selectedTraces, invalid, b?.startMs, b?.endMs, r?.startMs, r?.endMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState<'delta' | 'count'>('delta');
  const supportBadge = (s: TransitionDriftRow['shareSupport']) => (s === 'low' ? <Badge tone="amber">low support</Badge> : s === 'unavailable' ? <Badge>N/A</Badge> : null);
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-slate-500">
        Compares how often each next step follows an activity in two periods (share of all steps leaving that activity) and the average time between them. Descriptive change only — not statistical significance or a cause.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <fieldset className="rounded-lg border border-slate-200 px-3 py-2">
          <legend className="px-1 text-xs font-semibold text-slate-600">Baseline period</legend>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><Input type="datetime-local" className="text-xs" value={p.b0} onChange={(e) => setP({ ...p, b0: e.target.value })} /></Field>
            <Field label="To (exclusive)"><Input type="datetime-local" className="text-xs" value={p.b1} onChange={(e) => setP({ ...p, b1: e.target.value })} /></Field>
          </div>
        </fieldset>
        <fieldset className="rounded-lg border border-slate-200 px-3 py-2">
          <legend className="px-1 text-xs font-semibold text-slate-600">Recent period</legend>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><Input type="datetime-local" className="text-xs" value={p.r0} onChange={(e) => setP({ ...p, r0: e.target.value })} /></Field>
            <Field label="To (exclusive)"><Input type="datetime-local" className="text-xs" value={p.r1} onChange={(e) => setP({ ...p, r1: e.target.value })} /></Field>
          </div>
        </fieldset>
      </div>
      {invalid && <Notice tone="warning">{invalid}</Notice>}
      {result && (
        <EngineGate result={result}>
          {(d) =>
            d.transitions.length === 0 ? (
              <Notice tone="neutral">No transitions fall into either period.</Notice>
            ) : (
              <>
                <div className="flex justify-end">
                  <Segmented size="sm" value={sort} onChange={setSort} options={[{ id: 'delta', label: 'Largest change' }, { id: 'count', label: 'Most frequent' }]} ariaLabel="Sort" />
                </div>
                <Table className="max-h-96">
                  <thead>
                    <tr><Th>Transition</Th><Th align="right">Baseline share</Th><Th align="right">Recent share</Th><Th align="right">Change</Th><Th align="right">Avg time Δ</Th><Th /></tr>
                  </thead>
                  <tbody>
                    {[...d.transitions]
                      .sort((x, y) => (sort === 'delta' ? Math.abs(y.deltaSharePp ?? 0) - Math.abs(x.deltaSharePp ?? 0) : y.baseline.count + y.recent.count - (x.baseline.count + x.recent.count)))
                      .map((row) => (
                        <tr key={`${row.from}>${row.to}`} className="cursor-pointer hover:bg-slate-50" onClick={() => onDrill({ title: `${row.from} → ${row.to} (recent period)`, caseKeys: row.recent.caseKeys.length ? row.recent.caseKeys : row.baseline.caseKeys })}>
                          <Td>{row.from} → {row.to}</Td>
                          <Td align="right">{row.baseline.sharePct === null ? 'N/A' : `${fmtNumber(row.baseline.sharePct, 1)}%`} <span className="text-[11px] text-slate-400">({row.baseline.count}/{row.baseline.outgoingCount})</span></Td>
                          <Td align="right">{row.recent.sharePct === null ? 'N/A' : `${fmtNumber(row.recent.sharePct, 1)}%`} <span className="text-[11px] text-slate-400">({row.recent.count}/{row.recent.outgoingCount})</span></Td>
                          <Td align="right" className={cx(row.deltaSharePp !== null && row.deltaSharePp > 0 && 'text-brand-700', row.deltaSharePp !== null && row.deltaSharePp < 0 && 'text-amber-700')}>
                            {row.deltaSharePp === null ? '—' : `${row.deltaSharePp > 0 ? '+' : ''}${fmtNumber(row.deltaSharePp, 1)} pp`}
                          </Td>
                          <Td align="right">{row.deltaMeanGapMin === null ? '—' : `${row.deltaMeanGapMin > 0 ? '+' : row.deltaMeanGapMin < 0 ? '−' : ''}${fmtMinutes(Math.abs(row.deltaMeanGapMin))}`}</Td>
                          <Td className="space-x-1 whitespace-nowrap">{supportBadge(row.shareSupport)}{row.gapSupport === 'low' && row.shareSupport !== 'low' && <Badge tone="amber">low time support</Badge>}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </>
            )
          }
        </EngineGate>
      )}
    </div>
  );
}

/* ------------------------------ Plan status ------------------------------ */

function PlanStatus({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace()!;
  const { scope } = useAnalysis();
  const current = ws.plans.filter((p) => p.state === 'current');
  return (
    <Card title="Rollout progress" subtitle="Plan status from Implementation, kept separate from measured KPIs. A finished task is not evidence that a KPI changed." actions={<Button size="sm" onClick={() => navigate('implementation')}>Open Implementation</Button>}>
      {!current.length ? (
        <p className="text-[13px] text-slate-500">No current plan for this scope.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {current.map((p) => {
            const done = p.tasks.filter((t) => t.status === 'done').length;
            const blocked = p.tasks.filter((t) => t.status === 'blocked').length;
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium">{p.title}</div>
                  {isScopeStale(p.scope, scope) && <Badge tone="amber">other scope</Badge>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${p.tasks.length ? (done / p.tasks.length) * 100 : 0}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular">{done}/{p.tasks.length} done{blocked ? ` · ${blocked} blocked` : ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

