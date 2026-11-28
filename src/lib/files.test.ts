import { describe, expect, test } from 'vitest';
import { engineRows, parseCsv } from './files';

describe('parseCsv / engineRows (UI parsing boundary)', () => {
  test('keeps quoted commas, leading-zero case IDs and empty strings as strings', () => {
    const parsed = parseCsv('case_id,activity,timestamp,resource\n001,"Check, left",2026-11-27T00:00:00Z,\n0002,A,2026-11-27T00:01:00Z,R1\n');
    expect(parsed.malformed).toEqual([]);
    const { rows, rowMap } = engineRows(parsed);
    expect(rows).toEqual([
      { case_id: '001', activity: 'Check, left', timestamp: '2026-11-27T00:00:00Z', resource: '' },
      { case_id: '0002', activity: 'A', timestamp: '2026-11-27T00:01:00Z', resource: 'R1' },
    ]);
    expect(rowMap).toEqual([0, 1]);
  });

  test('flags TooManyFields / TooFewFields rows with their original row index', () => {
    const parsed = parseCsv('case_id,activity,timestamp\n1,A,t1\n2,B,t2,EXTRA\n3,C\n4,D,t4\n');
    expect(parsed.malformed.map((m) => [m.sourceRow, m.code])).toEqual([
      [1, 'TooManyFields'],
      [2, 'TooFewFields'],
    ]);
    // The raw parse result still contains the PapaParse artefacts; they must never reach the engine.
    expect('__parsed_extra' in parsed.rows[1]!).toBe(true);
  });

  test('engine rows are string-only, complete, and map back to original rows', () => {
    const parsed = parseCsv('case_id,activity,timestamp\n1,A,t1\n2,B,t2,EXTRA\n3,C\n4,D,t4\n');
    const { rows, rowMap } = engineRows(parsed);
    expect(rows).toEqual([
      { case_id: '1', activity: 'A', timestamp: 't1' },
      { case_id: '4', activity: 'D', timestamp: 't4' },
    ]);
    expect(rowMap).toEqual([0, 3]);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(['case_id', 'activity', 'timestamp']);
      expect(Object.values(row).every((v) => typeof v === 'string')).toBe(true);
    }
  });

  test('empty file and header-only file', () => {
    expect(parseCsv('').headers).toEqual([]);
    const headerOnly = parseCsv('case_id,activity,timestamp\n');
    expect(headerOnly.headers).toEqual(['case_id', 'activity', 'timestamp']);
    expect(engineRows(headerOnly).rows).toEqual([]);
  });
});
