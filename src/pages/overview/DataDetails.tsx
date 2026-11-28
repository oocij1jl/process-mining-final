/** Data check (validation), consent and the collapsed Advanced Data Details. */
import { useMemo, useState } from 'react';
import type { Issue } from '../../contracts';
import type { XesIssue } from '../../v03-contracts';
import { ENGINE_FUNCTIONS, V03_FUNCTIONS, hasCapability, type EngineResult } from '../../adapters/engineAdapter';
import { useAnalysis } from '../../state/analysis';
import { useStore } from '../../state/store';
import { caseLabel, fmtInstant, fmtMinutes, plural } from '../../lib/format';
import { ProviderBadge, SourceBadge, sourceRowOf } from '../../components/layout';
import { Badge, Button, Card, EngineGate, Input, KeyValue, Notice, Segmented, Table, Td, Th } from '../../components/ui';
import { RawTable, xesLocation } from './DataImport';

/** Validation summary with exclusion consent. Invalid rows are never discarded silently. */
export function DataCheck() {
  const { state, dispatch } = useStore();
  const { validation } = useAnalysis();
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning'>('all');
  if (!validation) return null;
  return (
    <EngineGate result={validation}>
      {(v) => {
        const errors = v.issues.filter((i) => i.severity === 'error');
        const warnings = v.issues.filter((i) => i.severity === 'warning');
        const errorRows = new Set(errors.filter((i) => i.row >= 0).map((i) => i.row)).size;
        const importWide = errors.filter((i) => i.row < 0).length;
        const shown = v.issues.filter((i) => severity === 'all' || i.severity === severity);
        return (
          <div className="space-y-3">
            {v.canAnalyze ? (
              <Notice tone="success" title="Data check passed">
                {plural(v.events.length, 'event')} accepted of {plural(v.rawCount, 'row')}.
                {state.dataset?.acceptExclusions && v.excludedCount > 0 && ` ${plural(v.excludedCount, 'row')} excluded with your consent.`}
                {warnings.length > 0 && ` ${plural(warnings.length, 'warning')} to review below.`}
              </Notice>
            ) : (
              <Notice tone="error" title="Analysis is blocked until the data check is resolved">
                {v.events.length === 0 && errors.length === 0
                  ? 'No usable rows remain in this file.'
                  : 'Some rows have errors. Fix them in the source file, or explicitly exclude them and analyse the remaining valid rows.'}
                {importWide > 0 && (
                  <div className="mt-1 text-xs">{plural(importWide, 'file-wide error')} (for example a missing required column) cannot be excluded row by row; fix the mapping or the file.</div>
                )}
                {errorRows > 0 && !state.dataset?.acceptExclusions && (
                  <label className="mt-2 flex items-start gap-2 font-medium">
                    <input type="checkbox" className="mt-1" onChange={(e) => dispatch({ type: 'SET_ACCEPT_EXCLUSIONS', accept: e.target.checked })} />
                    Exclude the {plural(errorRows, 'row')} with errors and analyse the remaining valid rows.
                  </label>
                )}
              </Notice>
            )}
            {state.dataset?.acceptExclusions && (
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'SET_ACCEPT_EXCLUSIONS', accept: false })}>
                Withdraw exclusion consent
              </Button>
            )}
            {v.issues.length > 0 && (
              <details className="rounded-lg border border-slate-200 bg-white px-3 py-2" open={!v.canAnalyze}>
                <summary className="cursor-pointer text-[13px] font-medium text-slate-700">
                  {plural(errors.length, 'error')} · {plural(warnings.length, 'warning')} — show details
                </summary>
                <div className="mt-2 mb-2">
                  <Segmented size="sm" value={severity} onChange={setSeverity} options={[{ id: 'all', label: 'All' }, { id: 'error', label: 'Errors' }, { id: 'warning', label: 'Warnings' }]} ariaLabel="Issue severity" />
                </div>
                <IssueTable issues={shown} rowMap={state.dataset?.rowMap ?? []} xes={state.dataset?.format === 'xes'} />
              </details>
            )}
          </div>
        );
      }}
    </EngineGate>
  );
}

function IssueTable({ issues, rowMap, xes }: { issues: Issue[]; rowMap: number[]; xes: boolean }) {
  const [limit, setLimit] = useState(100);
  return (
    <>
      <Table className="max-h-80">
        <thead>
          <tr>
            <Th>{xes ? 'Where' : 'File row'}</Th>
            <Th>Severity</Th>
            <Th>Field</Th>
            <Th>Code</Th>
            <Th>Message</Th>
          </tr>
        </thead>
        <tbody>
          {issues.slice(0, limit).map((i, idx) => (
            <tr key={idx}>
              <Td className="whitespace-nowrap font-mono text-xs">{xes ? xesLocation(i as XesIssue) : i.row < 0 ? 'file' : sourceRowOf(rowMap, i.row)}</Td>
              <Td><Badge tone={i.severity === 'error' ? 'red' : 'amber'}>{i.severity}</Badge></Td>
              <Td className="font-mono text-xs">{i.field}</Td>
              <Td className="font-mono text-xs">{i.code}</Td>
              <Td>{i.message}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {issues.length > limit && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLimit((l) => l + 200)}>
          Show more ({issues.length - limit} remaining)
        </Button>
      )}
    </>
  );
}

export function TraceTable() {
  const { dispatch } = useStore();
  const { selectedTraces } = useAnalysis();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const shown = useMemo(
    () => (q ? selectedTraces.filter((t) => caseLabel(t.caseKey).toLowerCase().includes(q.toLowerCase())) : selectedTraces),
    [selectedTraces, q],
  );
  return (
    <Card
      title="Cases"
      subtitle="Every case in the current process and case scope. Click a case to see its full timeline."
      actions={<Input placeholder="Search case ID" className="!w-48 !py-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search case ID" />}
    >
      <Table className="max-h-96">
        <thead>
          <tr>
            <Th>Case</Th>
            <Th>First event</Th>
            <Th align="right">Rows</Th>
            <Th align="right">Steps</Th>
            <Th align="right">Observed span</Th>
            <Th>Sequence</Th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, limit).map((t) => (
            <tr key={t.caseKey} className="cursor-pointer hover:bg-slate-50" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: t.caseKey } })}>
              <Td className="font-mono text-xs font-medium text-brand-700">{caseLabel(t.caseKey)}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtInstant(t.events[0]?.timestampMs)}</Td>
              <Td align="right">{t.events.length}</Td>
              <Td align="right">{t.sequence.length || <Badge tone="amber">none</Badge>}</Td>
              <Td align="right">{fmtMinutes(t.elapsedMin)}</Td>
              <Td className="max-w-md truncate text-xs text-slate-500">{t.sequence.map((e) => e.activity).join(' → ')}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {shown.length > limit && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLimit((l) => l + 100)}>
          Show more ({shown.length - limit} remaining)
        </Button>
      )}
    </Card>
  );
}

/** Developer diagnostics: engine call states and optional capability inventory. */
function EngineStatus() {
  const a = useAnalysis();
  const { state } = useStore();
  const results: Partial<Record<string, EngineResult<unknown> | null>> = {
    validateAndNormalize: state.dataset?.format === 'xes' ? null : a.validation,
    importXes: a.xesImport,
    groupCases: a.traces,
    buildDFG: a.dfg,
    getVariants: a.variants,
    getCaseDurations: a.durations,
    getPerformance: a.performance,
    getResourceAnalysis: a.resources,
    getKPIs: a.kpis,
    getFindings: a.findings,
    evaluateTargets: a.evaluations,
    getActivityEvidence: a.activityEvidence,
  };
  const tone = (s?: string) => (s === 'ok' ? 'green' : s === 'error' ? 'red' : s === 'not_implemented' || s === 'fixture_unavailable' ? 'amber' : 'neutral');
  const row = (fn: string, label: string, status?: string, title?: string) => (
    <div key={fn} className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5" title={title}>
      <code className="font-mono text-xs text-slate-700">{fn}</code>
      <Badge tone={tone(status)}>{label}</Badge>
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-600">Phase 2 baseline (required) — status for the current scope</div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {ENGINE_FUNCTIONS.map((fn) => {
            const r = results[fn];
            const label = fn === 'getGateInputs' || fn === 'simulateGateQueue' ? 'on demand (Refine)' : r ? r.status.replace('_', ' ') : 'not called';
            return row(fn, label, r?.status, r && r.status !== 'ok' ? r.message : undefined);
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-600">v0.3 optional capabilities in this build</div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {V03_FUNCTIONS.map((fn) => {
            const present = hasCapability(a.api, fn);
            const r = results[fn];
            return row(fn, !present ? 'not in build' : r ? r.status.replace('_', ' ') : 'available', present ? r?.status ?? 'ok' : 'not_implemented');
          })}
        </div>
      </div>
    </div>
  );
}

export function AdvancedDataDetails() {
  const { state, dispatch } = useStore();
  const dataset = state.dataset!;
  const analysis = useAnalysis();
  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[13.5px] font-semibold text-slate-800">
        Advanced data details
        <span className="text-xs font-normal text-slate-500">mapping, raw rows, engine diagnostics</span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4">
        <div className="grid gap-6 md:grid-cols-2">
          <KeyValue
            items={[
              ['Source', <span className="inline-flex items-center gap-2">{dataset.sourceName} <SourceBadge /></span>],
              ['Format', dataset.format === 'xes' ? 'XES (trace-based subset)' : 'CSV'],
              ['Results', <ProviderBadge />],
              ['Dataset revision', <code className="font-mono text-xs">{dataset.id}</code>],
              ['File rows', `${plural(dataset.fileRowCount, dataset.format === 'xes' ? 'event' : 'data row')}${dataset.malformedRows.length ? ` · ${dataset.malformedRows.length} malformed excluded with consent · ${dataset.rows.length} sent to validation` : ''}`],
              ['Mapping', <span className="font-mono text-xs">{Object.entries(dataset.mapping).filter(([, v]) => v).map(([k, v]) => (k === v ? k : `${k}←${v}`)).join(', ')}</span>],
            ]}
          />
          <KeyValue
            items={[
              ['Missing-resource values', <span className="font-mono text-xs">{dataset.missingResources.map((v) => (v === '' ? '(blank)' : v)).join(', ')}</span>],
              ['Fixed offset', dataset.fixedOffset ?? 'none (explicit offsets required)'],
              ['Festival rules', dataset.festival ? (dataset.manifest ? 'on (Festival manifest)' : 'on (explicit)') : 'off (general process log)'],
              ['Festival import checks', dataset.festival ? 'on (festivalValidation: true)' : 'off (festivalValidation: false)'],
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {dataset.format !== 'xes' && (
            <Button size="sm" onClick={() => dispatch({ type: 'SET_FESTIVAL', enabled: !dataset.festival })}>
              {dataset.festival ? 'Turn Festival rules off' : 'Turn Festival rules on'}
            </Button>
          )}
        </div>
        {analysis.provider === 'ui_fixture' && (
          <Notice tone="fixture" title="Results provider: UI fixture (hand-authored values)">
            Values come from hand-calculated test values in <code className="font-mono text-xs">src/adapters/fixtures/uiFixture.ts</code>, not from the engine.
          </Notice>
        )}
        <Card title="Engine connection" subtitle="For developers. Users do not need this to analyse a log.">
          <EngineStatus />
        </Card>
        {dataset.malformedRows.length > 0 && (
          <Card title="Excluded malformed rows" subtitle="Excluded before validation with explicit consent (wrong number of columns). Row numbers refer to the original file.">
            <Table className="max-h-60">
              <thead><tr><Th>File row</Th><Th>Code</Th><Th>Reason</Th></tr></thead>
              <tbody>
                {dataset.malformedRows.map((m) => (
                  <tr key={m.sourceRow}><Td className="font-mono text-xs">{m.sourceRow}</Td><Td className="font-mono text-xs">{m.code}</Td><Td>{m.message}</Td></tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        {dataset.format !== 'xes' && (
          <Card title="Raw rows" subtitle="Rows sent to validation, in source order. Row numbers are zero-based data rows of the original file.">
            <RawTable headers={dataset.headers} rows={dataset.rows.slice(0, 50)} mapping={dataset.mapping} rowNumbers={dataset.rowMap} />
            {dataset.rows.length > 50 && <p className="mt-2 text-xs text-slate-400">Showing 50 of {dataset.rows.length} rows.</p>}
          </Card>
        )}
      </div>
    </details>
  );
}
