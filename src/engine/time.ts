import type { EventWindow, TimeBucketOptions } from '../v03-contracts';
import type { Trace } from '../contracts';
import { MINUTE_MS } from './traces';

const maxDateMs = 8_640_000_000_000_000;
const maxIndex = BigInt(Number.MAX_SAFE_INTEGER);

export function validInstant(ms: number): boolean {
  return Number.isSafeInteger(ms) && Math.abs(ms) <= maxDateMs;
}

export function validateWindow({ startMs, endMs }: EventWindow) {
  if (!validInstant(startMs) || !Number.isSafeInteger(endMs) || endMs > maxDateMs + 1 || endMs <= startMs) {
    throw new RangeError('Use a valid nonempty UTC time window.');
  }
}

export function observationWindow(traces: readonly Trace[], firstEventsOnly = false): EventWindow | null {
  let first = Infinity;
  let last = -Infinity;
  for (const trace of traces) {
    const start = trace.events[0].timestampMs;
    first = Math.min(first, start);
    last = Math.max(last, firstEventsOnly ? start : trace.events[trace.events.length - 1].timestampMs);
  }
  return traces.length ? { startMs: first, endMs: last + 1 } : null;
}

export function bucketGrid({ bucketMinutes, anchorMs }: TimeBucketOptions) {
  const widthMs = bucketMinutes * MINUTE_MS;
  if (!Number.isSafeInteger(widthMs) || widthMs <= 0 || !validInstant(anchorMs)) {
    throw new RangeError('Use a positive whole-millisecond bucket width and a valid UTC anchor.');
  }
  const width = BigInt(widthMs);
  const anchor = BigInt(anchorMs);
  function index(ms: number): bigint {
    const offset = BigInt(ms) - anchor;
    const quotient = offset / width;
    return offset < 0n && offset % width !== 0n ? quotient - 1n : quotient;
  }
  return {
    widthMs,
    anchorResidue: Number((anchor % width + width) % width),
    dense(window: EventWindow) {
      const first = index(window.startMs);
      const last = index(window.endMs - 1);
      const size = last - first + 1n;
      const firstMs = Number(anchor + first * width);
      const lastEndMs = Number(anchor + (last + 1n) * width);
      if (size > 100_000n || first < -maxIndex || last > maxIndex ||
        !validInstant(firstMs) || !Number.isSafeInteger(lastEndMs) || lastEndMs > maxDateMs + 1) return null;
      return {
        slot: (ms: number) => Number(index(ms) - first),
        windows: Array.from({ length: Number(size) }, (_, i): EventWindow => {
          const start = anchor + (first + BigInt(i)) * width;
          return { startMs: Number(start), endMs: Number(start + width) };
        }),
      };
    },
  };
}
