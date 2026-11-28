/**
 * Design — Redesign Strategy. Turns evidence-backed findings into an
 * improvement design: lever, problem, scope, measurable target, rationale and
 * assumptions. Suggestions are rule-based templates (no AI is involved).
 */
import { useEffect, useMemo, useState } from 'react';
import type { Finding, Target } from '../contracts';
import { hasCapability } from '../adapters/engineAdapter';
import { isScopeStale, useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { gateScenarioAvailable } from '../festival/adapter';
import { OtherScopesNote } from '../components/WorkspaceHistory';
import type { DesignRecord, DesignStatus, PageId, RedesignLever } from '../state/types';
import { displayResourceKeys, fmtInstant, fmtValue, plural, resourceLabel } from '../lib/format';
import { kpiName } from '../lib/kpiCatalog';
import { RequireData } from '../components/layout';
import { Icon } from '../components/icons';
import { Badge, Button, Card, EmptyState, Field, Input, Notice, PageHeader, Select, TextArea, cx } from '../components/ui';
import { designFromFinding, findingRule } from './analysis/inspector';
import { validateTarget } from './MonitorPage';

export const LEVERS: { id: RedesignLever; label: string; what: string; caution: string; template: (acts: string) => string }[] = [
  {
    id: 'eliminate',
    label: 'Eliminate',
    what: 'Remove a step that adds no value.',
    caution: 'Never remove safety, legal or quality checks on the basis of log data alone.',
    template: (a) => `Remove ${a} from the standard path if the owners confirm it adds no value to the customer or to compliance.`,
  },
  {
    id: 'simplify',
    label: 'Simplify',
    what: 'Make a step shorter or easier.',
    caution: 'Confirm the simpler step still meets the same requirements.',
    template: (a) => `Simplify ${a}: reduce inputs, approvals or hand-offs needed to complete it.`,
  },
  {
    id: 'automate',
    label: 'Automate',
    what: 'Let a system perform or support the step.',
    caution: 'Steps needing judgment or carrying safety risk need human review. Assess in Implementation.',
    template: (a) => `Automate or system-support ${a}; keep a human check for exceptions.`,
  },
  {
    id: 'parallelize',
    label: 'Parallelize',
    what: 'Run independent steps at the same time.',
    caution: 'Recorded order alone does not prove two steps are independent. Check dependencies with the owners.',
    template: (a) => `Run ${a} in parallel where the owners confirm the steps do not depend on each other.`,
  },
  {
    id: 'reallocate',
    label: 'Reallocate',
    what: 'Change who does the work or add capacity.',
    caution: 'Hand-over and workload counts do not show capacity or overload; check shifts and skills.',
    template: (a) => `Reassign or add qualified capacity for ${a} at peak periods.`,
  },
  {
    id: 'standardize',
    label: 'Standardize',
    what: 'Make everyone follow the same procedure.',
    caution: 'Variants can be legitimate; standardize only unwanted variation.',
    template: (a) => `Define one standard procedure for ${a} and a clear rule for exceptions.`,
  },
  {
    id: 'reorder',
    label: 'Reorder',
    what: 'Change the sequence of steps.',
    caution: 'Only reorder steps whose inputs are available earlier.',
    template: (a) => `Move ${a} earlier so problems are caught before downstream work starts.`,
  },
];

const STATUS_TONE: Record<DesignStatus, 'neutral' | 'blue' | 'green' | 'red'> = { draft: 'neutral', ready: 'blue', approved: 'green', rejected: 'red' };

/** Rule-based lever suggestion from the finding rule (presentation template, not analysis). */
function suggestedLevers(f: Finding | undefined): RedesignLever[] {
  switch (f ? findingRule(f) : undefined) {
    case 'slow_transition':
      return ['simplify', 'reallocate', 'automate'];
    case 'rework':
      return ['standardize', 'reorder', 'simplify'];
    case 'workload':
      return ['reallocate', 'automate'];
    case 'audience_queue':
      return ['reallocate', 'simplify'];
    default:
      return [];
  }
}

export function DesignPage({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace();
  const { scope, findings, kpis } = useAnalysis();
  const { dispatch, state } = useStore();
  const active = ws?.designs.find((d) => d.id === ws.activeDesignId) ?? null;
  const fs = findings?.status === 'ok' ? findings.data : [];
  const metrics = kpis?.status === 'ok' ? kpis.data : [];
  const gate = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);

  const newBlank = () => {
    if (!scope) return;
    const now = Date.now();
    dispatch({
      type: 'UPSERT_DESIGN',
      design: {
        id: uid('design'),
        title: 'New improvement',
        findingIds: [],
        findingText: [],
        changeNote: '',
        affectedActivities: [],
        targetMetricId: null,
        asIsBpmnRef: null,
        toBeBpmnRef: null,
        kind: 'proposal_only',
        status: 'draft',
        scope,
        createdAt: now,
        updatedAt: now,
        lever: null,
        problem: '',
        rationale: '',
        assumptions: '',
        affectedResources: [],
        evaluation: 'qualitative',
      },
    });
  };

  return (
    <div>
      <PageHeader
        phase="2 · Design"
        title="Redesign strategy"
        subtitle="Pick a finding, choose how to change the process, and state a measurable goal. Every design keeps its evidence cases."
        actions={
          <>
            <Button variant="ghost" icon="plus" onClick={newBlank} disabled={!scope}>Blank design</Button>
            {active && <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('model')}>Draw the To-be model</Button>}
          </>
        }
      />
      <OtherScopesNote navigate={navigate} />
      <RequireData navigate={navigate}>
        <div className="mt-3 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card title="Start from evidence" subtitle="Findings from the current analysis" bodyClassName="p-2">
              {fs.length === 0 ? (
                <p className="p-2 text-[13px] text-slate-500">No findings in this scope. Start a blank design or explore the map first.</p>
              ) : (
                <ul className="space-y-1">
                  {fs.map((f) => {
                    const linked = ws?.designs.some((d) => d.findingIds.includes(f.id));
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const existing = ws?.designs.find((d) => d.findingIds.includes(f.id));
                            if (existing) dispatch({ type: 'SET_ACTIVE_DESIGN', id: existing.id });
                            else if (scope) dispatch({ type: 'UPSERT_DESIGN', design: designFromFinding(f, metrics, gate) });
                          }}
                          className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
                        >
                          <div className="line-clamp-2 text-[13px] font-medium text-slate-800">{displayResourceKeys(f.text)}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                            {kpiName(f.metricId)} · {fmtValue(f.value, f.unit)} · {plural(f.caseKeys.length, 'case')}
                            {f.support === 'low' && <Badge tone="amber">low support</Badge>}
                            {linked && <Badge tone="brand">has design</Badge>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="Designs" subtitle="Saved for this dataset, process and case scope" bodyClassName="p-2">
              {!ws?.designs.length ? (
                <p className="p-2 text-[13px] text-slate-500">No designs yet.</p>
              ) : (
                <ul className="space-y-1">
                  {ws.designs.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'SET_ACTIVE_DESIGN', id: d.id })}
                        className={cx('w-full rounded-lg border px-2.5 py-2 text-left transition', d.id === ws.activeDesignId ? 'border-brand-400 bg-brand-50' : 'border-transparent hover:bg-slate-50')}
                      >
                        <div className="line-clamp-2 text-[13px] font-medium text-slate-800">{d.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                          {d.lever && <Badge tone="violet">{LEVERS.find((l) => l.id === d.lever)?.label}</Badge>}
                          <Badge>{(d.evaluation ?? (d.kind === 'simulation' ? 'quantitative' : 'qualitative')) === 'quantitative' ? 'quantitative' : 'qualitative'}</Badge>
                          {isScopeStale(d.scope, scope) && <Badge tone="amber">other scope</Badge>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="min-w-0">
            {active ? (
              <DesignEditor key={active.id} design={active} navigate={navigate} />
            ) : (
              <EmptyState
                icon="pen"
                title="Choose a finding to start a design"
                action={<Button variant="primary" onClick={() => navigate('analysis')}>Explore the process map</Button>}
              >
                Each design links a problem you found in the log to a change lever and a measurable goal. Pick a finding on the left, or start a blank design.
              </EmptyState>
            )}
          </div>
        </div>
      </RequireData>
    </div>
  );
}

function DesignEditor({ design, navigate }: { design: DesignRecord; navigate: (p: PageId) => void }) {
  const { dispatch, state } = useStore();
  const ws = useWorkspace();
  const { findings, dfg, kpis, scope, resources, api } = useAnalysis();
  const [draft, setDraft] = useState(design);
  useEffect(() => setDraft(design), [design]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(design);
  const activities = dfg?.status === 'ok' ? dfg.data.nodes.map((n) => n.activity) : [];
  const resourceKeys = resources?.status === 'ok' ? resources.data.resources.map((r) => r.resource) : [];
  const metrics = useMemo(() => (kpis?.status === 'ok' ? kpis.data : []), [kpis]);
  const allFindings = findings?.status === 'ok' ? findings.data : [];
  const linkedFinding = allFindings.find((f) => draft.findingIds.includes(f.id));
  const gate = gateScenarioAvailable(state.dataset?.festival, scope?.processKey);
  const genericQueue = hasCapability(api, 'extractQueueInputs') && hasCapability(api, 'compareQueues');
  const quantAvailable = gate || genericQueue;
  const evaluation = draft.evaluation ?? (draft.kind === 'simulation' ? 'quantitative' : 'qualitative');
  const titleInvalid = !draft.title.trim();
  const suggestions = suggestedLevers(linkedFinding);
  const lever = LEVERS.find((l) => l.id === draft.lever);
  const metric = metrics.find((m) => m.id === draft.targetMetricId);
  const savedTarget = ws?.targets.find((t) => t.metricId === draft.targetMetricId);
  const [targetText, setTargetText] = useState(savedTarget ? String(savedTarget.value) : '');
  const [targetDir, setTargetDir] = useState<Target['direction']>(savedTarget?.direction ?? 'max');
  useEffect(() => {
    setTargetText(savedTarget ? String(savedTarget.value) : '');
    setTargetDir(savedTarget?.direction ?? 'max');
  }, [savedTarget, draft.targetMetricId]);
  const targetCheck = targetText ? validateTarget(targetText, metric?.unit ?? '') : {};

  const save = () => {
    const linked = allFindings.filter((f) => draft.findingIds.includes(f.id));
    dispatch({
      type: 'UPSERT_DESIGN',
      design: {
        ...draft,
        title: draft.title.trim(),
        findingText: linked.length ? linked.map((f) => f.text) : draft.findingText,
        kind: evaluation === 'quantitative' ? 'simulation' : 'proposal_only',
        evaluation,
        updatedAt: Date.now(),
      },
    });
    if (metric && targetCheck.value !== undefined) {
      dispatch({ type: 'SET_TARGET', target: { metricId: metric.id, value: targetCheck.value, unit: metric.unit, direction: targetDir, ...(metric.definitionKey ? { definitionKey: metric.definitionKey } : {}) } });
    }
    dispatch({ type: 'TOAST', tone: 'success', message: 'Design saved.' });
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const actsText = draft.affectedActivities.length ? draft.affectedActivities.map((a) => `“${a}”`).join(', ') : 'the affected step';

  return (
    <div className="space-y-4">
      {isScopeStale(design.scope, scope) && <Notice tone="warning">Created under a different case scope. Its evidence describes that scope, not the current one.</Notice>}
      <Card
        title={
          <Input
            value={draft.title}
            invalid={titleInvalid}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="!border-transparent !px-1 !text-[16px] !font-semibold !shadow-none hover:!border-slate-200 focus:!border-brand-500"
            aria-label="Design title"
          />
        }
        subtitle={<>Created {fmtInstant(design.createdAt)} · updated {fmtInstant(design.updatedAt)}</>}
        actions={
          <>
            <Select className="!w-auto !py-1 text-xs" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DesignStatus })} aria-label="Status">
              {(['draft', 'ready', 'approved', 'rejected'] as const).map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => confirm('Delete this design?') && dispatch({ type: 'DELETE_DESIGN', id: design.id })} aria-label="Delete design" />
            <Button size="sm" variant="primary" icon="save" disabled={!dirty && !(metric && targetCheck.value !== undefined && targetCheck.value !== savedTarget?.value) || titleInvalid} onClick={save}>
              {dirty ? 'Save' : 'Saved'}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* 1 Problem */}
          <section>
            <StepTitle n={1} title="Problem" hint="What did the evidence show?" />
            {linkedFinding ? (
              <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px]">
                <div className="font-medium text-slate-800">{displayResourceKeys(linkedFinding.text)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-slate-500 tabular">
                  <span>{kpiName(linkedFinding.metricId)}: {fmtValue(linkedFinding.value, linkedFinding.unit)}</span>
                  <span>n = {linkedFinding.n}</span>
                  <button
                    type="button"
                    className="font-medium text-brand-600 hover:underline"
                    onClick={() => {
                      dispatch({ type: 'SET_VIEW', view: { analysisFocus: { mode: linkedFinding.edge ? 'performance' : 'frequency', edge: linkedFinding.edge, findingId: linkedFinding.id } } });
                      navigate('analysis');
                    }}
                  >
                    {plural(linkedFinding.caseKeys.length, 'evidence case')} on the map →
                  </button>
                </div>
              </div>
            ) : draft.findingText.length ? (
              <Notice tone="neutral" className="mb-2">Linked finding is not in the current scope (kept as reference): {draft.findingText.join(' | ')}</Notice>
            ) : null}
            <TextArea rows={2} value={draft.problem ?? ''} onChange={(e) => setDraft({ ...draft, problem: e.target.value })} placeholder="Describe the problem in your own words." aria-label="Problem statement" />
          </section>

          {/* 2 Lever */}
          <section>
            <StepTitle n={2} title="How will you change it?" hint="Choose one redesign lever" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {LEVERS.map((l) => {
                const sel = draft.lever === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setDraft({ ...draft, lever: sel ? null : l.id })}
                    className={cx('relative rounded-lg border px-3 py-2 text-left transition', sel ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300')}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[13px] font-semibold text-slate-800">{l.label}</span>
                      {suggestions.includes(l.id) && <Badge tone="violet" title="Suggested by a fixed rule for this type of finding">suggested</Badge>}
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{l.what}</div>
                  </button>
                );
              })}
            </div>
            {lever && (
              <Notice tone="warning" className="mt-2" title={`Check before you ${lever.label.toLowerCase()}`}>
                {lever.caution}
              </Notice>
            )}
            {suggestions.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">“Suggested” comes from a fixed rule per finding type, not from AI or a prediction.</p>}
          </section>

          {/* 3 Scope */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <StepTitle n={3} title="Affected steps" hint="Activities this design changes" />
              <div className="flex flex-wrap gap-1">
                {activities.map((a) => (
                  <Chip key={a} on={draft.affectedActivities.includes(a)} onClick={() => setDraft({ ...draft, affectedActivities: toggle(draft.affectedActivities, a) })}>{a}</Chip>
                ))}
                {draft.affectedActivities.filter((a) => !activities.includes(a)).map((a) => <Chip key={a} on onClick={() => setDraft({ ...draft, affectedActivities: toggle(draft.affectedActivities, a) })}>{a} (not in scope)</Chip>)}
              </div>
            </div>
            <div>
              <div className="mb-2 mt-[2px] text-[13px] font-semibold text-slate-800">Affected people / resources <span className="font-normal text-slate-400">(optional)</span></div>
              {resourceKeys.length ? (
                <div className="flex flex-wrap gap-1">
                  {resourceKeys.map((r) => (
                    <Chip key={r} on={(draft.affectedResources ?? []).includes(r)} onClick={() => setDraft({ ...draft, affectedResources: toggle(draft.affectedResources ?? [], r) })}>{resourceLabel(r)}</Chip>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-slate-500">This log records no resources.</p>
              )}
            </div>
          </section>

          {/* 4 Goal */}
          <section>
            <StepTitle n={4} title="Measurable goal" hint="Choose a KPI that ProcessPilot can measure for this process" />
            <div className="grid gap-3 md:grid-cols-[1.4fr_0.6fr_0.8fr]">
              <Field label="KPI">
                <Select value={draft.targetMetricId ?? ''} onChange={(e) => setDraft({ ...draft, targetMetricId: e.target.value || null })}>
                  <option value="">— choose a KPI —</option>
                  {metrics.map((m) => <option key={m.id} value={m.id}>{kpiName(m.id)}</option>)}
                  {draft.targetMetricId && !metric && <option value={draft.targetMetricId}>{draft.targetMetricId} (not available now)</option>}
                </Select>
              </Field>
              <Field label="Direction">
                <Select value={targetDir} disabled={!metric} onChange={(e) => setTargetDir(e.target.value as Target['direction'])}>
                  <option value="max">at most</option>
                  <option value="min">at least</option>
                </Select>
              </Field>
              <Field label={`Target${metric ? ` (${metric.unit})` : ''}`} error={targetCheck.error ?? null}>
                <Input value={targetText} disabled={!metric} inputMode="decimal" invalid={!!targetCheck.error} onChange={(e) => setTargetText(e.target.value)} placeholder="value" />
              </Field>
            </div>
            {metric ? (
              <p className="mt-1.5 text-[12px] text-slate-500">
                Measured now: <b className="text-slate-700">{fmtValue(metric.value, metric.unit)}</b> (n = {metric.n} of {metric.eligible}). {metric.definition}
                {metric.value === null && ' No value can be measured now, so the target will show as unknown.'}
              </p>
            ) : (
              <p className="mt-1.5 text-[12px] text-slate-500">
                {linkedFinding && !metrics.some((m) => m.id === linkedFinding.metricId)
                  ? `The finding’s measure (${kpiName(linkedFinding.metricId)}) is an observation, not a KPI with a target. Choose a KPI above or leave the goal qualitative.`
                  : 'No KPI selected. The goal is then described in the rationale only.'}
              </p>
            )}
            <p className="mt-1 text-[11px] text-slate-400">The target is saved for this scope and tracked in Monitor. Targets never change measured values.</p>
          </section>

          {/* 5 Rationale */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <StepTitle n={5} title="Why will it help?" />
              <TextArea rows={3} value={draft.rationale ?? ''} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} placeholder="Link the change to the evidence (e.g. most delay occurs between X and Y)." aria-label="Rationale" />
            </div>
            <div>
              <div className="mb-2 mt-[2px] text-[13px] font-semibold text-slate-800">Assumptions and constraints</div>
              <TextArea rows={3} value={draft.assumptions ?? ''} onChange={(e) => setDraft({ ...draft, assumptions: e.target.value })} placeholder="e.g. one qualified worker per gate; budget limit; safety rule must stay." aria-label="Assumptions" />
            </div>
          </section>

          {/* 6 To-be change */}
          <section>
            <StepTitle n={6} title="To-be change" hint="What will be different in the new process" />
            <TextArea rows={3} value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} placeholder="Describe the change, then draw it in the To-be model." aria-label="To-be change" />
            {lever && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12.5px] text-slate-600">
                <Badge>template</Badge>
                <span className="flex-1">{lever.template(actsText)}</span>
                <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, changeNote: draft.changeNote ? `${draft.changeNote}\n${lever.template(actsText)}` : lever.template(actsText) })}>Use</Button>
              </div>
            )}
          </section>

          {/* 7 Evaluation */}
          <section>
            <StepTitle n={7} title="How will it be evaluated?" />
            <div className="grid gap-2 md:grid-cols-2">
              <EvalOption
                on={evaluation === 'quantitative'}
                disabled={!quantAvailable}
                title="Quantitative — what-if model"
                body={
                  quantAvailable
                    ? gate
                      ? 'Test with the entry gate queue model in Refine (modeled, same arrivals).'
                      : 'Test with the general queue model in Refine (modeled, same arrivals).'
                    : 'No supported model for this process in this build. Choose qualitative.'
                }
                onClick={() => setDraft({ ...draft, evaluation: 'quantitative' })}
              />
              <EvalOption
                on={evaluation === 'qualitative'}
                title="Qualitative — your assessment"
                body="No modeled number is claimed. Rate impact and effort in Implementation, then re-measure after the next log."
                onClick={() => setDraft({ ...draft, evaluation: 'qualitative' })}
              />
            </div>
          </section>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-slate-500">{dirty ? 'Unsaved changes' : 'Saved in this browser for the current scope'}</span>
        <Button onClick={() => { if (dirty) save(); navigate('model'); }} icon="shapes">Draw To-be model</Button>
        {evaluation === 'quantitative' ? (
          <Button variant="primary" iconRight="arrowRight" onClick={() => { if (dirty) save(); navigate('refine'); }}>Evaluate scenario</Button>
        ) : (
          <Button variant="primary" iconRight="arrowRight" onClick={() => { if (dirty) save(); navigate('implementation'); }}>Assess and plan rollout</Button>
        )}
      </div>
    </div>
  );
}

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{n}</span>
      <span className="text-[13.5px] font-semibold text-slate-800">{title}</span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx('rounded-md border px-2 py-0.5 text-xs transition', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
      {on && <Icon name="check" className="mr-0.5 inline h-3 w-3" />}
      {children}
    </button>
  );
}

function EvalOption({ on, disabled, title, body, onClick }: { on: boolean; disabled?: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={cx('rounded-lg border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55', on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300')}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
        <span className={cx('h-3.5 w-3.5 rounded-full border-2', on ? 'border-brand-600 bg-brand-600' : 'border-slate-300')} />
        {title}
      </div>
      <div className="mt-0.5 pl-5.5 text-[12px] leading-snug text-slate-500">{body}</div>
    </button>
  );
}

