import { expect, test } from 'vitest';
import type { GateInput, Target } from '../../src/contracts';
import type { EventWindow, V03EngineApi } from '../../src/v03-contracts';
import * as engine from '../../src/engine';
import { key, pair, row, tracesOf } from '../engine-fixtures';
import { orderTraces } from './fixtures';

const v03: V03EngineApi = engine;
const min = (value: number) => value * 60_000;
const window = (start: number, end: number): EventWindow => ({ startMs: min(start), endMs: min(end) });

test('replay applies all tied observations, preserves carry-in and restores a prior frame on rewind', () => {
  const traces = tracesOf([...pair('1', 'A', 0, 8), row('2', 'X', 3), row('2', 'Y', 3), row('3', 'Z', 10)]);
  const index = v03.buildReplayIndex(traces, { completionActivities: ['Y'] });
  const frame = (cursor: number, variantIds?: string[]) =>
    v03.getReplayFrame(index, { window: window(2, 12), cursorMs: min(cursor), variantIds });
  expect(index.observationWindow).toEqual({ startMs: 0, endMs: min(10) + 1 });
  const start = frame(2);
  expect(start).toMatchObject({ selectedCases: 3, cases: [{ caseKey: key('1'), state: 'active' }],
    counts: { active: 1, not_yet_observed: 2, latest_observation: 0, last_observation: 0, completed: 0 } });
  expect(frame(3).cases[1]).toMatchObject({ caseKey: key('2'), state: 'completed', latest: { activity: 'Y', sourceOrder: 3 } });
  expect(frame(8).cases[0]).toMatchObject({ state: 'last_observation', active: [] });
  expect(frame(2)).toEqual(start);
  expect(frame(3, ['["X","Y"]', '["X","Y"]'])).toMatchObject({ selectedCases: 1, counts: { completed: 1 } });
  expect(frame(3, [])).toMatchObject({ selectedCases: 0, cases: [] });
  expect(() => frame(3, ['bad-id'])).toThrow(RangeError);
  expect(() => frame(12)).toThrow(RangeError);
});

test('replay keeps exact case counts with parallel intervals, point rows and start-only variants', () => {
  const traces = tracesOf([...pair('1', 'A', 0, 6), ...pair('1', 'B', 1, 7),
    row('2', 'Unknown start', 0, { lifecycle: 'start' }), row('3', 'Point', 0), row('3', 'End', 4)]);
  const index = v03.buildReplayIndex(traces);
  const frame = v03.getReplayFrame(index, { window: window(0, 8), cursorMs: min(2) });
  expect(index.cases.map(item => item.variantId)).toEqual(['["A","B"]', null, '["Point","End"]']);
  expect(frame.cases[0].active.map(item => item.activity)).toEqual(['A', 'B']);
  expect(frame.cases.map(item => item.state)).toEqual(['active', 'last_observation', 'latest_observation']);
  expect(Object.values(frame.counts).reduce((a, b) => a + b, 0)).toBe(frame.selectedCases);
  expect(() => v03.buildReplayIndex(traces, { completionActivities: [''] })).toThrow(RangeError);
});

test('generic queue extraction validates arrival and service independently and preserves source-order ties', () => {
  const traces = tracesOf([
    row('1', 'Arrival', 0), ...pair('1', 'Service', 0, 1),
    ...pair('2', 'Service', 0, 1), row('2', 'Arrival', 0),
    row('3', 'Arrival', 0), row('3', 'Arrival', 1),
    row('4', 'Other', 0), row('5', 'Arrival', 0), row('6', 'Arrival', 0), ...pair('6', 'Service', 1, 1),
    row('7', 'Arrival', 0), ...pair('7', 'Service', 1, 2), row('7', 'Service', 3),
    row('8', 'Arrival', 0), row('8', 'Service', 1, { lifecycle: 'start', activity_instance_id: 'X' }),
    row('8', 'Service', 2, { lifecycle: 'complete', activity_instance_id: 'Y' }),
  ]);
  const choice = { arrival: { activity: 'Arrival' }, service: { mode: 'observed' as const, activity: 'Service' } };
  expect(v03.extractQueueInputs(traces, choice)).toEqual({
    eligibleCases: 8, inputs: [{ caseKey: key('1'), arrivalMs: 0, serviceSec: 60, sourceOrder: 0 }],
    exclusions: [
      { caseKey: key('2'), reason: 'service_before_arrival' }, { caseKey: key('3'), reason: 'ambiguous_arrival' },
      { caseKey: key('4'), reason: 'missing_arrival' }, { caseKey: key('5'), reason: 'missing_service' },
      { caseKey: key('6'), reason: 'invalid_service' }, { caseKey: key('7'), reason: 'ambiguous_service' },
      { caseKey: key('8'), reason: 'invalid_service' },
    ],
  });
  const ownStart = v03.extractQueueInputs(traces.slice(0, 1), {
    ...choice, arrival: { activity: 'Service', lifecycle: 'start' },
  });
  expect(ownStart.inputs).toMatchObject([{ serviceSec: 60, sourceOrder: 1 }]);
  expect(v03.extractQueueInputs(traces, { ...choice, service: { mode: 'assumed', serviceSec: 1.5 } }).inputs)
    .toHaveLength(6);
});

test('generic queue compares the hand-calculated FCFS input vector and preserves decimal precision', () => {
  const inputs: GateInput[] = [0, 1, 2].map(i => Object.freeze({ caseKey: key(String(i)),
    arrivalMs: i * 1000, serviceSec: 4, sourceOrder: i }));
  const config = { baselineServers: 1, candidateServers: 2, assumeOneQualifiedWorkerPerServer: false };
  const result = v03.compareQueues(Object.freeze(inputs), config);
  expect(result).toMatchObject({ serverDelta: 1, staffingDelta: null, candidateServiceMultiplier: 1,
    baseline: { serverCount: 1, meanWaitMin: 3 / 60, p95WaitMin: 6 / 60, maxWaitMin: 6 / 60,
      finishElapsedMin: 12 / 60, throughputPerHour: 900 },
    candidate: { serverCount: 2, p95WaitMin: 2 / 60, maxWaitMin: 2 / 60, finishElapsedMin: 8 / 60, throughputPerHour: 1350 },
  });
  expect(result.candidate.meanWaitMin).toBeCloseTo(2 / 3 / 60, 12);
  const identity = v03.compareQueues(inputs, { ...config, candidateServers: 1, assumeOneQualifiedWorkerPerServer: true });
  expect(identity.candidate).toEqual(identity.baseline);
  expect(identity.staffingDelta).toBe(0);
  const faster = v03.compareQueues(inputs, { ...config, candidateServers: 1, candidateServiceMultiplier: 0.5 });
  expect(faster.candidate).toMatchObject({ count: 3, meanWaitMin: 1 / 60, finishElapsedMin: 6 / 60 });
  const decimals = inputs.map((item, i) => ({ ...item, arrivalMs: [0, 100, 300][i], serviceSec: [0.1, 0.2, 0.05][i] }));
  expect(v03.compareQueues(decimals, { ...config, candidateServers: 1 }).candidate).toMatchObject({ meanWaitMin: 0, maxWaitMin: 0 });
  const transformed = [
    { ...inputs[0], arrivalMs: 0, serviceSec: 0.1 },
    { ...inputs[1], arrivalMs: 300, serviceSec: 0.1 },
  ];
  expect(v03.compareQueues(transformed, { ...config, candidateServers: 1, candidateServiceMultiplier: 3 }).candidate.maxWaitMin).toBe(0);
  expect(() => v03.compareQueues([inputs[0], inputs[0]], config)).toThrow(RangeError);
  expect(() => v03.compareQueues(inputs, { ...config, candidateServiceMultiplier: Number.MAX_VALUE })).toThrow(RangeError);
});

test('generic throughput counts the first selected terminal per case and binds KPI targets to the definition', () => {
  const traces = orderTraces();
  const anchorMs = traces[0].events[0].timestampMs;
  const buckets = { bucketMinutes: 5, anchorMs };
  const first = { buckets, completion: { completionActivities: ['Order Shipped'] } };
  const shipped = v03.getCaseThroughput(traces, first);
  const both = v03.getCaseThroughput(traces, { buckets, completion: { completionActivities: ['Order Shipped', 'Order Cancelled'] } });
  expect(shipped).toMatchObject({ value: 0.5, n: 2, eligible: 3, unit: 'cases/bucket', caseKeys: [key('001'), key('002')] });
  expect(shipped.buckets.map(({ count }) => count)).toEqual([0, 0, 1, 1]);
  expect(both.buckets.map(({ count }) => count)).toEqual([0, 0, 1, 2]);
  expect(both.definitionKey).not.toBe(shipped.definitionKey);
  const equivalent = v03.getCaseThroughput(traces, { buckets: { ...buckets, anchorMs: anchorMs + min(5) },
    completion: { completionActivities: ['Order Cancelled', 'Order Shipped'] } });
  expect(equivalent.definitionKey).toBe(both.definitionKey);
  expect(engine.getKPIs(traces, { processKey: 'default', caseThroughput: first }).at(-1)).toEqual(shipped);
  const target: Target = { metricId: shipped.id, unit: shipped.unit, direction: 'min', value: 0.5, definitionKey: shipped.definitionKey };
  expect(engine.evaluateTargets([shipped], [target, { ...target, definitionKey: undefined }]).map(res => res.status)).toEqual(['met', 'unknown']);
  expect(engine.evaluateTargets([both], [target])[0].status).toBe('unknown');
});

test('generic throughput separates missing completion, empty scope, bucket limit and a measured zero', () => {
  const buckets = { bucketMinutes: 1, anchorMs: 0 };
  const options = { buckets, completion: { completionActivities: ['End'] } };
  expect(v03.getCaseThroughput([], { buckets })).toMatchObject({ unavailable: 'missing_completion', value: null });
  expect(v03.getCaseThroughput([], options)).toMatchObject({ unavailable: 'empty_scope', value: null, definitionKey: expect.any(String) });
  const traces = tracesOf([row('1', 'End', -1, { lifecycle: 'start' }), row('1', 'Other', 0)]);
  expect(v03.getCaseThroughput(traces, options)).toMatchObject({ value: 0, n: 0, eligible: 1, unavailable: null,
    buckets: [{ startMs: -60_000, count: 0 }, { startMs: 0, count: 0 }] });
  const repeated = tracesOf([row('1', 'End', 0), row('1', 'End', 1)]);
  expect(v03.getCaseThroughput(repeated, options).buckets.map(item => item.count)).toEqual([1, 0]);
  expect(v03.getCaseThroughput(tracesOf([row('1', 'End', 0), row('2', 'End', 100_000)]), options).unavailable).toBe('bucket_limit');
  expect(() => v03.getCaseThroughput([], { ...options, completion: { completionActivities: ['End', 'End'] } })).toThrow(RangeError);
  expect(() => v03.getCaseThroughput([], { buckets: { ...buckets, anchorMs: 0.5 } })).toThrow(RangeError);
});

test('drift uses destination time and separates share support from observed gap support', () => {
  const cases = (prefix: string, labels: string[], start: number, destination: number) => labels.flatMap((label, i) =>
    [row(prefix + i, 'A', start), row(prefix + i, label, destination)]);
  const traces = tracesOf([
    ...cases('B', ['B', 'B', 'C', 'C'], -1, 0), ...cases('R', ['B', 'B', 'B', 'D'], 8, 10),
    row('New', 'X', 9), row('New', 'Y', 10), row('Outside', 'A', 19), row('Outside', 'B', 20),
  ]);
  const result = v03.getTransitionDrift(traces, window(0, 10), window(10, 20));
  const [ab, ac, ad, xy] = result.transitions;
  expect(ab).toMatchObject({ from: 'A', to: 'B', deltaSharePp: 25, deltaMeanGapMin: 1,
    shareSupport: 'sufficient', gapSupport: 'low',
    baseline: { count: 2, outgoingCount: 4, sharePct: 50, gapN: 2, meanGapMin: 1, caseKeys: [key('B0'), key('B1')] },
    recent: { count: 3, outgoingCount: 4, sharePct: 75, gapN: 3, meanGapMin: 2 },
  });
  expect(ac).toMatchObject({ from: 'A', to: 'C', deltaSharePp: -50, gapSupport: 'unavailable',
    recent: { count: 0, sharePct: 0, meanGapMin: null, caseKeys: [] } });
  expect(ad.baseline.sharePct).toBe(0);
  expect(xy).toMatchObject({ from: 'X', deltaSharePp: null, shareSupport: 'unavailable', baseline: { outgoingCount: 0, sharePct: null } });
  expect(() => v03.getTransitionDrift(traces, window(0, 11), window(10, 20))).toThrow(RangeError);
});

test('ICN-inspired patterns count observed loops, classify divergence and retain only positive matched overlaps', () => {
  const traces = tracesOf([
    row('1', 'A', 0), row('1', 'A', 1), row('1', 'B', 2), row('1', 'A', 3),
    ...pair('2', 'X', 0, 5), ...pair('2', 'Y', 3, 7), ...pair('2', 'Z', 7, 9),
  ]);
  const patterns = v03.getPatternEvidence(traces);
  expect(patterns.sequences).toEqual(engine.buildDFG(traces).edges);
  expect(patterns.selfLoops).toEqual([{ from: 'A', to: 'A', count: 1, caseKeys: [key('1')] }]);
  expect(patterns.shortLoops).toEqual([{ outer: 'A', via: 'B', count: 1, caseKeys: [key('1')] }]);
  expect(patterns.divergences[0]).toMatchObject({ from: 'A', outgoingCount: 2,
    alternatives: [{ to: 'A' }, { to: 'B' }], caseKeys: [key('1')] });
  expect(patterns.overlaps).toMatchObject([{ activities: ['X', 'Y'], count: 1, cases: [{ caseKey: key('2'), count: 1,
    example: [{ activity: 'X', start: { timestampMs: 0 }, complete: { timestampMs: min(5) } },
      { activity: 'Y', start: { timestampMs: min(3) }, complete: { timestampMs: min(7) } }] }] }]);
  expect(patterns.matchedPairs).toBe(3);
});

test('ICN-inspired overlaps count repeated cross-activity matches once and preserve earliest evidence', () => {
  const traces = tracesOf([
    ...pair('1', 'X', 0, 5, { activity_instance_id: 'X1' }), ...pair('1', 'X', 1, 6, { activity_instance_id: 'X2' }),
    ...pair('1', 'Y', 2, 4, { activity_instance_id: 'Y1' }), ...pair('1', 'Y', 3, 7, { activity_instance_id: 'Y2' }),
    ...pair('1', 'Z', 3, 3),
    ...pair('2', 'X', 0, 2), ...pair('2', 'Y', 1, 3),
  ]);
  expect(v03.getPatternEvidence(traces).overlaps).toMatchObject([
    { activities: ['X', 'Y'], count: 5, cases: [
      { caseKey: key('1'), count: 4, example: [{ start: { timestampMs: 0 } }, { start: { timestampMs: min(2) } }] },
      { caseKey: key('2'), count: 1 },
    ] },
  ]);
});
