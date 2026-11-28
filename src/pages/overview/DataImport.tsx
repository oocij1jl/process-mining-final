/**
 * Data import drafts: CSV column mapping (Phase 2 behaviour preserved) and the
 * v0.3 XES preview. Parsing XES and validating rows is the engine's job
 * (importXes / validateAndNormalize); this module only collects user choices.
 */
import { useMemo } from 'react';
import { DEFAULT_MISSING_RESOURCES, type ColumnMapping, type DatasetMetadata } from '../../contracts';
import type { XesImportResult, XesIssue } from '../../v03-contracts';
import { FESTIVAL_FIELDS, settingsFromManifest, type FestivalManifest } from '../../festival/adapter';
import { datasetIdFor } from '../../state/store';
import type { DatasetState, SourceKind } from '../../state/types';
import { engineRows, fingerprint, parseCsv, type ParsedCsv } from '../../lib/files';
import { plural } from '../../lib/format';
import type { EngineResult } from '../../adapters/engineAdapter';
import { Badge, Button, Card, EngineGate, Field, Input, Notice, Select, Table, Td, Th, cx } from '../../components/ui';

export const REQUIRED = ['case_id', 'activity', 'timestamp'] as const;
/** General event-log fields (DATA_SCHEMA §1). Festival case-study fields are listed separately. */
export const OPTIONAL = ['event_id', 'process_type', 'lifecycle', 'activity_instance_id', 'resource', 'resource_id', 'resource_role', 'cost'] as const;
const ALL_FIELDS: readonly string[] = [...REQUIRED, ...OPTIONAL, ...FESTIVAL_FIELDS];

/** V03_CONTRACT §3A browser limits for XES. */
export const XES_LIMITS = { bytes: 8_388_608, events: 50_000, traces: 10_000, elements: 500_000, depth: 32 } as const;

const FIELD_HELP: Record<string, string> = {
  case_id: 'Which column identifies one case (an order, a ticket, a performance).',
  activity: 'The step that happened.',
  timestamp: 'When it happened, with a timezone offset (or set a fixed offset below).',
  event_id: 'Optional unique row ID.',
  process_type: 'Optional: separates several processes in one file.',
  lifecycle: 'Optional: start / complete. Enables service-time measurement.',
  activity_instance_id: 'Optional: pairs a start with its complete.',
  resource: 'Optional: who performed the step. Enables hand-over analysis.',
  resource_id: 'Optional stable resource identifier.',
  resource_role: 'Optional role of the resource.',
  cost: 'Optional cost value (not used in calculations by default).',
};

export function autoMapping(headers: string[]): Record<string, string> {
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

export interface Draft {
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

export function draftFromText(text: string, sourceName: string, sourceKind: SourceKind, extra?: Partial<Draft>): Draft {
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

export function parsePlaceholders(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .map((s) => (s === '(blank)' ? '' : s));
}

export function draftProblems(draft: Draft) {
  const used = Object.entries(draft.mapping).filter(([, v]) => v);
  const missingRequired = REQUIRED.filter((f) => !draft.mapping[f]);
  const dupHeaders = used.map(([, v]) => v).filter((v, i, a) => a.indexOf(v) !== i);
  const offsetInvalid = !!draft.fixedOffset && !/^(Z|[+-](0\d|1[0-4]):[0-5]\d)$/.test(draft.fixedOffset.trim());
  const processTypeMissing = draft.requireProcessType && !draft.mapping.process_type;
  const consentMissing = draft.parsed.malformed.length > 0 && !draft.excludeMalformed;
  return {
    missingRequired,
    dupHeaders,
    offsetInvalid,
    processTypeMissing,
    consentMissing,
    blocked: missingRequired.length > 0 || dupHeaders.length > 0 || offsetInvalid || processTypeMissing || consentMissing,
  };
}

/** Builds the immutable dataset for a committed CSV draft. */
export function datasetFromDraft(d: Draft): DatasetState {
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
    format: 'csv',
  };
  return { ...base, id: datasetIdFor(base) };
}

/** XES canonical mapping, shown for provenance only (the engine applies it internally). */
const XES_MAPPING = {
  case_id: 'trace concept:name',
  activity: 'event concept:name',
  timestamp: 'event time:timestamp',
  resource: 'event org:resource',
  lifecycle: 'event lifecycle:transition',
} as unknown as ColumnMapping;

export interface XesDraft {
  sourceName: string;
  bytes: Uint8Array;
  missingResources: string;
  fixedOffset: string;
  festival: boolean;
  acceptExclusions: boolean;
}

/** Format-tagged content fingerprint for XES bytes (V03_CONTRACT §3A). */
function bytesFingerprint(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return `xes:${fingerprint(s)}`;
}

export function datasetFromXes(d: XesDraft, rawCount: number): DatasetState {
  const base: Omit<DatasetState, 'id'> = {
    contentFingerprint: bytesFingerprint(d.bytes),
    sourceName: d.sourceName,
    sourceKind: 'user_upload',
    headers: [],
    rows: [],
    rowMap: [],
    malformedRows: [],
    fileRowCount: rawCount,
    rawText: '',
    mapping: XES_MAPPING,
    missingResources: parsePlaceholders(d.missingResources),
    fixedOffset: d.fixedOffset.trim() || undefined,
    acceptExclusions: d.acceptExclusions,
    requireProcessType: false,
    festival: d.festival,
    loadedAt: Date.now(),
    format: 'xes',
    xesBytes: d.bytes,
  };
  return { ...base, id: datasetIdFor(base) };
}

export function xesLocation(issue: XesIssue): string {
  const loc = issue.location;
  if (!loc) return 'file';
  if (loc.eventIndex === null) return `trace ${loc.traceIndex + 1}`;
  return `trace ${loc.traceIndex + 1} · event ${loc.eventIndex + 1}`;
}

/** XES preview: engine-validated summary, issues and explicit exclusion consent. */
export function XesPreview({
  draft,
  result,
  onChange,
  onCancel,
  onCommit,
}: {
  draft: XesDraft;
  result: EngineResult<XesImportResult>;
  onChange: (d: XesDraft) => void;
  onCancel: () => void;
  onCommit: (rawCount: number) => void;
}) {
  return (
    <Card title={`Check ${draft.sourceName}`} subtitle="XES event log · parsed locally by the engine. Nothing is uploaded.">
      <EngineGate result={result}>
        {(r) =>
          r.status === 'rejected' ? (
            <Notice tone="error" title="This XES file cannot be imported">
              <ul className="list-disc pl-4">
                {r.issues.slice(0, 8).map((i, k) => (
                  <li key={k}>
                    <code className="font-mono text-xs">{i.code}</code> — {i.message}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Use a trace-based XES log within the limits below, or export the same log as CSV. Your current data was not replaced.</p>
            </Notice>
          ) : (
            <XesParsed draft={draft} result={r} onChange={onChange} onCommit={onCommit} />
          )
        }
      </EngineGate>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function XesParsed({
  draft,
  result,
  onChange,
  onCommit,
}: {
  draft: XesDraft;
  result: Extract<XesImportResult, { status: 'parsed' }>;
  onChange: (d: XesDraft) => void;
  onCommit: (rawCount: number) => void;
}) {
  const v = result.validation;
  const errors = v.issues.filter((i) => i.severity === 'error');
  const warnings = v.issues.filter((i) => i.severity === 'warning');
  const needsConsent = v.excludedCount > 0;
  const usable = v.events.length > 0 && (!needsConsent || draft.acceptExclusions);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><div className="text-xs text-slate-500">Traces</div><div className="text-lg font-semibold tabular">{result.traces.length.toLocaleString('en-US')}</div></div>
        <div><div className="text-xs text-slate-500">Events in file</div><div className="text-lg font-semibold tabular">{v.rawCount.toLocaleString('en-US')}</div></div>
        <div><div className="text-xs text-slate-500">Accepted events</div><div className="text-lg font-semibold tabular">{v.events.length.toLocaleString('en-US')}</div></div>
        <div><div className="text-xs text-slate-500">Errors · warnings</div><div className="text-lg font-semibold tabular">{errors.length} · {warnings.length}</div></div>
      </div>
      {v.issues.length > 0 && (
        <Table className="max-h-56">
          <thead><tr><Th>Where</Th><Th>Severity</Th><Th>Code</Th><Th>Message</Th></tr></thead>
          <tbody>
            {v.issues.slice(0, 200).map((i, k) => (
              <tr key={k}>
                <Td className="whitespace-nowrap text-xs">{xesLocation(i)}</Td>
                <Td><Badge tone={i.severity === 'error' ? 'red' : 'amber'}>{i.severity}</Badge></Td>
                <Td className="font-mono text-xs">{i.code}</Td>
                <Td>{i.message}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {needsConsent && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <input type="checkbox" className="mt-1" checked={draft.acceptExclusions} onChange={(e) => onChange({ ...draft, acceptExclusions: e.target.checked })} />
          <span>
            Exclude {plural(v.excludedCount, 'event')} with errors and analyse the remaining {plural(v.events.length, 'event')}. Excluded events stay listed in the data check and export.
          </span>
        </label>
      )}
      {v.events.length === 0 && <Notice tone="error">No usable events remain. Fix the file and try again; your current data was not replaced.</Notice>}
      <div className="flex justify-end">
        <Button variant="primary" iconRight="arrowRight" disabled={!usable} onClick={() => onCommit(v.rawCount)}>
          Load and explore
        </Button>
      </div>
    </div>
  );
}

export function MappingEditor({
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
  const { missingRequired, dupHeaders, offsetInvalid, processTypeMissing, blocked } = draftProblems(draft);
  const used = Object.entries(draft.mapping).filter(([, v]) => v);
  const setMap = (field: string, header: string) => onChange({ ...draft, mapping: { ...draft.mapping, [field]: header } });
  const unmapped = draft.parsed.headers.filter((h) => !used.some(([, v]) => v === h));
  const malformed = draft.parsed.malformed;
  const malformedSet = useMemo(() => new Set(malformed.map((m) => m.sourceRow)), [malformed]);
  const fieldRow = (field: string) => {
    const required = (REQUIRED as readonly string[]).includes(field) || (field === 'process_type' && draft.requireProcessType);
    return (
      <div key={field} className="grid grid-cols-[150px_1fr] items-center gap-2" title={FIELD_HELP[field]}>
        <span className="font-mono text-xs text-slate-600">
          {field}
          {required && <span className="text-red-500"> *</span>}
        </span>
        <Select value={draft.mapping[field] ?? ''} onChange={(e) => setMap(field, e.target.value)} className="!py-1 text-xs" aria-label={`Column for ${field}`}>
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,440px)_1fr]">
      <Card
        title="Match your columns"
        subtitle={`${draft.sourceName} · ${plural(draft.parsed.rows.length, 'data row')} · ${plural(draft.parsed.headers.length, 'column')}. Required: case, activity, timestamp.`}
        actions={<Badge tone={draft.sourceKind === 'festival_sample' ? 'violet' : 'blue'}>{draft.sourceKind === 'festival_sample' ? 'Festival sample' : 'Your upload'}</Badge>}
      >
        <div className="space-y-2.5">{[...REQUIRED, ...OPTIONAL].map(fieldRow)}</div>
        <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2" open={draft.festival}>
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">Festival case-study fields (optional)</summary>
          <div className="mt-2.5 space-y-2.5">{FESTIVAL_FIELDS.map(fieldRow)}</div>
        </details>
        <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">Import options</summary>
          <div className="mt-3 space-y-3">
            <Field label="Values that mean “no resource”" hint="Comma-separated. (blank) = empty value.">
              <Input value={draft.missingResources} onChange={(e) => onChange({ ...draft, missingResources: e.target.value })} />
            </Field>
            <Field
              label="Fixed UTC offset for timestamps without a timezone"
              hint="Optional, e.g. +09:00. Leave empty to require explicit offsets in every timestamp."
              error={offsetInvalid ? 'Use Z or ±HH:MM.' : null}
            >
              <Input value={draft.fixedOffset} placeholder="(none)" invalid={offsetInvalid} onChange={(e) => onChange({ ...draft, fixedOffset: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={draft.requireProcessType} onChange={(e) => onChange({ ...draft, requireProcessType: e.target.checked })} />
              Every row must name its process (multi-process file)
            </label>
            <label className="flex items-start gap-2 text-[13px] text-slate-700">
              <input type="checkbox" className="mt-1" checked={draft.festival} onChange={(e) => onChange({ ...draft, festival: e.target.checked })} />
              <span>
                Apply Festival case-study rules
                <span className="block text-xs text-slate-400">Adds Festival KPIs, rework rules, process names, import checks and the entry gate model. Leave off for general logs.</span>
              </span>
            </label>
          </div>
        </details>
        {malformed.length > 0 && (
          <div className="mt-3">
            <Notice tone="error" title={`${plural(malformed.length, 'row')} with the wrong number of columns`}>
              <p className="text-xs">These rows cannot be split into one value per column. Fix them in the file, or exclude them explicitly; they stay listed in the data check and export.</p>
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
                Exclude these {plural(malformed.length, 'row')} and check the remaining {plural(draft.parsed.rows.length - malformed.length, 'row')}.
              </label>
            </Notice>
          </div>
        )}
        {draft.parsed.renamedHeaders && <Notice className="mt-3" tone="warning">Duplicate column headers were renamed (e.g. <code>name_1</code>). Check the mapping.</Notice>}
        {missingRequired.length > 0 && <Notice className="mt-3" tone="error">Choose a column for: {missingRequired.join(', ')}.</Notice>}
        {dupHeaders.length > 0 && <Notice className="mt-3" tone="error">A column is used twice: {[...new Set(dupHeaders)].join(', ')}.</Notice>}
        {processTypeMissing && <Notice className="mt-3" tone="error">Choose the process column, or untick “Every row must name its process”.</Notice>}
        {draft.parsed.parseErrors.length > 0 && (
          <Notice className="mt-3" tone="warning" title="CSV parser warnings">
            <ul className="list-disc pl-4 text-xs">
              {draft.parsed.parseErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </Notice>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" iconRight="arrowRight" disabled={blocked} onClick={() => onCommit(draft)}>Check and load</Button>
        </div>
      </Card>
      <Card title="Preview" subtitle={`First ${Math.min(12, draft.parsed.rows.length)} rows exactly as read (no conversion)`}>
        {unmapped.length > 0 && (
          <p className="mb-2 text-xs text-slate-500">
            Columns not matched are kept as extra attributes: {unmapped.join(', ')}
          </p>
        )}
        <RawTable headers={draft.parsed.headers} rows={draft.parsed.rows.slice(0, 12)} mapping={draft.mapping} flagged={malformedSet} />
      </Card>
    </div>
  );
}

export function RawTable({
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
