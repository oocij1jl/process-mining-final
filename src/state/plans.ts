/** Builds editable plan drafts from a selected scenario or a proposal-only design record. */
import type { AnalysisScope, Target } from '../contracts';
import { uid } from './store';
import type { DesignRecord, PlanRecord, PlanTask, ProviderKind, ScenarioRecord } from './types';
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
