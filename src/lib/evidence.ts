/** Evidence lookups over engine DTOs (presentation support only — no analysis). */
import type { Finding, Target } from '../contracts';

/**
 * The engine's target-breach finding for this target, if any. Its caseKeys are the
 * engine's problem-case evidence, which can differ from Metric.caseKeys.
 * v0.3 (I-1): uses the explicit `Finding.rule` when present. Findings produced
 * before I-1 have no rule; for those the rule is read from the deterministic ID
 * ([datasetId, processKey, filter, rule, metricId, edge]) as in Phase 2.
 */
export function targetBreachFinding(findings: readonly Finding[] | undefined, target: Target): Finding | undefined {
  const rule = `target_${target.direction}`;
  return findings?.find((f) => {
    if (f.metricId !== target.metricId) return false;
    if (f.rule) return f.rule === rule;
    try {
      const id: unknown = JSON.parse(f.id);
      return Array.isArray(id) && id[3] === rule;
    } catch {
      return false;
    }
  });
}
