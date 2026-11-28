/**
 * Implementation — Automation & Rollout. Separates what the log shows
 * (frequency, repeats, service time) from your assessment (suitability, risk,
 * difficulty, impact) and from estimates (score, benefit, ROI) computed by the
 * engine. Rollout plans keep owners, dates and status.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { ActivityEvidence, AutomationAssessment, BenefitInput, BenefitResult } from '../v03-contracts';
import { callEngine, hasCapability } from '../adapters/engineAdapter';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { planFromAutomation, planFromProposal } from '../state/plans';
import type { AutomationCandidate, BenefitDraft, PageId, PlanRecord, PlanTask, TaskStatus } from '../state/types';
import { downloadCSV, downloadJSON, slug } from '../lib/files';
import { fmtInstant, fmtMinutes, fmtNumber, plural } from '../lib/format';
import { RequireData } from '../components/layout';
import { ImpactMatrix } from '../components/ImpactMatrix';
import { OtherScopesNote } from '../components/WorkspaceHistory';
import { Badge, Button, Card, EmptyState, EngineGate, Field, InfoTip, Input, KeyValue, Notice, PageHeader, SectionLabel, Segmented, Select, Table, Td, Th, Unavailable, cx } from '../components/ui';
import { genericStale, scenarioStale } from './RefinePage';

const STATUS_LABEL: Record<TaskStatus, string> = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };

export function planExport(plan: PlanRecord) {
  const s = plan.source;
  return plan.tasks.map((t) => ({
    plan_id: plan.id,
    plan_revision: plan.revision,
    plan_state: plan.state,
    plan_source: s.kind,
    provider: plan.provider,
    scenario_id: s.kind === 'scenario' || s.kind === 'generic_scenario' ? s.scenarioId : '',
    gate_delta: s.kind === 'scenario' ? s.gateDelta : '',
    staff_delta: s.kind === 'scenario' ? s.staffDelta : s.kind === 'generic_scenario' ? s.staffingDelta ?? '' : '',
    server_delta: s.kind === 'generic_scenario' ? s.serverDelta : '',
    automation_candidate: s.kind === 'automation' ? s.candidateId : '',
    dataset_id: plan.scope.datasetId,
    process: plan.scope.processKey,
    filter: plan.scope.analysisFilterFingerprint,
    task: t.task,
    owner: t.owner,
    staffing: t.staffing,
    due_date: t.dueDate,
    status: t.status,
    evidence: t.evidence,
  }));
}

const EMPTY_ASSESSMENT: AutomationAssessment = { ruleBased: null, digitalReadiness: null, lowNeedForHumanJudgment: null, safetyRisk: null, implementationDifficulty: null };
const EMPTY_BENEFIT: BenefitDraft = {
  periodLabel: 'per month',
  currency: '',
  volume: null,
  eligibleShare: null,
  serviceSource: 'matched',
  assumedCurrentSec: null,
  expectedServiceSec: null,
  hourlyCost: null,
  realizationFraction: null,
  independentBenefit: null,
  initialCost: null,
  recurrentCost: null,
};

interface Row {
  activity: string;
  occurrences: number;
  cases: number;
  extra: number | null;
  serviceMeanMin: number | null;
  serviceTotalMin: number | null;
  serviceN: number;
  serviceEligible: number | null;
  evidence: ActivityEvidence | null;
}

export function ImplementationPage({ navigate }: { navigate: (p: PageId) => void }) {
  return (
    <div>
      <PageHeader
        phase="4 · Implementation"
        title="Automation and rollout"
        subtitle="Find activities worth automating, estimate the benefit with your own assumptions, and turn the decision into a rollout plan with owners and dates."
        actions={<Button variant="primary" iconRight="arrowRight" onClick={() => navigate('monitor')}>Track in Monitor</Button>}
      />
      <OtherScopesNote navigate={navigate} />
      <RequireData navigate={navigate}>
        <Content navigate={navigate} />
      </RequireData>
    </div>
  );
}

function Content({ navigate }: { navigate: (p: PageId) => void }) {
  const { activityEvidence, dfg, performance, api } = useAnalysis();
  const ws = useWorkspace()!;
  const [selected, setSelected] = useState<string | null>(null);
  const ae = activityEvidence?.status === 'ok' ? activityEvidence.data : null;

  const rows = useMemo<Row[]>(() => {
    if (ae) {
      return ae.activities.map((x) => ({
        activity: x.activity,
        occurrences: x.occurrenceCount,
        cases: x.occurrenceCaseKeys.length,
        extra: x.extraOccurrenceCount,
        serviceMeanMin: x.service.meanMin,
        serviceTotalMin: x.service.totalMin,
        serviceN: x.service.n,
        serviceEligible: x.service.eligible,
        evidence: x,
      }));
    }
    // Phase 2 fallback: DFG counts and matched service means only (no totals, no repeats).
    const gaps = performance?.status === 'ok' ? performance.data.gaps : [];
    return (dfg?.status === 'ok' ? dfg.data.nodes : []).map((n) => {
      const s = gaps.find((g) => g.metricType === 'service' && g.from === n.activity);
      return { activity: n.activity, occurrences: n.count, cases: n.caseKeys.length, extra: null, serviceMeanMin: s?.meanMin ?? null, serviceTotalMin: null, serviceN: s?.n ?? 0, serviceEligible: null, evidence: null };
    });
  }, [ae, dfg, performance]);

  const cands = ws.automation ?? [];
  const candFor = (a: string) => cands.find((c) => c.activity === a);
  const scoring = !!ae && hasCapability(api, 'scoreAutomation');
  const scores = useMemo(() => {
    const out = new Map<string, number | null>();
    if (!ae || !scoring) return out;
    for (const c of cands) {
      const r = callEngine(api, 'scoreAutomation', ae, c.activity, c.assessment);
      out.set(c.activity, r.status === 'ok' ? r.data.score : null);
    }
    return out;
  }, [ae, scoring, api, cands]);
  const sel = rows.find((r) => r.activity === selected) ?? null;

  return (
    <div className="mt-3 space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Automation opportunities" subtitle="From the log: how often each activity happens and how long it takes. Click an activity to assess it." bodyClassName="p-0">
          {!ae && <div className="px-4 pt-3"><EngineGate result={activityEvidence}>{() => null}</EngineGate></div>}
          {!ae && <p className="px-4 pt-2 text-[12px] text-slate-500">Showing frequency and average service time from the base analysis. Repeats, total service time and the score appear when the activity-evidence engine is available.</p>}
          <Table className="mt-2 max-h-[520px] rounded-none border-0 border-t">
            <thead>
              <tr>
                <Th>Activity</Th>
                <Th align="right">Times</Th>
                <Th align="right">Extra repeats</Th>
                <Th align="right">Avg service</Th>
                <Th align="right">Total service</Th>
                <Th>Your assessment</Th>
                <Th align="right">Score</Th>
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((a, b) => b.occurrences - a.occurrences).map((r) => {
                const c = candFor(r.activity);
                const assessed = c && c.assessment.ruleBased !== null && c.assessment.digitalReadiness !== null && c.assessment.lowNeedForHumanJudgment !== null;
                const review = c ? c.assessment.safetyRisk === 'high' || c.assessment.safetyRisk === null : false;
                const score = scores.get(r.activity);
                return (
                  <tr key={r.activity} onClick={() => setSelected(r.activity)} className={cx('cursor-pointer hover:bg-slate-50', selected === r.activity && 'bg-brand-50/70')}>
                    <Td className="font-medium text-slate-800">{r.activity}</Td>
                    <Td align="right">{r.occurrences}</Td>
                    <Td align="right">{r.extra ?? '—'}</Td>
                    <Td align="right">{r.serviceMeanMin === null ? <span className="text-slate-400">N/A</span> : <>{fmtMinutes(r.serviceMeanMin)} <span className="text-[11px] text-slate-400">n={r.serviceN}</span></>}</Td>
                    <Td align="right">{r.serviceTotalMin === null ? <span className="text-slate-400">—</span> : fmtMinutes(r.serviceTotalMin)}</Td>
                    <Td>
                      {!c ? <span className="text-xs text-slate-400">not assessed</span> : assessed ? <Badge tone="brand">assessed</Badge> : <Badge>partial</Badge>}
                      {c && review && <Badge tone="red" className="ml-1">review</Badge>}
                    </Td>
                    <Td align="right">{score === undefined || score === null ? <span className="text-slate-400">—</span> : <b>{fmtNumber(score, 1)}</b>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-4 py-2 text-[11.5px] text-slate-500">Service time is per activity instance from matched start/complete events (n = matched pairs). It is not staff utilization.</p>
        </Card>
        <div className="min-w-0">
          {sel ? <CandidateEditor key={sel.activity} row={sel} candidate={candFor(sel.activity)} navigate={navigate} /> : (
            <EmptyState icon="rocket" title="Choose an activity to assess">
              Rate how rule-based, digital-ready and judgment-free the step is, its safety risk and difficulty. The engine then scores it and estimates the benefit from your inputs.
            </EmptyState>
          )}
        </div>
      </div>

      <Card title="Impact vs difficulty" subtitle="Your ratings (1–5). High-risk or unassessed-risk items are flagged for human review and never auto-prioritized.">
        <ImpactMatrix
          items={cands.map((c) => ({ id: c.id, label: c.activity, impact: c.impact, difficulty: c.assessment.implementationDifficulty, review: c.assessment.safetyRisk === 'high' || c.assessment.safetyRisk === null }))}
          selected={sel ? candFor(sel.activity)?.id : null}
          onSelect={(id) => setSelected(cands.find((c) => c.id === id)?.activity ?? null)}
        />
      </Card>

      <Plans navigate={navigate} />
    </div>
  );
}

/* ------------------------------ Candidate editor ------------------------------ */

const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

function CandidateEditor({ row, candidate, navigate }: { row: Row; candidate?: AutomationCandidate; navigate: (p: PageId) => void }) {
  const { api, scope, provider, activityEvidence } = useAnalysis();
  const ws = useWorkspace()!;
  const { dispatch } = useStore();
  const [a, setA] = useState<AutomationAssessment>(candidate?.assessment ?? EMPTY_ASSESSMENT);
  const [impact, setImpact] = useState<number | null>(candidate?.impact ?? null);
  const [bd, setBd] = useState<BenefitDraft>(candidate?.benefit ?? EMPTY_BENEFIT);
  const ae = activityEvidence?.status === 'ok' ? activityEvidence.data : null;
  const scoreRes = useMemo(() => (ae ? callEngine(api, 'scoreAutomation', ae, row.activity, a) : null), [api, ae, row.activity, a]);
  const benefitInput = useMemo<BenefitInput>(() => ({
    kind: 'service_change',
    periodLabel: bd.periodLabel,
    currency: bd.currency.trim() ? bd.currency.trim().toUpperCase() : null,
    costs: { initial: bd.initialCost, recurrent: bd.recurrentCost },
    volume: bd.volume,
    eligibleShare: bd.eligibleShare,
    currentService: bd.serviceSource === 'matched' ? (row.evidence ? { source: 'matched', evidence: row.evidence } : null) : bd.assumedCurrentSec !== null ? { source: 'assumed', seconds: bd.assumedCurrentSec } : null,
    expectedServiceSec: bd.expectedServiceSec,
    hourlyCost: bd.hourlyCost,
    realizationFraction: bd.realizationFraction,
    ...(bd.independentBenefit !== null ? { independentBenefit: bd.independentBenefit } : {}),
  }), [bd, row.evidence]);
  const benefitRes = useMemo(() => callEngine(api, 'estimateBenefit', benefitInput), [api, benefitInput]);
  const score = scoreRes?.status === 'ok' ? scoreRes.data : null;
  const benefit = benefitRes.status === 'ok' ? benefitRes.data : null;

  const save = (): AutomationCandidate | null => {
    if (!scope) return null;
    const now = Date.now();
    const c: AutomationCandidate = {
      id: candidate?.id ?? uid('auto'),
      activity: row.activity,
      assessment: a,
      impact,
      benefit: bd,
      scoreSnapshot: score,
      benefitSnapshot: benefit,
      designId: candidate?.designId ?? ws.activeDesignId ?? null,
      planId: candidate?.planId ?? null,
      scope,
      provider,
      createdAt: candidate?.createdAt ?? now,
      updatedAt: now,
    };
    dispatch({ type: 'UPSERT_AUTOMATION', candidate: c });
    return c;
  };
  const toPlan = () => {
    const c = save();
    if (!c) return;
    const plan = planFromAutomation(c, ws.plans.length + 1);
    dispatch({ type: 'ADD_PLAN', plan, archiveOthers: false });
    dispatch({ type: 'UPSERT_AUTOMATION', candidate: { ...c, planId: plan.id } });
    dispatch({ type: 'TOAST', tone: 'success', message: 'Rollout plan created below.' });
    setTimeout(() => document.getElementById('pp-plans')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };
  const rate = (key: keyof AutomationAssessment, max: number, min = 0) => (
    <div className="flex gap-0.5" role="radiogroup">
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={a[key] === v} onClick={() => setA({ ...a, [key]: a[key] === v ? null : v })} className={cx('h-7 w-7 rounded-md border text-xs font-medium tabular', a[key] === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
          {v}
        </button>
      ))}
    </div>
  );
  const review = score ? score.requiresHumanReview : a.safetyRisk === 'high' || a.safetyRisk === null;

  return (
    <Card
      title={row.activity}
      subtitle={candidate ? `Assessment saved ${fmtInstant(candidate.updatedAt)}` : 'Not assessed yet'}
      actions={<Button size="sm" variant="primary" icon="save" onClick={() => { save(); dispatch({ type: 'TOAST', tone: 'success', message: 'Assessment saved.' }); }}>Save</Button>}
    >
      <div className="space-y-5">
        <section>
          <SectionLabel>From the log</SectionLabel>
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px]">
            <div><div className="text-[11px] text-slate-500">Times</div><b className="tabular">{row.occurrences}</b></div>
            <div><div className="text-[11px] text-slate-500">Avg service</div><b className="tabular">{fmtMinutes(row.serviceMeanMin)}</b><div className="text-[11px] text-slate-500">n = {row.serviceN}{row.serviceEligible !== null && ` of ${row.serviceEligible}`}</div></div>
            <div><div className="text-[11px] text-slate-500">Total service</div><b className="tabular">{row.serviceTotalMin === null ? '—' : fmtMinutes(row.serviceTotalMin)}</b></div>
          </div>
        </section>

        <section className="space-y-2">
          <SectionLabel right={<InfoTip>Your judgment, 0 (not at all) to 5 (fully). Leave unrated if unsure — nothing is filled in for you.</InfoTip>}>Your assessment</SectionLabel>
          <Rating label="Rule-based (clear rules, few exceptions)">{rate('ruleBased', 5)}</Rating>
          <Rating label="Digital readiness (inputs already digital)">{rate('digitalReadiness', 5)}</Rating>
          <Rating label="Low need for human judgment">{rate('lowNeedForHumanJudgment', 5)}</Rating>
          <Rating label="Safety / compliance risk">
            <Segmented size="sm" value={a.safetyRisk ?? 'none'} onChange={(v) => setA({ ...a, safetyRisk: v === 'none' ? null : v })} options={[{ id: 'none', label: '—' }, { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }]} />
          </Rating>
          <Rating label="Implementation difficulty (1–5)">{rate('implementationDifficulty', 5, 1)}</Rating>
          <Rating label="Expected impact (1–5)">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} type="button" aria-pressed={impact === v} onClick={() => setImpact(impact === v ? null : v)} className={cx('h-7 w-7 rounded-md border text-xs font-medium', impact === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>{v}</button>
              ))}
            </div>
          </Rating>
        </section>

        <section>
          <SectionLabel right={<InfoTip>Opportunity = average of (times ÷ most frequent activity) and (total service ÷ largest total), ×100; frequency only when service is unknown. Suitability = sum of the three ratings ÷ 15 ×100. Score = average of the two. Risk and difficulty are kept separate.</InfoTip>}>
            Candidate score (heuristic)
          </SectionLabel>
          {!ae ? (
            <Unavailable fn={hasCapability(api, 'getActivityEvidence') ? 'scoreAutomation' : 'getActivityEvidence'} compact />
          ) : scoreRes && scoreRes.status !== 'ok' ? (
            <EngineGate result={scoreRes}>{() => null}</EngineGate>
          ) : score ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-3">
                <ScoreBox label="Opportunity" value={fmtNumber(score.opportunityScore, 1)} sub={score.opportunityBasis === 'frequency_only' ? 'frequency only (no service data)' : 'frequency + service time'} />
                <ScoreBox label="Suitability" value={score.suitabilityScore === null ? '—' : fmtNumber(score.suitabilityScore, 1)} sub={score.suitabilityScore === null ? 'rate all three' : 'from your ratings'} />
                <ScoreBox label="Score" value={score.score === null ? '—' : fmtNumber(score.score, 1)} sub="of 100" strong />
              </div>
              <p className="text-[11px] text-slate-500 tabular">Denominators: most frequent activity = {score.occurrenceDenominator}; largest total service = {score.serviceTotalDenominatorMin === null ? 'n/a' : fmtMinutes(score.serviceTotalDenominatorMin)}.</p>
            </div>
          ) : null}
          {review && <Notice tone="warning" className="mt-2" title="Needs human review">{a.safetyRisk === 'high' ? 'High safety risk: do not remove or fully automate this step without a review.' : 'Safety risk not assessed yet.'}</Notice>}
        </section>

        <section className="space-y-2">
          <SectionLabel right={<InfoTip>Hours released = volume × eligible share × (current − expected seconds) ÷ 3600. Capacity value = hours × hourly cost (not necessarily cash). Benefit = capacity value × realization + other benefit. ROI = (benefit − cost) ÷ cost. Nothing is annualized or assumed for you.</InfoTip>}>
            Benefit estimate (your assumptions)
          </SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period"><Input value={bd.periodLabel} onChange={(e) => setBd({ ...bd, periodLabel: e.target.value })} /></Field>
            <Field label="Currency (e.g. KRW)"><Input value={bd.currency} maxLength={3} onChange={(e) => setBd({ ...bd, currency: e.target.value.toUpperCase() })} /></Field>
            <Field label="Cases in the period"><Input inputMode="numeric" value={bd.volume ?? ''} onChange={(e) => setBd({ ...bd, volume: num(e.target.value) })} /></Field>
            <Field label="Share automated (0–1)"><Input inputMode="decimal" value={bd.eligibleShare ?? ''} onChange={(e) => setBd({ ...bd, eligibleShare: num(e.target.value) })} /></Field>
            <Field label="Current service time">
              <Select value={bd.serviceSource} onChange={(e) => setBd({ ...bd, serviceSource: e.target.value as BenefitDraft['serviceSource'] })}>
                <option value="matched">From the log{row.serviceMeanMin !== null ? ` (${fmtMinutes(row.serviceMeanMin)})` : ' (none)'}</option>
                <option value="assumed">Assumed seconds</option>
              </Select>
            </Field>
            {bd.serviceSource === 'assumed' ? (
              <Field label="Current seconds"><Input inputMode="decimal" value={bd.assumedCurrentSec ?? ''} onChange={(e) => setBd({ ...bd, assumedCurrentSec: num(e.target.value) })} /></Field>
            ) : <div />}
            <Field label="Expected seconds after"><Input inputMode="decimal" value={bd.expectedServiceSec ?? ''} onChange={(e) => setBd({ ...bd, expectedServiceSec: num(e.target.value) })} /></Field>
            <Field label="Hourly cost"><Input inputMode="decimal" value={bd.hourlyCost ?? ''} onChange={(e) => setBd({ ...bd, hourlyCost: num(e.target.value) })} /></Field>
            <Field label="Realization (0–1)" hint="Share of released time that becomes money"><Input inputMode="decimal" value={bd.realizationFraction ?? ''} onChange={(e) => setBd({ ...bd, realizationFraction: num(e.target.value) })} /></Field>
            <Field label="Other benefit" hint="Not already counted above"><Input inputMode="decimal" value={bd.independentBenefit ?? ''} onChange={(e) => setBd({ ...bd, independentBenefit: num(e.target.value) })} /></Field>
            <Field label="One-time cost"><Input inputMode="decimal" value={bd.initialCost ?? ''} onChange={(e) => setBd({ ...bd, initialCost: num(e.target.value) })} /></Field>
            <Field label="Running cost (period)"><Input inputMode="decimal" value={bd.recurrentCost ?? ''} onChange={(e) => setBd({ ...bd, recurrentCost: num(e.target.value) })} /></Field>
          </div>
          {bd.serviceSource === 'matched' && !row.evidence && <p className="text-[11.5px] text-amber-700">Log-based service time needs the activity-evidence engine; choose “Assumed seconds” instead.</p>}
          <EngineGate result={benefitRes}>{(r) => <BenefitView r={r} currency={bd.currency} period={bd.periodLabel} />}</EngineGate>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          {candidate?.planId && <span className="mr-auto self-center text-xs text-slate-500">Linked plan exists</span>}
          <Button onClick={() => navigate('refine')}>Compare in value–effort</Button>
          <Button variant="primary" iconRight="arrowRight" onClick={toPlan}>Create rollout plan</Button>
        </div>
      </div>
    </Card>
  );
}

function Rating({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12.5px] text-slate-700">{label}</span>
      {children}
    </div>
  );
}

function ScoreBox({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className={cx('rounded-lg border px-2.5 py-2', strong ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200')}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular text-slate-900">{value}</div>
      <div className="text-[10.5px] leading-tight text-slate-500">{sub}</div>
    </div>
  );
}

const REASON: Record<NonNullable<BenefitResult['roiUnavailable']>, string> = {
  missing_currency: 'enter a currency',
  missing_benefit: 'needs hourly cost and realization (or another benefit)',
  missing_cost: 'enter both cost fields (0 if none)',
  zero_cost: 'total cost is zero',
};

function BenefitView({ r, currency, period }: { r: BenefitResult; currency: string; period: string }) {
  const money = (v: number | null) => (v === null ? '—' : `${fmtNumber(v, 0)} ${currency || ''}`.trim());
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <KeyValue
        dense
        items={[
          ['Current service', r.currentServiceSec === null ? '—' : `${fmtNumber(r.currentServiceSec, 1)} s`],
          ['Hours released', r.hoursReleased === null ? '—' : <span className={cx('font-semibold', r.hoursReleased < 0 && 'text-amber-700')}>{fmtNumber(r.hoursReleased, 2)} h {period}{r.hoursReleased < 0 && ' (slower)'}</span>],
          ['Capacity value', money(r.capacityValue)],
          ['Monetized benefit', money(r.monetizedBenefit)],
          ['Total cost', money(r.totalCost)],
          ['Net benefit', money(r.netBenefit)],
          ['ROI', r.roiPct === null ? <span className="text-slate-500">N/A — {r.roiUnavailable ? REASON[r.roiUnavailable] : 'not enough inputs'}</span> : <b>{fmtNumber(r.roiPct, 1)}%</b>],
        ]}
      />
      <p className="mt-1.5 text-[11px] text-slate-500">Estimate from your assumptions — potential benefit, not an observed saving. Waiting-time reductions are not counted as labor savings.</p>
    </div>
  );
}

/* ------------------------------ Rollout plans ------------------------------ */

function Plans({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace()!;
  const { scope, provider } = useAnalysis();
  const { dispatch } = useStore();
  const active = ws.plans.find((p) => p.id === ws.activePlanId) ?? null;
  const activeDesign = ws.designs.find((d) => d.id === ws.activeDesignId) ?? null;
  return (
    <section id="pp-plans" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Rollout plans</h2>
          <p className="text-[12.5px] text-slate-500">Owners, dates and status. Editing a plan never changes data or measured KPIs.</p>
        </div>
        <div className="flex gap-2">
          {activeDesign && scope && (
            <Button size="sm" onClick={() => { dispatch({ type: 'ADD_PLAN', plan: planFromProposal(activeDesign, scope, ws.plans.length + 1, provider), archiveOthers: false }); dispatch({ type: 'TOAST', tone: 'success', message: 'Qualitative plan created.' }); }} title={activeDesign.title}>
              Plan from design “{activeDesign.title.slice(0, 28)}{activeDesign.title.length > 28 ? '…' : ''}”
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate('refine')}>Plan from a scenario</Button>
        </div>
      </div>
      {!ws.plans.length ? (
        <EmptyState icon="rocket" title="No rollout plan yet">Create one from an assessed activity above, from a design, or from a scenario in Refine.</EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <Card bodyClassName="p-2">
            <ul className="space-y-1">
              {[...ws.plans].reverse().map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => dispatch({ type: 'SET_ACTIVE_PLAN', id: p.id })} className={cx('w-full rounded-lg border px-2.5 py-2 text-left', p.id === ws.activePlanId ? 'border-brand-400 bg-brand-50' : 'border-transparent hover:bg-slate-50')}>
                    <div className="line-clamp-2 text-[13px] font-medium">{p.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={p.state === 'current' ? 'green' : 'neutral'}>{p.state}</Badge>
                      <Badge tone="violet">{SOURCE_LABEL[p.source.kind]}</Badge>
                      {p.provider === 'ui_fixture' && <Badge tone="amber">UI fixture</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {active ? <PlanEditor plan={active} navigate={navigate} /> : <Card><p className="text-[13px] text-slate-500">Select a plan.</p></Card>}
        </div>
      )}
    </section>
  );
}

const SOURCE_LABEL: Record<PlanRecord['source']['kind'], string> = {
  scenario: 'gate scenario',
  generic_scenario: 'queue scenario',
  proposal_only: 'qualitative',
  automation: 'automation',
};

function PlanEditor({ plan, navigate }: { plan: PlanRecord; navigate: (p: PageId) => void }) {
  const { dispatch } = useStore();
  const ws = useWorkspace()!;
  const { scope, provider } = useAnalysis();
  const scopeStale = isScopeStale(plan.scope, scope);
  const providerMismatch = plan.provider !== provider;
  const editable = plan.state === 'current' && !scopeStale && !providerMismatch;
  const src = plan.source;
  const scenario = src.kind === 'scenario' ? ws.scenarios.find((s) => s.id === src.scenarioId) : undefined;
  const gscenario = src.kind === 'generic_scenario' ? ws.genericScenarios?.find((s) => s.id === src.scenarioId) : undefined;
  const scnStale = scenario ? scenarioStale(scenario, ws, scope, provider) : gscenario ? genericStale(gscenario, ws, scope, provider) : null;
  const design = ws.designs.find((d) => d.id === plan.designId);
  const done = plan.tasks.filter((t) => t.status === 'done').length;
  const upd = (taskId: string, patch: Partial<PlanTask>) => dispatch({ type: 'UPDATE_TASK', planId: plan.id, taskId, patch });

  return (
    <div className="min-w-0 space-y-3">
      {plan.state === 'archived' && <Notice tone="warning" title="Archived plan">Kept for export and traceability; not editable.</Notice>}
      {plan.state === 'current' && scopeStale && <Notice tone="warning" title="Created under a different scope">Read-only here; restore the original case scope to edit it.</Notice>}
      {providerMismatch && <Notice tone="warning" title={`Plan from provider “${plan.provider}”`}>Read-only and kept for export.</Notice>}
      {src.kind === 'proposal_only' && <Notice tone="info">Qualitative plan: no modeled effect is claimed.</Notice>}
      <Card
        title={editable ? <Input value={plan.title} onChange={(e) => dispatch({ type: 'UPDATE_PLAN', id: plan.id, patch: { title: e.target.value } })} className="!py-1 font-semibold" aria-label="Plan title" /> : plan.title}
        subtitle={`Revision ${plan.revision} · created ${fmtInstant(plan.createdAt)} · updated ${fmtInstant(plan.updatedAt)}`}
        actions={
          <>
            <Button size="sm" icon="download" onClick={() => downloadCSV(`plan-${slug(plan.title)}-rev${plan.revision}.csv`, planExport(plan))}>CSV</Button>
            <Button size="sm" icon="download" onClick={() => downloadJSON(`plan-${slug(plan.title)}-rev${plan.revision}.json`, { provider: plan.provider, scope: plan.scope, plan, scenario: scenario ?? gscenario ?? null, design: design ?? null })}>JSON</Button>
            {plan.state === 'current' && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'ARCHIVE_PLAN', id: plan.id })}>Archive</Button>}
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <KeyValue
            dense
            items={[
              ['Source', <Badge tone="violet">{SOURCE_LABEL[src.kind]}</Badge>],
              ['Design', design ? <button className="text-left text-brand-600 hover:underline" onClick={() => { dispatch({ type: 'SET_ACTIVE_DESIGN', id: design.id }); navigate('design'); }}>{design.title}</button> : '—'],
              ['Scenario', scenario || gscenario ? (scnStale ? <Badge tone="amber" title={scnStale}>changed since</Badge> : <Badge tone="green">current</Badge>) : '—'],
            ]}
          />
          <KeyValue
            dense
            items={
              src.kind === 'scenario'
                ? [['Gates', `${src.baselineGates} → ${src.candidateGates}`], ['Staffing', `${src.staffDelta > 0 ? '+' : ''}${src.staffDelta} (1 per gate)`]]
                : src.kind === 'generic_scenario'
                  ? [['Servers', `${src.baselineServers} → ${src.candidateServers}`], ['Staffing', src.staffingDelta === null ? 'not assumed' : `${src.staffingDelta > 0 ? '+' : ''}${src.staffingDelta}`]]
                  : src.kind === 'automation'
                    ? [['Activity', src.activity]]
                    : []
            }
          />
          <div>
            <div className="text-xs font-medium text-slate-500">Progress</div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${plan.tasks.length ? (done / plan.tasks.length) * 100 : 0}%` }} /></div>
            <div className="mt-1 text-xs text-slate-500 tabular">{done} of {plural(plan.tasks.length, 'task')} done</div>
          </div>
        </div>
      </Card>
      <Card
        title="Tasks"
        actions={editable && <Button size="sm" icon="plus" onClick={() => dispatch({ type: 'ADD_TASK', planId: plan.id, task: { id: uid('task'), task: 'New task', owner: '', staffing: '', dueDate: '', status: 'not_started', evidence: '' } })}>Add task</Button>}
        bodyClassName="p-0"
      >
        {plan.tasks.length === 0 ? <div className="p-4"><EmptyState title="No tasks" /></div> : (
          <Table className="rounded-none border-0">
            <thead><tr><Th>Task</Th><Th>Owner</Th><Th>Staffing</Th><Th>Due</Th><Th>Status</Th><Th>Evidence</Th><Th /></tr></thead>
            <tbody>
              {plan.tasks.map((t) => (
                <tr key={t.id}>
                  <Td className="min-w-[240px]">{editable ? <Input className="!py-1 text-xs" value={t.task} onChange={(e) => upd(t.id, { task: e.target.value })} aria-label="Task" /> : t.task}</Td>
                  <Td className="min-w-[110px]">{editable ? <Input className="!py-1 text-xs" placeholder="Unassigned" value={t.owner} onChange={(e) => upd(t.id, { owner: e.target.value })} aria-label="Owner" /> : t.owner || '—'}</Td>
                  <Td className="min-w-[140px]">{editable ? <Input className="!py-1 text-xs" value={t.staffing} onChange={(e) => upd(t.id, { staffing: e.target.value })} aria-label="Staffing" /> : t.staffing}</Td>
                  <Td>{editable ? <Input type="date" className="!py-1 text-xs" value={t.dueDate} onChange={(e) => upd(t.id, { dueDate: e.target.value })} aria-label="Due date" /> : t.dueDate || '—'}</Td>
                  <Td>
                    {editable ? (
                      <Select className="!w-auto min-w-[110px] !py-1 text-xs" value={t.status} onChange={(e) => upd(t.id, { status: e.target.value as TaskStatus })} aria-label="Status">
                        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </Select>
                    ) : <Badge tone={t.status === 'done' ? 'green' : t.status === 'blocked' ? 'red' : 'neutral'}>{STATUS_LABEL[t.status]}</Badge>}
                  </Td>
                  <Td className="min-w-[180px] text-xs text-slate-600">{editable ? <Input className="!py-1 text-xs" value={t.evidence} onChange={(e) => upd(t.id, { evidence: e.target.value })} aria-label="Evidence" /> : t.evidence}</Td>
                  <Td>{editable && <Button size="sm" variant="ghost" icon="x" onClick={() => dispatch({ type: 'REMOVE_TASK', planId: plan.id, taskId: t.id })} aria-label="Remove task" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
