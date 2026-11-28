import type { ColumnMapping, Issue, RawRow } from '../contracts';
import type { XesEventLocation, XesImportOptions, XesImportResult, XesIssue } from '../v03-contracts';
import { validateAndNormalize } from './ingestion';
import { buildCaseKey } from './traces';
import { parseXesXml, XesXmlError } from './xes-xml';

const namespaces = new Set(['', 'http://www.xes-standard.org', 'http://www.xes-standard.org/']);
const scalarTypes = new Set(['string', 'date', 'int', 'float', 'boolean', 'id']);
const attributeTypes = new Set([...scalarTypes, 'list', 'container']);
const festivalFields = [
  'festival_id', 'performance_id', 'stage_id', 'gate_id', 'equipment_request_id', 'equipment_type',
  'asset_id', 'scheduled_start', 'required_ready_at', 'ticket_type', 'issue_type', 'entry_id',
  'resource_id', 'resource_role', 'cost',
] as const;
const canonicalFields = ['case_id', 'activity', 'timestamp', 'resource', 'lifecycle', 'activity_instance_id', 'event_id', 'process_type'] as const;
const header = (field: (typeof canonicalFields)[number]) => '\u0000' + field;
const mapping = Object.fromEntries(canonicalFields.map(field => [field, header(field)])) as ColumnMapping;

type Scalar = { type: string; value: string };
type Attributes = Map<string, Scalar>;
type Scope = { attrs: Attributes; issues: XesIssue[]; seen: Set<string> };
type TraceScope = Scope & { index: number; events: EventScope[] };
type EventScope = Scope & { ordinal: number };
type Frame =
  | { kind: 'log' | 'trace' | 'event' | 'skip' | 'global' | 'declaration' }
  | { kind: 'attribute'; key: string; warned: boolean };

function createScope(): Scope {
  return { attrs: new Map(), issues: [], seen: new Set() };
}

function scalarValues(attrs: Attributes): Record<string, string> {
  return Object.fromEntries(Array.from(attrs, ([key, { value }]) => [key, value]));
}

function reject(code: string, message: string): XesImportResult {
  return { status: 'rejected', issues: [{ row: -1, location: null, field: 'import', code, message, severity: 'error' }] };
}

function canonicalAttribute(key: string, level: 'trace' | 'event'): boolean {
  const field = key.startsWith('festival:') ? key.slice(9) : key;
  return key === 'concept:name' || key === 'process_type' || festivalFields.some(item => item === field) ||
    (level === 'event' && ['time:timestamp', 'lifecycle:transition', 'org:resource', 'org:role', 'concept:instance',
      'activity_instance_id', 'identity:id', 'event_id'].includes(key));
}

export function importXes(bytes: Uint8Array, options: XesImportOptions): XesImportResult {
  if (bytes.byteLength > 8_388_608) return reject('xes_limit_exceeded', 'XES is limited to 8 MiB.');
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return reject('xes_invalid_encoding', 'XES must contain valid UTF-8.');
  }

  const log = createScope();
  const stack: Frame[] = [];
  const rows: RawRow[] = [];
  const ordinals: number[] = [];
  const traceKeys = new Set<string>();
  const eventLocations: XesEventLocation[] = [];
  const traces: Extract<XesImportResult, { status: 'parsed' }>['traces'] = [];
  const issues: XesIssue[] = [];
  let rootNamespace = '';
  let trace: TraceScope | undefined;
  let event: EventScope | undefined;

  function addIssue(scope: Scope, field: string, code: string, message: string, severity: Issue['severity'] = 'error') {
    const row = 'ordinal' in scope ? (scope as EventScope).ordinal : -1;
    const location = row >= 0 ? eventLocations[row] : scope === trace ? { traceIndex: trace.index, eventIndex: null } : null;
    scope.issues.push({ field, code, message, severity, row, location });
  }

  function pick(scope: Scope, key: string, types: readonly string[], required = false): string | undefined {
    const item = scope.attrs.get(key);
    if (item && !types.includes(item.type)) {
      addIssue(scope, key, 'xes_invalid_attribute', `Use a ${types.join(' or ')} attribute for ${key}.`);
      return;
    }
    if (required && !item?.value.trim()) addIssue(scope, key, 'missing_required', `${key} is required.`);
    return item?.value;
  }

  function alias(scope: Scope, primary: string, alternate: string, first: string | undefined, second: string | undefined,
    trim = false): string | undefined {
    if (first?.trim() && second?.trim() && (trim ? first.trim() !== second.trim() : first !== second)) {
      addIssue(scope, primary, 'xes_conflicting_attribute', `${primary} and ${alternate} disagree.`);
    }
    return first?.trim() ? first : second ?? first;
  }

  function extensions(scope: Scope) {
    const attrs = scalarValues(scope.attrs);
    for (const field of festivalFields) {
      const qualified = `festival:${field}`;
      const mapped = alias(scope, field, qualified, scope.attrs.get(field)?.value, scope.attrs.get(qualified)?.value);
      if (mapped !== undefined) attrs[field] = mapped;
    }
    return attrs;
  }

  function finishTrace(current: TraceScope) {
    const { index, events } = current;
    const caseId = pick(current, 'concept:name', ['string'], true);
    const inherited = extensions(current);
    const traceProcess = current.attrs.get('process_type')?.value.trim();
    const processes = new Set(events.map(({ attrs }) => attrs.get('process_type')?.value.trim() || traceProcess || 'default'));
    if (processes.size > 1 || (traceProcess && [...processes].some(process => process !== traceProcess))) {
      addIssue(current, 'process_type', 'xes_conflicting_attribute', 'Each XES trace must identify a single process.');
    }
    if (!events.length) addIssue(current, 'trace', 'xes_empty_trace', 'Trace contains no events.', 'warning');
    const key = caseId?.trim() && processes.size === 1
      ? buildCaseKey(processes.values().next().value || 'default', caseId.trim()) : undefined;
    if (key && !current.issues.some(issue => issue.severity === 'error' &&
      (issue.field === 'concept:name' || issue.field === 'process_type'))) {
      if (traceKeys.has(key)) throw new XesXmlError('xes_duplicate_trace_key', 'Two XES traces use the same process and case ID.');
      traceKeys.add(key);
    }
    traces.push({ traceIndex: index, caseId: caseId?.trim() || null, attrs: scalarValues(current.attrs) });
    for (const issue of current.issues) issues.push(issue);
    const invalidTrace = current.issues.some(issue => issue.severity === 'error');

    for (const item of events) {
      const own = extensions(item);
      const id = alias(item, 'event_id', 'identity:id',
        pick(item, 'event_id', ['string', 'id']), pick(item, 'identity:id', ['string', 'id']), true);
      const instance = alias(item, 'activity_instance_id', 'concept:instance',
        pick(item, 'activity_instance_id', ['string', 'id']), pick(item, 'concept:instance', ['string', 'id']), true);
      const role = alias(item, 'resource_role', 'org:role', Object.hasOwn(own, 'resource_role') ? own.resource_role : undefined,
        pick(item, 'org:role', ['string']));
      const row = {
        ...inherited, ...own,
        ...(role === undefined ? {} : { resource_role: role }),
        [header('case_id')]: caseId ?? '',
        [header('activity')]: pick(item, 'concept:name', ['string'], true) ?? '',
        [header('timestamp')]: pick(item, 'time:timestamp', ['date'], true) ?? '',
        [header('event_id')]: id ?? '',
        [header('activity_instance_id')]: instance ?? '',
        [header('resource')]: pick(item, 'org:resource', ['string']) ?? '',
        [header('lifecycle')]: pick(item, 'lifecycle:transition', ['string']) ?? '',
        [header('process_type')]: item.attrs.get('process_type')?.value.trim() || traceProcess || '',
      };
      for (const issue of item.issues) issues.push(issue);
      if (!invalidTrace && !item.issues.some(issue => issue.severity === 'error')) {
        ordinals.push(item.ordinal);
        rows.push(row);
      }
    }
  }

  function unsupported(): never {
    throw new XesXmlError('xes_unsupported_structure', 'Use a trace-based XES log with event children under each trace.');
  }

  try {
    parseXesXml(xml, {
      open({ name, namespace, attrs }) {
        const parent = stack.at(-1);
        if (!parent) {
          if (name !== 'log' || !namespaces.has(namespace)) {
            throw new XesXmlError('xes_unsupported_root', 'The document does not have a supported XES log root.');
          }
          rootNamespace = namespace;
          stack.push({ kind: 'log' });
          return;
        }
        // A nested attribute subtree is metadata even when a different namespace is used.
        const metadataChild = parent.kind === 'skip' || parent.kind === 'attribute';
        if (namespace !== rootNamespace && !metadataChild) unsupported();
        if (parent.kind === 'log' && name === 'trace') {
          if (traces.length >= 10_000) throw new XesXmlError('xes_limit_exceeded', 'XES is limited to 10,000 traces.');
          trace = { ...createScope(), index: traces.length, events: [] };
          stack.push({ kind: 'trace' });
          return;
        }
        if (parent.kind === 'trace' && name === 'event') {
          if (eventLocations.length >= 50_000) throw new XesXmlError('xes_limit_exceeded', 'XES is limited to 50,000 events.');
          event = { ...createScope(), ordinal: eventLocations.length };
          eventLocations.push({ traceIndex: trace!.index, eventIndex: trace!.events.length });
          trace!.events.push(event);
          stack.push({ kind: 'event' });
          return;
        }
        if (namespace === rootNamespace && (name === 'trace' || name === 'event' || name === 'log')) unsupported();
        const scope = event ?? trace ?? log;
        if (parent.kind === 'log' && ['global', 'extension', 'classifier'].includes(name)) {
          const missing = name === 'global' ? !['trace', 'event'].includes(attrs.get('scope') ?? '')
            : (name === 'extension' ? ['name', 'prefix', 'uri'] : ['name', 'keys']).some(key => !attrs.get(key)?.trim());
          if (missing) addIssue(log, name, 'xes_invalid_attribute', 'Incomplete XES log metadata.', 'warning');
          stack.push({ kind: name === 'global' ? 'global' : 'declaration' });
          return;
        }
        if (parent.kind === 'skip' || parent.kind === 'attribute') {
          if (parent.kind === 'attribute' && !parent.warned) {
            addIssue(scope, parent.key, 'xes_unsupported_attribute', 'Nested XES attribute data was skipped.', 'warning');
            parent.warned = true;
          }
          stack.push({ kind: 'skip' });
          return;
        }
        if (parent.kind === 'declaration' || !attributeTypes.has(name)) unsupported();
        const key = attrs.get('key') ?? '';
        const scalar = scalarTypes.has(name);
        const value = attrs.get('value');
        const level = parent.kind === 'event' ? 'event' : 'trace';
        const metadata = scope === log;
        if (!key.trim() || (scalar && value === undefined)) {
          addIssue(scope, key || 'attribute', 'xes_invalid_attribute', 'XES attributes require a key and scalar values require a value.',
            metadata ? 'warning' : 'error');
        } else if (parent.kind !== 'global' && scope.seen.has(key)) {
          addIssue(scope, key, 'xes_duplicate_attribute', 'A direct XES attribute key was repeated.', metadata ? 'warning' : 'error');
        } else if (!scalar) {
          const canonical = !metadata && canonicalAttribute(key, level);
          addIssue(scope, key, canonical ? 'xes_invalid_attribute' : 'xes_unsupported_attribute',
            canonical ? 'This XES field requires a scalar value.' : 'Non-scalar XES attribute data was skipped.', canonical ? 'error' : 'warning');
        } else if (!metadata) {
          scope.attrs.set(key, { type: name, value: value! });
        }
        if (parent.kind !== 'global') scope.seen.add(key);
        stack.push({ kind: scalar ? 'attribute' : 'skip', key, warned: false });
      },
      close() {
        const frame = stack.pop();
        if (frame?.kind === 'event') event = undefined;
        if (frame?.kind === 'trace') {
          finishTrace(trace!);
          trace = undefined;
        }
      },
      text(text) {
        if (!/[^ \t\r\n]/.test(text)) return;
        const frame = stack.at(-1);
        if (frame?.kind === 'skip') return;
        if (frame?.kind !== 'attribute') unsupported();
        const scope = event ?? trace ?? log;
        addIssue(scope, frame.key, 'xes_invalid_attribute', 'XES scalar attributes use the value property.',
          scope === log ? 'warning' : 'error');
      },
    });
  } catch (error) {
    if (error instanceof XesXmlError) return reject(error.code, error.message);
    throw error;
  }

  const normalized = validateAndNormalize(rows, { ...options, festivalValidation: options.festivalValidation ?? false, mapping });
  const events = normalized.events.map(item => ({ ...item, sourceOrder: ordinals[item.sourceOrder] }));
  const rawCount = eventLocations.length;
  const excludedCount = rawCount - events.length;
  const normalizationIssues = normalized.issues.map(issue => {
    const row = issue.row < 0 ? -1 : ordinals[issue.row];
    return { ...issue, row, location: row < 0 ? null : eventLocations[row] };
  });
  return {
    status: 'parsed', eventLocations, traces,
    validation: {
      events, rawCount, excludedCount, canAnalyze: events.length > 0 && (!excludedCount || options.acceptExclusions),
      issues: [...log.issues, ...issues, ...normalizationIssues].sort((a, b) => a.row - b.row),
    },
  };
}
