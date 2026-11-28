# ProcessPilot — Event Log Data Contract (v0.2.1)
Date: 2026-11-27

## 1. Universal CSV schema
Minimal import: `case_id,activity,timestamp`. `resource` recommended, `process_type` optional for arbitrary uploads, required for the provided multi-process Festival dataset.

Preferred fields:
| field | type | meaning |
| --- | --- | --- |
| event_id | string | unique row ID (strongly recommended) |
| process_type | enum/string | `stage`, `audience`, `equipment` for Festival |
| case_id | string | unique per process; internally combine with process_type |
| activity | string | activity name, stable vocabulary |
| timestamp | ISO 8601 datetime with explicit timezone | occurrence timestamp, e.g. `2026-11-27T14:00:00+09:00` |
| lifecycle | `start` / `complete` / blank | defines activity instance state; blank for point events |
| activity_instance_id | string | match repeated starts/completes, especially with loops |
| resource | string | assigned responsible worker/team/gate |
| resource_role | string | staff role/type, allows skill compatibility analysis |
| festival_id | string | event-wide shared join key |
| performance_id | string/null | stage case ID; equipment-to-stage linkage |
| stage_id | string/null | stage grouping |
| gate_id | string/null | entrance lane grouping |
| equipment_request_id | string/null | equipment case ID |
| equipment_type | string/null | gear category |
| asset_id | string/null | individual asset identity when recorded |
| scheduled_start | ISO datetime/null | stage scheduled start, if needed for KPIs |
| ticket_type | string/null | general/VIP/re-entry category |
| issue_type | string/null | optional exception label |
| cost | number/null | valid only if estimated costing assumptions documented |

**Important:** resource availability denominator for utilization is not derivable from CSV alone; use separate `resource_shifts.csv` if actual utilization is claimed.

## 2. Festival processes and case boundaries
### Main — Stage & Technical Operations
Process `stage`, case key = `performance_id` (mirrored in `case_id`). Boundary: beginning of **this performance's** stage handover to performance end. Possible activities:
- `Stage Handover` (start/complete)
- `Stage Setup` (start/complete)
- `Line Check` (optional)
- `Technical Check` (start/complete)
- `Technical Troubleshooting` (optional)
- `Technical Recheck` (optional)
- `Stage Ready` (complete marker)
- `Performance Start` (complete marker)
- `Performance End` (complete marker)
Variant classes: standard, troubleshooting/recheck, replacement/extra setup, reduced technical prep, complex setup. **Do not assume full soundcheck occurs in each show changeover**; align optional activities with modeled festival practice.

KPI: handover-to-ready preparation time, technical recheck frequency, stage-ready-before-scheduled-start ratio, total case elapsed time, actor workload. Never equate full performance duration with prep cycle time.

### Sub 1 — Audience Entry & Crowd Management
Process `audience`, case key = unique `entry_id` per attempt. Boundary: join entrance queue to entry or rejection; optionally record a new `entry_id` on re-entry. Activities:
- `Join Entry Queue` (point event)
- `Ticket Verification` (start/complete)
- `Manual Ticket Check` (optional start/complete)
- `Security Check` (start/complete)
- `Additional Screening` (optional)
- `Wristband Check` (optional)
- `Entry Complete` / `Entry Rejected` (point event)
Variant classes: standard, VIP dedicated lane, scan failure/manual check, additional screening, rejection. Avoid modeling whole post-entry crowd movement as if each visitor's movements were measured; possible aggregate crowd density is a **separate dataset**, not an inferred visitor trace.

KPI: queue wait `Ticket Verification:start - Join Entry Queue`; total entry elapsed to `Entry Complete`; gate throughput per time interval, manual verification %, rejection %, gate assignment workload. Gate-processing service interval must be explicitly defined if used for queue simulation.

### Sub 2 — Equipment & Technical Readiness
Process `equipment`, case key = `equipment_request_id` (mirrored in `case_id`). Boundary: equipment request to stage delivery/ready for assigned performance. Activities:
- `Equipment Requested`
- `Availability Check`
- `Equipment Allocation`
- `Substitute Search` (optional)
- `Equipment Transport`
- `Pre-use Inspection`
- `Inspection Rework` (optional)
- `Equipment Ready`
Variant classes: normal, substitution, resource sharing/reallocation, failed inspection/rework.
KPI: lead time request-to-ready, substitution rate, failed inspection/recheck rate, ready-before-stage-setup target, workload of equipment crew. Asset utilization requires `asset_id` and occupied time plus availability denominator.

### Cross-process relationships
- `festival_id`: all three process datasets.
- `performance_id`: equipment request belongs to a stage performance.
- `stage_id`, time bucket: compare workload periods.
- `audience` links to stages only via explicitly observed/aggregated venue/time signals, NOT by pretending each spectator is a stage-performance case.
- Each process retains its own DFG and variant analysis; aggregated dashboard compares measures side by side.

## 3. Data generation approach
Generate synthetic logs **using script with a fixed random seed** from a documented process model, realistic activity ordering and modeled resource availability.
Suggested demo size, not professor requirement: 100 stage cases across hypothetical multiple festival days/events; 600 sampled entry cases; 150 equipment-request cases, with many-to-one equipment→performance links. Dataset name should be fictional (e.g. `Demo Festival Operations 2026`), not named 2026 Pentaport/Busan/Fuji Rock operational data.

Provenance:
- Confirmed published festival practices (festival zones, gates, stage setup, crew categories) documented with public source links in BUSINESS_PROCESS.md.
- Simulated implementation details (step ordering, probabilities, timing distributions, queueing assumptions, issue frequencies) labeled **modeling assumptions**.
- No claim that synthetic bottlenecks describe actual performance of the named festivals.

## 4. Calculations and data quality
- Group by `process_type || 'default'` + `case_id`.
- Sort by `timestamp`, tie-break by original stable source row index (never lexicographic event_id).
- DFG/variant sequence is based on **activity instances**, not two lifecycle rows per task. Use only complete and blank/point rows for sequence discovery; order by occurrence/completion time then original source row index; starts are retained for duration analysis only. parallel operations are represented approximately and must be explicitly labeled.
- Case elapsed time = latest case event − earliest case event (not necessarily working time).
- Activity service time = matched `complete - start` for same `activity_instance_id`, only if both exist and valid.
- Maintain separate metric families: inter-event gap = difference between consecutive discovered event timestamps; matched transition gap = next valid paired start minus previous completion, with overlap tracked separately and excluded from nonnegative idle-gap summaries. Never mix these two families in a single average. A matched gap is not necessarily queue waiting unless the business semantics establish it.
- Raw event count and distinct case count are valid workload measures; completed-instance counts are separately labeled (do not count start+complete as two tasks); work minutes require matched lifecycle intervals; % utilization requires valid shift/availability time.
- Flag invalid date, missing process/case/activity, missing lifecycle partner, negative durations, duplicate `event_id`, impossible `Entry Complete` before scan. Missing optional fields should degrade gracefully.
- Store UTC internally; display user timezone consistently; avoid locale-ambiguous timestamps.

## 5. Tiny example dataset (illustrative only)
```csv
event_id,process_type,case_id,activity,timestamp,lifecycle,activity_instance_id,resource,festival_id,performance_id,stage_id
S1,stage,PERF001,Stage Handover,2026-11-27T15:00:00+09:00,start,H1,StageCrew1,DEMOFEST,PERF001,Main
S2,stage,PERF001,Stage Handover,2026-11-27T15:02:00+09:00,complete,H1,StageCrew1,DEMOFEST,PERF001,Main
S3,stage,PERF001,Stage Setup,2026-11-27T15:02:00+09:00,start,U1,StageCrew1,DEMOFEST,PERF001,Main
S4,stage,PERF001,Stage Setup,2026-11-27T15:12:00+09:00,complete,U1,StageCrew1,DEMOFEST,PERF001,Main
S5,stage,PERF001,Technical Check,2026-11-27T15:12:00+09:00,start,T1,AudioCrew1,DEMOFEST,PERF001,Main
S6,stage,PERF001,Technical Check,2026-11-27T15:16:00+09:00,complete,T1,AudioCrew1,DEMOFEST,PERF001,Main
S7,stage,PERF001,Stage Ready,2026-11-27T15:16:00+09:00,complete,R1,StageManager1,DEMOFEST,PERF001,Main
S8,stage,PERF001,Performance Start,2026-11-27T15:20:00+09:00,complete,P1,StageManager1,DEMOFEST,PERF001,Main
S9,stage,PERF001,Performance End,2026-11-27T16:00:00+09:00,complete,P2,StageManager1,DEMOFEST,PERF001,Main
```

For `Stage Ready` and other point events, a single `complete` row is valid as an instantaneous marker. The universal parser must support mixed activity durations and point events.

## 6. Canonical v0.2.1 ingestion and lifecycle rules (override earlier informal wording)
- Preserve raw input and row order; case_id/activity are strings, trim outer whitespace with disclosure, preserve leading zeros and case. No numeric ID coercion. `source_order` is the import row index; namespace source logs if explicitly combining them. Single active imported dataset for MVP. Internal case key is collision-safe serialization of [process_type or default, case_id].
- Explicit ISO offset/Z required; optionally support timezone-less ISO input only when user explicitly selects a fixed offset and sees conversion policy. Reject invalid calendar dates and ambiguous locale dates, not just Date.parse success. Normalize UTC epoch milliseconds and retain original timestamp. Display timezone consistently. Tied timestamps retain source row order and are reported.
- Missing required value, invalid timestamp, invalid supplied lifecycle value, duplicate event_id within the dataset: row issue. Exact duplicate rows without ID are warned, not silently deleted (may be real repeated activity). Show raw rows and excluded row counts; require explicit confirmation before analyzing a valid subset; default block on fatal row issues. Unpaired lifecycle rows: warning, still retain complete events for discovery; starts without completion excluded from trace discovery, not fabricated; empty discovered cases reported separately. No implicit start→complete synthetic event.
- Explicit `activity_instance_id`: pair within same case and activity, exactly one start + one complete, valid time order. Without ID, pair only when one start and one complete for same case/activity and chronological order makes pairing unambiguous. Single `complete` may be an intentional point event (Stage Ready etc.); point markers never given fabricated durations. Repeated unmatched starts/completes are ambiguous; report coverage and skip duration. For resource active minutes assign interval only if matching start/complete resource agrees or an explicit ownership rule exists; otherwise N/A for that interval. Overlapping intervals for same resource unioned for busy time; shifts unioned, clip busy intervals to available time; show out-of-shift conflicts; no utilization without validated shift records.
- Resource placeholder defaults: blank, NONE, NULL, 0;n/a as missing, with visible editable mapping; never treat literal name as missing silently. Raw event resource count and discovery instance count are separate; handoffs use adjacent discovery events, known distinct resource IDs only; no jumping across unknown endpoint. Within one case only. Group by explicit stable ID/role if available, no merging same names across festivals unless intentional.
- XES import (v0.3 P0) maps `.xes` and XES-structured `.xml` to the same EventRow schema and normalizer as CSV. The v0.3 contract defines lifecycle and extension mapping, original document order, validation, exclusion consent and browser limits. Use a documented subset for files above those limits. [XES import contract](V03_CONTRACT.md#3a-csv-and-xes-import-p0)

## 7. Dataset metadata and scenario inputs
`dataset_manifest.json`: dataset_id/name, source_type synthetic/user upload, process descriptions, generator version/seed, source references, assumptions, timezone, units, resource placeholder policy, baseline gate count, simulation service-station definition, sample scope, excluded rows/conversion notes. Festival assumptions are configurable and must be labeled; arbitrary imports have no inferred metadata.
Audience simulation: one pooled FCFS service station with identical staffed gates (not all admission steps unless explicitly modeled as one pooled service station). Arrival = Join Entry Queue timestamp, service demand = matching Ticket Verification service duration when present, or explicit assumed positive seconds per entrant. Use same arrival/demand vector for baseline/candidate. Exclude cases missing arrival or required service under observed-duration mode, show n/exclusions; alternatively use explicit assumed duration for all selected valid arrivals. Include rejected attempts if they enter modeled station and have service evidence; do not select only successful outcomes silently. Baseline gate count from manifest or user input, never infer count from distinct gate IDs across time. Gate staffing = one qualified worker/gate assumption, baseline and candidate counts; no measured cost/utilization without data. Report mean, nearest-rank p95, max wait, elapsed finish from first arrival, throughput if elapsed>0, staffing delta; observed queue wait separate. No synthetic to-be event log unless separately generated and labeled. Compare modeled baseline vs modeled candidate; no claim of field performance.

## 8. KPI definitions (Festival adapters, null if unsupported)
Stage preparation minutes: first Stage Handover start (or declared point fallback) to Stage Ready, only valid pairs. Ready-on-time: Stage Ready <= scheduled_start, denominator cases with both timestamps. Technical recheck case rate: cases containing Technical Recheck or configured repeated Technical Check / selected stage cases with trace. Full case elapsed separately.
Audience: queue wait = first Ticket Verification start minus Join Entry Queue; entry elapsed = Join Entry Queue to Entry Complete (successful cases only); rejected counts separately; entry completion/rejection rates over cases with known outcome, coverage shown; throughput = Entry Complete per stated time bucket; do not call total entry elapsed service time.
Equipment: request→Equipment Ready lead time; substitute rate = cases with Substitute Search / selected equipment traces; inspection rework rate analogously; ready-on-time = Equipment Ready <= explicit required_ready_at, or linked Stage Setup start if chosen and disclosed; denominator linked/valid cases. `required_ready_at` optional ISO timestamp. Show unmatched performance linkage. `entry_id`, `equipment_request_id` can be mirrored in case_id. `asset_id` and shifts optional. Cost requires stated unit/currency; omit if unknown.
