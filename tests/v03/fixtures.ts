import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import type { RawRow } from '../../src/contracts';
import * as engine from '../../src/engine';
import { options } from '../engine-fixtures';

export function orderTraces() {
  const raw = readFileSync(new URL('../fixtures/order-processing-event-log.csv', import.meta.url), 'utf-8');
  const csv = Papa.parse<RawRow>(raw, { header: true, skipEmptyLines: true });
  return engine.groupCases(engine.validateAndNormalize(csv.data, {
    ...options, mapping: { case_id: 'order', activity: 'step', timestamp: 'occurred_at',
      resource: 'owner', lifecycle: 'state', activity_instance_id: 'instance' },
  }).events);
}
