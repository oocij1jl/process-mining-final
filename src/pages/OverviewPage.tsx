import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { DEFAULT_MISSING_RESOURCES, type ColumnMapping, type DatasetMetadata, type Issue } from '../contracts';
import { ENGINE_FUNCTIONS, type EngineResult } from '../adapters/engineAdapter';
import { UI_FIXTURE_CSV, UI_FIXTURE_DATASET_NAME } from '../adapters/fixtures/uiFixture';
import { FESTIVAL_FIELDS, parseManifest, settingsFromManifest, type FestivalManifest } from '../festival/adapter';
import { useAnalysis } from '../state/analysis';
import { datasetIdFor, useStore } from '../state/store';
import type { DatasetState, PageId, SourceKind } from '../state/types';
import { downloadText, engineRows, fingerprint, parseCsv, type ParsedCsv } from '../lib/files';
import { caseLabel, fmtInstant, fmtMinutes, plural, processLabel } from '../lib/format';
import { ProviderBadge, SourceBadge, sourceRowOf } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  EngineGate,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Th,
  cx,
} from '../components/ui';

const REQUIRED = ['case_id', 'activity', 'timestamp'] as const;
/** General event-log fields (DATA_SCHEMA §1). Festival case-study fields are listed separately. */
const OPTIONAL = ['event_id', 'process_type', 'lifecycle', 'activity_instance_id', 'resource', 'resource_id', 'resource_role', 'cost'] as const;
const ALL_FIELDS: readonly string[] = [...REQUIRED, ...OPTIONAL, ...FESTIVAL_FIELDS];

type ManifestState =
  | { status: 'loading' }
  | { status: 'missing'; message: string }
  | { status: 'ready'; manifest: FestivalManifest; warnings: string[] };

function useFestivalManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}datasets/dataset_manifest.json`, { cache: 'no-cache' })
      .then(async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('json')) throw new Error('dataset_manifest.json is not published yet.');
        const { manifest, errors } = parseManifest(await res.json());
        if (!manifest) throw new Error(`Invalid dataset_manifest.json: ${errors.join(' ')}`);
        if (!cancelled) setState({ status: 'ready', manifest, warnings: errors });
      })
      .catch((e: unknown) => !cancelled && setState({ status: 'missing', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function autoMapping(headers: string[]): Record<string, string> {
  const lower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  const alias: Record<string, string[]> = {
    case_id: ['case_id', 'case', 'caseid', 'case:concept:name'],
    activity: ['activity', 'concept:name', 'activity_name', 'event'],
    timestamp: ['timestamp', 'time:timestamp', 'time', 'datetime'],
    resource: ['resource', 'org:resource'],
    lifecycle: ['lifecycle', 'lifecycle:transition'],
  };
  const out: Record<string, string> = {};
  for (const field of ALL_FIELDS) {
    for (const name of alias[field] ?? [field]) {
      const hit = lower.get(name);
      if (hit && !Object.values(out).includes(hit)) {
        out[field] = hit;
        break;
      }
    }
  }
  return out;
}

interface Draft {
  sourceName: string;
  sourceKind: SourceKind;
  text: string;
  parsed: ParsedCsv;
  mapping: Record<string, string>;
  missingResources: string;
  fixedOffset: string;
  requireProcessType: boolean;
  metadata?: DatasetMetadata;
  festival: boolean;
  manifest?: FestivalManifest;
  /** Explicit consent to exclude structurally malformed rows (required when any exist). */
  excludeMalformed: boolean;
}

function draftFromText(text: string, sourceName: string, sourceKind: SourceKind, extra?: Partial<Draft>): Draft {
  const parsed = parseCsv(text);
  return {
    sourceName,
    sourceKind,
    text,
    parsed,
    mapping: autoMapping(parsed.headers),
    missingResources: DEFAULT_MISSING_RESOURCES.map((v) => (v === '' ? '(blank)' : v)).join(', '),
    fixedOffset: '',
    requireProcessType: false,
    festival: false,
    excludeMalformed: false,
    ...extra,
  };
}

function parsePlaceholders(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .map((s) => (s === '(blank)' ? '' : s));
}

export function OverviewPage({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const manifest = useFestivalManifest();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const commit = (d: Draft) => {
    if (d.parsed.malformed.length && !d.excludeMalformed) return; // consent required, never silent
    const mapping = Object.fromEntries(Object.entries(d.mapping).filter(([, v]) => v)) as unknown as ColumnMapping;
    const { rows, rowMap } = engineRows(d.parsed);
    const base: Omit<DatasetState, 'id'> = {
      contentFingerprint: fingerprint(d.text),
      sourceName: d.sourceName,
      sourceKind: d.sourceKind,
      headers: d.parsed.headers,
      rows,
      rowMap,
      malformedRows: d.parsed.malformed,
      fileRowCount: d.parsed.rows.length,
      rawText: d.text,
      mapping,
      missingResources: parsePlaceholders(d.missingResources),
      fixedOffset: d.fixedOffset.trim() || undefined,
      acceptExclusions: false,
      requireProcessType: d.requireProcessType,
      metadata: d.metadata,
      festival: d.festival,
      festivalSettings: d.festival ? settingsFromManifest(d.manifest) : undefined,
      manifest: d.manifest,
      loadedAt: Date.now(),
    };
    dispatch({ type: 'LOAD_DATASET', dataset: { ...base, id: datasetIdFor(base) } });
    dispatch({ type: 'TOAST', tone: 'success', message: `Loaded ${d.sourceName}` });
    setDraft(null);
  };

  const loadFixture = () => {
    // Festival adapters are enabled explicitly because the fixture's audience cases use the
    // Festival audience schema; they can be switched off in the Dataset card.
    const d = draftFromText(UI_FIXTURE_CSV, UI_FIXTURE_DATASET_NAME, 'ui_fixture', {
      festival: true,
      metadata: { name: UI_FIXTURE_DATASET_NAME, sourceType: 'synthetic', timezone: 'UTC', serviceActivity: 'Ticket Verification' },
    });
    commit(d);
  };

  const loadFestival = async () => {
    if (manifest.status !== 'ready') return;
    const m = manifest.manifest;
    setLoadError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}datasets/${m.csv}`);
      if (!res.ok) throw new Error(`Could not fetch datasets/${m.csv} (${res.status}).`);
      const text = await res.text();
      setDraft(
        draftFromText(text, m.name ?? m.csv, 'festival_sample', {
          requireProcessType: true,
          festival: true,
          manifest: m,
          ...(m.missing_resource_values
            ? { missingResources: m.missing_resource_values.map((v) => (v === '' ? '(blank)' : v)).join(', ') }
            : {}),
          metadata: {
            name: m.name ?? m.csv,
            sourceType: m.source_type ?? 'synthetic',
            timezone: m.timezone,
            sourceReferences: m.source_references,
            assumptions: m.assumptions,
            baselineGateCount: m.baseline_gate_count,
            serviceActivity: m.service_activity,
          },
        }),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const readFile = (file: File) => {
    setLoadError(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setLoadError(`${file.name} is not a CSV file. XES import is not supported in the browser (P1: convert outside).`);
      return;
    }
    file.text().then(
      (text) => {
        const d = draftFromText(text, file.name, 'user_upload');
        if (!d.parsed.headers.length) setLoadError('The file has no header row.');
        else setDraft(d);
      },
      (e: unknown) => setLoadError(String(e)),
    );
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const editMapping = () => {
    const d = state.dataset;
    if (!d) return;
    setDraft({
      sourceName: d.sourceName,
      sourceKind: d.sourceKind,
      text: d.rawText,
      parsed: parseCsv(d.rawText),
      mapping: { ...(d.mapping as unknown as Record<string, string>) },
      missingResources: d.missingResources.map((v) => (v === '' ? '(blank)' : v)).join(', '),
      fixedOffset: d.fixedOffset ?? '',
      requireProcessType: d.requireProcessType,
      metadata: d.metadata,
      festival: d.festival,
      manifest: d.manifest,
      excludeMalformed: d.malformedRows.length > 0,
    });
  };

  return (
    <div>
      <PageHeader
        title="Overview & Data"
        subtitle="Load an event log, map its columns, review validation and pick the process to analyse. Every lifecycle page uses this same dataset and filter scope."
        actions={
          <Button onClick={() => downloadText('processpilot-ui-fixture.csv', UI_FIXTURE_CSV, 'text/csv')}>Download UI fixture CSV</Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="UI fixture" subtitle="20-row test log for UI checks (not a Festival dataset)">
          <p className="text-sm text-slate-600">
            Two generic cases plus three audience entries in the Festival audience schema. Small hand-authored test data, not the
            Festival dataset and not observed data. Analysed by the engine like any other log; see the provider badge in the scope bar.
          </p>
          <Button className="mt-3" onClick={loadFixture}>
            Load UI fixture
          </Button>
        </Card>
        <Card title="Festival sample" subtitle="Synthetic Demo Festival Operations log">
          {manifest.status === 'loading' && <p className="text-sm text-slate-500">Checking for the published sample…</p>}
          {manifest.status === 'missing' && (
            <>
              <p className="text-sm text-slate-600">Not available yet. The business/data track publishes it to <code className="font-mono text-xs">public/datasets/</code>.</p>
              <p className="mt-1 text-xs text-slate-400">{manifest.message}</p>
              <Button className="mt-3" disabled>
                Load Festival sample
              </Button>
            </>
          )}
          {manifest.status === 'ready' && (
            <>
              <KeyValue
                items={[
                  ['Name', manifest.manifest.name ?? '—'],
                  ['Generator', `${manifest.manifest.generator?.version ?? '—'} · seed ${manifest.manifest.generator?.seed ?? '—'}`],
                ]}
              />
              {manifest.warnings.length > 0 && (
                <div className="mt-2">
                  <Notice tone="warning" title="Manifest fields ignored">{manifest.warnings.join(' ')}</Notice>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={loadFestival}>
                  Load Festival sample
                </Button>
                <a className="inline-flex h-9 items-center px-2 text-sm font-medium text-brand-600 hover:underline" href={`${import.meta.env.BASE_URL}datasets/${manifest.manifest.csv}`} download>
                  Download CSV
                </a>
              </div>
              {[...Object.entries(manifest.manifest.bpmn ?? {}).map(([k, f]) => [`${k} As-is`, f] as const), ...Object.entries(manifest.manifest.bpmn_to_be ?? {}).map(([k, f]) => [`${k} To-be`, f] as const)].length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-slate-400">BPMN:</span>
                  {[...Object.entries(manifest.manifest.bpmn ?? {}).map(([k, f]) => [`${k} As-is`, f] as const), ...Object.entries(manifest.manifest.bpmn_to_be ?? {}).map(([k, f]) => [`${k} To-be`, f] as const)].map(([label, f]) => (
                    <a key={label} className="font-medium text-brand-600 hover:underline" href={`${import.meta.env.BASE_URL}bpmn/${f}`} download>
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
        <Card title="Upload CSV" subtitle="Minimum columns: case_id, activity, timestamp">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400',
            )}
          >
            <span className="font-medium text-slate-700">Drop a CSV here or click to browse</span>
            <span className="mt-1 text-xs text-slate-400">Processed locally. Not uploaded anywhere.</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          </label>
        </Card>
      </div>

      {loadError && (
        <div className="mt-4">
          <Notice tone="error" title="Could not load the file">
            {loadError}
          </Notice>
        </div>
      )}

      {draft && <MappingEditor draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onCommit={commit} />}

      {!draft && state.dataset && <LoadedDataset navigate={navigate} onEditMapping={editMapping} />}

      {!draft && !state.dataset && (
        <div className="mt-6">
          <EmptyState title="No dataset loaded" icon="▦">
            Choose a source above. Browser refresh clears the dataset, but saved targets, designs and plans are restored when the same file and mapping are loaded again.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function MappingEditor({
  draft,
  onChange,
  onCancel,
  onCommit,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onCommit: (d: Draft) => void;
}) {
  const used = Object.entries(draft.mapping).filter(([, v]) => v);
  const missingRequired = REQUIRED.filter((f) => !draft.mapping[f]);
  const dupHeaders = used.map(([, v]) => v).filter((v, i, a) => a.indexOf(v) !== i);
  const offsetInvalid = !!draft.fixedOffset && !/^(Z|[+-](0\d|1[0-4]):[0-5]\d)$/.test(draft.fixedOffset.trim());
  const processTypeMissing = draft.requireProcessType && !draft.mapping.process_type;
  const malformed = draft.parsed.malformed;
  const consentMissing = malformed.length > 0 && !draft.excludeMalformed;
  const blocked = missingRequired.length > 0 || dupHeaders.length > 0 || offsetInvalid || processTypeMissing || consentMissing;
  const setMap = (field: string, header: string) => onChange({ ...draft, mapping: { ...draft.mapping, [field]: header } });
  const unmapped = draft.parsed.headers.filter((h) => !used.some(([, v]) => v === h));
  const malformedSet = new Set(malformed.map((m) => m.sourceRow));
  const fieldRow = (field: string) => {
    const required = (REQUIRED as readonly string[]).includes(field) || (field === 'process_type' && draft.requireProcessType);
    return (
      <div key={field} className="grid grid-cols-[150px_1fr] items-center gap-2">
        <span className="font-mono text-xs text-slate-600">
          {field}
          {required && <span className="text-red-500"> *</span>}
        </span>
        <Select value={draft.mapping[field] ?? ''} onChange={(e) => setMap(field, e.target.value)} className="!py-1 text-xs">
          <option value="">— not mapped —</option>
          {draft.parsed.headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
      </div>
    );
  };

  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <Card
        title="Column mapping"
        subtitle={`${draft.sourceName} · ${plural(draft.parsed.rows.length, 'data row')} · ${plural(draft.parsed.headers.length, 'column')}`}
        actions={<Badge tone={draft.sourceKind === 'festival_sample' ? 'violet' : 'blue'}>{draft.sourceKind === 'festival_sample' ? 'Festival sample' : 'User upload'}</Badge>}
      >
        <div className="space-y-2.5">{[...REQUIRED, ...OPTIONAL].map(fieldRow)}</div>
        <details className="mt-3 rounded-md border border-slate-200 px-3 py-2" open={draft.festival}>
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">Festival case-study fields (optional)</summary>
          <div className="mt-2.5 space-y-2.5">{FESTIVAL_FIELDS.map(fieldRow)}</div>
        </details>
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <Field label="Missing-resource placeholders" hint="Comma-separated. (blank) = empty value. Values listed here are treated as missing resource.">
            <Input value={draft.missingResources} onChange={(e) => onChange({ ...draft, missingResources: e.target.value })} />
          </Field>
          <Field
            label="Fixed UTC offset for timezone-less timestamps"
            hint="Optional, e.g. +09:00. Leave empty to require explicit offsets in every timestamp."
            error={offsetInvalid ? 'Use Z or ±HH:MM.' : null}
          >
            <Input value={draft.fixedOffset} placeholder="(none)" invalid={offsetInvalid} onChange={(e) => onChange({ ...draft, fixedOffset: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.requireProcessType} onChange={(e) => onChange({ ...draft, requireProcessType: e.target.checked })} />
            Require process_type on every row (multi-process import)
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={draft.festival} onChange={(e) => onChange({ ...draft, festival: e.target.checked })} />
            <span>
              Enable Festival case-study adapters
              <span className="block text-xs text-slate-400">Adds Festival KPIs, rework rules, Festival process names and the audience gate simulation. Leave off for general logs.</span>
              {draft.festival && !(draft.requireProcessType && draft.mapping.festival_id) && (
                <span className="block text-xs text-amber-700">
                  Audience time-order warnings at import (e.g. a step recorded before Join Entry Queue) also need “Require process_type” and a mapped festival_id. Festival KPIs still exclude out-of-order evidence.
                </span>
              )}
            </span>
          </label>
        </div>
        {malformed.length > 0 && (
          <div className="mt-3">
            <Notice tone="error" title={`${plural(malformed.length, 'row')} with the wrong number of columns`}>
              <p className="text-xs">These rows cannot be split into one value per header, so they cannot be validated. Fix them in the source file, or exclude them explicitly. They stay listed in the import report and evidence export.</p>
              <div className="mt-2 max-h-40 overflow-auto rounded border border-red-200 bg-white">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-red-900"><th className="px-2 py-1">Row</th><th className="px-2 py-1">Reason</th></tr></thead>
                  <tbody>
                    {malformed.slice(0, 200).map((m) => (
                      <tr key={m.sourceRow} className="border-t border-red-100"><td className="px-2 py-1 font-mono">{m.sourceRow}</td><td className="px-2 py-1">{m.code}: {m.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="mt-2 flex items-start gap-2 font-medium">
                <input type="checkbox" className="mt-1" checked={draft.excludeMalformed} onChange={(e) => onChange({ ...draft, excludeMalformed: e.target.checked })} />
                Exclude these {plural(malformed.length, 'row')} and validate the remaining {plural(draft.parsed.rows.length - malformed.length, 'row')}.
              </label>
            </Notice>
          </div>
        )}
        {draft.parsed.renamedHeaders && (
          <div className="mt-3"><Notice tone="warning">Duplicate column headers were renamed by the parser (e.g. <code>name_1</code>). Check the mapping.</Notice></div>
        )}
        {missingRequired.length > 0 && <div className="mt-3"><Notice tone="error">Map the required fields: {missingRequired.join(', ')}.</Notice></div>}
        {dupHeaders.length > 0 && <div className="mt-3"><Notice tone="error">A CSV column is mapped twice: {[...new Set(dupHeaders)].join(', ')}.</Notice></div>}
        {processTypeMissing && <div className="mt-3"><Notice tone="error">process_type must be mapped when it is required.</Notice></div>}
        {draft.parsed.parseErrors.length > 0 && (
          <div className="mt-3">
            <Notice tone="warning" title="CSV parser warnings">
              <ul className="list-disc pl-4 text-xs">
                {draft.parsed.parseErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </Notice>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={blocked} onClick={() => onCommit(draft)}>Validate & load</Button>
        </div>
      </Card>
      <Card title="Raw preview" subtitle={`First ${Math.min(12, draft.parsed.rows.length)} rows as parsed (strings, no coercion)`}>
        {unmapped.length > 0 && (
          <p className="mb-2 text-xs text-slate-500">
            Unmapped columns are kept as attributes under their original headers: {unmapped.join(', ')}
          </p>
        )}
        <RawTable headers={draft.parsed.headers} rows={draft.parsed.rows.slice(0, 12)} mapping={draft.mapping} flagged={malformedSet} />
      </Card>
    </div>
  );
}

function RawTable({
  headers,
  rows,
  mapping,
  rowNumbers,
  flagged,
}: {
  headers: string[];
  rows: Record<string, unknown>[];
  mapping: Record<string, string | undefined>;
  /** Original file row numbers for each displayed row (defaults to the index). */
  rowNumbers?: number[];
  flagged?: Set<number>;
}) {
  const reverse = new Map(Object.entries(mapping).filter(([, v]) => v).map(([k, v]) => [v!, k]));
  return (
    <Table className="max-h-[420px]">
      <thead>
        <tr>
          <Th>Row</Th>
          {headers.map((h) => (
            <Th key={h}>
              {h}
              {reverse.get(h) && reverse.get(h) !== h && <div className="font-mono text-[10px] normal-case text-brand-600">→ {reverse.get(h)}</div>}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const n = rowNumbers?.[i] ?? i;
          const bad = flagged?.has(n);
          return (
            <tr key={i} className={cx(bad && 'bg-red-50')}>
              <Td className={cx('font-mono text-xs', bad ? 'font-semibold text-red-700' : 'text-slate-400')}>{n}{bad && ' ⚠'}</Td>
              {headers.map((h) => (
                <Td key={h} className="whitespace-nowrap font-mono text-xs">
                  {r[h] === '' ? <span className="text-slate-300">∅</span> : r[h] === undefined ? <span className="text-red-400">missing</span> : String(r[h])}
                </Td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function LoadedDataset({ navigate, onEditMapping }: { navigate: (p: PageId) => void; onEditMapping: () => void }) {
  const { state, dispatch } = useStore();
  const analysis = useAnalysis();
  const dataset = state.dataset!;
  const { validation, traces } = analysis;

  return (
    <div className="mt-6 space-y-4">
      {analysis.provider === 'ui_fixture' && (
        <Notice tone="fixture" title="Results provider: UI fixture (hand-authored values)">
          Analysis results for this dataset come from hand-calculated values in <code className="font-mono text-xs">src/adapters/fixtures/uiFixture.ts</code>, not from the engine.
          Subsets of cases, other mappings or import options show a "no fixture value" state because no values were authored for them.
        </Notice>
      )}
      <Card
        title="Dataset"
        actions={
          <>
            <Button size="sm" onClick={() => dispatch({ type: 'SET_FESTIVAL', enabled: !dataset.festival })}>
              {dataset.festival ? 'Disable Festival adapters' : 'Enable Festival adapters'}
            </Button>
            <Button size="sm" onClick={onEditMapping}>Edit mapping</Button>
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'CLEAR_DATASET' })}>Unload</Button>
          </>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          <KeyValue
            items={[
              ['Source', <span className="inline-flex items-center gap-2">{dataset.sourceName} <SourceBadge /></span>],
              ['Results provider', <ProviderBadge />],
              ['Dataset ID', <code className="font-mono text-xs">{dataset.id}</code>],
              ['File rows', `${plural(dataset.fileRowCount, 'data row')}${dataset.malformedRows.length ? ` · ${dataset.malformedRows.length} malformed excluded with consent · ${dataset.rows.length} sent to validation` : ''}`],
              ['Mapping', <span className="font-mono text-xs">{Object.entries(dataset.mapping).filter(([, v]) => v).map(([k, v]) => (k === v ? k : `${k}←${v}`)).join(', ')}</span>],
            ]}
          />
          <KeyValue
            items={[
              ['Missing resources', <span className="font-mono text-xs">{dataset.missingResources.map((v) => (v === '' ? '(blank)' : v)).join(', ')}</span>],
              ['Fixed offset', dataset.fixedOffset ?? 'none (explicit offsets required)'],
              ['Festival adapters', dataset.festival ? (dataset.manifest ? 'enabled (Festival manifest)' : 'enabled (explicit)') : 'off (general process log)'],
              ['Assumptions', dataset.metadata?.assumptions?.length ? `${dataset.metadata.assumptions.length} listed in manifest` : '—'],
            ]}
          />
        </div>
      </Card>

      <ValidationCard />

      {traces?.status === 'ok' && (
        <>
          <ProcessSummary navigate={navigate} />
          <TraceTable />
        </>
      )}

      <EngineStatusCard />

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

      <Card title="Raw rows" subtitle="Rows sent to validation, in source order. Row numbers are zero-based data rows of the original file (also used in validation issues).">
        <RawTable headers={dataset.headers} rows={dataset.rows.slice(0, 50)} mapping={dataset.mapping} rowNumbers={dataset.rowMap} />
        {dataset.rows.length > 50 && <p className="mt-2 text-xs text-slate-400">Showing 50 of {dataset.rows.length} rows.</p>}
      </Card>
    </div>
  );
}

function ValidationCard() {
  const { state, dispatch } = useStore();
  const { validation } = useAnalysis();
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning'>('all');
  if (!validation) return null;
  return (
    <Card title="Validation" subtitle="Produced by validateAndNormalize. Invalid rows are never discarded silently.">
      <EngineGate result={validation}>
        {(v) => {
          const errors = v.issues.filter((i) => i.severity === 'error');
          const warnings = v.issues.filter((i) => i.severity === 'warning');
          const errorRows = new Set(errors.filter((i) => i.row >= 0).map((i) => i.row)).size;
          const importWide = errors.filter((i) => i.row < 0).length;
          const shown = v.issues.filter((i) => severity === 'all' || i.severity === severity);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Raw rows" value={v.rawCount.toLocaleString('en-US')} />
                <Stat label="Accepted events" value={v.events.length.toLocaleString('en-US')} />
                <Stat label="Excluded rows" value={v.excludedCount.toLocaleString('en-US')} tone={v.excludedCount ? 'bad' : 'default'} />
                <Stat label="Errors" value={errors.length} sub={`${plural(errorRows, 'row')} affected`} tone={errors.length ? 'bad' : 'default'} />
                <Stat label="Warnings" value={warnings.length} />
              </div>
              {v.canAnalyze ? (
                <Notice tone="success">
                  Ready for analysis.
                  {state.dataset?.acceptExclusions && v.excludedCount > 0 && ` ${plural(v.excludedCount, 'row')} excluded with your consent.`}
                </Notice>
              ) : (
                <Notice tone="error" title="Analysis blocked">
                  {v.events.length === 0 && errors.length === 0
                    ? 'No usable rows remain in this dataset.'
                    : 'Rows with fatal issues must be fixed in the source file, or explicitly excluded before analysing the valid subset.'}
                  {importWide > 0 && (
                    <div className="mt-1 text-xs">{plural(importWide, 'import-wide error')} (e.g. mapping or required column) cannot be excluded row by row; fix the mapping or source file.</div>
                  )}
                  {errorRows > 0 && !state.dataset?.acceptExclusions && (
                    <label className="mt-2 flex items-start gap-2 font-medium">
                      <input type="checkbox" className="mt-1" onChange={(e) => dispatch({ type: 'SET_ACCEPT_EXCLUSIONS', accept: e.target.checked })} />
                      I confirm excluding the {plural(errorRows, 'row')} with fatal issues and analysing the remaining valid rows.
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
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">Show</span>
                    {(['all', 'error', 'warning'] as const).map((s) => (
                      <Button key={s} size="sm" variant={severity === s ? 'primary' : 'secondary'} onClick={() => setSeverity(s)}>
                        {s}
                      </Button>
                    ))}
                  </div>
                  <IssueTable issues={shown} rowMap={state.dataset?.rowMap ?? []} />
                </div>
              )}
            </div>
          );
        }}
      </EngineGate>
    </Card>
  );
}

function IssueTable({ issues, rowMap }: { issues: Issue[]; rowMap: number[] }) {
  const [limit, setLimit] = useState(100);
  return (
    <>
      <Table className="max-h-80">
        <thead>
          <tr>
            <Th>File row</Th>
            <Th>Severity</Th>
            <Th>Field</Th>
            <Th>Code</Th>
            <Th>Message</Th>
          </tr>
        </thead>
        <tbody>
          {issues.slice(0, limit).map((i, idx) => (
            <tr key={idx}>
              <Td className="font-mono text-xs">{i.row < 0 ? 'import' : sourceRowOf(rowMap, i.row)}</Td>
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

function ProcessSummary({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const { traces, dfg, variants } = useAnalysis();
  const all = traces?.status === 'ok' ? traces.data : [];
  const rows = useMemo(() => {
    const by = new Map<string, { cases: number; rows: number; discovery: number; emptyCases: number }>();
    for (const t of all) {
      const r = by.get(t.processType) ?? { cases: 0, rows: 0, discovery: 0, emptyCases: 0 };
      r.cases += 1;
      r.rows += t.events.length;
      r.discovery += t.sequence.length;
      if (!t.sequence.length) r.emptyCases += 1;
      by.set(t.processType, r);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);

  return (
    <Card title="Processes" subtitle="Cases per process from groupCases. Each process is mined separately; there is no cross-process DFG.">
      <Table>
        <thead>
          <tr>
            <Th>Process</Th>
            <Th align="right">Cases</Th>
            <Th align="right">Accepted rows</Th>
            <Th align="right">Discovery events</Th>
            <Th align="right">Empty discovered cases</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, r]) => (
            <tr key={key} className={cx(state.view.processKey === key && 'bg-brand-50/50')}>
              <Td>
                <div className="font-medium text-slate-800">{processLabel(key, state.dataset?.festival)}</div>
                <div className="font-mono text-xs text-slate-400">{key}</div>
              </Td>
              <Td align="right">{r.cases.toLocaleString('en-US')}</Td>
              <Td align="right">{r.rows.toLocaleString('en-US')}</Td>
              <Td align="right">{r.discovery.toLocaleString('en-US')}</Td>
              <Td align="right">{r.emptyCases ? <Badge tone="amber">{r.emptyCases}</Badge> : 0}</Td>
              <Td align="right">
                {state.view.processKey === key ? (
                  <Badge tone="brand">selected</Badge>
                ) : (
                  <Button size="sm" onClick={() => dispatch({ type: 'SET_VIEW', view: { processKey: key } })}>Select</Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Activities (selected scope)" value={<EngineGate result={dfg} compact>{(d) => d.nodes.length}</EngineGate>} />
        <Stat label="Variants (selected scope)" value={<EngineGate result={variants} compact>{(v) => v.length}</EngineGate>} />
        <div className="col-span-2 flex items-center justify-end">
          <Button variant="primary" onClick={() => navigate('analysis')}>Open process analysis →</Button>
        </div>
      </div>
    </Card>
  );
}

function TraceTable() {
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
      title="Trace view"
      subtitle="Cases in the current process and filter scope. Click a case to see every accepted row."
      actions={<Input placeholder="Search case ID" className="!w-48 !py-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} />}
    >
      <Table className="max-h-96">
        <thead>
          <tr>
            <Th>Case</Th>
            <Th>First event</Th>
            <Th align="right">Rows</Th>
            <Th align="right">Discovery events</Th>
            <Th align="right">Elapsed</Th>
            <Th>Sequence</Th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, limit).map((t) => (
            <tr key={t.caseKey} className="cursor-pointer hover:bg-slate-50" onClick={() => dispatch({ type: 'SET_VIEW', view: { selectedCaseKey: t.caseKey } })}>
              <Td className="font-mono text-xs font-medium text-brand-700">{caseLabel(t.caseKey)}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtInstant(t.events[0]?.timestampMs)}</Td>
              <Td align="right">{t.events.length}</Td>
              <Td align="right">{t.sequence.length || <Badge tone="amber">empty</Badge>}</Td>
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

function EngineStatusCard() {
  const a = useAnalysis();
  const results: Partial<Record<string, EngineResult<unknown> | null>> = {
    validateAndNormalize: a.validation,
    groupCases: a.traces,
    buildDFG: a.dfg,
    getVariants: a.variants,
    getCaseDurations: a.durations,
    getPerformance: a.performance,
    getResourceAnalysis: a.resources,
    getKPIs: a.kpis,
    getFindings: a.findings,
    evaluateTargets: a.evaluations,
  };
  const tone = (s?: string) =>
    s === 'ok' ? 'green' : s === 'not_implemented' ? 'amber' : s === 'error' ? 'red' : s === 'fixture_unavailable' ? 'amber' : 'neutral';
  return (
    <Card
      title="Engine connection"
      subtitle={a.provider === 'ui_fixture' ? 'Provider: UI fixture (hand-authored values)' : 'Provider: src/engine (Codex). Status of each call for the current scope.'}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ENGINE_FUNCTIONS.map((fn) => {
          const r = results[fn];
          const label = fn === 'getGateInputs' || fn === 'simulateGateQueue' ? 'on demand (Refine)' : r ? r.status.replace('_', ' ') : 'not called';
          return (
            <div key={fn} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5" title={r && r.status !== 'ok' ? r.message : undefined}>
              <code className="font-mono text-xs text-slate-700">{fn}</code>
              <Badge tone={tone(r?.status)}>{label}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
