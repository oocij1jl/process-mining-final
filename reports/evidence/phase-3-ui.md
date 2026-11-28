# Phase 3 — Frontend & Product UX (v0.3)

2026-11-28 KST · branch `feat/v03-ui` · base `6be8871` (student merge `d3328eb` of `feat/v03-engine` + Festival assets `436a80c`) · changes in this report are **uncommitted** (no commit/push/merge/deploy by Claude).

Related: [V03_FINAL](../../docs/V03_FINAL.md) · [V03_CONTRACT](../../docs/V03_CONTRACT.md) · [progress checkpoint](phase-3-ui-progress.md) · screenshots in [`phase-3-ui/`](phase-3-ui/).

## 1. Previous UI/UX problems (Phase 2)

- Developer dashboard look: dark sidebar, "Provider", "fixture", "Engine connection", function names and fingerprints in the primary flow.
- No product promise on the first screen; the UI fixture test log was the first suggested dataset; three cards of equal weight, no single start action.
- Analysis split into five tabs with tables as the default; the DFG was one tab among several, small, left-to-right and hard to read; no case path on the graph; start/end evidence missing.
- Findings were a separate tab disconnected from the graph; Design → Model → Refine links required re-entry.
- Model page held KPI targets and simulation parameters instead of BPMN; BPMN was view-only.
- Implementation was only a plan table; no automation/ROI; Monitor had no trends or change view; Refine split parameters (Model) from results.
- Unsupported features were silent or shown as engine errors; no mobile layout.

## 2. Before / after structure

| Area | Phase 2 | v0.3 |
|---|---|---|
| Shell | Dark sidebar, dev badges | Light sidebar with lifecycle steps and purpose text, scope bar (dataset, synthetic/upload badge, process, case-scope popover), drawer nav < 1024px |
| Overview | 3 cards + mapping + tables | Hero with promise, **one-click Order sample → graph**, Festival chooser (3 processes, one click), CSV/XES upload, data check with consent, provenance, 8 questions, collapsed Advanced Data Details |
| Analysis | 5 tabs (map, variants, performance, resources, findings) | One graph-first Process Explorer, 7 modes, right Inspector, findings → evidence → case timeline with path highlight |
| Design | Record form + BPMN viewer | Redesign strategy: finding → 7 levers (cautions, rule-based tags) → scope → measurable KPI target → rationale/assumptions → To-be change → quantitative/qualitative |
| Model | Targets + gate params | BPMN Modeling Studio: Compare, read-only As-is, native To-be Modeler with revisions/export/re-import, engine activity mapping + order check |
| Implementation | Plan table | Automation opportunity, assessment, engine score, benefit/ROI, impact–difficulty, rollout plans |
| Monitor | KPI cards + throughput | Plain-name KPIs with inline targets and problem cases, historical trend, completion throughput, transition drift, rollout progress |
| Refine | Results only | Parameters + results on one page: Festival gate preset and general queue, saved scenarios, value–effort, next cycle |
| New | — | Festival cross-process overview |

## 3. Implementation per page (actual result)

- **Overview & Data** — `pages/OverviewPage.tsx`, `pages/overview/*`. Order sample bundled in `src/samples/orderProcessing.ts` (same content as the checked fixture). Festival chooser reads `public/datasets/dataset_manifest.json`; when the manifest CSV maps automatically the dataset loads and opens Analysis on the chosen process in one click, otherwise the column matcher appears. CSV path keeps Phase 2 mapping, malformed-row consent and validation. XES (`.xes`/`.xml`) checks the 8 MiB limit, then calls `importXes`; preview shows traces/events/issues by trace/event position and requires consent for exclusions before loading. Diagnostics (mapping, raw rows, 12 required + 14 optional engine functions) are in Advanced Data Details.
- **Analysis** — `pages/AnalysisPage.tsx`, `pages/analysis/{graphs,inspector,modes}`. Modes: Frequency, Performance (time between steps / wait before next start, heat colour, n and coverage, service on nodes), Variants (list + path highlight), Rework (`getActivityEvidence`), Hand-overs (WTN graph, resource focus, activity pairs), Patterns (`getPatternEvidence`), Replay (`buildReplayIndex`/`getReplayFrame`, play/pause/scrub/speed/window/variant). Minimum-arrow filter is display-only and reports shown/total. Top→bottom default layout, fullscreen, viewport kept on selection, re-fit on canvas resize.
- **Design** — `pages/DesignPage.tsx`. Target KPI preselected only when the finding metric is a current KPI (contract §3); target saved to the workspace and evaluated by the engine. No AI wording; "suggested" levers are a fixed rule per finding type.
- **Model** — `pages/ModelPage.tsx`, `components/BpmnModeler.tsx`, `lib/bpmn.ts`. As-is never edited; To-be copies (from As-is, Festival To-be, blank or file) saved as revisions (XML in memory only, refs in workspace) with DI coverage shown; reload state explains re-import. Mapping overrides saved; `getBpmnComparison` gives status, coverage and order deviations; unsupported structures are stated, no fitness score.
- **Implementation** — `pages/ImplementationPage.tsx`, `components/ImpactMatrix.tsx`. Log values vs your ratings vs estimates kept apart; formula and denominators shown; high/unassessed risk gates review; plan created from a candidate.
- **Monitor** — `pages/MonitorPage.tsx`. Completion activity is user-defined (shared with Replay); empty buckets N/A; drift requires non-overlapping periods; no SPC or deadline prediction shown.
- **Refine** — `pages/RefinePage.tsx`. Festival gate preset (audience + Festival rules) and general queue model; out-of-date scenarios cannot be sent to a plan; staffing change only with the explicit one-worker assumption.
- **Festival overview** — `pages/FestivalPage.tsx`. Per-process KPIs via `getKPIs` per process, audience throughput, Stage↔Equipment readiness via `getFestivalReadinessLinks` (link status, ready vs deadline, on-time) with side-by-side timelines. No merged traces, no causal claims.
- **Export** — v0.3 sections appended (activity evidence, completion definition, automation candidates, generic scenarios, BPMN revision refs, mapping overrides, source format, festivalValidation).

## 4. API connection status (merged engine)

| API | UI consumer | Browser-verified |
|---|---|---|
| 12 Phase 2 functions | all pages | Yes |
| `importXes` | Overview XES preview / analysis | Yes (`audience_entry.xes`: 600 traces, 3,978 events, 0 issues → map) |
| `getActivityEvidence` | Rework, Implementation | Yes (Order: 0/3 repeat; totals) |
| `scoreAutomation` | Implementation | Yes (83.3 / 80 / 81.7) |
| `estimateBenefit` | Implementation | Yes (contract check: 6.67 h, 100,000, 50,000, net 0, ROI 0%) |
| `extractQueueInputs`, `compareQueues` | Refine general queue | Yes (Order: 1 used, 2 excluded with reasons) |
| `getHistoricalTrends` | Monitor | Yes |
| `getCaseThroughput` | Monitor | Yes (Order Shipped, 15 min: [1,1], 2 of 3) |
| `getTransitionDrift` | Monitor | Yes (default halves, low-support labels) |
| `getPatternEvidence` | Patterns | Yes (Order Received → 2 alternatives 66.7/33.3%) |
| `buildReplayIndex`, `getReplayFrame` | Replay | Yes (09:00 one case, 09:01 case 001 active on Payment Authorized) |
| `getBpmnComparison` | Model mapping | Yes (Stage: 9/9 mapped, 571 transitions checked, 0 deviations) |
| `getFestivalReadinessLinks` | Festival overview | Yes (143/143 linked; per-request ready vs deadline) |
| Additive DTO fields (`startCases/endCases`, `transitionCoverage`, `activityPairs`, `Finding.rule`, `problemCaseKeys`) | Inspector, Monitor | Consumed; Phase 2 fallback when absent |

Adapter: `EngineApi = core 12 & Partial<V03EngineApi>`, `realEngine = { ...engine }`, `callEngine` → `not_implemented` when absent (`src/adapters/engineAdapter.ts`). Shared contracts and engine files were not edited.

## 5. Not implemented / limitations

- Graph image export (P1), shift UI (`resource_shifts.csv` not ingested by the engine), deadline prediction and statistical control limits (stretch) — not shown.
- BPMN To-be XML is not persisted across reloads (by contract default); export file download and OS-dialog re-upload not exercised by the browser tool (in-app save → re-import of serialized XML verified).
- XES preview has no Festival-rules toggle (generic default `festivalValidation: false`); Festival analysis uses the CSV sample.
- Replay renders aggregated token counts per activity (exact engine counts), not moving tokens along arrows.
- Audience throughput chart spans the whole observation window including the night gap between D1 and D2.
- Main JS chunk 1.30 MB (bpmn-js viewer/modeler are split into lazy chunks).
- No new UI unit tests were added; verification is browser-based plus the existing suite.

## 6. User flow verification (browser, dev + production preview, 1440×900 unless noted)

| # | Scenario | Result |
|---|---|---|
| 1 | First visit → sample analysis | PASS — one click from landing to the graph (Order); Festival Stage also one click |
| 2 | Understand actual order (DFG) | PASS — counts on boxes/arrows, start/end, readable at 1440 (Order and 99-case Stage) |
| 3 | Find problem path (Performance) | PASS — Packed → Shipped 5.5 min n=2 highlighted from the finding |
| 4 | Evidence in Inspector | PASS — case list → case 001 timeline, path highlighted |
| 5 | WTN hand-overs | PASS — 7 hand-overs, resource/edge inspectors |
| 6 | Finding → Design | PASS — lever, KPI target 8 min saved; engine target finding + Monitor badge appear |
| 7 | BPMN compare / edit | PASS — Stage As-is vs observed map, engine mapping; To-be edit → new revision with DI 4/4; Stage copy 17/17 DI in production |
| 8 | Run improvement scenario | PASS — Audience 3 → 4 gates on 600 entrants: mean wait 1.33 min → 16.3 s, p95 5.08 → 1.7 min (modeled) |
| 9 | Expected effect | PASS — modeled comparison table/chart; benefit/ROI calculator |
| 10 | Implementation plan | PASS — plan from automation candidate; Quick win in matrix; scenario plans via "Send to rollout plan" |

Other checks: XES upload (simulated file input with the published `.xes`) PASS; Festival overview + readiness PASS; production preview console: **no errors** after the Festival journey and Modeler; no dev-only reload in production. 375×812 and 768×1024: no horizontal overflow (scrollWidth = viewport); fixed during this pass — scope bar shrinking/overlap, hero clipping, initial graph fit on mobile.

## 7. Tests and build (final run)

- `npx tsc --noEmit`: PASS
- `npm test`: PASS **139/139** (13 files; includes the merged engine suites)
- `npm run build`: PASS (chunk-size warning only)
- `vite preview` (production) journeys: PASS as listed above
- Public URL / T16: NOT RUN (no deployment)

## 8. Screenshots

`phase-3-ui/01-landing-1440` … `27-monitor-drift` (JPEG, captured from the 1440×900 viewport, some downscaled). Key: 02 Order map, 03 finding evidence, 04 case timeline, 11 Festival Stage map, 12–13 BPMN compare/mapping, 15 Stage↔Equipment readiness, 16 Audience gates, 17–18 XES, 21 Replay, 22–24 mobile/tablet. Some early images (02–08) predate the final spacing tweak.

## 9. Demo video features (2–3 min)

1. Landing → Festival "Stage & Technical Operations" (one click) — 11, 14.
2. Stage map → Performance → slow transition finding → case timeline; Rework loop Technical Check → Troubleshooting → Recheck; Hand-overs — 11.
3. Design an improvement from the finding (lever + target) → Model compare and To-be copy edit — 12, 13, 19.
4. Switch process to Audience → Refine gates 3 → 4 (modeled, same arrivals) — 16.
5. Implementation: assess an activity, score + benefit/ROI assumptions, Quick win, rollout plan — 25.
6. Monitor target breach + trend; Festival overview Stage↔Equipment readiness — 08, 15.
7. Close: CSV/XES upload (17–18), data provenance, no AI claims.

## 10. Remaining integration tasks

- Commit this pass (student); deploy and run T16 in a private browser on the public URL.
- Optional: Festival toggle in XES preview; persisted To-be XML policy; graph image export.
- Recheck Phase 2 history migration with real saved workspaces from earlier deployments.

## 11. GO / NO-GO

**GO for release candidate** of the UI on the merged branch: all six lifecycle pages and the Festival overview have a working flow on the real engine and Festival assets; 139/139 tests and production build pass; 10/10 demo scenarios verified in the browser; unsupported items are hidden or labelled. Conditions: student commit/deploy and the public-URL smoke test (T16) are still open.
