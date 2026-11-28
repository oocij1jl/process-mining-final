import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { callEngine, hasCapability, type EngineResult } from '../adapters/engineAdapter';
import { UI_FIXTURE_CSV, UI_FIXTURE_DATASET_NAME } from '../adapters/fixtures/uiFixture';
import { FESTIVAL_PROCESS_INFO } from '../festival/adapter';
import { useFestivalManifest } from '../festival/useManifest';
import { ORDER_SAMPLE_CSV, ORDER_SAMPLE_DESCRIPTION, ORDER_SAMPLE_MAPPING, ORDER_SAMPLE_NAME } from '../samples/orderProcessing';
import type { XesImportResult } from '../v03-contracts';
import { useAnalysis } from '../state/analysis';
import { useStore } from '../state/store';
import type { AnalysisMode, PageId } from '../state/types';
import { downloadText, parseCsv } from '../lib/files';
import { fmtMinutes, fmtShare, plural, processLabel } from '../lib/format';
import { kpiName } from '../lib/kpiCatalog';
import { ProcessPilotMark } from '../components/layout';
import { Icon, type IconName } from '../components/icons';
import { Badge, Button, Card, EngineGate, KeyValue, Notice, PageHeader, cx } from '../components/ui';
import { AdvancedDataDetails, DataCheck, TraceTable } from './overview/DataDetails';
import {
  MappingEditor,
  XES_LIMITS,
  XesPreview,
  datasetFromDraft,
  datasetFromXes,
  draftFromText,
  draftProblems,
  parsePlaceholders,
  type Draft,
  type XesDraft,
} from './overview/DataImport';

/** The eight approved analysis questions (V03_FINAL §1) and where each is answered. */
export const QUESTIONS: { q: string; fn: string; icon: IconName; page: PageId; mode?: AnalysisMode }[] = [
  { q: 'What sequence does work actually follow?', fn: 'Process map', icon: 'graph', page: 'analysis', mode: 'frequency' },
  { q: 'Which path is most common?', fn: 'Variants', icon: 'route', page: 'analysis', mode: 'variants' },
  { q: 'Where does work take longer?', fn: 'Performance map', icon: 'clock', page: 'analysis', mode: 'performance' },
  { q: 'Which activities are repeated?', fn: 'Rework', icon: 'repeat', page: 'analysis', mode: 'rework' },
  { q: 'Who hands work over to whom?', fn: 'Hand-over network (WTN)', icon: 'users', page: 'analysis', mode: 'handover' },
  { q: 'How does the reference process differ from recorded behavior?', fn: 'BPMN comparison', icon: 'compare', page: 'model' },
  { q: 'How could the process be improved?', fn: 'Redesign strategy → To-be model', icon: 'pen', page: 'design' },
  { q: 'What would change under a proposed improvement?', fn: 'What-if simulation', icon: 'flask', page: 'refine' },
];

export function OverviewPage({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const { api } = useAnalysis();
  const manifest = useFestivalManifest();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [xes, setXes] = useState<{ draft: XesDraft; result: EngineResult<XesImportResult> } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const openQuestion = (page: PageId, mode?: AnalysisMode) => {
    if (mode) dispatch({ type: 'SET_VIEW', view: { analysisMode: mode } });
    navigate(page);
  };

  const commit = (d: Draft, then?: { processKey?: string; explore?: boolean }) => {
    if (draftProblems(d).blocked) return;
    dispatch({ type: 'LOAD_DATASET', dataset: datasetFromDraft(d) });
    if (then?.processKey) dispatch({ type: 'SET_VIEW', view: { processKey: then.processKey } });
    dispatch({ type: 'TOAST', tone: 'success', message: `Loaded ${d.metadata?.name ?? d.sourceName}` });
    setDraft(null);
    if (then?.explore) {
      dispatch({ type: 'SET_VIEW', view: { analysisMode: 'frequency' } });
      navigate('analysis');
    }
  };

  const loadOrderSample = () => {
    const d = draftFromText(ORDER_SAMPLE_CSV, 'order-processing-sample.csv', 'bundled_sample', {
      mapping: { ...ORDER_SAMPLE_MAPPING },
      metadata: {
        name: ORDER_SAMPLE_NAME,
        sourceType: 'synthetic',
        timezone: 'UTC',
        assumptions: ['Hand-authored illustrative orders; not observed company data.'],
      },
    });
    commit(d, { explore: true });
  };

  const loadFixture = () => {
    const d = draftFromText(UI_FIXTURE_CSV, UI_FIXTURE_DATASET_NAME, 'ui_fixture', {
      festival: true,
      metadata: { name: UI_FIXTURE_DATASET_NAME, sourceType: 'synthetic', timezone: 'UTC', serviceActivity: 'Ticket Verification' },
    });
    commit(d);
  };

  const loadFestival = async (processKey: string) => {
    if (manifest.status !== 'ready') return;
    const m = manifest.manifest;
    setLoadError(null);
    setBusy(processKey);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}datasets/${m.csv}`);
      if (!res.ok) throw new Error(`Could not fetch datasets/${m.csv} (${res.status}).`);
      const text = await res.text();
      const d = draftFromText(text, m.name ?? m.csv, 'festival_sample', {
        requireProcessType: true,
        festival: true,
        manifest: m,
        ...(m.missing_resource_values ? { missingResources: m.missing_resource_values.map((v) => (v === '' ? '(blank)' : v)).join(', ') } : {}),
        metadata: {
          name: m.name ?? m.csv,
          sourceType: m.source_type ?? 'synthetic',
          timezone: m.timezone,
          sourceReferences: m.source_references,
          assumptions: m.assumptions,
          baselineGateCount: m.baseline_gate_count,
          serviceActivity: m.service_activity,
        },
      });
      // One click when the manifest CSV maps automatically; otherwise show the column matcher.
      if (!draftProblems(d).blocked) commit(d, { processKey, explore: true });
      else setDraft(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const readFile = (file: File) => {
    setLoadError(null);
    setDraft(null);
    setXes(null);
    if (/\.(xes|xml)$/i.test(file.name)) {
      if (!hasCapability(api, 'importXes')) {
        setLoadError(`${file.name}: XES import is handled by the analysis engine, and this build does not include the XES importer yet. Export the same log as CSV and upload it instead.`);
        return;
      }
      if (file.size > XES_LIMITS.bytes) {
        setLoadError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MiB. XES files are limited to 8 MiB in the browser. Use a smaller subset of the log.`);
        return;
      }
      file.arrayBuffer().then(
        (buf) => {
          const bytes = new Uint8Array(buf);
          const draftX: XesDraft = { sourceName: file.name, bytes, missingResources: '(blank), NONE, NULL, 0;n/a', fixedOffset: '', festival: false, acceptExclusions: false };
          setXes({ draft: draftX, result: runXesPreview(draftX) });
        },
        (e: unknown) => setLoadError(String(e)),
      );
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setLoadError(`${file.name} is not a supported file. Upload a CSV (.csv) or an XES event log (.xes or .xml).`);
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

  const runXesPreview = (d: XesDraft) =>
    callEngine(api, 'importXes', d.bytes, {
      missingResources: parsePlaceholders(d.missingResources),
      fixedOffset: d.fixedOffset.trim() || undefined,
      acceptExclusions: d.acceptExclusions,
      requireProcessType: false,
      festivalValidation: d.festival,
    });

  const editMapping = () => {
    const d = state.dataset;
    if (!d || d.format === 'xes') return;
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

  const errorBox = loadError && (
    <Notice tone="error" title="This file could not be loaded" className="mb-4">
      {loadError}
    </Notice>
  );

  if (draft) {
    return (
      <div>
        <PageHeader phase="Overview & Data" title="Match your columns" subtitle="Tell ProcessPilot which column is the case, the activity and the time. Optional columns unlock more analyses (lifecycle → service time, resource → hand-overs)." />
        {errorBox}
        <MappingEditor draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onCommit={(d) => commit(d)} />
      </div>
    );
  }

  if (xes) {
    return (
      <div>
        <PageHeader phase="Overview & Data" title="Check your XES log" subtitle="ProcessPilot reads trace-based XES (concept:name, time:timestamp, org:resource, lifecycle:transition) locally in your browser." />
        {errorBox}
        <XesPreview
          draft={xes.draft}
          result={xes.result}
          onChange={(d) => setXes({ draft: d, result: runXesPreview(d) })}
          onCancel={() => setXes(null)}
          onCommit={(rawCount) => {
            dispatch({ type: 'LOAD_DATASET', dataset: datasetFromXes(xes.draft, rawCount) });
            dispatch({ type: 'TOAST', tone: 'success', message: `Loaded ${xes.draft.sourceName}` });
            setXes(null);
            dispatch({ type: 'SET_VIEW', view: { analysisMode: 'frequency' } });
            navigate('analysis');
          }}
        />
      </div>
    );
  }

  if (!state.dataset) {
    return (
      <Landing
        manifest={manifest}
        busy={busy}
        error={errorBox}
        onOrder={loadOrderSample}
        onFestival={loadFestival}
        onFile={readFile}
        onFixture={loadFixture}
        onQuestion={openQuestion}
      />
    );
  }

  return <LoadedDataset navigate={navigate} onEditMapping={editMapping} onFile={readFile} error={errorBox} onQuestion={openQuestion} />;
}

/* ------------------------------ Landing ------------------------------ */

function Landing({
  manifest,
  busy,
  error,
  onOrder,
  onFestival,
  onFile,
  onFixture,
  onQuestion,
}: {
  manifest: ReturnType<typeof useFestivalManifest>;
  busy: string | null;
  error: ReactNode;
  onOrder: () => void;
  onFestival: (processKey: string) => void;
  onFile: (f: File) => void;
  onFixture: () => void;
  onQuestion: (page: PageId, mode?: AnalysisMode) => void;
}) {
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-8 md:px-10 md:py-10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-50" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-40 h-64 w-64 rounded-full bg-violet-50/70" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <ProcessPilotMark size={36} />
              <span className="text-sm font-semibold text-slate-700">ProcessPilot</span>
              <Badge tone="brand">Visual Process Intelligence &amp; Optimization</Badge>
            </div>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-tight text-slate-900 md:text-[38px]">
              Discover how work flows.
              <br />
              <span className="text-brand-600">Design how it should flow.</span>
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-600">
              Turn an event log into a process map, see where cases slow down, repeat or change hands, then design and test an improvement — with every number linked to the cases behind it.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" iconRight="arrowRight" onClick={onOrder}>
                Explore a sample process
              </Button>
              <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500">
                <Icon name="upload" className="h-4 w-4" />
                Upload your log
                <input type="file" accept=".csv,.txt,.xes,.xml,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">CSV or XES · processed locally in your browser · nothing is uploaded</p>
          </div>
          <HeroDiagram />
        </div>
      </section>

      {error}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900">Choose your data</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="flex flex-col" bodyClassName="flex flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name="file" /></span>
              <div>
                <div className="text-[14px] font-semibold text-slate-900">Order Processing</div>
                <div className="text-xs text-slate-500">General sample · 3 orders · 11 events</div>
              </div>
            </div>
            <p className="mt-3 flex-1 text-[13px] leading-relaxed text-slate-600">{ORDER_SAMPLE_DESCRIPTION}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Badge tone="violet">Synthetic</Badge>
              <Button variant="primary" iconRight="arrowRight" onClick={onOrder}>Explore</Button>
            </div>
          </Card>

          <Card className="flex flex-col" bodyClassName="flex flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-600"><Icon name="music" /></span>
              <div>
                <div className="text-[14px] font-semibold text-slate-900">Music Festival Operations</div>
                <div className="text-xs text-slate-500">Case study · three linked processes</div>
              </div>
            </div>
            {manifest.status === 'ready' ? (
              <div className="mt-3 flex-1 space-y-1.5">
                {Object.entries(FESTIVAL_PROCESS_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!!busy}
                    onClick={() => onFestival(key)}
                    className="group flex w-full items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-800">{processLabel(key, true)}</span>
                      <span className="block text-xs text-slate-500">{info.caseMeaning}</span>
                    </span>
                    <span className="mt-0.5 text-xs font-medium text-brand-600 group-hover:underline">{busy === key ? 'Loading…' : 'Explore →'}</span>
                  </button>
                ))}
                <div className="pt-1 text-[11px] text-slate-500">
                  {manifest.manifest.name ?? manifest.manifest.csv} · synthetic · generator {manifest.manifest.generator?.version ?? '—'} · seed {manifest.manifest.generator?.seed ?? '—'}
                </div>
              </div>
            ) : (
              <div className="mt-3 flex-1 text-[13px] leading-relaxed text-slate-600">
                <p>Stage &amp; technical operations, audience entry and equipment readiness for a fictional festival, generated with a documented seed.</p>
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {manifest.status === 'loading' ? 'Checking for the published Festival sample…' : 'The Festival dataset is not published in this build yet. It appears here automatically once the data files are added.'}
                </p>
              </div>
            )}
          </Card>

          <UploadCard onFile={onFile} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Questions you can answer</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {QUESTIONS.map((x, i) => (
            <button
              key={x.q}
              type="button"
              onClick={() => onQuestion(x.page, x.mode)}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:border-brand-300 hover:shadow-sm"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600">
                <Icon name={x.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-snug text-slate-800">{x.q}</span>
                <span className="mt-0.5 block text-[11.5px] text-slate-500">
                  <span className="tabular text-slate-400">{i + 1}.</span> {x.fn}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Load data first; each question opens the matching view.</p>
      </section>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">For developers: interface test log</summary>
        <p className="mt-2">A 20-row hand-authored log used to test the interface (generic cases plus three Festival-schema entries). Not a demonstration dataset.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onFixture}>Load test log</Button>
          <Button size="sm" variant="ghost" icon="download" onClick={() => downloadText('processpilot-ui-fixture.csv', UI_FIXTURE_CSV, 'text/csv')}>Download CSV</Button>
        </div>
      </details>
    </div>
  );
}

function UploadCard({ onFile, compact }: { onFile: (f: File) => void; compact?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  return (
    <Card className="flex flex-col" bodyClassName="flex flex-1 flex-col">
      {!compact && (
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-600"><Icon name="upload" /></span>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Your own event log</div>
            <div className="text-xs text-slate-500">CSV with column matching, or XES (.xes / .xml)</div>
          </div>
        </div>
      )}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center text-[13px] transition focus-within:ring-2 focus-within:ring-brand-500',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/60',
        )}
      >
        <span className="font-medium text-slate-700">Drop a file here or click to browse</span>
        <span className="mt-1 text-xs text-slate-500">Needs a case ID, an activity and a timestamp per row</span>
        <input type="file" accept=".csv,.txt,.xes,.xml,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        XES limits: 8 MiB, {XES_LIMITS.events.toLocaleString('en-US')} events, {XES_LIMITS.traces.toLocaleString('en-US')} traces. Processed locally; nothing leaves your browser.
      </p>
    </Card>
  );
}

/** Decorative mini process map for the hero (static illustration, not data). */
function HeroDiagram() {
  const nodes = [
    { x: 20, y: 70, w: 92, label: 'Received' },
    { x: 150, y: 20, w: 92, label: 'Payment' },
    { x: 150, y: 120, w: 92, label: 'Cancelled' },
    { x: 280, y: 20, w: 92, label: 'Packed' },
    { x: 280, y: 120, w: 92, label: 'Shipped' },
  ];
  return (
    <div className="hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 lg:block" aria-hidden>
      <svg viewBox="0 0 392 170" className="h-auto w-full">
        <defs>
          <marker id="pp-hero-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="#6366f1" />
          </marker>
        </defs>
        {[
          ['M112 82 C130 70 132 40 150 36', 4],
          ['M112 90 C130 100 132 130 150 136', 1.6],
          ['M242 36 L280 36', 4],
          ['M326 52 L326 120', 3],
        ].map(([d, w], i) => (
          <path key={i} d={d as string} fill="none" stroke={i === 1 ? '#f59e0b' : '#6366f1'} strokeWidth={w as number} markerEnd="url(#pp-hero-arrow)" opacity={0.85} />
        ))}
        {nodes.map((n) => (
          <g key={n.label}>
            <rect x={n.x} y={n.y} width={n.w} height={32} rx={7} fill="#fff" stroke="#cbd5e1" />
            <rect x={n.x} y={n.y} width={4} height={32} rx={2} fill="#6366f1" />
            <text x={n.x + 14} y={n.y + 20} fontSize={12} fontWeight={600} fill="#1e293b">{n.label}</text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>Illustration — your map is drawn from the log</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-amber-500" /> exception path</span>
      </div>
    </div>
  );
}

/* ------------------------------ Loaded dataset ------------------------------ */

function LoadedDataset({
  navigate,
  onEditMapping,
  onFile,
  error,
  onQuestion,
}: {
  navigate: (p: PageId) => void;
  onEditMapping: () => void;
  onFile: (f: File) => void;
  error: ReactNode;
  onQuestion: (page: PageId, mode?: AnalysisMode) => void;
}) {
  const { state, dispatch } = useStore();
  const analysis = useAnalysis();
  const dataset = state.dataset!;
  const { traces, validation } = analysis;
  const ready = traces?.status === 'ok';
  const [changing, setChanging] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        phase="Overview & Data"
        title={dataset.metadata?.name ?? dataset.sourceName}
        subtitle={
          dataset.sourceKind === 'bundled_sample'
            ? ORDER_SAMPLE_DESCRIPTION
            : dataset.sourceKind === 'festival_sample'
              ? 'Synthetic Festival operations log with three separate processes. Each process is analysed on its own; the Festival overview compares them side by side.'
              : 'Your event log, checked and ready for analysis. Choose the process to analyse, then open the process map.'
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setChanging((v) => !v)}>Use different data</Button>
            <Button variant="primary" iconRight="arrowRight" disabled={!ready} onClick={() => onQuestion('analysis', 'frequency')}>
              Open the process map
            </Button>
          </>
        }
      />
      {error}
      {changing && (
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <UploadCard onFile={onFile} />
          <Card title="Or start over" subtitle="Saved designs, targets and plans stay in this browser and come back when the same file and settings are loaded again.">
            <div className="flex flex-wrap gap-2">
              {dataset.format !== 'xes' && <Button onClick={onEditMapping}>Change column matching</Button>}
              <Button variant="danger" onClick={() => dispatch({ type: 'CLEAR_DATASET' })}>Unload this log</Button>
            </div>
          </Card>
        </div>
      )}

      {ready ? <Summary /> : null}

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {ready && analysis.processKeys.length > 1 && <ProcessChooser onExplore={() => onQuestion('analysis', 'frequency')} />}
          <Card title="Data check" subtitle={dataset.format === 'xes' ? 'Checked by the engine’s XES importer' : 'Every row is checked; nothing is dropped silently'}>
            {validation ? <DataCheck /> : <p className="text-sm text-slate-500">Checking…</p>}
          </Card>
        </div>
        <Provenance />
      </div>

      {ready && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold text-slate-900">What do you want to find out?</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {QUESTIONS.map((x) => (
              <button
                key={x.q}
                type="button"
                onClick={() => onQuestion(x.page, x.mode)}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-brand-300 hover:shadow-sm"
              >
                <Icon name={x.icon} className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-brand-600" />
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-slate-800">{x.q}</span>
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-500" />
              </button>
            ))}
          </div>
        </section>
      )}

      {ready && <TraceTable />}
      <AdvancedDataDetails />
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => navigate('export')} icon="download">Evidence export</Button>
      </div>
    </div>
  );
}

function Summary() {
  const { validation, selectedTraces, dfg, variants, kpis } = useAnalysis();
  const { state } = useStore();
  const v = validation?.status === 'ok' ? validation.data : null;
  const steps = useMemo(() => selectedTraces.reduce((s, t) => s + t.sequence.length, 0), [selectedTraces]);
  const top = variants?.status === 'ok' ? [...variants.data].sort((a, b) => b.count - a.count)[0] : undefined;
  const elapsed = kpis?.status === 'ok' ? kpis.data.find((m) => m.id === 'case_elapsed_mean') : undefined;
  const process = processLabel(state.view.processKey ?? '', state.dataset?.festival);
  return (
    <div>
      <div className="mb-2 text-xs text-slate-500">
        Selected process: <b className="font-semibold text-slate-700">{process}</b> · all numbers below are for the current case scope
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryTile label="Cases" value={selectedTraces.length.toLocaleString('en-US')} />
        <SummaryTile label="Rows in file" value={v ? v.rawCount.toLocaleString('en-US') : '—'} sub={v && v.excludedCount ? `${v.excludedCount} excluded` : 'all processes'} />
        <SummaryTile label="Recorded steps" value={steps.toLocaleString('en-US')} sub="complete/point events" />
        <SummaryTile label="Activities" value={<EngineGate result={dfg} compact>{(d) => d.nodes.length}</EngineGate>} />
        <SummaryTile
          label={elapsed ? kpiName(elapsed.id) : 'Average case duration'}
          value={elapsed ? fmtMinutes(elapsed.value) : '—'}
          sub="first → last recorded event, not confirmed completion"
        />
        <SummaryTile label="Most common path" value={top ? fmtShare(top.share) : '—'} sub={top ? `${plural(top.count, 'case')} · ${top.activities.length} steps` : undefined} />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white px-3.5 py-3">
      <div className="truncate text-xs font-medium text-slate-500" title={label}>{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold tracking-tight text-slate-900 tabular">{value}</div>
      {sub && <div className="truncate text-[11px] text-slate-400" title={sub}>{sub}</div>}
    </div>
  );
}

function ProcessChooser({ onExplore }: { onExplore: () => void }) {
  const { state, dispatch } = useStore();
  const { traces } = useAnalysis();
  const rows = useMemo(() => {
    const by = new Map<string, { cases: number; rows: number }>();
    for (const t of traces?.status === 'ok' ? traces.data : []) {
      const r = by.get(t.processType) ?? { cases: 0, rows: 0 };
      r.cases += 1;
      r.rows += t.events.length;
      by.set(t.processType, r);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [traces]);
  return (
    <Card title="Processes in this log" subtitle="Each process is mined on its own — logs of different processes are never merged into one trace.">
      <div className="grid gap-2 md:grid-cols-3">
        {rows.map(([key, r]) => {
          const active = state.view.processKey === key;
          const info = state.dataset?.festival ? FESTIVAL_PROCESS_INFO[key] : undefined;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => dispatch({ type: 'SET_VIEW', view: { processKey: key } })}
              className={cx('rounded-xl border px-3 py-2.5 text-left transition', active ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-slate-800">{processLabel(key, state.dataset?.festival)}</span>
                {active && <Icon name="check" className="h-4 w-4 text-brand-600" />}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 tabular">{plural(r.cases, 'case')} · {plural(r.rows, 'row')}</div>
              {info && <div className="mt-1 text-[11.5px] leading-snug text-slate-500">{info.question}</div>}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="subtle" iconRight="arrowRight" onClick={onExplore}>Explore selected process</Button>
      </div>
    </Card>
  );
}

function Provenance() {
  const { state } = useStore();
  const d = state.dataset!;
  const m = d.metadata;
  const synthetic = d.sourceKind !== 'user_upload' || m?.sourceType === 'synthetic';
  const info = d.festival && state.view.processKey ? FESTIVAL_PROCESS_INFO[state.view.processKey] : undefined;
  return (
    <Card title="Where this data comes from" subtitle={synthetic ? 'Synthetic data: generated for demonstration, not observed operations.' : 'Your file. It stays in this browser and is not uploaded.'}>
      <KeyValue
        items={[
          ['Source', d.sourceKind === 'bundled_sample' ? 'Bundled sample' : d.sourceKind === 'festival_sample' ? 'Published Festival sample' : d.sourceKind === 'ui_fixture' ? 'Interface test log' : 'Uploaded by you'],
          ['Data type', synthetic ? <Badge tone="violet">Synthetic</Badge> : <Badge tone="blue">Your data</Badge>],
          ['File', <span className="break-all">{d.sourceName}{d.format === 'xes' ? ' (XES)' : ' (CSV)'}</span>],
          ...(m?.timezone ? ([['Timezone', m.timezone]] as [string, string][]) : []),
          ...(d.manifest?.generator ? ([['Generator', `${d.manifest.generator.version ?? '—'} · seed ${d.manifest.generator.seed ?? '—'}`]] as [string, string][]) : []),
        ]}
      />
      {info && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
          <div className="font-semibold text-slate-800">{processLabel(state.view.processKey!, true)}</div>
          <div><span className="text-slate-500">One case =</span> {info.caseMeaning}</div>
          <div><span className="text-slate-500">Purpose:</span> {info.purpose}</div>
          <div><span className="text-slate-500">Actors:</span> {info.actors}</div>
          <div><span className="text-slate-500">From → to:</span> {info.boundary}</div>
        </div>
      )}
      {m?.assumptions?.length ? (
        <details className="mt-3 text-[12.5px] text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">{plural(m.assumptions.length, 'modeling assumption')}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{m.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      ) : null}
      {m?.sourceReferences?.length ? (
        <details className="mt-2 text-[12.5px] text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">{plural(m.sourceReferences.length, 'public reference')}</summary>
          <ul className="mt-1 list-disc space-y-0.5 break-all pl-4">{m.sourceReferences.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      ) : null}
    </Card>
  );
}
