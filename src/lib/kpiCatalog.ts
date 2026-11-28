/**
 * Plain-language names for engine metric IDs (presentation only).
 * The engine's own `Metric.definition` stays the authoritative definition and is
 * always shown next to these names.
 */
const NAMES: Record<string, { name: string; question: string }> = {
  case_elapsed_mean: { name: 'Average case duration', question: 'How long does a case take from its first to its last recorded event?' },
  resource_utilization: { name: 'Resource utilization', question: 'How much of the validated shift time were resources busy?' },
  resource_out_of_shift_minutes: { name: 'Work outside shifts', question: 'How many busy minutes fall outside validated shifts?' },
  audience_queue_wait_mean: { name: 'Average entry queue wait', question: 'How long do visitors wait between joining the queue and verification?' },
  audience_entry_elapsed_mean: { name: 'Average entry duration', question: 'How long does a visitor take from joining the queue to entry?' },
  audience_manual_verification_rate: { name: 'Manual verification share', question: 'What share of entries needed a manual check?' },
  audience_throughput: { name: 'Completed entries per time bucket', question: 'How many entries were completed in each time bucket?' },
  stage_on_time_rate: { name: 'Stage on-time readiness', question: 'What share of performances were ready on time?' },
  stage_preparation_mean: { name: 'Average stage preparation', question: 'How long does stage preparation take from handover to ready?' },
  stage_recheck_rate: { name: 'Stage technical recheck share', question: 'What share of performances needed a technical recheck?' },
  equipment_on_time_rate: { name: 'Equipment ready on time', question: 'What share of equipment requests were ready by the deadline?' },
  equipment_lead_time_mean: { name: 'Average equipment lead time', question: 'How long does it take from request to ready?' },
  equipment_inspection_rework_rate: { name: 'Equipment inspection rework share', question: 'What share of requests needed inspection rework?' },
  equipment_substitution_rate: { name: 'Equipment substitution share', question: 'What share of requests needed a substitute asset?' },
  equipment_unmatched_performance_count: { name: 'Equipment without a linked performance', question: 'How many equipment requests have no matching stage performance?' },
  case_throughput: { name: 'Completed cases per time bucket', question: 'How many cases reached the completion activity in each bucket?' },
  rework_case_rate: { name: 'Cases with repeated steps', question: 'What share of cases repeated a step?' },
  inter_event: { name: 'Slowest transition (time between events)', question: 'Which transition has the longest time between recorded events?' },
  matched_gap: { name: 'Slowest hand-off (matched)', question: 'Which transition has the longest gap from completion to the next start?' },
  resource_instance_count: { name: 'Busiest resource', question: 'Which resource handled the most activity instances?' },
  resource_raw_event_count: { name: 'Busiest resource', question: 'Which resource recorded the most events?' },
};

export function kpiName(id: string): string {
  return NAMES[id]?.name ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function kpiQuestion(id: string): string | undefined {
  return NAMES[id]?.question;
}
