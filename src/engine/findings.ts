import type { Finding, FindingAnalysis, FindingRule, Target } from '../contracts';
import { audienceQueueEvidence } from './audience';
import { evaluateTargets } from './kpis';
import { targetEvidence } from './metrics';
import { resourceKeyForTrace } from './resource-identity';
import { assertProcessScope, hasRework, hasRepeatedActivity } from './traces';

export function getFindings(analysis: FindingAnalysis, targets: readonly Target[]): Finding[] {
  const { scope, traces, performance, resources, rework, metrics } = analysis;
  assertProcessScope(traces, scope.processKey);
  const findings: Finding[] = [];
  function record(rule: FindingRule, evidence: Omit<Finding, 'id' | 'scope' | 'rule' | 'definition'> & { definition: string }) {
    const edge = evidence.edge ? [evidence.edge.from, evidence.edge.to] : null;
    const id = JSON.stringify([scope.datasetId, scope.processKey, scope.analysisFilterFingerprint, rule, evidence.metricId, edge]);
    findings.push({ id, scope, rule, ...evidence });
  }

  for (const metricType of ['inter_event', 'matched_gap'] as const) {
    const gap = performance.gaps.filter(gap => gap.metricType === metricType && gap.to !== undefined && gap.n > 0)
      .sort((a, b) => b.meanMin - a.meanMin || b.n - a.n)[0];
    if (!gap || gap.to === undefined) continue;
    const label = metricType === 'matched_gap' ? 'matched transition gap' : 'inter-event gap';
    record('slow_transition', {
      metricId: metricType, value: gap.meanMin, unit: 'min', n: gap.n, caseKeys: gap.caseKeys,
      edge: { from: gap.from, to: gap.to },
      definition: metricType === 'matched_gap'
        ? 'Mean nonnegative gap from completion to the next adjacent discovered event’s matched start, for this transition.'
        : 'Mean time between consecutive discovery events for this transition.',
      ...(gap.n < 3 ? { support: 'low' } : {}),
      text: `${gap.from} → ${gap.to} has the largest mean ${label} in this selection.`,
      proposal: 'Review the contributing cases for possible handover delays, queues or resource access constraints.',
    });
  }

  const discovered = traces.filter(trace => trace.sequence.length);
  const explicit = new Set(rework?.explicitActivities);
  const repeated = new Set(rework?.repeatedActivities);
  const reworkCases = discovered.filter(trace => rework ? hasRework(trace, explicit, repeated) : hasRepeatedActivity(trace))
    .map(trace => trace.caseKey);
  if (reworkCases.length) {
    record('rework', {
      metricId: 'rework_case_rate', value: reworkCases.length / discovered.length * 100,
      unit: '%', n: discovered.length, eligible: traces.length, caseKeys: reworkCases,
      definition: rework
        ? 'Percentage of discovered cases with a configured rework activity or a repeated configured check.'
        : 'Percentage of cases with a nonempty discovery sequence that record any activity more than once.',
      text: rework ? 'Cases show configured rework activities or repeat configured checks.'
        : 'Cases record the same activity more than once.',
      proposal: 'Inspect repeated activity evidence and determine whether the repeats are expected.',
    });
  }

  const useInstances = resources.knownInstances > 0;
  const ranked = resources.resources.map(resource => ({
    resource, count: useInstances ? resource.instances : resource.rawEvents,
  })).sort((a, b) => b.count - a.count);
  const top = ranked[0];
  if (top?.count > 0) {
    const label = useInstances ? 'discovered instances' : 'raw events';
    const role = top.resource.roles.length ? ` (${top.resource.roles.join(', ')})` : '';
    const known = useInstances ? resources.knownInstances : resources.knownRawEvents;
    const total = useInstances ? resources.totalInstances : resources.totalRawEvents;
    const caseKeys = useInstances ? traces.filter(trace => {
      const resourceKey = resourceKeyForTrace(trace);
      return trace.sequence.some(event => resourceKey(event) === top.resource.resource);
    }).map(trace => trace.caseKey) : top.resource.caseKeys;
    record('workload', {
      metricId: useInstances ? 'resource_instance_count' : 'resource_raw_event_count',
      value: top.count, unit: useInstances ? 'instances' : 'events', n: known, eligible: total,
      caseKeys,
      definition: `Highest count of ${label} assigned to a known resource in the selected cases.`,
      text: `${top.resource.resource}${role} has the most ${label} among known resources. Resource coverage is ${known} of ${total}.`,
      proposal: 'Review activity mix, role requirements and shift capacity before changing assignments.',
    });
  }

  const audienceEvidence = audienceQueueEvidence(metrics);
  if (audienceEvidence) record('audience_queue', audienceEvidence);

  const evaluations = evaluateTargets(metrics, targets);
  const byId = new Map(metrics.map(metric => [metric.id, metric]));
  for (const [index, target] of targets.entries()) {
    if (evaluations[index].status !== 'breached') continue;
    const metric = byId.get(target.metricId);
    if (!metric || metric.value === null) continue;
    record(`target_${target.direction}`, {
      metricId: metric.id, value: metric.value, unit: metric.unit, n: metric.n, eligible: metric.eligible,
      definition: metric.definition,
      ...targetEvidence(metric, target.direction),
      text: `${metric.id} measured ${metric.value} ${metric.unit} against a ${target.direction === 'max' ? 'maximum' : 'minimum'} target of ${target.value} ${target.unit}.`,
      proposal: 'Review the linked evidence and coverage for this aggregate target.',
    });
  }

  return findings;
}
