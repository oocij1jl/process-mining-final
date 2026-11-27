# ProcessPilot

AI-assisted Process Intelligence Tool for Music Festival Operations & Resource Optimization.

## Status
Phase 0 (v0.2.1). The React development shell, shared engine signatures, and hand-authored test fixture are ready. Engine calculations, workflow screens, Festival demo assets, and deployment are pending.

## Scope
- MAIN: Stage & Technical Operations
- SUB 1: Audience Entry & Crowd Management
- SUB 2: Equipment & Technical Readiness
- Cross-process: Resource Optimization

## Start here
Read [docs/START_HERE.md](docs/START_HERE.md), [requirements](docs/REQUIREMENTS.md), [functional specification](docs/FUNCTIONAL_SPEC.md), and [agent handoff](docs/AGENT_HANDOFF.md).

## Local development

Use Node.js 24 as declared in `.nvmrc`.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

GitHub Actions runs installation, tests, and the production build for pull requests and pushes to `main`. Netlify uses `npm run build` and publishes `dist`. [GitHub workflow](.github/workflows/ci.yml) · [Netlify configuration](netlify.toml)

## Repository layout
- `docs/`: design, requirements, contracts, QA and AI usage records
- `src/engine/`: Codex-owned analysis and simulation engine
- `src/components/`, `src/pages/`, `src/state/`, `src/styles/`: Claude-owned UI and workspace state
- `public/datasets/`, `public/bpmn/`: synthetic public demo assets (business/data track)
- `scripts/`: reproducible synthetic dataset generation and validation
- `tests/fixtures/`: hand-verifiable test data
- `reports/evidence/`: sanitized evidence for the final report

Use the shared types and engine entry point for parallel engine and UI development. The Phase 0 fixture documents the expected DFG, durations, lifecycle gaps, and resource handoffs for future engine tests. [Engine contract](docs/ENGINE_CONTRACT.md) · [Fixture expectations](tests/fixtures/README.md) · [Phase 0 verification](docs/AI_USAGE_LOG.md)

Keep original KGU files, private logs and credentials out of the repository. The KGU review summarizes the local metadata inspection with personal paths redacted. [KGU reference review](docs/KGU_TOOL_ANALYSIS.md)
