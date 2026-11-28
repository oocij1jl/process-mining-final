import type { EngineResult } from '../adapters/engineAdapter';
import { UI_FIXTURE_CSV } from '../adapters/fixtures/uiFixture';
import { useAnalysis, type Analysis } from '../state/analysis';
import { useStore, useWorkspace } from '../state/store';
import type { AppState, PageId, ProcessWorkspace } from '../state/types';
import { downloadCSV, downloadJSON, downloadText } from '../lib/files';
import { VIEWER_TIMEZONE } from '../lib/format';
import { RequireData } from '../components/layout';
import { Badge, Button, Card, KeyValue, Notice, PageHeader } from '../components/ui';
import { planExport } from './ImplementationPage';
import { WorkspaceHistory } from '../components/WorkspaceHistory';

const APP_VERSION = '0.2.1-integration-phase2';

function section<T>(r: EngineResult<T> | null) {
  if (!r) return { status: 'not_computed' };
  return r.status === 'ok' ? { status: 'ok', data: r.data } : { status: r.status, fn: r.fn, message: r.message };
}

export function buildEvidence(a: Analysis, state: AppState, ws: ProcessWorkspace | null) {
  const d = state.dataset!;
  const v = a.validation?.status === 'ok' ? a.validation.data : null;
  return {
    generator: { app: 'ProcessPilot', version: APP_VERSION, generatedAt: new Date().toISOString(), viewerTimezone: VIEWER_TIMEZONE },
    provider: a.provider,
    providerDescription: a.provider === 'ui_fixture' ? 'UI FIXTURE — hand-authored values, not engine output' : 'src/engine',
    dataset: {
      id: d.id,
      sourceName: d.sourceName,
      sourceKind: d.sourceKind,
      contentFingerprint: d.contentFingerprint,
      fileDataRows: d.fileRowCount,
      rowsSentToValidation: d.rows.length,
      malformedRowsExcludedWithConsent: d.malformedRows,
      rowNumbering: 'Issue rows and sourceOrder are mapped to zero-based data rows of the original file.',
      headers: d.headers,
      mapping: d.mapping,
      missingResources: d.missingResources,
      fixedOffset: d.fixedOffset ?? null,
      acceptExclusions: d.acceptExclusions,
      requireProcessType: d.requireProcessType,
      festivalAdapters: d.festival,
      festivalSettings: d.festival ? d.festivalSettings ?? null : null,
      metadata: d.metadata ?? null,
      manifest: d.manifest
        ? { dataset_id: d.manifest.dataset_id ?? null, csv: d.manifest.csv, generator: d.manifest.generator ?? null, bpmn: d.manifest.bpmn ?? null, bpmn_to_be: d.manifest.bpmn_to_be ?? null }
        : null,
    },
    workspace: ws ? { provider: ws.meta.provider, scope: ws.meta.scope, filter: ws.meta.filter } : null,
    scope: a.scope,
    filter: {
      processKey: state.view.processKey,
      caseStartFrom: state.view.dateFrom || null,
      caseStartTo: state.view.dateTo || null,
      rule: 'Whole cases selected by first accepted event; traces never truncated.',
      selectedCases: a.selectedTraces.length,
      processCases: a.processTraces.length,
      throughputBucketMinutes: state.view.throughputBucketMin,
    },
    validation: v
      ? {
          rawCount: v.rawCount,
          acceptedEvents: v.events.length,
          excludedCount: v.excludedCount,
          canAnalyze: v.canAnalyze,
          issues: v.issues.map((i) => ({ ...i, fileRow: i.row < 0 ? null : d.rowMap[i.row] ?? i.row })),
        }
      : section(a.validation),
    metricFamilies: {
      inter_event: 'Consecutive discovery-event timestamps within a case (minutes).',
      matched_gap: 'Next valid paired start minus preceding completion; overlaps excluded (minutes).',
      service: 'Matched complete − start of the same activity instance (minutes).',
      elapsed: 'First-to-last accepted event per case (calendar minutes).',
    },
    kpis: section(a.kpis),
    targets: ws?.targets ?? [],
    targetEvaluations: section(a.evaluations),
    dfg: section(a.dfg),
    variants: section(a.variants),
    caseDurations: section(a.durations),
    performance: section(a.performance),
    resources: section(a.resources),
    findings: section(a.findings),
    designs: ws?.designs ?? [],
    scenarioParams: ws ? { ...ws.scenarioParams, revision: ws.paramsRevision } : null,
    scenarios: ws?.scenarios ?? [],
    selectedScenarioId: ws?.selectedScenarioId ?? null,
    plans: ws?.plans ?? [],
  };
}

export function ExportPage({ navigate }: { navigate: (p: PageId) => void }) {
  const { state } = useStore();
  const a = useAnalysis();
  const ws = useWorkspace();
  const d = state.dataset;
  const base = `processpilot-${d?.id ?? 'none'}-${state.view.processKey ?? 'none'}`;
  const scopeCols = () => ({ dataset_id: d?.id, process: state.view.processKey, filter: a.scope?.analysisFilterFingerprint, provider: a.provider });
  // Appended (not prefixed) so the leading scope columns keep their order.
  const filterCols = () => ({ case_start_from: state.view.dateFrom || '', case_start_to: state.view.dateTo || '', selected_cases: a.selectedTraces.length });

  const csvButtons: { label: string; disabled: boolean; run: () => void }[] = [
    {
      label: 'KPIs + targets',
      disabled: a.kpis?.status !== 'ok',
      run: () => {
        if (a.kpis?.status !== 'ok') return;
        const ev = new Map((a.evaluations?.status === 'ok' ? a.evaluations.data : []).map((e) => [e.metricId, e.status]));
        downloadCSV(`${base}-kpis.csv`, a.kpis.data.map((m) => {
          const t = ws?.targets.find((x) => x.metricId === m.id);
          return { ...scopeCols(), metric_id: m.id, value: m.value ?? 'N/A', unit: m.unit, n: m.n, eligible: m.eligible, definition: m.definition, reason: m.reason ?? '', target: t?.value ?? '', direction: t?.direction ?? '', status: t ? ev.get(m.id) ?? '' : '', case_keys: m.caseKeys, ...filterCols() };
        }));
      },
    },
    {
      label: 'DFG edges',
      disabled: a.dfg?.status !== 'ok',
      run: () => a.dfg?.status === 'ok' && downloadCSV(`${base}-dfg-edges.csv`, a.dfg.data.edges.map((e) => ({ ...scopeCols(), from: e.from, to: e.to, count: e.count, cases: e.caseKeys.length, case_keys: e.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Variants',
      disabled: a.variants?.status !== 'ok',
      run: () => a.variants?.status === 'ok' && downloadCSV(`${base}-variants.csv`, a.variants.data.map((v) => ({ ...scopeCols(), variant_id: v.id, count: v.count, share: v.share, share_scale: 'fraction 0-1', avg_elapsed_min: v.avgElapsedMin, activities: v.activities.join(' > '), case_keys: v.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Performance gaps',
      disabled: a.performance?.status !== 'ok',
      run: () => a.performance?.status === 'ok' && downloadCSV(`${base}-performance.csv`, a.performance.data.gaps.map((g) => ({ ...scopeCols(), metric_type: g.metricType, from: g.from, to: g.to ?? '', mean_min: g.meanMin, n: g.n, cases: g.caseKeys.length, case_keys: g.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Resource workload',
      disabled: a.resources?.status !== 'ok',
      run: () => a.resources?.status === 'ok' && downloadCSV(`${base}-resources.csv`, a.resources.data.resources.map((r) => ({ ...scopeCols(), resource: r.resource, roles: r.roles.join('|'), raw_events: r.rawEvents, instances: r.instances, distinct_cases: r.distinctCases, active_min: r.activeMin ?? 'N/A', utilization: 'N/A (no validated shifts)', activity_counts: r.activityCounts, case_keys: r.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Resource handoffs',
      disabled: a.resources?.status !== 'ok',
      run: () => a.resources?.status === 'ok' && downloadCSV(`${base}-handoffs.csv`, a.resources.data.handoffs.map((h) => ({ ...scopeCols(), from: h.from, to: h.to, count: h.count, cases: h.caseKeys.length, case_keys: h.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Findings',
      disabled: a.findings?.status !== 'ok',
      run: () => a.findings?.status === 'ok' && downloadCSV(`${base}-findings.csv`, a.findings.data.map((f) => ({ ...scopeCols(), finding_id: f.id, metric_id: f.metricId, value: f.value, unit: f.unit, n: f.n, eligible: f.eligible ?? '', support: f.support ?? '', edge: f.edge ? `${f.edge.from} > ${f.edge.to}` : '', text: f.text, proposal: f.proposal, case_keys: f.caseKeys, ...filterCols() }))),
    },
    {
      label: 'Validation issues',
      disabled: a.validation?.status !== 'ok',
      run: () =>
        a.validation?.status === 'ok' &&
        downloadCSV(`${base}-issues.csv`, a.validation.data.issues.map((i) => ({ dataset_id: d?.id, provider: a.provider, file_row: i.row < 0 ? 'import' : d?.rowMap[i.row] ?? i.row, ...i }))),
    },
    {
      label: 'Action plans (all revisions)',
      disabled: !ws?.plans.length,
      run: () => ws && downloadCSV(`${base}-plans.csv`, ws.plans.flatMap(planExport)),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Evidence Export"
        subtitle="Download the current analysis, metric definitions, filter scope, dataset provenance, scenario configuration and plans. Exports serialize the same engine results shown on screen."
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Sample data & assets">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => downloadText('processpilot-ui-fixture.csv', UI_FIXTURE_CSV, 'text/csv')}>UI fixture CSV</Button>
            {Object.entries(state.bpmnDocs).map(([name, xml]) => (
              <Button key={name} onClick={() => downloadText(name.endsWith('.bpmn') ? name : `${name}.bpmn`, xml, 'application/xml')}>BPMN: {name}</Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The Festival sample CSV and BPMN downloads appear in Overview & Data once the business/data track publishes them to <code className="font-mono">public/datasets</code> and <code className="font-mono">public/bpmn</code>.
          </p>
        </Card>
        {d && (
          <Card title="Current scope">
            <KeyValue
              items={[
                ['Dataset', <span>{d.sourceName} <Badge tone={d.sourceKind === 'ui_fixture' ? 'amber' : 'neutral'}>{d.sourceKind}</Badge></span>],
                ['Dataset ID', <code className="font-mono text-xs">{d.id}</code>],
                ['Process', state.view.processKey ?? '—'],
                ['Filter fingerprint', <code className="font-mono text-xs">{a.scope?.analysisFilterFingerprint ?? '—'}</code>],
                ['Cases in scope', `${a.selectedTraces.length} of ${a.processTraces.length}`],
              ]}
            />
          </Card>
        )}
      </div>
      <RequireData navigate={navigate}>
        {a.provider === 'ui_fixture' && (
          <div className="mb-4">
            <Notice tone="fixture">
              Results come from the UI fixture provider. The evidence JSON and every analysis/plan CSV carry <code>provider=ui_fixture</code>. Do not use them as analysis evidence.
            </Notice>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Full evidence bundle (JSON)" subtitle="Provenance, mapping, filter, validation, metric definitions, all engine outputs, targets, designs, scenarios and plans.">
            <Button variant="primary" onClick={() => downloadJSON(`${base}-evidence.json`, buildEvidence(a, state, ws))}>Download evidence JSON</Button>
            <p className="mt-2 text-xs text-slate-500">Engine steps that are not implemented or failed are recorded with their status instead of values.</p>
          </Card>
          <Card title="Tables (CSV)" subtitle="Each row carries dataset ID, process, filter fingerprint and provider.">
            <div className="flex flex-wrap gap-2">
              {csvButtons.map((b) => (
                <Button key={b.label} size="sm" disabled={b.disabled} onClick={b.run} title={b.disabled ? 'Not available for the current scope' : undefined}>
                  {b.label}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      </RequireData>
      <div className="mt-4">
        <WorkspaceHistory />
      </div>
    </div>
  );
}
