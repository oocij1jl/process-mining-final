# ProcessPilot

AI-assisted Process Intelligence Tool for Music Festival Operations & Resource Optimization.

## Status
Design only (v0.2.1). No executable application, generated event log, BPMN model, or completed software tests yet.

## Scope
- MAIN: Stage & Technical Operations
- SUB 1: Audience Entry & Crowd Management
- SUB 2: Equipment & Technical Readiness
- Cross-process: Resource Optimization

## Start here
Read [docs/START_HERE.md](docs/START_HERE.md), [requirements](docs/REQUIREMENTS.md), [functional specification](docs/FUNCTIONAL_SPEC.md), and [agent handoff](docs/AGENT_HANDOFF.md).

## Repository layout
- `docs/`: design, requirements, contracts, QA and AI usage records
- `src/engine/`: Codex-owned analysis and simulation engine
- `src/components/`, `src/pages/`, `src/state/`, `src/styles/`: Claude-owned UI and workspace state
- `public/datasets/`, `public/bpmn/`: synthetic public demo assets (business/data track)
- `scripts/`: reproducible synthetic dataset generation and validation
- `tests/fixtures/`: hand-verifiable test data
- `reports/evidence/`: sanitized evidence for the final report

Next: scaffold React + TypeScript + Vite once, review generated files and commit, then agree the shared contract in `src/contracts.ts` and engine exports before parallel development. See docs/AGENT_HANDOFF.md. Keep original KGU files, private logs and credentials out of the repository. The KGU review here is a path-redacted copy, not an algorithm verification.
