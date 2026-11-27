import { isScopeStale, useAnalysis } from '../state/analysis';
import { uid, useStore, useWorkspace } from '../state/store';
import { planFromProposal } from '../state/plans';
import type { PageId, PlanRecord, PlanTask, TaskStatus } from '../state/types';
import { downloadCSV, downloadJSON, slug } from '../lib/files';
import { fmtInstant, plural } from '../lib/format';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, EmptyState, Input, KeyValue, Notice, PageHeader, Select, Table, Td, Th, cx } from '../components/ui';
import { scenarioStale } from './RefinePage';
import { OtherScopesNote } from '../components/WorkspaceHistory';

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

export function planExport(plan: PlanRecord) {
  return plan.tasks.map((t) => ({
    plan_id: plan.id,
    plan_revision: plan.revision,
    plan_state: plan.state,
    plan_source: plan.source.kind,
    provider: plan.provider,
    scenario_id: plan.source.kind === 'scenario' ? plan.source.scenarioId : '',
    gate_delta: plan.source.kind === 'scenario' ? plan.source.gateDelta : '',
    staff_delta: plan.source.kind === 'scenario' ? plan.source.staffDelta : '',
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

export function ImplementationPage({ navigate }: { navigate: (p: PageId) => void }) {
  const ws = useWorkspace();
  const { scope, provider } = useAnalysis();
  const { dispatch } = useStore();
  const active = ws?.plans.find((p) => p.id === ws.activePlanId) ?? null;
  const activeDesign = ws?.designs.find((d) => d.id === ws.activeDesignId) ?? null;

  return (
    <div>
      <PageHeader
        phase="Phase 4 · Process implementation"
        title="Implementation"
        subtitle="Editable action plans generated from an evaluated scenario or from a proposal-only design record. Plans are planning metadata — nothing is deployed in the real world."
        actions={
          activeDesign && scope ? (
            <Button
              onClick={() => {
                dispatch({ type: 'ADD_PLAN', plan: planFromProposal(activeDesign, scope, (ws?.plans.length ?? 0) + 1, provider), archiveOthers: false });
                dispatch({ type: 'TOAST', tone: 'success', message: 'Proposal-only plan created.' });
              }}
              title={activeDesign.title}
            >
              New proposal-only plan from active design
            </Button>
          ) : undefined
        }
      />
      <div className="-mt-3 mb-4"><OtherScopesNote navigate={navigate} /></div>
      <RequireData navigate={navigate}>
        {!ws?.plans.length ? (
          <EmptyState title="No action plans yet" icon="☑" action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => navigate('refine')}>Select a scenario in Refine</Button>
              <Button onClick={() => navigate('design')}>Open Design</Button>
            </div>
          }>
            Apply a computed, non-stale scenario in Refine to generate a plan with the real gate and staffing delta, or create a clearly marked proposal-only plan from a design record.
          </EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
            <Card title="Plans" bodyClassName="p-2">
              <ul className="space-y-1">
                {[...ws.plans].reverse().map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_ACTIVE_PLAN', id: p.id })}
                      className={cx('w-full rounded-md border px-3 py-2 text-left', p.id === ws.activePlanId ? 'border-brand-500 bg-brand-50' : 'border-transparent hover:bg-slate-50')}
                    >
                      <div className="line-clamp-2 text-sm font-medium">{p.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={p.state === 'current' ? 'green' : 'neutral'}>{p.state}</Badge>
                        <Badge tone={p.source.kind === 'scenario' ? 'violet' : 'neutral'}>{p.source.kind === 'scenario' ? 'from scenario' : 'proposal only'}</Badge>
                        {p.provider === 'ui_fixture' && <Badge tone="amber">UI fixture</Badge>}
                        <span className="text-[11px] text-slate-400">rev {p.revision}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {active ? <PlanEditor plan={active} navigate={navigate} /> : <Card title="Plan"><p className="text-sm text-slate-500">Select a plan.</p></Card>}
          </div>
        )}
      </RequireData>
    </div>
  );
}

function PlanEditor({ plan, navigate }: { plan: PlanRecord; navigate: (p: PageId) => void }) {
  const { dispatch } = useStore();
  const ws = useWorkspace()!;
  const { scope, provider } = useAnalysis();
  const scopeStale = isScopeStale(plan.scope, scope);
  // A plan derived from another provider (e.g. UI fixture) is never relabelled or edited as an engine plan.
  const providerMismatch = plan.provider !== provider;
  const editable = plan.state === 'current' && !scopeStale && !providerMismatch;
  const scenario = plan.source.kind === 'scenario' ? ws.scenarios.find((s) => s.id === (plan.source as { scenarioId: string }).scenarioId) : undefined;
  const scnStale = scenario ? scenarioStale(scenario, ws, scope, provider) : null;
  const design = ws.designs.find((d) => d.id === plan.designId);
  const done = plan.tasks.filter((t) => t.status === 'done').length;

  const upd = (taskId: string, patch: Partial<PlanTask>) =>
    dispatch({ type: 'UPDATE_TASK', planId: plan.id, taskId, patch });

  return (
    <div className="min-w-0 space-y-4">
      {plan.state === 'archived' && <Notice tone="warning" title="Archived plan">Kept for export and traceability. It is not the current plan and cannot be edited.</Notice>}
      {plan.state === 'current' && scopeStale && (
        <Notice tone="warning" title="Created under a different scope">The dataset revision or case filter changed after this plan was created. It is read-only here; restore the original filter to edit it.</Notice>
      )}
      {providerMismatch && (
        <Notice tone="warning" title={`Plan from provider "${plan.provider}"`}>
          This plan was generated from {plan.provider === 'ui_fixture' ? 'hand-authored UI fixture results' : 'engine results'}, while the current results come from {provider === 'ui_fixture' ? 'the UI fixture' : 'the engine'}. It is read-only and kept for export; create a new plan from a current scenario.
        </Notice>
      )}
      {plan.provider === 'ui_fixture' && !providerMismatch && (
        <Notice tone="fixture">Plan generated from hand-authored UI fixture results. It is labelled as such in every export.</Notice>
      )}
      {plan.source.kind === 'proposal_only' && (
        <Notice tone="info">Proposal-only plan: no quantified effect is claimed because no simulation backs this design.</Notice>
      )}
      <Card
        title={
          editable ? (
            <Input value={plan.title} onChange={(e) => dispatch({ type: 'UPDATE_PLAN', id: plan.id, patch: { title: e.target.value } })} className="!py-1 font-semibold" />
          ) : (
            plan.title
          )
        }
        subtitle={`Plan ${plan.id} · revision ${plan.revision} · created ${fmtInstant(plan.createdAt)} · updated ${fmtInstant(plan.updatedAt)}`}
        actions={
          <>
            <Button size="sm" onClick={() => downloadCSV(`plan-${slug(plan.title)}-rev${plan.revision}.csv`, planExport(plan))}>Export CSV</Button>
            <Button size="sm" onClick={() => downloadJSON(`plan-${slug(plan.title)}-rev${plan.revision}.json`, { provider: plan.provider, scope: plan.scope, plan, scenario: scenario ?? null, design: design ?? null })}>Export JSON</Button>
            {plan.state === 'current' && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'ARCHIVE_PLAN', id: plan.id })}>Archive</Button>}
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <KeyValue
            items={[
              ['Source', plan.source.kind === 'scenario' ? <Badge tone="violet">Scenario rev {plan.source.scenarioRevision}</Badge> : <Badge>Proposal only</Badge>],
              ['Results provider', plan.provider === 'ui_fixture' ? <Badge tone="amber">UI fixture (hand-authored)</Badge> : <Badge>engine</Badge>],
              ['Design', design ? <button className="text-left text-brand-600 hover:underline" onClick={() => { dispatch({ type: 'SET_ACTIVE_DESIGN', id: design.id }); navigate('design'); }}>{design.title}</button> : '—'],
              ['Scenario state', scenario ? (scnStale ? <Badge tone="amber" title={scnStale}>stale since plan creation</Badge> : <Badge tone="green">current</Badge>) : plan.source.kind === 'scenario' ? 'not found' : '—'],
            ]}
          />
          {plan.source.kind === 'scenario' ? (
            <KeyValue
              items={[
                ['Gates', `${plan.source.baselineGates} → ${plan.source.candidateGates}`],
                ['Gate delta', `${plan.source.gateDelta > 0 ? '+' : ''}${plan.source.gateDelta}`],
                ['Staffing delta', `${plan.source.staffDelta > 0 ? '+' : ''}${plan.source.staffDelta} qualified worker(s) (1 per gate assumption)`],
              ]}
            />
          ) : <div />}
          <div>
            <div className="text-xs font-medium text-slate-500">Progress</div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${plan.tasks.length ? (done / plan.tasks.length) * 100 : 0}%` }} />
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular">{done} of {plural(plan.tasks.length, 'task')} done (plan status, not measured KPI)</div>
          </div>
        </div>
      </Card>

      <Card
        title="Action items"
        actions={editable && (
          <Button size="sm" onClick={() => dispatch({ type: 'ADD_TASK', planId: plan.id, task: { id: uid('task'), task: 'New task', owner: '', staffing: '', dueDate: '', status: 'not_started', evidence: '' } })}>
            + Add task
          </Button>
        )}
      >
        {plan.tasks.length === 0 ? <EmptyState title="No tasks" /> : (
          <Table>
            <thead>
              <tr><Th>Task</Th><Th>Owner</Th><Th>Proposed staffing</Th><Th>Due date</Th><Th>Status</Th><Th>Evidence / reference</Th><Th /></tr>
            </thead>
            <tbody>
              {plan.tasks.map((t) => (
                <tr key={t.id}>
                  <Td className="min-w-[280px]">{editable ? <Input className="!py-1 text-xs" value={t.task} onChange={(e) => upd(t.id, { task: e.target.value })} /> : t.task}</Td>
                  <Td className="min-w-[120px]">{editable ? <Input className="!py-1 text-xs" placeholder="Unassigned" value={t.owner} onChange={(e) => upd(t.id, { owner: e.target.value })} /> : t.owner || '—'}</Td>
                  <Td className="min-w-[160px]">{editable ? <Input className="!py-1 text-xs" value={t.staffing} onChange={(e) => upd(t.id, { staffing: e.target.value })} /> : t.staffing}</Td>
                  <Td>{editable ? <Input type="date" className="!py-1 text-xs" value={t.dueDate} onChange={(e) => upd(t.id, { dueDate: e.target.value })} /> : t.dueDate || '—'}</Td>
                  <Td>
                    {editable ? (
                      <Select className="!w-auto min-w-[120px] !py-1 text-xs" value={t.status} onChange={(e) => upd(t.id, { status: e.target.value as TaskStatus })}>
                        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </Select>
                    ) : <Badge tone={t.status === 'done' ? 'green' : t.status === 'blocked' ? 'red' : 'neutral'}>{STATUS_LABEL[t.status]}</Badge>}
                  </Td>
                  <Td className="min-w-[200px] text-xs text-slate-600">{editable ? <Input className="!py-1 text-xs" value={t.evidence} onChange={(e) => upd(t.id, { evidence: e.target.value })} /> : t.evidence}</Td>
                  <Td>{editable && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'REMOVE_TASK', planId: plan.id, taskId: t.id })} aria-label="Remove task">✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">Changes save automatically to this workspace (browser storage). Editing a plan never changes source data or measured KPIs.</p>
      </Card>
    </div>
  );
}
