import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { gateScenarioAvailable } from '../festival/adapter';
import { OtherScopesNote } from '../components/WorkspaceHistory';
import type { DesignRecord, DesignStatus, PageId } from '../state/types';
import { fmtInstant, plural } from '../lib/format';
import { FlowGraph, type GraphSelection } from '../components/graph/FlowGraph';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Tabs, TextArea, cx } from '../components/ui';

// bpmn-js is large; load it only when a BPMN diagram is shown.
const BpmnViewer = lazy(() => import('../components/BpmnViewer').then((m) => ({ default: m.BpmnViewer })));

const STATUS_TONE: Record<DesignStatus, 'neutral' | 'blue' | 'green' | 'red'> = {
  draft: 'neutral',
  ready: 'blue',
  approved: 'green',
  rejected: 'red',
};

export function DesignPage({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace();
  const { scope } = useAnalysis();
  const { dispatch, state } = useStore();
  const active = ws?.designs.find((d) => d.id === ws.activeDesignId) ?? null;

  const newBlank = () => {
    if (!scope) return;
    const now = Date.now();
    dispatch({
      type: 'UPSERT_DESIGN',
      design: {
        id: uid('design'),
        title: 'Untitled improvement proposal',
        findingIds: [],
        findingText: [],
        changeNote: '',
        affectedActivities: [],
        targetMetricId: null,
        asIsBpmnRef: null,
        toBeBpmnRef: null,
        kind: gateScenarioAvailable(state.dataset?.festival, scope.processKey) ? 'simulation' : 'proposal_only',
        status: 'draft',
        scope,
        createdAt: now,
        updatedAt: now,
      },
    });
  };

  return (
    <div>
      <PageHeader
        phase="Phase 2 · Process redesign"
        title="Design"
        subtitle="View the modeled As-is BPMN, choose an improvement proposal linked to findings, and save a design record that feeds Model, Refine and Implementation."
        actions={<Button variant="primary" onClick={newBlank} disabled={!scope}>New design record</Button>}
      />
      <div className="-mt-3 mb-4"><OtherScopesNote navigate={navigate} /></div>
      <RequireData navigate={navigate}>
        <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
          <Card title="Design records" subtitle="Saved per dataset + process" bodyClassName="p-2">
            {!ws?.designs.length ? (
              <div className="p-2">
                <EmptyState title="No design records">
                  Create one from a finding in Analysis → Findings, or start a blank record.
                </EmptyState>
                <Button className="mt-3 w-full" onClick={() => navigate('analysis')}>Go to findings</Button>
              </div>
            ) : (
              <ul className="space-y-1">
                {ws.designs.map((d) => {
                  const stale = isScopeStale(d.scope, scope);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'SET_ACTIVE_DESIGN', id: d.id })}
                        className={cx(
                          'w-full rounded-md border px-3 py-2 text-left transition',
                          d.id === ws.activeDesignId ? 'border-brand-500 bg-brand-50' : 'border-transparent hover:bg-slate-50',
                        )}
                      >
                        <div className="line-clamp-2 text-sm font-medium text-slate-800">{d.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                          <Badge tone={d.kind === 'simulation' ? 'violet' : 'neutral'}>{d.kind === 'simulation' ? 'simulation-linked' : 'proposal only'}</Badge>
                          {stale && <Badge tone="amber" title="Created under a different case filter">other filter</Badge>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <div className="min-w-0 space-y-4">
            {active ? <DesignEditor key={active.id} design={active} navigate={navigate} /> : (
              <Card title="Design record"><p className="text-sm text-slate-500">Select or create a design record.</p></Card>
            )}
            <ModelPanel design={active} />
          </div>
        </div>
      </RequireData>
    </div>
  );
}

function DesignEditor({ design, navigate }: { design: DesignRecord; navigate: (p: PageId) => void }) {
  const { dispatch, state } = useStore();
  const { findings, dfg, kpis, scope } = useAnalysis();
  const [draft, setDraft] = useState(design);
  useEffect(() => setDraft(design), [design]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(design);
  const activities = dfg?.status === 'ok' ? dfg.data.nodes.map((n) => n.activity) : [];
  const metricIds = kpis?.status === 'ok' ? kpis.data.map((m) => m.id) : [];
  const allFindings = findings?.status === 'ok' ? findings.data : [];
  const bpmnNames = Object.keys(state.bpmnDocs);
  const isAudience = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);
  const titleInvalid = !draft.title.trim();

  const save = () => {
    const linked = allFindings.filter((f) => draft.findingIds.includes(f.id));
    dispatch({
      type: 'UPSERT_DESIGN',
      design: {
        ...draft,
        title: draft.title.trim(),
        findingText: linked.length ? linked.map((f) => f.text) : draft.findingText,
        updatedAt: Date.now(),
      },
    });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Design record saved.' });
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Card
      title="Design record"
      subtitle={<>ID <code className="font-mono">{design.id}</code> · created {fmtInstant(design.createdAt)} · updated {fmtInstant(design.updatedAt)}</>}
      actions={
        <>
          <Button size="sm" variant="danger" onClick={() => confirm('Delete this design record?') && dispatch({ type: 'DELETE_DESIGN', id: design.id })}>Delete</Button>
          <Button size="sm" variant="primary" disabled={!dirty || titleInvalid} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</Button>
        </>
      }
    >
      {isScopeStale(design.scope, scope) && (
        <div className="mb-3">
          <Notice tone="warning">This record was created under a different case filter. Its finding references describe that scope, not the current one.</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Proposal title" error={titleInvalid ? 'A title is required.' : null}>
            <Input value={draft.title} invalid={titleInvalid} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Change specification" hint="What changes in the To-be process, and the assumptions behind it.">
            <TextArea rows={5} value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} placeholder="e.g. Add one staffed entry gate at peak arrival; one qualified worker per gate." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DesignStatus })}>
                {(['draft', 'ready', 'approved', 'rejected'] as const).map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Target KPI">
              <Select value={draft.targetMetricId ?? ''} onChange={(e) => setDraft({ ...draft, targetMetricId: e.target.value || null })}>
                <option value="">— none —</option>
                {[...new Set([...metricIds, ...(draft.targetMetricId ? [draft.targetMetricId] : [])])].map((m) => <option key={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
          <Field
            label="Evaluation type"
            hint={isAudience ? 'Simulation-linked records can be quantified with the Festival audience gate model in Refine.' : 'The quantified gate simulation applies only to the Festival audience process (Festival adapters enabled). Other processes get proposal-only plans without numeric effects.'}
          >
            <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DesignRecord['kind'] })}>
              <option value="proposal_only">Proposal only (no quantified effect)</option>
              <option value="simulation" disabled={!isAudience}>Simulation-linked (Festival audience gate queue)</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-3">
          <Field label={`Linked findings (${draft.findingIds.length})`}>
            <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-slate-200 p-2">
              {allFindings.length === 0 && <div className="text-xs text-slate-400">No findings available for the current scope.</div>}
              {allFindings.map((f) => (
                <label key={f.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={draft.findingIds.includes(f.id)} onChange={() => setDraft({ ...draft, findingIds: toggle(draft.findingIds, f.id) })} />
                  <span>{f.text}</span>
                </label>
              ))}
              {draft.findingIds.filter((id) => !allFindings.some((f) => f.id === id)).map((id) => (
                <div key={id} className="text-xs text-amber-700">⚠ {id} is not present in the current scope (kept as reference).</div>
              ))}
            </div>
          </Field>
          <Field label="Affected activities">
            <div className="flex flex-wrap gap-1">
              {activities.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setDraft({ ...draft, affectedActivities: toggle(draft.affectedActivities, a) })}
                  className={cx(
                    'rounded border px-2 py-0.5 text-xs',
                    draft.affectedActivities.includes(a) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  {a}
                </button>
              ))}
              {!activities.length && <span className="text-xs text-slate-400">Activities appear once the DFG is available.</span>}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="As-is BPMN reference">
              <Select value={draft.asIsBpmnRef ?? ''} onChange={(e) => setDraft({ ...draft, asIsBpmnRef: e.target.value || null })}>
                <option value="">— none —</option>
                {[...new Set([...bpmnNames, ...(draft.asIsBpmnRef ? [draft.asIsBpmnRef] : [])])].map((n) => <option key={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="To-be BPMN reference">
              <Select value={draft.toBeBpmnRef ?? ''} onChange={(e) => setDraft({ ...draft, toBeBpmnRef: e.target.value || null })}>
                <option value="">— change note only —</option>
                {[...new Set([...bpmnNames, ...(draft.toBeBpmnRef ? [draft.toBeBpmnRef] : [])])].map((n) => <option key={n}>{n}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        <span className="mr-auto self-center text-xs text-slate-500">{dirty ? 'Unsaved changes' : 'All changes saved to this workspace'}</span>
        <Button onClick={() => navigate('model')}>Set targets in Model →</Button>
        {draft.kind === 'simulation' ? (
          <Button onClick={() => navigate('refine')}>Evaluate in Refine →</Button>
        ) : (
          <Button onClick={() => navigate('implementation')}>Proposal-only plan →</Button>
        )}
      </div>
    </Card>
  );
}

type ModelTab = 'asis' | 'tobe' | 'dfg';

const BPMN_ROOT = /<([\w-]+:)?definitions[\s>]/;
type AssetStatus = { status: 'loading' | 'ok' | 'error'; message?: string };

/** Loads BPMN files named in the Festival manifest (As-is and optional To-be) into the in-memory store. */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state.bpmnDocs, dispatch]);
  return status;
}

type Resolved =
  | { kind: 'render'; name: string; xml: string; origin: 'reference' | 'manifest' | 'manifest_unlinked' }
  | { kind: 'reference_missing'; name: string; asset?: AssetStatus }
  | { kind: 'manifest_unavailable'; name: string; asset?: AssetStatus }
  | { kind: 'none' };

/**
 * Distinguishes: a loaded diagram; a reference saved in the design whose XML is not in this
 * session (e.g. after a page reload); a manifest asset that failed or is loading; and no BPMN at all.
 */
function resolveBpmn(ref: string | null, manifestName: string | undefined, docs: Record<string, string>, assets: Record<string, AssetStatus>): Resolved {
  if (ref) {
    if (docs[ref]) return { kind: 'render', name: ref, xml: docs[ref], origin: ref === manifestName ? 'manifest' : 'reference' };
    return { kind: 'reference_missing', name: ref, asset: ref === manifestName ? assets[ref] : undefined };
  }
  if (manifestName) {
    if (docs[manifestName]) return { kind: 'render', name: manifestName, xml: docs[manifestName], origin: 'manifest_unlinked' };
    return { kind: 'manifest_unavailable', name: manifestName, asset: assets[manifestName] };
  }
  return { kind: 'none' };
}

function ModelPanel({ design }: { design: DesignRecord | null }) {
  const { state, dispatch } = useStore();
  const { dfg, scope } = useAnalysis();
  const [tab, setTab] = useState<ModelTab>('asis');
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const onSelect = useCallback((s: GraphSelection) => setSelection(s), []);
  const processKey = scope?.processKey ?? '';
  // Manifest BPMN assets apply only to datasets with Festival adapters enabled.
  const manifest = state.dataset?.festival ? state.dataset.manifest : undefined;
  const manifestAsIs = manifest?.bpmn?.[processKey];
  const manifestToBe = manifest?.bpmn_to_be?.[processKey];
  const assets = useManifestBpmn([manifestAsIs, manifestToBe]);
  const asIs = resolveBpmn(design?.asIsBpmnRef ?? null, manifestAsIs, state.bpmnDocs, assets);
  // To-be: a design without a reference shows the manifest To-be only as "not linked".
  const toBe = resolveBpmn(design?.toBeBpmnRef ?? null, manifestToBe, state.bpmnDocs, assets);
  const current = tab === 'asis' ? asIs : tab === 'tobe' ? toBe : null;

  const onUpload = (file: File) => {
    setError(null);
    file.text().then((text) => {
      if (!BPMN_ROOT.test(text)) {
        setError(`${file.name} does not look like BPMN 2.0 XML (no <definitions> element).`);
        return;
      }
      dispatch({ type: 'ADD_BPMN', name: file.name, xml: text });
      dispatch({ type: 'TOAST', tone: 'success', message: `${file.name} loaded for this session. Select it as As-is or To-be reference in the design record.` });
    });
  };

  const linkToBe = (name: string) => {
    if (!design) return;
    dispatch({ type: 'UPSERT_DESIGN', design: { ...design, toBeBpmnRef: name, updatedAt: Date.now() } });
  };

  const dfgGraph = useMemo(() => {
    if (dfg?.status !== 'ok') return null;
    return {
      nodes: dfg.data.nodes.map((n) => ({ id: n.activity, label: n.activity, kind: 'activity' as const, primary: String(n.count) })),
      edges: dfg.data.edges.map((e) => ({ id: `${e.from}>${e.to}`, source: e.from, target: e.to, count: e.count })),
    };
  }, [dfg]);

  const loadedNames = Object.keys(state.bpmnDocs);
  const what = tab === 'asis' ? 'As-is' : 'To-be';

  return (
    <Card
      title="Process models"
      subtitle="BPMN is a modeled business artifact, shown next to the discovered DFG for visual comparison. No conformance score is computed. Imported XML is kept for this browser session only."
      actions={
        <label className="inline-flex h-7 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          Import BPMN XML
          <input type="file" accept=".bpmn,.xml" className="sr-only" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      }
    >
      <Tabs<ModelTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'asis', label: 'As-is BPMN' },
          { id: 'tobe', label: 'To-be BPMN' },
          { id: 'dfg', label: 'Discovered DFG' },
        ]}
      />
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {tab === 'dfg' || !current ? (
        dfgGraph ? <FlowGraph nodes={dfgGraph.nodes} edges={dfgGraph.edges} selection={selection} onSelect={onSelect} height={420} /> : <EmptyState title="DFG unavailable" />
      ) : current.kind === 'render' ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone="violet">modeled</Badge> {current.name}
            {current.origin === 'manifest' && <Badge>from Festival manifest</Badge>}
            {current.origin === 'reference' && <Badge>design reference</Badge>}
            {current.origin === 'manifest_unlinked' && (
              <>
                <Badge tone="amber">Festival manifest {what} — {tab === 'tobe' ? 'not linked to this design' : 'default for this process'}</Badge>
                {tab === 'tobe' && design && <Button size="sm" onClick={() => linkToBe(current.name)}>Link to this design</Button>}
              </>
            )}
          </div>
          <Suspense fallback={<div className="py-10 text-center text-sm text-slate-500">Loading BPMN viewer…</div>}>
            <BpmnViewer xml={current.xml} />
          </Suspense>
        </>
      ) : current.kind === 'reference_missing' ? (
        <EmptyState title={`${what} reference saved, diagram not loaded`} icon="⬚">
          This design references <code className="font-mono">{current.name}</code>, but its XML is not loaded in this browser session (imported BPMN is not persisted, for example after a page reload).
          {current.asset?.status === 'loading' && ' Loading it from the Festival manifest…'}
          {current.asset?.status === 'error' && ` The Festival manifest copy failed to load: ${current.asset.message}`}
          {!current.asset && ' Import the same file again to view it.'}
        </EmptyState>
      ) : current.kind === 'manifest_unavailable' ? (
        <EmptyState title={current.asset?.status === 'error' ? `Festival manifest ${what} BPMN failed to load` : `Loading Festival manifest ${what} BPMN…`} icon="⬚">
          <code className="font-mono">bpmn/{current.name}</code>
          {current.asset?.status === 'error' && <>: {current.asset.message}</>}
        </EmptyState>
      ) : (
        <EmptyState title={tab === 'asis' ? 'No As-is BPMN for this process' : design ? 'No To-be BPMN: change note only' : 'No To-be BPMN'} icon="⬚">
          {tab === 'asis'
            ? state.dataset?.festival
              ? `The Festival manifest lists no As-is BPMN for "${processKey}". Import a modeled BPMN XML file.`
              : 'General logs have no bundled model. Import a modeled BPMN XML file; ProcessPilot does not generate BPMN from the log.'
            : design
              ? 'This design has no To-be BPMN reference, so its change specification is the change note. Import a To-be BPMN and select it in the design record if one exists.'
              : 'Select a design record first.'}
          {loadedNames.length > 0 && (
            <div className="mt-2 text-xs">Loaded this session: {plural(loadedNames.length, 'file')} ({loadedNames.join(', ')})</div>
          )}
        </EmptyState>
      )}
    </Card>
  );
}
