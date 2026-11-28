import Papa from 'papaparse';
import { describe, expect, test } from 'vitest';
import type { GateInput, RawRow } from '../src/contracts';
import * as engine from '../src/engine';
import { instant, key, options, pair, row, tracesOf } from './engine-fixtures';

describe('Test plan engine cases', () => {
  test('T01 derives DFG, boundaries, variants and case elapsed from two cases', () => {
    const traces = tracesOf([row('C1', 'A', 0), row('C1', 'B', 10), row('C1', 'C', 30), row('C2', 'A', 0), row('C2', 'C', 20)]);
    const { edges, starts, ends } = engine.buildDFG(traces);
    expect(edges.map(({ from, to, count }) => [from, to, count])).toEqual([['A', 'B', 1], ['B', 'C', 1], ['A', 'C', 1]]);
    expect(starts).toEqual({ A: 2 });
    expect(ends).toEqual({ C: 2 });
    expect(engine.getVariants(traces).map(({ activities, share }) => [activities, share]))
      .toEqual([[['A', 'B', 'C'], 0.5], [['A', 'C'], 0.5]]);
    expect(engine.getKPIs(traces, { processKey: 'default' }).find(metric => metric.id === 'case_elapsed_mean')?.value).toBe(25);
  });

  test('T02 retains adjacent completed instances and the self-loop', () => {
    const complete = { lifecycle: 'complete' };
    const traces = tracesOf([
      row('C1', 'A', 0, complete), row('C1', 'A', 1, complete), row('C1', 'B', 2, complete),
      row('C2', 'A', 0, complete), row('C2', 'B', 1, complete),
    ]);
    const { nodes, edges } = engine.buildDFG(traces);
    expect(nodes.map(({ activity, count }) => [activity, count])).toEqual([['A', 3], ['B', 2]]);
    expect(edges.map(({ from, to, count }) => [from, to, count])).toEqual([['A', 'A', 1], ['A', 'B', 2]]);
    expect(engine.getVariants(traces).map(variant => variant.activities)).toEqual([['A', 'A', 'B'], ['A', 'B']]);
  });

  const handoffFixture = () => tracesOf([
    row('C1', 'A', 0, { resource: 'R1' }), row('C1', 'B', 1, { resource: 'R2' }),
    row('C1', 'C', 2, { resource: 'R2' }), row('C1', 'D', 3, { resource: '' }),
  ]);

  test('T03 counts known events and only adjacent distinct known resources', () => {
    const output = engine.getResourceAnalysis(handoffFixture());
    expect(output.resources.map(({ resource, rawEvents }) => [resource, rawEvents])).toEqual([['R1', 1], ['R2', 2]]);
    expect(output).toMatchObject({ knownRawEvents: 3, totalRawEvents: 4, knownInstances: 3, totalInstances: 4 });
    expect(output.handoffs).toEqual([{ from: 'R1', to: 'R2', count: 1, caseKeys: [key('C1')],
        activityPairs: [{ from: 'A', to: 'B', count: 1, caseKeys: [key('C1')] }] }]);
  });

  test('T04 measures service, matched transition and inter-event time independently', () => {
    const traces = tracesOf([...pair('C1', 'A', 0, 5, { activity_instance_id: 'A1' }), ...pair('C1', 'B', 8, 12, { activity_instance_id: 'B1' })]);
    const output = engine.getPerformance(traces);
    expect(traces[0].sequence.map(event => event.activity)).toEqual(['A', 'B']);
    expect(traces[0].elapsedMin).toBe(12);
    expect(output.gaps.map(gap => [gap.metricType, gap.from, gap.to, gap.meanMin]))
      .toEqual([['service', 'A', undefined, 5], ['service', 'B', undefined, 4], ['inter_event', 'A', 'B', 7], ['matched_gap', 'A', 'B', 3]]);
  });

  test('T05 uses source order for equivalent instants and requires exclusion consent', () => {
    const parsed = Papa.parse<RawRow>([
      'case_id,activity,timestamp',
      'C1,B,2026-11-27T10:00+09:00',
      'C1,A,2026-11-27T01:00Z',
      'C2,C,2026-11-27T01:00Z',
      'C2,D,invalid',
      'C3,"Sound, check",2026-11-27T01:00Z',
    ].join('\n'), { header: true });
    expect(parsed.errors).toEqual([]);
    const blocked = engine.validateAndNormalize(parsed.data, options);
    expect(blocked).toMatchObject({
      rawCount: 5, excludedCount: 1, canAnalyze: false,
      issues: [{ code: 'timestamp_tie', row: 1, severity: 'warning' }, { code: 'invalid_timestamp', row: 3, severity: 'error' }],
    });
    const consented = engine.validateAndNormalize(parsed.data, { ...options, acceptExclusions: true });
    expect(consented.canAnalyze).toBe(true);
    expect(consented.events[3].activity).toBe('Sound, check');
    const traces = engine.groupCases(consented.events);
    expect(engine.buildDFG(traces).edges).toEqual([{ from: 'B', to: 'A', count: 1, caseKeys: [key('C1')] }]);
    expect(engine.getPerformance(traces).gaps).toEqual([{ metricType: 'inter_event', from: 'B', to: 'A', n: 1, meanMin: 0, caseKeys: [key('C1')] }]);
  });

  test('T06 namespaces equal case IDs by process and rejects mixed discovery', () => {
    const traces = tracesOf([
      row('001', 'A', 0, { process_type: 'stage' }), row('001', 'B', 1, { process_type: 'stage' }),
      row('001', 'C', 0, { process_type: 'equipment' }), row('001', 'D', 2, { process_type: 'equipment' }),
    ]);
    expect(traces.map(trace => trace.caseKey)).toEqual([key('001', 'stage'), key('001', 'equipment')]);
    expect(() => engine.buildDFG(traces)).toThrow(RangeError);
    expect(engine.buildDFG([traces[0]]).edges).toEqual([{ from: 'A', to: 'B', count: 1, caseKeys: [key('001', 'stage')] }]);
    expect(engine.buildDFG([traces[1]]).edges).toEqual([{ from: 'C', to: 'D', count: 1, caseKeys: [key('001', 'equipment')] }]);
  });

  test('T07 flags ambiguous no-ID lifecycle groups and retains completion evidence', () => {
    const imported = engine.validateAndNormalize([
      row('C1', 'A', 0, { lifecycle: 'start' }), row('C1', 'A', 1, { lifecycle: 'start' }),
      row('C1', 'A', 2, { lifecycle: 'complete' }),
    ], options);
    expect(imported.canAnalyze).toBe(true);
    expect(imported.issues.map(issue => issue.code)).toEqual(Array(3).fill('ambiguous_lifecycle'));
    const traces = engine.groupCases(imported.events);
    expect(traces[0].sequence.map(event => event.activity)).toEqual(['A']);
    expect(engine.getPerformance(traces)).toEqual({ gaps: [], overlaps: 0, matchedPairs: 0, ambiguousPairs: 1, transitionCoverage: [] });
  });

  test('T08 excludes invalid dates and duplicate IDs, also flags missing resource coverage', () => {
    const imported = engine.validateAndNormalize([
      row('C1', 'A', 0, { resource: 'NONE', event_id: 'R1' }),
      row('C1', 'B', 1),
      row('C1', 'C', 2, { timestamp: '2026-02-30T12:00:00Z' }),
      row('C1', 'D', 3, { event_id: 'R1' }),
    ], { ...options, acceptExclusions: true });
    expect(imported).toMatchObject({
      canAnalyze: true, excludedCount: 2,
      issues: [{ code: 'invalid_timestamp', row: 2 }, { code: 'duplicate_event_id', row: 3 }],
    });
    const traces = engine.groupCases(imported.events);
    expect(engine.getResourceAnalysis(traces)).toMatchObject({ resources: [], totalRawEvents: 2, knownRawEvents: 0 });
    expect(engine.getKPIs(traces, { processKey: 'default' }).find(metric => metric.id === 'resource_utilization'))
      .toMatchObject({ value: null, n: 0, reason: expect.any(String) });
  });

  test('T09 runs both gate counts on the same arrival and service vector', () => {
    const inputs: GateInput[] = [0, 1, 2].map(seconds => ({
      caseKey: key(String(seconds), 'audience'), arrivalMs: seconds * 1000, sourceOrder: seconds, serviceSec: 4,
    }));
    const one = engine.simulateGateQueue(inputs, 1);
    expect(one).toMatchObject({ count: 3, meanWaitMin: 3 / 60, p95WaitMin: 6 / 60, maxWaitMin: 6 / 60, finishElapsedMin: 12 / 60, throughputPerHour: 900 });
    const two = engine.simulateGateQueue(inputs, 2);
    expect(two).toMatchObject({ count: 3, p95WaitMin: 2 / 60, maxWaitMin: 2 / 60, finishElapsedMin: 8 / 60, throughputPerHour: 1350 });
    expect(two.meanWaitMin).toBeCloseTo((2 / 3) / 60);
  });

  test('T15 unions parallel resource activity and requires shifts for utilization', () => {
    const traces = tracesOf([
      ...pair('C1', 'A', 0, 10, { resource: 'R1' }),
      ...pair('C1', 'B', 5, 15, { resource: 'R1' }),
    ]);
    expect(engine.getResourceAnalysis(traces).resources[0].activeMin).toBe(15);
    expect(engine.getPerformance(traces)).toMatchObject({ overlaps: 1, matchedPairs: 2 });
    expect(engine.getPerformance(traces).gaps.some(gap => gap.metricType === 'matched_gap')).toBe(false);
    expect(engine.getKPIs(traces, { processKey: 'default' }).find(metric => metric.id === 'resource_utilization')?.value).toBeNull();
  });

  test('T17 graph-ready data preserves reverse directions and per-edge case evidence', () => {
    expect(engine.getResourceAnalysis(handoffFixture()).handoffs)
      .toEqual([{ from: 'R1', to: 'R2', count: 1, caseKeys: [key('C1')],
        activityPairs: [{ from: 'A', to: 'B', count: 1, caseKeys: [key('C1')] }] }]);
    const traces = tracesOf([
      row('C1', 'A', 0, { resource: 'R2' }), row('C1', 'B', 1, { resource: 'R1' }),
      row('C2', 'A', 0, { resource: 'R1' }), row('C2', 'B', 1, { resource: 'R2' }),
    ]);
    expect(engine.getResourceAnalysis(traces).handoffs).toEqual([
      { from: 'R2', to: 'R1', count: 1, caseKeys: [key('C1')],
        activityPairs: [{ from: 'A', to: 'B', count: 1, caseKeys: [key('C1')] }] },
      { from: 'R1', to: 'R2', count: 1, caseKeys: [key('C2')],
        activityPairs: [{ from: 'A', to: 'B', count: 1, caseKeys: [key('C2')] }] },
    ]);
  });
});

test('normalization handles mapped extras, selected offsets, unchanged originals, duplicates and start-only cases', () => {
  const data = { ...row(' 004 ', ' A ', 0), timestamp: '2024-02-29T09:00',
    stage: '', crew: ' Audio ', untouched: ' unchanged ', lifecycle: 'start' };
  const custom = { ...options, fixedOffset: '+09:00',
    mapping: { ...options.mapping, process_type: 'stage', resource_role: 'crew' } };
  expect(engine.validateAndNormalize([data], options).canAnalyze).toBe(false);
  expect(engine.validateAndNormalize([data], { ...custom, requireProcessType: true }).canAnalyze).toBe(false);
  const result = engine.validateAndNormalize([Object.freeze(data), data], custom);
  expect(result).toMatchObject({ canAnalyze: true, excludedCount: 0 });
  expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
    'trimmed_value', 'duplicate_row_without_id', 'empty_discovery_case', 'timestamp_tie',
  ]));
  expect(result.events[0]).toMatchObject({
    timestampMs: Date.UTC(2024, 1, 29), rawTimestamp: data.timestamp, caseId: '004',
    activity: 'A', processType: 'default', attrs: { resource_role: ' Audio ', untouched: ' unchanged ' },
  });
  const traces = engine.groupCases(result.events);
  expect(traces[0].sequence).toEqual([]);
  expect(engine.getVariants(traces)).toEqual([]);
  expect(engine.validateAndNormalize([], custom)).toMatchObject({ canAnalyze: false, issues: [{ row: -1 }] });
  expect(engine.validateAndNormalize([data], { ...custom, fixedOffset: '+09:80' }).issues[0])
    .toMatchObject({ row: -1, code: 'invalid_fixed_offset' });
});

test('matched intervals ignore reversed pairs and conflicting ownership', () => {
  const rows = [
    ...pair('C1', 'A', 10, 8, { activity_instance_id: 'A1', resource: 'R1' }),
    row('C1', 'B', 11, { lifecycle: 'start', resource: 'R1' }),
    row('C1', 'B', 12, { lifecycle: 'complete', resource: 'R2' }),
    row('C1', 'C', 13, { lifecycle: 'start' }),
  ];
  const imported = engine.validateAndNormalize(rows, options);
  expect(imported.issues.map(issue => issue.code)).toEqual(['negative_lifecycle_duration', 'negative_lifecycle_duration', 'missing_lifecycle_partner']);
  const traces = engine.groupCases(imported.events);
  expect(engine.getPerformance(traces).matchedPairs).toBe(1);
  expect(engine.getResourceAnalysis(traces).resources.map(resource => resource.activeMin)).toEqual([null, null]);
});

test('shift metrics union availability, clip overlapping busy time and identify out-of-shift cases', () => {
  const traces = tracesOf([
    ...pair('C1', 'A', 0, 10, { resource: 'R1', resource_role: 'Crew' }),
    ...pair('C2', 'B', 5, 15, { resource: 'R1', resource_role: 'Audio' }),
    row('C3', 'C', 4, { resource: 'R2' }),
  ]);
  const shifts = [
    { resource: 'R1', startMs: Date.parse(instant(2)), endMs: Date.parse(instant(10)) },
    { resource: 'R1', startMs: Date.parse(instant(8)), endMs: Date.parse(instant(22)) },
    { resource: 'R2', startMs: 0, endMs: 0 }, { resource: 'R1', startMs: 0, endMs: Infinity },
  ];
  expect(engine.getResourceAnalysis(traces).resources[0]).toMatchObject({ activeMin: 15, roles: ['Crew', 'Audio'] });
  const metrics = engine.getKPIs(traces, { processKey: 'default', shifts });
  expect(metrics.find(metric => metric.id === 'resource_utilization')).toMatchObject({ value: 65, n: 1, eligible: 2, caseKeys: [key('C1'), key('C2')] });
  expect(metrics.find(metric => metric.id === 'resource_out_of_shift_minutes')).toMatchObject({ value: 2, n: 1, eligible: 2, caseKeys: [key('C1')] });
});

test('queue resolves tied arrival instants by source order, measures nearest-rank p95 and rejects invalid input', () => {
  const input = { caseKey: key('01'), arrivalMs: 3000, sourceOrder: 0, serviceSec: 2 };
  const tied = [Object.freeze({ ...input, sourceOrder: 5, serviceSec: 8 }), Object.freeze(input)];
  expect(engine.simulateGateQueue(Object.freeze(tied), 1)).toMatchObject({ maxWaitMin: 2 / 60, finishElapsedMin: 10 / 60 });
  const arrivals = Array.from({ length: 20 }, (_, sourceOrder) => ({ ...input, sourceOrder, serviceSec: 1 }));
  expect(engine.simulateGateQueue(arrivals, 1)).toMatchObject({ p95WaitMin: 18 / 60, maxWaitMin: 19 / 60 });
  expect(() => engine.simulateGateQueue([], 1)).toThrow(RangeError);
  expect(() => engine.simulateGateQueue([input], 1.5)).toThrow(RangeError);
  expect(() => engine.simulateGateQueue([{ ...input, serviceSec: 0 }], 1)).toThrow(RangeError);
  expect(() => engine.simulateGateQueue([{ ...input, arrivalMs: Infinity }], 1)).toThrow(RangeError);
});
