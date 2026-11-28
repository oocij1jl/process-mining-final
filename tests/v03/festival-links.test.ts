import { expect, test } from 'vitest';
import { getFestivalReadinessLinks, getKPIs } from '../../src/engine';
import { instant, key, row, tracesOf } from '../engine-fixtures';

test('existing Festival readiness links keep Festival namespaces, selected scope and ambiguous counterparts separate', () => {
  const stage = (id: string, festival_id: string, setup: number, ready: number) => {
    const attrs = { process_type: 'stage', festival_id, performance_id: 'P01', scheduled_start: instant(10) };
    return [row(id, 'Stage Setup', setup, { ...attrs, lifecycle: 'start' }), row(id, 'Stage Ready', ready, attrs)];
  };
  const equipment = (id: string, festival_id: string, ready: number) =>
    row(id, 'Equipment Ready', ready, { process_type: 'equipment', festival_id, performance_id: 'P01', required_ready_at: instant(6) });
  const dataset = tracesOf([
    ...stage('S1', 'F1', 5, 8), ...stage('S2', 'F2', 8, 12),
    equipment('On', 'F1', 5), equipment('Late', 'F2', 9), equipment('Unknown', 'F3', 1),
    row('Audience', 'Entry Complete', 1, { process_type: 'audience', festival_id: 'F1', performance_id: 'P01' }),
  ]);
  const stageCases = dataset.filter(trace => trace.processType === 'stage');
  const equipmentCases = dataset.filter(trace => trace.processType === 'equipment');
  const festival = { equipmentDeadline: 'linked_stage_setup_start' as const, linkedStageTraces: stageCases, linkedEquipmentTraces: equipmentCases };
  const metrics = getKPIs(equipmentCases, { processKey: 'equipment', festival });
  expect(metrics.find(metric => metric.id === 'equipment_on_time_rate')).toMatchObject({
    value: 50, n: 2, eligible: 3, caseKeys: [key('On', 'equipment')],
    problemCaseKeys: { min: [key('Late', 'equipment')], max: [key('On', 'equipment')] },
  });
  expect(metrics.find(metric => metric.id === 'equipment_unmatched_performance_count')).toMatchObject({
    value: 1, caseKeys: [key('Unknown', 'equipment')],
  });
  const stageView = getKPIs(stageCases.slice(0, 1), { processKey: 'stage', festival });
  expect(stageView.find(metric => metric.id === 'stage_on_time_rate')).toMatchObject({ value: 100, n: 1 });
  expect(stageView.find(metric => metric.id === 'equipment_on_time_rate')).toMatchObject({
    value: 100, eligible: 1, caseKeys: [key('On', 'equipment')],
  });

  const duplicate = tracesOf(stage('Other S1', 'F1', 4, 8));
  const ambiguous = getKPIs(equipmentCases, {
    processKey: 'equipment', festival: { ...festival, linkedStageTraces: [...stageCases, ...duplicate] },
  });
  expect(ambiguous.find(metric => metric.id === 'equipment_on_time_rate')).toMatchObject({
    value: 0, n: 1, eligible: 3, problemCaseKeys: { min: [key('Late', 'equipment')], max: [] },
  });
  expect(ambiguous.find(metric => metric.id === 'equipment_unmatched_performance_count')).toMatchObject({
    value: 2, caseKeys: [key('On', 'equipment'), key('Unknown', 'equipment')],
  });
  expect(getKPIs(equipmentCases, { processKey: 'equipment', festival: { ...festival, equipmentDeadline: 'required_ready_at' } })
    .find(metric => metric.id === 'equipment_on_time_rate')).toMatchObject({ n: 3, caseKeys: [key('On', 'equipment'), key('Unknown', 'equipment')] });
});

const stageAttrs = { process_type: 'stage', festival_id: 'F1', performance_id: 'P01', scheduled_start: instant(10) };
const equipmentAttrs = { process_type: 'equipment', festival_id: 'F1', performance_id: 'P01', required_ready_at: instant(7) };
const setup = (id: string, minute: number, attrs = stageAttrs) => row(id, 'Stage Setup', minute, { ...attrs, lifecycle: 'start' });
const ready = (id: string, minute: number, attrs = stageAttrs) => row(id, 'Stage Ready', minute, attrs);
const equipmentReady = (id: string, minute: number, attrs = equipmentAttrs) => row(id, 'Equipment Ready', minute, attrs);
const ref = (process: 'stage' | 'equipment', id: string, minute: number, sourceOrder: number) =>
  ({ caseKey: key(id, process), timestampMs: minute * 60_000, sourceOrder });

test('returns the original Stage Setup, Stage Ready and Equipment Ready evidence for both deadline policies', () => {
  const all = tracesOf([
    ready('S', 11), setup('S', 5), ready('S', 10), setup('S', 5),
    equipmentReady('E', 8), equipmentReady('E', 6), equipmentReady('E', 6),
    setup('Unrelated', 4, { ...stageAttrs, festival_id: 'F2' }),
  ]);
  const stages = all.filter(trace => trace.processType === 'stage');
  const equipment = all.filter(trace => trace.processType === 'equipment');
  const explicit = getFestivalReadinessLinks(equipment, { linkedStageTraces: stages }, 'equipment');
  expect(explicit).toEqual([{
    festivalId: 'F1', performanceId: 'P01', linkStatus: 'linked',
    stageCaseKey: key('S', 'stage'), equipmentCaseKey: key('E', 'equipment'),
    stageSetupStart: ref('stage', 'S', 5, 1), stageReady: ref('stage', 'S', 10, 2),
    stageDeadlineMs: 600_000, stageOnTime: true,
    equipmentReady: ref('equipment', 'E', 6, 5),
    equipmentDeadlineSource: 'required_ready_at', equipmentDeadlineMs: 420_000, equipmentOnTime: true,
  }]);
  expect(getFestivalReadinessLinks(equipment, {
    linkedStageTraces: stages, equipmentDeadline: 'linked_stage_setup_start',
  }, 'equipment')).toEqual([{
    ...explicit[0], equipmentDeadlineSource: 'linked_stage_setup_start', equipmentDeadlineMs: 300_000, equipmentOnTime: false,
  }]);
  expect(JSON.parse(JSON.stringify(explicit))).toEqual(explicit);
});

test('Stage view uses selected Stage cases and full Equipment candidates in counterpart order', () => {
  const otherStage = { ...stageAttrs, festival_id: 'F2' };
  const otherEquipment = { ...equipmentAttrs, festival_id: 'F2' };
  const all = tracesOf([
    setup('S', 5), ready('S', 8),
    setup('Duplicate', 3), setup('Unselected', 3, otherStage),
    equipmentReady('Other festival', 3, otherEquipment),
    equipmentReady('First', 5), equipmentReady('Second', 6),
    equipmentReady('Unmatched', 2, { ...equipmentAttrs, performance_id: 'P02' }),
    row('A', 'Equipment Ready', 1, { ...equipmentAttrs, process_type: 'audience' }),
  ]);
  const [selected, duplicate] = all.filter(trace => trace.processType === 'stage');
  const stageConfig = { linkedEquipmentTraces: all, linkedStageTraces: all, equipmentDeadline: 'linked_stage_setup_start' as const };
  const rows = getFestivalReadinessLinks([selected], stageConfig, 'stage');
  expect(rows.map(item => [item.stageCaseKey, item.equipmentCaseKey, item.equipmentOnTime])).toEqual([
    [key('S', 'stage'), key('First', 'equipment'), true],
    [key('S', 'stage'), key('Second', 'equipment'), false],
  ]);
  expect(getFestivalReadinessLinks([selected, duplicate], stageConfig, 'stage')).toEqual([]);
  expect(getFestivalReadinessLinks([selected], {}, 'stage')).toEqual([]);
  expect(getFestivalReadinessLinks([], stageConfig, 'stage')).toEqual([]);
  expect(getKPIs([selected], { processKey: 'stage', festival: stageConfig }).find(m => m.id === 'equipment_on_time_rate'))
    .toMatchObject({ eligible: rows.length, n: 2, value: 50, caseKeys: [key('First', 'equipment')],
      problemCaseKeys: { min: [key('Second', 'equipment')], max: [key('First', 'equipment')] } });
  expect(getKPIs([selected, duplicate], { processKey: 'stage', festival: stageConfig }).find(m => m.id === 'equipment_on_time_rate'))
    .toMatchObject({ eligible: 0, n: 0, value: null });
});

test('Equipment view distinguishes ambiguous, missing, incomplete and unavailable Stage links', () => {
  const candidates = tracesOf([
    setup('S1', 5), setup('S2', 4),
    row('A', 'Stage Setup', 1, { ...stageAttrs, process_type: 'audience', performance_id: 'P02', lifecycle: 'start' }),
  ]);
  const selected = tracesOf([
    equipmentReady('Ambiguous', 5), equipmentReady('Missing', 6, { ...equipmentAttrs, performance_id: 'P02' }),
    equipmentReady('No key', 8, { ...equipmentAttrs, festival_id: '' }),
    equipmentReady('Conflict', 5),
    row('Conflict', 'Inspection', 1, { ...equipmentAttrs, festival_id: 'F2' }),
  ]);
  const results = getFestivalReadinessLinks(selected, { linkedStageTraces: candidates }, 'equipment');
  expect(results.map(({ festivalId, performanceId, linkStatus, equipmentOnTime }) => [festivalId, performanceId, linkStatus, equipmentOnTime]))
    .toEqual([
      ['F1', 'P01', 'ambiguous_stage', true], ['F1', 'P02', 'missing_stage', true],
      [null, 'P01', 'missing_key', false], [null, 'P01', 'missing_key', true],
    ]);
  for (const result of results) {
    expect(result).toMatchObject({ stageCaseKey: null, stageSetupStart: null, stageReady: null, stageDeadlineMs: null, stageOnTime: null });
  }
  expect(getFestivalReadinessLinks(selected, {}, 'equipment').map(row => row.linkStatus))
    .toEqual(['stage_scope_unavailable', 'stage_scope_unavailable', 'missing_key', 'missing_key']);
  expect(getFestivalReadinessLinks(selected, { linkedStageTraces: [] }, 'equipment').map(row => row.linkStatus))
    .toEqual(['missing_stage', 'missing_stage', 'missing_key', 'missing_key']);
  expect(getFestivalReadinessLinks(selected, {
    linkedStageTraces: candidates, equipmentDeadline: 'linked_stage_setup_start',
  }, 'equipment').map(row => [row.equipmentDeadlineMs, row.equipmentOnTime]))
    .toEqual([[null, null], [null, null], [null, null], [null, null]]);
  expect(getKPIs(selected, { processKey: 'equipment', festival: { linkedStageTraces: candidates } })
    .find(m => m.id === 'equipment_unmatched_performance_count'))
    .toMatchObject({ n: results.length, value: results.length, caseKeys: results.map(row => row.equipmentCaseKey) });
  expect(getKPIs(selected, { processKey: 'equipment', festival: {} })
    .find(m => m.id === 'equipment_unmatched_performance_count')).toMatchObject({ n: 0, value: null });
});

test('preserves valid zero deadlines and reports null for missing observations or conflicting deadlines', () => {
  const all = tracesOf([
    row('S', 'Stage Setup', 0, { ...stageAttrs, scheduled_start: instant(10), lifecycle: 'complete' }),
    row('S', 'Stage Ready', 1, { ...stageAttrs, scheduled_start: instant(11), lifecycle: 'start' }),
    row('No ready', 'Equipment Ready', 1, { ...equipmentAttrs, required_ready_at: instant(0), lifecycle: 'start' }),
    equipmentReady('No deadline', 2, { ...equipmentAttrs, required_ready_at: 'invalid' }),
  ]);
  const stage = all.filter(trace => trace.processType === 'stage');
  const equipment = all.filter(trace => trace.processType === 'equipment');
  const rows = getFestivalReadinessLinks(equipment, { linkedStageTraces: stage }, 'equipment');
  expect(rows[0]).toMatchObject({ linkStatus: 'linked', stageCaseKey: key('S', 'stage'),
    stageSetupStart: null, stageReady: null, stageDeadlineMs: null, stageOnTime: null,
    equipmentReady: null, equipmentDeadlineMs: 0, equipmentOnTime: null });
  expect(rows[1]).toMatchObject({ equipmentReady: ref('equipment', 'No deadline', 2, 3),
    equipmentDeadlineMs: null, equipmentOnTime: null });
  expect(getKPIs(equipment, { processKey: 'equipment', festival: { linkedStageTraces: stage } })
    .find(m => m.id === 'equipment_on_time_rate')).toMatchObject({ n: 0, eligible: 2, value: null });
});

test('Equipment and Stage KPI rates follow the same valid observations and directional cases as the link rows', () => {
  const lateStage = { ...stageAttrs, festival_id: 'F2' };
  const lateEquipment = { ...equipmentAttrs, festival_id: 'F2' };
  const all = tracesOf([
    setup('On', 6), ready('On', 10, { ...stageAttrs, scheduled_start: '1970-01-01T09:10:00+09:00' }),
    setup('Late', 7, lateStage), ready('Late', 11, lateStage),
    equipmentReady('First', 6), equipmentReady('Second', 8, lateEquipment),
    row('No observation', 'Equipment Requested', 3, equipmentAttrs),
  ]);
  const stages = all.filter(trace => trace.processType === 'stage');
  const equipment = all.filter(trace => trace.processType === 'equipment');
  for (const equipmentDeadline of ['required_ready_at', 'linked_stage_setup_start'] as const) {
    const config = { linkedStageTraces: stages, linkedEquipmentTraces: equipment, equipmentDeadline };
    const equipmentRows = getFestivalReadinessLinks(equipment, config, 'equipment');
    const stageRows = getFestivalReadinessLinks(stages, config, 'stage');
    expect(equipmentRows).toEqual(stageRows);
    for (const [processKey, selection, links] of [['equipment', equipment, equipmentRows], ['stage', stages, stageRows]] as const) {
      const metrics = getKPIs(selection, { processKey, festival: config });
      const onTime = links.filter(link => link.equipmentOnTime === true).map(link => link.equipmentCaseKey);
      const late = links.filter(link => link.equipmentOnTime === false).map(link => link.equipmentCaseKey);
      expect([onTime, late]).toEqual([[key('First', 'equipment')], [key('Second', 'equipment')]]);
      expect(metrics.find(m => m.id === 'equipment_on_time_rate')).toMatchObject({
        eligible: links.length, n: onTime.length + late.length, value: 50,
        caseKeys: onTime, problemCaseKeys: { min: late, max: onTime },
      });
      if (processKey === 'stage') {
        const stageCases = new Map(links.map(link => [link.stageCaseKey, link.stageOnTime]));
        const passed = [...stageCases].filter(([, status]) => status === true).map(([id]) => id);
        const failed = [...stageCases].filter(([, status]) => status === false).map(([id]) => id);
        expect([passed, failed]).toEqual([[key('On', 'stage')], [key('Late', 'stage')]]);
        expect(metrics.find(m => m.id === 'stage_on_time_rate')).toMatchObject({
          n: passed.length + failed.length, value: 50, caseKeys: passed, problemCaseKeys: { min: failed, max: passed },
        });
      }
    }
  }
});

test('rejects a mixed or mismatched primary selection even when counterpart data is supplied', () => {
  const mixed = tracesOf([setup('S', 0), equipmentReady('E', 1)]);
  expect(() => getFestivalReadinessLinks(mixed, { linkedStageTraces: mixed }, 'equipment')).toThrow(RangeError);
  expect(() => getFestivalReadinessLinks(mixed.slice(1), { linkedEquipmentTraces: mixed }, 'stage')).toThrow(RangeError);
  expect(() => getFestivalReadinessLinks([], {}, 'audience' as 'stage')).toThrow(RangeError);
});
