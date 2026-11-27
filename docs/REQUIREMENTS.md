# ProcessPilot — Requirements v0.2.1
Date: 2026-11-27. Supersedes v0.1. Proposed implementation baseline, not completed software.

## Course requirements (not optional)
- Week 10, p.42: unique real-world business process; description and BPMN; generated event log with generation explanation; AI-developed tool with process discovery; apply tool, analyze discovered process and propose improvements; 15–20-page PDF including AI use, dataset link and 2–3-minute YouTube demo link. Final report Week 15.
- Week 11, pp.2,14: same project goal; GUI supporting as many of the six BPM lifecycle phases as possible. Examples on pp.17–21 are suggestions, not mandatory individual features.
- Latest LMS announcement as quoted by student: AI-developed tool published to Internet; submit public URL by 2026-11-29 23:00 KST. Verify LMS if changed.
- No requirement for LLM at runtime, full ICN/WTN replication, live monitoring or automated BPMN generation.

## Project boundary
Music Festival Operations & Resource Optimization. Main `stage` (Stage & Technical Operations); sub `audience` (Audience Entry & Crowd Management; MVP entry only), `equipment` (Equipment & Technical Readiness). Cross-process Resource Optimization is a linked dashboard, not a fourth trace. Generic CSV engine plus Festival-specific adapters. Reference Pentaport, Busan Rock and Fuji Rock; synthetic logs explicitly distinguished from observed festival data. Exact source/operational assumptions still need verification in BUSINESS_PROCESS.md.

## P0 — Sunday release gate
- F01 Data: sample/load CSV, mapping, preview, validation, explicit exclusion consent, deterministic timestamp order, missing resource coverage, process selector, trace view.
- F02 Analysis: real DFG (activity/transition/start/end counts and self-loops), exact variants, case duration, inter-event gap, valid lifecycle service/gap measurements, resource workload and cross-resource handoff count table and interactive directed resource handoff graph (WTN-inspired, no KGU parity); evidence-linked findings and proposal candidates.
- F03 Design: show modeled As-is BPMN for Festival; import/view valid BPMN XML for generic data, choose an improvement proposal and linked To-be model or editable change specification. No fake auto-BPMN or conformance claims. Save design record and link to Model and Refine. One fully modeled audience To-be for simulation; other processes may have proposed change notes only, explicitly marked.
- F04 Model: editable KPI targets (units/direction), simulation parameters; validate and persist per dataset/process; feed Monitor and Refine.
- F05 Implementation: create editable action plan from selected evaluated scenario, or clearly marked proposal-only plan; owner, task, proposed staffing, due date, status, evidence, scenario references; no real-world deployment claims. Save and export.
- F06 Monitor: calculated KPIs vs targets, change on target edit or log/filter change; threshold alerts, historical throughput and case drill-down. No live-monitoring claim.
- F07 Refine: evidence-linked recommendations and one computed scenario (audience gate queue); observed/synthetic-log metrics separate from modeled baseline and scenario. Compare equal arrivals/service assumptions; choose scenario, generate/update plan in Implementation. Stage and Equipment evidence-based proposals without fake quantified effects.
- F08 Evidence: export current analysis/metric definitions, selected filters, dataset provenance, scenario/config and plan (CSV/JSON minimum), sample CSV download, BPMN assets link or download; no hard-coded results. Synthetic generator + seed documented before final report. Public HTTPS incognito smoke test, build/tests pass.

## P1 — only after P0 passes
- Minimum edge count display filter (no mutation of log); SVG/PNG graph export; outlier mean+2SD (explicit population/sample definition), optional XES subset converter, extra distribution statistics, stage-specific simulation or To-be BPMN diagrams for additional processes.

## P2 — defer
Full ICN/ρ algorithm, exact KGU parity, automatic gateway/concurrency discovery, XPDL, replay-based conformance, model editor, optimization solver, ML prediction, live API/backend/login. No large full XES imports guaranteed. No redistribution of course datasets without rights.

## Evidence and report mapping
Collect from first commit: business sources and assumptions, BPMN files, reproducible generator & dataset, screenshots, analysis CSV/JSON, scenario and plan export, test outputs, AI prompt/output/review/fix, deployment URL. Demo: sample→DFG/variant→finding→target edit reflected in Monitor→gate simulation→apply scenario to plan→changed CSV recomputes. Final report may demonstrate all processes but one quantified simulation suffices for MVP; improvement proposals are required, not a proven field optimization.

## Release decision
If schedule slips: cut P1/P2 first; retain P0 calculations, functional cross-phase links and deploy. Document missing features honestly. Professor-facing requirements supersede this internal proposal.
