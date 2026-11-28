/**
 * Phase 2 integration regression tests: UI ingestion helpers → src/engine.
 *
 * Every expected value below was calculated by hand from the CSV rows (see
 * tests/fixtures/integration/README.md and reports/evidence/phase-2-integration.md).
 * No expected value was copied from engine output.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_MISSING_RESOURCES, type ColumnMapping, type KPIContext, type Metric, type Target, type Trace } from '../../src/contracts';
import * as engine from '../../src/engine';
import { engineRows, parseCsv } from '../../src/lib/files';
import { displayResourceKeys, resourceLabel } from '../../src/lib/format';
import { targetBreachFinding } from '../../src/lib/evidence';
import { importOptionsFor } from '../../src/state/analysis';
import { DEFAULT_FESTIVAL_SETTINGS, festivalKpiConfig, festivalRework } from '../../src/festival/adapter';
import type { DatasetState } from '../../src/state/types';

const MIN = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const key = (process: string, id: string) => JSON.stringify([process, id]);

/** Mirrors OverviewPage.commit → AnalysisProvider: parse, structural check, UI import options, engine. */
function load(text: string, mapping: Record<string, string>, over: Partial<DatasetState> = {}) {
  const parsed = parseCsv(text);
  const { rows, rowMap } = engineRows(parsed);
  const dataset = {
    rows, rowMap, mapping: mapping as unknown as ColumnMapping,
    missingResources: [...DEFAULT_MISSING_RESOURCES], fixedOffset: undefined,
    acceptExclusions: false, requireProcessType: false, festival: false, ...over,
  } as DatasetState;
  const validation = engine.validateAndNormalize(dataset.rows, importOptionsFor(dataset));
  const traces = validation.canAnalyze ? engine.groupCases(validation.events) : [];
  return { parsed, validation, traces };
}

/** Same throughput anchor rule as AnalysisProvider: earliest first event floored to the bucket width. */
function kpiContext(traces: readonly Trace[], processKey: string, bucketMinutes: number, festival?: KPIContext['festival']): KPIContext {
  const first = Math.min(...traces.map((t) => t.events[0]!.timestampMs));
  const width = bucketMinutes * MIN;
  return { processKey, throughput: { bucketMinutes, anchorMs: Math.floor(first / width) * width }, ...(festival ? { festival } : {}) };
}

const scope = { datasetId: 'it', processKey: 'default', analysisFilterFingerprint: 'all' };
const byId = (ms: Metric[]) => new Map(ms.map((m) => [m.id, m]));

describe('Order Processing CSV through the UI ingestion path (general log, no Festival)', () => {
  const orderMapping = { case_id: 'order', activity: 'step', timestamp: 'occurred_at', resource: 'owner', lifecycle: 'state', activity_instance_id: 'instance' };
  const { parsed, validation, traces } = load(fixture('order-processing-event-log.csv'), orderMapping);

  test('import: 11 rows, quoted comma kept, no issues, 3 cases', () => {
    expect(parsed.malformed).toEqual([]);
    expect(validation).toMatchObject({ rawCount: 11, excludedCount: 0, canAnalyze: true });
    expect(validation.issues).toEqual([]);
    expect(validation.events.map((e) => e.activity)).toContain('Packed, boxed');
    expect(traces.map((t) => [t.caseKey, t.elapsedMin])).toEqual([[key('default', '001'), 10], [key('default', '002'), 15], [key('default', '003'), 2]]);
    expect(traces[0]!.sequence.map((e) => e.activity)).toEqual(['Order Received', 'Payment Authorized', 'Packed, boxed', 'Order Shipped']);
  });

  test('DFG: activity/transition frequency, start/end, no self-loop', () => {
    const dfg = engine.buildDFG(traces);
    expect(Object.fromEntries(dfg.nodes.map((n) => [n.activity, n.count]))).toEqual({
      'Order Received': 3, 'Payment Authorized': 2, 'Packed, boxed': 2, 'Order Shipped': 2, 'Order Cancelled': 1,
    });
    expect(Object.fromEntries(dfg.edges.map((e) => [`${e.from}>${e.to}`, e.count]))).toEqual({
      'Order Received>Payment Authorized': 2, 'Payment Authorized>Packed, boxed': 2, 'Packed, boxed>Order Shipped': 2, 'Order Received>Order Cancelled': 1,
    });
    expect(dfg.edges.filter((e) => e.from === e.to)).toEqual([]);
    expect(dfg.starts).toEqual({ 'Order Received': 3 });
    expect(dfg.ends).toEqual({ 'Order Shipped': 2, 'Order Cancelled': 1 });
    expect(dfg.edges.find((e) => e.to === 'Order Cancelled')!.caseKeys).toEqual([key('default', '003')]);
  });

  test('variants, case duration, inter-event gaps, lifecycle service, no matched gap', () => {
    const variants = engine.getVariants(traces);
    expect(variants.map((v) => [v.activities.length, v.count, v.share, v.avgElapsedMin])).toEqual([[4, 2, 2 / 3, 12.5], [2, 1, 1 / 3, 2]]);
    expect(variants.reduce((s, v) => s + v.share, 0)).toBeCloseTo(1, 12);
    expect(engine.getCaseDurations(traces).map((d) => d.elapsedMin)).toEqual([10, 15, 2]);
    const perf = engine.getPerformance(traces);
    const gap = (type: string, from: string, to?: string) => perf.gaps.find((g) => g.metricType === type && g.from === from && g.to === to);
    expect([gap('inter_event', 'Order Received', 'Payment Authorized')?.meanMin, gap('inter_event', 'Payment Authorized', 'Packed, boxed')?.meanMin,
      gap('inter_event', 'Packed, boxed', 'Order Shipped')?.meanMin, gap('inter_event', 'Order Received', 'Order Cancelled')?.meanMin]).toEqual([3, 4, 5.5, 2]);
    expect(gap('service', 'Payment Authorized')).toMatchObject({ meanMin: 2, n: 1 });
    // Order Received is a point event, so Payment Authorized's paired start has no preceding completion.
    expect(perf.gaps.filter((g) => g.metricType === 'matched_gap')).toEqual([]);
    expect(perf).toMatchObject({ matchedPairs: 1, ambiguousPairs: 0, overlaps: 0 });
  });

  test('resource workload and handoff network: graph-ready counts equal hand counts', () => {
    const ra = engine.getResourceAnalysis(traces);
    expect(Object.fromEntries(ra.resources.map((r) => [r.resource, [r.rawEvents, r.instances, r.distinctCases, r.activeMin]]))).toEqual({
      Customer: [3, 3, 3, null], Billing: [3, 2, 2, 2], Warehouse: [2, 2, 2, null], Carrier: [2, 2, 2, null], Support: [1, 1, 1, null],
    });
    expect([ra.knownRawEvents, ra.totalRawEvents, ra.knownInstances, ra.totalInstances]).toEqual([11, 11, 10, 10]);
    expect(Object.fromEntries(ra.handoffs.map((h) => [`${h.from}>${h.to}`, h.count]))).toEqual({
      'Customer>Billing': 2, 'Billing>Warehouse': 2, 'Warehouse>Carrier': 2, 'Customer>Support': 1,
    });
    // Every handoff endpoint is a known resource node (no edge silently dropped by the graph).
    const nodes = new Set(ra.resources.map((r) => r.resource));
    expect(ra.handoffs.every((h) => nodes.has(h.from) && nodes.has(h.to))).toBe(true);
  });

  test('KPIs, exact-equality target, findings on the same Metric objects; no Festival KPI on a general log', () => {
    const metrics = engine.getKPIs(traces, kpiContext(traces, 'default', 60));
    expect(metrics.map((m) => [m.id, m.value])).toEqual([['case_elapsed_mean', 9], ['resource_utilization', null], ['resource_out_of_shift_minutes', null]]);
    expect(metrics.some((m) => m.id.startsWith('audience_') || m.id.startsWith('stage_') || m.id.startsWith('equipment_'))).toBe(false);
    expect(metrics[1]!.reason).toBeTruthy();
    const equal: Target = { metricId: 'case_elapsed_mean', value: 9, unit: 'min', direction: 'max' };
    expect(engine.evaluateTargets(metrics, [equal])).toEqual([{ metricId: 'case_elapsed_mean', status: 'met' }]);
    expect(engine.evaluateTargets(metrics, [{ ...equal, direction: 'min' }])).toEqual([{ metricId: 'case_elapsed_mean', status: 'met' }]);
    const breach: Target = { ...equal, value: 8 };
    const dfg = engine.buildDFG(traces);
    const findings = engine.getFindings({ scope, traces, dfg, performance: engine.getPerformance(traces), resources: engine.getResourceAnalysis(traces), metrics }, [breach]);
    expect(findings.map((f) => f.metricId)).toEqual(['inter_event', 'resource_instance_count', 'case_elapsed_mean']);
    expect(findings[0]).toMatchObject({ value: 5.5, n: 2, support: 'low', edge: { from: 'Packed, boxed', to: 'Order Shipped' } });
    expect(findings[1]).toMatchObject({ value: 3, n: 10, eligible: 10 });
    expect(findings[1]!.text.startsWith('Customer ')).toBe(true);
    const tf = targetBreachFinding(findings, breach);
    expect(tf?.caseKeys.sort()).toEqual([key('default', '001'), key('default', '002'), key('default', '003')]);
    expect(targetBreachFinding(findings, { ...breach, direction: 'min' })).toBeUndefined();
  });

  test('immutability: engine never mutates UI rows or its own outputs', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o as object)) deepFreeze(v);
      }
      return o;
    };
    const { rows } = engineRows(parseCsv(fixture('order-processing-event-log.csv')));
    const before = JSON.stringify(rows);
    deepFreeze(rows);
    const v = engine.validateAndNormalize(rows, { mapping: orderMapping as unknown as ColumnMapping, missingResources: DEFAULT_MISSING_RESOURCES, acceptExclusions: false });
    const t = deepFreeze(engine.groupCases(deepFreeze(v).events));
    const dfg = deepFreeze(engine.buildDFG(t));
    const perf = deepFreeze(engine.getPerformance(t));
    const ra = deepFreeze(engine.getResourceAnalysis(t));
    engine.getVariants(t); engine.getCaseDurations(t);
    const ms = engine.getKPIs(t, kpiContext(t, 'default', 60));
    expect(() => engine.getFindings({ scope, traces: t, dfg, performance: perf, resources: ra, metrics: ms }, [])).not.toThrow();
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('Audience gate test log (hand-authored test data, Festival adapters explicitly on)', () => {
  const mapping = { event_id: 'event_id', process_type: 'process_type', case_id: 'case_id', activity: 'activity', timestamp: 'timestamp',
    lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource', festival_id: 'festival_id' };
  const { validation, traces } = load(fixture('integration/audience-gate-test-log.csv'), mapping, { requireProcessType: true, festival: true });
  const festival = festivalKpiConfig(DEFAULT_FESTIVAL_SETTINGS, traces);

  test('import: 34 rows, three Join/Verification ties, no time-order warning', () => {
    expect(validation).toMatchObject({ rawCount: 34, excludedCount: 0, canAnalyze: true });
    expect(validation.issues.map((i) => [i.row, i.code])).toEqual([[1, 'timestamp_tie'], [5, 'timestamp_tie'], [9, 'timestamp_tie']]);
    expect(traces).toHaveLength(9);
  });

  test('Festival KPIs: wait 26.25 s, entry 91.25 s, outcome counts/rates, 15-minute throughput with recorded zeros', () => {
    const m = byId(engine.getKPIs(traces, kpiContext(traces, 'audience', 15, festival)));
    expect(m.get('audience_queue_wait_mean')).toMatchObject({ value: 26.25 / 60, unit: 'min', n: 8, eligible: 9 });
    expect(m.get('audience_entry_elapsed_mean')).toMatchObject({ value: 91.25 / 60, n: 8 });
    expect(m.get('audience_manual_verification_rate')).toMatchObject({ value: 0, unit: '%', n: 9 });
    expect(m.get('audience_completed_count')).toMatchObject({ value: 8, unit: 'cases', n: 9 });
    expect(m.get('audience_completed_rate')!.value).toBeCloseTo((8 / 9) * 100, 12);
    expect(m.get('audience_rejected_count')).toMatchObject({ value: 1, n: 9 });
    expect(m.get('audience_rejected_rate')!.value).toBeCloseTo((1 / 9) * 100, 12);
    expect(m.get('case_elapsed_mean')!.value).toBeCloseTo(735 / 9 / 60, 12);
    const tp = m.get('audience_throughput')!;
    expect(tp.unit).toBe('cases/bucket');
    expect(tp.buckets!.map((b) => b.count)).toEqual([8, 0, 0]);
    expect(tp.value).toBeCloseTo(8 / 3, 12);
    expect(tp.n).toBe(8);
    expect(byId(engine.getKPIs(traces, kpiContext(traces, 'audience', 60, festival))).get('audience_throughput')).toMatchObject({ value: 8, n: 8 });
  });

  test('a minimum-rate breach links the non-completed case, only when the original Metric objects are passed', () => {
    const metrics = engine.getKPIs(traces, kpiContext(traces, 'audience', 60, festival));
    const target: Target = { metricId: 'audience_completed_rate', value: 95, unit: '%', direction: 'min' };
    const analysis = { scope: { ...scope, processKey: 'audience' }, traces, dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces), resources: engine.getResourceAnalysis(traces) };
    const original = targetBreachFinding(engine.getFindings({ ...analysis, metrics, rework: festivalRework('audience', DEFAULT_FESTIVAL_SETTINGS) }, [target]), target);
    expect(original?.caseKeys).toEqual([key('audience', 'ENT009')]);
    // Hazard documented by the engine fix report: a serialized copy loses the problem-case evidence.
    const cloned = targetBreachFinding(engine.getFindings({ ...analysis, metrics: structuredClone(metrics) }, [target]), target);
    expect(cloned?.caseKeys).toHaveLength(8);
    expect(cloned?.caseKeys).not.toContain(key('audience', 'ENT009'));
  });

  test('gate vector: 8 observed 60 s services, ENT009 excluded; 3 → 4 → 5 gates match FCFS hand calculation', () => {
    const sel = engine.getGateInputs(traces, { serviceActivity: 'Ticket Verification', mode: 'observed' });
    expect(sel.eligibleCases).toBe(9);
    expect(sel.inputs.map((i) => i.serviceSec)).toEqual([60, 60, 60, 60, 60, 60, 60, 60]);
    expect(sel.exclusions).toEqual([{ caseKey: key('audience', 'ENT009'), reason: 'missing_or_invalid_service' }]);
    const sec = (q: ReturnType<typeof engine.simulateGateQueue>) => [q.meanWaitMin * 60, q.p95WaitMin * 60, q.maxWaitMin * 60, q.finishElapsedMin * 60];
    const g3 = engine.simulateGateQueue(sel.inputs, 3);
    const g4 = engine.simulateGateQueue(sel.inputs, 4);
    const g5 = engine.simulateGateQueue(sel.inputs, 5);
    expect(sec(g3).map((v) => +v.toFixed(9))).toEqual([26.25, 60, 60, 190]);
    expect(g3.throughputPerHour).toBeCloseTo((8 * 3600) / 190, 9);
    expect(sec(g4).map((v) => +v.toFixed(9))).toEqual([10, 20, 20, 150]);
    expect(g4.throughputPerHour).toBeCloseTo(192, 9);
    expect(sec(g5).map((v) => +v.toFixed(9))).toEqual([3.75, 10, 10, 140]);
    // The observed log was generated with 3 gates, so the modeled 3-gate mean wait equals the observed KPI.
    expect(g3.meanWaitMin).toBeCloseTo(26.25 / 60, 12);
  });
});

describe('Festival-only rules never touch a general log', () => {
  const text = fixture('integration/qa06-audience-reverse-order.csv');
  const mapping = { event_id: 'event_id', process_type: 'process_type', case_id: 'case_id', activity: 'activity', timestamp: 'timestamp',
    lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', festival_id: 'festival_id' };

  test('adapters off: no audience time-order warning and no Festival KPI, even with process_type=audience', () => {
    const { validation, traces } = load(text, mapping);
    expect(validation.issues.filter((i) => i.code === 'audience_event_before_arrival')).toEqual([]);
    expect(engine.getKPIs(traces, kpiContext(traces, 'audience', 60)).map((m) => m.id)).toEqual(['case_elapsed_mean', 'resource_utilization', 'resource_out_of_shift_minutes']);
  });

  test('adapters on with required process_type and mapped festival_id: rows 0–2 warned and excluded from outcome KPIs', () => {
    const { validation, traces } = load(text, mapping, { requireProcessType: true, festival: true });
    expect(validation.issues.filter((i) => i.code === 'audience_event_before_arrival').map((i) => i.row)).toEqual([0, 1, 2]);
    const m = byId(engine.getKPIs(traces, kpiContext(traces, 'audience', 60, festivalKpiConfig(DEFAULT_FESTIVAL_SETTINGS, traces))));
    expect(m.get('audience_queue_wait_mean')!.value).toBeNull();
    expect(m.get('audience_rejected_rate')).toMatchObject({ value: null, n: 0 });
  });
});

describe('Resource identity, lifecycle evidence and decimal-second simulation', () => {
  test('same display name in two festivals stays two resources; labels are display-only', () => {
    const { traces } = load(fixture('integration/qa02-same-name-two-festivals.csv'),
      { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource' });
    const ra = engine.getResourceAnalysis(traces);
    expect(ra.resources.map((r) => [resourceLabel(r.resource), r.activeMin, r.distinctCases]).sort()).toEqual([['Local Crew · F1', 10, 1], ['Local Crew · F2', 5, 1]]);
    expect(ra.resources.every((r) => r.resource.startsWith('@resource:'))).toBe(true);
    const metrics = engine.getKPIs(traces, kpiContext(traces, 'default', 60));
    const f = engine.getFindings({ scope, traces, dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces), resources: ra, metrics }, [])
      .find((x) => x.metricId === 'resource_instance_count')!;
    expect(f.text).toContain('@resource:');
    expect(displayResourceKeys(f.text)).toMatch(/^Local Crew · F[12] has the most discovered instances/);
    expect(displayResourceKeys(f.text)).not.toContain('@resource:');
  });

  test('instance workload evidence excludes start-only cases; raw node evidence keeps them', () => {
    const { validation, traces } = load(fixture('integration/qa05-start-only.csv'),
      { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource' });
    expect(validation.issues.map((i) => i.code).sort()).toEqual(['empty_discovery_case', 'missing_lifecycle_partner']);
    const ra = engine.getResourceAnalysis(traces);
    expect(ra.resources[0]).toMatchObject({ resource: 'R7', rawEvents: 3, instances: 1, distinctCases: 2 });
    expect(ra.resources[0]!.caseKeys.sort()).toEqual([key('default', 'Finished'), key('default', 'Started')]);
    const f = engine.getFindings({ scope, traces, dfg: engine.buildDFG(traces), performance: engine.getPerformance(traces), resources: ra, metrics: engine.getKPIs(traces, kpiContext(traces, 'default', 60)) }, [])
      .find((x) => x.metricId === 'resource_instance_count')!;
    expect(f.caseKeys).toEqual([key('default', 'Finished')]);
  });

  test('overlapping intervals union to 15 min; utilization N/A without shifts (T15)', () => {
    const { traces } = load(fixture('integration/t15-overlap-no-shift.csv'),
      { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource' });
    expect(engine.getResourceAnalysis(traces).resources[0]).toMatchObject({ resource: 'R1', activeMin: 15 });
    expect(byId(engine.getKPIs(traces, kpiContext(traces, 'default', 60))).get('resource_utilization')).toMatchObject({ value: null, n: 0, eligible: 1 });
  });

  test('decimal-second services (0.1, 0.2, 0.05 s) produce exactly zero wait on one gate (QA-07)', () => {
    const { traces } = load(fixture('integration/qa07-decimal-seconds.csv'),
      { event_id: 'event_id', process_type: 'process_type', case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', lifecycle: 'lifecycle', activity_instance_id: 'activity_instance_id', resource: 'resource' },
      { festival: true });
    const sel = engine.getGateInputs(traces, { serviceActivity: 'Ticket Verification', mode: 'observed' });
    expect(sel.inputs.map((i) => i.serviceSec)).toEqual([0.1, 0.2, 0.05]);
    const q = engine.simulateGateQueue(sel.inputs, 1);
    expect([q.meanWaitMin, q.p95WaitMin, q.maxWaitMin]).toEqual([0, 0, 0]);
    expect(q.finishElapsedMin * 60).toBeCloseTo(0.35, 12);
  });

  test('T05/T07/T08 data-quality cases through the UI path', () => {
    const t05 = load(fixture('integration/t05-parsing-order.csv'), { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp' });
    expect(t05.validation.issues.map((i) => [i.row, i.code, i.severity])).toEqual([[1, 'timestamp_tie', 'warning'], [3, 'invalid_timestamp', 'error']]);
    expect(t05.validation).toMatchObject({ excludedCount: 1, canAnalyze: false });
    const t05ok = load(fixture('integration/t05-parsing-order.csv'), { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp' }, { acceptExclusions: true });
    const dfg = engine.buildDFG(t05ok.traces);
    expect(dfg.edges.map((e) => [e.from, e.to, e.count])).toEqual([['B', 'A', 1]]);
    expect(dfg.nodes.map((n) => n.activity)).toContain('Sound, check');
    expect(engine.getPerformance(t05ok.traces).gaps.find((g) => g.from === 'B' && g.to === 'A')!.meanMin).toBe(0);

    const t07 = load(fixture('integration/t07-ambiguous-lifecycle.csv'), { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', lifecycle: 'lifecycle' });
    expect(t07.validation.issues.map((i) => [i.row, i.code])).toEqual([[0, 'ambiguous_lifecycle'], [1, 'ambiguous_lifecycle'], [2, 'ambiguous_lifecycle']]);
    const p07 = engine.getPerformance(t07.traces);
    expect(p07).toMatchObject({ matchedPairs: 0, ambiguousPairs: 1 });
    expect(p07.gaps.filter((g) => g.metricType === 'service')).toEqual([]);
    expect(t07.traces[0]!.sequence.map((e) => e.activity)).toEqual(['A', 'B']);

    const t08 = load(fixture('integration/t08-quality-issues.csv'), { event_id: 'event_id', case_id: 'case_id', activity: 'activity', timestamp: 'timestamp', resource: 'resource' }, { acceptExclusions: true });
    expect(t08.validation.issues.map((i) => [i.row, i.code])).toEqual([[2, 'invalid_timestamp'], [3, 'duplicate_event_id']]);
    expect(t08.validation).toMatchObject({ rawCount: 4, excludedCount: 2, canAnalyze: true });
    const ra = engine.getResourceAnalysis(t08.traces);
    expect([ra.knownRawEvents, ra.totalRawEvents]).toEqual([1, 2]);
    expect(t08.validation.events[0]!.resource).toBeNull(); // NONE placeholder
  });
});
