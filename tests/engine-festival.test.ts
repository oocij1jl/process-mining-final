import { expect, test } from 'vitest';
import type { Metric } from '../src/contracts';
import * as engine from '../src/engine';
import { instant, key, options, pair, row, tracesOf } from './engine-fixtures';

const byId = (metrics: readonly Metric[], id: string) => metrics.find(metric => metric.id === id);

test('stage separates prep from full performance and requires an explicit handover fallback', () => {
  const stage = { process_type: 'stage' };
  const traces = tracesOf([
    ...pair('S1', 'Stage Handover', 0, 2, stage),
    row('S1', 'Technical Recheck', 8, stage),
    row('S1', 'Stage Ready', 10, { ...stage, scheduled_start: instant(10), lifecycle: 'complete' }),
    row('S1', 'Performance End', 60, stage),
    row('S2', 'Stage Handover', 100, stage),
    row('S2', 'Configured Check', 105, stage),
    row('S2', 'Other Activity', 106, stage),
    row('S2', 'Configured Check', 110, stage),
    row('S2', 'Stage Ready', 120, { ...stage, scheduled_start: instant(110) }),
    row('S3', 'Stage Ready', 150, { ...stage, scheduled_start: '2026-02-30T00:00:00Z' }),
  ]);
  const context = { processKey: 'stage', festival: { technicalCheckRepeatActivity: 'Configured Check' } };
  const metrics = engine.getKPIs(traces, context);
  expect(byId(metrics, 'case_elapsed_mean')?.value).toBeCloseTo(80 / 3);
  expect(byId(metrics, 'stage_preparation_mean')).toMatchObject({ value: 10, n: 1, eligible: 3, caseKeys: [key('S1', 'stage')] });
  expect(byId(metrics, 'stage_on_time_rate')).toMatchObject({ value: 50, n: 2, eligible: 3, caseKeys: [key('S1', 'stage')] });
  expect(byId(metrics, 'stage_recheck_rate')?.value).toBeCloseTo(200 / 3);
  const fallback = { ...context, festival: { ...context.festival, stageHandoverPointFallback: true } };
  expect(byId(engine.getKPIs(traces, fallback), 'stage_preparation_mean')).toMatchObject({ value: 15, n: 2, eligible: 3 });
  expect(byId(engine.getKPIs(traces, { processKey: 'stage' }), 'stage_preparation_mean')).toBeUndefined();
});

test('equipment compares explicit deadlines or joins scoped stages by both linkage keys', () => {
  const stage = { process_type: 'stage', festival_id: 'F1', performance_id: 'P1' };
  const stages = tracesOf([
    row('S1', 'Stage Setup', 10, { ...stage, lifecycle: 'start' }),
    row('S2', 'Stage Setup', 30, { ...stage, festival_id: 'F2', lifecycle: 'start' }),
  ]);
  const equipment = { ...stage, process_type: 'equipment' };
  const traces = tracesOf([
    row('E1', 'Equipment Requested', 0, equipment),
    row('E1', 'Substitute Search', 5, equipment),
    row('E1', 'Equipment Ready', 12, { ...equipment, required_ready_at: instant(14) }),
    row('E2', 'Equipment Requested', 10, { ...equipment, festival_id: 'F2' }),
    row('E2', 'Inspection Rework', 15, { ...equipment, festival_id: 'F2' }),
    row('E2', 'Equipment Ready', 20, { ...equipment, festival_id: 'F2' }),
    row('E3', 'Equipment Requested', 10, { ...equipment, festival_id: 'F3' }),
    row('E3', 'Equipment Ready', 15, { ...equipment, festival_id: 'F3' }),
  ]);
  const context = { processKey: 'equipment', festival: { linkedStageTraces: stages } };
  const explicit = engine.getKPIs(traces, context);
  expect(byId(explicit, 'equipment_lead_time_mean')?.value).toBe(9);
  expect(byId(explicit, 'equipment_substitution_rate')?.value).toBeCloseTo(100 / 3);
  expect(byId(explicit, 'equipment_inspection_rework_rate')?.value).toBeCloseTo(100 / 3);
  expect(byId(explicit, 'equipment_on_time_rate')).toMatchObject({ value: 100, n: 1, eligible: 3, caseKeys: [key('E1', 'equipment')] });
  expect(byId(explicit, 'equipment_unmatched_performance_count')).toMatchObject({ value: 1, n: 3, caseKeys: [key('E3', 'equipment')] });

  const linked = engine.getKPIs(traces, {
    ...context, festival: { ...context.festival, equipmentDeadline: 'linked_stage_setup_start' },
  });
  expect(byId(linked, 'equipment_on_time_rate')).toMatchObject({ value: 50, n: 2, eligible: 3, caseKeys: [key('E2', 'equipment')] });
  const stageView = engine.getKPIs([stages[1]], {
    processKey: 'stage', festival: { linkedEquipmentTraces: traces, equipmentDeadline: 'linked_stage_setup_start' },
  });
  expect(byId(stageView, 'equipment_on_time_rate')).toMatchObject({ value: 100, n: 1, eligible: 1, caseKeys: [key('E2', 'equipment')] });
  const ambiguous = engine.getKPIs(traces, {
    ...context, festival: {
      equipmentDeadline: 'linked_stage_setup_start',
      linkedStageTraces: [...stages, ...tracesOf([row('S3', 'Stage Setup', 15, { ...stage, lifecycle: 'start' })])],
    },
  });
  expect(byId(ambiguous, 'equipment_on_time_rate')).toMatchObject({ value: 100, n: 1, eligible: 3 });
  expect(byId(ambiguous, 'equipment_unmatched_performance_count')).toMatchObject({ value: 2 });
});

test('audience uses observed timings, known outcomes and anchored throughput boundaries', () => {
  const audience = { process_type: 'audience' };
  const imported = engine.validateAndNormalize([
    row('A1', 'Join Entry Queue', 0, audience),
    ...pair('A1', 'Ticket Verification', 8, 9, audience),
    row('A1', 'Entry Complete', 10, audience),
    row('A2', 'Join Entry Queue', 10, audience),
    ...pair('A2', 'Ticket Verification', 18, 19, audience),
    row('A2', 'Manual Ticket Check', 20, audience),
    row('A2', 'Entry Rejected', 21, audience),
    row('A3', 'Join Entry Queue', 40, audience),
    row('A3', 'Entry Complete', 50, audience),
    row('A4', 'Waiting', 20, audience),
    ...pair('A5', 'Ticket Verification', 40, 46, audience),
    row('A5', 'Entry Complete', 45, audience),
  ], { ...options, requireProcessType: true, mapping: { ...options.mapping, festival_id: 'festival_id' } });
  expect(imported.issues.map(issue => issue.code)).toContain('entry_before_scan');
  const traces = engine.groupCases(imported.events);
  const context = { processKey: 'audience', festival: {}, throughput: { anchorMs: 0, bucketMinutes: 10 } };
  const metrics = engine.getKPIs(traces, context);
  expect(byId(metrics, 'audience_queue_wait_mean')).toMatchObject({ value: 8, n: 2, eligible: 5 });
  expect(byId(metrics, 'audience_entry_elapsed_mean')).toMatchObject({ value: 10, n: 2, eligible: 2 });
  expect(byId(metrics, 'audience_manual_verification_rate')).toMatchObject({ value: 20, n: 5 });
  expect(byId(metrics, 'audience_rejected_count')).toMatchObject({ value: 1, n: 3, eligible: 5 });
  expect(byId(metrics, 'audience_rejected_rate')?.value).toBeCloseTo(100 / 3);
  expect(byId(metrics, 'audience_completed_count')).toMatchObject({ value: 2, n: 3, eligible: 5 });
  expect(byId(metrics, 'audience_throughput')).toMatchObject({
    value: 2 / 6, n: 2, eligible: 5,
    buckets: [
      { startMs: 0, endMs: 600_000, count: 0, caseKeys: [] },
      { startMs: 600_000, endMs: 1_200_000, count: 1, caseKeys: [key('A1', 'audience')] },
      { startMs: 1_200_000, endMs: 1_800_000, count: 0, caseKeys: [] },
      { startMs: 1_800_000, endMs: 2_400_000, count: 0, caseKeys: [] },
      { startMs: 2_400_000, endMs: 3_000_000, count: 0, caseKeys: [] },
      { startMs: 3_000_000, endMs: 3_600_000, count: 1, caseKeys: [key('A3', 'audience')] },
    ],
  });
  expect(byId(engine.getKPIs(traces, { ...context, throughput: { anchorMs: 0, bucketMinutes: 0 } }), 'audience_throughput'))
    .toMatchObject({ value: null, n: 0, reason: expect.any(String) });

  const target = { metricId: 'audience_queue_wait_mean', unit: 'min', direction: 'max' } as const;
  expect(engine.evaluateTargets(metrics, [{ ...target, value: 5 }, { ...target, value: 10 }]).map(result => result.status))
    .toEqual(['breached', 'met']);
  expect(byId(metrics, target.metricId)?.value).toBe(8);
});

test('observed gate inputs require a positive post-arrival match for the named activity', () => {
  const audience = { process_type: 'audience' };
  const traces = tracesOf([
    row('A1', 'Join Entry Queue', 5, audience),
    ...pair('A1', 'Ticket Verification', 1, 2, { ...audience, activity_instance_id: 'pre' }),
    ...pair('A1', 'Ticket Verification', 8, 8, { ...audience, activity_instance_id: 'zero' }),
    ...pair('A1', 'Ticket Verification', 9, 11, { ...audience, activity_instance_id: 'first-valid' }),
    ...pair('A1', 'Ticket Verification', 12, 15, { ...audience, activity_instance_id: 'second-valid' }),
    row('A2', 'Join Entry Queue', 0, audience),
    ...pair('A2', 'Manual Ticket Check', 1, 5, audience),
    row('A3', 'Join Entry Queue', 1),
  ]);
  expect(engine.getGateInputs(traces, { mode: 'observed', serviceActivity: 'Ticket Verification' })).toEqual({
    eligibleCases: 2,
    inputs: [{ caseKey: key('A1', 'audience'), arrivalMs: 300_000, sourceOrder: 0, serviceSec: 120 }],
    exclusions: [{ caseKey: key('A2', 'audience'), reason: 'missing_or_invalid_service' }],
  });
  expect(() => engine.getGateInputs(traces, { mode: 'assumed', serviceActivity: 'Ticket Verification', serviceSec: -1 }))
    .toThrow(RangeError);
});

test('changed parsed data recomputes findings and generic input keeps unsupported KPIs null', () => {
  const compute = (changedMin: number, fingerprint: string) => {
    const traces = tracesOf([row('001', 'Check', 0), row('001', 'Other', 1), row('001', 'Check', changedMin)]);
    const scope = { datasetId: 'test', processKey: 'default', analysisFilterFingerprint: fingerprint };
    const metrics = engine.getKPIs(traces, scope);
    const findings = engine.getFindings({
      scope, traces, metrics, dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces),
      resources: engine.getResourceAnalysis(traces), rework: { repeatedActivities: ['Check'], explicitActivities: [] },
    }, []);
    return { metrics, findings };
  };
  const first = compute(10, 'first');
  const second = compute(20, 'second');
  expect(first.findings[0]).toMatchObject({ value: 9 });
  expect(second.findings[0]).toMatchObject({ value: 19, scope: { analysisFilterFingerprint: 'second' } });
  expect(second.findings[1]).toMatchObject({ metricId: 'rework_case_rate', value: 100, caseKeys: [key('001')] });
  expect(second.metrics.map(metric => metric.id)).toEqual(['case_elapsed_mean', 'resource_utilization', 'resource_out_of_shift_minutes']);
  expect(byId(second.metrics, 'resource_utilization')).toMatchObject({ value: null, reason: expect.any(String) });
  const emptyEquipment = engine.getKPIs([], { processKey: 'equipment', festival: {} });
  expect(emptyEquipment.map(metric => metric.id)).toEqual([
    'case_elapsed_mean', 'resource_utilization', 'resource_out_of_shift_minutes',
    'equipment_lead_time_mean', 'equipment_substitution_rate', 'equipment_inspection_rework_rate',
    'equipment_on_time_rate', 'equipment_unmatched_performance_count',
  ]);
  for (const metric of emptyEquipment) {
    expect(metric).toMatchObject({ value: null, n: 0, eligible: 0, reason: expect.any(String) });
    expect(metric.reason).not.toBe('');
  }
});
