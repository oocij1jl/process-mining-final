import Papa from 'papaparse';

/** Deterministic 32-bit FNV-1a fingerprint, used for dataset/filter identity only. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJSON(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  const normalized = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v]),
    ),
  );
  downloadText(filename, Papa.unparse(normalized), 'text/csv');
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}

export interface MalformedRowInfo {
  /** Zero-based data row index in the original file (header excluded). */
  sourceRow: number;
  code: 'TooManyFields' | 'TooFewFields' | 'ParseError';
  message: string;
}

export interface ParsedCsv {
  headers: string[];
  /** All data rows exactly as parsed (may contain PapaParse artefacts on malformed rows). */
  rows: Record<string, unknown>[];
  /** File-level parser messages (no specific row). */
  parseErrors: string[];
  /** Rows that cannot be passed to the engine as a complete string-only RawRow. */
  malformed: MalformedRowInfo[];
  renamedHeaders: boolean;
}

/** Parses CSV text to strings only; normalization is the engine's job. Quoted commas and leading zeros are preserved. */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const headers = result.meta.fields ?? [];
  const byRow = new Map<number, MalformedRowInfo>();
  const fileErrors: string[] = [];
  for (const e of result.errors) {
    if (typeof e.row !== 'number' || e.row < 0) {
      fileErrors.push(e.message);
      continue;
    }
    const code = e.code === 'TooManyFields' || e.code === 'TooFewFields' ? e.code : 'ParseError';
    if (!byRow.has(e.row)) byRow.set(e.row, { sourceRow: e.row, code, message: e.message });
  }
  // Defensive structural check: every kept row must hold exactly one string per header and nothing else.
  result.data.forEach((row, i) => {
    if (byRow.has(i)) return;
    const keys = Object.keys(row);
    if ('__parsed_extra' in row) {
      byRow.set(i, { sourceRow: i, code: 'TooManyFields', message: `Too many fields: expected ${headers.length}.` });
    } else if (headers.some((h) => typeof row[h] !== 'string') || keys.length !== headers.length) {
      byRow.set(i, { sourceRow: i, code: 'TooFewFields', message: `Too few fields: expected ${headers.length}.` });
    }
  });
  return {
    headers,
    rows: result.data,
    parseErrors: fileErrors.slice(0, 20),
    malformed: [...byRow.values()].sort((a, b) => a.sourceRow - b.sourceRow),
    renamedHeaders: !!result.meta.renamedHeaders && Object.keys(result.meta.renamedHeaders).length > 0,
  };
}

/**
 * Builds the engine input: only structurally valid rows, each a string-only RawRow
 * with exactly the CSV headers. `rowMap[i]` is the original file row of engine row i,
 * so engine issue rows and sourceOrder can be shown in original numbering.
 */
export function engineRows(parsed: ParsedCsv): { rows: Record<string, string>[]; rowMap: number[] } {
  const bad = new Set(parsed.malformed.map((m) => m.sourceRow));
  const rows: Record<string, string>[] = [];
  const rowMap: number[] = [];
  parsed.rows.forEach((row, i) => {
    if (bad.has(i)) return;
    rows.push(Object.fromEntries(parsed.headers.map((h) => [h, row[h] as string])));
    rowMap.push(i);
  });
  return { rows, rowMap };
}
