import type { EventRow, GateInput, Trace } from '../contracts';
import type {
  QueueComparison, QueueComparisonOptions, QueueExclusionReason, QueueInputOptions, QueueInputSelection, ServerQueueResult,
} from '../v03-contracts';
import { scaleServiceSeconds, simulateGateQueue } from './queue';
import { assertProcessScope, compareEvents, matchLifecycle } from './traces';

function observedService(trace: Trace, activity: string, arrival: EventRow): number | QueueExclusionReason {
  const rows = trace.events.filter(event => event.activity === activity);
  if (!rows.length) return 'missing_service';
  if (rows.length > 2 || (rows.length === 2 && rows[0].lifecycle === rows[1].lifecycle)) return 'ambiguous_service';
  const pair = matchLifecycle(trace).pairs.find(({ start }) => start.activity === activity);
  if (!pair || pair.complete.timestampMs <= pair.start.timestampMs) return 'invalid_service';
  if (compareEvents(pair.start, arrival) < 0) return 'service_before_arrival';
  return (pair.complete.timestampMs - pair.start.timestampMs) / 1000;
}

export function extractQueueInputs(traces: readonly Trace[], { arrival, service }: QueueInputOptions): QueueInputSelection {
  assertProcessScope(traces);
  if (!arrival.activity.trim() || ![undefined, 'start', 'point', 'complete'].includes(arrival.lifecycle)) {
    throw new RangeError('Choose an arrival activity and a valid lifecycle if needed.');
  }
  if (service.mode === 'observed' ? !service.activity.trim() : !Number.isFinite(service.serviceSec) || service.serviceSec <= 0) {
    throw new RangeError('Choose an observed service activity or enter positive finite service seconds.');
  }

  const selection: QueueInputSelection = { inputs: [], eligibleCases: traces.length, exclusions: [] };
  for (const trace of traces) {
    const arrivals = (arrival.lifecycle === undefined ? trace.sequence : trace.events).filter(event =>
      event.activity === arrival.activity && (arrival.lifecycle === undefined || event.lifecycle === arrival.lifecycle));
    const { caseKey } = trace;
    if (arrivals.length !== 1) {
      selection.exclusions.push({ caseKey, reason: arrivals.length ? 'ambiguous_arrival' : 'missing_arrival' });
      continue;
    }
    const match = arrivals[0];
    const serviceSec = service.mode === 'assumed' ? service.serviceSec : observedService(trace, service.activity, match);
    if (typeof serviceSec !== 'number') selection.exclusions.push({ caseKey, reason: serviceSec });
    else selection.inputs.push({ caseKey, arrivalMs: match.timestampMs, serviceSec, sourceOrder: match.sourceOrder });
  }
  selection.inputs.sort((a, b) => a.arrivalMs - b.arrivalMs || a.sourceOrder - b.sourceOrder);
  return selection;
}

function run(inputs: readonly GateInput[], servers: number): ServerQueueResult {
  const { gateCount, ...result } = simulateGateQueue(inputs, servers);
  return { ...result, serverCount: gateCount };
}

export function compareQueues(inputs: readonly GateInput[], options: QueueComparisonOptions): QueueComparison {
  const { baselineServers, candidateServers, candidateServiceMultiplier = 1, assumeOneQualifiedWorkerPerServer } = options;
  if ([baselineServers, candidateServers].some(count => !Number.isSafeInteger(count) || count <= 0)) {
    throw new RangeError('Both server counts must be positive safe integers.');
  }
  if (!Number.isFinite(candidateServiceMultiplier) || candidateServiceMultiplier <= 0) {
    throw new RangeError('Candidate service multiplier must be positive and finite.');
  }
  if (typeof assumeOneQualifiedWorkerPerServer !== 'boolean') throw new RangeError('Specify the staffing assumption explicitly.');
  if (new Set(inputs.map(input => input.caseKey)).size !== inputs.length) throw new RangeError('Use one queue input per case.');
  const baseline = run(inputs, baselineServers);
  const candidateInputs = candidateServiceMultiplier === 1 ? inputs : inputs.map(input => {
    const serviceSec = scaleServiceSeconds(input.serviceSec, candidateServiceMultiplier);
    if (!Number.isFinite(serviceSec) || serviceSec <= 0) throw new RangeError('Transformed service duration exceeds the numeric range.');
    return { ...input, serviceSec };
  });

  const serverDelta = candidateServers - baselineServers;
  const candidate = !serverDelta && candidateInputs === inputs ? { ...baseline } : run(candidateInputs, candidateServers);
  return {
    baseline, candidate, candidateServiceMultiplier, serverDelta,
    staffingDelta: assumeOneQualifiedWorkerPerServer ? serverDelta : null,
  };
}
