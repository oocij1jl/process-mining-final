# Phase 1 Frontend 검증 기록

> **정리 (Phase 1.1 이후):** git 업로드 전 정리에서 Phase 1 당시의 1회성 실행 출력(`journey-output.txt`, `qa/*-output*.txt`, `qa/build-output.txt`, `qa/test-output.txt`)과 수정 전 라벨의 스크린샷 8장을 삭제했습니다. 해당 수치는 이 문서 본문에 그대로 기록되어 있습니다. 최신 실행 원문은 `phase-1-frontend/phase-1-1/`에 있습니다.

2026-11-27 KST · 브랜치 `feat/frontend` (worktree `processpilot-frontend`) · 기준 커밋 `12eb710`
작성: Claude Code (Opus 5.5). Commit, push, merge와 배포는 하지 않았습니다(사용자 수행).

## 1. 요약

엔진 계약(`src/contracts.ts`, `src/engine/index.ts`)을 그대로 사용하는 React UI를 구현했습니다. 사이드바 8개 메뉴(Overview & Data, BPM lifecycle 6단계, Evidence Export)로 구성했습니다. 모든 분석값은 `EngineApi` provider를 통해서만 받습니다. Codex 엔진은 아직 Phase 0 스텁이므로 provider가 두 개입니다.

| Provider | 사용 조건 | 동작 |
|---|---|---|
| `realEngine` (`src/engine`) | 사용자 CSV 업로드, Festival 샘플 | 현재 모든 함수가 `EngineNotImplementedError`를 던지고, UI는 함수 이름과 함께 "Engine function not implemented yet" 상태를 표시 |
| `uiFixtureEngine` | "Load UI fixture"를 눌렀을 때만 | 20행 고정 CSV에 대해 손으로 계산한 값을 반환. 다른 입력이나 부분 필터에는 `FixtureUnavailableError`를 던지고 "No UI fixture value" 상태를 표시 |

엔진이 완성되면 `src/state/analysis.tsx`의 `providerFor()`에서 fixture 분기만 제거(또는 fixture 데이터셋도 `realEngine`으로 연결)하면 됩니다. 페이지 코드는 바꿀 필요가 없습니다.

## 2. 구현 기능

### 공통 구조
- **공유 상태** (`src/state/store.tsx`): `useReducer` + Context. `dataset`(불변, raw 행은 메모리에만 보관), `view`(process, 케이스 시작 시각 필터, 선택 케이스, throughput bucket), `workspaces`(key = `datasetId::processKey`), `bpmnDocs`(메모리 전용), toast.
- **Dataset ID**: 내용 + 매핑 + 결측 resource 정책 + offset + 제외 동의 + requireProcessType의 FNV-1a fingerprint. 같은 파일과 설정을 다시 불러오면 저장된 target, design, scenario, plan이 복원됩니다.
- **localStorage**에는 workspace 설정만 저장합니다(`processpilot.workspaces.v1`). raw 로그와 업로드한 BPMN XML은 저장하지 않습니다.
- **파생 분석** (`src/state/analysis.tsx`): validate → groupCases → process 선택 → 첫 이벤트 기준 전체 케이스 필터 → buildDFG, getVariants, getCaseDurations, getPerformance, getResourceAnalysis, getKPIs → getFindings → evaluateTargets. 상류 단계가 실패하면 하류는 `blocked` 상태가 됩니다. `evaluateTargets`는 별도 memo라서 target을 바꾸면 KPI를 다시 계산하지 않고 상태만 즉시 갱신됩니다.
- **Stale 규칙**: 모든 design, scenario, plan은 `AnalysisScope`(datasetId, processKey, filter fingerprint)를 기록합니다. Scenario는 추가로 `paramsRevision`과 provider도 비교합니다. 범위가 바뀌면 stale 또는 read-only로 표시하고, 조용히 재사용하지 않습니다.
- **UI 시스템** (`src/components/ui.tsx`): Card, Stat, Table, Badge, Tabs, Field, Notice(info/warning/error/success/fixture 줄무늬), `EngineGate`(엔진 결과 상태 렌더러), ErrorBoundary(페이지 단위).
- **레이아웃**: 다크 사이드바와 상단 고정 Scope bar(데이터셋과 source 배지, process 선택, 케이스 시작 시각 필터, 선택/전체 케이스 수, 표시 timezone, provider 배지). Hash 라우팅(`#/analysis` 등)을 사용해 새 패키지 없이 링크가 동작합니다.

### 화면별
| 메뉴 | 구현 내용 |
|---|---|
| Overview & Data (F01) | UI fixture 로드, Festival 샘플(`public/datasets/dataset_manifest.json`이 있을 때만 활성), CSV 업로드(드래그앤드롭), 컬럼 매핑(필수/선택 필드, 자동 매핑, 중복 매핑 차단), 결측 resource placeholder 편집, 고정 UTC offset, `requireProcessType`, raw preview. 검증 결과(raw/accepted/excluded/error/warning, issue 표 필터), 치명적 오류 행 제외 명시 동의 체크박스와 철회, process 요약(raw 행과 discovery 이벤트, 빈 케이스 수), trace view(검색, 케이스 drawer), 엔진 함수별 연결 상태 |
| Analysis (F02) | DFG(React Flow + dagre, Start/End, self-loop, 엣지 굵기 ∝ count, dagre waypoint 라우팅, node/edge/count 클릭 → 케이스 목록, 해당 transition의 gap 요약), Variants(정렬, 점유율 차트, 케이스 목록), Performance(inter-event, matched gap, service를 분리 표시하고 n<3이면 low support, ambiguous/overlap 표시, elapsed 분포), Resources(커버리지, handoff network + table + workload 차트와 표, isolated node, 양방향 엣지를 따로 그리고 점선/색으로 구분, handoff가 없을 때 empty state), Findings(근거 표시 후 "Create design record") |
| Design (F03) | Design record 목록과 편집기(제목, change specification, 상태, target KPI, 연결 finding, 영향 activity, As-is/To-be BPMN 참조, simulation-linked는 audience만, 나머지는 proposal only). BPMN XML import와 bpmn-js NavigatedViewer(lazy load, zoom/fit). Manifest BPMN 자동 로드. 발견된 DFG를 비교용 탭으로 제공. BPMN이 없으면 empty state를 띄우고 가짜 BPMN은 만들지 않음 |
| Model (F04) | KPI target 표(측정값, n/eligible, 방향, 단위는 metric 단위로 고정, 유효성 검사, 잘못된 값은 저장 차단, 입력 즉시 반영). 시뮬레이션 파라미터(service activity, observed/assumed 모드, assumed 초, baseline/candidate gate 수, staffing delta, parameter revision). 변경 시 기존 결과는 stale |
| Implementation (F05) | Scenario 기반 또는 proposal-only plan, 편집 가능한 task 표(task, owner, staffing, due date, status, evidence), task 추가/삭제, 진행률, archive, revision 관리, CSV/JSON export. Archived 또는 다른 scope의 plan은 read-only. "실제 배포 아님" 문구 표시 |
| Monitor & Control (F06) | KPI 카드(N/A, met, breached 표시, n/eligible), 알림(breached/unknown), 케이스 drill-down, throughput 차트(`Metric.buckets`, bucket 폭 선택, 막대 클릭 → 케이스), plan 진행 상태를 측정 KPI와 분리 표시. "not live monitoring" 명시 |
| Refine & Improve (F07) | Gate queue scenario: `getGateInputs`로 동일 입력 벡터를 만든 뒤 `simulateGateQueue`를 baseline과 candidate로 두 번 실행. 제외 케이스 표시, revision 기록, stale이면 apply 차단, target check(modeled mean wait를 `evaluateTargets`로 비교), observed log KPI 패널 분리, "Apply to Implementation"(같은 scenario면 기존 plan과 편집 내용 유지, 다른 scenario면 confirm 후 기존 plan archive). 근거 기반 recommendations와 proposal-only plan 생성 |
| Evidence Export (F08) | 전체 evidence JSON(provenance, mapping, filter, validation, metric family 정의, 모든 엔진 결과 또는 실패 상태, target, design, scenario, plan). CSV 9종(KPI+target, DFG edges, variants, performance, resources, handoffs, findings, issues, plans)의 모든 행에 dataset_id, process, filter, provider 포함. UI fixture CSV와 로드된 BPMN 다운로드 |

### 핵심 요구사항 대응
| 요구사항 | 구현 위치 | 확인 |
|---|---|---|
| Model target 변경이 Monitor에 즉시 반영 | `SET_TARGET` → `evaluations` memo | 브라우저 검증 10–11 (breached → met, 측정값 3 s 유지) |
| Refine에서 선택한 scenario가 Implementation의 편집 가능한 plan으로 연결 | `planFromScenario`, `ADD_PLAN` | 검증 12–13 (+1 gate / +1 worker, owner 편집) |
| Design에서 선택한 개선안이 이후 과정에 연결 | `activeDesignId` → Refine 연결 design, scenario.designId → plan.designId, target KPI → target check | 검증 9, 12 |
| 데이터셋/필터 변경 시 관련 화면 갱신 | 모든 페이지가 `useAnalysis()` 공유, scope stale 표시 | 검증 16–17 |
| DFG/Resource Network 확대·축소·이동, 클릭, 케이스 조회 | `FlowGraph` 공용 컴포넌트 + `CaseKeyList` + `CaseDrawer` | 검증 4–8 |
| 데이터 없음 또는 엔진 미구현 시 상태 표시 | `RequireData`, `EngineGate`, `EmptyState` | 검증 1, 19 |

## 3. 변경 파일

수정: `src/App.tsx`, `src/styles/index.css`

신규:
- `src/adapters/engineAdapter.ts`: EngineApi, EngineResult, callEngine/chain, realEngine
- `src/adapters/fixtures/uiFixture.ts`: **UI fixture (hand-authored, not engine output)**
- `src/state/types.ts`, `src/state/store.tsx`, `src/state/analysis.tsx`, `src/state/plans.ts`
- `src/lib/format.ts`, `src/lib/files.ts`
- `src/components/ui.tsx`, `layout.tsx`, `cases.tsx`, `BpmnViewer.tsx`, `graph/FlowGraph.tsx`
- `src/pages/OverviewPage.tsx`, `AnalysisPage.tsx`, `DesignPage.tsx`, `ModelPage.tsx`, `ImplementationPage.tsx`, `MonitorPage.tsx`, `RefinePage.tsx`, `ExportPage.tsx`
- `reports/evidence/phase-1-frontend.md` (이 문서), `reports/evidence/phase-1-frontend/`(브라우저 검증 스크립트, 출력, 스크린샷 8장)

수정하지 않은 파일: `src/contracts.ts`, `src/engine/*`, `tests/*`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `docs/AI_USAGE_LOG.md`

**공통 패키지/설정 변경: 없음.** 기존 의존성(@xyflow/react, @dagrejs/dagre, recharts, bpmn-js, papaparse, tailwind)만 사용했습니다.

## 4. 테스트 결과 (실제 실행)

### `npm run build` (tsc --noEmit + vite build)
```text
dist/index.html                          0.39 kB │ gzip:   0.26 kB
dist/assets/bpmn-Cyvp-fAH.eot           48.80 kB
dist/assets/bpmn-0HrGCizt.svg          136.01 kB │ gzip:  25.97 kB
dist/assets/index-cpkWz1tY.css          49.38 kB │ gzip:   9.30 kB
dist/assets/BpmnViewer-CF1x61c8.css    118.55 kB │ gzip:  51.22 kB
dist/assets/BpmnViewer-BIT_5zOb.js     197.65 kB │ gzip:  56.69 kB
dist/assets/index-KePGxbHw.js        1,039.93 kB │ gzip: 308.39 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 511ms
```
타입 오류는 없습니다. 메인 chunk가 500 kB를 넘는다는 경고가 남아 있습니다(React Flow + Recharts). BPMN viewer는 이미 lazy chunk로 분리했고, 나머지 분리는 P1로 둡니다.

### `npm test`
```text
Test Files  1 passed (1)
     Tests  13 passed (13)
```
Phase 0 테스트(Codex 소유)만 있습니다. 프론트엔드 단위 테스트는 jsdom이나 Testing Library가 설치되어 있지 않아 추가하지 않았습니다(패키지 변경은 lead 승인 필요).

### 브라우저 통합 검증 (headless Chrome + DevTools Protocol)
Claude in Chrome 확장이 이 세션에 연결되어 있지 않았습니다. 그래서 의존성 없는 CDP 스크립트(`reports/evidence/phase-1-frontend/cdp.mjs`, `journey.mjs`)로 로컬 dev server(`http://127.0.0.1:5174`)를 새 프로필에서 실제로 조작했습니다. 출력 원문은 `journey-output.txt`에 있습니다.

```text
PASS  Empty state without dataset
PASS  Fixture loads; validation counts
PASS  Fixture warning issue shown
PASS  DFG renders default process (3 act + start/end, 4 edges + 1 start + 1 end) — nodes=5 edges=6
PASS  Node click shows contributing cases
PASS  Handoff network has R1→R2 and R2→R1 as separate edges — edges=2
PASS  Handoff edge click lists 1 case
PASS  Audience: no-handoff empty state with isolated node
PASS  Design record created and editor shown
PASS  Monitor shows breach after target 0.01 min
PASS  Monitor shows met after target 1 min; measured unchanged
PASS  Scenario computed (1 gate mean 3 s → 2 gates 0.7 s)
PASS  Plan created with +1 gate / +1 worker
PASS  Stale after candidate change; apply disabled
PASS  New revision plan; old archived
PASS  Subset filter shows explicit fixture-unavailable state
PASS  Plan read-only under different filter
PASS  Upload opens mapping editor with auto-mapping
PASS  Real engine stub → explicit not-implemented state
--- console/log ---
dialog: Create a new plan revision from scenario rev 2? 1 current plan will be archived (kept for export, not deleted).
```
콘솔 error, warning과 uncaught exception은 0건입니다. dialog는 의도한 confirm이며 스크립트가 수락했습니다.

**중요:** 위 검증은 **UI fixture 값**을 사용한 UI 동작 검증입니다. 엔진 계산 정확성 검증이 아닙니다. TEST_PLAN과의 관계는 다음과 같습니다.
- T10(target 변경 → 상태 변화, 측정값 불변): UI 경로 통과(fixture 값).
- T11, T12(scenario 적용, stale, revision): UI 경로 통과(fixture의 1→2, 1→3 gate. 문서 예시인 3→4는 fixture 범위상 결과가 같아서 1→2로 검증).
- T17(handoff graph와 table 일치, 양방향 분리, 엣지 클릭 케이스): fixture의 R1→R2 / R2→R1에 대해 통과. 실제 엔진 결과로 재검증 필요.
- T13, T14, T16: 엔진 미구현 상태라 **미검증**. 업로드 경로가 not-implemented 상태를 정직하게 표시하는 것까지만 확인했습니다.

재실행 방법: `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`를 켠 상태에서 `node reports/evidence/phase-1-frontend/journey.mjs`를 실행합니다. 스크립트 옆에 `shots/`와 `profile/`이 생성되며 커밋 대상이 아닙니다. macOS Chrome 경로를 가정합니다.

## 5. 엔진 연결 시 필요 사항 (Codex / 통합 담당)

1. **Provider 전환**: `src/state/analysis.tsx`의 `providerFor()`. 최종 통합 시 fixture 버튼을 숨기거나 "UI fixture" 라벨을 유지한 채 남길지 결정이 필요합니다.
2. **Metric ID**: fixture는 `fixture.*` placeholder ID를 씁니다. UI는 `getKPIs`가 돌려주는 ID와 unit을 그대로 사용하므로 별도 매핑 코드는 필요 없습니다. 다만 다음 사항을 엔진과 맞춰야 합니다.
   - unit 문자열 관례: `min`, `%`, `entries/<n> min` 등. 표시와 target 검증이 `min`과 `%`를 특별 취급합니다.
   - `%` 값의 범위: 0–100인지 0–1인지. UI는 0–100으로 가정합니다.
   - throughput metric은 `buckets`가 있는 첫 metric을 차트에 사용합니다.
3. **Refine target check**: design의 target KPI가 `min` 단위일 때 modeled mean wait를 `Metric` 형태로 감싸 `evaluateTargets`에 넘깁니다. 엔진 규칙이 바뀌면 함께 확인해야 합니다.
4. **Festival manifest** (business/data track): `public/datasets/dataset_manifest.json` 예상 필드는 `name`, `csv`(같은 폴더의 파일명, 필수), `source_type`, `timezone`, `assumptions[]`, `source_references[]`, `baseline_gate_count`, `service_activity`, `bpmn: { stage|audience|equipment: "<file>.bpmn" }`(`public/bpmn/` 기준), `generator: { version, seed }`. Festival 로드 시 `requireProcessType=true`이고, `KPIContext.festival`을 `equipmentDeadline: 'required_ready_at'`와 stage/equipment linked traces로 활성화합니다.
5. **결측 placeholder 표시**: 계약의 `'0;n/a'`는 하나의 문자열입니다. UI 편집 필드가 쉼표로 구분하므로 `0;n/a`는 한 값으로 유지됩니다. 쉼표가 들어간 placeholder는 입력할 수 없다는 제약이 있습니다.
6. **엔진 테스트 후 UI 재검증 항목**: T13(다른 CSV 업로드 → 전체 갱신, export 수치 일치), T14(generic 로그의 N/A 처리), T17(실제 handoff), 대용량(600–850 케이스) 렌더링 성능.

## 6. 미완료 및 제한 사항

- 엔진 미구현으로 실제 CSV 분석 결과는 확인하지 못했습니다(UI 경로만 확인).
- Festival 샘플, BPMN 자산, manifest가 없어서 해당 로드와 자동 BPMN 표시 경로는 실행되지 않았습니다. 코드 경로만 있고 미검증입니다.
- P1 미구현: DFG/handoff 최소 edge count 표시 필터, 그래프 SVG/PNG export, outlier, XES 변환. UI에 해당 버튼은 두지 않았습니다(죽은 버튼 없음).
- Stage와 Equipment 전용 KPI 화면 구성은 엔진 `getKPIs` 결과를 그대로 표시하는 수준입니다. Festival 전용 overview 비교 대시보드(프로세스 간 KPI 나란히 보기)는 미구현입니다.
- 대용량 렌더링: trace와 issue 표는 페이지 단위 "Show more"로 처리했습니다. 수백 개 노드의 DFG 성능은 미검증입니다.
- `datetime-local` 입력의 placeholder는 브라우저 로캘을 따릅니다(검증 환경에서는 한국어 표시). 앱 문구는 영어입니다.
- Workspace JSON import는 요구사항상 필요 없어서 미구현입니다.
- 프론트엔드 자동화 테스트(vitest 컴포넌트 테스트)는 미작성입니다(의존성 추가 필요).
- 메인 번들이 1.04 MB로 경고가 있습니다.

## 7. AI 활용 내역

- 도구: Claude Code (Claude Opus 5.5), 사용자 지시 프롬프트 1건(Phase 1 프론트엔드 개발 지시, 2026-11-27).
- AI가 수행한 작업: docs, contracts, engine 시그니처, Phase 0 evidence 판독. 위 3장의 신규와 수정 파일 전체 작성. 빌드와 테스트 실행. Headless Chrome 검증 스크립트 작성과 실행. 스크린샷 검토 후 수정.
- 검증 중 발견해 수정한 문제:
  1. `@dagrejs/dagre` ESM 빌드가 default export만 제공해서 named import가 undefined가 됨 → default import로 변경.
  2. 단일 노드 그래프가 과도하게 확대됨 → `fitView maxZoom 1.1`.
  3. 굵은 엣지의 화살표가 비대해짐 → `markerUnits: userSpaceOnUse`.
  4. A→C 엣지가 B 노드를 관통함 → dagre waypoint 경로 사용.
  5. Implementation 표가 그리드를 넘침 → Card에 `min-w-0`.
  6. 상태 select 폭이 너무 좁음.
  7. Target 입력에서 "5." 같은 부분 입력이 store 재동기화로 지워짐 → 값이 다를 때만 재동기화.
  8. Toast가 순차적으로만 사라짐.
  9. 테스트 스크립트 측 가정 오류 3건(기본 선택 process가 알파벳 순으로 audience인 점, input 값이 innerText에 없는 점, 로컬 timezone 필터 시각)은 앱 문제가 아니어서 스크립트를 수정.
- 사람의 검토가 필요한 부분: fixture 손계산 값(특히 audience inter-event gap과 matched gap 생략 결정), plan task 템플릿 문구, 디자인 판단.
- `docs/AI_USAGE_LOG.md`는 지시에 따라 수정하지 않았습니다. 이 절을 병합 시 로그 원본으로 사용하면 됩니다.
