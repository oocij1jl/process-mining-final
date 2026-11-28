import type { GateInput, QueueResult } from '../contracts';

interface Gate {
  index: number;
  ready: bigint;
}

function compareTicks(a: bigint, b: bigint): number {
  return a < b ? -1 : Number(a > b);
}

function compareGates(a: Gate, b: Gate): number {
  return compareTicks(a.ready, b.ready) || a.index - b.index;
}

function decimal(value: number, extraPlaces = 0) {
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  return { digits: BigInt(whole + fraction), places: fraction.length - Number(exponent) + extraPlaces };
}

// Scale decimal inputs before converting back to Number for the shared scheduler.
export function scaleServiceSeconds(seconds: number, multiplier: number): number {
  const duration = decimal(seconds);
  const factor = decimal(multiplier);
  return Number(`${duration.digits * factor.digits}e${-(duration.places + factor.places)}`);
}

export function simulateGateQueue(inputs: readonly GateInput[], gateCount: number): QueueResult {
  if (!Number.isInteger(gateCount) || gateCount < 1) {
    throw new RangeError('Gate count must be a positive integer.');
  }
  if (!inputs.length) throw new RangeError('At least one gate input is required.');
  if (inputs.some(input => !Number.isFinite(input.arrivalMs) || Math.abs(input.arrivalMs) > 8.64e15 ||
      !Number.isInteger(input.sourceOrder) || input.sourceOrder < 0 ||
      !Number.isFinite(input.serviceSec) || input.serviceSec <= 0)) {
    throw new RangeError('Gate inputs require valid arrivals, source order and positive service durations.');
  }

  const arrivals = [...inputs].sort((a, b) => a.arrivalMs - b.arrivalMs || a.sourceOrder - b.sourceOrder);
  const durations = arrivals.map(input => ({ arrival: decimal(input.arrivalMs, 3), service: decimal(input.serviceSec) }));
  // One tick is a decimal fraction of a second chosen to preserve every input.
  const places = durations.reduce((max, { arrival, service }) => Math.max(max, arrival.places, service.places), 0);
  const toTicks = (value: ReturnType<typeof decimal>) => value.digits * 10n ** BigInt(places - value.places);
  const toSeconds = (ticks: bigint) => Number(`${ticks}e-${places}`);
  const firstArrival = toTicks(durations[0].arrival);
  // More gates than entrants cannot affect the result.
  const gates: Gate[] = Array.from({ length: Math.min(gateCount, inputs.length) }, (_, index) => ({ index, ready: 0n }));
  const waits: bigint[] = [];
  let totalWait = 0n;
  let finish = 0n;

  for (const { arrival, service } of durations) {
    const gate = gates[0];
    const arrivalTime = toTicks(arrival) - firstArrival;
    const start = arrivalTime > gate.ready ? arrivalTime : gate.ready;
    const wait = start - arrivalTime;
    gate.ready = start + toTicks(service);
    if (gate.ready > finish) finish = gate.ready;
    waits.push(wait);
    totalWait += wait;

    // Updating the earliest gate only requires restoring the heap from its root.
    let parent = 0;
    while (2 * parent + 1 < gates.length) {
      const left = 2 * parent + 1;
      const right = left + 1;
      const child = right < gates.length && compareGates(gates[right], gates[left]) < 0 ? right : left;
      if (compareGates(gate, gates[child]) <= 0) break;
      gates[parent] = gates[child];
      parent = child;
    }
    gates[parent] = gate;
  }

  waits.sort(compareTicks);
  const finishSec = toSeconds(finish);
  if (!Number.isFinite(finishSec)) throw new RangeError('Modeled finish exceeds the numeric range.');
  const count = BigInt(inputs.length);
  const meanWaitSec = toSeconds(totalWait / count) + toSeconds(totalWait % count) / inputs.length;
  const throughput = finishSec > 0 ? inputs.length * 3600 / finishSec : null;
  if (throughput !== null && !Number.isFinite(throughput)) {
    throw new RangeError('Modeled throughput exceeds the numeric range.');
  }
  return {
    count: inputs.length,
    meanWaitMin: meanWaitSec / 60,
    p95WaitMin: toSeconds(waits[Math.ceil(waits.length * 0.95) - 1]) / 60,
    maxWaitMin: toSeconds(waits[waits.length - 1]) / 60,
    finishElapsedMin: finishSec / 60,
    throughputPerHour: throughput,
    gateCount,
  };
}
