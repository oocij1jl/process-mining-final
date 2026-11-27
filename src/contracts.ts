export type ProcessKey = string;
export type CaseKey = string;
export type Lifecycle = 'start' | 'complete' | 'point';
export type RawRow = Readonly<Record<string, string>>;

export const DEFAULT_MISSING_RESOURCES = ['', 'NONE', 'NULL', '0;n/a'] as const;

export interface EventRow {
  readonly eventId?: string;
  readonly processType: ProcessKey;
  readonly caseId: string;
  /** JSON serialization of [processType, caseId] within the active dataset. */
  readonly caseKey: CaseKey;
  readonly activity: string;
  readonly timestampMs: number;
  readonly rawTimestamp: string;
  readonly sourceOrder: number;
  readonly lifecycle: Lifecycle;
  readonly instanceId?: string;
  readonly resource: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

/** Keys are canonical field names and values are original CSV headers. */
export interface ColumnMapping {
  readonly case_id: string;
  readonly activity: string;
  readonly timestamp: string;
  readonly [field: string]: string | undefined;
}

export interface Issue {
  /** Zero-based parsed data row. Use -1 for an issue affecting the whole import. */
  row: number;
  field: string;
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportOptions {
  mapping: ColumnMapping;
  missingResources: readonly string[];
  /** Explicit UTC offset for timezone-less ISO timestamps, such as +09:00. */
  fixedOffset?: string;
  acceptExclusions: boolean;
  requireProcessType?: boolean;
}

export interface ValidationResult {
  events: readonly EventRow[];
  issues: Issue[];
  rawCount: number;
  excludedCount: number;
  /** True only with usable rows and any required exclusion consent. */
  canAnalyze: boolean;
}

export interface Trace {
  readonly caseKey: CaseKey;
  readonly processType: ProcessKey;
  readonly events: readonly EventRow[];
  /** Complete and point events in timestamp and source order. */
  readonly sequence: readonly EventRow[];
  /** First-to-last elapsed minutes across all accepted events in the case. */
  readonly elapsedMin: number;
}

export interface AnalysisScope {
  datasetId: string;
  processKey: ProcessKey;
  analysisFilterFingerprint: string;
}

export interface DatasetMetadata {
  name: string;
  sourceType: 'synthetic' | 'user_upload';
  timezone?: string;
  sourceReferences?: readonly string[];
  assumptions?: readonly string[];
  baselineGateCount?: number;
  serviceActivity?: string;
}

export interface ResourceShift {
  resource: string;
  startMs: number;
  endMs: number;
}

export interface FestivalKPIConfig {
  stageHandoverPointFallback?: boolean;
  technicalCheckRepeatActivity?: string;
  equipmentDeadline?: 'required_ready_at' | 'linked_stage_setup_start';
  linkedStageTraces?: readonly Trace[];
  linkedEquipmentTraces?: readonly Trace[];
}

export interface KPIContext {
  processKey: ProcessKey;
  metadata?: DatasetMetadata;
  /** Presence explicitly enables Festival-specific KPI rules for this dataset. */
  festival?: FestivalKPIConfig;
  shifts?: readonly ResourceShift[];
  throughput?: { bucketMinutes: number; anchorMs: number };
}

export interface ThroughputBucket {
  startMs: number;
  endMs: number;
  count: number;
  caseKeys: CaseKey[];
}

export interface Metric {
  id: string;
  /** Unsupported values are null and carry a reason. */
  value: number | null;
  unit: string;
  /** Usable observations. For rates, this is the denominator. */
  n: number;
  /** Potential observations before excluding missing or invalid evidence. */
  eligible: number;
  definition: string;
  reason?: string;
  caseKeys: CaseKey[];
  buckets?: ThroughputBucket[];
}

export interface Edge {
  from: string;
  to: string;
  count: number;
  caseKeys: CaseKey[];
}

export interface DFG {
  nodes: { activity: string; count: number; caseKeys: CaseKey[] }[];
  edges: Edge[];
  starts: Record<string, number>;
  ends: Record<string, number>;
}

export interface Variant {
  id: string;
  activities: string[];
  count: number;
  /** Fraction from zero to one over cases with a nonempty discovery sequence. */
  share: number;
  avgElapsedMin: number;
  caseKeys: CaseKey[];
}

export interface CaseDuration {
  caseKey: CaseKey;
  elapsedMin: number;
}

export interface GapSummary {
  metricType: 'inter_event' | 'matched_gap' | 'service';
  from: string;
  /** Present for transitions. Service summaries identify the activity in from. */
  to?: string;
  meanMin: number;
  n: number;
  caseKeys: CaseKey[];
}

export interface PerformanceAnalysis {
  gaps: GapSummary[];
  overlaps: number;
  matchedPairs: number;
  ambiguousPairs: number;
}

export interface ResourceSummary {
  resource: string;
  rawEvents: number;
  instances: number;
  distinctCases: number;
  activityCounts: Record<string, number>;
  activeMin: number | null;
  /** Cases with at least one raw event attributed to this resource. */
  caseKeys: CaseKey[];
  roles: string[];
}

export interface HandoffSummary {
  from: string;
  to: string;
  count: number;
  caseKeys: CaseKey[];
}

export interface ResourceAnalysis {
  resources: ResourceSummary[];
  handoffs: HandoffSummary[];
  knownRawEvents: number;
  totalRawEvents: number;
  knownInstances: number;
  totalInstances: number;
}

export interface FindingAnalysis {
  scope: AnalysisScope;
  traces: readonly Trace[];
  dfg: DFG;
  performance: PerformanceAnalysis;
  resources: ResourceAnalysis;
  metrics: readonly Metric[];
  rework?: {
    explicitActivities: readonly string[];
    repeatedActivities: readonly string[];
  };
}

export interface Finding {
  id: string;
  scope: AnalysisScope;
  metricId: string;
  value: number;
  unit: string;
  n: number;
  eligible?: number;
  caseKeys: CaseKey[];
  edge?: Pick<Edge, 'from' | 'to'>;
  support?: 'low';
  text: string;
  proposal: string;
}

export interface Target {
  metricId: string;
  value: number;
  unit: string;
  direction: 'max' | 'min';
}

export interface TargetEvaluation {
  metricId: string;
  status: 'met' | 'breached' | 'unknown';
}

export interface GateInput {
  caseKey: CaseKey;
  arrivalMs: number;
  serviceSec: number;
  sourceOrder: number;
}

export type GateInputOptions = { serviceActivity: string } & (
  | { mode: 'observed' }
  | { mode: 'assumed'; serviceSec: number }
);

export interface GateInputSelection {
  inputs: GateInput[];
  eligibleCases: number;
  exclusions: {
    caseKey: CaseKey;
    reason: 'missing_arrival' | 'missing_or_invalid_service';
  }[];
}

export interface QueueResult {
  count: number;
  meanWaitMin: number;
  p95WaitMin: number;
  maxWaitMin: number;
  finishElapsedMin: number;
  throughputPerHour: number | null;
  gateCount: number;
}
