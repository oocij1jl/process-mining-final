import type {
  AnalysisScope,
  ColumnMapping,
  DatasetMetadata,
  Lifecycle,
  QueueResult,
  RawRow,
  Target,
} from '../contracts';
import type {
  AutomationAssessment,
  AutomationScore,
  BenefitResult,
  BpmnMappingOverride,
  QueueComparison,
  QueueExclusionReason,
} from '../v03-contracts';
import type { FestivalManifest, FestivalSettings } from '../festival/adapter';

export type PageId =
  | 'overview'
  | 'analysis'
  | 'design'
  | 'model'
  | 'implementation'
  | 'monitor'
  | 'refine'
  | 'festival'
  | 'export';

/** Where the event log came from (data provenance). */
export type SourceKind = 'ui_fixture' | 'bundled_sample' | 'festival_sample' | 'user_upload';
/** Original file format of the event log (separate from provenance and provider). */
export type SourceFormat = 'csv' | 'xes';
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
  /** v0.3: csv when omitted (datasets loaded before XES support). */
  format?: SourceFormat;
  /** XES only: original bytes, kept in memory and never persisted. */
  xesBytes?: Uint8Array;
}

export type AnalysisMode = 'frequency' | 'performance' | 'variants' | 'rework' | 'handover' | 'patterns' | 'replay';

/** Cross-page request to open Analysis on a specific graph element (UI state only). */
export interface AnalysisFocus {
  mode: AnalysisMode;
  edge?: { from: string; to: string };
  activity?: string;
  findingId?: string;
}

export interface ViewState {
  processKey: string | null;
  /** Inclusive lower bound, local datetime-local string; whole cases by first event. */
  dateFrom: string;
  dateTo: string;
  selectedCaseKey: string | null;
  throughputBucketMin: number;
  /** v0.3 UI-only: current Analysis mode and a pending focus request. */
  analysisMode?: AnalysisMode;
  analysisFocus?: AnalysisFocus | null;
}

export type DesignStatus = 'draft' | 'ready' | 'approved' | 'rejected';

/** v0.3 redesign levers (V03_FINAL §3 Design). */
export type RedesignLever = 'eliminate' | 'simplify' | 'automate' | 'parallelize' | 'reallocate' | 'standardize' | 'reorder';

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
  /* v0.3 additive fields. Absent on records saved before v0.3. */
  lever?: RedesignLever | null;
  problem?: string;
  rationale?: string;
  assumptions?: string;
  affectedResources?: string[];
  /** quantitative: evaluated by a supported model (queue simulation); qualitative: user assessment only. */
  evaluation?: 'quantitative' | 'qualitative';
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
  | { kind: 'proposal_only'; designId: string }
  /** v0.3 generic queue scenario (server delta; staffing delta only with an explicit assumption). */
  | {
      kind: 'generic_scenario';
      scenarioId: string;
      scenarioRevision: number;
      baselineServers: number;
      candidateServers: number;
      serverDelta: number;
      staffingDelta: number | null;
    }
  /** v0.3 automation candidate from Implementation. */
  | { kind: 'automation'; candidateId: string; activity: string };

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

/** v0.3 generic queue parameters (Refine). */
export interface GenericQueueParams {
  arrivalActivity: string;
  /** '' = complete or point (contract default). */
  arrivalLifecycle: Lifecycle | '';
  serviceMode: 'observed' | 'assumed';
  serviceActivity: string;
  assumedServiceSec: number | null;
  baselineServers: number | null;
  candidateServers: number | null;
  serviceMultiplier: number;
  assumeOneWorkerPerServer: boolean;
}

export interface GenericScenarioRecord {
  id: string;
  kind: 'generic_queue';
  revision: number;
  designId: string | null;
  scope: AnalysisScope;
  provider: ProviderKind;
  paramsRevision: number;
  params: GenericQueueParams;
  inputCount: number;
  eligibleCases: number;
  exclusions: { caseKey: string; reason: QueueExclusionReason }[];
  comparison: QueueComparison;
  createdAt: number;
}

/** v0.3 automation candidate: user assessment + engine score/benefit snapshots for one activity. */
export interface AutomationCandidate {
  id: string;
  activity: string;
  assessment: AutomationAssessment;
  /** User-rated impact 1–5 for the impact–difficulty matrix. */
  impact: number | null;
  benefit: BenefitDraft;
  scoreSnapshot: AutomationScore | null;
  benefitSnapshot: BenefitResult | null;
  designId: string | null;
  planId: string | null;
  scope: AnalysisScope;
  provider: ProviderKind;
  createdAt: number;
  updatedAt: number;
}

/** Benefit calculator inputs as typed by the user (null = not entered). */
export interface BenefitDraft {
  periodLabel: string;
  currency: string;
  volume: number | null;
  eligibleShare: number | null;
  serviceSource: 'matched' | 'assumed';
  assumedCurrentSec: number | null;
  expectedServiceSec: number | null;
  hourlyCost: number | null;
  realizationFraction: number | null;
  independentBenefit: number | null;
  initialCost: number | null;
  recurrentCost: number | null;
}

/** v0.3 To-be BPMN revision reference. XML stays in memory (bpmnDocs) and is never persisted. */
export interface BpmnRevisionRef {
  modelId: string;
  revision: number;
  /** bpmnDocs key holding this revision's XML for the current session. */
  docName: string;
  sourceRef: string | null;
  designId: string | null;
  scope: AnalysisScope;
  createdAt: number;
  note: string;
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
  /* v0.3 additive state. Absent on workspaces saved before v0.3. */
  automation?: AutomationCandidate[];
  genericQueueParams?: GenericQueueParams;
  genericParamsRevision?: number;
  genericScenarios?: GenericScenarioRecord[];
  bpmnRevisions?: BpmnRevisionRef[];
  bpmnOverrides?: BpmnMappingOverride[];
  /** Exact activity labels defining a recorded completion (generic throughput). */
  completionActivities?: string[];
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
