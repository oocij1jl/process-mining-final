export { validateAndNormalize } from './ingestion';
export { groupCases } from './traces';
export { buildDFG, getCaseDurations, getVariants } from './discovery';
export { getPerformance } from './performance';
export { getResourceAnalysis } from './resources';
export { evaluateTargets, getKPIs } from './kpis';
export { getFindings } from './findings';
export { getGateInputs } from './audience';
export { simulateGateQueue } from './queue';

/** Kept for compatibility with the Phase 0 exports. */
export class EngineNotImplementedError extends Error {
  constructor(public readonly functionName: string) {
    super(`ProcessPilot engine function ${functionName} is not implemented yet.`);
    this.name = 'EngineNotImplementedError';
  }
}
