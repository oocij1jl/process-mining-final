/**
 * Analysis scope = dataset revision + analysis provider + process + analysis
 * filter. It identifies which records (targets, designs, scenarios, plans)
 * belong to the results currently on screen. Pure UI state (selected case,
 * graph selection, zoom, throughput bucket width, display-only filters) is
 * deliberately NOT part of the scope.
 */
import type { AnalysisScope } from '../contracts';
import { fingerprint } from '../lib/files';
import type { DatasetState, ProviderKind, ViewState } from './types';

/**
 * Integration switch. While the engine is a stub, the UI fixture dataset is
 * analysed by hand-authored values ('ui_fixture'). After the engine merge, set
 * this to 'engine' so the fixture CSV is analysed by src/engine like any other
 * log; labels, workspace keys and plans follow the provider automatically.
 */
export const FIXTURE_DATASET_PROVIDER: ProviderKind = 'engine';

export function providerFor(dataset: Pick<DatasetState, 'sourceKind'> | null): ProviderKind {
  return dataset?.sourceKind === 'ui_fixture' ? FIXTURE_DATASET_PROVIDER : 'engine';
}

/** Only fields that change which cases are analysed. */
export type AnalysisFilter = Pick<ViewState, 'processKey' | 'dateFrom' | 'dateTo'>;

export function filterFingerprint(f: AnalysisFilter): string {
  return fingerprint(JSON.stringify([f.processKey, f.dateFrom || null, f.dateTo || null]));
}

export function scopeOf(dataset: DatasetState | null, f: AnalysisFilter): AnalysisScope | null {
  if (!dataset || !f.processKey) return null;
  return { datasetId: dataset.id, processKey: f.processKey, analysisFilterFingerprint: filterFingerprint(f) };
}

export function workspaceKey(scope: AnalysisScope, provider: ProviderKind): string {
  return [scope.datasetId, provider, scope.processKey, scope.analysisFilterFingerprint].join('::');
}

/** A record is stale when it was created for a different dataset, process or analysis filter. */
export function isScopeStale(recordScope: AnalysisScope, current: AnalysisScope | null): boolean {
  if (!current) return true;
  return (
    recordScope.datasetId !== current.datasetId ||
    recordScope.processKey !== current.processKey ||
    recordScope.analysisFilterFingerprint !== current.analysisFilterFingerprint
  );
}
