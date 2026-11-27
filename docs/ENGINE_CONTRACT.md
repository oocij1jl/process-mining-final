# Engine contract v0.2.1 (TypeScript boundary)
Codex owns pure engine and contracts; Claude consumes these signatures. Agree types before parallel coding. No React in engine. All durations minutes except simulator input seconds/epoch ms. Return null with coverage/reason for unsupported metric; never NaN/Infinity. Arrays sorted deterministically; IDs collision-safe. This is a proposed interface, not existing code.

```ts
export type ProcessKey = string;
export type CaseKey = string;
export type Lifecycle = 'start'|'complete'|'point';
export interface EventRow {
  eventId?: string; processType: string; caseId: string; caseKey: CaseKey;
  activity: string; timestampMs: number; rawTimestamp: string; sourceOrder: number;
  lifecycle: Lifecycle; instanceId?: string; resource: string|null;
  attrs: Record<string,string>;
}
export interface Issue { row: number; field: string; code: string; severity: 'error'|'warning'; message: string; }
export interface ImportOptions { mapping: Record<string,string>; missingResources: string[]; fixedOffset?: string; acceptExclusions: boolean; }
export interface ValidationResult { events: EventRow[]; issues: Issue[]; rawCount: number; excludedCount: number; canAnalyze: boolean; }
export interface Trace { caseKey: CaseKey; events: EventRow[]; sequence: EventRow[]; elapsedMin: number; }
export interface Metric { id: string; value: number|null; unit: string; n: number; eligible: number; definition: string; reason?: string; }
export interface Edge { from: string; to: string; count: number; caseKeys: CaseKey[]; }
export interface DFG { nodes: {activity:string;count:number}[]; edges: Edge[]; starts: Record<string,number>; ends: Record<string,number>; }
export interface Variant { id:string; activities:string[]; count:number; share:number; avgElapsedMin:number; caseKeys:CaseKey[]; }
export interface GapSummary { metricType:'inter_event'|'matched_gap'|'service'; from:string; to?:string; meanMin:number; n:number; caseKeys:CaseKey[]; }
export interface ResourceSummary { resource:string; rawEvents:number; instances:number; distinctCases:number; activityCounts:Record<string,number>; activeMin:number|null; }
export interface HandoffSummary { from:string; to:string; count:number; caseKeys:CaseKey[]; }
export interface Finding { id:string; metricId:string; value:number; unit:string; n:number; caseKeys:CaseKey[]; text:string; proposal:string; }
export interface Target { metricId:string; value:number; unit:string; direction:'max'|'min'; }
export interface GateInput { caseKey:CaseKey; arrivalMs:number; serviceSec:number; sourceOrder:number; }
export interface QueueResult { count:number; meanWaitMin:number; p95WaitMin:number; maxWaitMin:number; finishElapsedMin:number; throughputPerHour:number|null; gateCount:number; }
```

### Required exported functions
- `validateAndNormalize(rows: Record<string,string>[], options: ImportOptions): ValidationResult` — caller blocks analysis if canAnalyze=false; preserve raw preview separately.
- `groupCases(events: EventRow[]): Trace[]` — sequence contains complete/point only, sorted instant then sourceOrder; case elapsed all accepted rows; no cross-case edges. Filter one process before discovery; reject mixed-process input to discovery or isolate explicitly. Cases with empty sequence counted separately.
- `buildDFG(traces: Trace[]): DFG`, `getVariants(traces: Trace[]): Variant[]` (share fraction 0–1), `getCaseDurations(traces): {caseKey,elapsedMin}[]`, `getPerformance(traces): {gaps:GapSummary[], overlaps:number, matchedPairs:number, ambiguousPairs:number}`; no conflation of gaps and service.
- `getResourceAnalysis(traces): {resources:ResourceSummary[],handoffs:HandoffSummary[],knownRawEvents:number,totalRawEvents:number,knownInstances:number,totalInstances:number}`; handoff counts on adjacent known distinct sequence resources.
- `getKPIs(traces, context): Metric[]` generic + explicit Festival adapters, context includes metadata and linked equipment/stage traces when applicable; denominator and coverage always visible.
- `getFindings(analysis, targets): Finding[]`, `evaluateTargets(metrics:Metric[],targets:Target[]): {metricId,status:'met'|'breached'|'unknown'}[]` (max means <= target, min >= target). No fabricated root causes or improvements.
- `simulateGateQueue(inputs:GateInput[],gateCount:number):QueueResult` — nonempty, positive finite service, integer gateCount >=1; sort arrival then sourceOrder, assign earliest available gate (tie smallest gate index); start=max(arrival, gateAvailable), wait=start-arrival, finish=start+service; outputs from actual computed vector. p95 nearest rank. Reject invalid parameters. Two calls with identical vector for baseline/candidate, report delta and staffing; never modify events. Plan builder belongs to application layer, uses scenario IDs and actual parameter delta.
- `exportAnalysis` may be UI adapter serializing computed DTOs and scope/configuration. No new calculations in charts. Type changes coordinated in one commit; do not duplicate competing definitions.

### Shared state integration contract
Data revision + process + filter fingerprint referenced by every finding, design, scenario and plan. `setTarget` changes monitor derived status immediately. `setScenarioParams` invalidates result. `runScenario` stores computed baseline/candidate and input revision. `applyScenario` requires current non-stale evaluated result; generates editable plan with evidence, gate/staff delta and dates/status; explicit revision on replacement. On dataset/filter change, show prior records archived/stale and never apply them to new data implicitly. No persistence of raw user data in localStorage. Use app reducer and selectors, not separate per-page sample arrays.

## Resource graph UI adapter (P0)
Use existing ResourceSummary and HandoffSummary only. Nodes are known resources; edges use from/to/count/caseKeys. Do not recalculate handoffs in UI or create missing-resource nodes. Show both directions separately. Node/edge drill-down and table must use the same selected case scope. No API signature change required.
