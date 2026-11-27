# AI usage log — template
Record each actual interaction: date/time, AI/model if known, task, prompt or prompt path, output/commit, human review, discovered issue, correction, actual verification, limitations. Do not fabricate model names or completed tests.

| Date | AI tool | Task | Prompt/output reference | Review / correction | Verification / status |
|---|---|---|---|---|---|
| 2026-11-27 | Codex | KGU read-only reference review | KGU_TOOL_ANALYSIS.md | Compiled distribution, internal algorithms unavailable; use independent implementation | Metadata/config/sample inspection reported by Codex; no runtime tests |
| 2026-11-27 | ChatGPT | v0.2.1 requirements and cross-phase design | This design package | Explicit data contract and evidence-linked state flow | Document consistency review only; no software implemented |
| 2026-11-27, 16:10–16:23 KST | Codex | Phase 0 initialization and shared API handoff | User's Phase 0 request in this session. Output in `package.json`, `src/contracts.ts`, `src/engine/index.ts` and `tests/fixtures/phase-0-event-log.csv` | Read all 10 Markdown files in `docs/` and verified the initial clean `main` worktree. Established documented DTOs, placeholder errors, and GitHub Actions and Netlify settings. Human review is pending. | Clean install from the lockfile, 13 Vitest cases, TypeScript and Vite build, and Chrome render passed. [Execution evidence](../reports/evidence/phase-0.md) |

Add actual implementation, tests, deployment and dataset-generation entries as work happens. Keep original prompts/results privately if they include personal paths or credentials; sanitize public versions.

## Phase 0 specification review

- The KGU reference review placed the handoff graph and lifecycle pairing in P1. The v0.2.1 requirements and functional specification put both in P0, so the shared contract follows v0.2.1.
- Data schema §4 includes missing process among row issues, while §6 specifies a generic `default` fallback. The contract accepts omitted or blank process values for generic CSV and requires populated values when the Festival caller sets `requireProcessType`.
- The engine sketch left KPI context, finding inputs, and scenario input extraction underspecified. Phase 0 names these DTOs, adds `getGateInputs` for shared case eligibility and service selection, and includes case keys for graph node drill-down. The engine contract records how the UI consumes them.
- The test plan names `docs/evidence`, while the repository layout and README designate `reports/evidence`. The Phase 0 evidence uses the existing `reports/evidence` directory.

The placeholder tests exercise the public boundary and the fixture's CSV syntax. T01–T17 remain pending for engine, UI and deployment work. GitHub Actions and Netlify were configured locally. The remote workflow and public deployment remain unverified.
