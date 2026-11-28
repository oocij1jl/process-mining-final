import type {
  CaseKey,
  Edge,
  GateInput,
  ImportOptions,
  Issue,
  Lifecycle,
  Metric,
  QueueResult,
  Trace,
  ValidationResult,
  Variant,
} from './contracts';

/** The XES parser supplies the canonical mapping. Import policy matches CSV. */
export type XesImportOptions = Omit<ImportOptions, 'mapping'>;

export interface XesEventLocation {
  traceIndex: number;
  eventIndex: number;
}

export interface XesIssue extends Issue {
  location: XesEventLocation | { traceIndex: number; eventIndex: null } | null;
}

export type XesImportResult =
  | { status: 'rejected'; issues: XesIssue[] }
  | {
      status: 'parsed';
      validation: Omit<ValidationResult, 'issues'> & { issues: XesIssue[] };
      eventLocations: XesEventLocation[];
      traces: {
        traceIndex: number;
        caseId: string | null;
        attrs: Readonly<Record<string, string>>;
      }[];
    };

/** UTC epoch milliseconds, inclusive start and exclusive end. */
export interface EventWindow {
  startMs: number;
  endMs: number;
}

export interface TimeBucketOptions {
  bucketMinutes: number;
  anchorMs: number;
}

/** Exact activity labels. The first matching complete or point row marks completion. */
export interface CompletionDefinition {
  completionActivities: readonly string[];
}

export interface EventEvidenceRef {
  caseKey: CaseKey;
  timestampMs: number;
  sourceOrder: number;
}

export interface LifecycleIntervalEvidence {
  activity: string;
  start: EventEvidenceRef;
  complete: EventEvidenceRef;
}

export interface TransitionPerformanceCoverage {
  from: string;
  to: string;
  transitionCount: number;
  matchedGapCount: number;
  overlapCount: number;
}

export type HandoffActivityPair = Edge;

export interface ActivityEvidence {
  activity: string;
  occurrenceCount: number;
  occurrenceCaseKeys: CaseKey[];
  repeatedCaseKeys: CaseKey[];
  extraOccurrenceCount: number;
  service: {
    n: number;
    eligible: number;
    meanMin: number | null;
    totalMin: number | null;
    caseKeys: CaseKey[];
  };
}

export interface ActivityEvidenceAnalysis {
  selectedCases: number;
  discoveredCases: number;
  discoveredCaseKeys: CaseKey[];
  repeatedCaseKeys: CaseKey[];
  repeatRatePct: number | null;
  extraOccurrenceCount: number;
  activities: ActivityEvidence[];
}

export interface AutomationAssessment {
  ruleBased: number | null;
  digitalReadiness: number | null;
  lowNeedForHumanJudgment: number | null;
  safetyRisk: 'low' | 'medium' | 'high' | null;
  implementationDifficulty: number | null;
}

export interface AutomationScore {
  activity: string;
  occurrenceDenominator: number;
  serviceTotalDenominatorMin: number | null;
  opportunityBasis: 'frequency_and_service' | 'frequency_only';
  opportunityScore: number;
  suitabilityScore: number | null;
  score: number | null;
  requiresHumanReview: boolean;
}

export interface BenefitCosts {
  initial: number | null;
  recurrent: number | null;
}

interface BenefitPeriod {
  periodLabel: string;
  currency: string | null;
  costs: BenefitCosts;
}

export type CurrentServiceTime =
  | { source: 'matched'; evidence: ActivityEvidence }
  | { source: 'assumed'; seconds: number };

export type BenefitInput = BenefitPeriod & (
  | {
      kind: 'service_change';
      volume: number | null;
      eligibleShare: number | null;
      currentService: CurrentServiceTime | null;
      expectedServiceSec: number | null;
      hourlyCost: number | null;
      realizationFraction: number | null;
      independentBenefit?: number;
    }
  | { kind: 'financial_only'; independentBenefit: number | null }
);

export interface BenefitResult {
  currentServiceSec: number | null;
  hoursReleased: number | null;
  capacityValue: number | null;
  monetizedBenefit: number | null;
  totalCost: number | null;
  netBenefit: number | null;
  roiPct: number | null;
  roiUnavailable: 'missing_currency' | 'missing_benefit' | 'missing_cost' | 'zero_cost' | null;
}

export interface QueueInputOptions {
  arrival: { activity: string; lifecycle?: Lifecycle };
  service: { mode: 'observed'; activity: string } | { mode: 'assumed'; serviceSec: number };
}

export type QueueExclusionReason =
  | 'missing_arrival'
  | 'ambiguous_arrival'
  | 'missing_service'
  | 'ambiguous_service'
  | 'invalid_service'
  | 'service_before_arrival';

export interface QueueInputSelection {
  inputs: GateInput[];
  eligibleCases: number;
  exclusions: { caseKey: CaseKey; reason: QueueExclusionReason }[];
}

export interface QueueComparisonOptions {
  baselineServers: number;
  candidateServers: number;
  candidateServiceMultiplier?: number;
  assumeOneQualifiedWorkerPerServer: boolean;
}

export type ServerQueueResult = Omit<QueueResult, 'gateCount'> & { serverCount: number };

export interface QueueComparison {
  baseline: ServerQueueResult;
  candidate: ServerQueueResult;
  candidateServiceMultiplier: number;
  serverDelta: number;
  staffingDelta: number | null;
}

export interface CaseThroughputOptions {
  buckets: TimeBucketOptions;
  completion?: CompletionDefinition;
}

export interface CaseThroughputMetric extends Metric {
  id: 'case_throughput';
  unit: 'cases/bucket';
  buckets: NonNullable<Metric['buckets']>;
  observationWindow: EventWindow | null;
  unavailable: 'missing_completion' | 'empty_scope' | 'bucket_limit' | null;
}

export interface HistoricalTrendBucket extends EventWindow {
  caseCount: number;
  elapsedN: number;
  meanElapsedMin: number | null;
  elapsedCaseKeys: CaseKey[];
  repeatN: number;
  repeatRatePct: number | null;
  repeatedCaseKeys: CaseKey[];
}

export interface HistoricalTrends {
  observationWindow: EventWindow | null;
  buckets: HistoricalTrendBucket[];
  unavailable: 'empty_scope' | 'bucket_limit' | null;
}

export interface DriftPeriodEvidence {
  count: number;
  outgoingCount: number;
  sharePct: number | null;
  meanGapMin: number | null;
  gapN: number;
  caseKeys: CaseKey[];
}

export interface TransitionDriftRow {
  from: string;
  to: string;
  baseline: DriftPeriodEvidence;
  recent: DriftPeriodEvidence;
  deltaSharePp: number | null;
  deltaMeanGapMin: number | null;
  shareSupport: 'low' | 'sufficient' | 'unavailable';
  gapSupport: 'low' | 'sufficient' | 'unavailable';
}

export interface TransitionDrift {
  baseline: EventWindow;
  recent: EventWindow;
  transitions: TransitionDriftRow[];
}

export interface PatternDivergence {
  from: string;
  outgoingCount: number;
  alternatives: Edge[];
  caseKeys: CaseKey[];
}

export interface ShortLoopEvidence {
  outer: string;
  via: string;
  count: number;
  caseKeys: CaseKey[];
}

export interface OverlapCaseEvidence {
  caseKey: CaseKey;
  count: number;
  example: [LifecycleIntervalEvidence, LifecycleIntervalEvidence];
}

export interface OverlapPattern {
  activities: [string, string];
  count: number;
  cases: OverlapCaseEvidence[];
}

export interface PatternAnalysis {
  sequences: Edge[];
  divergences: PatternDivergence[];
  selfLoops: Edge[];
  shortLoops: ShortLoopEvidence[];
  overlaps: OverlapPattern[];
  matchedPairs: number;
  ambiguousPairs: number;
}

export interface ReplayEvent extends EventEvidenceRef {
  activity: string;
  lifecycle: Lifecycle;
}

export interface ReplayCaseIndex {
  caseKey: CaseKey;
  variantId: Variant['id'] | null;
  events: readonly ReplayEvent[];
  intervals: readonly LifecycleIntervalEvidence[];
  completion: ReplayEvent | null;
}

export interface ReplayIndex {
  observationWindow: EventWindow | null;
  cases: readonly ReplayCaseIndex[];
}

export interface ReplayQuery {
  window: EventWindow;
  cursorMs: number;
  variantIds?: readonly Variant['id'][];
}

export interface ReplayCaseState {
  caseKey: CaseKey;
  state: 'active' | 'latest_observation' | 'last_observation' | 'completed';
  latest: ReplayEvent;
  active: LifecycleIntervalEvidence[];
}

export interface ReplayFrame {
  cursorMs: number;
  /** Includes filtered cases with events after the cursor. */
  selectedCases: number;
  cases: ReplayCaseState[];
  counts: Record<ReplayCaseState['state'] | 'not_yet_observed', number>;
}

export interface BpmnReference {
  nodes: readonly {
    id: string;
    name: string;
    kind: 'task' | 'start' | 'end' | 'xor' | 'unsupported';
  }[];
  flows: readonly { fromId: string; toId: string }[];
}

export interface BpmnMappingOverride {
  activity: string;
  taskId: string | null;
}

export interface BpmnComparison {
  mapping: {
    activity: string;
    taskId: string | null;
    exactTaskIds: string[];
    status: 'exact' | 'mapped_by_user' | 'unmapped' | 'ambiguous' | 'excluded_by_user';
    occurrenceCount: number;
    caseKeys: CaseKey[];
  }[];
  referenceOnlyTaskIds: string[];
  mappedActivityCount: number;
  discoveredActivityCount: number;
  mappedOccurrenceCount: number;
  discoveredOccurrenceCount: number;
  adjacency: {
    status: 'supported' | 'unsupported';
    reason: 'unsupported_elements' | 'unsupported_structure' | null;
    checkedTransitionCount: number | null;
    skippedTransitionCount: number | null;
    deviations: Edge[];
  };
}

/** Planned runtime exports from src/engine/index.ts. Providers may implement a subset. */
export interface V03EngineApi {
  importXes(bytes: Uint8Array, options: XesImportOptions): XesImportResult;
  getActivityEvidence(traces: readonly Trace[]): ActivityEvidenceAnalysis;
  scoreAutomation(
    analysis: ActivityEvidenceAnalysis,
    activity: string,
    assessment: AutomationAssessment,
  ): AutomationScore;
  estimateBenefit(input: BenefitInput): BenefitResult;
  extractQueueInputs(traces: readonly Trace[], options: QueueInputOptions): QueueInputSelection;
  compareQueues(inputs: readonly GateInput[], options: QueueComparisonOptions): QueueComparison;
  getCaseThroughput(traces: readonly Trace[], options: CaseThroughputOptions): CaseThroughputMetric;
  getHistoricalTrends(traces: readonly Trace[], buckets: TimeBucketOptions): HistoricalTrends;
  getTransitionDrift(traces: readonly Trace[], baseline: EventWindow, recent: EventWindow): TransitionDrift;
  getPatternEvidence(traces: readonly Trace[]): PatternAnalysis;
  buildReplayIndex(traces: readonly Trace[], completion?: CompletionDefinition): ReplayIndex;
  getReplayFrame(index: ReplayIndex, query: ReplayQuery): ReplayFrame;
  getBpmnComparison(
    traces: readonly Trace[],
    reference: BpmnReference,
    overrides: readonly BpmnMappingOverride[],
  ): BpmnComparison;
}
