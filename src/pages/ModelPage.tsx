/**
 * Model — BPMN Modeling Studio. The As-is reference stays read-only; the To-be
 * is an editable copy in the native bpmn-js Modeler with separate revisions.
 * Drawing BPMN never changes simulation inputs or claims a performance effect.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { callEngine, hasCapability } from '../adapters/engineAdapter';
import type { BpmnMappingOverride } from '../v03-contracts';
import { useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import type { BpmnRevisionRef, DesignRecord, PageId } from '../state/types';
import { BLANK_TO_BE, BPMN_ROOT, diCoverage, parseBpmn } from '../lib/bpmn';
import { downloadText, slug } from '../lib/files';
import { fmtInstant, fmtShare, plural } from '../lib/format';
import { FlowGraph, type GraphSelection } from '../components/graph/FlowGraph';
import { RequireData } from '../components/layout';
import { Icon } from '../components/icons';
import type { BpmnModelerHandle } from '../components/BpmnModeler';
import { Badge, Button, Card, EmptyState, EngineGate, InfoTip, Metric, Notice, PageHeader, Segmented, Select, Table, Tabs, Td, Th, Unavailable } from '../components/ui';
import { dfgGraph } from './analysis/graphs';

// bpmn-js is large; load it only when a diagram is shown.
const BpmnViewer = lazy(() => import('../components/BpmnViewer').then((m) => ({ default: m.BpmnViewer })));
const BpmnModeler = lazy(() => import('../components/BpmnModeler').then((m) => ({ default: m.BpmnModeler })));

type Tab = 'compare' | 'asis' | 'tobe' | 'mapping';
type AssetStatus = { status: 'loading' | 'ok' | 'error'; message?: string };

/** Loads BPMN files named in the Festival manifest into the in-memory store. */
function useManifestBpmn(names: (string | undefined)[]): Record<string, AssetStatus> {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<Record<string, AssetStatus>>({});
  const requested = useRef(new Set<string>());
  const key = names.filter(Boolean).join('|');
  useEffect(() => {
    for (const name of key ? key.split('|') : []) {
      if (state.bpmnDocs[name]) {
        setStatus((s) => (s[name]?.status === 'ok' ? s : { ...s, [name]: { status: 'ok' } }));
        continue;
      }
      if (requested.current.has(name)) continue;
      requested.current.add(name);
      setStatus((s) => ({ ...s, [name]: { status: 'loading' } }));
      fetch(`${import.meta.env.BASE_URL}bpmn/${name}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const xml = await res.text();
          if (!BPMN_ROOT.test(xml)) throw new Error('File is not BPMN 2.0 XML (no <definitions> element).');
          dispatch({ type: 'ADD_BPMN', name, xml });
          setStatus((s) => ({ ...s, [name]: { status: 'ok' } }));
        })
        .catch((e: unknown) => setStatus((s) => ({ ...s, [name]: { status: 'error', message: e instanceof Error ? e.message : String(e) } })));
    }
  }, [key, state.bpmnDocs, dispatch]);
  return status;
}

const isToBeDoc = (name: string) => name.startsWith('tobe:');

export function ModelPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <RequireData navigate={navigate}>
      <Studio navigate={navigate} />
    </RequireData>
  );
}

function Studio({ navigate }: { navigate: (p: PageId) => void }) {
  const { state, dispatch } = useStore();
  const ws = useWorkspace();
  const { scope, dfg } = useAnalysis();
  const [tab, setTab] = useState<Tab>('compare');
  const [error, setError] = useState<string | null>(null);
  const design = ws?.designs.find((d) => d.id === ws.activeDesignId) ?? null;
  const processKey = scope?.processKey ?? '';
  const manifest = state.dataset?.festival ? state.dataset.manifest : undefined;
  const manifestAsIs = manifest?.bpmn?.[processKey];
  const manifestToBe = manifest?.bpmn_to_be?.[processKey];
  const assets = useManifestBpmn([manifestAsIs, manifestToBe]);

  /* ---------- As-is reference ---------- */
  const asIsOptions = useMemo(
    () => [...new Set([...(manifestAsIs ? [manifestAsIs] : []), ...Object.keys(state.bpmnDocs).filter((n) => !isToBeDoc(n) && n !== manifestToBe)])],
    [manifestAsIs, manifestToBe, state.bpmnDocs],
  );
  const [asIsPick, setAsIsPick] = useState<string | null>(null);
  const asIsName = asIsPick ?? design?.asIsBpmnRef ?? manifestAsIs ?? asIsOptions[0] ?? null;
  const asIsXml = asIsName ? state.bpmnDocs[asIsName] : undefined;
  const asIsStatus = asIsName ? assets[asIsName] : undefined;

  const pickAsIs = (name: string) => {
    setAsIsPick(name);
    if (design) dispatch({ type: 'UPSERT_DESIGN', design: { ...design, asIsBpmnRef: name, updatedAt: Date.now() } });
  };

  const importAsIs = (file: File) => {
    setError(null);
    file.text().then((text) => {
      if (!BPMN_ROOT.test(text)) return setError(`${file.name} is not BPMN 2.0 XML (no <definitions> element).`);
      const parsed = parseBpmn(text);
      if (parsed.error) return setError(`${file.name}: ${parsed.error}`);
      dispatch({ type: 'ADD_BPMN', name: file.name, xml: text });
      pickAsIs(file.name);
      dispatch({ type: 'TOAST', tone: 'success', message: `${file.name} loaded as a reference model for this session.` });
    });
  };

  /* ---------- To-be revisions ---------- */
  const revisions = useMemo(
    () => (ws?.bpmnRevisions ?? []).filter((r) => (design ? r.designId === design.id : r.designId === null)),
    [ws?.bpmnRevisions, design],
  );
  const latest = revisions.at(-1) ?? null;
  const [revPick, setRevPick] = useState<string | null>(null);
  const revision = revisions.find((r) => r.docName === revPick) ?? latest;
  const toBeXml = revision ? state.bpmnDocs[revision.docName] : undefined;

  const addRevision = (xml: string, note: string, base: BpmnRevisionRef | null, sourceRef: string | null) => {
    if (!scope) return null;
    const modelId = base?.modelId ?? uid('model');
    const n = base ? Math.max(...revisions.filter((r) => r.modelId === modelId).map((r) => r.revision)) + 1 : 1;
    const ref: BpmnRevisionRef = {
      modelId,
      revision: n,
      docName: `tobe:${modelId}:r${n}`,
      sourceRef,
      designId: design?.id ?? null,
      scope,
      createdAt: Date.now(),
      note,
    };
    dispatch({ type: 'ADD_BPMN_REVISION', revision: ref, xml });
    if (design) dispatch({ type: 'UPSERT_DESIGN', design: { ...design, toBeBpmnRef: ref.docName, asIsBpmnRef: design.asIsBpmnRef ?? asIsName, updatedAt: Date.now() } });
    setRevPick(ref.docName);
    return ref;
  };

  const startToBe = (from: 'asis' | 'blank' | 'manifest') => {
    const xml = from === 'asis' ? asIsXml : from === 'manifest' && manifestToBe ? state.bpmnDocs[manifestToBe] : BLANK_TO_BE;
    if (!xml) return;
    addRevision(xml, from === 'asis' ? `Copy of ${asIsName}` : from === 'manifest' ? `Copy of ${manifestToBe}` : 'Blank model', null, from === 'asis' ? asIsName : from === 'manifest' ? manifestToBe ?? null : null);
    setTab('tobe');
  };

  const dfgSpec = useMemo(() => (dfg?.status === 'ok' ? dfgGraph(dfg.data, { minCount: 1 }) : null), [dfg]);
  const [sel, setSel] = useState<GraphSelection>(null);

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        phase="3 · Model"
        title="BPMN Modeling Studio"
        subtitle="Compare the reference model with what the log shows, then edit a To-be copy. The original As-is model is never changed."
        compact
        actions={
          <>
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13.5px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500">
              <Icon name="upload" className="h-4 w-4" /> Import As-is BPMN
              <input type="file" accept=".bpmn,.xml" className="sr-only" onChange={(e) => e.target.files?.[0] && importAsIs(e.target.files[0])} />
            </label>
            {design?.evaluation === 'quantitative' || design?.kind === 'simulation' ? (
              <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('refine')}>Evaluate scenario</Button>
            ) : (
              <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('implementation')}>Plan the rollout</Button>
            )}
          </>
        }
      />
      <ContextStrip design={design} asIsOptions={asIsOptions} asIsName={asIsName} onPickAsIs={pickAsIs} navigate={navigate} />
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="!mb-0"
        tabs={[
          { id: 'compare', label: 'Compare', icon: 'compare' },
          { id: 'asis', label: 'As-is (reference)', icon: 'lock' },
          { id: 'tobe', label: 'To-be editor', icon: 'edit', count: revisions.length || undefined },
          { id: 'mapping', label: 'Activity mapping', icon: 'link' },
        ]}
      />

      {tab === 'compare' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <ComparePane title="Reference / To-be model" badge={<Badge tone="violet">modeled</Badge>}>
            <ModelSwitch asIsName={asIsName} asIsXml={asIsXml} asIsStatus={asIsStatus} revision={revision} toBeXml={toBeXml} onStart={startToBe} manifestToBe={manifestToBe} />
          </ComparePane>
          <ComparePane title="Observed process map" badge={<Badge tone="blue">from the log</Badge>}>
            {dfgSpec ? <div className="h-[540px] bg-slate-50/40"><FlowGraph nodes={dfgSpec.nodes} edges={dfgSpec.edges} selection={sel} onSelect={setSel} height="100%" /></div> : <EngineGate result={dfg}>{() => null}</EngineGate>}
          </ComparePane>
          <p className="text-xs text-slate-500 lg:col-span-2">
            The models are shown side by side for visual comparison. Use <b>Activity mapping</b> to link BPMN tasks to logged activities; deviation checks only cover simple sequential/XOR models. No overall conformance score is computed.
          </p>
        </div>
      )}

      {tab === 'asis' && (
        <Card
          title={asIsName ?? 'No reference model'}
          subtitle="Read-only reference. To change it, create an editable To-be copy."
          actions={asIsXml ? <Button variant="subtle" icon="edit" onClick={() => startToBe('asis')}>Create editable To-be copy</Button> : undefined}
        >
          {asIsXml ? (
            <>
              <ModelSummary xml={asIsXml} />
              <Suspense fallback={<Loading />}>
                <BpmnViewer xml={asIsXml} height={560} />
              </Suspense>
            </>
          ) : (
            <NoReference status={asIsStatus} festival={!!state.dataset?.festival} />
          )}
        </Card>
      )}

      {tab === 'tobe' && (
        <ToBeEditor
          design={design}
          revisions={revisions}
          revision={revision}
          xml={toBeXml}
          asIsAvailable={!!asIsXml}
          manifestToBe={manifestToBe && state.bpmnDocs[manifestToBe] ? manifestToBe : undefined}
          onStart={startToBe}
          onPick={setRevPick}
          onSave={(xml, note) => addRevision(xml, note, revision, revision?.sourceRef ?? null)}
          onImport={(xml, name) => addRevision(xml, `Imported from ${name}`, revision, revision?.sourceRef ?? null)}
        />
      )}

      {tab === 'mapping' && <Mapping asIsName={asIsName} asIsXml={asIsXml} revision={revision} toBeXml={toBeXml} />}
    </div>
  );
}

function Loading() {
  return <div className="py-16 text-center text-sm text-slate-500">Loading BPMN editor…</div>;
}

function ContextStrip({
  design,
  asIsOptions,
  asIsName,
  onPickAsIs,
  navigate,
}: {
  design: DesignRecord | null;
  asIsOptions: string[];
  asIsName: string | null;
  onPickAsIs: (n: string) => void;
  navigate: (p: PageId) => void;
}) {
  const { dispatch } = useStore();
  const ws = useWorkspace();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px]">
      <label className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Design</span>
        {ws?.designs.length ? (
          <Select className="!w-auto max-w-[320px] !py-1 text-[13px]" value={design?.id ?? ''} onChange={(e) => dispatch({ type: 'SET_ACTIVE_DESIGN', id: e.target.value || null })}>
            <option value="">— none (unlinked model) —</option>
            {ws.designs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </Select>
        ) : (
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => navigate('design')}>Create a design first →</button>
        )}
      </label>
      {design?.changeNote && <span className="max-w-[420px] truncate text-xs text-slate-500" title={design.changeNote}>Change: {design.changeNote}</span>}
      <label className="ml-auto flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Reference model</span>
        {asIsOptions.length ? (
          <Select className="!w-auto max-w-[280px] !py-1 text-[13px]" value={asIsName ?? ''} onChange={(e) => onPickAsIs(e.target.value)}>
            {asIsOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        ) : (
          <span className="text-xs text-slate-500">none loaded</span>
        )}
      </label>
    </div>
  );
}

function ComparePane({ title, badge, children }: { title: string; badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-[13px] font-semibold text-slate-800">{title}</span>
        {badge}
      </header>
      {children}
    </section>
  );
}

function ModelSwitch({
  asIsName,
  asIsXml,
  asIsStatus,
  revision,
  toBeXml,
  onStart,
  manifestToBe,
}: {
  asIsName: string | null;
  asIsXml?: string;
  asIsStatus?: AssetStatus;
  revision: BpmnRevisionRef | null;
  toBeXml?: string;
  onStart: (from: 'asis' | 'blank' | 'manifest') => void;
  manifestToBe?: string;
}) {
  const [which, setWhich] = useState<'asis' | 'tobe'>('asis');
  const { state } = useStore();
  const xml = which === 'asis' ? asIsXml : toBeXml;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        <Segmented size="sm" value={which} onChange={setWhich} ariaLabel="Model" options={[{ id: 'asis', label: 'As-is' }, { id: 'tobe', label: revision ? `To-be r${revision.revision}` : 'To-be' }]} />
        <span className="truncate text-xs text-slate-500">{which === 'asis' ? asIsName ?? '' : revision?.note ?? ''}</span>
      </div>
      {xml ? (
        <Suspense fallback={<Loading />}>
          <BpmnViewer xml={xml} height={500} />
        </Suspense>
      ) : which === 'asis' ? (
        <div className="p-4"><NoReference status={asIsStatus} festival={!!state.dataset?.festival} /></div>
      ) : (
        <div className="p-4">
          <EmptyState icon="edit" title={revision ? 'This To-be revision is not loaded' : 'No To-be model yet'} action={!revision ? <>
            {asIsXml && <Button size="sm" variant="primary" onClick={() => onStart('asis')}>Copy As-is to edit</Button>}
            {manifestToBe && state.bpmnDocs[manifestToBe] && <Button size="sm" onClick={() => onStart('manifest')}>Start from Festival To-be</Button>}
            <Button size="sm" onClick={() => onStart('blank')}>Start blank</Button>
          </> : undefined}>
            {revision ? 'BPMN XML is kept only for this browser session. Re-import your exported file in the To-be editor.' : 'Create an editable copy to draw the improved process.'}
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function NoReference({ status, festival }: { status?: AssetStatus; festival: boolean }) {
  if (status?.status === 'loading') return <p className="py-10 text-center text-sm text-slate-500">Loading the Festival reference model…</p>;
  return (
    <EmptyState icon="shapes" title={status?.status === 'error' ? 'The Festival reference model could not be loaded' : 'No reference BPMN for this process'}>
      {status?.status === 'error'
        ? status.message
        : festival
          ? 'The Festival data track has not published a BPMN for this process yet. Import a BPMN 2.0 file with “Import As-is BPMN”.'
          : 'General logs have no bundled model. Import a BPMN 2.0 file (.bpmn or .xml), or start a blank To-be model. ProcessPilot does not generate BPMN from the log.'}
    </EmptyState>
  );
}

function ModelSummary({ xml }: { xml: string }) {
  const parsed = useMemo(() => parseBpmn(xml), [xml]);
  const di = useMemo(() => diCoverage(xml), [xml]);
  if (parsed.error) return <Notice tone="warning" className="mb-3">{parsed.error}</Notice>;
  const tasks = parsed.processes.reduce((s, p) => s + p.reference.nodes.filter((n) => n.kind === 'task').length, 0);
  const unsupported = parsed.processes.flatMap((p) => p.unsupported);
  const lanes = parsed.processes.reduce((s, p) => s + p.laneCount, 0);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
      <span>{plural(parsed.processes.length, 'process', 'processes')}{parsed.participants ? ` · ${plural(parsed.participants, 'pool')}` : ''}{lanes ? ` · ${plural(lanes, 'lane')}` : ''}</span>
      <span>{plural(tasks, 'task')}</span>
      <span>diagram shapes for {di.shapes} of {di.nodes} elements</span>
      {unsupported.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <Badge tone="amber">{plural(unsupported.length, 'element')} outside the deviation check</Badge>
          <InfoTip>{[...new Set(unsupported.map((u) => u.type))].join(', ')}. These stay visible and mappable; only the automatic adjacency check skips them.</InfoTip>
        </span>
      )}
    </div>
  );
}

/* ------------------------------ To-be editor ------------------------------ */

function ToBeEditor({
  design,
  revisions,
  revision,
  xml,
  asIsAvailable,
  manifestToBe,
  onStart,
  onPick,
  onSave,
  onImport,
}: {
  design: DesignRecord | null;
  revisions: BpmnRevisionRef[];
  revision: BpmnRevisionRef | null;
  xml?: string;
  asIsAvailable: boolean;
  manifestToBe?: string;
  onStart: (from: 'asis' | 'blank' | 'manifest') => void;
  onPick: (docName: string) => void;
  onSave: (xml: string, note: string) => void;
  onImport: (xml: string, name: string) => void;
}) {
  const { dispatch } = useStore();
  const editor = useRef<BpmnModelerHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const save = async () => {
    try {
      const out = await editor.current!.saveXML();
      onSave(out, 'Edited in ProcessPilot');
      setDirty(false);
      const di = diCoverage(out);
      setMsg({ tone: 'success', text: `Saved as a new revision. Diagram shapes for ${di.shapes} of ${di.nodes} elements.` });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  const exportXml = async () => {
    try {
      const out = dirty ? await editor.current!.saveXML() : xml!;
      downloadText(`${slug(design?.title ?? 'to-be-model')}-r${revision?.revision ?? 1}${dirty ? '-unsaved' : ''}.bpmn`, out, 'application/xml');
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  const importFile = (file: File) => {
    file.text().then((text) => {
      if (!BPMN_ROOT.test(text)) return setMsg({ tone: 'error', text: `${file.name} is not BPMN 2.0 XML.` });
      const parsed = parseBpmn(text);
      if (parsed.error) return setMsg({ tone: 'error', text: `${file.name}: ${parsed.error}` });
      onImport(text, file.name);
      const di = diCoverage(text);
      setMsg({ tone: 'success', text: `${file.name} imported as a new revision. Diagram shapes for ${di.shapes} of ${di.nodes} elements.` });
      dispatch({ type: 'TOAST', tone: 'success', message: 'BPMN imported as a new To-be revision.' });
    });
  };

  if (!revisions.length) {
    return (
      <Card>
        <EmptyState
          icon="edit"
          title={design ? `Draw the To-be model for “${design.title}”` : 'Draw a To-be model'}
          action={
            <>
              <Button variant="primary" disabled={!asIsAvailable} onClick={() => onStart('asis')}>Copy the As-is model</Button>
              {manifestToBe && <Button onClick={() => onStart('manifest')}>Start from the Festival To-be</Button>}
              <Button onClick={() => onStart('blank')}>Start blank</Button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13.5px] font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                Import BPMN file
                <input type="file" accept=".bpmn,.xml" className="sr-only" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              </label>
            </>
          }
        >
          The editor works on a copy; the reference model is never modified. Each save creates a new revision you can export as BPMN 2.0.
          {!design && ' Tip: select a design above so the model is linked to its evidence.'}
        </EmptyState>
        {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-xs font-medium text-slate-500">Revision</span>
          <Select className="!w-auto !py-1 text-[13px]" value={revision?.docName ?? ''} onChange={(e) => onPick(e.target.value)}>
            {[...revisions].reverse().map((r) => (
              <option key={r.docName} value={r.docName}>r{r.revision} · {r.note} · {fmtInstant(r.createdAt)}</option>
            ))}
          </Select>
        </label>
        {dirty && <Badge tone="amber">unsaved edits</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon="save" disabled={!xml || !dirty} onClick={save}>Save new revision</Button>
          <Button size="sm" icon="download" disabled={!xml} onClick={exportXml}>Export BPMN 2.0</Button>
          <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <Icon name="upload" className="h-3.5 w-3.5" /> Re-import edited file
            <input type="file" accept=".bpmn,.xml" className="sr-only" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {xml ? (
        <>
          <ModelSummary xml={xml} />
          <Suspense fallback={<Loading />}>
            <BpmnModeler ref={editor} xml={xml} height={600} onDirty={setDirty} />
          </Suspense>
          <p className="text-xs text-slate-500">
            Use the palette on the left for tasks, events, gateways, pools and lanes; drag to move, double-click to rename, use the context pad to connect. Drawing changes the model only — simulation inputs and results are not affected.
          </p>
        </>
      ) : (
        <Notice tone="warning" title="This revision’s XML is not loaded in this browser session">
          Models are not stored in the browser by default. Re-import the file you exported for r{revision?.revision} with “Re-import edited file”, or start a new copy.
          <div className="mt-2 flex flex-wrap gap-2">
            {asIsAvailable && <Button size="sm" onClick={() => onStart('asis')}>Copy the As-is model</Button>}
            <Button size="sm" onClick={() => onStart('blank')}>Start blank</Button>
          </div>
        </Notice>
      )}
    </div>
  );
}

/* ------------------------------ Activity mapping ------------------------------ */

function Mapping({ asIsName, asIsXml, revision, toBeXml }: { asIsName: string | null; asIsXml?: string; revision: BpmnRevisionRef | null; toBeXml?: string }) {
  const { api, selectedTraces, dfg } = useAnalysis();
  const ws = useWorkspace();
  const { dispatch } = useStore();
  const [which, setWhich] = useState<'asis' | 'tobe'>(asIsXml ? 'asis' : 'tobe');
  const xml = which === 'asis' ? asIsXml : toBeXml;
  const parsed = useMemo(() => (xml ? parseBpmn(xml) : null), [xml]);
  const [procId, setProcId] = useState<string | null>(null);
  const proc = parsed?.processes.find((p) => p.id === procId) ?? (parsed && parsed.processes.length === 1 ? parsed.processes[0] : null);
  const tasks = proc?.reference.nodes.filter((n) => n.kind === 'task') ?? [];
  const taskIds = new Set(tasks.map((t) => t.id));
  const overrides = (ws?.bpmnOverrides ?? []).filter((o) => o.taskId === null || taskIds.has(o.taskId));
  const available = hasCapability(api, 'getBpmnComparison');
  const comparison = useMemo(
    () => (proc && available ? callEngine(api, 'getBpmnComparison', selectedTraces, proc.reference, overrides) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, available, proc, selectedTraces, JSON.stringify(overrides)],
  );
  const activities = dfg?.status === 'ok' ? dfg.data.nodes : [];
  const setOverride = (activity: string, value: string) => {
    const rest = (ws?.bpmnOverrides ?? []).filter((o) => o.activity !== activity);
    const next: BpmnMappingOverride[] = value === 'auto' ? rest : [...rest, { activity, taskId: value === 'exclude' ? null : value }];
    dispatch({ type: 'SET_BPMN_OVERRIDES', overrides: next });
  };
  const cmp = comparison?.status === 'ok' ? comparison.data : null;
  const STATUS: Record<string, { label: string; tone: 'green' | 'brand' | 'amber' | 'red' | 'neutral' }> = {
    exact: { label: 'same name', tone: 'green' },
    mapped_by_user: { label: 'mapped by you', tone: 'brand' },
    unmapped: { label: 'no task', tone: 'amber' },
    ambiguous: { label: 'ambiguous', tone: 'red' },
    excluded_by_user: { label: 'excluded', tone: 'neutral' },
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px]">
        <Segmented size="sm" value={which} onChange={setWhich} ariaLabel="Model to map" options={[{ id: 'asis', label: `As-is${asIsName ? ` (${asIsName})` : ''}`, disabled: !asIsXml }, { id: 'tobe', label: revision ? `To-be r${revision.revision}` : 'To-be', disabled: !toBeXml }]} />
        {parsed && parsed.processes.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Process in the model</span>
            <Select className="!w-auto !py-1 text-[13px]" value={proc?.id ?? ''} onChange={(e) => setProcId(e.target.value || null)}>
              <option value="">— choose —</option>
              {parsed.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      {!xml ? (
        <EmptyState icon="link" title="No model to map">Load a reference model or create a To-be model first.</EmptyState>
      ) : parsed?.error ? (
        <Notice tone="error">{parsed.error}</Notice>
      ) : !proc ? (
        <Notice tone="info">This model contains several processes (pools). Choose the one that corresponds to the logged process.</Notice>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card title="Logged activities → BPMN tasks" subtitle="ProcessPilot proposes exact, case-sensitive name matches; you can override any row." bodyClassName="p-0">
            <Table className="rounded-none border-0">
              <thead><tr><Th>Logged activity</Th><Th align="right">Times</Th><Th>BPMN task</Th><Th>Status</Th></tr></thead>
              <tbody>
                {activities.map((n) => {
                  const ov = overrides.find((o) => o.activity === n.activity);
                  const row = cmp?.mapping.find((m) => m.activity === n.activity);
                  return (
                    <tr key={n.activity}>
                      <Td className="font-medium">{n.activity}</Td>
                      <Td align="right">{n.count}</Td>
                      <Td>
                        <Select className="!py-1 text-xs" value={ov ? (ov.taskId === null ? 'exclude' : ov.taskId) : 'auto'} onChange={(e) => setOverride(n.activity, e.target.value)} aria-label={`Task for ${n.activity}`}>
                          <option value="auto">{available ? 'Automatic (same name)' : 'Automatic'}</option>
                          {tasks.map((t) => <option key={t.id} value={t.id}>{t.name || `(unnamed ${t.id})`}</option>)}
                          <option value="exclude">Exclude from mapping</option>
                        </Select>
                      </Td>
                      <Td>{row ? <Badge tone={STATUS[row.status]!.tone}>{STATUS[row.status]!.label}</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          <div className="space-y-3">
            {!available ? (
              <Unavailable fn="getBpmnComparison" title="Mapping status and deviation check not available in this build">
                Your choices are saved and will be used once the comparison engine is available.
              </Unavailable>
            ) : comparison && comparison.status !== 'ok' ? (
              <EngineGate result={comparison}>{() => null}</EngineGate>
            ) : cmp ? (
              <>
                <Card title="Coverage">
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="Activities mapped" value={`${cmp.mappedActivityCount} / ${cmp.discoveredActivityCount}`} sub={cmp.discoveredActivityCount ? fmtShare(cmp.mappedActivityCount / cmp.discoveredActivityCount) : undefined} />
                    <Metric label="Logged steps covered" value={`${cmp.mappedOccurrenceCount} / ${cmp.discoveredOccurrenceCount}`} sub={cmp.discoveredOccurrenceCount ? fmtShare(cmp.mappedOccurrenceCount / cmp.discoveredOccurrenceCount) : undefined} />
                  </div>
                  {cmp.referenceOnlyTaskIds.length > 0 && (
                    <div className="mt-3 text-xs text-slate-600">
                      <div className="font-medium">Tasks never seen in the log ({cmp.referenceOnlyTaskIds.length})</div>
                      <div className="mt-1 flex flex-wrap gap-1">{cmp.referenceOnlyTaskIds.map((id) => <Badge key={id}>{tasks.find((t) => t.id === id)?.name || id}</Badge>)}</div>
                    </div>
                  )}
                </Card>
                <Card title="Order check" subtitle="Logged transitions that the model does not allow directly">
                  {cmp.adjacency.status === 'unsupported' ? (
                    <Notice tone="neutral" title="Not checked for this model">
                      {cmp.adjacency.reason === 'unsupported_elements' ? 'The model uses elements beyond tasks, plain start/end and exclusive gateways (e.g. parallel gateways or subprocesses).' : 'The model structure is outside the simple sequential/XOR subset.'} Mapping above still applies; no fitness score is claimed.
                    </Notice>
                  ) : (
                    <>
                      <div className="mb-2 text-xs text-slate-500 tabular">{cmp.adjacency.checkedTransitionCount} transitions checked · {cmp.adjacency.skippedTransitionCount} skipped (unmapped or ambiguous)</div>
                      {cmp.adjacency.deviations.length ? (
                        <ul className="space-y-1">
                          {cmp.adjacency.deviations.map((d) => (
                            <li key={`${d.from}>${d.to}`} className="rounded-lg border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-[13px]">
                              <div className="flex justify-between"><span>{d.from} → {d.to}</span><span className="tabular">{d.count}×</span></div>
                              <div className="text-[11px] text-slate-500">{plural(d.caseKeys.length, 'case')}</div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Notice tone="success">Every checked transition is allowed by the model.</Notice>
                      )}
                    </>
                  )}
                </Card>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

