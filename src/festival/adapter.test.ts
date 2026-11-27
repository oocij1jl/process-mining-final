import { describe, expect, test } from 'vitest';
import { DEFAULT_FESTIVAL_SETTINGS, festivalKpiConfig, festivalRework, gateScenarioAvailable, parseManifest, settingsFromManifest } from './adapter';
import { processLabel, resourceLabel } from '../lib/format';

describe('Festival adapter (explicit opt-in only)', () => {
  test('gate scenario requires Festival adapters AND the audience process', () => {
    expect(gateScenarioAvailable(true, 'audience')).toBe(true);
    expect(gateScenarioAvailable(false, 'audience')).toBe(false); // generic CSV with an "audience" process
    expect(gateScenarioAvailable(true, 'stage')).toBe(false);
    expect(gateScenarioAvailable(undefined, null)).toBe(false);
  });

  test('every FestivalKPIConfig field is filled explicitly', () => {
    const cfg = festivalKpiConfig(DEFAULT_FESTIVAL_SETTINGS, []);
    expect(Object.keys(cfg).sort()).toEqual(
      ['equipmentDeadline', 'linkedEquipmentTraces', 'linkedStageTraces', 'stageHandoverPointFallback', 'technicalCheckRepeatActivity'].sort(),
    );
  });

  test('rework vocabulary only for stage and equipment', () => {
    expect(festivalRework('stage', DEFAULT_FESTIVAL_SETTINGS)).toEqual({ explicitActivities: ['Technical Recheck'], repeatedActivities: ['Technical Check'] });
    expect(festivalRework('equipment', DEFAULT_FESTIVAL_SETTINGS)).toEqual({ explicitActivities: ['Inspection Rework'], repeatedActivities: ['Pre-use Inspection'] });
    expect(festivalRework('audience', DEFAULT_FESTIVAL_SETTINGS)).toBeUndefined();
  });

  test('v1.0 manifest (no new fields) is still valid', () => {
    const { manifest, errors } = parseManifest({ name: 'Demo', csv: 'demo.csv', bpmn: { audience: 'a.bpmn' }, baseline_gate_count: 3 });
    expect(errors).toEqual([]);
    expect(manifest!.bpmn).toEqual({ audience: 'a.bpmn' });
    expect(manifest!.bpmn_to_be).toBeUndefined();
    expect(settingsFromManifest(manifest!)).toEqual(DEFAULT_FESTIVAL_SETTINGS);
  });

  test('v1.1 optional fields are read; invalid optional fields are reported and dropped', () => {
    const { manifest, errors } = parseManifest({
      csv: 'demo.csv',
      bpmn_to_be: { audience: 'audience_to_be.bpmn', stage: '../escape.bpmn' },
      festival_config: { technical_check_repeat_activity: 'Line Check', equipment_deadline: 'linked_stage_setup_start' },
      baseline_gate_count: 2.5,
      missing_resource_values: ['', 'NONE'],
    });
    expect(manifest!.bpmn_to_be).toEqual({ audience: 'audience_to_be.bpmn' });
    expect(manifest!.baseline_gate_count).toBeUndefined();
    expect(manifest!.missing_resource_values).toEqual(['', 'NONE']);
    expect(errors.length).toBe(2);
    expect(settingsFromManifest(manifest!).technicalCheckRepeatActivity).toBe('Line Check');
    expect(settingsFromManifest(manifest!).equipmentDeadline).toBe('linked_stage_setup_start');
  });

  test('csv is required', () => {
    expect(parseManifest({ name: 'x' }).manifest).toBeNull();
    expect(parseManifest({ csv: '/etc/passwd' }).manifest).toBeNull();
  });
});

describe('labels', () => {
  test('Festival process names only with Festival adapters', () => {
    expect(processLabel('stage', true)).toBe('Stage & Technical Operations');
    expect(processLabel('stage', false)).toBe('stage');
  });
  test('engine resource keys are labelled, plain names unchanged', () => {
    expect(resourceLabel('R1')).toBe('R1');
    expect(resourceLabel('@resource:["festival","F1","Local Crew"]')).toBe('Local Crew · F1');
    expect(resourceLabel('@resource:["shared","EMP-7"]')).toBe('EMP-7 (shared ID)');
    expect(resourceLabel('@resource:not-json')).toBe('@resource:not-json');
  });
});
