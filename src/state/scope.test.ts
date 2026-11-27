import { describe, expect, test } from 'vitest';
import type { DatasetState, ProcessWorkspace } from './types';
import { currentWorkspaceKey, datasetIdFor, initialView, migrateLegacy, reducer } from './store';
import { FIXTURE_DATASET_PROVIDER, filterFingerprint, providerFor, scopeOf } from './scope';
import type { AppState } from './types';

function dataset(over: Partial<DatasetState> = {}): DatasetState {
  const base: Omit<DatasetState, 'id'> = {
    contentFingerprint: 'abc',
    sourceName: 'log.csv',
    sourceKind: 'user_upload',
    headers: ['case_id', 'activity', 'timestamp'],
    rows: [],
    rowMap: [],
    malformedRows: [],
    fileRowCount: 0,
    rawText: '',
    mapping: { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp' },
    missingResources: [''],
    acceptExclusions: false,
    requireProcessType: false,
    festival: false,
    loadedAt: 0,
    ...over,
  };
  return { ...base, id: datasetIdFor(base) };
}

const app = (d: DatasetState): AppState => ({ dataset: d, view: { ...initialView, processKey: 'p' }, workspaces: {}, bpmnDocs: {}, toasts: [] });

describe('analysis scope and workspace keys', () => {
  test('UI-only view state does not change the scope fingerprint', () => {
    const a = filterFingerprint({ processKey: 'p', dateFrom: '', dateTo: '' });
    expect(filterFingerprint({ processKey: 'p', dateFrom: '', dateTo: '' })).toBe(a);
    expect(filterFingerprint({ processKey: 'p', dateFrom: '2026-11-27T10:00', dateTo: '' })).not.toBe(a);
  });

  test('targets are saved per dataset + provider + process + filter', () => {
    const d = dataset();
    let s = reducer(app(d), { type: 'SET_TARGET', target: { metricId: 'case_elapsed_mean', value: 5, unit: 'min', direction: 'max' } });
    const keyAll = currentWorkspaceKey(d, s.view)!;
    expect(s.workspaces[keyAll]!.targets).toHaveLength(1);
    s = reducer(s, { type: 'SET_VIEW', view: { dateFrom: '2026-11-27T10:00' } });
    const keyFiltered = currentWorkspaceKey(d, s.view)!;
    expect(keyFiltered).not.toBe(keyAll);
    expect(s.workspaces[keyFiltered]).toBeUndefined(); // other filter starts empty
    s = reducer(s, { type: 'COPY_TARGETS', fromKey: keyAll }); // explicit copy only
    expect(s.workspaces[keyFiltered]!.targets[0]!.metricId).toBe('case_elapsed_mean');
    expect(s.workspaces[keyAll]!.targets).toHaveLength(1); // source untouched
  });

  test('fixture and engine records never share a workspace', () => {
    expect(providerFor({ sourceKind: 'ui_fixture' })).toBe(FIXTURE_DATASET_PROVIDER);
    expect(providerFor({ sourceKind: 'user_upload' })).toBe('engine');
    expect(providerFor({ sourceKind: 'festival_sample' })).toBe('engine');
    const fx = dataset({ sourceKind: 'ui_fixture' });
    const up = dataset({ sourceKind: 'user_upload' });
    expect(fx.id).toBe(up.id); // same content and policy
    expect(currentWorkspaceKey(fx, app(fx).view)).not.toBe(currentWorkspaceKey(up, app(up).view));
  });

  test('enabling Festival adapters or excluding malformed rows creates a new dataset revision', () => {
    const d = dataset();
    expect(dataset({ festival: true }).id).not.toBe(d.id);
    expect(dataset({ malformedRows: [{ sourceRow: 3, code: 'TooFewFields', message: 'x' }] }).id).not.toBe(d.id);
    const s = reducer(app(d), { type: 'SET_FESTIVAL', enabled: true });
    expect(s.dataset!.festival).toBe(true);
    expect(s.dataset!.id).not.toBe(d.id);
    expect(scopeOf(s.dataset, { processKey: 'p', dateFrom: '', dateTo: '' })!.datasetId).toBe(s.dataset!.id);
  });

  test('pre-1.1 records migrate to read-only legacy workspaces with archived plans', () => {
    const v1 = {
      'ds1::audience': {
        targets: [], designs: [], activeDesignId: null,
        scenarioParams: { serviceActivity: 'X', serviceMode: 'observed' as const, assumedServiceSec: null, baselineGates: 1, candidateGates: 2 },
        paramsRevision: 0, scenarios: [], selectedScenarioId: null, activePlanId: null,
        plans: [{ id: 'p1', revision: 1, title: 'old', source: { kind: 'proposal_only' as const, designId: 'd' }, designId: 'd', scope: { datasetId: 'ds1', processKey: 'audience', analysisFilterFingerprint: 'f' }, tasks: [], state: 'current' as const, createdAt: 0, updatedAt: 0 }],
      },
    };
    const migrated = migrateLegacy(v1 as never) as Record<string, ProcessWorkspace>;
    const ws = migrated['legacy::ds1::audience']!;
    expect(ws.meta.legacy).toBe(true);
    expect(ws.meta.provider).toBe('ui_fixture'); // no engine scenario recorded → treated as fixture-era
    expect(ws.plans[0]!.state).toBe('archived');
    expect(ws.plans[0]!.provider).toBe('ui_fixture');
  });
});
