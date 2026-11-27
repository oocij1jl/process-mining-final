import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, expect, test } from 'vitest';
import { DEFAULT_MISSING_RESOURCES } from '../src/contracts';
import type { FindingAnalysis, ImportOptions, RawRow } from '../src/contracts';
import * as engine from '../src/engine';

const fixtureUrl = new URL('./fixtures/phase-0-event-log.csv', import.meta.url);
const fixture = Papa.parse<RawRow>(readFileSync(fixtureUrl, 'utf8'), {
  header: true,
  skipEmptyLines: true,
});

const importOptions: ImportOptions = {
  mapping: { case_id: 'case_id', activity: 'activity', timestamp: 'timestamp' },
  missingResources: DEFAULT_MISSING_RESOURCES,
  acceptExclusions: false,
};

const emptyAnalysis: FindingAnalysis = {
  scope: { datasetId: 'phase-0-fixture', processKey: 'default', analysisFilterFingerprint: 'all' },
  traces: [],
  dfg: { nodes: [], edges: [], starts: {}, ends: {} },
  performance: { gaps: [], overlaps: 0, matchedPairs: 0, ambiguousPairs: 0 },
  resources: {
    resources: [],
    handoffs: [],
    knownRawEvents: 0,
    totalRawEvents: 0,
    knownInstances: 0,
    totalInstances: 0,
  },
  metrics: [],
};

test('PapaParse reads the Phase 0 fixture with lifecycle and resource values intact', () => {
  expect(fixture.errors).toEqual([]);
  expect(fixture.meta.fields).toEqual([
    'event_id', 'case_id', 'activity', 'timestamp', 'lifecycle', 'activity_instance_id', 'resource',
  ]);
  expect(fixture.data.map((row) => Object.values(row))).toEqual([
    ['E01', '001', 'A', '2026-11-27T00:00:00Z', '', '', 'R1'],
    ['E02', '001', 'A', '2026-11-27T00:01:00Z', 'start', 'A1', 'R1'],
    ['E03', '001', 'A', '2026-11-27T00:05:00Z', 'complete', 'A1', 'R1'],
    ['E04', '001', 'B', '2026-11-27T00:08:00Z', 'start', 'B1', 'R2'],
    ['E05', '001', 'B', '2026-11-27T00:12:00Z', 'complete', 'B1', 'R2'],
    ['E06', '001', 'C', '2026-11-27T00:15:00Z', '', '', ''],
    ['E07', '002', 'A', '2026-11-27T00:01:00Z', '', '', 'R2'],
    ['E08', '002', 'C', '2026-11-27T00:21:00Z', '', '', 'R1'],
  ]);
});

describe('Phase 0 engine placeholders', () => {
  const calls = {
    validateAndNormalize: () => engine.validateAndNormalize(fixture.data, importOptions),
    groupCases: () => engine.groupCases([]),
    buildDFG: () => engine.buildDFG([]),
    getVariants: () => engine.getVariants([]),
    getCaseDurations: () => engine.getCaseDurations([]),
    getPerformance: () => engine.getPerformance([]),
    getResourceAnalysis: () => engine.getResourceAnalysis([]),
    getKPIs: () => engine.getKPIs([], { processKey: 'default' }),
    getFindings: () => engine.getFindings(emptyAnalysis, []),
    evaluateTargets: () => engine.evaluateTargets([], []),
    getGateInputs: () => engine.getGateInputs([], {
      mode: 'assumed',
      serviceActivity: 'Ticket Verification',
      serviceSec: 4,
    }),
    simulateGateQueue: () => engine.simulateGateQueue([
      { caseKey: '["audience","001"]', arrivalMs: 0, serviceSec: 4, sourceOrder: 0 },
    ], 1),
  } satisfies Record<Exclude<keyof typeof engine, 'EngineNotImplementedError'>, () => unknown>;

  test.each(Object.entries(calls))('%s throws an explicit error', (functionName, invoke) => {
    expect(invoke).toThrow(engine.EngineNotImplementedError);
    expect(invoke).toThrow(expect.objectContaining({ functionName }));
  });
});
