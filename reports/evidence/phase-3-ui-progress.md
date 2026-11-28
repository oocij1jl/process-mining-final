# Phase 3 UI — progress checkpoint

2026-11-28 KST · branch `feat/v03-ui` · worktree `~/Desktop/processpilot-v03-ui` · base `acc513f` · **uncommitted** (no commit/push/merge).

This is an intermediate checkpoint, not the final `phase-3-ui.md` report. The v0.3 engine (Codex, reported 133/133) and the Festival assets are **not yet merged into this worktree**. All v0.3 engine features below were therefore verified only as "not available in this build" states. No substitute calculation or fabricated data was added.

## 1. Completed features and pages

| Area | State | Verified in browser (dev, 1440px) |
|---|---|---|
| App shell | New light sidebar (lifecycle steps with purpose text and counts), sticky scope bar (dataset + source badge, process select, case-scope popover), mobile drawer nav, toasts | Yes |
| Overview & Data | Landing hero, **one-click Order Processing sample → Analysis graph**, Festival process chooser (manifest-driven; shows "not published" state), CSV/XES upload card with XES limits, column matcher (Phase 2 mapping preserved), XES preview + consent (needs `importXes`), data check with exclusion consent, provenance card, 8 questions linked to views, Advanced Data Details (mapping, raw rows, engine diagnostics incl. v0.3 capability list), UI test log moved to a developer disclosure | Yes (sample, summary 3 cases / 11 rows / 9 min / 66.7%) |
| Analysis — Process Explorer | Graph-first workspace, 7 modes (Frequency, Performance, Variants, Rework, Hand-overs, Patterns, Replay), right Inspector, display-only minimum-arrow filter with shown/total count, top→bottom / left→right layout, fullscreen, findings list → "Show evidence" (selects edge, performance mode) → case list → in-inspector case timeline with path highlight on the map; "Design an improvement" from a finding | Frequency, Performance (Packed→Shipped 5.5 min n=2, Payment service 2 min n=1), Variants (2/3, 1/3), Hand-overs (7), finding→case timeline: Yes. Rework/Patterns/Replay: only unavailable/fallback states |
| Design | Findings + designs lists, 7 levers with cautions and rule-based "suggested" tags, problem/scope/resources, measurable goal (only current KPIs; target saved to workspace), rationale/assumptions, template To-be change, quantitative vs qualitative evaluation, next actions | Yes (design from finding, lever, target 8 min saved → engine target finding + Monitor badge) |
| Model — BPMN Studio | Compare (reference/To-be vs observed map), As-is read-only viewer + summary, To-be editor with **native bpmn-js Modeler** (palette, undo/redo), save revision, export BPMN 2.0, re-import edited file, reload-guidance state, activity mapping UI (overrides saved; status/deviations need `getBpmnComparison`) | Modeler loads blank To-be with palette and DI: Yes. **Edit → save → export → re-import roundtrip: NOT yet verified** (interrupted) |
| Implementation | Opportunity table (log values; DFG/service fallback), assessment editor (0–5 ratings, risk, difficulty, impact), score via `scoreAutomation`, benefit/ROI via `estimateBenefit`, impact–difficulty matrix, rollout plans (Phase 2 editor reused; new plan sources) | Not yet opened in browser |
| Monitor | KPI cards with plain names, inline targets, problem/contributing cases (I-1 rule with legacy ID fallback; I-3 `problemCaseKeys`), evidence panel with case timeline, tabs: historical trend / throughput (user completion definition) / transition drift, rollout progress | KPI cards, off-target + 3 problem cases, trend "not available" state: Yes |
| Refine | Festival gate preset (params moved from Model, same page as results), general queue model (`extractQueueInputs`/`compareQueues`), shared comparison view, saved scenarios, send to plan, value–effort ranking from Implementation records, next cycle | Not yet opened in browser |
| Festival overview | Per-process KPI cards, audience throughput chart, Stage↔Equipment lookup by recorded festival_id + performance_id with side-by-side timelines | Not testable (no Festival data in worktree) |
| Export | v0.3 additive sections (activity evidence, completion definition, automation candidates, generic scenarios, BPMN revision refs, overrides, source format, festivalValidation) | Not re-tested |

## 2. In progress at interruption

- Model page: browser roundtrip test (add task in Modeler → Save new revision → Export → Re-import → check DI/edit preserved). Code exists; test not done.
- Last fix applied: "Copy As-is / Start blank" buttons in the To-be "XML not loaded" state.

## 3. Files

Modified: `src/App.tsx`, `src/adapters/engineAdapter.ts`, `src/components/{ui,layout}.tsx`, `src/components/graph/FlowGraph.tsx`, `src/festival/adapter.ts`, `src/lib/evidence.ts`, `src/pages/{Overview,Analysis,Design,Model,Implementation,Monitor,Refine,Export}Page.tsx`, `src/state/{analysis.tsx,plans.ts,store.tsx,types.ts}`, `src/styles/index.css`.

New: `src/components/{BpmnModeler,ImpactMatrix,icons}.tsx`, `src/festival/useManifest.ts`, `src/lib/{bpmn,kpiCatalog}.ts`, `src/pages/FestivalPage.tsx`, `src/pages/analysis/{graphs.ts,inspector.tsx,modes.tsx}`, `src/pages/overview/{DataImport,DataDetails}.tsx`, `src/samples/orderProcessing.ts`.

Not touched: `src/contracts.ts`, `src/v03-contracts.ts`, `src/engine/**`, tests, package/config files, `public/**`, `index.html`.

## 4. Engine API connection

- Connected and working: all 12 Phase 2 functions (validateAndNormalize, groupCases, buildDFG, getVariants, getCaseDurations, getPerformance, getResourceAnalysis, getKPIs, getFindings, evaluateTargets, getGateInputs, simulateGateQueue — gate path not re-run in browser).
- Wired per V03_CONTRACT §9 (`EngineApi = core & Partial<V03EngineApi>`, `realEngine = { ...engine }`, `callEngine` returns `not_implemented` when absent), **waiting for merge**: importXes (Overview/analysis provider), getActivityEvidence (analysis provider → Rework, Implementation), scoreAutomation, estimateBenefit (Implementation), extractQueueInputs, compareQueues (Refine), getCaseThroughput, getHistoricalTrends, getTransitionDrift (Monitor), getPatternEvidence (Patterns), buildReplayIndex, getReplayFrame (Replay), getBpmnComparison (Model mapping). Additive DTO fields consumed when present: `DFG.startCases/endCases`, `PerformanceAnalysis.transitionCoverage`, `HandoffSummary.activityPairs`, `Finding.rule/definition/evidenceKind`, `Metric.problemCaseKeys/definitionKey`.
- `importOptionsFor` now passes `festivalValidation: dataset.festival` (I-4); dataset fingerprint appends the policy only when it differs from the legacy inference.

## 5. Tests and build (this checkpoint)

- `npx tsc --noEmit`: PASS.
- `npm test`: PASS 96/96 (9 files) — Phase 2 baseline only; engine branch tests not present here.
- `npm run build`: PASS (existing >500 kB chunk warning).
- Production `vite preview`: NOT RUN. Narrow-screen check: NOT RUN. New UI unit tests: none written yet.

## 6. Known issues / open problems

- Vite dev server reloads the page once the first time the Modeler chunk is opened ("optimized dependencies changed"), which clears the in-memory dataset. Dev-only; verify it does not occur in production preview.
- Sidebar nav buttons expose the `title` text as accessible name in the tool's reading; add `aria-label={label}`.
- Implementation, Refine, Festival, Export pages and all v0.3 feature paths are unverified in the browser.
- Replay, Patterns, Rework (full), score/benefit, queue, trends/throughput/drift, XES and BPMN comparison UIs are typed against `v03-contracts.ts` but have never run against real engine output.
- Order sample is bundled in `src/samples/` (copy of the checked-in fixture content) because `public/datasets/` is empty in this worktree; data track may replace it.
- Festival process descriptions in `FESTIVAL_PROCESS_INFO` are summarised from DATA_SCHEMA §2; confirm against the final BUSINESS_PROCESS.md.

## 7. Next steps on resume (priority order)

1. Finish Model roundtrip test (add task → save revision → export → re-import → task + DI preserved; As-is unchanged).
2. Browser pass on Implementation, Refine (gate preset with test log), Export; fix defects.
3. Ask the student to merge `feat/v03-engine` and the data assets into an integration branch (or into this worktree); then re-run tsc/tests/build.
4. With the real engine: verify each v0.3 path against V03_CONTRACT §10 values (activity evidence C1–C3, benefit 20/3 h / ROI 0%, queue T09, throughput [0,0,1,1], replay, drift +25 pp, patterns, BPMN mapping), XES upload, Festival sample one-click load, four BPMN assets, Festival overview links.
5. Accessibility label fix, 375/768/1440 layout check, production preview journey, screenshots → `reports/evidence/phase-3-ui/`.
6. Write final `reports/evidence/phase-3-ui.md` (before/after, API status, journeys, GO/NO-GO).

## 8. Integration checks

- `src/engine/index.ts` exports must satisfy `V03EngineApi` (type-checked through `realEngine`); confirm no name drift.
- Merge conflicts expected only if the engine branch touched UI-owned files (`src/state/**`, `src/lib/evidence.ts`, `src/adapters/**`); `tests/integration/phase-2-integration.test.ts` imports `targetBreachFinding` and `importOptionsFor` — re-run, especially the I-3 clone assertion Codex was to update.
- Saved workspaces: v0.3 fields are optional; check old `processpilot.workspaces.v2` data still loads.
- Festival manifest path/schema (`public/datasets/dataset_manifest.json`, `bpmn`, `bpmn_to_be`) must match `parseManifest`.
- Confirm one-click Festival load maps automatically (otherwise the column matcher appears).
- Production preview: no console errors, no dev-only reload, BPMN chunks lazy-load.
