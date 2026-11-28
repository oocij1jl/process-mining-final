import Papa from 'papaparse';
import { describe, expect, test } from 'vitest';
import type { ImportOptions, Metric, RawRow, Target, Trace } from '../src/contracts';
import * as engine from '../src/engine';
import { instant, key, options, pair, row, tracesOf } from './engine-fixtures';

const scope = { datasetId: 'review-fixture', processKey: 'default', analysisFilterFingerprint: 'all' };
const audience = { process_type: 'audience' };
const stage = { process_type: 'stage' };
const festivalImportOptions: ImportOptions = {
  ...options, requireProcessType: true, mapping: { ...options.mapping, festival_id: 'festival_id' },
};
const audienceContext = { processKey: 'audience', festival: {}, throughput: { bucketMinutes: 10, anchorMs: 0 } };
const res = (resource: string) => ({ resource });
const metric = (metrics: readonly Metric[], id: string) => metrics.find(item => item.id === id)!;
const resourceKey = (...parts: string[]) => '@resource:' + JSON.stringify(parts);

function findings(traces: readonly Trace[], targets: readonly Target[], metrics = engine.getKPIs(traces, scope)) {
  const processKey = traces[0]?.processType ?? 'default';
  return engine.getFindings({
    scope: { ...scope, processKey }, traces, metrics,
    dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces),
    resources: engine.getResourceAnalysis(traces),
  }, targets);
}

const core = tracesOf([
  ...pair('014', 'Pack', 6, 7, { ...res('R2'), activity_instance_id: 'p1' }),
  ...pair('014', 'Cut', 0, 3, { ...res('R1'), activity_instance_id: 'c1' }),
  ...pair('014', 'Cut', 3, 4, { ...res('R1'), activity_instance_id: 'c2' }),
  row('014', 'Hold', 8),
  row('018', 'Cut', 10, res('R1')), row('018', 'Cut', 11, res('R1')),
  row('018', 'Pack', 20, res('R2')), row('018', 'Hold', 30, res('R3')),
  row('020', 'Cut', 15, res('R2')),
  row('030', 'Start Only', 40, { lifecycle: 'start' }),
]);

describe('Independent Phase 1 review cases', () => {
  test('Q01 maps a quoted CSV, preserves a leading zero and requires exclusion consent', () => {
    const source = [
      'ticket,step,clock,crew,status,team,notes',
      ' 009 ,"Check, left",2028-02-29T12:30:15.250+05:30,UNSET,,Blue,w1',
      '009,Next,2028-02-29T07:00:15.250Z,NONE,,Green,w2',
      '009,Date,2027-02-29T07:00:16Z,NONE,,,w3',
      ',Missing,2028-02-29T07:00:16Z,NONE,,,w4',
      '009,Status,2028-02-29T07:00:16Z,NONE,resume,,w5',
    ].join('\n');
    const parsed = Papa.parse<RawRow>(source, { header: true });
    expect(parsed.errors).toEqual([]);
    const mapped: ImportOptions = {
      mapping: { case_id: 'ticket', activity: 'step', timestamp: 'clock', resource: 'crew',
        lifecycle: 'status', resource_role: 'team' },
      missingResources: ['', 'UNSET'], acceptExclusions: false,
    };
    expect(engine.validateAndNormalize(parsed.data, mapped).canAnalyze).toBe(false);
    const result = engine.validateAndNormalize(parsed.data, { ...mapped, acceptExclusions: true });
    expect(result).toMatchObject({ canAnalyze: true, rawCount: 5, excludedCount: 3 });
    expect(result.events.map(event => [
      event.caseId, event.activity, new Date(event.timestampMs).toISOString(),
      event.resource, event.attrs.resource_role, event.attrs.notes, event.rawTimestamp,
    ])).toEqual([
      ['009', 'Check, left', '2028-02-29T07:00:15.250Z', null, 'Blue', 'w1', '2028-02-29T12:30:15.250+05:30'],
      ['009', 'Next', '2028-02-29T07:00:15.250Z', 'NONE', 'Green', 'w2', '2028-02-29T07:00:15.250Z'],
    ]);
    expect(result.issues.map(issue => [issue.row, issue.code])).toEqual([
      [0, 'trimmed_value'], [1, 'timestamp_tie'], [2, 'invalid_timestamp'],
      [3, 'missing_required'], [4, 'invalid_lifecycle'],
    ]);
  });

  test('Q02 sorts raw rows and retains a start-only case without a discovery sequence', () => {
    expect(core[0].caseKey).toBe('["default","014"]');
    expect(core[0].events.map(event => event.sourceOrder)).toEqual([2, 3, 4, 5, 0, 1, 6]);
    expect(core[0].sequence.map(event => event.activity)).toEqual(['Cut', 'Cut', 'Pack', 'Hold']);
    expect(core[3]).toMatchObject({ caseKey: '["default","030"]', events: [{ sourceOrder: 12 }], sequence: [] });
  });

  test('Q03 computes case-bounded DFG counts and repeat edges', () => {
    const dfg = engine.buildDFG(core);
    expect(dfg.nodes.map(({ activity, count }) => [activity, count])).toEqual([['Cut', 5], ['Pack', 2], ['Hold', 2]]);
    expect(dfg.edges.map(({ from, to, count }) => [from, to, count]))
      .toEqual([['Cut', 'Cut', 2], ['Cut', 'Pack', 2], ['Pack', 'Hold', 2]]);
    expect(dfg.starts).toEqual({ Cut: 3 });
    expect(dfg.ends).toEqual({ Hold: 2, Cut: 1 });
  });

  test('Q04 computes exact variants and duration across all accepted events', () => {
    expect(engine.getVariants(core)).toMatchObject([
      { id: '["Cut","Cut","Pack","Hold"]', count: 2, share: 2 / 3, avgElapsedMin: 14 },
      { id: '["Cut"]', count: 1, share: 1 / 3, avgElapsedMin: 0 },
    ]);
    expect(engine.getCaseDurations(core).map(item => item.elapsedMin)).toEqual([8, 20, 0, 0]);
    expect(metric(engine.getKPIs(core, scope), 'case_elapsed_mean').value).toBe(7);
  });

  test('Q05 separates exact-zero matched gap, inter-event gap and service', () => {
    const result = engine.getPerformance(core);
    expect(result).toMatchObject({ matchedPairs: 3, ambiguousPairs: 0, overlaps: 0 });
    expect(result.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricType: 'service', from: 'Cut', n: 2, meanMin: 2 }),
      expect.objectContaining({ metricType: 'matched_gap', from: 'Cut', to: 'Cut', meanMin: 0 }),
      expect.objectContaining({ metricType: 'matched_gap', from: 'Cut', to: 'Pack', meanMin: 2 }),
      expect.objectContaining({ metricType: 'inter_event', from: 'Cut', to: 'Pack', meanMin: 6 }),
      expect.objectContaining({ metricType: 'inter_event', from: 'Pack', to: 'Hold', meanMin: 5.5 }),
    ]));
  });

  test('Q06 separates raw, instance and active coverage and connects only adjacent known resources', () => {
    const result = engine.getResourceAnalysis(core);
    expect(result).toMatchObject({ knownRawEvents: 11, totalRawEvents: 13, knownInstances: 8, totalInstances: 9 });
    expect(result.resources.map(r => [r.resource, r.rawEvents, r.instances, r.distinctCases, r.activeMin]))
      .toEqual([['R1', 6, 4, 2, 4], ['R2', 4, 3, 3, 1], ['R3', 1, 1, 1, null]]);
    expect(result.handoffs).toEqual([
      { from: 'R1', to: 'R2', count: 2, caseKeys: [key('014'), key('018')],
      activityPairs: [{ from: 'Cut', to: 'Pack', count: 2, caseKeys: [key('014'), key('018')] }] },
      { from: 'R2', to: 'R3', count: 1, caseKeys: [key('018')],
      activityPairs: [{ from: 'Pack', to: 'Hold', count: 1, caseKeys: [key('018')] }] },
    ]);
  });

  test('Q07 ranks measured findings and preserves their independent numeric evidence', () => {
    const results = findings(core, [{ metricId: 'case_elapsed_mean', unit: 'min', direction: 'max', value: 6 }]);
    expect(results).toMatchObject([
      { metricId: 'inter_event', value: 6, n: 2, support: 'low' },
      { metricId: 'matched_gap', value: 2, n: 1, support: 'low' },
      { metricId: 'rework_case_rate', n: 3 },
      { metricId: 'resource_instance_count', value: 4, n: 8 },
      { metricId: 'case_elapsed_mean', value: 7, n: 4 },
    ]);
    expect(results[2].value).toBeCloseTo(200 / 3);
  });

  test('Q08 keeps unpaired discoveries and distinguishes reversed, ambiguous and zero-length pairs', () => {
    const result = engine.validateAndNormalize([
      row('LC', 'Retry', 0, { lifecycle: 'start' }), row('LC', 'Retry', 1, { lifecycle: 'start' }),
      row('LC', 'Retry', 2, { lifecycle: 'complete' }),
      ...pair('LC', 'Reverse', 8, 5, { activity_instance_id: 'z' }),
      ...pair('LC', 'Instant', 9, 9, { activity_instance_id: 'y' }),
      row('LC', 'Missing', 10, { lifecycle: 'start', activity_instance_id: 'x' }),
    ], options);
    expect(result.canAnalyze).toBe(true);
    expect(result.issues.map(issue => issue.code)).toEqual([
      'ambiguous_lifecycle', 'ambiguous_lifecycle', 'ambiguous_lifecycle',
      'negative_lifecycle_duration', 'negative_lifecycle_duration', 'timestamp_tie', 'missing_lifecycle_partner',
    ]);
    const traces = engine.groupCases(result.events);
    expect(traces[0].sequence.map(event => event.activity)).toEqual(['Retry', 'Reverse', 'Instant']);
    const performance = engine.getPerformance(traces);
    expect(performance).toMatchObject({ ambiguousPairs: 1, matchedPairs: 1 });
    expect(performance.gaps.filter(gap => gap.metricType === 'inter_event')).toHaveLength(2);
  });

  test('Q09 unions and clips each resource shift with an independent coverage denominator', () => {
    const traces = tracesOf([
      ...pair('U1', 'A', 0, 7, res('R7')), ...pair('U1', 'B', 3, 9, res('R7')),
      ...pair('U2', 'C', 2, 4, res('R8')),
      row('U3', 'D', 10, { resource: 'R7', lifecycle: 'start' }),
      row('U3', 'D', 11, { resource: 'R9', lifecycle: 'complete' }),
    ]);
    const shifts = [
      { resource: 'R7', startMs: 60_000, endMs: 300_000 },
      { resource: 'R7', startMs: 240_000, endMs: 480_000 },
      { resource: 'R7', startMs: 600_000, endMs: 720_000 },
      { resource: 'R8', startMs: 0, endMs: 360_000 },
    ];
    expect(engine.getResourceAnalysis(traces).resources.map(r => r.activeMin)).toEqual([9, 2, null]);
    const metrics = engine.getKPIs(traces, { ...scope, shifts });
    expect(metric(metrics, 'resource_utilization')).toMatchObject({ value: 60, n: 2, eligible: 3 });
    expect(metric(metrics, 'resource_out_of_shift_minutes').value).toBe(2);
    expect(engine.getPerformance(traces).overlaps).toBe(1);
  });

  test('Q10 links Stage and Equipment by both identifiers and filters unavailable lead times', () => {
    const f1 = { ...stage, festival_id: 'F-A', performance_id: 'P-4' };
    const f2 = { ...stage, festival_id: 'F-B', performance_id: 'P-4' };
    const e1 = { ...f1, process_type: 'equipment' };
    const e2 = { ...f2, process_type: 'equipment' };
    const traces = tracesOf([
      ...pair('SA', 'Stage Handover', 1, 2, f1), row('SA', 'Technical Recheck', 3, f1),
      row('SA', 'Stage Ready', 6, { ...f1, scheduled_start: instant(6) }),
      row('SA', 'Stage Setup', 8, { ...f1, lifecycle: 'start' }),
      row('SB', 'Stage Ready', 21, { ...f2, scheduled_start: instant(20) }),
      row('SB', 'Stage Setup', 24, { ...f2, lifecycle: 'start' }),
      row('E1', 'Equipment Requested', 5, e1), row('E1', 'Substitute Search', 6, e1), row('E1', 'Equipment Ready', 10, e1),
      row('E2', 'Equipment Requested', 19, e2), row('E2', 'Inspection Rework', 20, e2), row('E2', 'Equipment Ready', 22, e2),
      row('E3', 'Equipment Requested', 40, { ...e1, festival_id: 'F-Z' }),
    ]);
    const stages = traces.filter(trace => trace.processType === 'stage');
    const stageMetrics = engine.getKPIs(stages, { processKey: 'stage', festival: {} });
    expect(metric(stageMetrics, 'stage_preparation_mean').value).toBe(5);
    expect(metric(stageMetrics, 'stage_on_time_rate').value).toBe(50);
    expect(metric(stageMetrics, 'stage_recheck_rate').value).toBe(50);
    const equipmentMetrics = engine.getKPIs(traces.filter(trace => trace.processType === 'equipment'), {
      processKey: 'equipment', festival: { linkedStageTraces: stages, equipmentDeadline: 'linked_stage_setup_start' },
    });
    expect(metric(equipmentMetrics, 'equipment_lead_time_mean').value).toBe(4);
    expect(metric(equipmentMetrics, 'equipment_substitution_rate').value).toBeCloseTo(100 / 3);
    expect(metric(equipmentMetrics, 'equipment_inspection_rework_rate').value).toBeCloseTo(100 / 3);
    expect(metric(equipmentMetrics, 'equipment_unmatched_performance_count').value).toBe(1);
    expect(metric(equipmentMetrics, 'equipment_on_time_rate').value).toBe(50);
  });

  test('Q11 calculates observed Audience measurements and tests normal direction, unit and N/A', () => {
    const traces = tracesOf([
      row('AQ1', 'Join Entry Queue', 1, audience), ...pair('AQ1', 'Ticket Verification', 3, 4, audience),
      row('AQ1', 'Entry Complete', 8, audience), row('AQ2', 'Join Entry Queue', 7, audience),
      ...pair('AQ2', 'Ticket Verification', 12, 13, audience), row('AQ2', 'Manual Ticket Check', 14, audience),
      row('AQ2', 'Entry Rejected', 15, audience),
    ]);
    const metrics = engine.getKPIs(traces, audienceContext);
    const target = { metricId: 'audience_queue_wait_mean', unit: 'min', direction: 'max', value: 3.5 } as const;
    expect(metric(metrics, target.metricId).value).toBe(3.5);
    expect(metric(metrics, 'audience_entry_elapsed_mean').value).toBe(7);
    expect(metric(metrics, 'audience_manual_verification_rate').value).toBe(50);
    expect(metric(metrics, 'audience_rejected_rate')).toMatchObject({ value: 50, n: 2 });
    expect(engine.evaluateTargets(metrics, [
      target, { ...target, direction: 'min', value: 4 }, { ...target, unit: 's' },
      { ...target, metricId: 'resource_utilization', unit: '%' },
    ]).map(result => result.status)).toEqual(['met', 'breached', 'unknown', 'unknown']);
  });

  test('Q12 admits rejected attempts with service evidence and accounts for missing inputs', () => {
    const traces = tracesOf([
      row('AQ1', 'Join Entry Queue', 2, audience), ...pair('AQ1', 'Ticket Verification', 5, 6, audience),
      row('AQ1', 'Entry Rejected', 7, audience), row('AQ2', 'Join Entry Queue', 3, audience),
      row('AQ2', 'Ticket Verification', 4, audience), row('AQ3', 'Entry Complete', 8, audience),
    ]);
    expect(engine.getGateInputs(traces, { mode: 'observed', serviceActivity: 'Ticket Verification' })).toMatchObject({
      eligibleCases: 3, inputs: [{ caseKey: key('AQ1', 'audience'), serviceSec: 60 }],
      exclusions: [
        { caseKey: key('AQ2', 'audience'), reason: 'missing_or_invalid_service' },
        { caseKey: key('AQ3', 'audience'), reason: 'missing_arrival' },
      ],
    });
    expect(engine.getGateInputs(traces, { mode: 'assumed', serviceActivity: 'Ticket Verification', serviceSec: 17 }).inputs)
      .toMatchObject([{ caseKey: key('AQ1', 'audience'), serviceSec: 17 }, { caseKey: key('AQ2', 'audience'), serviceSec: 17 }]);
  });

  test('Q13 schedules two and three gates with variable durations and tied arrivals', () => {
    const inputs = [[10, 6, 6], [2, 7, 3], [0, 5, 1], [10, 4, 5], [3, 2, 4], [0, 8, 0], [1, 3, 2]]
      .map(([time, serviceSec, sourceOrder]) => ({ arrivalMs: 1_800_000_000_000 + time * 1000, serviceSec, sourceOrder, caseKey: String(sourceOrder) }));
    const two = engine.simulateGateQueue(inputs, 2);
    const three = engine.simulateGateQueue(inputs, 3);
    expect(two).toMatchObject({ p95WaitMin: 6 / 60, maxWaitMin: 6 / 60, finishElapsedMin: 20 / 60, throughputPerHour: 1260 });
    expect(three).toMatchObject({ p95WaitMin: 2 / 60, maxWaitMin: 2 / 60, finishElapsedMin: 16 / 60, throughputPerHour: 1575 });
    expect(two.meanWaitMin * 60).toBeCloseTo(19 / 7);
    expect(three.meanWaitMin * 60).toBeCloseTo(4 / 7);
  });

  test('Q14 returns an internal empty bucket and uses it in the average', () => {
    const traces = tracesOf([row('A1', 'Entry Complete', 4, audience), row('A2', 'Entry Complete', 23, audience)]);
    const throughput = metric(engine.getKPIs(traces, audienceContext), 'audience_throughput');
    expect(throughput).toMatchObject({ value: 2 / 3, n: 2, eligible: 2 });
    expect(throughput.buckets).toEqual([
      { startMs: 0, endMs: 600_000, count: 1, caseKeys: [key('A1', 'audience')] },
      { startMs: 600_000, endMs: 1_200_000, count: 0, caseKeys: [] },
      { startMs: 1_200_000, endMs: 1_800_000, count: 1, caseKeys: [key('A2', 'audience')] },
    ]);
    expect(throughput.definition).toContain('log observation span');
  });

  test('Q15 distinguishes recorded zero completions from unavailable coverage', () => {
    const rejected = tracesOf([row('A1', 'Join Entry Queue', 1, audience), row('A1', 'Entry Rejected', 4, audience)]);
    expect(metric(engine.getKPIs(rejected, audienceContext), 'audience_throughput')).toMatchObject({
      value: 0, n: 0, eligible: 1, buckets: [{ startMs: 0, endMs: 600_000, count: 0, caseKeys: [] }],
    });
    const unobserved = tracesOf([row('A1', 'Other Activity', 3, audience)]);
    expect(metric(engine.getKPIs(unobserved, audienceContext), 'audience_throughput'))
      .toMatchObject({ value: null, reason: expect.any(String), buckets: [] });
  });

  test('Q16 keeps distinct festivals’ local resource nodes and busy intervals separate', () => {
    const traces = tracesOf([
      ...pair('F1-case', 'Load', 0, 10, { resource: 'Local Crew', resource_role: 'Sound', festival_id: 'F1' }),
      ...pair('F2-case', 'Load', 5, 10, { resource: 'Local Crew', resource_role: 'Lighting', festival_id: 'F2' }),
    ]);
    const analysis = engine.getResourceAnalysis(traces);
    expect(analysis.resources).toMatchObject([
      { resource: resourceKey('festival', 'F1', 'Local Crew'), distinctCases: 1, activeMin: 10, roles: ['Sound'], caseKeys: [key('F1-case')] },
      { resource: resourceKey('festival', 'F2', 'Local Crew'), distinctCases: 1, activeMin: 5, roles: ['Lighting'], caseKeys: [key('F2-case')] },
    ]);
    expect(analysis.resources.reduce((total, resource) => total + (resource.activeMin ?? 0), 0)).toBe(15);
  });

  test('Q17 treats true target equality alike for max/min and detects real nearby differences', () => {
    const traces = tracesOf(Array.from({ length: 25 }, (_, i) => row(
      'R' + i, i < 7 ? 'Technical Recheck' : 'Stage Ready', i, stage,
    )));
    const metrics = engine.getKPIs(traces, { processKey: 'stage', festival: {} });
    const metricId = 'stage_recheck_rate';
    expect(metric(metrics, metricId).value).toBe(28);
    const target = { metricId, unit: '%', value: 28, direction: 'max' } as const;
    expect(engine.evaluateTargets(metrics, [
      target, { ...target, direction: 'min' },
      { ...target, value: 28 - 1e-12 }, { ...target, direction: 'min', value: 28 + 1e-12 },
    ]).map(result => result.status)).toEqual(['met', 'met', 'breached', 'breached']);

    const base = { ...metric(metrics, metricId), value: 0.1 + 0.2 };
    expect(engine.evaluateTargets([base], [
      { ...target, value: 0.3 }, { ...target, value: 0.3, direction: 'min' },
    ]).map(result => result.status)).toEqual(['met', 'met']);
    expect(engine.evaluateTargets([{ ...base, value: 1e-15 }], [{ ...target, value: 0 }])[0].status).toBe('breached');
  });

  test('Q18 keeps the valid late case in a 0% minimum-target breach', () => {
    const traces = tracesOf([row('Late', 'Stage Ready', 18, { ...stage, scheduled_start: instant(12) })]);
    const metrics = engine.getKPIs(traces, { processKey: 'stage', festival: {} });
    expect(metric(metrics, 'stage_on_time_rate')).toMatchObject({ value: 0, n: 1, caseKeys: [] });
    const result = findings(traces, [
      { metricId: 'stage_on_time_rate', direction: 'min', unit: '%', value: 80 },
    ], metrics);
    expect(result).toMatchObject([{ metricId: 'stage_on_time_rate', value: 0, n: 1, caseKeys: [key('Late', 'stage')] }]);
  });

  test('Q19 uses completed-instance evidence while keeping raw graph evidence complete', () => {
    const traces = tracesOf([
      row('Finished', 'Done', 5, res('R7')),
      row('Started', 'Work', 8, { ...res('R7'), lifecycle: 'start' }),
    ]);
    expect(engine.getResourceAnalysis(traces).resources[0]).toMatchObject({
      rawEvents: 2, instances: 1, caseKeys: [key('Finished'), key('Started')],
    });
    expect(findings(traces, []).find(finding => finding.metricId === 'resource_instance_count'))
      .toMatchObject({ value: 1, caseKeys: [key('Finished')] });
    expect(findings([traces[1]], []).find(finding => finding.metricId === 'resource_raw_event_count'))
      .toMatchObject({ value: 1, caseKeys: [key('Started')] });
  });

  test('Q20 prevents decimal accumulation artifacts and preserves a real sub-millisecond wait', () => {
    const inputs = [[0, 0.1], [100, 0.2], [300, 0.05]].map(([arrivalMs, serviceSec], sourceOrder) =>
      ({ arrivalMs, serviceSec, sourceOrder, caseKey: String(sourceOrder) }));
    expect(engine.simulateGateQueue(inputs, 1)).toMatchObject({
      meanWaitMin: 0, p95WaitMin: 0, maxWaitMin: 0, finishElapsedMin: 0.35 / 60,
    });
    const genuine = engine.simulateGateQueue([{ ...inputs[0], serviceSec: 0.1000001 }, inputs[1]], 1);
    expect(genuine.maxWaitMin).toBe(0.0000001 / 60);
    expect(genuine.p95WaitMin).toBe(0.0000001 / 60);
  });

  test('Q21 warns on pre-arrival scan and rejection, preserves raw rows and excludes invalid KPI evidence', () => {
    const source = [
      row('A1', 'Join Entry Queue', 11, audience), ...pair('A1', 'Ticket Verification', 8, 9, audience),
      row('A1', 'Entry Rejected', 10, audience),
    ];
    const imported = engine.validateAndNormalize(source, festivalImportOptions);
    expect(imported).toMatchObject({ canAnalyze: true, rawCount: 4, excludedCount: 0 });
    expect(imported.events.map(event => [event.sourceOrder, event.rawTimestamp])).toEqual([
      [0, instant(11)], [1, instant(8)], [2, instant(9)], [3, instant(10)],
    ]);
    expect(imported.issues.map(issue => [issue.row, issue.severity, issue.code])).toEqual([
      [1, 'warning', 'audience_event_before_arrival'],
      [2, 'warning', 'audience_event_before_arrival'],
      [3, 'warning', 'audience_event_before_arrival'],
    ]);
    const metrics = engine.getKPIs(engine.groupCases(imported.events), audienceContext);
    expect(metric(metrics, 'audience_queue_wait_mean')).toMatchObject({ n: 0, eligible: 1, value: null });
    expect(metric(metrics, 'audience_rejected_rate')).toMatchObject({ n: 0, eligible: 1, value: null });
    expect(metric(metrics, 'audience_completed_rate')).toMatchObject({ n: 0, eligible: 1, value: null });
  });

  test('Q22 keeps delimiter-like keys distinct and rejects mixed DFG', () => {
    const traces = tracesOf([
      row('z', 'A', 0, { process_type: 'x","y' }), row('y","z', 'B', 0, { process_type: 'x' }),
    ]);
    expect(traces.map(trace => JSON.parse(trace.caseKey))).toEqual([['x","y', 'z'], ['x', 'y","z']]);
    expect(() => engine.buildDFG(traces)).toThrow(RangeError);
  });

  test('Q23 rejects empty vectors and invalid gate/time inputs', () => {
    const input = { arrivalMs: 15, serviceSec: 1, sourceOrder: 0, caseKey: 'p' };
    expect(() => engine.simulateGateQueue([], 1)).toThrow(RangeError);
    expect(() => engine.simulateGateQueue([input], 0)).toThrow(RangeError);
    expect(() => engine.simulateGateQueue([input], 2.75)).toThrow(RangeError);
    expect(() => engine.simulateGateQueue([{ ...input, arrivalMs: NaN }], 2)).toThrow(RangeError);
  });
});

test('local, shared and unscoped identities are consistent across handoffs, findings and shifts', () => {
  const north = { resource: 'Local Crew', festival_id: 'North' };
  const south = { resource: 'Local Crew', festival_id: 'South' };
  const northShared = { ...north, resource: 'Crew Display A', resource_id: 'crew-9' };
  const southShared = { ...south, resource: 'Crew Display B', resource_id: 'crew-9' };
  const traces = tracesOf([
    ...pair('N1', 'Local Job', 0, 10, north),
    ...pair('N1', 'Shared Job', 12, 16, northShared),
    row('N2', 'Other Job', 8, { ...north, lifecycle: 'start' }),
    row('N2', 'Other Job', 12, { resource: 'Local Crew', lifecycle: 'complete' }),
    ...pair('S1', 'Local Job', 5, 10, south),
    ...pair('S1', 'Shared Job', 14, 18, southShared),
    row('S1', 'Return', 19, south),
  ]);
  const localNorth = resourceKey('festival', 'North', 'Local Crew');
  const localSouth = resourceKey('festival', 'South', 'Local Crew');
  const shared = resourceKey('shared', 'crew-9');
  const analysis = engine.getResourceAnalysis(traces);
  expect(analysis.resources).toMatchObject([
    { resource: localNorth, activeMin: 12, instances: 2, caseKeys: [key('N1'), key('N2')] },
    { resource: shared, activeMin: 6, instances: 2, caseKeys: [key('N1'), key('S1')] },
    { resource: localSouth, activeMin: 5, instances: 2, caseKeys: [key('S1')] },
  ]);
  expect(analysis.handoffs).toEqual([
    { from: localNorth, to: shared, count: 1, caseKeys: [key('N1')],
      activityPairs: [{ from: 'Local Job', to: 'Shared Job', count: 1, caseKeys: [key('N1')] }] },
    { from: localSouth, to: shared, count: 1, caseKeys: [key('S1')],
      activityPairs: [{ from: 'Local Job', to: 'Shared Job', count: 1, caseKeys: [key('S1')] }] },
    { from: shared, to: localSouth, count: 1, caseKeys: [key('S1')],
      activityPairs: [{ from: 'Shared Job', to: 'Return', count: 1, caseKeys: [key('S1')] }] },
  ]);

  const shifts = [
    { resource: localNorth, startMs: 0, endMs: 1_200_000 },
    { resource: localSouth, startMs: 300_000, endMs: 900_000 },
    { resource: shared, startMs: 600_000, endMs: 1_200_000 },
    { resource: 'Local Crew', startMs: 0, endMs: 600_000 },
  ];
  const kpis = engine.getKPIs(traces, { ...scope, shifts });
  expect(metric(kpis, 'resource_utilization')).toMatchObject({ value: 57.5, n: 3, eligible: 3 });
  expect(metric(kpis, 'resource_out_of_shift_minutes').value).toBe(0);
  expect(metric(engine.getKPIs(traces, { ...scope, shifts: shifts.slice(-1) }), 'resource_utilization'))
    .toMatchObject({ value: null, n: 0, eligible: 3 });
  expect(findings(traces, []).find(f => f.metricId === 'resource_instance_count')?.caseKeys)
    .toEqual([key('N1'), key('N2')]);

  const literal = tracesOf([row('O1', 'Pack', 0, res(localNorth)), row('O2', 'Pack', 1, res('Local Crew'))]);
  expect(engine.getResourceAnalysis(literal).resources.map(item => item.resource))
    .toEqual([resourceKey('literal', localNorth), 'Local Crew']);
});

test('minimum rate evidence excludes successes and unknowns while maximum evidence links the positive condition', () => {
  const traces = tracesOf([
    row('OnTime', 'Stage Ready', 10, { ...stage, scheduled_start: instant(10) }),
    row('Late', 'Stage Ready', 15, { ...stage, scheduled_start: instant(12) }),
    row('Late', 'Technical Recheck', 12, stage),
    row('Unknown', 'Stage Ready', 20, stage),
  ]);
  const metrics = engine.getKPIs(traces, { processKey: 'stage', festival: {} });
  const output = findings(traces, [
    { metricId: 'stage_on_time_rate', value: 90, unit: '%', direction: 'min' },
    { metricId: 'stage_recheck_rate', value: 5, unit: '%', direction: 'max' },
  ], metrics).filter(finding => finding.metricId.startsWith('stage_'));
  expect(output).toMatchObject([
    { metricId: 'stage_on_time_rate', n: 2, eligible: 3, caseKeys: [key('Late', 'stage')] },
    { metricId: 'stage_recheck_rate', n: 3, eligible: 3, caseKeys: [key('Late', 'stage')] },
  ]);
  expect(metric(metrics, 'stage_on_time_rate').caseKeys).toEqual([key('OnTime', 'stage')]);
});

test('Audience timing is opt-in, and missing markers differ from contradictory outcomes', () => {
  const source = [
    row('Bad', 'Join Entry Queue', 9, audience), row('Bad', 'Entry Rejected', 8, audience),
    row('Missing', 'Entry Rejected', 5, audience),
    row('Conflict', 'Join Entry Queue', 1, audience),
    row('Conflict', 'Entry Complete', 2, audience), row('Conflict', 'Entry Rejected', 3, audience),
  ];
  const generic = engine.validateAndNormalize(source, options);
  const requiredProcessOnly = engine.validateAndNormalize(source, { ...options, requireProcessType: true });
  expect(generic.issues).toEqual([]);
  expect(requiredProcessOnly.issues).toEqual([]);
  const genericKPIs = engine.getKPIs(engine.groupCases(generic.events), { processKey: 'audience' });
  expect(genericKPIs.map(item => item.id))
    .toEqual(['case_elapsed_mean', 'resource_utilization', 'resource_out_of_shift_minutes']);
  expect(findings(engine.groupCases(generic.events), [], genericKPIs).some(item => item.metricId.startsWith('audience_')))
    .toBe(false);

  const enabled = engine.validateAndNormalize(source, festivalImportOptions);
  expect(enabled.issues.map(issue => [issue.row, issue.code])).toEqual([
    [1, 'audience_event_before_arrival'], [4, 'conflicting_entry_outcome'], [5, 'conflicting_entry_outcome'],
  ]);
  expect(metric(engine.getKPIs(engine.groupCases(enabled.events), audienceContext), 'audience_rejected_count'))
    .toMatchObject({ value: 1, n: 1, eligible: 3, caseKeys: [key('Missing', 'audience')] });
});

test('log buckets start at the first valid row, handle a nonzero anchor, and reject oversized series', () => {
  const traces = tracesOf([
    row('A', 'Join Entry Queue', 1, audience),
    row('A', 'Ticket Verification', 7, audience),
    row('A', 'Entry Complete', 12, audience),
    row('B', 'Join Entry Queue', 14, audience),
    row('B', 'Entry Rejected', 34, audience),
  ]);
  const throughput = { bucketMinutes: 10, anchorMs: 120_000 };
  const observed = metric(engine.getKPIs(traces, { ...audienceContext, throughput }), 'audience_throughput');
  expect(observed.value).toBe(1 / 5);
  expect(observed.buckets?.map(bucket => [bucket.startMs / 60_000, bucket.count]))
    .toEqual([[-8, 0], [2, 0], [12, 1], [22, 0], [32, 0]]);
  const large = tracesOf([row('C', 'Entry Complete', 0, audience), row('D', 'Entry Complete', 100_000, audience)]);
  expect(metric(engine.getKPIs(large, {
    ...audienceContext, throughput: { anchorMs: 0, bucketMinutes: 1 },
  }), 'audience_throughput')).toMatchObject({ value: null, buckets: [], reason: expect.any(String) });
});
