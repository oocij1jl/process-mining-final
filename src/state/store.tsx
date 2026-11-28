import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Target } from '../contracts';
import type {
  AppState,
  DatasetState,
  WorkspaceMeta,
  DesignRecord,
  PlanRecord,
  PlanTask,
  ProcessWorkspace,
  ScenarioParams,
  ScenarioRecord,
  Toast,
  ViewState,
} from './types';
import { fingerprint } from '../lib/files';
import { DEFAULT_SERVICE_ACTIVITY } from '../festival/adapter';
import { providerFor, scopeOf, workspaceKey } from './scope';

/** v2: workspaces keyed by dataset + provider + process + analysis filter. */
const STORAGE_KEY = 'processpilot.workspaces.v2';
/** Pre-1.1 storage (dataset + process only). Read once for the history view, never modified or deleted. */
const LEGACY_STORAGE_KEY = 'processpilot.workspaces.v1';

/** Dataset revision: content + mapping + import policy + structural exclusions + Festival adapter settings. */
export function datasetIdFor(d: Omit<DatasetState, 'id'>): string {
  return fingerprint(
    JSON.stringify([
      d.contentFingerprint,
      d.mapping,
      d.missingResources,
      d.fixedOffset ?? null,
      d.acceptExclusions,
      d.requireProcessType,
      d.malformedRows.map((m) => m.sourceRow),
      d.festival,
      d.festival ? d.festivalSettings ?? null : null,
    ]),
  );
}

export function defaultScenarioParams(dataset: DatasetState | null): ScenarioParams {
  return {
    serviceActivity: dataset?.metadata?.serviceActivity ?? DEFAULT_SERVICE_ACTIVITY,
    serviceMode: 'observed',
    assumedServiceSec: null,
    baselineGates: dataset?.metadata?.baselineGateCount ?? null,
    candidateGates: null,
  };
}

export function metaFor(dataset: DatasetState, view: ViewState): WorkspaceMeta | null {
  const scope = scopeOf(dataset, view);
  if (!scope) return null;
  return {
    scope,
    provider: providerFor(dataset),
    sourceName: dataset.sourceName,
    sourceKind: dataset.sourceKind,
    filter: { dateFrom: view.dateFrom, dateTo: view.dateTo },
    createdAt: Date.now(),
  };
}

export function currentWorkspaceKey(dataset: DatasetState | null, view: ViewState): string | null {
  const scope = dataset ? scopeOf(dataset, view) : null;
  return scope && dataset ? workspaceKey(scope, providerFor(dataset)) : null;
}

export function emptyWorkspace(dataset: DatasetState, meta: WorkspaceMeta): ProcessWorkspace {
  return {
    meta,
    targets: [],
    designs: [],
    activeDesignId: null,
    scenarioParams: defaultScenarioParams(dataset),
    paramsRevision: 0,
    scenarios: [],
    selectedScenarioId: null,
    plans: [],
    activePlanId: null,
  };
}

export const initialView: ViewState = {
  processKey: null,
  dateFrom: '',
  dateTo: '',
  selectedCaseKey: null,
  throughputBucketMin: 60,
};

export type Action =
  | { type: 'LOAD_DATASET'; dataset: DatasetState }
  | { type: 'CLEAR_DATASET' }
  | { type: 'SET_ACCEPT_EXCLUSIONS'; accept: boolean }
  | { type: 'SET_FESTIVAL'; enabled: boolean }
  | { type: 'COPY_TARGETS'; fromKey: string }
  | { type: 'SET_VIEW'; view: Partial<ViewState> }
  | { type: 'SET_TARGET'; target: Target }
  | { type: 'REMOVE_TARGET'; metricId: string }
  | { type: 'UPSERT_DESIGN'; design: DesignRecord }
  | { type: 'DELETE_DESIGN'; id: string }
  | { type: 'SET_ACTIVE_DESIGN'; id: string | null }
  | { type: 'SET_SCENARIO_PARAMS'; params: Partial<ScenarioParams> }
  | { type: 'ADD_SCENARIO'; scenario: ScenarioRecord }
  | { type: 'SELECT_SCENARIO'; id: string | null }
  | { type: 'ADD_PLAN'; plan: PlanRecord; archiveOthers: boolean }
  | { type: 'SET_ACTIVE_PLAN'; id: string | null }
  | { type: 'ARCHIVE_PLAN'; id: string }
  | { type: 'UPDATE_PLAN'; id: string; patch: Partial<Pick<PlanRecord, 'title'>> }
  | { type: 'UPDATE_TASK'; planId: string; taskId: string; patch: Partial<PlanTask> }
  | { type: 'ADD_TASK'; planId: string; task: PlanTask }
  | { type: 'REMOVE_TASK'; planId: string; taskId: string }
  | { type: 'ADD_BPMN'; name: string; xml: string }
  | { type: 'TOAST'; tone: Toast['tone']; message: string }
  | { type: 'DISMISS_TOAST'; id: number };

let toastSeq = 1;

/** Applies a change to the workspace of the CURRENT scope only (never to another filter/dataset/provider). */
function updateWorkspace(state: AppState, fn: (ws: ProcessWorkspace) => ProcessWorkspace): AppState {
  const { dataset, view } = state;
  const key = currentWorkspaceKey(dataset, view);
  const meta = dataset ? metaFor(dataset, view) : null;
  if (!key || !dataset || !meta) return state;
  const current = state.workspaces[key] ?? emptyWorkspace(dataset, meta);
  if (current.meta.legacy) return state; // legacy records are read-only
  return { ...state, workspaces: { ...state.workspaces, [key]: fn(current) } };
}

function reloadDataset(state: AppState, next: Omit<DatasetState, 'id'>): AppState {
  return { ...state, dataset: { ...next, id: datasetIdFor(next) } as DatasetState, view: { ...initialView, throughputBucketMin: state.view.throughputBucketMin } };
}

function updatePlan(ws: ProcessWorkspace, id: string, fn: (p: PlanRecord) => PlanRecord): ProcessWorkspace {
  return { ...ws, plans: ws.plans.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p)) };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_DATASET':
      return {
        ...state,
        dataset: action.dataset,
        view: { ...initialView, throughputBucketMin: state.view.throughputBucketMin },
      };
    case 'CLEAR_DATASET':
      return { ...state, dataset: null, view: { ...initialView } };
    case 'SET_ACCEPT_EXCLUSIONS':
      return state.dataset ? reloadDataset(state, { ...state.dataset, acceptExclusions: action.accept }) : state;
    case 'SET_FESTIVAL':
      return state.dataset ? reloadDataset(state, { ...state.dataset, festival: action.enabled }) : state;
    case 'COPY_TARGETS': {
      // Explicit user action: copy saved targets from another scope into the current one.
      const from = state.workspaces[action.fromKey];
      if (!from) return state;
      return updateWorkspace(state, (ws) => ({
        ...ws,
        targets: [...ws.targets.filter((t) => !from.targets.some((f) => f.metricId === t.metricId)), ...from.targets],
      }));
    }
    case 'SET_VIEW': {
      const view = { ...state.view, ...action.view };
      if (action.view.processKey !== undefined && action.view.processKey !== state.view.processKey) {
        view.selectedCaseKey = null;
      }
      return { ...state, view };
    }
    case 'SET_TARGET':
      return updateWorkspace(state, (ws) => {
        const exists = ws.targets.some((t) => t.metricId === action.target.metricId);
        return {
          ...ws,
          targets: exists
            ? ws.targets.map((t) => (t.metricId === action.target.metricId ? action.target : t))
            : [...ws.targets, action.target],
        };
      });
    case 'REMOVE_TARGET':
      return updateWorkspace(state, (ws) => ({
        ...ws,
        targets: ws.targets.filter((t) => t.metricId !== action.metricId),
      }));
    case 'UPSERT_DESIGN':
      return updateWorkspace(state, (ws) => {
        const exists = ws.designs.some((d) => d.id === action.design.id);
        return {
          ...ws,
          designs: exists
            ? ws.designs.map((d) => (d.id === action.design.id ? action.design : d))
            : [...ws.designs, action.design],
          activeDesignId: action.design.id,
        };
      });
    case 'DELETE_DESIGN':
      return updateWorkspace(state, (ws) => ({
        ...ws,
        designs: ws.designs.filter((d) => d.id !== action.id),
        activeDesignId: ws.activeDesignId === action.id ? null : ws.activeDesignId,
      }));
    case 'SET_ACTIVE_DESIGN':
      return updateWorkspace(state, (ws) => ({ ...ws, activeDesignId: action.id }));
    case 'SET_SCENARIO_PARAMS':
      // Any parameter edit invalidates computed scenario results (paramsRevision bump).
      return updateWorkspace(state, (ws) => ({
        ...ws,
        scenarioParams: { ...ws.scenarioParams, ...action.params },
        paramsRevision: ws.paramsRevision + 1,
      }));
    case 'ADD_SCENARIO':
      return updateWorkspace(state, (ws) => ({
        ...ws,
        scenarios: [...ws.scenarios, action.scenario],
        selectedScenarioId: action.scenario.id,
      }));
    case 'SELECT_SCENARIO':
      return updateWorkspace(state, (ws) => ({ ...ws, selectedScenarioId: action.id }));
    case 'ADD_PLAN':
      return updateWorkspace(state, (ws) => ({
        ...ws,
        plans: [
          ...ws.plans.map((p) =>
            action.archiveOthers && p.state === 'current' ? { ...p, state: 'archived' as const } : p,
          ),
          action.plan,
        ],
        activePlanId: action.plan.id,
      }));
    case 'SET_ACTIVE_PLAN':
      return updateWorkspace(state, (ws) => ({ ...ws, activePlanId: action.id }));
    case 'ARCHIVE_PLAN':
      return updateWorkspace(state, (ws) => updatePlan(ws, action.id, (p) => ({ ...p, state: 'archived' })));
    case 'UPDATE_PLAN':
      return updateWorkspace(state, (ws) => updatePlan(ws, action.id, (p) => ({ ...p, ...action.patch })));
    case 'UPDATE_TASK':
      return updateWorkspace(state, (ws) =>
        updatePlan(ws, action.planId, (p) => ({
          ...p,
          tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, ...action.patch } : t)),
        })),
      );
    case 'ADD_TASK':
      return updateWorkspace(state, (ws) =>
        updatePlan(ws, action.planId, (p) => ({ ...p, tasks: [...p.tasks, action.task] })),
      );
    case 'REMOVE_TASK':
      return updateWorkspace(state, (ws) =>
        updatePlan(ws, action.planId, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== action.taskId) })),
      );
    case 'ADD_BPMN':
      return { ...state, bpmnDocs: { ...state.bpmnDocs, [action.name]: action.xml } };
    case 'TOAST':
      return {
        ...state,
        toasts: [...state.toasts.slice(-3), { id: toastSeq++, tone: action.tone, message: action.message }],
      };
    case 'DISMISS_TOAST':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

type LegacyWorkspace = Omit<ProcessWorkspace, 'meta'> & { plans: (ProcessWorkspace['plans'][number] & { provider?: string })[] };

/** Pre-1.1 records become read-only "legacy" workspaces in the history view. The v1 key is left untouched. */
export function migrateLegacy(v1: Record<string, LegacyWorkspace>): Record<string, ProcessWorkspace> {
  const out: Record<string, ProcessWorkspace> = {};
  for (const [oldKey, ws] of Object.entries(v1)) {
    const [datasetId = '?', processKey = '?'] = oldKey.split('::');
    const provider = ws.scenarios?.some((s) => s.provider === 'engine') ? 'engine' : 'ui_fixture';
    out[`legacy::${oldKey}`] = {
      ...ws,
      plans: (ws.plans ?? []).map((p) => ({ ...p, provider: (p.provider as 'engine' | 'ui_fixture' | undefined) ?? provider, state: 'archived' as const })),
      meta: {
        scope: { datasetId, processKey, analysisFilterFingerprint: 'pre-1.1 (filter not recorded)' },
        provider,
        sourceName: 'Recorded before v1.1 (source not recorded)',
        sourceKind: provider === 'ui_fixture' ? 'ui_fixture' : 'user_upload',
        filter: { dateFrom: '', dateTo: '' },
        legacy: true,
        createdAt: 0,
      },
    };
  }
  return out;
}

function loadPersisted(): Record<string, ProcessWorkspace> {
  let current: Record<string, ProcessWorkspace> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { version: number; workspaces: Record<string, ProcessWorkspace> }) : null;
    if (parsed?.version === 2 && parsed.workspaces) current = parsed.workspaces;
  } catch {
    /* ignore corrupt storage */
  }
  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacy = legacyRaw ? (JSON.parse(legacyRaw) as { version: number; workspaces: Record<string, LegacyWorkspace> }) : null;
    if (legacy?.version === 1 && legacy.workspaces) {
      for (const [k, ws] of Object.entries(migrateLegacy(legacy.workspaces))) if (!current[k]) current[k] = ws;
    }
  } catch {
    /* ignore */
  }
  return current;
}

const StoreContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    dataset: null,
    view: initialView,
    workspaces: loadPersisted(),
    bpmnDocs: {},
    toasts: [],
  }));

  // Persist small workspace config only — never raw rows or uploaded BPMN content.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, workspaces: state.workspaces }));
    } catch {
      /* storage full or disabled: workspace stays in memory */
    }
  }, [state.workspaces]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** Workspace of the current scope. Returns a referentially stable empty workspace until the first edit. */
export function useWorkspace(): ProcessWorkspace | null {
  const { state } = useStore();
  const { dataset, view } = state;
  const { processKey, dateFrom, dateTo } = view;
  const key = currentWorkspaceKey(dataset, view);
  const stored = key ? state.workspaces[key] : undefined;
  const empty = useMemo(() => {
    if (!dataset || !key) return null;
    const meta = metaFor(dataset, { ...initialView, processKey, dateFrom, dateTo });
    return meta ? emptyWorkspace(dataset, meta) : null;
  }, [dataset, key, processKey, dateFrom, dateTo]);
  return stored ?? empty;
}

export function useWorkspaceKey(): string | null {
  const { state } = useStore();
  return currentWorkspaceKey(state.dataset, state.view);
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
