/**
 * BPMN XML → neutral reference graph for getBpmnComparison (V03_CONTRACT §8:
 * the UI owns parsing/import). Local DOMParser only: no external resolution,
 * no execution. Pools/lanes are presentation and are not part of the graph.
 */
import type { BpmnReference } from '../v03-contracts';

export const BPMN_ROOT = /<([\w-]+:)?definitions[\s>]/;

const TASKS = new Set(['task', 'userTask', 'serviceTask', 'manualTask', 'scriptTask', 'businessRuleTask', 'sendTask', 'receiveTask']);
const FLOW_NODES = new Set([
  ...TASKS,
  'startEvent', 'endEvent', 'intermediateThrowEvent', 'intermediateCatchEvent', 'boundaryEvent',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway',
  'subProcess', 'adHocSubProcess', 'transaction', 'callActivity',
]);

export interface ParsedBpmnProcess {
  id: string;
  name: string;
  reference: BpmnReference;
  /** Flow nodes ProcessPilot cannot check for adjacency (still shown and mappable). */
  unsupported: { id: string; type: string; name: string }[];
  laneCount: number;
}

export interface ParsedBpmn {
  processes: ParsedBpmnProcess[];
  participants: number;
  error: string | null;
}

const hasEventDefinition = (el: Element) => Array.from(el.children).some((c) => c.localName.endsWith('EventDefinition'));

export function parseBpmn(xml: string): ParsedBpmn {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (e) {
    return { processes: [], participants: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (doc.getElementsByTagName('parsererror').length) return { processes: [], participants: 0, error: 'The file is not well-formed XML.' };
  const root = doc.documentElement;
  if (root.localName !== 'definitions') return { processes: [], participants: 0, error: 'The file is not BPMN 2.0 (no <definitions> root).' };
  const all = Array.from(root.getElementsByTagName('*'));
  const participants = all.filter((e) => e.localName === 'participant').length;
  const processes: ParsedBpmnProcess[] = all
    .filter((e) => e.localName === 'process')
    .map((p) => {
      const nodes: BpmnReference['nodes'][number][] = [];
      const unsupported: ParsedBpmnProcess['unsupported'] = [];
      const flows: { fromId: string; toId: string }[] = [];
      for (const el of Array.from(p.children)) {
        const type = el.localName;
        const id = el.getAttribute('id') ?? '';
        const name = (el.getAttribute('name') ?? '').trim();
        if (type === 'sequenceFlow') {
          flows.push({ fromId: el.getAttribute('sourceRef') ?? '', toId: el.getAttribute('targetRef') ?? '' });
          continue;
        }
        if (!FLOW_NODES.has(type)) continue;
        let kind: BpmnReference['nodes'][number]['kind'] = 'unsupported';
        if (TASKS.has(type)) kind = 'task';
        else if (type === 'startEvent' && !hasEventDefinition(el)) kind = 'start';
        else if (type === 'endEvent' && !hasEventDefinition(el)) kind = 'end';
        else if (type === 'exclusiveGateway') kind = 'xor';
        if (kind === 'unsupported') unsupported.push({ id, type, name });
        nodes.push({ id, name, kind });
      }
      const laneCount = Array.from(p.getElementsByTagName('*')).filter((e) => e.localName === 'lane').length;
      return { id: p.getAttribute('id') ?? '', name: p.getAttribute('name') ?? p.getAttribute('id') ?? 'Process', reference: { nodes, flows }, unsupported, laneCount };
    })
    .filter((p) => p.reference.nodes.length > 0);
  return { processes, participants, error: processes.length ? null : 'No process with flow elements was found.' };
}

/** Minimal valid To-be skeleton with diagram interchange (start → task → end). */
export const BLANK_TO_BE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_ToBe" targetNamespace="http://processpilot.local/bpmn">
  <bpmn:process id="Process_ToBe" name="To-be process" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Start"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="New task"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1" name="End"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_ToBe">
    <bpmndi:BPMNPlane id="Plane_ToBe" bpmnElement="Process_ToBe">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><dc:Bounds x="152" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="240" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1"><dc:Bounds x="392" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="188" y="120" /><di:waypoint x="240" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="340" y="120" /><di:waypoint x="392" y="120" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** True when every flow node of the document has a diagram shape (DI present). */
export function diCoverage(xml: string): { nodes: number; shapes: number } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const all = Array.from(doc.getElementsByTagName('*'));
  const ids = new Set(all.filter((e) => FLOW_NODES.has(e.localName)).map((e) => e.getAttribute('id')));
  const shapes = all.filter((e) => e.localName === 'BPMNShape' && ids.has(e.getAttribute('bpmnElement'))).length;
  return { nodes: ids.size, shapes };
}
