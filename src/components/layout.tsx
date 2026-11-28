import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAnalysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import type { PageId } from '../state/types';
import { plural, processLabel, VIEWER_TIMEZONE } from '../lib/format';
import { Badge, Button, Input, Select, cx } from './ui';
import { Icon, type IconName } from './icons';

export interface PageMeta {
  id: PageId;
  label: string;
  /** Plain-language purpose shown in navigation and headers. */
  purpose: string;
  phase?: string;
  icon: IconName;
}

export const PAGES: PageMeta[] = [
  { id: 'overview', label: 'Overview & Data', purpose: 'Start with a sample or your own log', icon: 'home' },
  { id: 'analysis', label: 'Analysis', purpose: 'Discover how work actually flows', phase: '1', icon: 'graph' },
  { id: 'design', label: 'Design', purpose: 'Turn findings into a redesign', phase: '2', icon: 'pen' },
  { id: 'model', label: 'Model', purpose: 'Compare and edit BPMN models', phase: '3', icon: 'shapes' },
  { id: 'implementation', label: 'Implementation', purpose: 'Automation, ROI and rollout', phase: '4', icon: 'rocket' },
  { id: 'monitor', label: 'Monitor & Control', purpose: 'Targets, trends and change', phase: '5', icon: 'pulse' },
  { id: 'refine', label: 'Refine & Improve', purpose: 'What-if scenarios and priorities', phase: '6', icon: 'flask' },
  { id: 'festival', label: 'Festival overview', purpose: 'Stage, Audience and Equipment side by side', icon: 'music' },
  { id: 'export', label: 'Evidence Export', purpose: 'Download results and history', icon: 'download' },
];

export function pageMeta(id: PageId): PageMeta {
  return PAGES.find((p) => p.id === id)!;
}

export function useHashRoute(): [PageId, (p: PageId) => void] {
  const read = (): PageId => {
    const id = window.location.hash.replace(/^#\/?/, '').split('?')[0] as PageId;
    return PAGES.some((p) => p.id === id) ? id : 'overview';
  };
  const [page, setPage] = useState<PageId>(read);
  useEffect(() => {
    const onHash = () => setPage(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (p: PageId) => {
    window.location.hash = `/${p}`;
    document.getElementById('pp-main')?.scrollTo({ top: 0 });
  };
  return [page, navigate];
}

function NavItem({ p, active, count, countTone, onClick, collapsed }: { p: PageMeta; active: boolean; count?: number; countTone?: 'red' | 'neutral'; onClick: () => void; collapsed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={p.phase ? `Step ${p.phase}: ${p.label}` : p.label}
      title={collapsed ? `${p.label} — ${p.purpose}` : p.purpose}
      className={cx(
        'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
        active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-md', active ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 group-hover:text-slate-600')}>
        <Icon name={p.icon} className="h-[18px] w-[18px]" />
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
            {p.phase && <span className={cx('text-[11px] tabular', active ? 'text-brand-500' : 'text-slate-400')}>{p.phase}</span>}
            <span className="truncate">{p.label}</span>
          </span>
        </span>
      )}
      {!collapsed && count !== undefined && (
        <span className={cx('rounded-md px-1.5 text-[11px] font-semibold tabular', countTone === 'red' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600')}>{count}</span>
      )}
    </button>
  );
}

export function Sidebar({ page, navigate, open, onClose }: { page: PageId; navigate: (p: PageId) => void; open: boolean; onClose: () => void }) {
  const { state } = useStore();
  const ws = useWorkspace();
  const { findings, evaluations } = useAnalysis();
  const breaches = evaluations?.status === 'ok' ? evaluations.data.filter((e) => e.status === 'breached').length : 0;
  const counts: Partial<Record<PageId, { n: number; tone?: 'red' }>> = {
    analysis: findings?.status === 'ok' && findings.data.length ? { n: findings.data.length } : undefined,
    design: ws?.designs.length ? { n: ws.designs.length } : undefined,
    implementation: ws?.plans.filter((p) => p.state === 'current').length ? { n: ws.plans.filter((p) => p.state === 'current').length } : undefined,
    monitor: breaches ? { n: breaches, tone: 'red' } : undefined,
  };
  const go = (p: PageId) => {
    navigate(p);
    onClose();
  };
  const groups: { group: string; items: PageMeta[] }[] = [
    { group: '', items: PAGES.filter((p) => p.id === 'overview') },
    { group: 'BPM lifecycle', items: PAGES.filter((p) => p.phase) },
    ...(state.dataset?.festival ? [{ group: 'Case study', items: PAGES.filter((p) => p.id === 'festival') }] : []),
    { group: 'Evidence', items: PAGES.filter((p) => p.id === 'export') },
  ];
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden" onClick={onClose} aria-hidden />}
      <nav
        aria-label="Main"
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        <button type="button" onClick={() => go('overview')} className="flex items-center gap-2.5 px-4 pb-4 pt-4 text-left">
          <ProcessPilotMark />
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">ProcessPilot</div>
            <div className="text-[11px] text-slate-500">Visual Process Intelligence</div>
          </div>
        </button>
        <div className="pp-scroll flex-1 overflow-auto px-2.5">
          {groups.map(({ group, items }) => (
            <div key={group || 'start'} className="mb-3">
              {group && <div className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">{group}</div>}
              {items.map((p) => (
                <NavItem key={p.id} p={p} active={page === p.id} count={counts[p.id]?.n} countTone={counts[p.id]?.tone} onClick={() => go(p.id)} />
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
          <div className="flex items-center gap-1.5">
            <Icon name="lock" className="h-3.5 w-3.5" /> Runs locally in your browser
          </div>
          <div className="mt-0.5 text-slate-400">No upload, no live monitoring, no AI service.</div>
        </div>
      </nav>
    </>
  );
}

export function ProcessPilotMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <circle cx="9" cy="10" r="3" fill="#fff" />
      <circle cx="23" cy="10" r="3" fill="#c7d2fe" />
      <circle cx="16" cy="22" r="3" fill="#fff" />
      <path d="M12 10h8M10.5 12.5l4 7M21.5 12.5l-4 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Data provenance of the loaded log (where the rows came from). */
export function SourceBadge() {
  const { state } = useStore();
  const d = state.dataset;
  if (!d) return <Badge>No data</Badge>;
  if (d.sourceKind === 'ui_fixture') return <Badge tone="amber" title="Small hand-authored log used for interface tests">Test log</Badge>;
  if (d.sourceKind === 'bundled_sample') return <Badge tone="violet" title="Synthetic sample bundled with ProcessPilot">Synthetic sample</Badge>;
  if (d.sourceKind === 'festival_sample') return <Badge tone="violet" title="Generated synthetic Festival log (see Data details)">Synthetic Festival data</Badge>;
  return <Badge tone="blue" title="A file you loaded from your computer; processed locally">Your upload{d.format === 'xes' ? ' · XES' : ' · CSV'}</Badge>;
}

/** Who produced the analysis results currently on screen (shown in Data details). */
export function ProviderBadge() {
  const { provider } = useAnalysis();
  return provider === 'ui_fixture' ? (
    <Badge tone="amber" title="Results are hand-authored fixture values, not computed by src/engine">Results: UI fixture (hand-authored)</Badge>
  ) : (
    <Badge tone="neutral" title="Results computed by the ProcessPilot engine">Results: analysis engine</Badge>
  );
}

/** Engine row index → original file data-row index (identical unless malformed rows were excluded). */
export function sourceRowOf(rowMap: readonly number[], engineRow: number): number {
  return rowMap[engineRow] ?? engineRow;
}

/** Global dataset / process / case-filter scope shared by every page. */
export function ScopeBar({ onMenu, navigate }: { onMenu: () => void; navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const { processKeys, processTraces, selectedTraces, traces } = useAnalysis();
  const { dataset, view } = state;
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);

  // Auto-select the first process once traces are available.
  useEffect(() => {
    if (!view.processKey && processKeys.length) {
      dispatch({ type: 'SET_VIEW', view: { processKey: processKeys[0]! } });
    } else if (view.processKey && processKeys.length && !processKeys.includes(view.processKey)) {
      dispatch({ type: 'SET_VIEW', view: { processKey: processKeys[0]! } });
    }
  }, [processKeys, view.processKey, dispatch]);

  useEffect(() => {
    if (!dateOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dateOpen]);

  const filtered = !!(view.dateFrom || view.dateTo);
  return (
    <header className="relative z-30 flex min-h-[52px] shrink-0 md:sticky md:top-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:px-6">
      <button type="button" className="-ml-1 grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Icon name="layers" className="h-5 w-5" />
      </button>
      {!dataset ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-500">
          <span className="font-medium text-slate-700">No event log loaded</span>
          <span className="hidden sm:inline">· start from a sample on Overview</span>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => navigate('overview')} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-slate-50" title="Dataset — open Overview & Data">
            <Icon name="file" className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="max-w-[220px] truncate text-[13.5px] font-medium text-slate-800">{dataset.metadata?.name ?? dataset.sourceName}</span>
            <SourceBadge />
          </button>
          <span className="hidden h-5 w-px bg-slate-200 sm:block" />
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Process</span>
            <Select
              className="!w-auto !rounded-md !py-1 text-[13px] font-medium"
              value={view.processKey ?? ''}
              disabled={!processKeys.length}
              onChange={(e) => dispatch({ type: 'SET_VIEW', view: { processKey: e.target.value } })}
            >
              {!processKeys.length && <option value="">—</option>}
              {processKeys.map((k) => (
                <option key={k} value={k}>
                  {processLabel(k, dataset.festival)}
                </option>
              ))}
            </Select>
          </label>
          <div className="relative" ref={dateRef}>
            <button
              type="button"
              disabled={!processTraces.length}
              onClick={() => setDateOpen((v) => !v)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] disabled:opacity-50',
                filtered ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50',
              )}
              aria-expanded={dateOpen}
              title="Whole cases are selected by their first event; traces are never cut."
            >
              <Icon name="clock" className="h-4 w-4 opacity-70" />
              {traces?.status === 'ok' ? (
                <span className="tabular">
                  {filtered ? 'Filtered: ' : 'All cases: '}
                  <b className="font-semibold">{selectedTraces.length.toLocaleString('en-US')}</b>
                  {filtered && <span className="text-brand-600"> of {processTraces.length.toLocaleString('en-US')}</span>}
                </span>
              ) : (
                'Case scope'
              )}
              <Icon name="chevronDown" className="h-3.5 w-3.5 opacity-60" />
            </button>
            {dateOpen && (
              <div className="absolute left-0 top-10 z-40 w-[320px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="text-[13px] font-semibold text-slate-800">Cases starting between</div>
                <p className="mt-0.5 text-xs text-slate-500">Selects whole cases by their first event (inclusive). Every page uses this scope; saved records keep the scope they were created in.</p>
                <div className="mt-2 grid gap-2">
                  <Input type="datetime-local" className="text-xs" value={view.dateFrom} onChange={(e) => dispatch({ type: 'SET_VIEW', view: { dateFrom: e.target.value } })} aria-label="Cases starting from" />
                  <Input type="datetime-local" className="text-xs" value={view.dateTo} onChange={(e) => dispatch({ type: 'SET_VIEW', view: { dateTo: e.target.value } })} aria-label="Cases starting to" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Times shown in {VIEWER_TIMEZONE}</span>
                  <div className="flex gap-1">
                    {filtered && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'SET_VIEW', view: { dateFrom: '', dateTo: '' } })}>Clear</Button>}
                    <Button size="sm" variant="primary" onClick={() => setDateOpen(false)}>Done</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
        {dataset?.festival && <Badge tone="violet" title="Festival case-study rules are enabled for this dataset">Festival rules on</Badge>}
        {traces?.status === 'ok' && <span className="hidden tabular xl:inline">{plural(processKeys.length, 'process', 'processes')}</span>}
      </div>
    </header>
  );
}

export function Toasts() {
  const { state, dispatch } = useStore();
  // Each toast dismisses itself 4.5 s after it appears.
  useEffect(() => {
    const timers = state.toasts.map((t) => setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id: t.id }), 4500));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts, dispatch]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {state.toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto rounded-lg border px-3 py-2 text-[13px] shadow-lg',
            t.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            t.tone === 'info' && 'border-slate-200 bg-white text-slate-800',
            t.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
            t.tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => dispatch({ type: 'DISMISS_TOAST', id: t.id })} aria-label="Dismiss">
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shown on analysis pages when there is no analyzable dataset/process yet. */
export function RequireData({ children, navigate }: { children: ReactNode; navigate: (p: PageId) => void }) {
  const { state } = useStore();
  const { traces, selectedTraces, processTraces } = useAnalysis();
  if (!state.dataset) {
    return (
      <EmptyPanel
        icon="file"
        title="Load an event log to begin"
        body="Every page works on the same event log. Start with the Order Processing sample (one click) or upload your own CSV or XES file."
        action={<Button variant="primary" iconRight="arrowRight" onClick={() => navigate('overview')}>Choose data</Button>}
      />
    );
  }
  if (!traces || traces.status !== 'ok') {
    return (
      <EmptyPanel
        icon="alert"
        title="The event log needs attention before analysis"
        body={traces?.message ?? 'Validation has not completed.'}
        action={<Button onClick={() => navigate('overview')}>Review the data check</Button>}
      />
    );
  }
  if (!processTraces.length) {
    return <EmptyPanel icon="inbox" title="No cases in the selected process" body="Choose another process in the top bar." />;
  }
  if (!selectedTraces.length) {
    return <EmptyPanel icon="clock" title="No cases match the current case scope" body="Widen or clear the case start range in the top bar." />;
  }
  return <>{children}</>;
}

function EmptyPanel({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon: IconName }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[13.5px] leading-relaxed text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** "Next step" call-to-action strip at the bottom/right of a page. */
export function NextStep({ label, hint, onClick, disabled }: { label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
      <Button variant="primary" iconRight="arrowRight" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}
