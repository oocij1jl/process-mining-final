/**
 * ============================================================================
 *  UI FIXTURE — HAND-AUTHORED, NOT ENGINE OUTPUT
 * ============================================================================
 * Lets the UI be exercised before the Codex engine exists. The values below were
 * calculated by hand for this one tiny CSV, which is also shown and downloaded
 * with a visible "UI fixture" label. The rows extend tests/fixtures/phase-0-event-log.csv
 * (cases 001/002, unchanged values) with three audience entries that reproduce
 * TEST_PLAN T09 (arrivals 0/1/2 s, service 4 s).
 *
 * The provider never computes analysis for other inputs. Any call outside the
 * exact fixture scope throws FixtureUnavailableError, which the UI shows as a
 * labelled state. Replace with `realEngine` once the engine is implemented. The
 * only executable rule here, the target comparison stub, is fixture-only too.
 * Metric IDs and units follow the engine implementation report
 * (reports/evidence/phase-1-engine.md on feat/engine): durations `min`, rates
 * `%` on 0–100, counts `cases`, audience throughput `cases/bucket`. The VALUES
 * are still hand-authored for this CSV only.
 * ============================================================================
 */
import type {
  CaseDuration,
  DFG,
  EventRow,
  Finding,
  GateInput,
  Metric,
  PerformanceAnalysis,
  QueueResult,
  ResourceAnalysis,
  TargetEvaluation,
  Trace,
  ValidationResult,
  Variant,
} from '../../contracts';
import { FixtureUnavailableError, type EngineApi } from '../engineAdapter';

/** Data-source name only. Whether results are hand-authored is shown by the provider label. */
export const UI_FIXTURE_DATASET_NAME = 'UI fixture CSV (20 rows, test data)';
export const UI_FIXTURE_MAPPING = {
  event_id: 'event_id', process_type: 'process_type', case_id: 'case_id', activity: 'activity', timestamp: 'timestamp',
  lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource',
} as const;

export const UI_FIXTURE_CSV = `event_id,process_type,case_id,activity,timestamp,lifecycle,activity_instance_id,resource
E01,,001,A,2026-11-27T00:00:00Z,,,R1
E02,,001,A,2026-11-27T00:01:00Z,start,A1,R1
E03,,001,A,2026-11-27T00:05:00Z,complete,A1,R1
E04,,001,B,2026-11-27T00:08:00Z,start,B1,R2
E05,,001,B,2026-11-27T00:12:00Z,complete,B1,R2
E06,,001,C,2026-11-27T00:15:00Z,,,
E07,,002,A,2026-11-27T00:01:00Z,,,R2
E08,,002,C,2026-11-27T00:21:00Z,,,R1
A01,audience,ENT001,Join Entry Queue,2026-11-27T09:00:00Z,,,
A02,audience,ENT001,Ticket Verification,2026-11-27T09:00:00Z,start,TV1,Gate1
A03,audience,ENT001,Ticket Verification,2026-11-27T09:00:04Z,complete,TV1,Gate1
A04,audience,ENT001,Entry Complete,2026-11-27T09:00:05Z,,,Gate1
A05,audience,ENT002,Join Entry Queue,2026-11-27T09:00:01Z,,,
A06,audience,ENT002,Ticket Verification,2026-11-27T09:00:04Z,start,TV2,Gate1
A07,audience,ENT002,Ticket Verification,2026-11-27T09:00:08Z,complete,TV2,Gate1
A08,audience,ENT002,Entry Complete,2026-11-27T09:00:09Z,,,Gate1
A09,audience,ENT003,Join Entry Queue,2026-11-27T09:00:02Z,,,
A10,audience,ENT003,Ticket Verification,2026-11-27T09:00:08Z,start,TV3,Gate1
A11,audience,ENT003,Ticket Verification,2026-11-27T09:00:12Z,complete,TV3,Gate1
A12,audience,ENT003,Entry Complete,2026-11-27T09:00:13Z,,,Gate1
`;

const D0 = 1795737600000; // 2026-11-27T00:00:00Z
const A0 = 1795770000000; // 2026-11-27T09:00:00Z
const MIN = 60_000;
const SEC = 1_000;

const key = (process: string, caseId: string) => JSON.stringify([process, caseId]);
const K1 = key('default', '001');
const K2 = key('default', '002');
const E1 = key('audience', 'ENT001');
const E2 = key('audience', 'ENT002');
const E3 = key('audience', 'ENT003');

type Lc = EventRow['lifecycle'];
function ev(
  sourceOrder: number,
  eventId: string,
  processType: string,
  caseId: string,
  activity: string,
  timestampMs: number,
  rawTimestamp: string,
  lifecycle: Lc,
  instanceId: string | undefined,
  resource: string | null,
): EventRow {
  return {
    eventId,
    processType,
    caseId,
    caseKey: key(processType, caseId),
    activity,
    timestampMs,
    rawTimestamp,
    sourceOrder,
    lifecycle,
    instanceId,
    resource,
    attrs: {},
  };
}

const T = (h: string) => `2026-11-27T${h}Z`;
const EVENTS: readonly EventRow[] = [
  ev(0, 'E01', 'default', '001', 'A', D0, T('00:00:00'), 'point', undefined, 'R1'),
  ev(1, 'E02', 'default', '001', 'A', D0 + 1 * MIN, T('00:01:00'), 'start', 'A1', 'R1'),
  ev(2, 'E03', 'default', '001', 'A', D0 + 5 * MIN, T('00:05:00'), 'complete', 'A1', 'R1'),
  ev(3, 'E04', 'default', '001', 'B', D0 + 8 * MIN, T('00:08:00'), 'start', 'B1', 'R2'),
  ev(4, 'E05', 'default', '001', 'B', D0 + 12 * MIN, T('00:12:00'), 'complete', 'B1', 'R2'),
  ev(5, 'E06', 'default', '001', 'C', D0 + 15 * MIN, T('00:15:00'), 'point', undefined, null),
  ev(6, 'E07', 'default', '002', 'A', D0 + 1 * MIN, T('00:01:00'), 'point', undefined, 'R2'),
  ev(7, 'E08', 'default', '002', 'C', D0 + 21 * MIN, T('00:21:00'), 'point', undefined, 'R1'),
  ev(8, 'A01', 'audience', 'ENT001', 'Join Entry Queue', A0, T('09:00:00'), 'point', undefined, null),
  ev(9, 'A02', 'audience', 'ENT001', 'Ticket Verification', A0, T('09:00:00'), 'start', 'TV1', 'Gate1'),
  ev(10, 'A03', 'audience', 'ENT001', 'Ticket Verification', A0 + 4 * SEC, T('09:00:04'), 'complete', 'TV1', 'Gate1'),
  ev(11, 'A04', 'audience', 'ENT001', 'Entry Complete', A0 + 5 * SEC, T('09:00:05'), 'point', undefined, 'Gate1'),
  ev(12, 'A05', 'audience', 'ENT002', 'Join Entry Queue', A0 + 1 * SEC, T('09:00:01'), 'point', undefined, null),
  ev(13, 'A06', 'audience', 'ENT002', 'Ticket Verification', A0 + 4 * SEC, T('09:00:04'), 'start', 'TV2', 'Gate1'),
  ev(14, 'A07', 'audience', 'ENT002', 'Ticket Verification', A0 + 8 * SEC, T('09:00:08'), 'complete', 'TV2', 'Gate1'),
  ev(15, 'A08', 'audience', 'ENT002', 'Entry Complete', A0 + 9 * SEC, T('09:00:09'), 'point', undefined, 'Gate1'),
  ev(16, 'A09', 'audience', 'ENT003', 'Join Entry Queue', A0 + 2 * SEC, T('09:00:02'), 'point', undefined, null),
  ev(17, 'A10', 'audience', 'ENT003', 'Ticket Verification', A0 + 8 * SEC, T('09:00:08'), 'start', 'TV3', 'Gate1'),
  ev(18, 'A11', 'audience', 'ENT003', 'Ticket Verification', A0 + 12 * SEC, T('09:00:12'), 'complete', 'TV3', 'Gate1'),
  ev(19, 'A12', 'audience', 'ENT003', 'Entry Complete', A0 + 13 * SEC, T('09:00:13'), 'point', undefined, 'Gate1'),
];

const pick = (...orders: number[]) => orders.map((o) => EVENTS[o]!);
function trace(caseKey: string, processType: string, all: number[], seq: number[], elapsedMin: number): Trace {
  return { caseKey, processType, events: pick(...all), sequence: pick(...seq), elapsedMin };
}

const TRACES: readonly Trace[] = [
  trace(E1, 'audience', [8, 9, 10, 11], [8, 10, 11], 5 / 60),
  trace(E2, 'audience', [12, 13, 14, 15], [12, 14, 15], 8 / 60),
  trace(E3, 'audience', [16, 17, 18, 19], [16, 18, 19], 11 / 60),
  trace(K1, 'default', [0, 1, 2, 3, 4, 5], [0, 2, 4, 5], 15),
  trace(K2, 'default', [6, 7], [6, 7], 20),
];

interface ProcessFixture {
  caseKeys: string[];
  dfg: DFG;
  variants: Variant[];
  durations: CaseDuration[];
  performance: PerformanceAnalysis;
  resources: ResourceAnalysis;
  metrics: Metric[];
  findings: Finding[];
}

const scopeFor = (processKey: string) => ({
  datasetId: '__set_by_caller__',
  processKey,
  analysisFilterFingerprint: '__set_by_caller__',
});

const DEFAULT_FIXTURE: ProcessFixture = {
  caseKeys: [K1, K2],
  dfg: {
    nodes: [
      { activity: 'A', count: 3, caseKeys: [K1, K2] },
      { activity: 'B', count: 1, caseKeys: [K1] },
      { activity: 'C', count: 2, caseKeys: [K1, K2] },
    ],
    edges: [
      { from: 'A', to: 'A', count: 1, caseKeys: [K1] },
      { from: 'A', to: 'B', count: 1, caseKeys: [K1] },
      { from: 'A', to: 'C', count: 1, caseKeys: [K2] },
      { from: 'B', to: 'C', count: 1, caseKeys: [K1] },
    ],
    starts: { A: 2 },
    ends: { C: 2 },
  },
  variants: [
    { id: JSON.stringify(['A', 'A', 'B', 'C']), activities: ['A', 'A', 'B', 'C'], count: 1, share: 0.5, avgElapsedMin: 15, caseKeys: [K1] },
    { id: JSON.stringify(['A', 'C']), activities: ['A', 'C'], count: 1, share: 0.5, avgElapsedMin: 20, caseKeys: [K2] },
  ],
  durations: [
    { caseKey: K1, elapsedMin: 15 },
    { caseKey: K2, elapsedMin: 20 },
  ],
  performance: {
    gaps: [
      { metricType: 'inter_event', from: 'A', to: 'A', meanMin: 5, n: 1, caseKeys: [K1] },
      { metricType: 'inter_event', from: 'A', to: 'B', meanMin: 7, n: 1, caseKeys: [K1] },
      { metricType: 'inter_event', from: 'A', to: 'C', meanMin: 20, n: 1, caseKeys: [K2] },
      { metricType: 'inter_event', from: 'B', to: 'C', meanMin: 3, n: 1, caseKeys: [K1] },
      { metricType: 'matched_gap', from: 'A', to: 'B', meanMin: 3, n: 1, caseKeys: [K1] },
      { metricType: 'service', from: 'A', meanMin: 4, n: 1, caseKeys: [K1] },
      { metricType: 'service', from: 'B', meanMin: 4, n: 1, caseKeys: [K1] },
    ],
    overlaps: 0,
    matchedPairs: 2,
    ambiguousPairs: 0,
  },
  resources: {
    resources: [
      { resource: 'R1', rawEvents: 4, instances: 3, distinctCases: 2, activityCounts: { A: 2, C: 1 }, activeMin: 4, caseKeys: [K1, K2], roles: [] },
      { resource: 'R2', rawEvents: 3, instances: 2, distinctCases: 2, activityCounts: { A: 1, B: 1 }, activeMin: 4, caseKeys: [K1, K2], roles: [] },
    ],
    handoffs: [
      { from: 'R1', to: 'R2', count: 1, caseKeys: [K1] },
      { from: 'R2', to: 'R1', count: 1, caseKeys: [K2] },
    ],
    knownRawEvents: 7,
    totalRawEvents: 8,
    knownInstances: 5,
    totalInstances: 6,
  },
  metrics: [
    { id: 'case_elapsed_mean', value: 17.5, unit: 'min', n: 2, eligible: 2, definition: 'Mean first-to-last elapsed minutes per case (hand-authored fixture value).', caseKeys: [K1, K2] },
    { id: 'resource_utilization', value: null, unit: '%', n: 0, eligible: 2, definition: 'Busy time / validated shift time (hand-authored fixture value).', reason: 'No validated shift records in this dataset.', caseKeys: [] },
  ],
  findings: [
    {
      id: 'fixture.slow_transition.A>C', scope: scopeFor('default'), metricId: 'inter_event_gap', value: 20, unit: 'min', n: 1,
      caseKeys: [K2], edge: { from: 'A', to: 'C' }, support: 'low',
      text: 'Slowest measured inter-event transition is A → C with a mean of 20 min (n = 1).',
      proposal: 'Investigate the handover or resource access between A and C. Not a confirmed root cause.',
    },
    {
      id: 'fixture.rework.A>A', scope: scopeFor('default'), metricId: 'rework_case_rate', value: 50, unit: '%', n: 2, eligible: 2,
      caseKeys: [K1], edge: { from: 'A', to: 'A' },
      text: '1 of 2 cases contains the adjacent self-loop A → A.',
      proposal: 'Investigate why A is repeated and whether a pre-check would avoid it.',
    },
    {
      id: 'fixture.workload.R1', scope: scopeFor('default'), metricId: 'resource_raw_events', value: 4, unit: 'events', n: 8, eligible: 8,
      caseKeys: [K1, K2],
      text: 'R1 has the most raw events (4 of 8). Known resource coverage is 7/8 raw events.',
      proposal: 'Review workload distribution. Capacity data is not available, so overload cannot be inferred.',
    },
  ],
};

const AUDIENCE_FIXTURE: ProcessFixture = {
  caseKeys: [E1, E2, E3],
  dfg: {
    nodes: [
      { activity: 'Entry Complete', count: 3, caseKeys: [E1, E2, E3] },
      { activity: 'Join Entry Queue', count: 3, caseKeys: [E1, E2, E3] },
      { activity: 'Ticket Verification', count: 3, caseKeys: [E1, E2, E3] },
    ],
    edges: [
      { from: 'Join Entry Queue', to: 'Ticket Verification', count: 3, caseKeys: [E1, E2, E3] },
      { from: 'Ticket Verification', to: 'Entry Complete', count: 3, caseKeys: [E1, E2, E3] },
    ],
    starts: { 'Join Entry Queue': 3 },
    ends: { 'Entry Complete': 3 },
  },
  variants: [
    {
      id: JSON.stringify(['Join Entry Queue', 'Ticket Verification', 'Entry Complete']),
      activities: ['Join Entry Queue', 'Ticket Verification', 'Entry Complete'],
      count: 3, share: 1, avgElapsedMin: 8 / 60, caseKeys: [E1, E2, E3],
    },
  ],
  durations: [
    { caseKey: E1, elapsedMin: 5 / 60 },
    { caseKey: E2, elapsedMin: 8 / 60 },
    { caseKey: E3, elapsedMin: 11 / 60 },
  ],
  performance: {
    gaps: [
      { metricType: 'inter_event', from: 'Join Entry Queue', to: 'Ticket Verification', meanMin: 7 / 60, n: 3, caseKeys: [E1, E2, E3] },
      { metricType: 'inter_event', from: 'Ticket Verification', to: 'Entry Complete', meanMin: 1 / 60, n: 3, caseKeys: [E1, E2, E3] },
      { metricType: 'service', from: 'Ticket Verification', meanMin: 4 / 60, n: 3, caseKeys: [E1, E2, E3] },
    ],
    overlaps: 0,
    matchedPairs: 3,
    ambiguousPairs: 0,
  },
  resources: {
    resources: [
      {
        resource: 'Gate1', rawEvents: 9, instances: 6, distinctCases: 3,
        activityCounts: { 'Ticket Verification': 3, 'Entry Complete': 3 }, activeMin: 0.2,
        caseKeys: [E1, E2, E3], roles: [],
      },
    ],
    handoffs: [],
    knownRawEvents: 9,
    totalRawEvents: 12,
    knownInstances: 6,
    totalInstances: 9,
  },
  metrics: [
    { id: 'case_elapsed_mean', value: 8 / 60, unit: 'min', n: 3, eligible: 3, definition: 'Mean first-to-last elapsed minutes per case (hand-authored fixture value).', caseKeys: [E1, E2, E3] },
    { id: 'resource_utilization', value: null, unit: '%', n: 0, eligible: 1, definition: 'Busy time / validated shift time (hand-authored fixture value).', reason: 'No validated shift records in this dataset.', caseKeys: [] },
    { id: 'audience_queue_wait_mean', value: 0.05, unit: 'min', n: 3, eligible: 3, definition: 'Mean of first Ticket Verification start − Join Entry Queue (hand-authored fixture value).', caseKeys: [E1, E2, E3] },
    { id: 'audience_entry_elapsed_mean', value: 8 / 60, unit: 'min', n: 3, eligible: 3, definition: 'Mean Join Entry Queue → Entry Complete, successful entries only (hand-authored fixture value).', caseKeys: [E1, E2, E3] },
    { id: 'audience_rejected_rate', value: 0, unit: '%', n: 3, eligible: 3, definition: 'Entry Rejected / cases with a known outcome (hand-authored fixture value).', caseKeys: [] },
  ],
  findings: [
    {
      id: 'fixture.queue_wait', scope: scopeFor('audience'), metricId: 'audience_queue_wait_mean', value: 0.05, unit: 'min', n: 3, eligible: 3,
      caseKeys: [E1, E2, E3], edge: { from: 'Join Entry Queue', to: 'Ticket Verification' },
      text: 'Observed queue wait (Join Entry Queue → Ticket Verification start) averages 0.05 min (3 s) over 3 entries, rising with each arrival.',
      proposal: 'Investigate gate capacity at Ticket Verification and evaluate one added staffed gate in Refine.',
    },
  ],
};

const FIXTURES: Record<string, ProcessFixture> = { default: DEFAULT_FIXTURE, audience: AUDIENCE_FIXTURE };

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

function fixtureFor(fn: string, traces: readonly Trace[]): ProcessFixture {
  const processes = new Set(traces.map((t) => t.processType));
  if (processes.size !== 1) {
    throw new FixtureUnavailableError(fn, 'The UI fixture only covers a single selected process.');
  }
  const [process] = [...processes];
  const fixture = FIXTURES[process!];
  if (!fixture || !sameKeys(fixture.caseKeys, traces.map((t) => t.caseKey))) {
    throw new FixtureUnavailableError(
      fn,
      'The UI fixture only has hand-authored values for the full, unfiltered process. Clear the date filter or use the real engine.',
    );
  }
  return fixture;
}

const QUEUE_BY_GATES: Record<number, QueueResult> = {
  1: { count: 3, meanWaitMin: 3 / 60, p95WaitMin: 6 / 60, maxWaitMin: 6 / 60, finishElapsedMin: 12 / 60, throughputPerHour: 900, gateCount: 1 },
  2: { count: 3, meanWaitMin: 2 / 3 / 60, p95WaitMin: 2 / 60, maxWaitMin: 2 / 60, finishElapsedMin: 8 / 60, throughputPerHour: 1350, gateCount: 2 },
};
const queueForManyGates = (gateCount: number): QueueResult => ({
  count: 3, meanWaitMin: 0, p95WaitMin: 0, maxWaitMin: 0, finishElapsedMin: 6 / 60, throughputPerHour: 1800, gateCount,
});

const FIXTURE_ARRIVALS = [
  { caseKey: E1, arrivalMs: A0, sourceOrder: 8 },
  { caseKey: E2, arrivalMs: A0 + SEC, sourceOrder: 12 },
  { caseKey: E3, arrivalMs: A0 + 2 * SEC, sourceOrder: 16 },
];

export const uiFixtureEngine: EngineApi = {
  validateAndNormalize(rows, options): ValidationResult {
    if (rows.length !== EVENTS.length || rows[0]?.event_id !== 'E01' || rows[8]?.event_id !== 'A01') {
      throw new FixtureUnavailableError('validateAndNormalize', 'Input is not the UI fixture CSV.');
    }
    const mappingChanged = Object.entries(UI_FIXTURE_MAPPING).some(([k, v]) => options.mapping[k] !== v) ||
      Object.entries(options.mapping).some(([k, v]) => v && (UI_FIXTURE_MAPPING as Record<string, string>)[k] !== v);
    if (mappingChanged || options.fixedOffset || options.requireProcessType) {
      throw new FixtureUnavailableError('validateAndNormalize', 'Hand-authored values exist only for the default fixture mapping and import options.');
    }
    return {
      events: EVENTS,
      issues: [
        {
          row: 9, field: 'timestamp', code: 'fixture.tied_timestamp', severity: 'warning',
          message: 'Tied timestamp with row 8 in the same case; source row order retained (fixture-authored issue).',
        },
      ],
      rawCount: EVENTS.length,
      excludedCount: 0,
      canAnalyze: true,
    };
  },
  groupCases(events) {
    if (events !== EVENTS) throw new FixtureUnavailableError('groupCases', 'Input is not the UI fixture event list.');
    return [...TRACES];
  },
  buildDFG: (traces) => fixtureFor('buildDFG', traces).dfg,
  getVariants: (traces) => fixtureFor('getVariants', traces).variants,
  getCaseDurations: (traces) => fixtureFor('getCaseDurations', traces).durations,
  getPerformance: (traces) => fixtureFor('getPerformance', traces).performance,
  getResourceAnalysis: (traces) => fixtureFor('getResourceAnalysis', traces).resources,
  getKPIs(traces, context) {
    const fixture = fixtureFor('getKPIs', traces);
    // Like the engine, Festival (audience_*) KPIs exist only when Festival adapters are enabled.
    const metrics = fixture.metrics.filter((m) => context.festival || !m.id.startsWith('audience_'));
    if (fixture === AUDIENCE_FIXTURE && context.festival && context.throughput) {
      const { bucketMinutes, anchorMs } = context.throughput;
      const endMs = anchorMs + bucketMinutes * MIN;
      // Hand-authored only for the case where all three completions share one bucket.
      if (anchorMs <= A0 + 5 * SEC && endMs > A0 + 13 * SEC) {
        metrics.push({
          id: 'audience_throughput', value: 3, unit: 'cases/bucket', n: 3, eligible: 3,
          definition: `Entry Complete cases per ${bucketMinutes}-min bucket (hand-authored fixture value).`,
          caseKeys: [E1, E2, E3], buckets: [{ startMs: anchorMs, endMs, count: 3, caseKeys: [E1, E2, E3] }],
        });
      }
    }
    return metrics;
  },
  getFindings(analysis) {
    const fixture = fixtureFor('getFindings', analysis.traces);
    // Target-breach findings are not hand-authored; Monitor shows breaches via evaluateTargets.
    // Findings whose metric is absent from this analysis (e.g. Festival KPIs disabled) are not emitted.
    const metricIds = new Set(analysis.metrics.map((m) => m.id));
    return fixture.findings
      .filter((f) => !f.metricId.startsWith('audience_') || metricIds.has(f.metricId))
      .map((f) => ({ ...f, scope: analysis.scope }));
  },
  evaluateTargets(metrics, targets): TargetEvaluation[] {
    // FIXTURE-ONLY STUB of the ENGINE_CONTRACT target rule, so Model → Monitor can be
    // exercised before the engine lands. The real path uses engine.evaluateTargets.
    return targets.map((t) => {
      const m = metrics.find((x) => x.id === t.metricId);
      if (!m || m.value === null || m.unit !== t.unit) return { metricId: t.metricId, status: 'unknown' };
      const met = t.direction === 'max' ? m.value <= t.value : m.value >= t.value;
      return { metricId: t.metricId, status: met ? 'met' : 'breached' };
    });
  },
  getGateInputs(traces, options) {
    fixtureFor('getGateInputs', traces);
    if (traces[0]?.processType !== 'audience' || options.serviceActivity !== 'Ticket Verification') {
      throw new FixtureUnavailableError('getGateInputs', 'The UI fixture only covers audience cases with service activity "Ticket Verification".');
    }
    const serviceSec = options.mode === 'observed' ? 4 : options.serviceSec;
    if (!(serviceSec > 0)) {
      throw new FixtureUnavailableError('getGateInputs', 'Assumed service seconds must be positive.');
    }
    const inputs: GateInput[] = FIXTURE_ARRIVALS.map((a) => ({ ...a, serviceSec }));
    return { inputs, eligibleCases: 3, exclusions: [] };
  },
  simulateGateQueue(inputs, gateCount) {
    if (inputs.length !== 3 || inputs.some((i) => i.serviceSec !== 4)) {
      throw new FixtureUnavailableError('simulateGateQueue', 'The UI fixture only has hand-calculated queue results for 4-second service (T09).');
    }
    if (!Number.isInteger(gateCount) || gateCount < 1) {
      throw new FixtureUnavailableError('simulateGateQueue', 'Gate count must be an integer of at least 1.');
    }
    return QUEUE_BY_GATES[gateCount] ?? queueForManyGates(gateCount);
  },
};
