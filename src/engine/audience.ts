import type { EventRow, Finding, GateInput, GateInputOptions, GateInputSelection, Metric, Trace } from '../contracts';
import { firstOccurrence, firstStart, matchLifecycle } from './traces';

const afterArrival = new Set([
  'Ticket Verification', 'Manual Ticket Check', 'Security Check', 'Additional Screening',
  'Wristband Check', 'Entry Complete', 'Entry Rejected',
]);

export function audienceTimeline(trace: Trace) {
  const arrival = firstOccurrence(trace, 'Join Entry Queue');
  const invalidEvents = new Map<EventRow, { code: string; message: string }>();
  if (arrival) {
    for (const event of trace.events) {
      if (afterArrival.has(event.activity) && event.timestampMs < arrival.timestampMs) {
        invalidEvents.set(event, {
          code: 'audience_event_before_arrival',
          message: `${event.activity} precedes Join Entry Queue for this attempt.`,
        });
      }
    }
  }

  const sequence = trace.sequence.filter(event => !invalidEvents.has(event));
  const firstVerificationStart = firstStart(trace, 'Ticket Verification');
  const verificationStart = firstVerificationStart && !invalidEvents.has(firstVerificationStart)
    ? firstVerificationStart : undefined;
  const scan = sequence.find(event => event.activity === 'Ticket Verification')
    ?? trace.events.find(event => event.activity === 'Ticket Verification' &&
      event.lifecycle === 'start' && !invalidEvents.has(event));
  const completed = sequence.filter(event => event.activity === 'Entry Complete');
  if (scan) {
    for (const event of completed) {
      if (event.timestampMs < scan.timestampMs) {
        invalidEvents.set(event, {
          code: 'entry_before_scan',
          message: 'Entry completion precedes ticket verification.',
        });
      }
    }
  }

  const completions = completed.filter(event => !invalidEvents.has(event));
  const rejections = sequence.filter(event => event.activity === 'Entry Rejected');
  if (completions.length && rejections.length) {
    for (const event of [...completions, ...rejections]) {
      invalidEvents.set(event, {
        code: 'conflicting_entry_outcome',
        message: 'This attempt has both an entry completion and a rejection.',
      });
    }
  }

  const completion = completions[0];
  const rejection = rejections[0];
  const outcome = completion && !rejection ? { type: 'completed' as const, event: completion }
    : rejection && !completion ? { type: 'rejected' as const, event: rejection } : undefined;
  return { arrival, verificationStart, outcome, invalidEvents };
}

export function getGateInputs(traces: readonly Trace[], options: GateInputOptions): GateInputSelection {
  if (!options.serviceActivity.trim()) throw new RangeError('Choose a service activity.');
  if (options.mode === 'assumed' && (!Number.isFinite(options.serviceSec) || options.serviceSec <= 0)) {
    throw new RangeError('Assumed service duration must be positive and finite.');
  }

  const inputs: GateInput[] = [];
  const exclusions: GateInputSelection['exclusions'] = [];
  let eligibleCases = 0;

  for (const trace of traces) {
    if (trace.processType !== 'audience') continue;
    eligibleCases++;
    const arrival = firstOccurrence(trace, 'Join Entry Queue');
    if (!arrival) {
      exclusions.push({ caseKey: trace.caseKey, reason: 'missing_arrival' });
      continue;
    }

    let serviceSec: number;
    if (options.mode === 'assumed') {
      serviceSec = options.serviceSec;
    } else {
      const servicePair = matchLifecycle(trace).pairs.find(({ start, complete }) =>
        start.activity === options.serviceActivity &&
        start.timestampMs >= arrival.timestampMs && complete.timestampMs > start.timestampMs);
      if (!servicePair) {
        exclusions.push({ caseKey: trace.caseKey, reason: 'missing_or_invalid_service' });
        continue;
      }
      serviceSec = (servicePair.complete.timestampMs - servicePair.start.timestampMs) / 1000;
    }
    inputs.push({ caseKey: trace.caseKey, arrivalMs: arrival.timestampMs, serviceSec, sourceOrder: arrival.sourceOrder });
  }

  inputs.sort((a, b) => a.arrivalMs - b.arrivalMs || a.sourceOrder - b.sourceOrder);
  return { inputs, eligibleCases, exclusions };
}

export function audienceQueueEvidence(metrics: readonly Metric[]): Omit<Finding, 'id' | 'scope'> | undefined {
  const wait = metrics.find(metric => metric.id === 'audience_queue_wait_mean');
  if (!wait || wait.value === null || wait.value <= 0) return undefined;
  return {
    metricId: wait.id, value: wait.value, unit: wait.unit, n: wait.n,
    eligible: wait.eligible, caseKeys: wait.caseKeys,
    text: 'Audience cases with valid queue and verification timestamps show a positive mean queue wait.',
    proposal: 'Compare adding a staffed gate with the modeled baseline using the same arrivals and service demands.',
  };
}
