# Phase 1 Frontend 독립 QA 검수 보고서

> **정리 (Phase 1.1 이후):** git 업로드 전 정리에서 Phase 1 당시의 1회성 실행 출력(`journey-output.txt`, `qa/*-output*.txt`, `qa/build-output.txt`, `qa/test-output.txt`)과 수정 전 라벨의 스크린샷 8장을 삭제했습니다. 해당 수치는 이 문서 본문에 그대로 기록되어 있습니다. 최신 실행 원문은 `phase-1-frontend/phase-1-1/`에 있습니다.

- 일시: 2026-11-27 KST
- 대상: `feat/frontend` worktree의 커밋 전 작업 트리(기준 커밋 `12eb710`). Node v24.15.0, npm 11.12.1
- 검수자: Claude Code (Claude Opus 5.5). 이 프론트엔드를 구현한 같은 에이전트가 검수했습니다. 완전한 제3자 검수가 아니므로 이 보고서는 사람 리뷰의 입력 자료로 사용해 주세요.
- 범위: 코드와 명세(REQUIREMENTS, SPEC, FUNCTIONAL_SPEC, DATA_SCHEMA, ENGINE_CONTRACT, TEST_PLAN)의 대조, 빌드와 테스트 재실행, 브라우저 재검증. **제품 코드는 수정하지 않았습니다.** commit, push, merge, 배포도 하지 않았습니다.
- 추가 증거: `reports/evidence/phase-1-frontend/qa/`(QA 스크립트, 입력 BPMN 2종, 실행 출력 원문)

> **정정 (2026-11-27, Phase 1.1 작업 중 발견):** 이 문서의 QA 추가 검사 개수가 잘못 기록되었습니다. 원문 출력(`qa/qa-output.txt`, `qa/qa-output-preview.txt`)의 실제 결과는 **검사 17개 중 PASS 15, FAIL 2**(INFO 4)입니다. 15절 표의 "PASS 17"과 E절의 "QA 19개 검사"는 이 값으로 정정합니다. 판정과 결함 내용에는 변화가 없습니다.

## 0. 결론 요약

| # | 항목 | 판정 |
|---|---|---|
| 1 | P0 기능 충족 (REQUIREMENTS / FUNCTIONAL_SPEC) | **PARTIAL** |
| 2 | ENGINE_CONTRACT 타입·호출 호환성 | **PARTIAL** |
| 3 | 엔진 어댑터와 UI Fixture 분리 | **PASS** |
| 4 | 실제 엔진 연결 후 Fixture 오사용 가능성 | **PASS** (잔여 위험 낮음, 주의사항 있음) |
| 5 | `providerFor()` 변경만으로 엔진 연동 가능 여부 | **PARTIAL** |
| 6 | 공유 상태와 갱신 정확성 | **PARTIAL** (결함 1건 확인) |
| 7 | 데이터셋·프로세스·필터 변경 시 Stale 처리 | **PARTIAL** |
| 8 | Model→Monitor, Design→Refine, Refine→Implementation | **PASS** (Fixture 기준) |
| 9 | DFG·Resource Network와 집계 테이블 일관성 | **PASS** (Fixture 기준) / 엔진 기준 **NOT TESTABLE** |
| 10 | 업로드 오류·빈 데이터·결측·미지원 지표 예외 처리 | **PARTIAL** |
| 11 | KPI ID·단위·비율 표현의 엔진 충돌 가능성 | **PARTIAL** (충돌 위험 높음) |
| 12 | Evidence Export 출처와 범위 표시 | **PARTIAL** |
| 13 | Festival Dataset·BPMN Manifest 경로와 구조 | **PARTIAL** |
| 14 | Git 변경 사항 위생 | **PASS** (권고 1건) |
| 15 | 빌드와 브라우저 테스트 재실행 | **PASS** (실행 성공. 발견된 결함은 6, 13번에 반영) |

FAIL 판정 항목은 없습니다. 다만 브라우저 QA에서 **실제 결함 2건이 재현**되었습니다(6번 그래프 zoom 초기화, 13번 To-be BPMN 문구). 엔진 미구현 때문에 **실제 분석 정확성, T13, T14, T16은 이번 검수 범위에서 검증할 수 없습니다.**

## A. Fixture로 검증한 기능과 실제 엔진으로 검증해야 하는 기능

| 기능 | Fixture로 확인함 (UI 경로) | 실제 엔진으로 확인 필요 |
|---|---|---|
| CSV 매핑 UI, 필수 필드 차단, 파서 경고, 빈 파일·비 CSV 거부 | ✔ (실제 엔진 경로에서 확인, 엔진 호출 전 단계) | 검증 issue 표시, 제외 동의 흐름(`canAnalyze=false`), T05, T08 |
| 엔진 미구현·오류 상태 표시 | ✔ (실제 엔진 스텁) | — |
| DFG 렌더링, self-loop, Start/End, zoom/pan, node/edge 클릭 → 케이스 | ✔ | 실제 DFG 수치(T01, T02), 대규모 그래프 성능 |
| Variants, Performance 3분류 표시, low support 배지 | ✔ | 실제 variant, gap, service 값(T01, T04, T07) |
| Resource handoff 그래프 = 표, 양방향 분리, isolated node, 빈 상태 | ✔ (Q9: graph=1,1 / table=1,1) | T03, T17 실제 데이터 |
| Findings → Design record 생성 | ✔ | 엔진 finding 규칙 출력 형식과 텍스트 |
| Model target → Monitor 즉시 반영, 측정값 불변 | ✔ (T10 UI 경로) | 실제 metric ID와 unit으로 T10 재확인 |
| Gate scenario 실행, stale, revision, apply → plan | ✔ (T09 손계산 값 일치, T11, T12 UI 경로) | 실제 `getGateInputs` 제외 규칙, 3→4 gate 시나리오 |
| Throughput 차트 | ✔ (bucket 1개) | 다중 bucket, anchor 규칙 |
| Evidence JSON, CSV 내용 | ✔ (Q12: provider 라벨, scope, DFG 수치 일치, raw 행 미포함) | T13 (다른 CSV 로드 후 export 수치 일치) |
| BPMN import와 렌더링 | ✔ (DI 포함 파일 렌더링, DI 없는 파일 오류 표시) | Festival 자산 자동 로드 (자산 미제공) |
| Festival 샘플 로드, Festival KPI adapter | ✗ (자산 없음) | 전부 |
| 다른 CSV 업로드 시 전체 갱신 (T13), generic 로그 N/A (T14), 공개 URL (T16) | ✗ | 전부 |

## B. 항목별 상세

### 1. P0 기능 충족 — PARTIAL
| ID | 판정 | 근거와 누락 |
|---|---|---|
| F01 Data | PARTIAL | 업로드, 매핑, preview, 설정(placeholder, offset, requireProcessType), 제외 동의, process 선택, trace view, 샘플 다운로드를 구현함. 검증 결과와 "다른 CSV 업로드 시 전체 갱신"은 엔진이 있어야 확인 가능 |
| F02a DFG | PASS (fixture) | node/edge 클릭, 케이스 조회, zoom. P1 threshold는 미구현이며 의도한 범위임 |
| F02b Variant | PASS (fixture) | 정렬, 점유율, 케이스 drill-down |
| F02c Performance | PASS (fixture) | metric type 분리, n 표시, 케이스 클릭. median/p95는 optional |
| F02d Resources | **PARTIAL** | FUNCTIONAL_SPEC 상호작용의 **"filter resource"가 미구현**. 노드 선택은 되지만 resource 기준 필터가 없음 |
| F02e Findings | PASS (fixture) | finding → design record |
| F03 Design | PARTIAL | 편집, 저장, 연결, BPMN import와 DFG 비교 구현. Festival As-is 자동 표시와 audience To-be 번들 자산은 manifest에 To-be 키가 없어 지원하지 않음(13번 참조) |
| F04 Model | PASS (fixture) | target 검증, 즉시 반영, 시나리오 파라미터, stale 처리 |
| F05 Implementation | PASS (fixture) | plan 생성, 편집, revision, archive, CSV/JSON export |
| F06 Monitor | PASS (fixture) | met/breached/unknown, 알림, drill-down, throughput, plan 상태 분리, N/A 표시 |
| F07 Refine | PASS (fixture) | baseline과 candidate에 동일 벡터 사용, observed와 modeled 분리, apply. target check의 의미적 한계는 11번 참조 |
| F08 Evidence | PARTIAL | JSON과 CSV 구현. **Festival generator와 seed가 export에 포함되지 않음**(DatasetMetadata에 필드 없음). Overview에 Festival BPMN 다운로드 링크 없음. T16 미실행 |
| Festival overview (FUNCTIONAL_SPEC "Stage and Equipment deliverables", REQUIREMENTS의 Cross-process linked dashboard) | **미구현** | 프로세스 간 KPI 비교와 장비 준비 대 공연 연결 화면이 없음. P0 F-목록에 명시되지는 않았지만 프로젝트 경계에 포함된 항목이므로 팀 결정이 필요함 |

### 2. ENGINE_CONTRACT 호환성 — PARTIAL
- **PASS:** `tsc --noEmit`(strict)이 `src/contracts.ts`와 `src/engine/index.ts` 시그니처 기준으로 통과합니다. 12개 함수 모두 `callEngine`을 통해 계약된 인자 순서로 호출합니다. 엔진 출력은 정렬 전에 복사(`[...x].sort`)하고 직접 변경하지 않습니다. `canAnalyze=false`이면 분석을 차단합니다. 케이스 필터는 첫 accepted event 기준으로 전체 케이스를 선택합니다. `KPIContext.processKey`와 `throughput{bucketMinutes, anchorMs(UTC 정렬)}`도 계약대로 전달합니다.
- **불일치·누락:**
  1. **`RawRow` 타입 위반 가능성.** PapaParse는 열이 많은 행에 `__parsed_extra: string[]` 키를 붙이고, 열이 적은 행은 키를 생략합니다(실측: `TooManyFields`, `TooFewFields`). UI는 경고만 표시하고 그대로 `validateAndNormalize`에 넘깁니다(`src/lib/files.ts` `parseCsv`, `src/pages/OverviewPage.tsx:153`). 엔진이 `Record<string,string>`을 가정하면 오류가 나거나 배열을 문자열화할 수 있습니다.
  2. **`FindingAnalysis.rework` 미전달**(`src/state/analysis.tsx`의 findings memo). DATA_SCHEMA와 FUNCTIONAL_SPEC은 Festival troubleshooting/recheck 활동을 "explicitly configured"로 요구하지만 UI가 설정을 넘기지 않습니다.
  3. **`FestivalKPIConfig`를 부분적으로만 전달.** `equipmentDeadline: 'required_ready_at'`와 linked traces만 넘기고, `technicalCheckRepeatActivity`, `stageHandoverPointFallback`은 전달하지 않습니다(`analysis.tsx:159-166`).
  4. Festival linked traces는 날짜 필터와 무관하게 전체 traces를 넘깁니다(`analysis.tsx:163-164`). 계약에 명시가 없으므로 엔진과 합의가 필요합니다.
  5. `KPIContext.shifts`는 미전달입니다(shift 업로드 UI 없음). 명세상 utilization은 N/A가 정상입니다.

### 3. 엔진 어댑터와 Fixture 분리 — PASS
- `src/adapters/fixtures/uiFixture.ts`는 contracts 타입과 `FixtureUnavailableError`, `EngineApi` 타입만 import하고 `src/engine`은 참조하지 않습니다.
- `realEngine`(`engineAdapter.ts`)은 fixture를 참조하지 않습니다.
- Fixture를 import하는 곳은 세 군데입니다: `state/analysis.tsx:32`(provider 선택), `OverviewPage.tsx:4`(fixture CSV 로드와 다운로드), `ExportPage.tsx:2`(fixture CSV 다운로드).
- Fixture 안에서 실행되는 로직은 `evaluateTargets` 스텁, throughput bucket 조건, assumed 모드 입력 벡터 복제의 세 가지이며 모두 fixture 전용으로 주석 처리되어 있습니다. 엔진 알고리즘(DFG, variant, 시뮬레이션)을 중복 구현한 곳은 없습니다. 시뮬레이션 결과는 gate 1, 2, 3개 이상에 대한 손계산 표 조회입니다.

### 4. 실제 엔진 연결 후 Fixture 오사용 가능성 — PASS (주의사항 있음)
- Fixture provider는 `dataset.sourceKind === 'ui_fixture'`일 때만 선택되고(`analysis.tsx:58`), 이 값은 "Load UI fixture" 버튼에서만 설정됩니다. 업로드와 Festival 데이터는 항상 `realEngine`을 사용합니다. 업로드한 파일이 fixture와 같은 내용이어도 `user_upload`로 처리됩니다.
- 주의사항:
  - (a) 배포판에 "Load UI fixture"가 남아 있으면 사용자가 fixture 값을 볼 수 있습니다. 라벨은 표시됩니다.
  - (b) localStorage에 남은 fixture workspace 문제. Fixture로 만든 scenario는 provider 불일치로 stale이 됩니다(정상). 그러나 **PlanRecord에는 provider 필드가 없어**, fixture scenario에서 생성된 plan은 같은 fixture dataset ID에서 계속 "current"로 보이고 편집도 가능합니다(Scenario state 배지만 stale로 표시).

### 5. `providerFor()` 변경만으로 연동 가능 여부 — PARTIAL
- 데이터 흐름은 `providerFor()` 한 곳만 바꾸면 전환됩니다. 페이지는 `useAnalysis()`만 사용합니다.
- 다만 라벨과 문구는 provider가 아닌 **`sourceKind` 기준**이라, fixture CSV를 엔진으로 돌리면 아래 문구가 사실과 달라집니다.
  - `src/components/layout.tsx:115`: SourceBadge의 "UI FIXTURE · not engine output"
  - `src/pages/OverviewPage.tsx:469-472`: "All analysis on this dataset comes from hand-authored values"
  - `src/pages/RefinePage.tsx:200`: "queue results exist only for 4-second service"
  - `src/adapters/fixtures/uiFixture.ts`의 `UI_FIXTURE_DATASET_NAME`: 데이터셋 이름 자체에 "(not engine output)" 포함. export의 `sourceName`에도 남습니다.
- localStorage에 저장된 fixture 전용 metric ID(`fixture.*`) target은 orphan 행으로 남아 Monitor에서 "unknown" 알림으로 표시됩니다.
- **결론:** 업로드와 Festival 경로는 `providerFor()` 변경 없이도 이미 실제 엔진을 사용합니다. Fixture 데이터셋까지 엔진으로 돌리려면 위 4개 파일을 함께 수정하거나 fixture 진입점을 제거해야 합니다.

### 6. 공유 상태와 갱신 정확성 — PARTIAL
- **PASS:** 모든 페이지가 `StoreProvider`와 `AnalysisProvider` 하나를 공유합니다. target 변경은 `evaluations` memo만 다시 계산합니다(즉시 반영 확인). 데이터셋, 프로세스, 필터 변경 시 같은 selector에서 다시 파생됩니다.
- **결함 (재현됨) — Q6 FAIL:** 케이스 drawer를 열면 그래프 zoom/pan이 초기화됩니다.
  - 측정값: `before=translate(-123.5px,216.3px) scale(0.97)` → `after=translate(39.5px,235.5px) scale(0.67)`. dev와 production preview 모두 재현됩니다.
  - 원인: `scope` memo 의존성이 `view` 객체 전체입니다(`src/state/analysis.tsx:135-140`). 따라서 `selectedCaseKey`나 `throughputBucketMin`만 바뀌어도 scope가 새로 만들어지고, `base` memo(`:171`)가 **모든 엔진 분석을 다시 실행**합니다. 새 DFG 객체가 생기면 다시 layout하고 `fitView`가 실행됩니다.
  - 영향: drill-down UX가 깨지고, 실제 엔진에서 대규모 로그를 쓸 때 불필요한 재계산이 생깁니다.
- 보조 결함: workspace가 아직 없을 때 `useWorkspace()`가 매 렌더마다 새 `emptyWorkspace` 객체를 반환합니다(`src/state/store.tsx:268`). 그 결과 `targets` 참조가 바뀌어 findings와 evaluations가 매 렌더마다 다시 계산됩니다.
- 위험 (엔진 필요): 분석이 렌더 중 동기 `useMemo`로 실행되므로 대용량에서 UI가 멈출 수 있습니다. 분석 단계의 loading 상태는 없습니다.

### 7. Stale 처리 — PARTIAL
- **PASS:** Scenario는 `paramsRevision`, scope, provider로 stale을 판정하고 apply를 차단합니다(브라우저 확인). 다른 필터에서는 plan이 read-only가 됩니다(확인). Design record에는 "other filter" 배지가 붙습니다. 새 apply는 revision을 만들고 이전 plan을 archive합니다(확인).
- **명세 편차:**
  1. SPEC은 "workspaces keyed by datasetId + processKey + **analysisFilter fingerprint**"이지만 구현은 `datasetId::processKey`로 저장합니다(`store.tsx:97`). 그래서 **KPI target과 design record는 필터를 바꿔도 유지됩니다.** 레코드 단위 scope 비교로 보완하고 있지만 명세와 다르므로 팀 확인이 필요합니다.
  2. 데이터셋이 바뀌면(dataset ID 변경) 이전 design, scenario, plan이 화면에서 **사라질 뿐** archived/stale 목록으로 표시되지 않습니다. SPEC의 "show prior records archived/stale"을 충족하지 못합니다. 새 데이터에 암묵적으로 적용되지 않는다는 점은 충족합니다.
  3. Scenario가 stale이 되어도 이미 만든 plan은 "current"로 남습니다(배지만 stale). TEST_PLAN T12의 "old plan archived/explicitly retained"와 일치하는 해석이지만 명시적인 확인이 필요합니다.

### 8. 화면 간 연동 — PASS (Fixture 기준)
- Model→Monitor: target 0.01 min이면 breached, 1 min이면 met, 측정값 3 s는 유지됩니다(journey 10–11).
- Design→Refine: 활성 simulation design이 Refine에 연결되고 scenario.designId에 기록되어 plan.designId로 이어집니다(journey 9, 12).
- Refine→Implementation: +1 gate / +1 worker, owner 편집, revision과 archive(journey 12–15).
- 의미상 주의: Refine의 target check는 design target KPI의 unit이 `min`이기만 하면 **modeled mean wait**와 비교합니다(`src/pages/RefinePage.tsx:250-253`). target이 queue wait가 아닌 다른 분 단위 KPI(예: entry elapsed)이면 의미가 다른 값끼리 비교됩니다.

### 9. 그래프와 테이블 일관성 — PASS (Fixture) / NOT TESTABLE (엔진)
- 그래프와 표가 같은 `ResourceAnalysis`, `DFG` 객체를 사용합니다. Q9에서 handoff 그래프 라벨(1,1)과 표(1,1)가 일치했습니다. 양방향 엣지는 각각 표시되고 엣지 클릭 시 해당 케이스 1건이 나왔습니다(journey 6–7).
- 엔진 의존 위험: `handoffs`의 endpoint가 `resources`에 없거나 `dfg.starts/ends`의 키가 `nodes`에 없으면 React Flow가 해당 엣지를 **조용히 생략**하고 표에만 남습니다. 계약상 발생하지 않아야 하지만 T17 실제 데이터로 확인해야 합니다.

### 10. 예외 처리 — PARTIAL
- **PASS (브라우저):** 빈 파일은 "no header row", 비 CSV(.xes)는 명시적으로 거부, 필수 필드를 매핑하지 않으면 Validate 버튼 비활성, 파서 경고 표시, 엔진 미구현 시 하위 페이지에 "Dataset is not ready for analysis" 표시. 미지원 metric(`value=null`)은 N/A와 reason으로 표시되고 0으로 표시되지 않습니다. 결측 resource는 trace에서 "missing"으로 표시됩니다.
- **누락:**
  - 열 수가 맞지 않는 행이 있어도 로드가 허용되고 `__parsed_extra`가 전달됩니다(2번 1항).
  - import-wide 오류(`row=-1`)만 있을 때 동의 문구가 "excluding the 0 rows"로 표시됩니다(`OverviewPage.tsx:534, 558`).
  - Target 입력에 잘못된 값을 넣으면 이전 target이 그대로 유효하게 남습니다(저장 차단은 명세대로지만 화면과 상태가 어긋남).
- `Math.min(...firsts)`(`analysis.tsx:154`)는 케이스 수가 약 10만을 넘으면 스택 한계에 걸릴 수 있습니다. 데모 규모(약 850)에서는 문제 없습니다.

### 11. KPI ID, 단위, 비율 — PARTIAL (충돌 위험 높음)
| 쟁점 | UI 현재 가정 | 위치 | 위험 |
|---|---|---|---|
| 비율 스케일 | `unit === '%'`이면 0–100 | `src/lib/format.ts:25`, `src/pages/ModelPage.tsx:15` | 계약은 `Variant.share`만 0–1로 정의하고 Metric 비율은 정의하지 않음. 엔진이 0–1을 `%` 단위로 반환하면 표시가 100배 어긋나고 target 검증이 틀림 |
| 시간 단위 문자열 | `'min'`만 adaptive 표시, target 하한 검증, Refine 비교 | format.ts, ModelPage, RefinePage:250 | 엔진이 `'minutes'` 등을 쓰면 Refine target check가 항상 "not comparable" |
| Metric ID | UI는 ID를 하드코딩하지 않음(동적). fixture만 `fixture.*` | — | 낮음. 단 저장된 fixture target이 orphan으로 남음 |
| Throughput | `buckets`가 비어 있지 않은 **첫 metric** | `src/pages/MonitorPage.tsx:42` | bucket metric이 여러 개면 임의로 하나만 표시 |
| Unit 일치 | target.unit = metric.unit 고정 | ModelPage | 엔진이 unit을 바꾸면 기존 target은 `unknown`(계약대로) |

→ 통합 전에 **엔진과 unit 어휘, 비율 스케일, throughput metric 식별 규칙을 합의**해야 합니다. 합의 내용은 `src/contracts.ts`의 Metric 주석으로 남기는 것을 권장합니다(Codex 소유).

### 12. Evidence Export — PARTIAL
- **PASS (Q12):** JSON에 provider 라벨("UI FIXTURE…"), dataset ID, mapping, scope, filter 규칙, 선택 케이스 수, metric family 정의, 각 엔진 결과 또는 실패 상태가 들어 있습니다. DFG 수치는 화면과 일치합니다(A=3, B=1, C=2, 엣지 4개). **raw 행은 포함되지 않습니다.** 분석 CSV에는 `dataset_id, process, filter, provider` 열이 있습니다.
- **누락:**
  - **Plans CSV에 provider 열이 없고**, PlanRecord에도 provider가 없습니다.
  - Issues CSV에는 dataset_id만 있습니다(데이터셋 수준이라 허용 가능).
  - Fixture 모드 안내문 "labelled … in every file"(`src/pages/ExportPage.tsx:174`)은 plans CSV와 fixture CSV 때문에 **사실과 다릅니다.**
  - Festival manifest의 `generator.version/seed`, `dataset_id`가 export에 포함되지 않습니다.

### 13. Festival Dataset·BPMN Manifest — PARTIAL
- 코드가 사용하는 경로(Netlify base `/` 기준):
  - Manifest: `/datasets/dataset_manifest.json`. `public/datasets/dataset_manifest.json`에 두며 응답 Content-Type에 `json`이 포함되어야 합니다(`OverviewPage.tsx:61`).
  - CSV: `/datasets/${manifest.csv}`(`:179`)
  - BPMN: `/bpmn/${manifest.bpmn[processKey]}`(`DesignPage.tsx:269`)
- 확인한 사항(Q13): DI(BPMNDiagram)가 있는 BPMN은 렌더링됩니다(도형 5개). **DI가 없는 BPMN은 렌더링되지 않고** 오류 notice가 표시됩니다. 자산 제작 시 DI는 필수입니다.
- **결함 (재현됨) — Q13 FAIL:** 새로고침 후 BPMN XML은 메모리에서 사라지지만(의도된 동작) design record의 `toBeBpmnRef`는 남습니다. 이때 To-be 탭에 "This design uses a change note only…"라고 **잘못 안내**합니다(`DesignPage.tsx:281-282, 347`). 참조는 있는데 파일이 다시 로드되지 않은 상태와 구분하지 못합니다.
- **누락:**
  - manifest에 **To-be BPMN 키가 없어** audience To-be를 자산으로 제공할 수 없고 매번 수동으로 import해야 합니다.
  - manifest의 결측 resource 정책, `dataset_id`, `units`, process 설명을 UI가 사용하지 않습니다. 결측 placeholder는 항상 기본값입니다.
  - BPMN 존재 여부는 `xml.includes('definitions')`로만 확인합니다(`DesignPage.tsx:273`).
  - `csv` 키는 UI가 임의로 정한 이름이며 데이터 트랙과 합의되지 않았습니다.
- 정확한 제작 인터페이스는 D절에 정리했습니다.

### 14. Git 위생 — PASS (권고 1건)
- `git status` 결과: 수정 2개(`src/App.tsx`, `src/styles/index.css`), 신규 `src/` 하위 21개 파일, `reports/evidence/` 하위 증거 파일.
- `src/contracts.ts`, `src/engine/*`, `tests/*`, `package*.json`, 설정 파일, `docs/AI_USAGE_LOG.md`는 변경되지 않았습니다.
- `dist/`와 `node_modules/`는 `.gitignore`에 포함되어 있습니다. 브라우저 프로필과 스크린샷 원본 폴더(`shots/`, `profile/`, `qa-shots/`)는 scratchpad에만 있고 저장소에 **없습니다.**
- 개인정보 검사: `src`, `reports`, `docs` 안에서 `/Users/`, 사용자명, 이메일을 grep한 결과 없음. QA 중 test-output에 있던 로컬 경로 1건은 `<repo>`로 치환했습니다. 스크린샷(1.7 MB, 8장)에는 timezone `Asia/Seoul`만 보이고 개인정보는 없습니다.
- **권고:** `journey.mjs`와`qa.mjs`를 `reports/evidence/phase-1-frontend/`에서 직접 실행하면 그 아래에 `shots/`, `qa-shots/`, `profile/`(Chrome 프로필 캐시)이 생깁니다. 커밋 전에 `.gitignore`에 `reports/evidence/**/profile/`, `**/shots/`, `**/qa-shots/`을 추가하는 것을 권장합니다(공유 설정이므로 lead가 결정). 증거 PNG 1.7 MB 포함 여부도 결정이 필요합니다.
- 참고: localStorage에는 design의 `findingText`가 저장됩니다. 엔진 finding 텍스트에 직원 이름 같은 resource 값이 들어가면 브라우저에 남을 수 있습니다(SPEC의 "no persistence of raw user data"와 경계 사례).

### 15. 빌드와 브라우저 재실행 — PASS
| 실행 | 결과 | 원문 |
|---|---|---|
| `rm -rf dist && npm run build` | exit 0, 타입 오류 없음. `index` 1,039.93 kB(gzip 308.39 kB), `BpmnViewer` 197.65 kB lazy chunk. 500 kB 초과 경고 1건 | `qa/build-output.txt` |
| `npm test` | 1 file, 13/13 통과(Phase 0 테스트만 있음) | `qa/test-output.txt` |
| journey (dev server, 새 프로필) | 19/19 PASS, 콘솔 오류 0 | `qa/journey-output-qa.txt` |
| journey (**production `vite preview`**, 새 프로필) | 19/19 PASS, 콘솔 오류 0 | `qa/journey-output-preview.txt` |
| QA 추가 검사 (dev / preview) | PASS 17, **FAIL 2**(Q6 zoom 초기화, Q13 To-be 문구), INFO 4. 두 환경 결과 동일 | `qa/qa-output.txt`, `qa/qa-output-preview.txt` |

- 처음 실행한 QA 스크립트는 "새로고침"을 hash 이동으로 처리해서 실제로는 페이지가 다시 로드되지 않았습니다. 이를 `location.reload()`로 고친 뒤 재실행한 결과만 위에 기록했습니다.
- 공개 HTTPS 배포와 시크릿 창 smoke test(T16)는 이번 범위가 아니어서 **실행하지 않았습니다.**

## C. 통합 시 수정 파일, 예상 문제, 해결 순서

### 해결 순서
1. **엔진 브랜치를 먼저 merge하고 엔진 테스트를 실행합니다.** (`src/engine/*`, `tests/*`, Codex 소유)
2. **계약 보완을 합의합니다** (Codex 소유 `src/contracts.ts`, 한 커밋으로).
   - Metric `unit` 어휘와 `%` 스케일(0–100 또는 0–1)
   - throughput metric 식별 방법(고정 ID 또는 플래그)
   - Festival rework 설정 전달 방식
   - `RawRow`에 들어올 수 있는 파서 부산물 처리 책임
   - (선택) DatasetMetadata에 generator/seed와 dataset_id 추가
3. **프론트엔드 결함을 수정합니다** (이번 검수에서는 수정하지 않음).

   | 우선순위 | 파일 | 수정 내용 |
   |---|---|---|
   | P0 | `src/state/analysis.tsx` | `scope` memo 의존성을 `view.processKey/dateFrom/dateTo`로 한정 (Q6 zoom 초기화, 불필요한 엔진 재실행 해결) |
   | P0 | `src/state/store.tsx` | `useWorkspace` 빈 workspace를 안정 참조로 반환 (memo로 고정) |
   | P0 | `src/pages/OverviewPage.tsx`, `src/lib/files.ts` | `__parsed_extra`와 누락 키 처리(차단 또는 문자열 정규화를 엔진과 합의), import-wide 오류 동의 문구 |
   | P0 | `src/lib/format.ts`, `src/pages/ModelPage.tsx`, `src/pages/RefinePage.tsx` | 2단계에서 합의한 unit과 비율 스케일 반영. Refine target check가 queue-wait metric에만 적용되도록 제한 |
   | P0 | `src/state/analysis.tsx` | `FindingAnalysis.rework`, `FestivalKPIConfig` 나머지 필드(manifest 기반) 전달 |
   | P1 | `src/components/layout.tsx`, `OverviewPage.tsx`, `RefinePage.tsx`, `adapters/fixtures/uiFixture.ts`, `state/analysis.tsx` | 라벨 기준을 `sourceKind`에서 provider로 변경, fixture 진입점 유지 여부 결정, `providerFor()` 정리 |
   | P1 | `src/state/types.ts`, `src/state/plans.ts`, `src/pages/ImplementationPage.tsx`, `src/pages/ExportPage.tsx` | PlanRecord에 provider 추가, plans CSV에 provider 열 추가, fixture 안내 문구 정정, manifest provenance export |
   | P1 | `src/pages/DesignPage.tsx`, `OverviewPage.tsx` | To-be 참조는 있으나 파일이 없는 상태를 구분 표시. manifest `bpmn_to_be` 키 지원. Festival BPMN 다운로드 링크 |
   | P1 | `src/pages/AnalysisPage.tsx` | F02d resource 필터 |
   | 결정 필요 | `src/state/store.tsx` | target/design 저장 키에 필터 fingerprint를 포함할지(SPEC) 또는 현행 유지 + 레코드 scope 표시. 데이터셋 변경 시 이전 레코드를 archived로 보여줄지 |
4. **실제 엔진으로 재검증합니다:** T01–T09(엔진), T10–T14, T17(UI + 엔진). `journey.mjs`와 `qa.mjs`를 Festival 데이터 기준으로 보강합니다. 대용량(850 케이스) 렌더링 시간도 측정합니다.
5. **Festival 자산을 투입**(D절)하고 Festival 경로를 확인합니다.
6. **Netlify 배포 후 T16**(시크릿 창 공개 URL)을 실행합니다.

### 예상 호환성 문제 요약
1. 비율 0–1과 0–100 불일치로 표시가 100배 어긋나고 target 검증이 오류를 냄.
2. unit 문자열이 `min`과 다르면 adaptive 표시와 Refine target check가 동작하지 않음.
3. 불규칙 CSV 행이 엔진 validate에 비문자열 값으로 전달됨.
4. Festival rework와 technical recheck 설정 미전달로 finding이나 KPI가 누락되거나 다르게 나옴.
5. 엔진 출력의 handoff/start endpoint가 nodes와 resources에 없으면 그래프가 조용히 생략함.
6. 대용량 로그에서 렌더 중 동기 계산 때문에 화면이 멈추고, drawer를 열 때마다 전체를 다시 계산함(6번 결함).
7. localStorage에 남은 fixture workspace(`fixture.*` target, provider가 없는 plan)가 혼란을 줌. 배포 전에 저장 키 버전을 올리거나 해당 항목을 정리해야 함.

## D. Festival 데이터·BPMN 제작 인터페이스 (현재 코드 기준, 정확한 형식)

### D-1. `public/datasets/dataset_manifest.json`
현재 UI가 **읽는** 키(snake_case)는 아래와 같습니다. 그 밖의 키는 무시되지만 보존용으로 넣어도 됩니다.
```json
{
  "dataset_id": "demo-festival-ops-2026-v1",
  "name": "Demo Festival Operations 2026 (synthetic)",
  "source_type": "synthetic",
  "csv": "demo_festival_operations_2026.csv",
  "timezone": "Asia/Seoul",
  "baseline_gate_count": 3,
  "service_activity": "Ticket Verification",
  "bpmn": {
    "stage": "stage_as_is.bpmn",
    "audience": "audience_as_is.bpmn",
    "equipment": "equipment_as_is.bpmn"
  },
  "generator": { "version": "1.0.0", "seed": 20261127 },
  "source_references": ["https://…"],
  "assumptions": ["Gate service times are modeling assumptions, not observed festival data."]
}
```
| 키 | 필수 | 형식과 UI 동작 |
|---|---|---|
| `csv` | **필수** | `public/datasets/` 기준 상대 경로 문자열. 없으면 "Manifest has no csv entry"로 비활성 |
| `name` | 권장 | 데이터셋 표시 이름. 가상 이름이어야 함(실제 페스티벌 이름 금지, DATA_SCHEMA §3) |
| `source_type` | 권장 | `"synthetic"` 또는 `"user_upload"` |
| `baseline_gate_count` | 권장 | 1 이상 정수. Model의 baseline 기본값과 출처 표시에 사용 |
| `service_activity` | 권장 | gate 서비스 활동명. CSV의 activity와 정확히 일치해야 함 |
| `bpmn` | 선택 | 키는 **`process_type` 값과 정확히 일치**(`stage`, `audience`, `equipment`). 값은 `public/bpmn/` 기준 파일명 |
| `timezone`, `assumptions`, `source_references` | 선택 | 메타데이터로 엔진 KPIContext와 export에 전달 |
| `generator.version`, `generator.seed` | 선택 | Overview 카드에 표시됨. **현재 export에는 미포함**(C-3 P1) |
| (미지원) `dataset_id`, 결측 resource 정책, `units`, To-be BPMN | — | 현재 코드는 사용하지 않음. 필요하면 C-3 항목과 함께 키 이름을 합의(제안: `missing_resource_values: string[]`, `bpmn_to_be: { audience: "audience_to_be.bpmn" }`) |

Netlify는 `.json`을 `application/json`으로 제공하므로 Content-Type 검사를 통과합니다.

### D-2. Festival CSV (`public/datasets/<csv>`)
- UTF-8(BOM 허용, 실측 확인), 첫 행은 헤더, 구분자는 쉼표(자동 감지되지만 쉼표 권장). **모든 행의 열 수가 같아야 합니다**(C-3 결함 회피).
- 헤더는 **DATA_SCHEMA의 canonical 이름을 그대로** 사용하세요. UI는 대소문자를 무시하고 이름이 같은 열을 자동 매핑합니다: `event_id, process_type, case_id, activity, timestamp, lifecycle, activity_instance_id, resource, resource_role, festival_id, performance_id, stage_id, gate_id, equipment_request_id, equipment_type, asset_id, scheduled_start, required_ready_at, ticket_type, issue_type, cost`.
- `process_type`: 모든 행에 **소문자 `stage` / `audience` / `equipment`** 중 하나. Festival 로드 시 `requireProcessType=true`입니다. UI의 시뮬레이션과 Design 분기는 정확히 `audience`라는 문자열을 기준으로 합니다.
- `timestamp`, `scheduled_start`, `required_ready_at`: 명시적 offset이 있는 ISO 8601(예: `2026-11-27T14:00:00+09:00`). 고정 offset 옵션은 Festival 로드에서 기본으로 비어 있습니다.
- `lifecycle`: `start`, `complete`, 또는 빈 값(point 이벤트). 반복되는 활동에는 `activity_instance_id`를 채우세요.
- 활동명은 DATA_SCHEMA §2 어휘와 **정확히 일치**해야 합니다. 특히 audience는 `Join Entry Queue`(도착), `Ticket Verification`(start/complete, 서비스), `Entry Complete` / `Entry Rejected`.
- 결측 resource는 빈 값, `NONE`, `NULL`, `0;n/a` 중 하나를 사용합니다(UI 기본 placeholder).
- 연결 키: equipment는 `festival_id` + `performance_id`로 stage와 연결합니다(엔진 규칙).

### D-3. BPMN (`public/bpmn/<file>.bpmn`)
- BPMN 2.0 XML이어야 하고, 루트는 `definitions`(접두어 허용)입니다.
- **`bpmndi:BPMNDiagram`(DI 좌표)를 반드시 포함해야 합니다.** DI가 없으면 bpmn-js가 그리지 못하고 오류가 표시됩니다(Q13에서 확인). bpmn.io나 Camunda Modeler에서 저장하면 DI가 포함됩니다.
- 프로세스별 As-is 1개를 manifest `bpmn`에 등록합니다. **audience To-be**는 현재 manifest로 제공할 수 없으므로, Design 화면의 "Import BPMN XML"로 업로드한 뒤 design record의 To-be reference로 선택해야 합니다. 이 연결은 새로고침 후 다시 import해야 합니다. 자동 로드는 C-3 P1 수정 후에 가능합니다.
- 실험 파일: `reports/evidence/phase-1-frontend/qa/qa-data/with-di.bpmn`(정상 렌더링), `no-di.bpmn`(오류 표시).

## E. 검수 방법과 한계
- 정적 검토: 신규·수정 파일 전체를 명세 문서와 대조하고 `grep`으로 fixture 참조, 개인 경로, 의존성을 확인했습니다.
- 동적 검토: headless Chrome(DevTools Protocol, 외부 패키지 없음)으로 dev server와 production preview에서 각각 journey 19단계와 QA 19개 검사(+INFO 4건)를 실행했습니다. PapaParse 경계 사례는 Node에서 직접 실측했습니다.
- 한계: 엔진 미구현, Festival 자산 부재, 배포 전 상태입니다. 같은 에이전트가 구현과 검수를 모두 했습니다. 접근성과 다국어 로캘, 대용량 성능은 측정하지 않았습니다.
