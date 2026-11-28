import { useState } from 'react';
import { useAnalysis } from '../state/analysis';
import { useStore } from '../state/store';
import { caseLabel, fmtInstant, fmtMinutes, plural } from '../lib/format';
import { Badge, Button, Table, Td, Th, cx } from './ui';
import { sourceRowOf } from './layout';

/** Clickable list of contributing cases; opens the global trace drawer. */
export function CaseKeyList({ caseKeys, limit = 40 }: { caseKeys: readonly string[]; limit?: number }) {
  const { dispatch } = useStore();
  const [showAll, setShowAll] = useState(false);
  if (!caseKeys.length) return <div className="text-sm text-slate-500">No contributing cases supplied.</div>;
  const shown = showAll ? caseKeys : caseKeys.slice(0, limit);
  return (
    <div>
      <div className="mb-1.5 text-xs text-slate-500">{plural(caseKeys.length, 'contributing case')}</div>
      <div className="flex max-h-56 flex-wrap gap-1 overflow-auto">
        {shown.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: k } })}
            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:border-brand-500 hover:text-brand-700"
            title={k}
          >
            {caseLabel(k)}
          </button>
        ))}
      </div>
      {caseKeys.length > limit && (
        <button type="button" className="mt-1.5 text-xs font-medium text-brand-600 hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${caseKeys.length}`}
        </button>
      )}
    </div>
  );
}

export function CaseDrawer() {
  const { state, dispatch } = useStore();
  const { traceByKey } = useAnalysis();
  const key = state.view.selectedCaseKey;
  if (!key) return null;
  const trace = traceByKey.get(key);
  const close = () => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: null } });
  const seqIds = new Set(trace?.sequence.map((e) => e.sourceOrder));
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={close}>
      <aside
        className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Case trace"
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Case trace</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-slate-900">{caseLabel(key)}</div>
            {trace && (
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <Badge>{trace.processType}</Badge>
                <span>{plural(trace.events.length, 'accepted row')}</span>
                <span>· {plural(trace.sequence.length, 'discovery event')}</span>
                <span>· elapsed {fmtMinutes(trace.elapsedMin)}</span>
              </div>
            )}
          </div>
          <Button variant="ghost" onClick={close} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-5">
          {!trace ? (
            <div className="text-sm text-slate-500">This case is not part of the current dataset.</div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
                {trace.sequence.length === 0 ? (
                  <span className="text-slate-500">Empty discovery sequence (start-only case).</span>
                ) : (
                  trace.sequence.map((e, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-slate-300">→</span>}
                      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">{e.activity}</span>
                    </span>
                  ))
                )}
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Activity</Th>
                    <Th>Lifecycle</Th>
                    <Th>Timestamp</Th>
                    <Th>Resource</Th>
                    <Th>Instance</Th>
                  </tr>
                </thead>
                <tbody>
                  {trace.events.map((e) => (
                    <tr key={e.sourceOrder} className={cx(!seqIds.has(e.sourceOrder) && 'text-slate-400')}>
                      <Td className="font-mono text-xs">{sourceRowOf(state.dataset?.rowMap ?? [], e.sourceOrder)}</Td>
                      <Td>{e.activity}</Td>
                      <Td>
                        <Badge tone={e.lifecycle === 'start' ? 'neutral' : e.lifecycle === 'complete' ? 'brand' : 'violet'}>{e.lifecycle}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {fmtInstant(e.timestampMs)}
                        <div className="font-mono text-[10px] text-slate-400">{e.rawTimestamp}</div>
                      </Td>
                      <Td>{e.resource ?? <span className="italic text-slate-400">missing</span>}</Td>
                      <Td className="font-mono text-xs">{e.instanceId ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-slate-400">
                Grey rows are lifecycle starts, kept for duration analysis but not used in discovery sequences. # is the zero-based data row of the original file.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
