export { importXes } from './xes';
export { validateAndNormalize } from './ingestion';
export { getBpmnComparison } from './bpmn-comparison';
export { scoreAutomation, estimateBenefit } from './automation';
export { buildReplayIndex, getReplayFrame } from './replay';
export { extractQueueInputs, compareQueues } from './generic-queue';
export { getTransitionDrift } from './transition-drift';
export { getPatternEvidence } from './patterns';
export { getCaseThroughput, getHistoricalTrends } from './history';
export { getActivityEvidence } from './activity-evidence';
export { groupCases } from './traces';
export { buildDFG, getCaseDurations, getVariants } from './discovery';
export { getPerformance } from './performance';
export { getResourceAnalysis } from './resources';
export { getFestivalReadinessLinks } from './festival-readiness';
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
