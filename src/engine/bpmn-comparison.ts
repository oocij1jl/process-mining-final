import type { BpmnComparison, BpmnMappingOverride, BpmnReference } from '../v03-contracts';
import type { Edge, Trace } from '../contracts';
import { buildDFG } from './discovery';

type NodeKind = BpmnReference['nodes'][number]['kind'];

interface ReferenceNode {
  kind: NodeKind;
  outgoing: string[];
  incoming: string[];
}

function referenceGraph(reference: BpmnReference) {
  const nodes = new Map<string, ReferenceNode>();
  const tasksByName = new Map<string, string[]>();
  for (const { id, name, kind } of reference.nodes) {
    if (!id.trim() || nodes.has(id)) throw new RangeError('BPMN node IDs must be nonblank and unique.');
    nodes.set(id, { kind, outgoing: [], incoming: [] });
    if (kind !== 'task') continue;
    const label = name.trim();
    const candidates = tasksByName.get(label) ?? [];
    candidates.push(id);
    tasksByName.set(label, candidates);
  }
  for (const { fromId, toId } of reference.flows) {
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) throw new RangeError('BPMN sequence flows must reference known nodes.');
    from.outgoing.push(toId);
    to.incoming.push(fromId);
  }
  return { nodes, tasksByName };
}

function walk(graph: ReadonlyMap<string, ReferenceNode>, roots: string[], direction: 'outgoing' | 'incoming',
  stopAtTask = false): Set<string> {
  const pending = [...roots];
  const visited = new Set<string>();
  const tasks = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph.get(id)!;
    if (stopAtTask && node.kind === 'task') tasks.add(id);
    else for (const next of node[direction]) pending.push(next);
  }
  return stopAtTask ? tasks : visited;
}

function validDegree(node: ReferenceNode): boolean {
  const before = node.incoming.length;
  const after = node.outgoing.length;
  switch (node.kind) {
    case 'task': return before <= 1 && after <= 1;
    case 'start': return before === 0 && after === 1;
    case 'end': return before === 1 && after === 0;
    case 'xor': return before > 0 && after > 0 && (before === 1 || after === 1);
    default: return false;
  }
}

function compareAdjacency(
  graph: ReadonlyMap<string, ReferenceNode>, edges: readonly Edge[], mapped: ReadonlyMap<string, string>,
): BpmnComparison['adjacency'] {
  const unsupported = (reason: NonNullable<BpmnComparison['adjacency']['reason']>): BpmnComparison['adjacency'] => ({
    status: 'unsupported', reason, checkedTransitionCount: null, skippedTransitionCount: null, deviations: [],
  });
  const starts: string[] = [];
  const ends: string[] = [];
  let degreesSupported = true;
  for (const [id, node] of graph) {
    if (node.kind === 'unsupported') return unsupported('unsupported_elements');
    if (node.kind === 'start') starts.push(id);
    if (node.kind === 'end') ends.push(id);
    degreesSupported &&= validDegree(node);
  }
  if (!degreesSupported || starts.length !== 1 || !ends.length || walk(graph, starts, 'outgoing').size !== graph.size ||
    walk(graph, ends, 'incoming').size !== graph.size) return unsupported('unsupported_structure');

  const allowed = new Map<string, Set<string>>();
  const deviations: Edge[] = [];
  let checkedTransitionCount = 0;
  let skippedTransitionCount = 0;
  for (const edge of edges) {
    const from = mapped.get(edge.from);
    const to = mapped.get(edge.to);
    if (from === undefined || to === undefined) {
      skippedTransitionCount += edge.count;
      continue;
    }
    checkedTransitionCount += edge.count;
    let successors = allowed.get(from);
    if (!successors) {
      successors = walk(graph, graph.get(from)!.outgoing, 'outgoing', true);
      allowed.set(from, successors);
    }
    if (!successors.has(to)) deviations.push(edge);
  }
  return { status: 'supported', reason: null, checkedTransitionCount, skippedTransitionCount, deviations };
}

export function getBpmnComparison(
  traces: readonly Trace[], reference: BpmnReference, overrides: readonly BpmnMappingOverride[],
): BpmnComparison {
  const dfg = buildDFG(traces);
  const { nodes, tasksByName } = referenceGraph(reference);
  const activities = new Set(dfg.nodes.map(node => node.activity));
  const explicit = new Map<string, string | null>();
  for (const { activity, taskId } of overrides) {
    if (explicit.has(activity) || !activities.has(activity) || (taskId !== null && nodes.get(taskId)?.kind !== 'task')) {
      throw new RangeError('Each BPMN mapping override needs a unique discovered activity and a valid task or exclusion.');
    }
    explicit.set(activity, taskId);
  }

  const mapped = new Map<string, string>();
  let mappedOccurrenceCount = 0;
  let discoveredOccurrenceCount = 0;
  const mapping = dfg.nodes.map(({ activity, caseKeys, count }): BpmnComparison['mapping'][number] => {
    const exactTaskIds = tasksByName.get(activity) ?? [];
    const override = explicit.get(activity);
    const taskId = override === undefined ? (exactTaskIds.length === 1 ? exactTaskIds[0] : null) : override;
    const status = override !== undefined ? (override === null ? 'excluded_by_user' : 'mapped_by_user')
      : exactTaskIds.length === 1 ? 'exact' : exactTaskIds.length > 1 ? 'ambiguous' : 'unmapped';
    discoveredOccurrenceCount += count;
    if (taskId !== null) {
      mapped.set(activity, taskId);
      mappedOccurrenceCount += count;
    }
    return { activity, taskId, exactTaskIds: [...exactTaskIds], status, occurrenceCount: count, caseKeys };
  });
  const mappedTaskIds = new Set(mapped.values());
  return {
    mapping, mappedOccurrenceCount, discoveredOccurrenceCount,
    mappedActivityCount: mapped.size, discoveredActivityCount: activities.size,
    referenceOnlyTaskIds: reference.nodes.filter(node => node.kind === 'task' && !mappedTaskIds.has(node.id)).map(node => node.id),
    adjacency: compareAdjacency(nodes, dfg.edges, mapped),
  };
}
