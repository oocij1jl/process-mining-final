/**
 * UI ↔ engine boundary.
 *
 * Every page reaches the analysis engine through an `EngineApi` provider and
 * receives an `EngineResult` instead of a raw value. This lets the UI render
 * explicit "not available", "fixture unavailable" and error states, and lets
 * the integration swap the provider without touching page code.
 *
 * v0.3 (V03_CONTRACT §9): the 12 Phase 2 functions stay required. The v0.3
 * functions are optional capabilities (`Partial<V03EngineApi>`). When the
 * engine build does not export one yet, `callEngine` returns `not_implemented`
 * and the UI shows a clear "not available in this build" state. No fallback
 * values are fabricated.
 *
 * No analysis logic lives here.
 */
import * as engine from '../engine';
import { EngineNotImplementedError } from '../engine';
import type { V03EngineApi } from '../v03-contracts';

type CoreEngineApi = Pick<
  typeof engine,
  | 'validateAndNormalize'
  | 'groupCases'
  | 'buildDFG'
  | 'getVariants'
  | 'getCaseDurations'
  | 'getPerformance'
  | 'getResourceAnalysis'
  | 'getKPIs'
  | 'getFindings'
  | 'evaluateTargets'
  | 'getGateInputs'
  | 'simulateGateQueue'
>;

export type EngineApi = CoreEngineApi & Partial<V03EngineApi>;

export type EngineFunctionName = keyof EngineApi;
export type V03FunctionName = keyof V03EngineApi;

/** Phase 2 baseline inventory (required functions). */
export const ENGINE_FUNCTIONS: readonly (keyof CoreEngineApi)[] = [
  'validateAndNormalize',
  'groupCases',
  'buildDFG',
  'getVariants',
  'getCaseDurations',
  'getPerformance',
  'getResourceAnalysis',
  'getKPIs',
  'getFindings',
  'evaluateTargets',
  'getGateInputs',
  'simulateGateQueue',
];

/** v0.3 optional capabilities, in contract order (V03_CONTRACT §9). */
export const V03_FUNCTIONS: readonly V03FunctionName[] = [
  'importXes',
  'getActivityEvidence',
  'scoreAutomation',
  'estimateBenefit',
  'extractQueueInputs',
  'compareQueues',
  'getCaseThroughput',
  'getHistoricalTrends',
  'getTransitionDrift',
  'getPatternEvidence',
  'buildReplayIndex',
  'getReplayFrame',
  'getBpmnComparison',
];

/** Thrown by the UI fixture provider when it has no hand-authored value for an input. */
export class FixtureUnavailableError extends Error {
  constructor(
    public readonly functionName: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'FixtureUnavailableError';
  }
}

export type EngineResult<T> =
  | { status: 'ok'; fn: EngineFunctionName; data: T }
  | { status: 'not_implemented'; fn: EngineFunctionName; message: string }
  | { status: 'fixture_unavailable'; fn: EngineFunctionName; message: string }
  | { status: 'error'; fn: EngineFunctionName; message: string }
  /** An upstream step did not produce data, so this step was not attempted. */
  | { status: 'blocked'; fn: EngineFunctionName; message: string };

export type ProviderKind = 'engine' | 'ui_fixture';

/**
 * Bound from the engine module namespace, so verified v0.3 exports appear here
 * automatically once the engine branch adds them to src/engine/index.ts.
 * TypeScript checks each named export against `V03EngineApi`.
 */
export const realEngine: EngineApi = { ...engine };

type Fn<K extends EngineFunctionName> = NonNullable<EngineApi[K]>;
type Impl<K extends EngineFunctionName> = Fn<K> extends (...args: infer A) => infer R ? (...args: A) => R : never;
export type EngineArgs<K extends EngineFunctionName> = Parameters<Impl<K>>;
export type EngineReturn<K extends EngineFunctionName> = ReturnType<Impl<K>>;

/** True when the provider exports this function (optional v0.3 capabilities may be absent). */
export function hasCapability(api: EngineApi, fn: EngineFunctionName): boolean {
  return typeof api[fn] === 'function';
}

export const NOT_AVAILABLE_MESSAGE = 'This analysis is not available in the current engine build.';

/** Calls one engine function and converts thrown errors and absent capabilities into explicit result states. */
export function callEngine<K extends EngineFunctionName>(
  api: EngineApi,
  fn: K,
  ...args: EngineArgs<K>
): EngineResult<EngineReturn<K>> {
  const impl = api[fn] as unknown as ((...a: EngineArgs<K>) => EngineReturn<K>) | undefined;
  if (typeof impl !== 'function') {
    return { status: 'not_implemented', fn, message: NOT_AVAILABLE_MESSAGE };
  }
  try {
    return { status: 'ok', fn, data: impl(...args) };
  } catch (error) {
    if (error instanceof EngineNotImplementedError) {
      return { status: 'not_implemented', fn, message: error.message };
    }
    if (error instanceof FixtureUnavailableError) {
      return { status: 'fixture_unavailable', fn, message: error.message };
    }
    return {
      status: 'error',
      fn,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function blocked<T>(fn: EngineFunctionName, upstream: EngineResult<unknown>): EngineResult<T> {
  return {
    status: 'blocked',
    fn,
    message: `Waiting for ${upstream.fn} (${upstream.status.replace('_', ' ')}).`,
  };
}

/** Chains a dependent engine call only when the upstream result is available. */
export function chain<U, K extends EngineFunctionName>(
  upstream: EngineResult<U>,
  api: EngineApi,
  fn: K,
  build: (value: U) => EngineArgs<K>,
): EngineResult<EngineReturn<K>> {
  if (upstream.status !== 'ok') return blocked(fn, upstream);
  return callEngine(api, fn, ...build(upstream.data));
}

export function okData<T>(result: EngineResult<T> | null | undefined): T | undefined {
  return result && result.status === 'ok' ? result.data : undefined;
}
