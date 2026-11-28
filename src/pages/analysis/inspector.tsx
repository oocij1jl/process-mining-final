/** Inspector building blocks: evidence case lists, the case timeline and findings. */
import { useState, type ReactNode } from 'react';
import type { Finding, Metric } from '../../contracts';
import { useAnalysis } from '../../state/analysis';
import { uid, useStore } from '../../state/store';
import type { DesignRecord } from '../../state/types';
import { caseLabel, displayResourceKeys, fmtInstant, fmtMinutes, fmtValue, plural, resourceLabel } from '../../lib/format';
import { kpiName } from '../../lib/kpiCatalog';
import { Badge, Button, cx } from '../../components/ui';
import { Icon } from '../../components/icons';

/** Clickable list of the cases behind a number. Picking a case opens its timeline in the inspector. */
export function CaseList({ caseKeys, onPick, limit = 12, label }: { caseKeys: readonly string[]; onPick: (k: string) => void; limit?: number; label?: ReactNode }) {
  const { traceByKey } = useAnalysis();
  const [all, setAll] = useState(false);
  if (!caseKeys.length) return <div className="text-[13px] text-slate-500">No case-level evidence for this item.</div>;
  const shown = all ? caseKeys : caseKeys.slice(0, limit);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        <span>{label ?? 'Evidence cases'}</span>
        <span className="font-medium normal-case tracking-normal tabular">{plural(caseKeys.length, 'case')}</span>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {shown.map((k) => {
          const t = traceByKey.get(k);
          return (
            <li key={k}>
              <button type="button" onClick={() => onPick(k)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-brand-50/50">
                <span className="font-mono text-[12.5px] font-semibold text-brand-700">{caseLabel(k)}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">{t ? t.sequence.map((e) => e.activity).join(' → ') : 'not in current data'}</span>
                {t && <span className="shrink-0 text-[11.5px] text-slate-500 tabular">{fmtMinutes(t.elapsedMin)}</span>}
                <Icon name="chevronRight" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              </button>
            </li>
          );
        })}
      </ul>
      {caseKeys.length > limit && (
        <button type="button" className="mt-1.5 text-xs font-medium text-brand-600 hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${caseKeys.length}`}
        </button>
      )}
    </div>
  );
}

/** Case timeline: the actual recorded events of one case, in order. */
export function CaseTimeline({ caseKey, onBack, backLabel }: { caseKey: string; onBack: () => void; backLabel: string }) {
  const { traceByKey } = useAnalysis();
  const { state, dispatch } = useStore();
  const t = traceByKey.get(caseKey);
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <Icon name="arrowLeft" className="h-3.5 w-3.5" /> {backLabel}
      </button>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Case</div>
          <div className="font-mono text-lg font-semibold text-slate-900">{caseLabel(caseKey)}</div>
        </div>
        <Button size="sm" variant="ghost" icon="table" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: caseKey } })}>
          All rows
        </Button>
      </div>
      {!t ? (
        <p className="mt-2 text-[13px] text-slate-500">This case is not part of the current data.</p>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 tabular">
            <span>{plural(t.events.length, 'row')}</span>
            <span>{plural(t.sequence.length, 'step')}</span>
            <span>observed span {fmtMinutes(t.elapsedMin)}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">The path is highlighted on the map. Span = first to last recorded event, not a confirmed completion.</p>
          <ol className="relative mt-3 space-y-0 border-l-2 border-slate-200 pl-4">
            {t.events.map((e, i) => {
              const prev = t.events[i - 1];
              const gap = prev ? (e.timestampMs - prev.timestampMs) / 60000 : null;
              const isStart = e.lifecycle === 'start';
              return (
                <li key={e.sourceOrder} className="relative pb-2.5">
                  <span className={cx('absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white', isStart ? 'bg-slate-300' : 'bg-brand-500')} />
                  {gap !== null && gap > 0 && <div className="-mt-0.5 mb-0.5 text-[10.5px] text-slate-400 tabular">+{fmtMinutes(gap)}</div>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx('text-[13px] font-medium', isStart ? 'text-slate-500' : 'text-slate-800')}>{e.activity}</span>
                    {e.lifecycle !== 'point' && <Badge tone={isStart ? 'neutral' : 'brand'}>{e.lifecycle}</Badge>}
                  </div>
                  <div className="text-[11.5px] text-slate-500 tabular">
                    {fmtInstant(e.timestampMs)}
                    {' · '}
                    {e.resource ? resourceLabel(e.resource) : <span className="italic">no resource</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          {state.dataset?.festival && t.events[0]?.attrs.performance_id && (
            <div className="mt-1 text-[11.5px] text-slate-500">performance_id {t.events[0].attrs.performance_id}</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Design draft from an engine Finding. The target KPI is preselected only when the
 * finding's metric is a current KPI (V03_CONTRACT §3 Design target selection).
 */
export function designFromFinding(f: Finding, metrics: readonly Metric[], simulationAvailable: boolean): DesignRecord {
  const now = Date.now();
  const metricOk = metrics.some((m) => m.id === f.metricId);
  return {
    id: uid('design'),
    title: f.proposal.length > 90 ? `${f.proposal.slice(0, 87)}…` : f.proposal,
    findingIds: [f.id],
    findingText: [f.text],
    changeNote: '',
    affectedActivities: f.edge ? [...new Set([f.edge.from, f.edge.to])] : [],
    targetMetricId: metricOk ? f.metricId : null,
    asIsBpmnRef: null,
    toBeBpmnRef: null,
    kind: simulationAvailable ? 'simulation' : 'proposal_only',
    status: 'draft',
    scope: f.scope,
    createdAt: now,
    updatedAt: now,
    lever: null,
    problem: displayResourceKeys(f.text),
    rationale: '',
    assumptions: '',
    affectedResources: [],
    evaluation: simulationAvailable ? 'quantitative' : 'qualitative',
  };
}

const RULE_LABEL: Record<string, string> = {
  slow_transition: 'Slow transition',
  rework: 'Repeated steps',
  workload: 'Workload concentration',
  audience_queue: 'Entry queue',
  target_max: 'Target exceeded',
  target_min: 'Target not reached',
};

/** Rule from the explicit I-1 field; legacy findings fall back to their deterministic ID. */
export function findingRule(f: Finding): string | undefined {
  if (f.rule) return f.rule;
  try {
    const id: unknown = JSON.parse(f.id);
    return Array.isArray(id) && typeof id[3] === 'string' ? id[3] : undefined;
  } catch {
    return undefined;
  }
}

export function FindingCard({
  f,
  active,
  onShow,
  onDesign,
  linkedDesigns,
}: {
  f: Finding;
  active: boolean;
  onShow?: () => void;
  onDesign: () => void;
  linkedDesigns: number;
}) {
  const rule = findingRule(f);
  return (
    <div className={cx('rounded-lg border px-3 py-2.5 transition', active ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200 bg-white')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={rule?.startsWith('target') ? 'red' : rule === 'rework' ? 'amber' : 'brand'}>{(rule && RULE_LABEL[rule]) ?? 'Finding'}</Badge>
        {f.support === 'low' && <Badge tone="amber" title="Fewer than 3 observations">low support</Badge>}
      </div>
      <p className="mt-1.5 text-[13px] font-medium leading-snug text-slate-800">{displayResourceKeys(f.text)}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-slate-500 tabular">
        <span>
          {kpiName(f.metricId)}: <b className="text-slate-700">{fmtValue(f.value, f.unit)}</b>
        </span>
        <span>n = {f.n}{f.eligible !== undefined && ` of ${f.eligible}`}</span>
        <span>{plural(f.caseKeys.length, 'case')}</span>
      </div>
      {f.definition && <p className="mt-1 text-[11.5px] text-slate-500">{f.definition}</p>}
      <p className="mt-1.5 text-[12px] text-slate-600">
        <span className="font-medium text-slate-500">Next:</span> {f.proposal}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onShow && (
          <Button size="sm" variant="secondary" icon="target" onClick={onShow}>
            Show evidence
          </Button>
        )}
        <Button size="sm" variant="subtle" iconRight="arrowRight" onClick={onDesign}>
          Design an improvement
        </Button>
        {linkedDesigns > 0 && <span className="text-[11px] text-slate-500">{plural(linkedDesigns, 'linked design')}</span>}
      </div>
    </div>
  );
}
