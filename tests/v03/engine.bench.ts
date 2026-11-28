import { bench, describe } from 'vitest';
import * as engine from '../../src/engine';
import { key, options, pair, row, tracesOf } from '../engine-fixtures';

const caseCount = 850;
const epoch = Date.parse('2026-11-28T00:00:00Z');
const records = [];
for (let i = 0; i < caseCount; i++) {
  const id = String(i);
  const start = epoch / 60_000 + i / 60;
  records.push(row(id, 'Arrive', start, { resource: 'Front desk' }));
  for (let j = 0; j < 5; j++) {
    records.push(...pair(id, j % 2 === 0 ? 'Prepare' : 'Check', start + j, start + j + 1.5, {
      resource: j % 2 === 0 ? 'Crew A' : 'Crew B', activity_instance_id: String(j),
    }));
  }
  records.push(row(id, 'Ready', start + 6, { resource: 'Front desk' }));
}
const traces = tracesOf(records);
const intervalIndex = engine.buildReplayIndex(traces, { completionActivities: ['Ready'] });
const query = { window: { startMs: epoch, endMs: epoch + 2_000_000 }, cursorMs: epoch + 450_000 };
const queueInputs = Array.from({ length: caseCount }, (_, i) => ({
  caseKey: key(String(i)), arrivalMs: epoch + 75 * i, serviceSec: 0.15 + (i % 2) * 0.1, sourceOrder: i,
}));
const xesEvent = '<event><string key="concept:name" value="Recorded"/><date key="time:timestamp" value="2026-11-28T00:00:00Z"/></event>';
const xesTraces = Array.from({ length: 1000 }, (_, i) =>
  `<trace><string key="concept:name" value="${i}"/>${xesEvent.repeat(50)}</trace>`);
const xesBytes = new TextEncoder().encode(`<log>${xesTraces.join('')}</log>`);
const check = engine.importXes(xesBytes, options);
if (check.status !== 'parsed' || check.validation.events.length !== 50_000 || !check.validation.canAnalyze) {
  throw new Error('Expected 50,000 accepted XES events for the benchmark.');
}

describe('Phase 3 synthetic engine benchmarks', () => {
  bench('XES import / 50,000 point events and 1,000 traces', () => {
    engine.importXes(xesBytes, options);
  }, { time: 1500, iterations: 8 });
  bench('DFG + performance + WTN / 850 cases and 10,200 events', () => {
    engine.buildDFG(traces);
    engine.getPerformance(traces);
    engine.getResourceAnalysis(traces);
  });
  bench('replay index / 850 cases and 10,200 events', () => {
    engine.buildReplayIndex(traces, { completionActivities: ['Ready'] });
  });
  bench('replay frame / 850 cases', () => {
    engine.getReplayFrame(intervalIndex, query);
  });
  bench('ICN-inspired patterns / 4,250 matched intervals', () => {
    engine.getPatternEvidence(traces);
  });
  bench('two FCFS scenarios / 850 cases', () => {
    engine.compareQueues(queueInputs, { baselineServers: 2, candidateServers: 3, assumeOneQualifiedWorkerPerServer: false });
  });
});
