import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { expect, test } from 'vitest';
import { DEFAULT_MISSING_RESOURCES } from '../src/contracts';
import type { RawRow } from '../src/contracts';
import * as engine from '../src/engine';

const orderFixture = new URL('./fixtures/order-processing-event-log.csv', import.meta.url);
const parsed = Papa.parse<RawRow>(readFileSync(orderFixture, 'utf8'), { header: true, skipEmptyLines: true });

test('Order Processing CSV works through the general core without Festival columns or settings', () => {
  expect(parsed.errors).toEqual([]);
  expect(parsed.meta.fields).toEqual(['order', 'step', 'occurred_at', 'owner', 'state', 'instance']);
  const imported = engine.validateAndNormalize(parsed.data, {
    mapping: { case_id: 'order', activity: 'step', timestamp: 'occurred_at', resource: 'owner',
      lifecycle: 'state', activity_instance_id: 'instance' },
    acceptExclusions: false, missingResources: DEFAULT_MISSING_RESOURCES,
  });
  expect(imported).toMatchObject({ canAnalyze: true, rawCount: 11, excludedCount: 0, issues: [] });
  const traces = engine.groupCases(imported.events);
  expect(traces.map(trace => [trace.processType, trace.events[0].caseId, trace.elapsedMin]))
    .toEqual([['default', '001', 10], ['default', '002', 15], ['default', '003', 2]]);

  const dfg = engine.buildDFG(traces);
  expect(dfg.starts).toEqual({ 'Order Received': 3 });
  expect(dfg.ends).toEqual({ 'Order Shipped': 2, 'Order Cancelled': 1 });
  expect(dfg.edges.map(edge => [edge.from, edge.to, edge.count])).toEqual([
    ['Order Received', 'Payment Authorized', 2],
    ['Payment Authorized', 'Packed, boxed', 2],
    ['Packed, boxed', 'Order Shipped', 2],
    ['Order Received', 'Order Cancelled', 1],
  ]);
  expect(engine.getVariants(traces)).toMatchObject([
    { activities: ['Order Received', 'Payment Authorized', 'Packed, boxed', 'Order Shipped'], count: 2, share: 2 / 3, avgElapsedMin: 12.5 },
    { activities: ['Order Received', 'Order Cancelled'], count: 1, share: 1 / 3, avgElapsedMin: 2 },
  ]);

  const performance = engine.getPerformance(traces);
  expect(performance.matchedPairs).toBe(1);
  expect(performance.gaps).toEqual(expect.arrayContaining([
    expect.objectContaining({ metricType: 'service', from: 'Payment Authorized', meanMin: 2, n: 1 }),
    expect.objectContaining({ metricType: 'inter_event', from: 'Packed, boxed', to: 'Order Shipped', meanMin: 5.5, n: 2 }),
  ]));
  const resources = engine.getResourceAnalysis(traces);
  expect(resources.resources).toEqual(expect.arrayContaining([
    expect.objectContaining({ resource: 'Customer', rawEvents: 3, instances: 3 }),
    expect.objectContaining({ resource: 'Billing', rawEvents: 3, instances: 2, activeMin: 2 }),
  ]));
  expect(resources.handoffs.map(edge => [edge.from, edge.to, edge.count])).toEqual([
    ['Customer', 'Billing', 2], ['Billing', 'Warehouse', 2],
    ['Warehouse', 'Carrier', 2], ['Customer', 'Support', 1],
  ]);

  const scope = { datasetId: 'orders', processKey: 'default', analysisFilterFingerprint: 'all' };
  const metrics = engine.getKPIs(traces, scope);
  expect(metrics.map(metric => [metric.id, metric.value])).toEqual([
    ['case_elapsed_mean', 9], ['resource_utilization', null], ['resource_out_of_shift_minutes', null],
  ]);
  const targets = [{ metricId: 'case_elapsed_mean', value: 8, direction: 'max', unit: 'min' }] as const;
  expect(engine.evaluateTargets(metrics, targets)).toEqual([{ metricId: 'case_elapsed_mean', status: 'breached' }]);
  const findings = engine.getFindings({ scope, traces, dfg, performance, resources, metrics }, targets);
  expect(findings.map(finding => finding.metricId)).toEqual(['inter_event', 'resource_instance_count', 'case_elapsed_mean']);
  expect(findings[0]).toMatchObject({ edge: { from: 'Packed, boxed', to: 'Order Shipped' }, value: 5.5, n: 2 });
});

test('Order Processing stations can use the generic scheduler with prepared arrival and service demand', () => {
  const inputs = [
    { caseKey: 'order-a', arrivalMs: 0, serviceSec: 1.25, sourceOrder: 0 },
    { caseKey: 'order-b', arrivalMs: 1000, serviceSec: 0.5, sourceOrder: 1 },
  ];
  const result = engine.simulateGateQueue(inputs, 1);
  expect(result).toMatchObject({ count: 2, maxWaitMin: 0.25 / 60, p95WaitMin: 0.25 / 60,
    meanWaitMin: 0.125 / 60, finishElapsedMin: 1.75 / 60 });
});
