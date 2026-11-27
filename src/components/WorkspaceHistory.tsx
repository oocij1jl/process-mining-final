/**
 * Read-only view of records saved under other analysis scopes (another dataset
 * revision, process, case filter or results provider) and of records migrated
 * from the pre-1.1 storage format. Nothing here edits or deletes records; they
 * are never shown as current analysis results.
 */
import { useState } from 'react';
import { useAnalysis } from '../state/analysis';
import { useStore, useWorkspaceKey } from '../state/store';
import type { PageId, ProcessWorkspace } from '../state/types';
import { downloadJSON } from '../lib/files';
import { fmtInstant, plural } from '../lib/format';
import { Badge, Button, Card, EmptyState, Table, Td, Th } from './ui';

export function relationTo(ws: ProcessWorkspace, current: { datasetId?: string; processKey?: string; provider: string }): string {
  if (ws.meta.legacy) return 'legacy (pre-1.1)';
  if (ws.meta.scope.datasetId !== current.datasetId) return 'other dataset revision';
  if (ws.meta.provider !== current.provider) return `other provider (${ws.meta.provider})`;
  if (ws.meta.scope.processKey !== current.processKey) return 'other process';
  return 'other case filter';
}

const count = (ws: ProcessWorkspace) => ws.targets.length + ws.designs.length + ws.scenarios.length + ws.plans.length;

export function useOtherScopes(): [string, ProcessWorkspace][] {
  const { state } = useStore();
  const currentKey = useWorkspaceKey();
  return Object.entries(state.workspaces).filter(([k, ws]) => k !== currentKey && count(ws) > 0);
}

/** One-line pointer shown on lifecycle pages when other-scope records exist. */
export function OtherScopesNote({ navigate }: { navigate: (p: PageId) => void }) {
  const others = useOtherScopes();
  if (!others.length) return null;
  return (
    <p className="text-xs text-slate-500">
      {plural(others.length, 'other scope')} hold saved records (other filter, dataset revision, provider or legacy). They are not part of the current results.{' '}
      <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => navigate('export')}>
        View in Workspace history
      </button>
    </p>
  );
}

export function WorkspaceHistory() {
  const { state } = useStore();
  const { provider, scope } = useAnalysis();
  const others = useOtherScopes();
  const [open, setOpen] = useState<string | null>(null);
  const current = { datasetId: state.dataset?.id, processKey: scope?.processKey, provider };
  return (
    <Card
      title="Workspace history"
      subtitle="Records saved for other scopes or providers, and records from before v1.1. Read-only: never applied to the current analysis, never deleted automatically."
    >
      {!others.length ? (
        <EmptyState title="No records from other scopes" />
      ) : (
        <Table className="max-h-[420px]">
          <thead>
            <tr>
              <Th>Relation</Th><Th>Source</Th><Th>Provider</Th><Th>Process</Th><Th>Case filter</Th><Th align="right">Records</Th><Th />
            </tr>
          </thead>
          <tbody>
            {others.map(([key, ws]) => (
              <HistoryRow key={key} wsKey={key} ws={ws} relation={relationTo(ws, current)} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function HistoryRow({ wsKey, ws, relation, open, onToggle }: { wsKey: string; ws: ProcessWorkspace; relation: string; open: boolean; onToggle: () => void }) {
  const f = ws.meta.filter;
  return (
    <>
      <tr>
        <Td><Badge tone={ws.meta.legacy ? 'amber' : 'neutral'}>{relation}</Badge></Td>
        <Td className="max-w-[220px] truncate text-xs" >{ws.meta.sourceName}</Td>
        <Td>{ws.meta.provider === 'ui_fixture' ? <Badge tone="amber">UI fixture</Badge> : <Badge>engine</Badge>}</Td>
        <Td className="font-mono text-xs">{ws.meta.scope.processKey}</Td>
        <Td className="text-xs">{ws.meta.legacy ? 'not recorded' : f.dateFrom || f.dateTo ? `${f.dateFrom || '…'} → ${f.dateTo || '…'}` : 'all cases'}</Td>
        <Td align="right" className="text-xs">
          {ws.targets.length} targets · {ws.designs.length} designs · {ws.scenarios.length} scenarios · {ws.plans.length} plans
        </Td>
        <Td align="right">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onToggle}>{open ? 'Hide' : 'Details'}</Button>
            <Button size="sm" onClick={() => downloadJSON(`processpilot-history-${wsKey.replace(/[^a-z0-9]+/gi, '-')}.json`, { workspaceKey: wsKey, readOnly: true, ...ws })}>
              JSON
            </Button>
          </div>
        </Td>
      </tr>
      {open && (
        <tr>
          <Td className="bg-slate-50" >
            <span className="text-xs text-slate-400">details</span>
          </Td>
          <td colSpan={6} className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <div className="font-semibold">Designs</div>
                {ws.designs.length ? ws.designs.map((d) => <div key={d.id}>{d.title} <span className="text-slate-400">({d.status})</span></div>) : '—'}
              </div>
              <div>
                <div className="font-semibold">Scenarios</div>
                {ws.scenarios.length
                  ? ws.scenarios.map((s) => <div key={s.id}>rev {s.revision}: {s.baseline.gateCount} → {s.candidate.gateCount} gates · {s.provider} · {fmtInstant(s.createdAt)}</div>)
                  : '—'}
              </div>
              <div>
                <div className="font-semibold">Plans</div>
                {ws.plans.length ? ws.plans.map((p) => <div key={p.id}>{p.title} <span className="text-slate-400">(rev {p.revision}, {p.state}, {p.provider})</span></div>) : '—'}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
