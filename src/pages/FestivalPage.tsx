/**
 * Festival cross-process overview. Each process keeps its own traces and
 * engine KPIs; this page only places them side by side. Stage ↔ Equipment
 * evidence is a lookup of recorded festival_id + performance_id values (no
 * merged traces, no causal claims, no audience-to-performer matching).
 */
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metric, Trace } from '../contracts';
import type { FestivalReadinessLink } from '../v03-contracts';
import { callEngine } from '../adapters/engineAdapter';
import { useAnalysis } from '../state/analysis';
import { useStore } from '../state/store';
import type { PageId } from '../state/types';
import { FESTIVAL_PROCESS_INFO, THROUGHPUT_METRIC_ID } from '../festival/adapter';
import { caseLabel, fmtInstant, fmtMinutes, fmtTime, fmtValue, plural, processLabel } from '../lib/format';
import { kpiName } from '../lib/kpiCatalog';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, EngineGate, InfoTip, Input, Notice, PageHeader, cx } from '../components/ui';

const PROCESSES = ['stage', 'audience', 'equipment'] as const;
const KEY_KPIS: Record<string, string[]> = {
  stage: ['stage_preparation_mean', 'stage_on_time_rate', 'stage_recheck_rate', 'case_elapsed_mean'],
  audience: ['audience_queue_wait_mean', 'audience_entry_elapsed_mean', 'audience_manual_verification_rate', 'audience_throughput'],
  equipment: ['equipment_lead_time_mean', 'equipment_on_time_rate', 'equipment_substitution_rate', 'equipment_inspection_rework_rate'],
};

export function FestivalPage({ navigate }: { navigate: (p: PageId) => void }) {
  const { state } = useStore();
  return (
    <div>
      <PageHeader
        phase="Case study"
        title="Festival operations overview"
        subtitle="Stage, Audience and Equipment side by side. Each process is analysed separately; links between Stage and Equipment come only from recorded festival and performance IDs."
      />
      <RequireData navigate={navigate}>
        {!state.dataset?.festival ? (
          <EmptyState icon="music" title="This overview is for the Festival case study" action={<Button variant="primary" onClick={() => navigate('overview')}>Choose the Festival sample</Button>}>
            Load the Festival sample (or turn Festival rules on for a log with stage, audience and equipment processes).
          </EmptyState>
        ) : (
          <Content navigate={navigate} />
        )}
      </RequireData>
    </div>
  );
}

function Content({ navigate }: { navigate: (p: PageId) => void }) {
  const { api, allTraces, kpiContextFor } = useAnalysis();
  const { dispatch } = useStore();
  const byProcess = useMemo(() => {
    const m = new Map<string, Trace[]>();
    for (const t of allTraces) m.set(t.processType, [...(m.get(t.processType) ?? []), t]);
    return m;
  }, [allTraces]);
  const kpisFor = useMemo(() => {
    const out = new Map<string, ReturnType<typeof callEngine<'getKPIs'>>>();
    for (const p of PROCESSES) {
      const traces = byProcess.get(p);
      if (traces?.length) out.set(p, callEngine(api, 'getKPIs', traces, kpiContextFor(p, traces)));
    }
    return out;
  }, [api, byProcess, kpiContextFor]);
  const open = (p: string) => {
    dispatch({ type: 'SET_VIEW', view: { processKey: p, dateFrom: '', dateTo: '', analysisMode: 'frequency' } });
    navigate('analysis');
  };
  const audienceKpis = kpisFor.get('audience');
  const throughput = audienceKpis?.status === 'ok' ? audienceKpis.data.find((m) => m.id === THROUGHPUT_METRIC_ID) : undefined;

  return (
    <div className="space-y-5">
      <Notice tone="neutral">All cases of each process are shown here (the case-start filter in the top bar applies to single-process pages). Synthetic data — no claim about real festival operations.</Notice>
      <div className="grid gap-4 lg:grid-cols-3">
        {PROCESSES.map((p) => {
          const traces = byProcess.get(p) ?? [];
          const info = FESTIVAL_PROCESS_INFO[p]!;
          const res = kpisFor.get(p);
          return (
            <Card key={p} title={processLabel(p, true)} subtitle={`One case = ${info.caseMeaning}`} actions={traces.length ? <Button size="sm" variant="subtle" iconRight="arrowRight" onClick={() => open(p)}>Analyse</Button> : undefined}>
              {!traces.length ? (
                <p className="text-[13px] text-slate-500">No cases of this process in the loaded log.</p>
              ) : (
                <div className="space-y-2">
                  <div className="text-[12.5px] text-slate-500">{plural(traces.length, 'case')} · {info.boundary}</div>
                  <EngineGate result={res}>
                    {(ms) => (
                      <ul className="space-y-1.5">
                        {KEY_KPIS[p]!.map((id) => ms.find((m) => m.id === id)).filter((m): m is Metric => !!m).map((m) => (
                          <li key={m.id} className="flex items-baseline justify-between gap-2 text-[13px]">
                            <span className="text-slate-600">{kpiName(m.id)}</span>
                            <span className="font-semibold tabular text-slate-900" title={m.definition}>{m.id === THROUGHPUT_METRIC_ID ? fmtValue(m.value, m.unit) : fmtValue(m.value, m.unit)}</span>
                          </li>
                        ))}
                        {!KEY_KPIS[p]!.some((id) => ms.some((m) => m.id === id)) && <li className="text-[12.5px] text-slate-500">No Festival KPIs returned for this process.</li>}
                      </ul>
                    )}
                  </EngineGate>
                  <p className="text-[11.5px] leading-snug text-slate-500">{info.question}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Audience entries completed over time" subtitle={throughput ? `${throughput.definition}` : 'From the engine’s Festival audience throughput KPI'}>
        {throughput?.buckets?.length ? (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={throughput.buckets} margin={{ left: -12, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="startMs" tickFormatter={(v: number) => fmtTime(v)} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(v) => fmtInstant(Number(v))} formatter={(v) => [v, 'Completed entries']} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">N/A — no audience throughput series for the loaded data{throughput?.reason ? `: ${throughput.reason}` : '.'}</p>
        )}
      </Card>

      <LinkExplorer stage={byProcess.get('stage') ?? []} equipment={byProcess.get('equipment') ?? []} />
    </div>
  );
}

const LINK_STATUS: Record<FestivalReadinessLink['linkStatus'], string> = {
  linked: 'linked',
  missing_key: 'no festival/performance ID',
  missing_stage: 'no matching performance',
  ambiguous_stage: 'performance ID not unique',
  stage_scope_unavailable: 'stage cases unavailable',
};

/** Stage ↔ Equipment readiness evidence from the engine (V03_CONTRACT §3B). */
function LinkExplorer({ stage, equipment }: { stage: Trace[]; equipment: Trace[] }) {
  const { api, kpiContextFor, traceByKey } = useAnalysis();
  const { dispatch } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const config = useMemo(() => (equipment.length ? kpiContextFor('equipment', equipment).festival : undefined), [equipment, kpiContextFor]);
  const result = useMemo(
    () => (config && equipment.length ? callEngine(api, 'getFestivalReadinessLinks', equipment, config, 'equipment') : null),
    [api, config, equipment],
  );
  if (!stage.length || !equipment.length || !result) {
    return (
      <Card title="Stage ↔ Equipment readiness">
        <p className="text-[13px] text-slate-500">N/A — the log needs both stage and equipment cases to compare readiness.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Stage ↔ Equipment readiness"
      subtitle="Equipment requests paired with their performance by festival_id + performance_id (engine linkage; ambiguous IDs are not paired). Shown side by side — no cause is implied."
      actions={<Input className="!w-48 !py-1 text-xs" placeholder="Search performance" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search performance" />}
    >
      <EngineGate result={result}>
        {(links) => {
          const groups = new Map<string, FestivalReadinessLink[]>();
          for (const l of links) {
            const k = l.linkStatus === 'linked' && l.stageCaseKey ? l.stageCaseKey : `__${l.linkStatus}`;
            groups.set(k, [...(groups.get(k) ?? []), l]);
          }
          const statusCounts = links.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.linkStatus]: (acc[l.linkStatus] ?? 0) + 1 }), {});
          const perfs = [...groups.entries()].filter(([k]) => !k.startsWith('__'));
          const shown = perfs.filter(([k, ls]) => !q || (ls[0]!.performanceId ?? caseLabel(k)).toLowerCase().includes(q.toLowerCase())).slice(0, 80);
          const cur = sel ? groups.get(sel) ?? null : null;
          const stageTrace = sel && !sel.startsWith('__') ? traceByKey.get(sel) : undefined;
          const traces = cur ? [...(stageTrace ? [stageTrace] : []), ...cur.map((l) => traceByKey.get(l.equipmentCaseKey)).filter((t): t is Trace => !!t)] : [];
          const marks = cur ? cur.flatMap((l) => [l.stageDeadlineMs, l.equipmentDeadlineMs].filter((v): v is number => v !== null)) : [];
          const lo = traces.length ? Math.min(...traces.map((t) => t.events[0]!.timestampMs), ...marks) : 0;
          const hi = traces.length ? Math.max(...traces.map((t) => t.events.at(-1)!.timestampMs), ...marks) : 1;
          const pos = (ms: number) => `${((ms - lo) / Math.max(1, hi - lo)) * 100}%`;
          const onTime = (v: boolean | null) => (v === null ? <Badge>N/A</Badge> : v ? <Badge tone="green">on time</Badge> : <Badge tone="red">late</Badge>);
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="text-slate-500">{plural(links.length, 'equipment request')}:</span>
                {Object.entries(statusCounts).map(([k, n]) => (
                  <button key={k} type="button" onClick={() => k !== 'linked' && setSel(`__${k}`)} className="cursor-pointer">
                    <Badge tone={k === 'linked' ? 'green' : 'amber'}>{n} {LINK_STATUS[k as FestivalReadinessLink['linkStatus']]}</Badge>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <ul className="pp-scroll max-h-96 space-y-1 overflow-auto">
                  {shown.map(([k, ls]) => (
                    <li key={k}>
                      <button type="button" onClick={() => setSel(k)} className={cx('flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px]', sel === k ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
                        <span className="font-mono">{ls[0]!.performanceId ?? caseLabel(k)}</span>
                        <span className="flex gap-1">
                          <Badge tone="violet">{ls.length} eq.</Badge>
                          {ls.some((l) => l.equipmentOnTime === false) && <Badge tone="red">late eq.</Badge>}
                          {ls[0]!.stageOnTime === false && <Badge tone="amber">stage late</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  {!cur ? (
                    <p className="text-[13px] text-slate-500">Choose a performance to compare its stage readiness with its equipment readiness.</p>
                  ) : sel!.startsWith('__') ? (
                    <div className="space-y-2">
                      <div className="text-[13px] font-semibold text-slate-800">{plural(cur.length, 'request')}: {LINK_STATUS[cur[0]!.linkStatus]}</div>
                      <p className="text-[12px] text-slate-500">These requests are not paired with a stage performance, so no stage comparison is shown (N/A, not zero).</p>
                      <ul className="pp-scroll max-h-72 space-y-1 overflow-auto">
                        {cur.map((l) => (
                          <li key={l.equipmentCaseKey}>
                            <button type="button" className="flex w-full justify-between rounded-md border border-slate-200 px-2.5 py-1 text-left text-[12.5px] hover:bg-slate-50" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: l.equipmentCaseKey } })}>
                              <span className="font-mono">{caseLabel(l.equipmentCaseKey)}</span>
                              <span className="text-slate-500">performance {l.performanceId ?? '—'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <b>{cur[0]!.performanceId}</b>
                        <span className="text-slate-500">festival {cur[0]!.festivalId ?? 'N/A'}</span>
                        <span className="text-slate-500">· stage ready</span>
                        {onTime(cur[0]!.stageOnTime)}
                        <InfoTip>Stage deadline = scheduled_start. Equipment deadline = {cur[0]!.equipmentDeadlineSource === 'required_ready_at' ? 'required_ready_at' : 'linked Stage Setup start'}. On time = ready at or before the deadline.</InfoTip>
                      </div>
                      {traces.map((t) => {
                        const l = cur.find((x) => x.equipmentCaseKey === t.caseKey);
                        const deadline = l ? l.equipmentDeadlineMs : cur[0]!.stageDeadlineMs;
                        const ready = l ? l.equipmentReady : cur[0]!.stageReady;
                        return (
                          <div key={t.caseKey}>
                            <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px]">
                              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: t.caseKey } })}>
                                {processLabel(t.processType, true)} · {caseLabel(t.caseKey)}
                              </button>
                              <span className="flex items-center gap-1.5 text-slate-500 tabular">
                                ready {ready ? fmtTime(ready.timestampMs) : 'N/A'}
                                {deadline !== null && <> · deadline {fmtTime(deadline)}</>}
                                {l && onTime(l.equipmentOnTime)}
                              </span>
                            </div>
                            <div className="relative h-6 rounded bg-slate-100">
                              <div className={cx('absolute top-1 h-4 rounded', t.processType === 'stage' ? 'bg-brand-400' : 'bg-violet-400')} style={{ left: pos(t.events[0]!.timestampMs), width: `calc(${pos(t.events.at(-1)!.timestampMs)} - ${pos(t.events[0]!.timestampMs)} + 2px)` }} />
                              {ready && <span title={`Ready ${fmtInstant(ready.timestampMs)}`} className="absolute top-0 h-6 w-1 rounded bg-emerald-600" style={{ left: pos(ready.timestampMs) }} />}
                              {deadline !== null && <span title={`Deadline ${fmtInstant(deadline)}`} className="absolute -top-0.5 h-7 w-0.5 bg-red-500" style={{ left: pos(deadline) }} />}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between text-[11px] text-slate-500 tabular"><span>{fmtInstant(lo)}</span><span className="flex items-center gap-2"><span className="inline-block h-2 w-1 bg-emerald-600" /> ready <span className="inline-block h-2 w-0.5 bg-red-500" /> deadline</span><span>{fmtInstant(hi)}</span></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      </EngineGate>
    </Card>
  );
}
