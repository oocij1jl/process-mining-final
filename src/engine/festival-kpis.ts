import type { EventRow, FestivalKPIConfig, KPIContext, Metric, ThroughputBucket, Trace } from '../contracts';
import { audienceTimeline } from './audience';
import {
  equipmentDeadlineSource, indexStageCases, measureEquipmentReadiness, measureStageReadiness,
  resolveEquipmentStage, selectLinkedEquipment, stageSetupStart,
} from './festival-readiness';
import type { StageIndex } from './festival-readiness';
import { caseMetric } from './metrics';
import { firstOccurrence, firstStart, hasRework, MINUTE_MS } from './traces';

function elapsedBetween(start?: EventRow, end?: EventRow): number | undefined {
  if (start && end && end.timestampMs >= start.timestampMs) {
    return (end.timestampMs - start.timestampMs) / MINUTE_MS;
  }
}

function onTimeValue(onTime: boolean | undefined): number | undefined {
  return onTime === undefined ? undefined : Number(onTime);
}

function equipmentReadiness(traces: readonly Trace[], config: FestivalKPIConfig, stages: StageIndex | undefined): Metric {
  const source = equipmentDeadlineSource(config);
  const linkedDeadline = source === 'linked_stage_setup_start';
  return caseMetric(
    'equipment_on_time_rate', '%',
    linkedDeadline ? 'Equipment Ready at or before the linked Stage Setup start.'
      : 'Equipment Ready at or before the explicit required_ready_at deadline.',
    linkedDeadline ? 'No equipment cases have both readiness and an unambiguous linked Stage Setup start.'
      : 'No equipment cases have both readiness and a valid required_ready_at deadline.',
    traces, 'rate', trace => {
      const setup = linkedDeadline ? stageSetupStart(resolveEquipmentStage(trace, stages).stage) : undefined;
      return onTimeValue(measureEquipmentReadiness(trace, source, setup).onTime);
    },
  );
}

function stageKPIs(traces: readonly Trace[], config: FestivalKPIConfig): Metric[] {
  const explicit = new Set(['Technical Recheck']);
  const repeated = new Set([config.technicalCheckRepeatActivity ?? 'Technical Check']);
  const metrics = [
    caseMetric(
      'stage_preparation_mean', 'min', 'Mean elapsed time from the first Stage Handover start to Stage Ready.',
      'No stage cases have valid handover and readiness timestamps.', traces, 'mean', trace => {
        const handover = firstStart(trace, 'Stage Handover')
          ?? (config.stageHandoverPointFallback ? firstOccurrence(trace, 'Stage Handover') : undefined);
        return elapsedBetween(handover, firstOccurrence(trace, 'Stage Ready'));
      },
    ),
    caseMetric(
      'stage_on_time_rate', '%', 'Stage Ready at or before scheduled_start among cases with both timestamps.',
      'No stage cases have both readiness and a valid scheduled_start.', traces, 'rate',
      trace => onTimeValue(measureStageReadiness(trace).onTime),
    ),
    caseMetric(
      'stage_recheck_rate', '%', 'Cases with Technical Recheck or repeated configured checks among discovered stage cases.',
      'No stage cases have a discovery sequence.', traces, 'rate',
      trace => trace.sequence.length ? Number(hasRework(trace, explicit, repeated)) : undefined,
    ),
  ];
  if (config.linkedEquipmentTraces) {
    const stages = indexStageCases(traces);
    const linkedEquipment = selectLinkedEquipment(config.linkedEquipmentTraces, stages);
    metrics.push(equipmentReadiness(linkedEquipment, config, stages));
  }
  return metrics;
}

function equipmentKPIs(traces: readonly Trace[], config: FestivalKPIConfig): Metric[] {
  const stages = config.linkedStageTraces === undefined ? undefined : indexStageCases(config.linkedStageTraces);
  return [
    caseMetric(
      'equipment_lead_time_mean', 'min', 'Mean elapsed time from Equipment Requested to Equipment Ready.',
      'No equipment cases have valid request and readiness timestamps.', traces, 'mean',
      trace => elapsedBetween(firstOccurrence(trace, 'Equipment Requested'), firstOccurrence(trace, 'Equipment Ready')),
    ),
    caseMetric(
      'equipment_substitution_rate', '%', 'Cases with Substitute Search among discovered equipment cases.',
      'No equipment cases have a discovery sequence.', traces, 'rate',
      trace => trace.sequence.length ? Number(Boolean(firstOccurrence(trace, 'Substitute Search'))) : undefined,
    ),
    caseMetric(
      'equipment_inspection_rework_rate', '%', 'Cases with Inspection Rework among discovered equipment cases.',
      'No equipment cases have a discovery sequence.', traces, 'rate',
      trace => trace.sequence.length ? Number(Boolean(firstOccurrence(trace, 'Inspection Rework'))) : undefined,
    ),
    equipmentReadiness(traces, config, stages),
    caseMetric(
      'equipment_unmatched_performance_count', 'cases',
      'Requests without an unambiguous stage match on festival_id and performance_id.',
      'Both equipment cases and the linked stage selection are required.', traces, 'count',
      trace => stages === undefined ? undefined : Number(resolveEquipmentStage(trace, stages).linkStatus !== 'linked'),
    ),
  ];
}

function entryThroughput(
  completed: ReadonlyMap<string, EventRow>,
  observed: { firstMs: number; lastMs: number },
  eligible: number,
  config?: KPIContext['throughput'],
): Metric {
  const base = { id: 'audience_throughput', unit: 'cases/bucket', eligible, problemCaseKeys: { min: null, max: null } };
  const widthMs = (config?.bucketMinutes ?? 0) * MINUTE_MS;
  if (!config || !Number.isSafeInteger(widthMs) || widthMs <= 0 || !Number.isSafeInteger(config.anchorMs)) {
    return {
      ...base, value: null, n: 0, caseKeys: [],
      definition: 'Completed entries per configured time bucket.',
      reason: 'Provide a valid bucket width and UTC anchor.',
    };
  }
  const definition = `Recorded completed entries per ${config.bucketMinutes}-minute bucket across the selected log observation span. Zero indicates no recorded completions. The log does not establish continuous collection or throughput outside its span.`;
  if (!Number.isFinite(observed.firstMs)) {
    return { ...base, value: null, n: 0, caseKeys: [], definition, reason: 'No valid arrival or known entry outcome establishes log coverage.', buckets: [] };
  }
  const bucketIndex = (timestampMs: number) => Math.floor((timestampMs - config.anchorMs) / widthMs);
  const startIndex = bucketIndex(observed.firstMs);
  const endIndex = bucketIndex(observed.lastMs);
  const bucketCount = endIndex - startIndex + 1;
  const bucketStart = (index: number) => config.anchorMs + index * widthMs;
  if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex) || bucketCount > 100_000 ||
      !Number.isSafeInteger(bucketStart(startIndex)) || !Number.isSafeInteger(bucketStart(endIndex + 1))) {
    return {
      ...base, value: null, n: 0, caseKeys: [], definition, buckets: [],
      reason: 'Choose a wider bucket or a smaller log scope to keep the series within its numeric and size limits.',
    };
  }
  const buckets = Array.from({ length: bucketCount }, (_, offset): ThroughputBucket => {
    const index = startIndex + offset;
    return { startMs: bucketStart(index), endMs: bucketStart(index + 1), count: 0, caseKeys: [] };
  });
  for (const [caseKey, event] of completed) {
    const bucket = buckets[bucketIndex(event.timestampMs) - startIndex];
    bucket.count++;
    bucket.caseKeys.push(caseKey);
  }
  return {
    ...base, value: completed.size / bucketCount, n: completed.size,
    definition, caseKeys: [...completed.keys()], buckets,
  };
}

function audienceKPIs(traces: readonly Trace[], context: KPIContext): Metric[] {
  const timelines = new Map<string, ReturnType<typeof audienceTimeline>>();
  const completed = new Map<string, EventRow>();
  const observed = { firstMs: Infinity, lastMs: -Infinity };
  for (const trace of traces) {
    const timeline = audienceTimeline(trace);
    timelines.set(trace.caseKey, timeline);
    const { arrival, outcome, invalidEvents } = timeline;
    if (outcome?.type === 'completed') completed.set(trace.caseKey, outcome.event);
    if (!arrival && !outcome) continue;
    for (const event of trace.events) {
      if (invalidEvents.has(event)) continue;
      observed.firstMs = Math.min(observed.firstMs, event.timestampMs);
      observed.lastMs = Math.max(observed.lastMs, event.timestampMs);
    }
  }

  const metrics = [
    caseMetric(
      'audience_queue_wait_mean', 'min', 'Mean elapsed time from Join Entry Queue to the first Ticket Verification start.',
      'No audience cases have valid queue arrival and verification start timestamps.', traces, 'mean',
      ({ caseKey }) => {
        const timeline = timelines.get(caseKey);
        return elapsedBetween(timeline?.arrival, timeline?.verificationStart);
      },
    ),
    caseMetric(
      'audience_entry_elapsed_mean', 'min', 'Mean elapsed time from Join Entry Queue to Entry Complete for successful entries.',
      'No completed entries have a valid queue arrival and completion.',
      traces.filter(trace => completed.has(trace.caseKey)), 'mean',
      ({ caseKey }) => elapsedBetween(timelines.get(caseKey)?.arrival, completed.get(caseKey)),
    ),
    caseMetric(
      'audience_manual_verification_rate', '%', 'Cases with Manual Ticket Check among discovered audience cases.',
      'No audience cases have a discovery sequence.', traces, 'rate',
      trace => {
        if (!trace.sequence.length) return undefined;
        const manual = trace.sequence.filter(event => event.activity === 'Manual Ticket Check');
        const invalid = timelines.get(trace.caseKey)?.invalidEvents;
        if (manual.some(event => !invalid?.has(event))) return 1;
        return manual.length ? undefined : 0;
      },
    ),
    entryThroughput(completed, observed, traces.length, context.throughput),
  ];
  for (const outcome of ['completed', 'rejected'] as const) {
    const observe = ({ caseKey }: Trace) => {
      const recorded = timelines.get(caseKey)?.outcome;
      return recorded ? Number(recorded.type === outcome) : undefined;
    };
    metrics.push(
      caseMetric(
        `audience_${outcome}_count`, 'cases', `Count of ${outcome} entries among cases with a known outcome.`,
        'No cases have a known entry outcome.', traces, 'count', observe,
      ),
      caseMetric(
        `audience_${outcome}_rate`, '%', `Share of ${outcome} entries among cases with a known outcome.`,
        'No cases have a known entry outcome.', traces, 'rate', observe,
      ),
    );
  }
  return metrics;
}

export function festivalKPIs(traces: readonly Trace[], context: KPIContext): Metric[] {
  if (!context.festival) return [];
  switch (context.processKey) {
    case 'stage': return stageKPIs(traces, context.festival);
    case 'equipment': return equipmentKPIs(traces, context.festival);
    case 'audience': return audienceKPIs(traces, context);
    default: return [];
  }
}
