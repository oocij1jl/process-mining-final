import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, expect, test } from 'vitest';
import type { FindingAnalysis, RawRow } from '../src/contracts';
import * as engine from '../src/engine';
import { key, options, pair, row, tracesOf } from './engine-fixtures';

const fixtureUrl = new URL('./fixtures/phase-0-event-log.csv', import.meta.url);
const fixture = Papa.parse<RawRow>(readFileSync(fixtureUrl, 'utf8'), {
  header: true,
  skipEmptyLines: true,
});

test('PapaParse reads the Phase 0 fixture with lifecycle and resource values intact', () => {
  expect(fixture.errors).toEqual([]);
  expect(fixture.meta.fields).toEqual([
    'event_id', 'case_id', 'activity', 'timestamp', 'lifecycle', 'activity_instance_id', 'resource',
  ]);
  expect(fixture.data.map((row) => Object.values(row))).toEqual([
    ['E01', '001', 'A', '2026-11-27T00:00:00Z', '', '', 'R1'],
    ['E02', '001', 'A', '2026-11-27T00:01:00Z', 'start', 'A1', 'R1'],
    ['E03', '001', 'A', '2026-11-27T00:05:00Z', 'complete', 'A1', 'R1'],
    ['E04', '001', 'B', '2026-11-27T00:08:00Z', 'start', 'B1', 'R2'],
    ['E05', '001', 'B', '2026-11-27T00:12:00Z', 'complete', 'B1', 'R2'],
    ['E06', '001', 'C', '2026-11-27T00:15:00Z', '', '', ''],
    ['E07', '002', 'A', '2026-11-27T00:01:00Z', '', '', 'R2'],
    ['E08', '002', 'C', '2026-11-27T00:21:00Z', '', '', 'R1'],
  ]);
});

describe('Phase 1 public engine functions', () => {
  const imported = engine.validateAndNormalize(fixture.data, options);
  const traces = engine.groupCases(imported.events);
  const firstCase = key('001');
  const secondCase = key('002');
  const scope = { datasetId: 'phase-0-fixture', processKey: 'default', analysisFilterFingerprint: 'all' };
  const metrics = engine.getKPIs(traces, scope);
  const target = { metricId: 'case_elapsed_mean', unit: 'min', direction: 'max', value: 16 } as const;

  test('validateAndNormalize retains IDs, raw timestamps, source order, and unmapped values', () => {
    expect(imported).toMatchObject({ canAnalyze: true, rawCount: 8, excludedCount: 0, issues: [] });
    expect(imported.events[0]).toMatchObject({
      eventId: 'E01', caseId: '001', caseKey: firstCase, processType: 'default',
      activity: 'A', lifecycle: 'point', sourceOrder: 0, resource: 'R1',
      rawTimestamp: '2026-11-27T00:00:00Z', timestampMs: Date.UTC(2026, 10, 27),
    });
    expect(imported.events[1]).toMatchObject({ lifecycle: 'start', instanceId: 'A1' });
    expect(imported.events[5].resource).toBeNull();
  });

  test('groupCases sorts raw events and removes starts from the discovery sequence', () => {
    expect(engine.groupCases([...imported.events].reverse()).find(trace => trace.caseKey === firstCase))
      .toMatchObject({ events: imported.events.slice(0, 6), sequence: [0, 2, 4, 5].map(i => imported.events[i]) });
  });

  test('buildDFG includes cases, boundary counts, and self-loops', () => {
    expect(engine.buildDFG(traces)).toEqual({
      nodes: [
        { activity: 'A', count: 3, caseKeys: [firstCase, secondCase] },
        { activity: 'B', count: 1, caseKeys: [firstCase] },
        { activity: 'C', count: 2, caseKeys: [firstCase, secondCase] },
      ],
      edges: [
        { from: 'A', to: 'A', count: 1, caseKeys: [firstCase] },
        { from: 'A', to: 'B', count: 1, caseKeys: [firstCase] },
        { from: 'B', to: 'C', count: 1, caseKeys: [firstCase] },
        { from: 'A', to: 'C', count: 1, caseKeys: [secondCase] },
      ],
      starts: { A: 2 }, ends: { C: 2 },
    });
  });

  test('getVariants uses exact activity arrays and computes shares and elapsed means', () => {
    expect(engine.getVariants(traces)).toEqual([
      { id: '["A","A","B","C"]', activities: ['A', 'A', 'B', 'C'], count: 1, share: 0.5, avgElapsedMin: 15, caseKeys: [firstCase] },
      { id: '["A","C"]', activities: ['A', 'C'], count: 1, share: 0.5, avgElapsedMin: 20, caseKeys: [secondCase] },
    ]);
  });

  test('getCaseDurations calculates first-to-last elapsed minutes', () => {
    expect(engine.getCaseDurations(traces)).toEqual([
      { caseKey: firstCase, elapsedMin: 15 }, { caseKey: secondCase, elapsedMin: 20 },
    ]);
  });

  test('getPerformance keeps inter-event, service and matched gaps separate', () => {
    const results = engine.getPerformance(traces);
    expect(results).toMatchObject({ matchedPairs: 2, ambiguousPairs: 0, overlaps: 0 });
    expect(results.gaps.map(({ metricType, from, to, meanMin, n }) => [metricType, from, to, meanMin, n]))
      .toEqual([
        ['service', 'A', undefined, 4, 1], ['service', 'B', undefined, 4, 1],
        ['inter_event', 'A', 'A', 5, 1], ['inter_event', 'A', 'B', 7, 1],
        ['matched_gap', 'A', 'B', 3, 1], ['inter_event', 'B', 'C', 3, 1],
        ['inter_event', 'A', 'C', 20, 1],
      ]);
  });

  test('getResourceAnalysis separates coverage, workload, active time and directed edges', () => {
    expect(engine.getResourceAnalysis(traces)).toEqual({
      knownRawEvents: 7, totalRawEvents: 8, knownInstances: 5, totalInstances: 6,
      resources: [
        { resource: 'R1', rawEvents: 4, instances: 3, distinctCases: 2, activityCounts: { A: 2, C: 1 }, activeMin: 4, caseKeys: [firstCase, secondCase], roles: [] },
        { resource: 'R2', rawEvents: 3, instances: 2, distinctCases: 2, activityCounts: { A: 1, B: 1 }, activeMin: 4, caseKeys: [firstCase, secondCase], roles: [] },
      ],
      handoffs: [
        { from: 'R1', to: 'R2', count: 1, caseKeys: [firstCase] },
        { from: 'R2', to: 'R1', count: 1, caseKeys: [secondCase] },
      ],
    });
  });

  test('getKPIs calculates elapsed and explains unsupported utilization', () => {
    expect(metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'case_elapsed_mean', value: 17.5, unit: 'min', n: 2, eligible: 2 }),
      expect.objectContaining({ id: 'resource_utilization', value: null, n: 0, eligible: 2, reason: expect.any(String) }),
    ]));
  });

  test('getFindings links each rule to the measured scope and cases', () => {
    const analysis: FindingAnalysis = {
      scope, traces, metrics,
      dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces), resources: engine.getResourceAnalysis(traces),
    };
    const result = engine.getFindings(analysis, [target]);
    expect(result).toHaveLength(5);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope, metricId: 'inter_event', edge: { from: 'A', to: 'C' }, value: 20, n: 1, support: 'low', caseKeys: [secondCase] }),
      expect.objectContaining({ scope, metricId: 'rework_case_rate', value: 50, n: 2, caseKeys: [firstCase] }),
      expect.objectContaining({ scope, metricId: 'resource_instance_count', value: 3, n: 5, eligible: 6 }),
      expect.objectContaining({ scope, metricId: 'case_elapsed_mean', value: 17.5, n: 2, caseKeys: [firstCase, secondCase] }),
    ]));
    expect(engine.getFindings(analysis, [{ ...target, value: 18 }])).toHaveLength(4);
  });

  test('evaluateTargets checks both directions, equal bounds, unavailable metrics and units', () => {
    const result = engine.evaluateTargets(metrics, [
      target, { ...target, value: 17.5 }, { ...target, direction: 'min', value: 16 },
      { ...target, direction: 'min', value: 18 }, { ...target, unit: 'sec' },
      { ...target, metricId: 'resource_utilization', unit: '%' }, { ...target, metricId: 'manual' },
    ]);
    expect(result.map(evaluation => evaluation.status))
      .toEqual(['breached', 'met', 'met', 'breached', 'unknown', 'unknown', 'unknown']);
  });

  test('getGateInputs selects measured or assumed demand and includes rejected attempts', () => {
    const audience = { process_type: 'audience' };
    const data = tracesOf([
      row('01', 'Join Entry Queue', 0, audience),
      ...pair('01', 'Ticket Verification', 1, 2, audience),
      row('01', 'Entry Rejected', 3, audience),
      row('02', 'Join Entry Queue', 1, audience),
      row('03', 'Entry Complete', 6, audience),
    ]);
    const station = 'Ticket Verification';
    expect(engine.getGateInputs(data, { mode: 'observed', serviceActivity: station })).toEqual({
      eligibleCases: 3, inputs: [{ caseKey: key('01', 'audience'), arrivalMs: 0, sourceOrder: 0, serviceSec: 60 }],
      exclusions: [
        { caseKey: key('02', 'audience'), reason: 'missing_or_invalid_service' },
        { caseKey: key('03', 'audience'), reason: 'missing_arrival' },
      ],
    });
    expect(engine.getGateInputs(data, { mode: 'assumed', serviceActivity: station, serviceSec: 4 }))
      .toMatchObject({ eligibleCases: 3, inputs: [{ serviceSec: 4 }, { serviceSec: 4 }], exclusions: [{ reason: 'missing_arrival' }] });
  });

  test('simulateGateQueue computes wait, finish and throughput from arrival and service', () => {
    expect(engine.simulateGateQueue([{ caseKey: key('01', 'audience'), arrivalMs: 5000, serviceSec: 4, sourceOrder: 0 }], 1)).toEqual({
      count: 1, meanWaitMin: 0, p95WaitMin: 0, maxWaitMin: 0,
      finishElapsedMin: 4 / 60, throughputPerHour: 900, gateCount: 1,
    });
  });
});
