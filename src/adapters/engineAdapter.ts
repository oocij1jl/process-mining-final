/**
 * UI ↔ engine boundary.
 *
 * Every page reaches the analysis engine through an `EngineApi` provider and
 * receives an `EngineResult` instead of a raw value. This lets the UI render
 * explicit "not implemented", "fixture unavailable" and error states while the
 * Codex engine is still in progress, and lets the final integration swap the
 * provider without touching page code.
 *
 * No analysis logic lives here.
 */
import * as engine from '../engine';
import { EngineNotImplementedError } from '../engine';

export type EngineApi = Pick<
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

export type EngineFunctionName = keyof EngineApi;

export const ENGINE_FUNCTIONS: readonly EngineFunctionName[] = [
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

export const realEngine: EngineApi = {
  validateAndNormalize: engine.validateAndNormalize,
  groupCases: engine.groupCases,
  buildDFG: engine.buildDFG,
  getVariants: engine.getVariants,
  getCaseDurations: engine.getCaseDurations,
  getPerformance: engine.getPerformance,
  getResourceAnalysis: engine.getResourceAnalysis,
  getKPIs: engine.getKPIs,
  getFindings: engine.getFindings,
  evaluateTargets: engine.evaluateTargets,
  getGateInputs: engine.getGateInputs,
  simulateGateQueue: engine.simulateGateQueue,
};

/** Calls one engine function and converts thrown errors into an explicit result state. */
export function callEngine<K extends EngineFunctionName>(
  api: EngineApi,
  fn: K,
  ...args: Parameters<EngineApi[K]>
): EngineResult<ReturnType<EngineApi[K]>> {
  try {
    const impl = api[fn] as unknown as (...a: Parameters<EngineApi[K]>) => ReturnType<EngineApi[K]>;
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
  build: (value: U) => Parameters<EngineApi[K]>,
): EngineResult<ReturnType<EngineApi[K]>> {
  if (upstream.status !== 'ok') return blocked(fn, upstream);
  return callEngine(api, fn, ...build(upstream.data));
}

export function okData<T>(result: EngineResult<T> | null | undefined): T | undefined {
  return result && result.status === 'ok' ? result.data : undefined;
}
