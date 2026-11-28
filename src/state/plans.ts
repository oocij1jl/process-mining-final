/** Builds editable plan drafts from a selected scenario or a proposal-only design record. */
import type { AnalysisScope, Target } from '../contracts';
import { uid } from './store';
import type { AutomationCandidate, DesignRecord, GenericScenarioRecord, PlanRecord, PlanTask, ProviderKind, ScenarioRecord } from './types';
import { fmtMinutes } from '../lib/format';

function task(partial: Omit<PlanTask, 'id' | 'owner' | 'dueDate' | 'status'>): PlanTask {
  return { id: uid('task'), owner: '', dueDate: '', status: 'not_started', ...partial };
}

export function planFromScenario(
  scenario: ScenarioRecord,
  design: DesignRecord | null,
  target: Target | undefined,
  revision: number,
): PlanRecord {
  const { baseline, candidate, params } = scenario;
  const gateDelta = candidate.gateCount - baseline.gateCount;
  const staffDelta = gateDelta; // one qualified worker per gate (documented assumption)
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const ref = `Scenario ${scenario.id} rev ${scenario.revision}`;
  const modeled = `modeled mean wait ${fmtMinutes(baseline.meanWaitMin)} → ${fmtMinutes(candidate.meanWaitMin)}, p95 ${fmtMinutes(baseline.p95WaitMin)} → ${fmtMinutes(candidate.p95WaitMin)}`;

  const tasks: PlanTask[] = [];
  if (gateDelta !== 0) {
    tasks.push(
      task({
        task: `${gateDelta > 0 ? 'Open' : 'Close'} ${Math.abs(gateDelta)} staffed entry gate(s): ${baseline.gateCount} → ${candidate.gateCount}`,
        staffing: `${sign(staffDelta)} qualified gate worker(s) (assumption: 1 per gate)`,
        evidence: `${ref}; ${modeled}`,
      }),
      task({
        task: `Confirm lane layout, scanners and equipment for ${candidate.gateCount} gate(s)`,
        staffing: '—',
        evidence: ref,
      }),
      task({
        task: `Brief gate workers on the ${params.serviceActivity} procedure`,
        staffing: `${Math.max(candidate.gateCount, 0)} worker(s) on shift (assumption)`,
        evidence: `Service demand: ${params.serviceMode === 'observed' ? 'observed matched service intervals' : `assumed ${params.assumedServiceSec} s per entrant`}`,
      }),
    );
  } else {
    tasks.push(
      task({ task: 'Review scenario: gate count unchanged', staffing: '±0', evidence: `${ref}; ${modeled}` }),
    );
  }
  tasks.push(
    task({
      task: 'Re-measure observed queue wait against the target after the next event log',
      staffing: '—',
      evidence: target
        ? `Target ${target.metricId} ${target.direction === 'max' ? '≤' : '≥'} ${target.value} ${target.unit}`
        : 'No KPI target saved in Model',
    }),
  );

  const now = Date.now();
  return {
    id: uid('plan'),
    revision,
    title: design ? `Action plan: ${design.title}` : `Action plan: gate scenario ${baseline.gateCount} → ${candidate.gateCount}`,
    source: {
      kind: 'scenario',
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      baselineGates: baseline.gateCount,
      candidateGates: candidate.gateCount,
      gateDelta,
      staffDelta,
    },
    designId: scenario.designId,
    scope: scenario.scope,
    // Inherited from the scenario: a fixture-computed scenario always yields a fixture plan.
    provider: scenario.provider,
    tasks,
    state: 'current',
    createdAt: now,
    updatedAt: now,
  };
}

export function planFromProposal(design: DesignRecord, scope: AnalysisScope, revision: number, provider: ProviderKind): PlanRecord {
  const activities = design.affectedActivities.length ? design.affectedActivities.join(', ') : 'the affected activities';
  const now = Date.now();
  return {
    id: uid('plan'),
    revision,
    title: `Proposal-only plan: ${design.title}`,
    source: { kind: 'proposal_only', designId: design.id },
    designId: design.id,
    scope,
    provider,
    tasks: [
      task({ task: `Investigate: ${design.title}`, staffing: 'To be decided', evidence: design.findingText.join(' | ') || 'Design record' }),
      task({ task: `Validate the change note with the owners of ${activities}`, staffing: '—', evidence: design.changeNote || '—' }),
      task({
        task: `Re-measure ${design.targetMetricId ?? 'the linked KPI'} after the next event log`,
        staffing: '—',
        evidence: 'No quantified effect claimed (proposal only)',
      }),
    ],
    state: 'current',
    createdAt: now,
    updatedAt: now,
  };
}

/** v0.3: plan from a generic queue scenario. Staffing changes only with the explicit one-worker assumption. */
export function planFromGenericScenario(scenario: GenericScenarioRecord, design: DesignRecord | null, revision: number): PlanRecord {
  const { baseline: b, candidate: c, serverDelta, staffingDelta } = scenario.comparison;
  const ref = `Queue scenario ${scenario.id} rev ${scenario.revision}`;
  const modeled = `modeled mean wait ${fmtMinutes(b.meanWaitMin)} → ${fmtMinutes(c.meanWaitMin)}, p95 ${fmtMinutes(b.p95WaitMin)} → ${fmtMinutes(c.p95WaitMin)}`;
  const tasks: PlanTask[] = [];
  if (serverDelta !== 0) {
    tasks.push(
      task({
        task: `${serverDelta > 0 ? 'Add' : 'Remove'} ${Math.abs(serverDelta)} server(s) for ${scenario.params.serviceMode === 'observed' ? scenario.params.serviceActivity : 'the service step'}: ${b.serverCount} → ${c.serverCount}`,
        staffing: staffingDelta === null ? 'Staffing not assumed (decide separately)' : `${staffingDelta > 0 ? '+' : ''}${staffingDelta} qualified worker(s) (assumption: 1 per server)`,
        evidence: `${ref}; ${modeled}`,
      }),
    );
  }
  if (scenario.comparison.candidateServiceMultiplier !== 1) {
    tasks.push(
      task({
        task: `Change service time to ×${scenario.comparison.candidateServiceMultiplier} of today (how: see design)`,
        staffing: '—',
        evidence: `${ref}; explicit service-time assumption`,
      }),
    );
  }
  if (!tasks.length) tasks.push(task({ task: 'Review scenario: no change modeled', staffing: '±0', evidence: `${ref}; ${modeled}` }));
  tasks.push(task({ task: 'Re-measure the observed waiting time after the next event log', staffing: '—', evidence: 'Modeled result, not an achieved benefit' }));
  const now = Date.now();
  return {
    id: uid('plan'),
    revision,
    title: design ? `Rollout: ${design.title}` : `Rollout: queue ${b.serverCount} → ${c.serverCount} servers`,
    source: {
      kind: 'generic_scenario',
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      baselineServers: b.serverCount,
      candidateServers: c.serverCount,
      serverDelta,
      staffingDelta,
    },
    designId: scenario.designId,
    scope: scenario.scope,
    provider: scenario.provider,
    tasks,
    state: 'current',
    createdAt: now,
    updatedAt: now,
  };
}

/** v0.3: plan from an automation candidate (assessment + engine score/benefit snapshots). */
export function planFromAutomation(c: AutomationCandidate, revision: number): PlanRecord {
  const now = Date.now();
  const review = c.scoreSnapshot?.requiresHumanReview ?? true;
  return {
    id: uid('plan'),
    revision,
    title: `Automation rollout: ${c.activity}`,
    source: { kind: 'automation', candidateId: c.id, activity: c.activity },
    designId: c.designId,
    scope: c.scope,
    provider: c.provider,
    tasks: [
      ...(review ? [task({ task: `Safety/risk review of automating “${c.activity}”`, staffing: 'Process owner + safety lead', evidence: c.assessment.safetyRisk ? `Risk rated ${c.assessment.safetyRisk}` : 'Risk not assessed' })] : []),
      task({ task: `Specify the automated or system-supported “${c.activity}”`, staffing: 'To be decided', evidence: c.scoreSnapshot?.score != null ? `Candidate score ${c.scoreSnapshot.score.toFixed(1)} / 100 (heuristic)` : 'No score' }),
      task({ task: 'Pilot with a subset of cases and keep a manual fallback', staffing: '—', evidence: c.benefitSnapshot?.hoursReleased != null ? `Estimated ${c.benefitSnapshot.hoursReleased.toFixed(2)} h released per ${c.benefit.periodLabel || 'period'} (assumption)` : 'Benefit not estimated' }),
      task({ task: 'Re-measure frequency and service time after the next event log', staffing: '—', evidence: 'Estimate, not an achieved saving' }),
    ],
    state: 'current',
    createdAt: now,
    updatedAt: now,
  };
}
