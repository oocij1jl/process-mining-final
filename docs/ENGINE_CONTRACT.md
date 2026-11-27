# Engine contract v0.2.1 (TypeScript boundary)
Codex owns the pure engine and shared types. Claude Code imports DTOs from `src/contracts.ts` and functions from `src/engine/index.ts`. Phase 0 establishes the callable signatures. Each engine function currently throws `EngineNotImplementedError` with its `functionName`. [Shared types](../src/contracts.ts) · [Engine entry point](../src/engine/index.ts)

Engine inputs are read-only where the engine takes a collection. Durations use minutes, `GateInput.serviceSec` uses seconds, and timestamps use UTC epoch milliseconds. Unsupported metric values are `null` with coverage and a reason. Numeric outputs are finite. Arrays and evidence references have deterministic order. Case keys use JSON serialization of `[processType, caseId]`, and exact variant IDs use JSON serialization of the activity list.

### Required exported functions

| Function | Inputs | Output |
| --- | --- | --- |
| `validateAndNormalize` | `readonly RawRow[]`, `ImportOptions` | `ValidationResult` |
| `groupCases` | `readonly EventRow[]` | `Trace[]` |
| `buildDFG` | `readonly Trace[]` | `DFG` |
| `getVariants` | `readonly Trace[]` | `Variant[]` |
| `getCaseDurations` | `readonly Trace[]` | `CaseDuration[]` |
| `getPerformance` | `readonly Trace[]` | `PerformanceAnalysis` |
| `getResourceAnalysis` | `readonly Trace[]` | `ResourceAnalysis` |
| `getKPIs` | `readonly Trace[]`, `KPIContext` | `Metric[]` |
| `getFindings` | `FindingAnalysis`, `readonly Target[]` | `Finding[]` |
| `evaluateTargets` | `readonly Metric[]`, `readonly Target[]` | `TargetEvaluation[]` |
| `getGateInputs` | `readonly Trace[]`, `GateInputOptions` | `GateInputSelection` |
| `simulateGateQueue` | `readonly GateInput[]`, integer gate count | `QueueResult` |

- **Import.** The UI keeps the raw CSV preview and passes parsed strings to `validateAndNormalize`. Mapping keys are canonical schema fields and values are CSV headers. Keep unmapped attributes under their original headers and mapped extra attributes under their canonical names. Use zero-based parsed row indices for issues and `sourceOrder`, and `-1` for import-wide issues. The UI blocks analysis whenever `canAnalyze` is false, including when no usable rows remain or fatal row exclusions await consent. Missing or blank `process_type` defaults to `default` for generic imports. The multi-process Festival import sets `requireProcessType` to require a mapped, populated value.
- **Trace scope.** `groupCases` groups by process and case ID. Keep all normalized events and sort by instant then `sourceOrder`. `sequence` keeps complete and point events. `elapsedMin` uses the first and last accepted row. Keep start-only cases with an empty `sequence` so the UI can report them. The caller selects one process and filters whole cases by earliest accepted event before calling analytical functions. Discovery rejects mixed-process trace input. Cross-process links enter through the Festival KPI context.
- **Discovery and performance.** Each DFG node and edge provides unique contributing case keys. Variant shares divide by the number of nonempty discovery sequences. Keep inter-event, matched transition and service summaries separate. Inter-event gaps use consecutive discovery timestamps. Matched transition gaps use a preceding completion and the next adjacent discovery event's valid paired start. Count overlaps separately.
- **Resources.** Resource summaries expose known resource IDs, observed roles and raw-event case keys. `activityCounts` counts discovery instances per activity. Directed handoffs count adjacent discovery events with two known, distinct resources. Include isolated known resources. `activeMin` uses valid resource-owned interval unions. Utilization requires validated shifts.
- **KPIs and findings.** `KPIContext.processKey` identifies the selected process even for an empty selection. Enable Festival adapters explicitly through `festival`. Equipment readiness defaults to `required_ready_at`. Select `linked_stage_setup_start` explicitly for the linked fallback. Link stage and equipment using `festival_id` plus `performance_id` within the same dataset. Supply `throughput` with a bucket width in minutes and a UTC anchor. Return bucket boundaries and case keys in `Metric.buckets`. Findings reference the dataset/process/filter in `AnalysisScope` and carry case evidence and optional edge evidence. Mark gap findings with fewer than three observations as low support.
- **Targets.** Return evaluations in target order. `max` means measured value ≤ target and `min` means measured value ≥ target. A missing metric, unsupported value or mismatching unit produces `unknown`.
- **Gate inputs and simulation.** `getGateInputs` extracts the selected audience cases into one vector and reports excluded cases with reasons. Arrival comes from `Join Entry Queue`. The `observed` mode uses positive matched service for the named station. The `assumed` mode applies the same explicit positive seconds to every usable arrival. Rejected attempts can contribute if they meet the same evidence rules. Run `simulateGateQueue` twice with that identical vector and the two gate counts. The simulator rejects empty input, invalid times or service demand, and any gate count below 1 or outside the integers. Sort by arrival then `sourceOrder`. Allocate the earliest available gate, breaking ties by smallest gate index. Start is the later of arrival and gate availability. Wait is start minus arrival. Finish is start plus service. Use nearest-rank p95 and elapsed finish from the first arrival. Throughput is `null` if elapsed finish is zero. Calculate the staffing delta from gate counts using one qualified worker per gate.
- **Export and plans.** Application code serializes computed DTOs with the current scope and configuration. Plan creation uses the selected scenario ID and actual parameter delta. Coordinate changes to shared types and function signatures in one commit.

### Shared state integration contract
Data revision + process + filter fingerprint referenced by every finding, design, scenario and plan. `setTarget` changes monitor derived status immediately. `setScenarioParams` invalidates result. `runScenario` stores computed baseline/candidate and input revision. `applyScenario` requires current non-stale evaluated result; generates editable plan with evidence, gate/staff delta and dates/status; explicit revision on replacement. On dataset/filter change, show prior records archived/stale and never apply them to new data implicitly. No persistence of raw user data in localStorage. Use app reducer and selectors, not separate per-page sample arrays.

## Resource graph UI adapter (P0)
Render nodes from `ResourceSummary` and directed edges from `HandoffSummary`. Use the supplied `caseKeys` for node and edge drill-down. Both directions have their own count and contributing cases. The graph and table consume the same resource analysis for the current case scope.
