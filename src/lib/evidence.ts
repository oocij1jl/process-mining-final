/** Evidence lookups over engine DTOs (presentation support only — no analysis). */
import type { Finding, Target } from '../contracts';

/**
 * The engine's target-breach finding for this target, if any. Its caseKeys are the
 * engine's problem-case evidence (e.g. the late cases of a breached minimum on-time
 * rate), which differ from Metric.caseKeys (the rate's numerator cases). The finding
 * has no rule field in the shared contract, so the rule is read from its
 * deterministic ID ([datasetId, processKey, filter, rule, metricId, edge]).
 */
export function targetBreachFinding(findings: readonly Finding[] | undefined, target: Target): Finding | undefined {
  return findings?.find((f) => {
    if (f.metricId !== target.metricId) return false;
    try {
      const id: unknown = JSON.parse(f.id);
      return Array.isArray(id) && id[3] === `target_${target.direction}`;
    } catch {
      return false;
    }
  });
}
