# Start here — ProcessPilot v0.2.1

For v0.3 development, start with the product specification and shared contract. The v0.2.1 documents below describe the baseline verified in Phase 2. [v0.3 product](V03_FINAL.md) · [v0.3 contract](V03_CONTRACT.md) · [Phase 2 evidence](../reports/evidence/phase-2-integration.md)

Read REQUIREMENTS → SPEC → FUNCTIONAL_SPEC → DATA_SCHEMA → ENGINE_CONTRACT → TEST_PLAN. AGENT_HANDOFF contains paste-ready implementation instructions. AI_USAGE_LOG is the starting record. KGU_TOOL_ANALYSIS is a path-redacted copy of the supplied Codex report; keep the original private.

v0.2.1 supersedes v0.2; only the resource handoff visualization is promoted to P0. Decisions: functional cross-phase interactions promoted to P0; resource handoff table and directed graph P0, display filter P1; audience pooled-gate simulation only for quantified MVP; no KGU internal algorithm parity, direct full-size XES import, automatic BPMN discovery, or real deployment. Stage/Audience/Equipment remain separate analyses.

Next: scaffold repo once → agree engine API/types → parallel engine/UI work → produce BPMN/log generator/manifest → integration & actual tests → early Netlify deploy → final release by Sunday 23:00 KST. No working tool, validated business-specific BPMN or generated Festival dataset in this package. Deadline is user-provided; verify LMS. Do not overwrite existing implementation files without reviewing diffs.
