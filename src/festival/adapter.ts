/**
 * Festival case-study adapter.
 *
 * ProcessPilot is a general-purpose process-intelligence tool. Everything in
 * this module applies ONLY when a dataset explicitly enables Festival adapters
 * (`DatasetState.festival === true`): the bundled Festival sample, or a user
 * who ticks "Enable Festival case-study adapters". Generic CSVs never receive
 * Festival activity names, KPI settings, rework rules or the gate simulation.
 *
 * Activity names and KPI IDs follow docs/DATA_SCHEMA.md §2/§7–8 and the engine
 * implementation report (reports/evidence/phase-1-engine.md, feat/engine).
 */
import type { FestivalKPIConfig, FindingAnalysis, Trace } from '../contracts';

export const FESTIVAL_PROCESS_LABELS: Record<string, string> = {
  stage: 'Stage & Technical Operations',
  audience: 'Audience Entry',
  equipment: 'Equipment & Technical Readiness',
};

/** Process key whose cases feed the pooled FCFS gate model (DATA_SCHEMA §7). */
export const GATE_PROCESS_KEY = 'audience';
export const DEFAULT_SERVICE_ACTIVITY = 'Ticket Verification';
/** Only this observed KPI is comparable with the modeled mean wait in Refine. */
export const QUEUE_WAIT_METRIC_ID = 'audience_queue_wait_mean';
/** Engine KPI that carries bucketed completion counts (unit `cases/bucket`). */
export const THROUGHPUT_METRIC_ID = 'audience_throughput';

/** Columns that only matter for the Festival case study (grouped separately in mapping). */
export const FESTIVAL_FIELDS = [
  'festival_id', 'performance_id', 'stage_id', 'gate_id', 'equipment_request_id', 'equipment_type',
  'asset_id', 'scheduled_start', 'required_ready_at', 'ticket_type', 'issue_type',
] as const;

/** Optional overrides read from dataset_manifest.json `festival_config`. */
export interface FestivalSettings {
  technicalCheckRepeatActivity: string;
  stageHandoverPointFallback: boolean;
  equipmentDeadline: 'required_ready_at' | 'linked_stage_setup_start';
}

export const DEFAULT_FESTIVAL_SETTINGS: FestivalSettings = {
  technicalCheckRepeatActivity: 'Technical Check',
  stageHandoverPointFallback: false,
  equipmentDeadline: 'required_ready_at',
};

/**
 * Every FestivalKPIConfig field from the shared contract, filled explicitly.
 * Linked traces come from the whole dataset (cross-process linkage is by
 * festival_id + performance_id, not by the case filter of the selected process).
 */
export function festivalKpiConfig(settings: FestivalSettings, allTraces: readonly Trace[]): FestivalKPIConfig {
  return {
    stageHandoverPointFallback: settings.stageHandoverPointFallback,
    technicalCheckRepeatActivity: settings.technicalCheckRepeatActivity,
    equipmentDeadline: settings.equipmentDeadline,
    linkedStageTraces: allTraces.filter((t) => t.processType === 'stage'),
    linkedEquipmentTraces: allTraces.filter((t) => t.processType === 'equipment'),
  };
}

/**
 * Rework configuration for getFindings, aligned with the engine's Festival KPIs
 * (stage_recheck_rate, equipment_inspection_rework_rate). Processes without a
 * defined rework vocabulary return undefined so the engine uses its generic
 * adjacent self-loop rule.
 */
export function festivalRework(processKey: string, settings: FestivalSettings): FindingAnalysis['rework'] {
  switch (processKey) {
    case 'stage':
      return { explicitActivities: ['Technical Recheck'], repeatedActivities: [settings.technicalCheckRepeatActivity] };
    case 'equipment':
      return { explicitActivities: ['Inspection Rework'], repeatedActivities: ['Pre-use Inspection'] };
    default:
      return undefined;
  }
}

/** The quantified gate scenario exists only for the Festival audience process. */
export function gateScenarioAvailable(festival: boolean | undefined, processKey: string | null | undefined): boolean {
  return !!festival && processKey === GATE_PROCESS_KEY;
}

/* ----------------------------- Manifest ----------------------------- */

/** public/datasets/dataset_manifest.json — owned by the business/data track. */
export interface FestivalManifest {
  dataset_id?: string;
  name?: string;
  source_type?: 'synthetic' | 'user_upload';
  csv: string;
  timezone?: string;
  assumptions?: string[];
  source_references?: string[];
  baseline_gate_count?: number;
  service_activity?: string;
  missing_resource_values?: string[];
  /** As-is BPMN per process key, relative to public/bpmn/. */
  bpmn?: Record<string, string>;
  /** Optional To-be BPMN per process key, relative to public/bpmn/ (v1.1, backward compatible). */
  bpmn_to_be?: Record<string, string>;
  festival_config?: {
    technical_check_repeat_activity?: string;
    stage_handover_point_fallback?: boolean;
    equipment_deadline?: 'required_ready_at' | 'linked_stage_setup_start';
  };
  generator?: { version?: string; seed?: number | string };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isFileName = (v: unknown): v is string => isStr(v) && !v.includes('..') && !/^[a-z]+:/i.test(v) && !v.startsWith('/');
const strMap = (v: unknown, key: string, errors: string[]): Record<string, string> | undefined => {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`"${key}" must be an object of process key → file name.`);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, f] of Object.entries(v)) {
    if (isFileName(f)) out[k] = f;
    else errors.push(`"${key}.${k}" must be a relative file name.`);
  }
  return out;
};

/** Validates the manifest shape. Unknown keys are ignored; invalid optional keys are reported and dropped. */
export function parseManifest(raw: unknown): { manifest: FestivalManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, errors: ['Manifest must be a JSON object.'] };
  const m = raw as Record<string, unknown>;
  if (!isFileName(m.csv)) return { manifest: null, errors: ['"csv" is required and must be a relative file name under public/datasets/.'] };
  const out: FestivalManifest = { csv: m.csv };
  if (isStr(m.dataset_id)) out.dataset_id = m.dataset_id;
  if (isStr(m.name)) out.name = m.name;
  if (m.source_type === 'synthetic' || m.source_type === 'user_upload') out.source_type = m.source_type;
  else if (m.source_type !== undefined) errors.push('"source_type" must be "synthetic" or "user_upload".');
  if (isStr(m.timezone)) out.timezone = m.timezone;
  if (Array.isArray(m.assumptions)) out.assumptions = m.assumptions.filter(isStr);
  if (Array.isArray(m.source_references)) out.source_references = m.source_references.filter(isStr);
  if (m.baseline_gate_count !== undefined) {
    if (Number.isInteger(m.baseline_gate_count) && (m.baseline_gate_count as number) >= 1) out.baseline_gate_count = m.baseline_gate_count as number;
    else errors.push('"baseline_gate_count" must be an integer ≥ 1.');
  }
  if (isStr(m.service_activity)) out.service_activity = m.service_activity;
  if (Array.isArray(m.missing_resource_values)) {
    if (m.missing_resource_values.every((x) => typeof x === 'string')) out.missing_resource_values = m.missing_resource_values as string[];
    else errors.push('"missing_resource_values" must be an array of strings.');
  }
  out.bpmn = strMap(m.bpmn, 'bpmn', errors);
  out.bpmn_to_be = strMap(m.bpmn_to_be, 'bpmn_to_be', errors);
  if (m.festival_config !== undefined) {
    const fc = m.festival_config as Record<string, unknown>;
    out.festival_config = {};
    if (isStr(fc?.technical_check_repeat_activity)) out.festival_config.technical_check_repeat_activity = fc.technical_check_repeat_activity;
    if (typeof fc?.stage_handover_point_fallback === 'boolean') out.festival_config.stage_handover_point_fallback = fc.stage_handover_point_fallback;
    if (fc?.equipment_deadline === 'required_ready_at' || fc?.equipment_deadline === 'linked_stage_setup_start') out.festival_config.equipment_deadline = fc.equipment_deadline;
    else if (fc?.equipment_deadline !== undefined) errors.push('"festival_config.equipment_deadline" must be "required_ready_at" or "linked_stage_setup_start".');
  }
  if (m.generator && typeof m.generator === 'object') {
    const g = m.generator as Record<string, unknown>;
    out.generator = { version: isStr(g.version) ? g.version : undefined, seed: typeof g.seed === 'number' || isStr(g.seed) ? (g.seed as number | string) : undefined };
  }
  return { manifest: out, errors };
}

export function settingsFromManifest(m: FestivalManifest | undefined): FestivalSettings {
  const fc = m?.festival_config;
  return {
    technicalCheckRepeatActivity: fc?.technical_check_repeat_activity ?? DEFAULT_FESTIVAL_SETTINGS.technicalCheckRepeatActivity,
    stageHandoverPointFallback: fc?.stage_handover_point_fallback ?? DEFAULT_FESTIVAL_SETTINGS.stageHandoverPointFallback,
    equipmentDeadline: fc?.equipment_deadline ?? DEFAULT_FESTIVAL_SETTINGS.equipmentDeadline,
  };
}

/* ----------------------------- Process guide ----------------------------- */

/**
 * Plain-language description of each Festival process for the Overview chooser.
 * Summarised from docs/DATA_SCHEMA.md §2 (business/data track). Presentation only.
 */
export const FESTIVAL_PROCESS_INFO: Record<string, { caseMeaning: string; purpose: string; actors: string; boundary: string; question: string }> = {
  stage: {
    caseMeaning: 'One performance changeover (performance_id)',
    purpose: 'Get each stage handed over, set up, checked and ready before the scheduled start.',
    actors: 'Stage crew, audio/technical crew, stage manager',
    boundary: 'Stage Handover → Performance End',
    question: 'Where does stage preparation slow down, and who hands work to whom?',
  },
  audience: {
    caseMeaning: 'One entry attempt at a gate (entry_id)',
    purpose: 'Move visitors from the entry queue through ticket verification into the venue.',
    actors: 'Gate staff, security, visitors',
    boundary: 'Join Entry Queue → Entry Complete or rejection',
    question: 'How long do visitors wait, and what would one more gate change (modeled)?',
  },
  equipment: {
    caseMeaning: 'One equipment request for a performance (equipment_request_id)',
    purpose: 'Deliver inspected equipment to the stage before it is needed.',
    actors: 'Equipment crew, technicians, logistics',
    boundary: 'Equipment Requested → Equipment Ready',
    question: 'Which requests are late or need substitutes and rework?',
  },
};
