import type { EventRow, FestivalKPIConfig, Trace } from '../contracts';
import type { EventEvidenceRef, FestivalReadinessLink } from '../v03-contracts';
import { parseTimestamp } from './ingestion';
import { assertProcessScope, firstOccurrence, firstStart } from './traces';

export type StageIndex = ReadonlyMap<string, Trace | null>;
type DeadlineSource = FestivalReadinessLink['equipmentDeadlineSource'];

function caseAttribute(trace: Trace, field: string): string | undefined {
  const values = new Set(trace.events.map(event => event.attrs[field]?.trim()).filter(Boolean));
  if (values.size === 1) return values.values().next().value;
}

function deadlineAttribute(trace: Trace, field: string): number | undefined {
  const values = new Set(trace.events.map(event => event.attrs[field]?.trim()).filter(Boolean).map(value => parseTimestamp(value)));
  if (values.size === 1) return values.values().next().value;
}

function performanceIdentity(trace: Trace) {
  const festivalId = caseAttribute(trace, 'festival_id') ?? null;
  const performanceId = caseAttribute(trace, 'performance_id') ?? null;
  const key = festivalId !== null && performanceId !== null ? JSON.stringify([festivalId, performanceId]) : null;
  return { festivalId, performanceId, key };
}

export function indexStageCases(traces: readonly Trace[]): StageIndex {
  const index = new Map<string, Trace | null>();
  for (const trace of traces) {
    if (trace.processType !== 'stage') continue;
    const { key } = performanceIdentity(trace);
    if (key !== null) index.set(key, index.has(key) ? null : trace);
  }
  return index;
}

export function resolveEquipmentStage(trace: Trace, stages: StageIndex | undefined) {
  const { festivalId, performanceId, key } = performanceIdentity(trace);
  const candidate = key === null ? undefined : stages?.get(key);
  const linkStatus: FestivalReadinessLink['linkStatus'] = key === null ? 'missing_key'
    : stages === undefined ? 'stage_scope_unavailable'
    : candidate === null ? 'ambiguous_stage'
    : candidate === undefined ? 'missing_stage' : 'linked';
  return { festivalId, performanceId, linkStatus, stage: candidate ?? undefined };
}

export function selectLinkedEquipment(traces: readonly Trace[], stages: StageIndex | undefined): Trace[] {
  return traces.filter(trace => trace.processType === 'equipment' && resolveEquipmentStage(trace, stages).stage !== undefined);
}

function readiness(readyEvent: EventRow | undefined, deadlineMs: number | undefined) {
  return {
    readyEvent, deadlineMs,
    onTime: readyEvent && deadlineMs !== undefined ? readyEvent.timestampMs <= deadlineMs : undefined,
  };
}

export function measureStageReadiness(trace: Trace) {
  return readiness(firstOccurrence(trace, 'Stage Ready'), deadlineAttribute(trace, 'scheduled_start'));
}

export function equipmentDeadlineSource(config: FestivalKPIConfig): DeadlineSource {
  return config.equipmentDeadline === 'linked_stage_setup_start' ? 'linked_stage_setup_start' : 'required_ready_at';
}

export function stageSetupStart(stage: Trace | undefined): EventRow | undefined {
  return stage ? firstStart(stage, 'Stage Setup') : undefined;
}

export function measureEquipmentReadiness(trace: Trace, source: DeadlineSource, setupStart: EventRow | undefined) {
  const deadline = source === 'linked_stage_setup_start' ? setupStart?.timestampMs : deadlineAttribute(trace, 'required_ready_at');
  return readiness(firstOccurrence(trace, 'Equipment Ready'), deadline);
}

function eventRef(event: EventRow | undefined): EventEvidenceRef | null {
  if (!event) return null;
  const { caseKey, timestampMs, sourceOrder } = event;
  return { caseKey, timestampMs, sourceOrder };
}

export function getFestivalReadinessLinks(
  traces: readonly Trace[], config: FestivalKPIConfig, processKey: 'stage' | 'equipment',
): FestivalReadinessLink[] {
  if (processKey !== 'stage' && processKey !== 'equipment') {
    throw new RangeError('Select Stage or Equipment before comparing Festival readiness.');
  }
  assertProcessScope(traces, processKey);
  const stageCandidates = processKey === 'stage' ? traces : config.linkedStageTraces;
  const stages = stageCandidates === undefined ? undefined : indexStageCases(stageCandidates);
  const equipmentCases = processKey === 'stage'
    ? selectLinkedEquipment(config.linkedEquipmentTraces ?? [], stages)
    : traces;
  const source = equipmentDeadlineSource(config);

  return equipmentCases.map(trace => {
    const { festivalId, performanceId, linkStatus, stage } = resolveEquipmentStage(trace, stages);
    const setupStart = stageSetupStart(stage);
    const stageMeasure = stage ? measureStageReadiness(stage) : undefined;
    const equipmentMeasure = measureEquipmentReadiness(trace, source, setupStart);
    return {
      festivalId, performanceId, linkStatus, equipmentCaseKey: trace.caseKey,
      stageCaseKey: stage?.caseKey ?? null,
      stageSetupStart: eventRef(setupStart),
      stageReady: eventRef(stageMeasure?.readyEvent),
      stageDeadlineMs: stageMeasure?.deadlineMs ?? null,
      stageOnTime: stageMeasure?.onTime ?? null,
      equipmentReady: eventRef(equipmentMeasure.readyEvent),
      equipmentDeadlineMs: equipmentMeasure.deadlineMs ?? null,
      equipmentDeadlineSource: source,
      equipmentOnTime: equipmentMeasure.onTime ?? null,
    };
  });
}
