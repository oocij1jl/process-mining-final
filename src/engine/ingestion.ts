import type { EventRow, ImportOptions, Issue, Lifecycle, RawRow, ValidationResult } from '../contracts';
import { audienceTimeline } from './audience';
import { buildCaseKey, groupCases, matchLifecycle } from './traces';

const requiredFields = ['case_id', 'activity', 'timestamp'] as const;
const eventFields = new Set([
  ...requiredFields, 'event_id', 'process_type', 'lifecycle', 'activity_instance_id', 'resource',
]);

const offsetPattern = /^[+-](?:[01]\d|2[0-3]):[0-5]\d$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseTimestamp(raw: string, fixedOffset?: string): number | undefined {
  const match = timestampPattern.exec(raw.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = '00', fraction = '', zone = fixedOffset] = match;
  if (!zone || (zone !== 'Z' && !offsetPattern.test(zone))) return undefined;
  const leapYear = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (+day < 1 || !(+day <= daysInMonth[+month - 1])) return undefined;
  if (+hour > 23 || +minute > 59 || +second > 59) return undefined;

  const millis = fraction.padEnd(3, '0').slice(0, 3);
  const timestampMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}${zone}`);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

export function validateAndNormalize(rows: readonly RawRow[], options: ImportOptions): ValidationResult {
  const events: EventRow[] = [];
  const issues: Issue[] = [];
  const addIssue = (row: number, field: string, code: string, message: string, severity: Issue['severity'] = 'error') => {
    issues.push({ row, field, code, severity, message });
  };

  const requiredMappings = options.requireProcessType ? [...requiredFields, 'process_type'] : requiredFields;
  for (const field of requiredMappings) {
    if (!options.mapping[field]?.trim()) {
      addIssue(-1, field, 'missing_mapping', 'Select a CSV header for this required field.');
    }
  }
  if (options.fixedOffset !== undefined && !offsetPattern.test(options.fixedOffset)) {
    addIssue(-1, 'timestamp', 'invalid_fixed_offset', 'Fixed offset must use ±HH:MM.');
  }
  if (issues.length) {
    return { events, issues, rawCount: rows.length, excludedCount: rows.length, canAnalyze: false };
  }

  const mappedColumns = new Set(Object.values(options.mapping).filter(Boolean));
  const validateFestival = options.requireProcessType === true && Boolean(options.mapping.festival_id?.trim());
  const extraMappings = Object.entries(options.mapping).filter(([field, header]) => header && !eventFields.has(field));
  const missingResources = new Set(options.missingResources.map(resource => resource.trim()));
  const eventIds = new Set<string>();
  const unidentifiedRows = new Set<string>();

  for (const [sourceOrder, row] of rows.entries()) {
    const issueStart = issues.length;
    const get = (field: string) => {
      const header = options.mapping[field];
      return header && Object.hasOwn(row, header) ? row[header] ?? '' : '';
    };
    const caseId = get('case_id').trim();
    const activity = get('activity').trim();
    const rawTimestamp = get('timestamp');
    const processType = get('process_type').trim();
    const eventId = get('event_id').trim();
    const lifecycle = get('lifecycle').trim();
    const timestampMs = parseTimestamp(rawTimestamp, options.fixedOffset);

    for (const field of ['case_id', 'activity'] as const) {
      if (get(field) !== get(field).trim()) {
        addIssue(sourceOrder, field, 'trimmed_value', 'Outer whitespace was removed.', 'warning');
      }
      if (!get(field).trim()) addIssue(sourceOrder, field, 'missing_required', 'This value is required.');
    }
    if (timestampMs === undefined) {
      addIssue(sourceOrder, 'timestamp', 'invalid_timestamp', 'Use a valid ISO datetime with a timezone or an explicit fixed offset.');
    }
    if (!processType && options.requireProcessType) {
      addIssue(sourceOrder, 'process_type', 'missing_required', 'Process type is required for this import.');
    }
    if (lifecycle !== '' && lifecycle !== 'start' && lifecycle !== 'complete') {
      addIssue(sourceOrder, 'lifecycle', 'invalid_lifecycle', 'Use start, complete, or a blank value.');
    }
    if (eventId) {
      if (eventIds.has(eventId)) addIssue(sourceOrder, 'event_id', 'duplicate_event_id', 'Event ID already appears in this import.');
      eventIds.add(eventId);
    } else {
      const rawKey = JSON.stringify(Object.keys(row).sort().map(header => [header, row[header]]));
      if (unidentifiedRows.has(rawKey)) {
        addIssue(sourceOrder, 'event_id', 'duplicate_row_without_id', 'Identical row without an event ID. The row was retained if valid.', 'warning');
      }
      unidentifiedRows.add(rawKey);
    }
    if (timestampMs === undefined || issues.slice(issueStart).some(issue => issue.severity === 'error')) continue;

    const attrs = Object.fromEntries([
      ...Object.entries(row).filter(([header]) => !mappedColumns.has(header)),
      ...extraMappings.map(([field]) => [field, get(field)]),
    ]);
    const resource = get('resource').trim();
    events.push({
      eventId: eventId || undefined,
      caseId,
      caseKey: buildCaseKey(processType || 'default', caseId),
      processType: processType || 'default',
      activity,
      timestampMs,
      rawTimestamp,
      sourceOrder,
      lifecycle: (lifecycle || 'point') as Lifecycle,
      instanceId: get('activity_instance_id').trim() || undefined,
      resource: !resource || missingResources.has(resource) ? null : resource,
      attrs,
    });
  }

  for (const trace of groupCases(events)) {
    for (let index = 1; index < trace.events.length; index++) {
      const event = trace.events[index];
      if (event.timestampMs === trace.events[index - 1].timestampMs) {
        addIssue(event.sourceOrder, 'timestamp', 'timestamp_tie', 'Events at the same instant retain their source row order.', 'warning');
      }
    }
    if (!trace.sequence.length) {
      addIssue(trace.events[0].sourceOrder, 'lifecycle', 'empty_discovery_case', 'Case has no complete or point events.', 'warning');
    }
    matchLifecycle(trace, issues);
    if (validateFestival && trace.processType === 'audience') {
      for (const [event, issue] of audienceTimeline(trace).invalidEvents) {
        addIssue(event.sourceOrder, 'timestamp', issue.code, issue.message, 'warning');
      }
    }
  }

  issues.sort((a, b) => a.row - b.row);
  const excludedCount = rows.length - events.length;
  if (!events.length) addIssue(-1, 'import', 'no_usable_rows', 'The import contains no usable rows.');
  return {
    events, issues, rawCount: rows.length, excludedCount,
    canAnalyze: events.length > 0 && (excludedCount === 0 || options.acceptExclusions),
  };
}
