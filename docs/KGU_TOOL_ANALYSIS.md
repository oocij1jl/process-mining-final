> Public-safe path-redacted copy of the Codex review; local absolute paths replaced. Original review retained separately.

The available KGU tool is a compiled Java distribution, with no application source found. Its exact discovery algorithms cannot be established from the supplied materials.

The likely new-project folder, [local project folder], is empty and outside this session’s writable roots. The review is therefore provided below for copying into docs/KGU_TOOL_ANALYSIS.md. No KGU files were changed; no application binaries were executed, decompiled, or copied into another application.

## A. Inventory and evidence

Paths below are relative to [local downloads]/ProcessMiningTool unless otherwise stated.

| Material inspected | Verified finding |
|---|---|
| ProcessMining/ProcessminingTool.jar | Java archive containing 177 .class files and no .java, .kt, or .scala entries. Only archive metadata and entry inventory were inspected. Manifest entry point: MainProgram.StartForm; created with Java 1.8.0_221, Ant 1.9.4. |
| ProcessMining/lib/ | 20 dependency JARs, listed below. Presence does not prove a feature uses them. |
| readme.md | Documents Java JDK 8, Windows/Mac setup, launch scripts, two external datasets, and run/export videos. |
| Instructions.docx | Text and all four embedded images inspected. Documents setup and java -jar ProcessminingTool.jar. Images show Java installation/version checks and command-line launch, not the application UI. |
| Instructions.pdf | Inventoried as a three-page PDF; contents were not extracted or rendered because suitable PDF tools were unavailable. No claims rely on its contents. |
| Both runtool scripts | Line 1 targets TWTDiscovery_Version4Student.jar, which is absent. This conflicts with the present JAR and DOCX launch instruction. |
| ini/setting.xml | Graph appearance settings for normal nodes, AND/OR/loop gates and clusters. |
| ini/settingXPDL.xml | XPDL-named layout settings. |
| ini/view-trace-process.txt | Saved trace-like serialization containing activities, timestamps, NULL, NONE, and synthetic START/END markers. |
| ini/nodeid.txt, both recent-path INI files | Saved state/path strings; not event-log specifications. |
| tmp/graph_*.png | Five files, all zero bytes; no usable graph or UI evidence. |
| LICENSE | MIT notice, copyright 2020 DinhLamPham. |
| Working-tree inventory | No application source, build project, tests, bundled event logs, or lecture slides found. .git exists; history was not investigated. |

Dependencies, identified by filenames and application manifest:

commons-collections4-4.1, dom4j-1.6.1, guava-19.0, Jama-1.0.3, jgraphx, jxl, opencsv-4.1, org.apache.commons.io, POI 3.17 (poi, poi-excelant, poi-ooxml, poi-ooxml-schemas, poi-scratchpad), stax-api-1.0.1, xmlbeans-2.3.0, xstream-1.4.10, GraphStream 1.2 (gs-core, gs-algo, gs-ui), and jcalendar-1.4.

Additional accessible sample material inspected outside the distribution:

- [local downloads]/practice data/large bank transactions.xes
- [local downloads]/practice data/review_example_large.xes
- [local downloads]/document_logs/: Control summary.xes, Department control parcels.xes, Entitlement application.xes, Geo parcel document.xes, Inspection.xes, Parcel document.xes, Payment application.xes, Reference alignment.xes.

The first trace of every sample was inspected. Complete structural scans also finished for the two practice logs and the first three document logs listed above; a broader scan was stopped to limit effort.

The DOCX evidence comes from ProcessMining/Instructions.docx.

## B. Input / output schema

Verified sample schema is not a verified KGU import contract. No imports were attempted.

| Meaning | Observed XES representation | Compatibility implication |
|---|---|---|
| Case ID | Trace-level string concept:name | Preserve as a string, including negative-looking identifiers. |
| Activity | Event-level string concept:name | Keep distinct from trace-level concept:name. |
| Timestamp | Event-level date time:timestamp | Observed YYYY-MM-DDTHH:mm:ss.SSS±HH:mm, including +01:00 and +02:00. |
| Resource | Event-level string org:resource | Actual names/identifiers and placeholders such as NONE and 0;n/a occur. |
| Lifecycle | Event-level string lifecycle:transition | Review sample includes start and complete; other inspected first traces are completion-only. |
| Other attributes | Review: optional result; document logs: activity, subprocess, doctype, IDs, success, and business attributes | Preserve separately; do not automatically substitute them for case or activity. |

Concrete evidence: bank sample, lines 27–39 contains trace ID trace_0, resource NONE, lifecycle complete, and timestamp 2013-11-30T14:46:17.906+01:00.

The complete practice-log scans found:

| Log | Cases | Events |
|---|---:|---:|
| Large bank transactions | 10,000 | 678,864 |
| Review example large | 10,000 | 236,360 |

Import formats: XES use is inferred from the README’s dataset references and nearby samples. Actual support for .xes, .xes.gz, CSV, XLS/XLSX, encodings, delimiters, or column mapping is unverified. OpenCSV and spreadsheet libraries alone do not establish supported imports.

Outputs: README lines 35–37 advertises a discovered-model export video. settingXPDL.xml suggests XPDL-related output, but export formats, validity, and interoperability remain unverified.

Workflow: Setup → launch is documented. Import → discover/view → export is a plausible intended workflow, with low confidence about exact controls and order. No live UI, lecture slides, or usable application screenshots were available; linked videos were not viewed.

## C. Functional & algorithmic analysis

No algorithm function bodies or source line numbers are available. MainProgram.StartForm is an entry-point name from the manifest, not evidence of discovery logic.

| Feature | Evidence and status | Input / calculation / output / assumptions |
|---|---|---|
| ICN | Inferred, low confidence: graph settings name AND and OR gates. These names do not establish ICN discovery. | Input, gateway inference, concurrency rules, output semantics, and assumptions not verifiable. |
| WTN | Not verifiable. Script target contains TWTDiscovery, but a filename cannot establish an algorithm or even expand its abbreviation reliably. | Input, weighting formula, normalization, output and assumptions unknown. |
| Direct-follow relationships | Not verifiable as implemented. Saved trace state shows an activity sequence, not its aggregation method. | Case boundaries, ordering, edge counts, lifecycle treatment and resulting graph unknown. |
| Self-loops | Verified configuration; inferred feature intent: lines 21–25 define a Loop-Gate. | Whether this represents adjacent repeats, longer cycles, or another construct is unknown. No loop calculation verified. |
| Deliberate noise filtering | Not verifiable. No inspected documentation specifies thresholds or filtering controls. | Frequency denominator, threshold comparison, affected data and graph effects unknown. Absence of evidence does not establish absence of the feature. |
| Resource handoffs | Verified resource data; unverified feature. Sample logs contain resources. | No verified resource-pair counting, same-resource policy, missing-resource treatment, timing calculation or handoff output. |

Additional observations:

- view-trace-process.txt, line 6 contains !@# / !! separators and timestamped activity-like records. This appears to be internal saved state, not a documented import format.
- settingXPDL.xml, lines 2–12 configures layout dimensions. It establishes neither an XPDL exporter’s correctness nor BPMN compatibility.
- Variants, bottleneck calculations, resource statistics, improvement recommendations and performance were not observable.

## D. P0 / P1 / P2 recommendations for ProcessPilot

These are independent design recommendations, not claims about KGU behavior.

| Priority | Recommendation |
|---|---|
| P0 | Real CSV import with preview, explicit column mapping, row-level validation, timestamp/timezone handling and deterministic ordering. |
| P0 | DFG with activity frequencies, adjacent-transition counts, start/end counts and visible self-loops. Never connect separate cases. |
| P0 | Exact activity-sequence variants: case count, percentage, duration comparison and case drill-down. |
| P0 | Case elapsed time and transition elapsed-time summaries. With point timestamps, label gaps as elapsed time rather than proven waiting or service time. |
| P0 | Resource event counts, distinct cases, activity mix and cross-resource handoff counts; report missing-resource coverage. |
| P0 | Evidence-linked improvement proposals: for example, investigate a slow stage changeover transition or repeated technical-check activity. State expected benefit as a hypothesis. |
| P0 | Hand-verifiable correctness tests, reproducible dataset/configuration references and exportable findings. |
| P1 | Explicit minimum-edge-count display filter, resource handoff visualization, reliable start/complete pairing, and additional distribution statistics. |
| P1 | XES conversion/import when needed for reference samples; avoid making it a dependency of the required festival CSV workflow. |
| P2 | Advanced ICN/WTN replication, automatic gateway/concurrency inference, XPDL compatibility, replay and complex resource optimization. |

Use Stage & Technical Operations as the main analysis. Keep Audience Entry and Equipment & Technical Readiness as separate processes unless explicit correlation IDs justify linking them.

Proposed sample-log compatibility strategy

1. Map XES trace concept:name → case_id; event concept:name → activity; time:timestamp → timestamp; retain optional resource and lifecycle.
2. Add source_log and source_order; namespace cases when combining files.
3. Normalize timestamps to instants while preserving original values. Sort within each case by timestamp, then source order; expose ties.
4. Offer explicit placeholder-to-missing mappings. Do not count NONE as a worker by default without showing that decision.
5. For mixed lifecycle logs, use completion events for activity-sequence discovery and retain starts separately. Pair durations only when matching is unambiguous.
6. Convert large reference logs outside the browser or use clearly identified subsets. Observed samples range from approximately 66–793 MiB.
7. Preserve original data; show exclusions and conversion settings.

## E. Validation tests

These are proposed ProcessPilot acceptance tests, not tests executed against KGU. Times below are UTC minutes on the same day.

| Test | Input | Hand-verifiable expected output |
|---|---|---|
| 1. DFG, variants, duration | C1: A@00, B@10, C@30; C2: A@00, C@20 | Edges A→B=1, B→C=1, A→C=1. Start A=2; end C=2. Variants ABC and AC each 50%. Case durations 30 and 20 min; mean 25 min. |
| 2. Repetition and filtering | C1: A,A,B; C2: A,B; all complete | A frequency=3, B=2; A→A=1, A→B=2. Display threshold “count ≥2” hides only A→A. Underlying counts and two variants remain unchanged. |
| 3. Resources and missing values | One case: A/R1, B/R2, C/R2, D/missing | Event counts R1=1, R2=2, missing=1. Distinct cases per known resource=1. Cross-resource handoff R1→R2=1; same-resource and missing endpoints excluded. |
| 4. Lifecycle | One case: A/start@00, A/complete@05, B/start@08, B/complete@12 | Completion-based variant AB; A→B=1, no A→A or B→B. Matched service times A=5, B=4 min. A-complete→B-start gap=3 min. Case first-to-last elapsed=12 min. |
| 5. Parsing and ordering | C1 listed B then A at the same instant, expressed as 10:00+09:00 and 01:00Z; C2 has one C; another row has invalid timestamp; CSV activity "Sound, check" is quoted | Tie retains source order B→A=1 with gap 0. No cross-case edge. Invalid row reported and excluded under the explicit exclusion policy. Quoted comma stays inside one activity field. |

## F. Specific unknowns and limits

- Source unavailable: no reliable algorithm comparison, function-level citations, defect review or numerical parity claim is possible.
- Launch inconsistency: both scripts reference an absent JAR. They were read, not repaired or run.
- Import contract unknown: required attributes, accepted dates, missing-value behavior, lifecycle pairing, duplicate handling and sorting are unverified.
- UI and outputs unknown: no runtime observation, valid graph images, inspected lecture slides or viewed demonstration videos.
- No performance evidence: dependency names and large nearby datasets do not prove the tool handles those datasets successfully.
- Licensing: a local MIT notice exists and requires retention of the notice for copies/substantial portions. Third-party dependency terms, dataset redistribution rights and rights to professor/course material were not audited. The MIT notice does not establish those separate permissions.
- Reference samples are not festival evidence: they can validate import behavior, but cannot support festival-specific findings or improvement claims.
- Review boundary: metadata, documentation, configuration and data inspection only. No implementation, installation, deployment, publishing or reverse engineering was performed.