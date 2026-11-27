import type {
  CaseDuration,
  DFG,
  EventRow,
  Finding,
  FindingAnalysis,
  GateInput,
  GateInputOptions,
  GateInputSelection,
  ImportOptions,
  KPIContext,
  Metric,
  PerformanceAnalysis,
  QueueResult,
  RawRow,
  ResourceAnalysis,
  Target,
  TargetEvaluation,
  Trace,
  ValidationResult,
  Variant,
} from '../contracts';

export class EngineNotImplementedError extends Error {
  constructor(public readonly functionName: string) {
    super(`ProcessPilot engine function ${functionName} is not implemented yet.`);
    this.name = 'EngineNotImplementedError';
  }
}

// Phase 0 exposes the public signatures before the analysis implementations.
export function validateAndNormalize(
  _rows: readonly RawRow[],
  _options: ImportOptions,
): ValidationResult {
  throw new EngineNotImplementedError('validateAndNormalize');
}

export function groupCases(_events: readonly EventRow[]): Trace[] {
  throw new EngineNotImplementedError('groupCases');
}

export function buildDFG(_traces: readonly Trace[]): DFG {
  throw new EngineNotImplementedError('buildDFG');
}

export function getVariants(_traces: readonly Trace[]): Variant[] {
  throw new EngineNotImplementedError('getVariants');
}

export function getCaseDurations(_traces: readonly Trace[]): CaseDuration[] {
  throw new EngineNotImplementedError('getCaseDurations');
}

export function getPerformance(_traces: readonly Trace[]): PerformanceAnalysis {
  throw new EngineNotImplementedError('getPerformance');
}

export function getResourceAnalysis(_traces: readonly Trace[]): ResourceAnalysis {
  throw new EngineNotImplementedError('getResourceAnalysis');
}

export function getKPIs(_traces: readonly Trace[], _context: KPIContext): Metric[] {
  throw new EngineNotImplementedError('getKPIs');
}

export function getFindings(_analysis: FindingAnalysis, _targets: readonly Target[]): Finding[] {
  throw new EngineNotImplementedError('getFindings');
}

export function evaluateTargets(
  _metrics: readonly Metric[],
  _targets: readonly Target[],
): TargetEvaluation[] {
  throw new EngineNotImplementedError('evaluateTargets');
}

export function getGateInputs(
  _traces: readonly Trace[],
  _options: GateInputOptions,
): GateInputSelection {
  throw new EngineNotImplementedError('getGateInputs');
}

export function simulateGateQueue(_inputs: readonly GateInput[], _gateCount: number): QueueResult {
  throw new EngineNotImplementedError('simulateGateQueue');
}
