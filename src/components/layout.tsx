import { useEffect, useState, type ReactNode } from 'react';
import { useAnalysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import type { PageId } from '../state/types';
import { plural, processLabel, VIEWER_TIMEZONE } from '../lib/format';
import { Badge, Button, Input, Select, cx } from './ui';

export const PAGES: { id: PageId; label: string; phase?: string; icon: string }[] = [
  { id: 'overview', label: 'Overview & Data', icon: '▦' },
  { id: 'analysis', label: 'Analysis', phase: '1', icon: '◈' },
  { id: 'design', label: 'Design', phase: '2', icon: '✎' },
  { id: 'model', label: 'Model', phase: '3', icon: '⚙' },
  { id: 'implementation', label: 'Implementation', phase: '4', icon: '☑' },
  { id: 'monitor', label: 'Monitor & Control', phase: '5', icon: '◔' },
  { id: 'refine', label: 'Refine & Improve', phase: '6', icon: '↻' },
  { id: 'export', label: 'Evidence Export', icon: '⇩' },
];

export function useHashRoute(): [PageId, (p: PageId) => void] {
  const read = (): PageId => {
    const id = window.location.hash.replace(/^#\/?/, '') as PageId;
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
    window.scrollTo({ top: 0 });
  };
  return [page, navigate];
}

export function Sidebar({ page, navigate }: { page: PageId; navigate: (p: PageId) => void }) {
  const { state } = useStore();
  const ws = useWorkspace();
  const { findings, evaluations } = useAnalysis();
  const breaches = evaluations?.status === 'ok' ? evaluations.data.filter((e) => e.status === 'breached').length : 0;
  const counts: Partial<Record<PageId, number>> = {
    analysis: findings?.status === 'ok' ? findings.data.length : undefined,
    design: ws?.designs.length || undefined,
    implementation: ws?.plans.filter((p) => p.state === 'current').length || undefined,
    monitor: breaches || undefined,
  };
  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-sm font-bold text-white">P</div>
        <div>
          <div className="text-sm font-semibold text-white">ProcessPilot</div>
          <div className="text-[11px] text-slate-400">Process intelligence</div>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3">
        {[
          { group: 'Workspace', items: PAGES.slice(0, 1) },
          { group: 'BPM lifecycle', items: PAGES.slice(1, 7) },
          { group: 'Evidence', items: PAGES.slice(7) },
        ].map(({ group, items }) => (
          <div key={group} className="mb-4">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group}</div>
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(p.id)}
                className={cx(
                  'mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition',
                  page === p.id ? 'bg-slate-800 font-medium text-white' : 'hover:bg-slate-800/60 hover:text-white',
                )}
                aria-current={page === p.id ? 'page' : undefined}
              >
                <span className="w-4 text-center text-slate-500" aria-hidden>
                  {p.icon}
                </span>
                <span className="flex-1">
                  {p.phase && <span className="mr-1.5 text-[11px] text-slate-500 tabular">{p.phase}.</span>}
                  {p.label}
                </span>
                {counts[p.id] !== undefined && (
                  <span
                    className={cx(
                      'rounded px-1.5 text-[10px] font-semibold tabular',
                      p.id === 'monitor' ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-200',
                    )}
                  >
                    {counts[p.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
        {state.dataset ? (
          <>
            Dataset <span className="font-mono text-slate-400">{state.dataset.id}</span>
            <br />
          </>
        ) : null}
        All data is processed locally in this browser. No live monitoring.
      </div>
    </nav>
  );
}

/** Data provenance of the loaded log (where the rows came from). */
export function SourceBadge() {
  const { state } = useStore();
  const d = state.dataset;
  if (!d) return <Badge>No dataset</Badge>;
  if (d.sourceKind === 'ui_fixture') return <Badge tone="neutral" title="20-row test CSV bundled with the UI">UI fixture CSV</Badge>;
  if (d.sourceKind === 'festival_sample') return <Badge tone="violet">Synthetic Festival log</Badge>;
  return <Badge tone="blue">User-uploaded log</Badge>;
}

/** Who produced the analysis results currently on screen. */
export function ProviderBadge() {
  const { provider } = useAnalysis();
  return provider === 'ui_fixture' ? (
    <Badge tone="amber" title="Results are hand-authored fixture values, not computed by src/engine">Provider: UI fixture (hand-authored)</Badge>
  ) : (
    <Badge tone="neutral" title="Results computed by src/engine">Provider: engine</Badge>
  );
}

/** Engine row index → original file data-row index (identical unless malformed rows were excluded). */
export function sourceRowOf(rowMap: readonly number[], engineRow: number): number {
  return rowMap[engineRow] ?? engineRow;
}

/** Global dataset / process / case-filter scope shared by every page. */
export function ScopeBar() {
  const { state, dispatch } = useStore();
  const { processKeys, processTraces, selectedTraces, traces } = useAnalysis();
  const { dataset, view } = state;

  // Auto-select the first process once traces are available.
  useEffect(() => {
    if (!view.processKey && processKeys.length) {
      dispatch({ type: 'SET_VIEW', view: { processKey: processKeys[0]! } });
    } else if (view.processKey && processKeys.length && !processKeys.includes(view.processKey)) {
      dispatch({ type: 'SET_VIEW', view: { processKey: processKeys[0]! } });
    }
  }, [processKeys, view.processKey, dispatch]);

  const filtered = !!(view.dateFrom || view.dateTo);
  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white/95 px-6 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-medium text-slate-400">Dataset</span>
        <span className="max-w-[260px] truncate text-sm font-medium text-slate-800" title={dataset?.sourceName}>
          {dataset?.sourceName ?? '—'}
        </span>
        <SourceBadge />
      </div>
      <div className="h-5 w-px bg-slate-200" />
      <label className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-400">Process</span>
        <Select
          className="!w-auto !py-1"
          value={view.processKey ?? ''}
          disabled={!processKeys.length}
          onChange={(e) => dispatch({ type: 'SET_VIEW', view: { processKey: e.target.value } })}
        >
          {!processKeys.length && <option value="">—</option>}
          {processKeys.map((k) => (
            <option key={k} value={k}>
              {processLabel(k, dataset?.festival)}{processLabel(k, dataset?.festival) !== k ? ` (${k})` : ''}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-400" title="Whole cases are selected by their first event; traces are never truncated.">
          Cases starting
        </span>
        <Input
          type="datetime-local"
          className="!w-auto !py-1 text-xs"
          value={view.dateFrom}
          disabled={!processTraces.length}
          onChange={(e) => dispatch({ type: 'SET_VIEW', view: { dateFrom: e.target.value } })}
          aria-label="From"
        />
        <span className="text-xs text-slate-400">to</span>
        <Input
          type="datetime-local"
          className="!w-auto !py-1 text-xs"
          value={view.dateTo}
          disabled={!processTraces.length}
          onChange={(e) => dispatch({ type: 'SET_VIEW', view: { dateTo: e.target.value } })}
          aria-label="To"
        />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'SET_VIEW', view: { dateFrom: '', dateTo: '' } })}>
            Clear
          </Button>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
        {traces?.status === 'ok' && (
          <span className="tabular">
            <span className="font-semibold text-slate-800">{selectedTraces.length.toLocaleString('en-US')}</span> of{' '}
            {plural(processTraces.length, 'case')}
            {filtered && <Badge tone="brand">filtered</Badge>}
          </span>
        )}
        <span title="Timestamps are stored in UTC and displayed in this timezone">TZ {VIEWER_TIMEZONE}</span>
        {dataset?.festival && <Badge tone="violet">Festival adapters on</Badge>}
        <ProviderBadge />
      </div>
    </div>
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
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {state.toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'rounded-md border px-3 py-2 text-sm shadow-lg',
            t.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            t.tone === 'info' && 'border-slate-200 bg-white text-slate-800',
            t.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
            t.tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => dispatch({ type: 'DISMISS_TOAST', id: t.id })}>
              ✕
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
        title="No dataset loaded"
        body="Load the UI fixture, the Festival sample, or upload a CSV event log in Overview & Data."
        action={<Button variant="primary" onClick={() => navigate('overview')}>Go to Overview & Data</Button>}
      />
    );
  }
  if (!traces || traces.status !== 'ok') {
    return (
      <EmptyPanel
        title="Dataset is not ready for analysis"
        body={traces?.message ?? 'Validation has not completed.'}
        action={<Button onClick={() => navigate('overview')}>Review validation</Button>}
      />
    );
  }
  if (!processTraces.length) {
    return <EmptyPanel title="No cases in the selected process" body="The dataset has no discovered cases for this process." />;
  }
  if (!selectedTraces.length) {
    return <EmptyPanel title="No cases match the current filter" body="Widen or clear the case start filter in the top bar." />;
  }
  return <>{children}</>;
}

function EmptyPanel({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
