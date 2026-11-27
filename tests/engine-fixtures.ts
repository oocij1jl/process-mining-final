import { DEFAULT_MISSING_RESOURCES } from '../src/contracts';
import type { ColumnMapping, ImportOptions, RawRow } from '../src/contracts';
import { groupCases, validateAndNormalize } from '../src/engine';

export const mapping: ColumnMapping = {
  case_id: 'case_id', activity: 'activity', timestamp: 'timestamp',
  process_type: 'process_type', lifecycle: 'lifecycle', event_id: 'event_id',
  activity_instance_id: 'activity_instance_id', resource: 'resource',
};

export const options: ImportOptions = {
  mapping, missingResources: DEFAULT_MISSING_RESOURCES, acceptExclusions: false,
};

export const instant = (minutes: number) => new Date(minutes * 60_000).toISOString();
export const key = (id: string, process = 'default') => JSON.stringify([process, id]);
export const row = (id: string, activity: string, minutes: number, extras: RawRow = {}): RawRow => ({
  case_id: id, activity, timestamp: instant(minutes), ...extras,
});

export function pair(caseId: string, activity: string, start: number, end: number, extras: RawRow = {}): RawRow[] {
  return [
    row(caseId, activity, start, { ...extras, lifecycle: 'start' }),
    row(caseId, activity, end, { ...extras, lifecycle: 'complete' }),
  ];
}

export const tracesOf = (rows: readonly RawRow[]) => groupCases(validateAndNormalize(rows, options).events);
