import type {
  AnalysisScope,
  ColumnMapping,
  DatasetMetadata,
  QueueResult,
  RawRow,
  Target,
} from '../contracts';
import type { FestivalManifest, FestivalSettings } from '../festival/adapter';

export type PageId =
  | 'overview'
  | 'analysis'
  | 'design'
  | 'model'
  | 'implementation'
  | 'monitor'
  | 'refine'
  | 'export';

/** Where the event log came from (data provenance). */
export type SourceKind = 'ui_fixture' | 'festival_sample' | 'user_upload';
/** Who produced the analysis results (hand-authored fixture vs src/engine). */
export type ProviderKind = 'engine' | 'ui_fixture';

/** A CSV row that PapaParse could not split into exactly one value per header. */
export interface MalformedRow {
  /** Zero-based data row index in the original file (same numbering as the raw preview). */
  sourceRow: number;
  code: 'TooManyFields' | 'TooFewFields' | 'ParseError';
  message: string;
}

/** The immutable loaded dataset. Raw rows stay in memory only; never persisted. */
export interface DatasetState {
  /** Fingerprint of content + mapping + exclusion policy. */
  id: string;
  contentFingerprint: string;
  sourceName: string;
  sourceKind: SourceKind;
  headers: string[];
  /** Rows passed to validateAndNormalize: string-only, complete, structurally valid. */
  rows: RawRow[];
  /** engine row index → original file data-row index (differs only when malformed rows were excluded). */
  rowMap: number[];
  /** Structurally malformed rows excluded with explicit user consent (listed, never silently dropped). */
  malformedRows: MalformedRow[];
  /** Total data rows in the original file. */
  fileRowCount: number;
  rawText: string;
  mapping: ColumnMapping;
  missingResources: string[];
  fixedOffset?: string;
  acceptExclusions: boolean;
  requireProcessType: boolean;
  metadata?: DatasetMetadata;
  /** Festival case-study adapters explicitly enabled for this dataset. */
  festival: boolean;
  festivalSettings?: FestivalSettings;
  /** Validated manifest, present only for the bundled Festival sample. */
  manifest?: FestivalManifest;
  loadedAt: number;
}

export interface ViewState {
  processKey: string | null;
  /** Inclusive lower bound, local datetime-local string; whole cases by first event. */
  dateFrom: string;
  dateTo: string;
  selectedCaseKey: string | null;
  throughputBucketMin: number;
}

export type DesignStatus = 'draft' | 'ready' | 'approved' | 'rejected';

export interface DesignRecord {
  id: string;
  title: string;
  findingIds: string[];
  /** Snapshot of linked finding text at creation time. */
  findingText: string[];
  changeNote: string;
  affectedActivities: string[];
  targetMetricId: string | null;
  asIsBpmnRef: string | null;
  toBeBpmnRef: string | null;
  /** simulation: quantified via Refine gate model; proposal_only: no numeric effect claimed. */
  kind: 'simulation' | 'proposal_only';
  status: DesignStatus;
  scope: AnalysisScope;
  createdAt: number;
  updatedAt: number;
}

export interface ScenarioParams {
  serviceActivity: string;
  serviceMode: 'observed' | 'assumed';
  assumedServiceSec: number | null;
  baselineGates: number | null;
  candidateGates: number | null;
}

export interface ScenarioRecord {
  id: string;
  revision: number;
  designId: string | null;
  scope: AnalysisScope;
  paramsRevision: number;
  params: ScenarioParams;
  inputCount: number;
  eligibleCases: number;
  excludedCases: number;
  baseline: QueueResult;
  candidate: QueueResult;
  createdAt: number;
  provider: ProviderKind;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export interface PlanTask {
  id: string;
  task: string;
  owner: string;
  staffing: string;
  dueDate: string;
  status: TaskStatus;
  evidence: string;
}

export type PlanSource =
  | {
      kind: 'scenario';
      scenarioId: string;
      scenarioRevision: number;
      baselineGates: number;
      candidateGates: number;
      gateDelta: number;
      staffDelta: number;
    }
  | { kind: 'proposal_only'; designId: string };

export interface PlanRecord {
  id: string;
  revision: number;
  title: string;
  source: PlanSource;
  designId: string | null;
  scope: AnalysisScope;
  /** Analysis provider of the scenario/design this plan came from. Never re-labelled. */
  provider: ProviderKind;
  tasks: PlanTask[];
  state: 'current' | 'archived';
  createdAt: number;
  updatedAt: number;
}

/** Describes which scope a workspace belongs to (for the read-only history view). */
export interface WorkspaceMeta {
  scope: AnalysisScope;
  provider: ProviderKind;
  sourceName: string;
  sourceKind: SourceKind;
  filter: { dateFrom: string; dateTo: string };
  /** Records migrated from the pre-1.1 storage format (keyed without filter/provider). */
  legacy?: boolean;
  createdAt: number;
}

/** Keyed by datasetId + provider + processKey + analysisFilter fingerprint (SPEC "State ownership"). */
export interface ProcessWorkspace {
  meta: WorkspaceMeta;
  targets: Target[];
  designs: DesignRecord[];
  activeDesignId: string | null;
  scenarioParams: ScenarioParams;
  paramsRevision: number;
  scenarios: ScenarioRecord[];
  selectedScenarioId: string | null;
  plans: PlanRecord[];
  activePlanId: string | null;
}

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface AppState {
  dataset: DatasetState | null;
  view: ViewState;
  workspaces: Record<string, ProcessWorkspace>;
  /** In-memory BPMN XML documents (not persisted), keyed by reference name. */
  bpmnDocs: Record<string, string>;
  toasts: Toast[];
}
