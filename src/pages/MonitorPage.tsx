import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metric, ThroughputBucket } from '../contracts';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import type { PageId } from '../state/types';
import { fmtInstant, fmtTime, fmtValue, plural } from '../lib/format';
import { CaseKeyList } from '../components/cases';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, Notice, PageHeader, Select, Stat } from '../components/ui';
import { StatusBadge } from './ModelPage';
import { THROUGHPUT_METRIC_ID } from '../festival/adapter';

export function MonitorPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div>
      <PageHeader
        phase="Phase 5 · Monitor & control"
        title="Monitor & Control"
        subtitle="KPIs calculated from the loaded historical log, compared with the targets saved in Model. Updates instantly when targets, the dataset or the case filter change. This is not live monitoring."
        actions={<Button onClick={() => navigate('model')}>Edit targets in Model</Button>}
      />
      <RequireData navigate={navigate}>
        <Content navigate={navigate} />
      </RequireData>
    </div>
  );
}

function Content({ navigate }: { navigate: (p: PageId) => void }) {
  const { kpis, evaluations } = useAnalysis();
  const ws = useWorkspace()!;
  const [drill, setDrill] = useState<{ title: string; caseKeys: string[] } | null>(null);
  const evalMap = new Map((evaluations?.status === 'ok' ? evaluations.data : []).map((e) => [e.metricId, e.status]));

  return (
    <div className="space-y-4">
      <EngineGate result={kpis}>
        {(metrics) => {
          if (!metrics.length) return <EmptyState title="No KPIs">getKPIs returned no metrics for this process and scope.</EmptyState>;
          const breached = ws.targets.filter((t) => evalMap.get(t.metricId) === 'breached');
          const unknown = ws.targets.filter((t) => evalMap.get(t.metricId) === 'unknown');
          // Identified by engine ID / unit, not by "first metric with buckets".
          const throughput = metrics.find((m) => m.id === THROUGHPUT_METRIC_ID) ?? metrics.find((m) => m.unit === 'cases/bucket' && m.buckets);
          return (
            <>
              {evaluations && evaluations.status !== 'ok' && <EngineGate result={evaluations}>{() => null}</EngineGate>}
              <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                <div className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {metrics.map((m) => {
                    const target = ws.targets.find((t) => t.metricId === m.id);
                    const status = target ? evalMap.get(m.id) : undefined;
                    return (
                      <button key={m.id} type="button" className="text-left" onClick={() => setDrill({ title: m.id, caseKeys: m.caseKeys })}>
                        <Stat
                          label={m.id}
                          value={fmtValue(m.value, m.unit)}
                          tone={m.value === null ? 'muted' : status === 'breached' ? 'bad' : status === 'met' ? 'good' : 'default'}
                          badge={<StatusBadge status={status} />}
                          sub={
                            <>
                              {target ? <>Target {target.direction === 'max' ? '≤' : '≥'} {fmtValue(target.value, target.unit)} · </> : null}
                              n = {m.n} of {m.eligible}
                              {m.reason && <div className="text-amber-700">{m.reason}</div>}
                            </>
                          }
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-4">
                  <Card title="Alerts" subtitle="Direction-aware target checks on measured values">
                    {!ws.targets.length ? (
                      <div className="text-sm text-slate-500">
                        No targets saved. <button className="text-brand-600 hover:underline" onClick={() => navigate('model')}>Set targets in Model</button>.
                      </div>
                    ) : breached.length === 0 && unknown.length === 0 ? (
                      <Notice tone="success">All {plural(ws.targets.length, 'target')} met.</Notice>
                    ) : (
                      <ul className="space-y-2">
                        {breached.map((t) => {
                          const m = metrics.find((x) => x.id === t.metricId)!;
                          return (
                            <li key={t.metricId} className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-semibold text-red-900">{t.metricId}</span>
                                <Badge tone="red">breached</Badge>
                              </div>
                              <div className="mt-1 text-red-900">
                                Measured {fmtValue(m.value, m.unit)} vs target {t.direction === 'max' ? '≤' : '≥'} {fmtValue(t.value, t.unit)}
                              </div>
                              {m.caseKeys.length > 0 && (
                                <button className="mt-1 text-xs font-medium text-red-700 hover:underline" onClick={() => setDrill({ title: t.metricId, caseKeys: m.caseKeys })}>
                                  Inspect {plural(m.caseKeys.length, 'case')} →
                                </button>
                              )}
                            </li>
                          );
                        })}
                        {unknown.map((t) => (
                          <li key={t.metricId} className="rounded-md border border-slate-200 p-2.5 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs">{t.metricId}</span>
                              <Badge>unknown</Badge>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">Metric missing, unsupported (N/A) or unit mismatch — not counted as met or breached.</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card title="Case drill-down">
                    {drill ? (
                      <>
                        <div className="mb-2 font-mono text-xs font-medium">{drill.title}</div>
                        <CaseKeyList caseKeys={drill.caseKeys} />
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">Click a KPI card, an alert or a throughput bar to list contributing cases.</p>
                    )}
                  </Card>
                </div>
              </div>
              <ThroughputCard metric={throughput} onDrill={(b) => setDrill({ title: `${throughput?.id} · ${fmtInstant(b.startMs)}`, caseKeys: b.caseKeys })} />
            </>
          );
        }}
      </EngineGate>
      <PlanStatus navigate={navigate} />
    </div>
  );
}

function ThroughputCard({ metric, onDrill }: { metric?: Metric; onDrill: (b: ThroughputBucket) => void }) {
  const { state, dispatch } = useStore();
  const [active, setActive] = useState<number | null>(null);
  const bucketMs = state.view.throughputBucketMin * 60_000;
  // Bars are placed on a real time axis (bucket midpoints). Buckets the engine does not return are
  // left as gaps — never filled with zero by the UI.
  const data = (metric?.buckets ?? []).map((b, i) => ({ ...b, i, mid: (b.startMs + b.endMs) / 2 }));
  const domain: [number, number] | undefined = data.length
    ? [Math.min(...data.map((d) => d.startMs)), Math.max(...data.map((d) => d.endMs))]
    : undefined;
  const slots = domain ? Math.max(1, Math.round((domain[1] - domain[0]) / bucketMs)) : 1;
  return (
    <Card
      title="Historical throughput"
      subtitle={
        metric
          ? `${metric.id} · ${fmtValue(metric.value, metric.unit)} mean · ${metric.definition}`
          : 'Completed cases per time bucket, as returned by getKPIs (Metric.buckets).'
      }
      actions={
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Bucket
          <Select className="!w-auto !py-1 text-xs" value={state.view.throughputBucketMin} onChange={(e) => dispatch({ type: 'SET_VIEW', view: { throughputBucketMin: Number(e.target.value) } })}>
            {[15, 30, 60, 120, 360, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : m === 1440 ? '1 day' : `${m / 60} h`}</option>)}
          </Select>
        </label>
      }
    >
      {!metric ? (
        <EmptyState title="No throughput series for this process">
          The engine returned no bucketed metric for this scope. Throughput is defined for processes with a completion event (e.g. Entry Complete).
        </EmptyState>
      ) : (
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: -16, right: 8, top: 4 }} barCategoryGap={0}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="mid" type="number" scale="time" domain={domain} tickFormatter={(v: number) => fmtTime(v)} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={(_, p) => (p?.[0] ? `${fmtInstant(p[0].payload.startMs)} – ${fmtTime(p[0].payload.endMs)}` : '')} formatter={(v) => [v, 'Completed']} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={Math.max(4, Math.floor(600 / slots))} onClick={(d) => { const b = d as unknown as ThroughputBucket & { i: number }; setActive(b.i); onDrill(b); }}>
                {data.map((d) => <Cell key={d.i} cursor="pointer" fill={active === d.i ? '#4338ca' : '#6366f1'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {metric && (
        <p className="mt-2 text-xs text-slate-500">
          Unit {metric.unit}; bucket width {state.view.throughputBucketMin} min. Time periods without a returned bucket are shown as gaps, not as zero.
        </p>
      )}
    </Card>
  );
}

function PlanStatus({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace()!;
  const { scope } = useAnalysis();
  const current = ws.plans.filter((p) => p.state === 'current');
  return (
    <Card title="Plan status" subtitle="Implementation progress, shown separately from measured KPIs. A completed task is not evidence that a KPI changed." actions={<Button size="sm" onClick={() => navigate('implementation')}>Open Implementation</Button>}>
      {!current.length ? (
        <p className="text-sm text-slate-500">No current plan for this dataset and process.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {current.map((p) => {
            const done = p.tasks.filter((t) => t.status === 'done').length;
            const blocked = p.tasks.filter((t) => t.status === 'blocked').length;
            return (
              <div key={p.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{p.title}</div>
                  {isScopeStale(p.scope, scope) && <Badge tone="amber">other scope</Badge>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${p.tasks.length ? (done / p.tasks.length) * 100 : 0}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular">
                  {done}/{p.tasks.length} done{blocked ? ` · ${blocked} blocked` : ''} · {p.source.kind === 'scenario' ? `scenario ${p.source.baselineGates}→${p.source.candidateGates} gates` : 'proposal only'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
