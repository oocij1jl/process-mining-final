/** Presentation helpers only — no analytical computation. */

export const NA = 'N/A';

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Formats a minute value with an adaptive unit, keeping the source unit visible. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return NA;
  const abs = Math.abs(min);
  if (abs === 0) return '0 min';
  if (abs < 1) return `${fmtNumber(min * 60, 1)} s`;
  if (abs < 120) return `${fmtNumber(min, 2)} min`;
  if (abs < 60 * 48) return `${fmtNumber(min / 60, 2)} h`;
  return `${fmtNumber(min / 1440, 2)} d`;
}

/**
 * Formats a metric value by its unit, as returned by the engine. No conversion
 * between scales: `%` values are already 0–100, `min` values are minutes.
 */
export function fmtValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return NA;
  if (unit === 'min') return fmtMinutes(value);
  if (unit === '%') return `${fmtNumber(value, 1)}%`;
  return `${fmtNumber(value)} ${unit}`.trim();
}

export function fmtShare(fraction: number): string {
  return `${fmtNumber(fraction * 100, 1)}%`;
}

export function fmtPct(part: number, whole: number): string {
  if (!whole) return NA;
  return `${fmtNumber((part / whole) * 100, 1)}%`;
}

const dtf = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/** Displays UTC epoch ms in the viewer's timezone, with the zone shown explicitly. */
export function fmtInstant(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NA;
  return dtf.format(new Date(ms));
}

const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
export function fmtTime(ms: number): string {
  return timeOnly.format(new Date(ms));
}

export const VIEWER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Case keys are JSON [processType, caseId]; show only the case ID. */
export function caseLabel(caseKey: string): string {
  try {
    const parsed: unknown = JSON.parse(caseKey);
    if (Array.isArray(parsed) && parsed.length === 2) return String(parsed[1]);
  } catch {
    /* fall through */
  }
  return caseKey;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`;
}

/** Festival process names are used only when the dataset enables Festival adapters. */
export function processLabel(key: string, festival = false): string {
  if (festival) {
    const known: Record<string, string> = {
      stage: 'Stage & Technical Operations',
      audience: 'Audience Entry',
      equipment: 'Equipment & Technical Readiness',
    };
    if (known[key]) return known[key];
  }
  return key === 'default' ? 'Default process' : key;
}

const RESOURCE_PREFIX = '@resource:';

/**
 * Display label for an engine resource key. The engine scopes resources that
 * share a display name across festivals as `@resource:` + JSON array
 * (["festival", id, name] | ["shared", id] | ["unresolved", caseKey, name] |
 * ["literal", name]). Plain names are returned unchanged. Keys are never
 * merged or rewritten here; this is presentation only.
 */
export function resourceLabel(key: string): string {
  if (!key.startsWith(RESOURCE_PREFIX)) return key;
  try {
    const parts: unknown = JSON.parse(key.slice(RESOURCE_PREFIX.length));
    if (Array.isArray(parts) && parts.every((p) => typeof p === 'string')) {
      const [kind, a, b] = parts as string[];
      if (kind === 'festival' && b !== undefined) return `${b} · ${a}`;
      if (kind === 'shared' && a !== undefined) return `${a} (shared ID)`;
      if (kind === 'unresolved' && b !== undefined) return `${b} (festival unresolved)`;
      if (kind === 'literal' && a !== undefined) return a;
    }
  } catch {
    /* fall through */
  }
  return key;
}
