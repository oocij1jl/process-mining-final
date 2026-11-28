import { expect, test } from 'vitest';
import type { AutomationAssessment, BenefitInput, BpmnReference } from '../../src/v03-contracts';
import * as engine from '../../src/engine';
import { key, pair, row, tracesOf } from '../engine-fixtures';
import { orderTraces } from './fixtures';

const assessment: AutomationAssessment = {
  ruleBased: 5, digitalReadiness: 4, lowNeedForHumanJudgment: 3, safetyRisk: 'medium', implementationDifficulty: 4,
};

test('automation scoring computes separate opportunity, suitability and review gate', () => {
  const analysis = engine.getActivityEvidence(tracesOf([
    row('1', 'A', 0), ...pair('1', 'B', 1, 3), row('1', 'A', 4), row('2', 'A', 0), row('2', 'B', 2),
  ]));
  const score = engine.scoreAutomation(analysis, 'B', assessment);
  expect(score).toMatchObject({ activity: 'B', suitabilityScore: 80, occurrenceDenominator: 3,
    serviceTotalDenominatorMin: 2, opportunityBasis: 'frequency_and_service', requiresHumanReview: false });
  expect(score.opportunityScore).toBeCloseTo(250 / 3, 12);
  expect(score.score).toBeCloseTo(245 / 3, 12);
  expect(engine.scoreAutomation(analysis, 'A', { ...assessment, digitalReadiness: null, safetyRisk: null })).toMatchObject({
    opportunityBasis: 'frequency_only', opportunityScore: 100, serviceTotalDenominatorMin: null,
    suitabilityScore: null, score: null, requiresHumanReview: true,
  });
  expect(engine.scoreAutomation(analysis, 'B', { ...assessment, safetyRisk: 'high' }).score).toBe(score.score);
  expect(engine.scoreAutomation(analysis, 'B', { ...assessment, safetyRisk: 'high' }).requiresHumanReview).toBe(true);
  expect(() => engine.scoreAutomation(analysis, 'B', { ...assessment, ruleBased: 4.5 })).toThrow(RangeError);
  expect(() => engine.scoreAutomation(analysis, 'C', assessment)).toThrow(RangeError);
  const measuredZero = engine.getActivityEvidence(tracesOf(pair('1', 'A', 0, 0)));
  expect(engine.scoreAutomation(measuredZero, 'A', assessment)).toMatchObject({ opportunityBasis: 'frequency_only' });
});

const servicePlan: Extract<BenefitInput, { kind: 'service_change' }> = {
  kind: 'service_change', periodLabel: 'Test month', currency: 'KRW', costs: { initial: 40000, recurrent: 10000 },
  volume: 1000, eligibleShare: 0.8, currentService: { source: 'assumed', seconds: 60 },
  expectedServiceSec: 30, hourlyCost: 15000, realizationFraction: 0.5,
};

test('ROI retains released hours, capacity value, realizable benefit and actual cost as separate outputs', () => {
  expect(engine.estimateBenefit(servicePlan)).toEqual({
    currentServiceSec: 60, hoursReleased: 20 / 3, capacityValue: 100000, monetizedBenefit: 50000,
    totalCost: 50000, netBenefit: 0, roiPct: 0, roiUnavailable: null,
  });
  const activity = engine.getActivityEvidence(tracesOf(pair('Case', 'A', 0, 1))).activities[0];
  expect(engine.estimateBenefit({ ...servicePlan, currentService: { source: 'matched', evidence: activity } }))
    .toEqual(engine.estimateBenefit(servicePlan));
  expect(engine.estimateBenefit({ ...servicePlan, realizationFraction: null })).toMatchObject({
    hoursReleased: 20 / 3, capacityValue: 100000, monetizedBenefit: null, roiPct: null, roiUnavailable: 'missing_benefit',
  });
  expect(engine.estimateBenefit({ ...servicePlan, costs: { initial: 0, recurrent: 0 } })).toMatchObject({
    netBenefit: 50000, roiPct: null, roiUnavailable: 'zero_cost',
  });
  expect(engine.estimateBenefit({ ...servicePlan, expectedServiceSec: 90 }).hoursReleased).toBe(-20 / 3);
  expect(engine.estimateBenefit({ ...servicePlan, kind: 'financial_only', independentBenefit: 100000 })).toMatchObject({
    hoursReleased: null, capacityValue: null, monetizedBenefit: 100000, netBenefit: 50000, roiPct: 100,
  });
  expect(engine.estimateBenefit({ ...servicePlan, currency: null })).toMatchObject({
    hoursReleased: 20 / 3, capacityValue: null, roiUnavailable: 'missing_currency',
  });
  expect(() => engine.estimateBenefit({ ...servicePlan, eligibleShare: 1.1 })).toThrow(RangeError);
  expect(() => engine.estimateBenefit({ ...servicePlan, hourlyCost: Number.MAX_VALUE })).toThrow(RangeError);
});

const node = (id: string, kind: BpmnReference['nodes'][number]['kind'], name = id) => ({ id, kind, name });
const flows = (...items: string[][]) => items.map(([fromId, toId]) => ({ fromId, toId }));
const reference: BpmnReference = {
  nodes: [node('s', 'start'), node('A', 'task'), node('split', 'xor'), node('B', 'task'), node('C', 'task'),
    node('bExit', 'end'), node('cExit', 'end')],
  flows: flows(['s', 'A'], ['A', 'split'], ['split', 'B'], ['split', 'C'], ['B', 'bExit'], ['C', 'cExit']),
};

test('BPMN compares allowed direct task adjacencies through XOR and counts skips and deviations', () => {
  const traces = tracesOf([row('1', 'A', 0), row('1', 'B', 1), row('2', 'A', 0), row('2', 'C', 1),
    row('3', 'A', 0), row('3', 'A', 1), row('4', 'A', 0), row('4', 'Other', 1)]);
  const result = engine.getBpmnComparison(traces, reference, []);
  expect(result).toMatchObject({ mappedActivityCount: 3, discoveredActivityCount: 4, mappedOccurrenceCount: 7,
    discoveredOccurrenceCount: 8, referenceOnlyTaskIds: [],
    adjacency: { status: 'supported', checkedTransitionCount: 3, skippedTransitionCount: 1, reason: null,
      deviations: [{ from: 'A', to: 'A', count: 1, caseKeys: [key('3')] }] } });
});

test('BPMN keeps mapping on unsupported structure and distinguishes duplicate task labels and overrides', () => {
  const traces = tracesOf([row('1', 'A', 0), row('1', 'B', 1)]);
  const duplicate = { ...reference, nodes: reference.nodes.map(item => item.id === 'C' ? { ...item, name: 'B' } : item) };
  const original = engine.getBpmnComparison(traces, duplicate, []);
  expect(original.mapping[1]).toMatchObject({ taskId: null, status: 'ambiguous', exactTaskIds: ['B', 'C'] });
  expect(original.adjacency).toMatchObject({ checkedTransitionCount: 0, skippedTransitionCount: 1 });
  expect(engine.getBpmnComparison(traces, duplicate, [{ activity: 'B', taskId: 'C' }])).toMatchObject({
    mapping: [{ status: 'exact' }, { status: 'mapped_by_user', taskId: 'C' }],
    referenceOnlyTaskIds: ['B'], adjacency: { checkedTransitionCount: 1, skippedTransitionCount: 0, deviations: [] },
  });
  const parallel = { ...reference, nodes: reference.nodes.map(item => item.id === 'split' ? node('split', 'unsupported') : item) };
  expect(engine.getBpmnComparison(traces, parallel, [{ activity: 'B', taskId: null }])).toMatchObject({
    mapping: [{ status: 'exact' }, { status: 'excluded_by_user', taskId: null }],
    adjacency: { status: 'unsupported', reason: 'unsupported_elements', checkedTransitionCount: null, skippedTransitionCount: null, deviations: [] },
  });
  const orphaned = { ...reference, nodes: [...reference.nodes, node('orphan', 'task')] };
  expect(engine.getBpmnComparison(traces, orphaned, []).adjacency.reason).toBe('unsupported_structure');
  expect(() => engine.getBpmnComparison(traces, reference, [{ activity: 'B', taskId: 's' }])).toThrow(RangeError);
  expect(() => engine.getBpmnComparison(traces, { ...reference, flows: flows(['s', 'unknown']) }, [])).toThrow(RangeError);
});

test('BPMN recognizes actual self-adjacency in a valid XOR cycle', () => {
  const cycle = {
    nodes: [node('s', 'start'), node('merge', 'xor'), node('A', 'task'), node('split', 'xor'), node('e', 'end')],
    flows: flows(['s', 'merge'], ['merge', 'A'], ['A', 'split'], ['split', 'merge'], ['split', 'e']),
  };
  expect(engine.getBpmnComparison(tracesOf([row('1', 'A', 0), row('1', 'A', 1)]), cycle, []).adjacency)
    .toEqual({ status: 'supported', reason: null, checkedTransitionCount: 1, skippedTransitionCount: 0, deviations: [] });
});

test('historical trends assign whole Order cases to case-first buckets and retain empty bins', () => {
  const traces = orderTraces();
  const anchorMs = traces[0].events[0].timestampMs;
  const output = engine.getHistoricalTrends(traces, { bucketMinutes: 5, anchorMs });
  expect(output.unavailable).toBeNull();
  expect(output.observationWindow).toEqual({ startMs: anchorMs, endMs: anchorMs + 16 * 60_000 + 1 });
  expect(output.buckets.map(bucket => [bucket.caseCount, bucket.meanElapsedMin, bucket.repeatN, bucket.repeatRatePct]))
    .toEqual([[2, 12.5, 2, 0], [0, null, 0, null], [0, null, 0, null], [1, 2, 1, 0]]);
  expect(output.buckets.map(bucket => bucket.elapsedCaseKeys)).toEqual([[key('001'), key('002')], [], [], [key('003')]]);
});

test('historical trends use a negative-side grid and separate start-only elapsed from repetition coverage', () => {
  const traces = tracesOf([row('1', 'A', -1, { lifecycle: 'start' }), row('1', 'A', 4), row('2', 'B', 1, { lifecycle: 'start' })]);
  const result = engine.getHistoricalTrends(traces, { bucketMinutes: 1, anchorMs: 0 });
  expect(result.buckets.map(bucket => [bucket.startMs, bucket.meanElapsedMin, bucket.repeatRatePct]))
    .toEqual([[-60_000, 5, 0], [0, null, null], [60_000, 0, null]]);
  expect(engine.getHistoricalTrends([], { bucketMinutes: 5, anchorMs: 0 }).unavailable).toBe('empty_scope');
  expect(engine.getHistoricalTrends(tracesOf([row('1', 'A', 0), row('2', 'B', 100_000)]),
    { bucketMinutes: 1, anchorMs: 0 }).unavailable).toBe('bucket_limit');
  expect(() => engine.getHistoricalTrends([], { bucketMinutes: 0, anchorMs: 0 })).toThrow(RangeError);
});
