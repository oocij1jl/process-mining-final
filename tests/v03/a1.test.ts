import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, expect, test, vi } from 'vitest';
import type { RawRow } from '../../src/contracts';
import * as engine from '../../src/engine';
import { key, options, pair, row, tracesOf } from '../engine-fixtures';

const bytes = (xml: string) => new TextEncoder().encode(xml);
const xes = (xml: string, overrides: Partial<Parameters<typeof engine.importXes>[1]> = {}) =>
  engine.importXes(bytes(xml), { ...options, ...overrides });
const attr = (key: string, value: string, tag = 'string') => `<${tag} key="${key}" value="${value}"/>`;
const timestamp = attr('time:timestamp', '2026-11-28T00:00:00Z', 'date');
const trace = (events: string, id = '001') => `<trace>${attr('concept:name', id)}${events}</trace>`;
const event = (activity: string, extras = '') => `<event>${attr('concept:name', activity)}${timestamp}${extras}</event>`;
const log = (body: string) => `<log>${body}</log>`;

function parsed(result: ReturnType<typeof engine.importXes>) {
  if (result.status !== 'parsed') throw new Error(JSON.stringify(result.issues));
  return result;
}

function rejected(result: ReturnType<typeof engine.importXes>, code: string) {
  expect(result).toMatchObject({ status: 'rejected', issues: [{ row: -1, location: null, severity: 'error', code }] });
  expect(result).not.toHaveProperty('validation');
}

describe('P0-A1 shared CSV and XES analysis', () => {
  test('Order-like and Festival traces produce identical analytics and independent KPI values', () => {
    const read = (name: string) => readFileSync(new URL(`../fixtures/v03/${name}`, import.meta.url));
    const csv = Papa.parse<RawRow>(read('parity.csv').toString('utf8'), { header: true, skipEmptyLines: true });
    expect(csv.errors).toEqual([]);
    const left = engine.validateAndNormalize(csv.data, { ...options, requireProcessType: true, festivalValidation: true });
    const right = parsed(engine.importXes(read('parity.xes'), { ...options, requireProcessType: true, festivalValidation: true }));
    expect(left.canAnalyze).toBe(true);
    expect(right.validation.canAnalyze).toBe(true);
    expect(right.validation.issues.map(({ code, row }) => [code, row])).toEqual([['timestamp_tie', 1]]);
    expect(right.eventLocations[4]).toEqual({ traceIndex: 1, eventIndex: 0 });
    expect(right.traces[1]).toMatchObject({ caseId: '공연01', attrs: { 'festival:performance_id': 'P1' } });
    const coreEvent = ({ attrs: _attrs, ...value }: (typeof left.events)[number]) => value;
    expect(right.validation.events.map(coreEvent)).toEqual(left.events.map(coreEvent));
    expect(right.validation.events[1]).toMatchObject({ instanceId: '01', attrs: { 'concept:instance': '01', 'lifecycle:transition': 'start' } });
    expect(right.validation.events[0].rawTimestamp).toBe('2026-11-28T09:00:00+09:00');

    for (const processKey of ['orders', 'stage', 'audience']) {
      const csvTraces = engine.groupCases(left.events).filter(item => item.processType === processKey);
      const xesTraces = engine.groupCases(right.validation.events).filter(item => item.processType === processKey);
      for (const analyze of [engine.buildDFG, engine.getVariants, engine.getResourceAnalysis, engine.getPerformance, engine.getActivityEvidence]) {
        // Identical timestamps and traversal order yield exact parity, including floating-point fields.
        expect(analyze(xesTraces)).toEqual(analyze(csvTraces));
      }
      const context = { processKey, festival: {}, throughput: { bucketMinutes: 5, anchorMs: 0 } };
      const metrics = engine.getKPIs(xesTraces, context);
      expect(metrics).toEqual(engine.getKPIs(csvTraces, context));
      if (processKey === 'orders') {
        expect(engine.getActivityEvidence(xesTraces)).toMatchObject({ repeatRatePct: 100, extraOccurrenceCount: 1 });
        expect(engine.getPerformance(xesTraces).gaps).toContainEqual(
          { metricType: 'service', from: 'B', n: 1, meanMin: 2, caseKeys: [key('001', 'orders')] });
      }
      if (processKey === 'stage') expect(metrics.find(m => m.id === 'stage_on_time_rate')).toMatchObject({ value: 100, n: 1 });
      if (processKey === 'audience') {
        expect(metrics.find(m => m.id === 'audience_completed_rate')).toMatchObject({ value: 50, n: 2,
          caseKeys: [key('001', 'audience')], problemCaseKeys: { min: [key('002', 'audience')], max: [key('001', 'audience')] } });
        expect(metrics.find(m => m.id === 'audience_throughput')?.buckets?.map(({ count }) => count)).toEqual([1, 0]);
      }
    }
  });

  test('exclusions preserve their coordinates and attendance requires explicit Festival validation', () => {
    const invalid = `<event>${timestamp}</event>${event('X', attr('lifecycle:transition', 'suspend'))}`;
    const result = parsed(xes(log(trace(invalid + event('A &amp; B') + event('Next')) + trace('', '002'))));
    expect(result.validation).toMatchObject({ rawCount: 4, excludedCount: 2, canAnalyze: false });
    expect(result.eventLocations).toEqual([0, 1, 2, 3].map(eventIndex => ({ traceIndex: 0, eventIndex })));
    expect(result.validation.events.map(({ activity, sourceOrder }) => [activity, sourceOrder])).toEqual([['A & B', 2], ['Next', 3]]);
    expect(result.validation.issues.map(({ code, location }) => [code, location])).toEqual([
      ['xes_empty_trace', { traceIndex: 1, eventIndex: null }],
      ['missing_required', { traceIndex: 0, eventIndex: 0 }],
      ['invalid_lifecycle', { traceIndex: 0, eventIndex: 1 }],
      ['timestamp_tie', { traceIndex: 0, eventIndex: 3 }],
    ]);
    expect(parsed(xes(log(trace(invalid + event('A'))), { acceptExclusions: true })).validation.canAnalyze).toBe(true);

    const audience = trace(event('Entry Complete') +
      event('Join Entry Queue').replace('T00:00:00Z', 'T00:01:00Z') + attr('process_type', 'audience'));
    expect(parsed(xes(log(audience), { requireProcessType: true })).validation.issues).toEqual([]);
    expect(parsed(xes(log(audience), { festivalValidation: true })).validation.issues).toMatchObject([
      { code: 'audience_event_before_arrival', severity: 'warning', row: 0 },
    ]);
    const raw = [row('1', 'Entry Complete', 0, { process_type: 'audience' }), row('1', 'Join Entry Queue', 1, { process_type: 'audience' })];
    expect(engine.validateAndNormalize(raw, { ...options, festivalValidation: true }).issues[0]?.code).toBe('audience_event_before_arrival');
    const legacy = { ...options, requireProcessType: true, mapping: { ...options.mapping, festival_id: 'festival_id' } };
    expect(engine.validateAndNormalize(raw, legacy).issues[0]?.code).toBe('audience_event_before_arrival');
    expect(engine.validateAndNormalize(raw, { ...legacy, festivalValidation: false }).issues).toEqual([]);
  });

  test('attribute shape, duplicate keys, alias conflicts and invalid dates are located', () => {
    const broken = event('A', attr('concept:instance', '01') + attr('activity_instance_id', '02')) +
      event('B', attr('org:resource', 'A') + attr('org:resource', 'B')) +
      event('C').replace('2026-11-28', '2026-02-30') +
      event('D').replace(timestamp, attr('time:timestamp', '2026-11-28T00:00:00Z')) +
      event('E', '<list key="festival:festival_id"/>') + event('F', '<list key="detail"><values/></list>');
    const result = parsed(xes(log(trace(broken)), { acceptExclusions: true }));
    expect(result.validation).toMatchObject({ rawCount: 6, excludedCount: 5, canAnalyze: true, events: [{ activity: 'F', sourceOrder: 5 }] });
    expect(result.validation.issues.map(item => [item.row, item.code])).toEqual([
      [0, 'xes_conflicting_attribute'], [1, 'xes_duplicate_attribute'], [2, 'invalid_timestamp'],
      [3, 'xes_invalid_attribute'], [4, 'xes_invalid_attribute'], [5, 'xes_unsupported_attribute'],
    ]);
    const mixed = parsed(xes(log(trace(event('A', attr('process_type', 'stage')) + event('B', attr('process_type', 'equipment'))))));
    expect(mixed.validation).toMatchObject({ excludedCount: 2, issues: expect.arrayContaining([
      expect.objectContaining({ code: 'xes_conflicting_attribute', location: { traceIndex: 0, eventIndex: null } }),
    ]) });
  });

  test.each([
    ['<notXes/>', 'xes_unsupported_root'], ['<log><trace></log>', 'xes_malformed_xml'],
    ['<log><event/></log>', 'xes_unsupported_structure'], ['<log/><log/>', 'xes_malformed_xml'],
    ['<log><trace xmlns="urn:other"/></log>', 'xes_unsupported_structure'],
    ['<!DOCTYPE log SYSTEM "https://example.invalid/xes"><log/>', 'xes_unsafe_xml'],
    ['<!ENTITY item "ignored"><log/>', 'xes_unsafe_xml'],
    ['<?xml-stylesheet href="https://example.invalid/xsl"?><log/>', 'xes_unsafe_xml'],
    ['<log xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///example"/></log>', 'xes_unsafe_xml'],
    ['<?xml version="1.0" encoding="latin1"?><log/>', 'xes_invalid_encoding'],
    ['<log>&unknown;</log>', 'xes_malformed_xml'],
    [log(trace(event('A')) + trace(event('B'), ' 001 ')), 'xes_duplicate_trace_key'],
  ])('rejects invalid or unsupported document %#', (xml, code) => rejected(xes(xml), code));

  test('supports inert namespace/schema URIs, numeric characters, BOM and UTF-8 validation', () => {
    const uri = 'https://example.invalid/schema';
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const result = parsed(xes('\uFEFF' + `<log xmlns="http://www.xes-standard.org" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${uri}">` +
        trace(event('한글 &#x26; text', attr('link', uri))) + '</log>'));
      expect(result.validation.events[0]).toMatchObject({ activity: '한글 & text', attrs: { link: uri } });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
    rejected(engine.importXes(Uint8Array.of(0xC0, 0xAF), options), 'xes_invalid_encoding');
  });

  test('uses the default process for missing labels and checks trace identity before event exclusions', () => {
    const result = parsed(xes(log(trace(event('A') + event('B', attr('process_type', 'default'))))));
    expect(result.validation.events.map(item => item.processType)).toEqual(['default', 'default']);
    rejected(xes(log(trace(`<event>${timestamp}</event>`) + trace(event('B')))), 'xes_duplicate_trace_key');
  });

  test('enforces byte, event, trace, XML element and depth limits at the boundaries', () => {
    const fitsBytes = '<log><!--' + ' '.repeat(8_388_608 - '<log><!----></log>'.length) + '--></log>';
    expect(bytes(fitsBytes)).toHaveLength(8_388_608);
    expect(xes(fitsBytes).status).toBe('parsed');
    rejected(xes(fitsBytes + ' '), 'xes_limit_exceeded');
    const manyEvents = (n: number) => log(trace('<event/>'.repeat(n)));
    expect(parsed(xes(manyEvents(50_000))).validation.excludedCount).toBe(50_000);
    rejected(xes(manyEvents(50_001)), 'xes_limit_exceeded');
    expect(parsed(xes(log('<trace/>'.repeat(10_000)))).traces).toHaveLength(10_000);
    rejected(xes(log('<trace/>'.repeat(10_001))), 'xes_limit_exceeded');
    const manyElements = (n: number) => log('<list key="details">' + '<string/>'.repeat(n) + '</list>');
    expect(xes(manyElements(499_998)).status).toBe('parsed');
    rejected(xes(manyElements(499_999)), 'xes_limit_exceeded');
    const deep = (n: number) => log('<list key="detail">'.repeat(n) + '</list>'.repeat(n));
    expect(xes(deep(31)).status).toBe('parsed');
    rejected(xes(deep(32)), 'xes_limit_exceeded');
  });
});

test('activity evidence handles nonadjacent repeats, matched service and start-only cases', () => {
  const traces = tracesOf([row('1', 'A', 0), ...pair('1', 'B', 1, 3), row('1', 'A', 4),
    row('2', 'A', 0), row('2', 'B', 2), row('3', 'C', 0, { lifecycle: 'start' })]);
  const analysis = engine.getActivityEvidence(traces);
  expect(analysis).toMatchObject({ selectedCases: 3, discoveredCases: 2, repeatedCaseKeys: [key('1')],
    extraOccurrenceCount: 1, repeatRatePct: 50 });
  expect(analysis.activities[1]).toMatchObject({ activity: 'B', occurrenceCount: 2,
    service: { n: 1, eligible: 2, meanMin: 2, totalMin: 2, caseKeys: [key('1')] } });
  const scope = { datasetId: 'test', processKey: 'default', analysisFilterFingerprint: 'all' };
  const findings = engine.getFindings({ scope, traces, dfg: engine.buildDFG(traces), metrics: [],
    performance: engine.getPerformance(traces), resources: engine.getResourceAnalysis(traces) }, []);
  expect(findings.find(finding => finding.rule === 'rework')).toMatchObject({
    n: 2, eligible: 3, value: 50, definition: expect.any(String), caseKeys: [key('1')],
  });
  expect(engine.buildDFG(traces).endCases).toEqual({ A: [key('1')], B: [key('2')] });
  expect(Object.hasOwn(engine.buildDFG(tracesOf([row('1', '__proto__', 0)])).startCases!, '__proto__')).toBe(true);
});

test('transition coverage distinguishes measured matched gaps, overlaps and missing prerequisites', () => {
  const traces = tracesOf([
    ...pair('1', 'A', 0, 5), ...pair('1', 'B', 4, 6),
    ...pair('2', 'A', 0, 2), ...pair('2', 'B', 3, 4),
    row('3', 'A', 0), row('3', 'B', 2),
  ]);
  const perf = engine.getPerformance(traces);
  expect(perf.transitionCoverage).toEqual([{ from: 'A', to: 'B', transitionCount: 3, matchedGapCount: 1, overlapCount: 1 }]);
  expect(perf.gaps.find(gap => gap.metricType === 'matched_gap')).toMatchObject({ n: 1, meanMin: 1, caseKeys: [key('2')] });
  expect(perf.gaps.find(gap => gap.metricType === 'inter_event')).toMatchObject({ n: 3, meanMin: 5 / 3 });
});
