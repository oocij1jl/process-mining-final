/**
 * Festival cross-process overview. Each process keeps its own traces and
 * engine KPIs; this page only places them side by side. Stage ↔ Equipment
 * evidence is a lookup of recorded festival_id + performance_id values (no
 * merged traces, no causal claims, no audience-to-performer matching).
 */
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metric, Trace } from '../contracts';
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

const attr = (t: Trace, k: string) => t.events.find((e) => e.attrs[k]?.trim())?.attrs[k]?.trim() ?? null;

/** Stage ↔ Equipment evidence by recorded IDs (lookup only; engine KPIs apply their own ambiguity rules). */
function LinkExplorer({ stage, equipment }: { stage: Trace[]; equipment: Trace[] }) {
  const { dispatch } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const perf = useMemo(
    () =>
      stage.map((t) => {
        const fid = attr(t, 'festival_id');
        const pid = attr(t, 'performance_id');
        const linked = pid ? equipment.filter((e) => attr(e, 'performance_id') === pid && attr(e, 'festival_id') === fid) : [];
        return { t, fid, pid, linked };
      }),
    [stage, equipment],
  );
  if (!stage.length || !equipment.length) {
    return (
      <Card title="Stage ↔ Equipment evidence">
        <p className="text-[13px] text-slate-500">N/A — the log needs both stage and equipment cases with festival_id and performance_id to show links.</p>
      </Card>
    );
  }
  const shown = perf.filter((x) => !q || (x.pid ?? caseLabel(x.t.caseKey)).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const cur = perf.find((x) => x.t.caseKey === sel) ?? null;
  const all = cur ? [cur.t, ...cur.linked] : [];
  const lo = all.length ? Math.min(...all.map((t) => t.events[0]!.timestampMs)) : 0;
  const hi = all.length ? Math.max(...all.map((t) => t.events.at(-1)!.timestampMs)) : 1;
  const pos = (ms: number) => `${((ms - lo) / Math.max(1, hi - lo)) * 100}%`;
  return (
    <Card
      title="Stage ↔ Equipment evidence"
      subtitle="Equipment requests recorded with the same festival_id and performance_id as a stage performance. Timelines are shown side by side; no cause is implied."
      actions={<Input className="!w-48 !py-1 text-xs" placeholder="Search performance" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search performance" />}
    >
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ul className="pp-scroll max-h-80 space-y-1 overflow-auto">
          {shown.map((x) => (
            <li key={x.t.caseKey}>
              <button type="button" onClick={() => setSel(x.t.caseKey)} className={cx('flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[13px]', sel === x.t.caseKey ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
                <span className="font-mono">{x.pid ?? caseLabel(x.t.caseKey)}</span>
                {x.linked.length ? <Badge tone="violet">{plural(x.linked.length, 'request')}</Badge> : <Badge>none</Badge>}
              </button>
            </li>
          ))}
        </ul>
        <div>
          {!cur ? (
            <p className="text-[13px] text-slate-500">Choose a performance to compare its stage preparation with its equipment readiness.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[13px]">
                <b>{cur.pid ?? caseLabel(cur.t.caseKey)}</b>
                <span className="text-slate-500">festival {cur.fid ?? 'N/A'}</span>
                <InfoTip>Lookup of recorded IDs. Duplicate or unmatched performance IDs are handled by the engine’s Festival KPIs, which may exclude ambiguous links.</InfoTip>
              </div>
              {[cur.t, ...cur.linked].map((t) => (
                <div key={t.caseKey}>
                  <div className="mb-0.5 flex items-center justify-between text-[12px]">
                    <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: t.caseKey } })}>
                      {processLabel(t.processType, true)} · {caseLabel(t.caseKey)}
                    </button>
                    <span className="text-slate-500 tabular">{fmtMinutes(t.elapsedMin)} observed span</span>
                  </div>
                  <div className="relative h-6 rounded bg-slate-100">
                    <div className={cx('absolute top-1 h-4 rounded', t.processType === 'stage' ? 'bg-brand-400' : 'bg-violet-400')} style={{ left: pos(t.events[0]!.timestampMs), width: `calc(${pos(t.events.at(-1)!.timestampMs)} - ${pos(t.events[0]!.timestampMs)} + 2px)` }} />
                    {t.sequence.map((e) => (
                      <span key={e.sourceOrder} title={`${e.activity} · ${fmtInstant(e.timestampMs)}`} className="absolute top-0.5 h-5 w-0.5 bg-slate-700/70" style={{ left: pos(e.timestampMs) }} />
                    ))}
                  </div>
                </div>
              ))}
              {!cur.linked.length && <Notice tone="neutral">No equipment request is recorded for this performance (N/A, not zero equipment).</Notice>}
              <div className="flex justify-between text-[11px] text-slate-500 tabular"><span>{fmtInstant(lo)}</span><span>{fmtInstant(hi)}</span></div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
