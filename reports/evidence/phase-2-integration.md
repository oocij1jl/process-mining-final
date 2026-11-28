# Phase 2 — Engine & Frontend Integration 증거

- 일시: 2026-11-27 KST · 브랜치 `feat/integration` · 기준 병합 커밋 `4ccd8ba` (engine `a88c5fa`, frontend `dfa880d`, Phase 0 `12eb710`)
- 환경: Node.js v24.15.0, macOS, headless Chrome (CDP, 실행마다 새 프로필, 뷰어 시간대 `Asia/Seoul`로 고정)
- 작업자: Claude Code (Claude Opus 5.5). commit, push, merge, rebase, reset, 배포는 하지 않았습니다. `feat/engine`, `feat/frontend`, `main` 브랜치는 건드리지 않았습니다.
- 변경하지 않은 파일: `src/contracts.ts`, `src/engine/*`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `netlify.toml`, `.github/*`, `.gitignore`, `docs/*`(`docs/AI_USAGE_LOG.md` 포함), 기존 엔진 테스트(`tests/*.test.ts`, `tests/engine-fixtures.ts`), 기존 fixture CSV.
- 실행 원문: [`phase-2-integration/runs/`](phase-2-integration/runs/) · 브라우저 통합 스크립트: [`phase-2-integration/integration-2.mjs`](phase-2-integration/integration-2.mjs) · 통합 단위 테스트: [`tests/integration/phase-2-integration.test.ts`](../../tests/integration/phase-2-integration.test.ts) · 통합 fixture: [`tests/fixtures/integration/`](../../tests/fixtures/integration/README.md)

## 0. 판정 요약

**GO — 통합 기준 버전(내일 추가 개발 착수 기준).** 모든 데이터 경로(UI fixture CSV, 사용자 업로드, Festival 샘플)가 실제 엔진(`src/engine`)만 사용합니다. 아래 검증은 모두 실제 엔진 결과를 손계산 기대값과 비교한 것입니다.

- `npm test`: 9 files, **96/96 PASS** (기존 79 + 신규 통합 17)
- `npm run build`: 성공, 타입 오류 0
- 브라우저 4개 스위트, dev server와 production `vite preview` 양쪽: journey **19/19**, qa **18/18**, regression-1-1 **31/31**, integration-2 **135/135**

통합 중 UI 결함 2건(Monitor 위반 근거 연결 오류, 내부 리소스 키 노출)과 문구·Export 불일치 5건을 수정했습니다. 엔진 계산에서 손계산과 다른 값은 나오지 않았습니다.

**NO-GO — 릴리스 기준.** 최종 Festival 데이터, manifest, BPMN 자산이 없고 공개 배포(T16) 전입니다(9절).

## 1. 작업 시작 시 Git 상태와 병합 직후 테스트

| 항목 | 확인 결과 |
| --- | --- |
| 브랜치 / 작업 트리 | `feat/integration`, `nothing to commit, working tree clean` |
| HEAD | `4ccd8ba Merge branch 'feat/frontend' into feat/integration` |
| 로컬 브랜치 | `feat/engine`, `feat/frontend`, `feat/integration`, `main` (원격 동일 이름) |
| 병합 직후 `npm test` (작업 전 재실행) | 8 files, 79/79 PASS (사용자 보고값과 일치) |
| 병합 직후 build (사용자 보고) | 성공, 메인 번들 1,090.36 kB (gzip 323.68 kB). 현재 1,091.93 kB (gzip 324.35 kB). 500 kB 경고는 기존과 같음 |

읽은 문서: `docs/`의 START_HERE, REQUIREMENTS, SPEC, FUNCTIONAL_SPEC, DATA_SCHEMA, ENGINE_CONTRACT, TEST_PLAN, AGENT_HANDOFF, KGU_TOOL_ANALYSIS, AI_USAGE_LOG. `reports/evidence/`의 phase-1-engine, -engine-review, -engine-fix, phase-1-frontend, -frontend-review, -frontend-fix.

### 문서와 코드의 차이 (임의 판단 없이 기록)

| # | 문서 | 실제 코드 | 처리 |
| --- | --- | --- | --- |
| D1 | ENGINE_CONTRACT 첫 문단: 모든 엔진 함수가 `EngineNotImplementedError`를 던짐 | Phase 1 이후 12개 함수 모두 구현됨 | 문서가 Phase 0 상태로 남음. 수정하지 않음(Codex 소유) |
| D2 | TEST_PLAN: 증거를 `docs/evidence`에 저장 | 저장소 관례는 `reports/evidence` | 기존 관례를 따름 |
| D3 | FUNCTIONAL_SPEC F02a: node/edge 클릭 시 기여 케이스 | `DFG.starts/ends`는 건수만 있어 Start/End 엣지는 케이스 조회 불가 | UI에 안내 문구가 있음. 계약 보완 제안(feature-gap §7) |
| D4 | FUNCTIONAL_SPEC F06: historical throughput | 엔진 처리량은 Festival audience KPI(`audience_throughput`)뿐. 일반 프로세스는 처리량 없음 | 일반 로그는 "No throughput series" 빈 상태로 표시(A44). 확장은 오늘 범위 밖 |
| D5 | FUNCTIONAL_SPEC F02c: optionally median/p95 | `GapSummary`는 평균만 제공 | P1 추가 통계로 분류 |
| D6 | 계약의 `Finding`에 규칙 종류 필드 없음 | 엔진 Finding ID가 `[dataset, process, filter, rule, metricId, edge]` JSON | UI가 ID를 해석해 목표 위반 Finding을 찾음(`src/lib/evidence.ts`). 계약 보완 제안 |
| D7 | 엔진 fix 보고서: Festival 시간 순서 검증은 `requireProcessType: true` + `mapping.festival_id`로 활성화 | UI의 Festival 체크박스와 별개 옵션 | 매핑 화면에 조건 안내를 추가(3.3절). 명시적 플래그를 제안 |
| D8 | ENGINE_CONTRACT: `max`는 측정값 ≤ 목표 | 엔진은 상대 오차 `Number.EPSILON × max(|a|,|b|)` 안을 등호로 취급(QA-01 정책) | 일치. UI에서 등호 사례 met 확인(A45, D10) |
| D9 | SPEC: Festival linked traces 범위 미정 | UI는 stage/equipment 연결에 필터 없는 전체 데이터셋 traces를 전달 | Phase 1.1에서 기록된 그대로 유지. Festival 데이터로 확인 필요 |

## 2. 실제 엔진 연결 결과

### 2.1 Provider 전환

- `src/state/scope.ts`: `FIXTURE_DATASET_PROVIDER = 'engine'`. `providerFor()`가 모든 source에 `'engine'`을 반환합니다. UI fixture CSV도 `realEngine`으로 분석합니다.
- `uiFixtureEngine`(손계산 provider)은 파일과 import를 개발용으로 보존했습니다. 실제 사용자 분석 경로에서는 선택되지 않습니다(`analysis.tsx`는 provider가 `ui_fixture`일 때만 사용하고, 이제 그런 dataset은 생기지 않음).
- Source와 Provider 표시는 분리되어 있습니다. UI fixture를 불러오면 "UI fixture CSV" 배지와 "Provider: engine"이 따로 표시됩니다(R-PROV, Q12).
- Workspace 키는 `dataset + provider + process + filter`입니다. 전환 전에 `ui_fixture` provider로 저장된 기록은 같은 데이터셋이라도 키가 달라서 현재 엔진 기록에 섞이지 않습니다. Workspace history에 "other provider (ui_fixture)"로만 표시됩니다. 브라우저에서 fixture 시대 workspace를 localStorage에 넣고 새로고침해 확인했습니다(F01–F03).
- Legacy v1 기록의 read-only 처리와 Archive 정책은 변경하지 않았습니다(R-LEGACY 통과).

### 2.2 인터페이스 호환성 검증

| 항목 | 엔진 | UI | 결과 / 근거 |
| --- | --- | --- | --- |
| KPI 비율 0–100 | `caseMetric` rate: `sum*100/n` | `fmtValue` `%`는 변환 없이 표시, 목표 0–100 검증 | 88.9%, 11.1%, 50%(D02, C10) |
| Variant share 0–1 | `count/discovered` | `fmtShare` ×100 표시, Export에 `share_scale: fraction 0-1` | 66.7%/33.3% 화면, CSV 2/3(A20, A64) |
| 일반 시간 지표 min | 모든 duration 분 | `fmtMinutes` 적응형(s/min/h) | 26.25 s → "26.3 s", 9 → "9 min" |
| 서비스 입력 sec | `GateInput.serviceSec` | 가정 모드 입력은 초 | 관측 60 s, 0.1/0.2/0.05 s(단위 테스트) |
| Timestamp UTC ms | `timestampMs` | 뷰어 시간대로 표시, 원본 문자열 보존 | `+09:00`과 `Z`의 동률 처리(C01–C04), 원본 미리보기 유지(A06) |
| Throughput cases/bucket | `audience_throughput` | ID로 식별, 실제 시간축 | 60분 8, 15분 [8,0,0] 평균 2.67(D03–D05) |
| Simulation cases/hour | `throughputPerHour` | "/h" 표시 | 151.6 /h → 192 /h(D33) |
| N/A와 실제 0 | `value: null` + `reason`, 관측 0은 숫자 | N/A 문구, 0은 0으로 표시 | utilization N/A(A43, C11, C13), 수동확인 0%(D02), 처리량 0 버킷(D05) |
| KPI ID 일치 | phase-1-engine 보고서 ID 목록 | UI는 ID를 하드코딩하지 않음. Festival 상수 2개(`audience_queue_wait_mean`, `audience_throughput`)는 엔진 ID와 같음 | 단위 테스트 ID 목록 일치 |
| Resource 식별·표시 | `@resource:[...]` 키(QA-02) | 키는 그대로, 표시만 `resourceLabel`/`displayResourceKeys` | "Local Crew · F1/F2", Export는 원본 키(C14–C16) |
| Case Key·원본 행 번호 | JSON `[process, caseId]`, `sourceOrder` | `caseLabel`, `rowMap`으로 원본 행 표시 | R-CSV 원본 번호 0,3 유지 |
| 열 개수 오류 제외 동의 | 엔진은 완전한 문자열 행만 받음 | 동의 없이는 로드 불가 | R-CSV, Q10 통과 |
| 엔진 제외 동의(`canAnalyze`) | 오류 행이 있으면 동의 전 false | 동의 체크 전 분석 차단 | T05, T08(C01, C09) |
| Festival opt-in | `KPIContext.festival` 있을 때만 Festival KPI. 시간 순서 경고는 별도 조건 | 업로드 기본 OFF, 명시적 체크 | A02, A42, R-GEN, E03–E06 |
| FestivalKPIConfig·rework | 5개 필드, stage/equipment rework | `festivalKpiConfig`, `festivalRework`(Festival ON일 때만) | adapter 단위 테스트. Stage/Equipment 실데이터는 없음 |
| 분석 범위 fingerprint | Finding ID에 범위 포함 | 필터 변경 시 다른 workspace | D44–D45, R-SCOPE |

#### Codex 수정 보고서의 주의사항 4건

1. **원본 Metric 객체를 getFindings에 전달.** `src/state/analysis.tsx`의 findings memo는 `kpis.data`를 복제나 직렬화 없이 그대로 넘깁니다. 엔진은 최소 목표의 문제 사례를 `WeakMap<Metric, CaseKey[]>`에 보관하므로 객체 동일성이 필요합니다. 통합 단위 테스트에서 원본을 넘기면 위반 근거가 `ENT009`이고, `structuredClone` 사본을 넘기면 완료 케이스 8건으로 바뀌는 것을 확인했습니다. 통합 중에 **다른 곳에서 결함**을 찾았습니다. Monitor의 위반 알림은 Finding을 쓰지 않고 `Metric.caseKeys`(분자 케이스)를 직접 열었습니다. 수정 내용은 3.1절에 있습니다.
2. **Resource 키 유지, 표시만 변환.** 그래프·표·Inspector는 이미 `resourceLabel`을 사용했습니다. 엔진 Finding 문장(`f.text`)에는 키가 그대로 들어가 화면에 노출되었습니다. 표시 단계에서만 변환하도록 수정했습니다(3.1절). 저장·Export 문장과 키는 원본을 유지합니다(C16).
3. **처리량 0의 의미.** Monitor 처리량 카드에 "0 = 이 로그의 해당 구간에 기록된 완료 0건이며 운영 전체 측정값이 아님, 구간 밖은 관측 안 됨"을 표시하도록 문구를 고쳤습니다. 이전 문구 "빈 버킷은 0이 아닌 공백"은 엔진 QA-03 정책(관측 구간의 dense 버킷)과 맞지 않았습니다(D04).
4. **Festival 시간 순서 검증은 명시적 활성화 시에만.** Festival OFF이면 같은 `audience` 로그에도 경고가 없습니다. Festival ON + `Require process_type` + `festival_id` 매핑이면 원본 행 0–2에 `audience_event_before_arrival`이 생기고 대기·결과 KPI에서 제외됩니다(E03–E06, 단위 테스트).

## 3. 수정 파일과 이유

### 3.1 제품 코드

| 파일 | 수정 | 이유 / 검증 |
| --- | --- | --- |
| `src/state/scope.ts` | `FIXTURE_DATASET_PROVIDER = 'engine'` | 통합 스위치(3.1 지시) |
| `src/pages/MonitorPage.tsx`, `src/lib/evidence.ts`(신규) | 위반 알림의 "Inspect … cases"가 엔진의 target-breach Finding `caseKeys`를 사용하도록 변경. Finding이 없을 때만 KPI 케이스로 대체하고 라벨을 구분. 처리량 캡션 정정 | **결함 UI-1:** 최소 비율 목표 위반에서 분자(성공) 케이스를 문제 사례로 보여 줌. 예: 완료율 ≥ 95% 위반 시 완료 8건을 표시하고 `ENT009`는 빠짐. 수정 후 1건 `ENT009`(D12–D14). Finding에 규칙 필드가 없어 ID를 해석함(D6) |
| `src/lib/format.ts` | `displayResourceKeys()` 추가 | **결함 UI-2:** Finding 문장에 `@resource:["festival","F1","Local Crew"]` 노출 |
| `src/pages/AnalysisPage.tsx`, `RefinePage.tsx`, `DesignPage.tsx` | Finding 문장을 표시할 때만 변환. 리소스 표시 필터 부제 정정 | UI-2(C15). 필터 부제가 "표에도 상대 리소스 표시"라고 했지만 workload 표는 선택 리소스만 보여 줌. 동작은 Phase 1.1 테스트대로 유지하고 문구를 고침(A38) |
| `src/pages/OverviewPage.tsx` | UI fixture 카드 문구 정정("엔진 통합 전 손계산 값" → 엔진이 분석하는 소규모 테스트 데이터). Festival ON일 때 시간 순서 경고 조건 안내 | 사실과 다른 문구. D7 |
| `src/pages/ExportPage.tsx` | 성능·variant·리소스·KPI CSV에 `case_keys`, findings CSV에 `eligible`, 모든 분석 CSV 끝에 `case_start_from/to`, `selected_cases`, variant `share_scale` 추가. 앱 버전 문자열 갱신 | 4.5 Export 요구(근거·필터·단위). 기존 선두 열 순서는 유지해 기존 검사와 호환 |

### 3.2 테스트·검증 도구

| 파일 | 변경 | 이유 |
| --- | --- | --- |
| `tests/integration/phase-2-integration.test.ts`(신규) | 통합 회귀 17개. UI 경로(`parseCsv → engineRows → importOptionsFor`) → 엔진 | 손계산 기대값만 사용 |
| `tests/fixtures/integration/*`(신규 13개 + README) | 명확히 표시된 소규모 테스트 로그(audience 게이트 로그 `festival_id=TEST-ONLY`) | 최종 Festival 데이터나 관측 데이터가 아님 |
| `src/state/scope.test.ts` | 기존 테스트 1개의 기대값 갱신 | 전환 전 값(`ui_fixture`)을 전제로 한 테스트. "fixture provider 기록과 engine 기록이 workspace를 공유하지 않음"이라는 의도는 provider별 키 비교로 유지하고, 스위치가 `engine`인지 확인하는 단언을 추가. 검증 범위는 줄이지 않음 |
| `reports/evidence/phase-1-frontend/journey.mjs` | fixture 전용 기대값 3개 교체 | `fixture.tied_timestamp` → 엔진 `timestamp_tie`. "No UI fixture value" → 필터 후 2 of 3 케이스와 Join=2. "not implemented" → 업로드 CSV 엔진 분석 |
| `.../qa/qa.mjs` | Q12, Q7 기대값 교체 | provider 라벨 `engine`. 설계 제목을 fixture 문구 대신 새로고침 전에 저장된 엔진 Finding 제목과 비교 |
| `.../regression-1-1.mjs` | R-PROV 5개 교체 | fixture provider 라벨 → engine 라벨 |
| `.../cdp.mjs` | 시간대 고정(`Asia/Seoul`, `PP_TZ`), `drag()`, `send` 노출 | 날짜 필터 기대값의 재현성, pan 검증 |
| `reports/evidence/phase-2-integration/integration-2.mjs`(신규) | 135개 브라우저 통합 검사 | 4–5절 |

## 4. 실제 CSV 분석 결과와 수작업 기대값 비교

### 4.1 Order Processing (`tests/fixtures/order-processing-event-log.csv`, 일반 로그)

CSV 11행을 직접 읽어 계산했습니다. 열 이름이 비표준(`order, step, occurred_at, owner, state, instance`)이라 자동 매핑이 안 되므로, 필수 필드를 매핑하기 전에는 로드가 차단되는지 함께 확인했습니다(A01).

| 지표 | 수작업 계산 | Codex 보고서 | 화면(엔진) | Export |
| --- | --- | --- | --- | --- |
| 정규화 | 11행 모두 유효, 이슈 0, 케이스 3 | 케이스 3건 | Raw 11 / Accepted 11 / 0 / 0 / 0 (A03) | `validation` 동일, issues CSV 0행 |
| 케이스 경과 | 001: 09:00→09:10 = 10, 002: 09:02→09:17 = 15, 003: 09:16→09:18 = 2 → 평균 9 | 평균 9분 | trace 10/15/2 min, KPI 9 min (A05, A43) | KPI CSV 9 min |
| 활동 빈도 | OR 3, PA 2, PB 2, OS 2, OC 1 | — | 동일 (A11) | JSON 동일 |
| 전이 | OR→PA 2, PA→PB 2, PB→OS 2, OR→OC 1, self-loop 0 | — | 동일, 라벨 3·2·2·2·1·2·1 (A12–A13) | DFG CSV 4행 (A63) |
| Start/End | Start OR 3, End OS 2 · OC 1 | — | 동일 | JSON 동일 |
| Variant | [OR,PA,PB,OS] 2건 2/3 평균 12.5분, [OR,OC] 1건 1/3 평균 2분 | 2/3·1/3 | 66.7% 12.5 min, 33.3% 2 min (A20) | share 0.6667, 0.3333 (A64) |
| Inter-event | OR→PA (3+3)/2=3, PA→PB (4+4)/2=4, PB→OS (3+8)/2=5.5, OR→OC 2 | 포장→출하 5.5분 | 동일, 모두 low support (A23) | 성능 CSV 5행 |
| Matched gap | 없음. PA의 시작 직전 이벤트 OR은 point(완료 아님) | — | "N/A, not zero" 빈 상태 (A24) | 해당 행 없음 |
| 서비스 | PA 09:01→09:03 = 2분, n=1 | 지불 서비스 2분 | 2 min, n=1 (A25) | service 행 2 |
| Workload | Customer 3/3/3, Billing 3/2/2 (활동 2분), Warehouse 2/2/2, Carrier 2/2/2, Support 1/1/1. 커버리지 11/11, 10/10 | — | 동일 (A30, A33, A36) | 리소스 CSV 5행 |
| Handoff | Customer→Billing 2, Billing→Warehouse 2, Warehouse→Carrier 2, Customer→Support 1 (합계 7, 양방향 없음) | 담당자 인계 | 그래프 = 표 (A31–A35) | 인계 CSV 4행, 합계 7 |
| KPI | `case_elapsed_mean` 9, utilization/out-of-shift N/A (교대 없음) | 공통 KPI 3개 | 동일, 사유 표시 | KPI CSV |
| Findings | PB→OS 5.5분(n=2, low), Customer 인스턴스 3개(10/10). self-loop 없어 rework 없음 | 타깃과 Findings | 동일 (A40–A41) | Findings CSV |
| 목표 | max 9 → met(등호), max 8 → breached, 근거 3케이스 | 최대 8 위반 | met → breached, 측정값 9 유지, "Inspect 3 evidence cases" (A45–A49) | KPI CSV `breached` |

Codex 보고서의 숫자는 모두 수작업 계산과 일치했습니다.

### 4.2 Audience 게이트 테스트 로그 (`tests/fixtures/integration/audience-gate-test-log.csv`)

명확히 표시된 소규모 테스트 데이터입니다(입장 8건과 거절 1건, 60초 검표). 최종 Festival 데이터나 관측 데이터가 아닙니다. 기존 UI fixture는 입장 3건뿐이라서 3→4 게이트 비교의 차이를 보여 줄 수 없어 별도로 만들었습니다. 손계산 근거는 fixture README에 있습니다.

| 지표 | 수작업 계산 | 화면(엔진) |
| --- | --- | --- |
| 가져오기 | 34행, 동률 경고 3건(행 1, 5, 9), 시간 순서 경고 0 | 동일 (D01) |
| 관측 대기 | (0·3 + 30·3 + 60·2)/8 = 26.25 s | 26.3 s, n = 8 of 9 (D02) |
| 입장 경과 | 91.25 s | 1.52 min |
| 결과 | 완료 8 / 88.9%, 거절 1 / 11.1%, 수동 0% | 동일 |
| 처리량 | 60분 버킷 8. 15분 버킷 10:00/10:15/10:30 = 8/0/0, 평균 8/3 | 8, 2.67, buckets [8,0,0] (D03–D05) |
| 게이트 벡터 | 관측 60 s × 8, ENT009 제외(검표 없음) | "8 entrants simulated of 9 eligible cases. 1 excluded." (D31–D32) |
| 3 게이트 | 대기 0,0,0,30,30,30,60,60 → 평균 26.25 s, p95 = max 60 s, 종료 190 s, 151.6 /h | 26.3 s / 1 min / 1 min / 3.17 min / 151.6 /h (D33) |
| 4 게이트 | 0,0,0,0,20,20,20,20 → 10 s, 20 s, 20 s, 150 s, 192 /h | 동일 |
| 5 게이트 | 0,0,0,0,0,10,10,10 → 3.75 s, max 10 s, 종료 140 s | 3.8 s, 10 s, 2.33 min (D39) |
| 관측 대 모델 | 로그가 3 게이트 FCFS로 작성되어 모델 3 게이트 평균 = 관측 26.25 s | Observed KPI 패널에서 따로 표시 (D35) |

### 4.3 TEST_PLAN 입력과 결함 사례

T01, T02, T04, T09, T03/T17, T05–T08, T10, T15, QA-02, QA-05, QA-06, QA-07의 입력과 손계산 결과는 [`tests/fixtures/integration/README.md`](../../tests/fixtures/integration/README.md)에 있습니다. 모두 화면 값이 일치했습니다(6절).

**수기 계산 정정 1건:** D44(케이스 필터 ≥ 10:00:15Z)의 첫 기대값을 "6 of 9"로 잘못 적었습니다. 첫 이벤트가 그 이전인 케이스는 ENT001(10:00:00)과 ENT002(10:00:10) 두 건뿐이므로 정답은 7 of 9입니다. 행을 다시 읽어 7로 고쳤고, 엔진 출력값을 옮겨 적은 것이 아닙니다.

## 5. BPM Lifecycle 단계별 통합 검증 (실제 엔진)

| 단계 | 검증 내용 | 결과 |
| --- | --- | --- |
| **Analysis** | 실제 DFG·variant·성능·리소스·Findings(A10–A49, D20). 근거 케이스 drill-down과 Case drawer(A07, A14–A15, A21, A35). Finding → Design record(A50, D21) | PASS |
| **Design** | BPMN 업로드와 렌더링(DI 포함 shapes ≥ 3, D22, Q13). To-be 참조와 XML 미로드 구분(Q13, R-BPMN). 일반 로그에는 무관한 BPMN이 없음(A51). 개선안·상태·목표 KPI·영향 활동·Finding 연결 저장(A52, D21). As-is는 Festival manifest 자산이 없어 업로드 경로만 확인 | PASS (manifest 자동 로드는 NOT TESTABLE) |
| **Model** | 목표 입력·수정, 방향(min 선택), 단위 고정, 등호 met(A45, D10), 즉시 반영(D15). 게이트 수·관측 서비스 파라미터(D30). 후보 변경 시 기존 Scenario stale(D38) | PASS |
| **Implementation** | Proposal-only plan(A54). 시뮬레이션 기반 plan(+1 gate/+1 worker, D36). 담당자·작업·기한·상태 편집(A55, D36). Revision과 Archive(D40–D43). 같은 scenario 재적용 시 기존 plan 유지(D41). CSV/JSON Export(A56–A57, D43) | PASS |
| **Monitor & Control** | 실제 KPI 측정값, met/breached/unknown, 목표 변경 즉시 반영, 측정값 불변(A45–A46, D10–D15, E01–E02). 위반 근거 = 실제 문제 사례(D12–D13). plan 진행은 KPI와 분리(A58, D37) | PASS (결함 UI-1 수정 후) |
| **Refine & Improve** | 근거 기반 추천(A53). 같은 입력 벡터의 baseline/candidate(8 inputs 동일, D42). 개선 효과와 목표 확인(D33–D34). Scenario → Implementation(D36, D40). 일반 로그에는 시뮬레이션 미제공(A53, R-GEN) | PASS |

## 6. DFG / WTN-inspired 그래프와 집계표 일치

| 확인 | 결과 |
| --- | --- |
| DFG 노드·엣지 빈도, Start/End, self-loop | A10–A13, T01a, T02a PASS |
| Handoff 방향과 빈도, 양방향 구분 | B05–B07: R1→R2(C2)와 R2→R1(C1)이 각각 1, 역방향은 점선으로 구분 |
| 동일 Resource·결측 Resource | B02–B03: R2→R2와 결측 endpoint 엣지 없음, 커버리지 3/4 |
| 그래프 = 집계 테이블 | A31, B03, B05, Q9 PASS. 모든 handoff endpoint가 리소스 노드에 존재(단위 테스트, 조용한 엣지 누락 없음) |
| Node/Edge 클릭 → 관련 Case | A14–A15, A35, B07, C17 PASS |
| 표시 필터 | A38: 네트워크는 Support와 상대 Customer, 표는 필터 적용. 범위 합계는 불변. A66·R-DISPLAY: Export는 리소스 5개 전체 |
| Drawer 열기/닫기 viewport 유지 | A17(DFG), A37(Handoff), Q6 PASS |
| 확대·축소·이동 | A16: zoom-in으로 scale 변경, pane drag로 translate 변경 |
| WTN 범위 | 인접 발견 이벤트의 서로 다른 두 known resource 간 직접 인계 횟수만 계산합니다. KGU WTN을 재현하지 않으며 화면에도 그렇게 표기됩니다 |

**TEST_PLAN T17: PASS** (실제 엔진 결과, B02–B08).

## 7. 기존 결함 회귀 검증

| 결함 | 통합 후 확인 | 결과 |
| --- | --- | --- |
| QA-01 목표 등호 | max 9 = 측정 9 → met(A45), 0.4375 = 0.4375 → met(D10). 엔진 Q17 단위 테스트 유지 | PASS |
| QA-02 동명 리소스 | F1/F2 `Local Crew` 2개 노드, 10·5분(C14). 표시 라벨과 원본 키 분리(C15–C16) | PASS |
| QA-03 처리량 빈 버킷과 N/A | 관측 구간 내 0 버킷 [8,0,0](D05). 일반 로그는 시리즈 없음(A44, N/A 아님·0 아님) | PASS |
| QA-04 위반 Finding의 문제 사례 | Finding·Monitor 모두 ENT009(D12–D13, 단위 테스트). Monitor 결함 UI-1은 이번에 수정 | PASS |
| QA-05 완료 인스턴스와 시작 전용 | 노드 = Finished+Started, 인스턴스 Finding = Finished(C17) | PASS |
| QA-06 Festival 순서 검증 침범 | OFF에는 경고·Festival KPI 없음, ON(명시 조건)에는 3건(E03–E06) | PASS |
| QA-07 소수 초 정밀도 | 0.1/0.2/0.05 s에서 대기가 정확히 0(E07, 단위 테스트) | PASS |
| Case Drawer 그래프 초기화(Q6) | A17, A37, Q6 | PASS |
| To-be BPMN 참조와 파일 상태 | Q13, R-BPMN | PASS |
| CSV 열 개수 오류와 동의 | R-CSV 6항목, Q10 | PASS |
| Fixture 기록과 엔진 기록 분리 | F01–F03, scope 단위 테스트 | PASS |
| 엔진 독립 검증 Q01–Q23 | `tests/engine-review-regression.test.ts` 전체 통과 | PASS |

## 8. 자동 테스트와 브라우저 테스트 실행 결과

| 실행 | Development (`npm run dev`) | Production (`npm run build` + `vite preview`) | 원문 |
| --- | --- | --- | --- |
| `npm test` | 9 files, **96/96** | — | `runs/test-output.txt` |
| `npm run build` | — | 성공, `index-B1CHtSPK.js` 1,091.93 kB (gzip 324.35 kB), 500 kB 경고(기존) | `runs/build-output.txt` |
| journey.mjs | **19/19** | **19/19** | `runs/journey-*.txt` |
| qa/qa.mjs | **18/18** (INFO 3) | **18/18** | `runs/qa-*.txt` |
| regression-1-1.mjs | **31/31** | **31/31** | `runs/regression-1-1-*.txt` |
| integration-2.mjs | **135/135** | **135/135** | `runs/integration-2-*.txt` |

- 콘솔 error/warning과 uncaught exception은 0건입니다. 기록된 dialog는 의도한 plan revision 확인창입니다.
- preview는 빌드 결과와 같은 번들 해시를 제공했습니다. 빌드 이후 제품 코드는 바뀌지 않았습니다.
- 브라우저 프로필과 스크린샷은 OS 임시 폴더에만 저장했습니다. 저장된 출력에서 로컬 경로, 사용자명, 이메일을 grep한 결과 0건입니다.
- 기존 79개 테스트는 하나도 skip하거나 삭제하지 않았습니다. 기대값을 바꾼 기존 테스트는 3.2절에 모두 적었습니다.

## 9. TEST_PLAN 항목별 판정

| ID | 판정 | 근거 |
| --- | --- | --- |
| T01 | PASS | T01a–c(UI), phase-0 엔진 테스트 |
| T02 | **PARTIAL** | 빈도·self-loop·variant 유지 PASS(T02a–b). "≥2 표시 필터로 self-loop만 숨김"은 P1 최소 엣지 필터가 없어 NOT TESTABLE |
| T03 | PASS | B02–B03, 통합 단위 테스트 |
| T04 | PASS | T04, T04b |
| T05 | PASS | C01–C04, 단위 테스트 |
| T06 | PASS | C05–C06 |
| T07 | PASS | C07–C08 |
| T08 | PASS | C09–C11 |
| T09 | PASS | T09(UI, 엔진): 1 게이트 3/6/6/12 s, 2 게이트 0.7/2/2/8 s |
| T10 | PASS | E01–E02(대기 8분, 5 → breached, 10 → met) |
| T11 | PASS | D30–D37(3→4, +1 gate/+1 worker, 편집 가능) |
| T12 | PASS | D38–D45(후보 5 stale, rev 2, 이전 plan archived, 필터 변경 시 비현재) |
| T13 | PASS | B01, B08, A60–A70 |
| T14 | PASS | A42–A44, A50–A53 |
| T15 | PASS | C12–C13, 단위 테스트 |
| T16 | **NOT TESTABLE** | 배포 전. 공개 URL 없음 |
| T17 | PASS | B02–B08, A31–A38 |

## 10. 남은 문제와 제약

1. **Festival 자산 없음.** `public/datasets/dataset_manifest.json`, Festival CSV와 BPMN이 없습니다. Festival 샘플 로드, manifest As-is/To-be 자동 로드, Stage·Equipment KPI(재점검률, 정시율, 연계, 리드타임)의 화면 검증은 NOT TESTABLE입니다. 엔진 단위 테스트에서만 검증되어 있습니다.
2. **엔진·계약 보완이 필요한 항목**(결함이 아니라 계약 공백. 재현 방법과 제안은 feature-gap §7):
   - Finding에 규칙 필드 없음 → UI가 ID를 해석함
   - DFG start/end에 케이스 키 없음
   - Metric 문제 사례가 WeakMap에만 있음 → 직렬화하면 잃음(현재 UI는 원본을 넘겨 문제 없음)
   - Festival import 검증 활성화 조건이 묵시적임
   - 처리량은 audience 전용
   - median/p95 없음
3. **Design 목표 KPI 기본값.** Finding에서 만든 design은 Finding의 `metricId`(예: `inter_event`, `resource_instance_count`)를 목표 KPI로 가져옵니다. 이 ID는 `getKPIs`의 Metric이 아니어서 Model에서 목표를 설정할 수 없습니다. 사용자가 select에서 KPI를 다시 고를 수 있지만 UX 공백입니다.
4. **성능.** 분석은 렌더 중 동기 실행입니다. 수백~수천 케이스 Festival 로그의 처리 시간과 그래프 렌더링은 측정하지 않았습니다.
5. **번들 크기.** 1,091.93 kB 경고(오늘 범위 밖).
6. **사소한 표시 문제.** `1 cases`, `1 raw · 1 cases` 복수형. 처리량 캡션은 15분 이상 버킷 옵션만 제공합니다.
7. **localStorage.** design의 Finding 문장(리소스 이름 포함 가능)이 브라우저에 저장됩니다(Phase 1.1과 동일).
8. Festival linked traces는 케이스 필터와 무관하게 데이터셋 전체를 사용합니다(D9). Festival 데이터 투입 후 Codex와 확인이 필요합니다.

## 11. AI 활용 내역

- 도구: Claude Code (Claude Opus 5.5). 프롬프트 1건(사용자의 Phase 2 통합 지시, 2026-11-27).
- 수행: 문서 10개와 보고서 6개를 판독했습니다. 엔진과 UI 코드를 대조하고, provider를 전환하고, 3절의 수정과 테스트·fixture·브라우저 스크립트를 작성했습니다. 모든 테스트를 실행하고 이 보고서와 feature-gap 보고서를 작성했습니다.
- 손계산: Order Processing, audience 게이트 로그(FCFS 3·4·5 게이트), T01–T17 입력을 CSV에서 직접 계산했습니다. 실수 1건(D44 6 → 7)은 4.3절에 공개했습니다. 브라우저 검사 초안의 스크립트 오류(`textarea` setter, 대문자 표 헤더, 새로고침 후 라우트, 바깥 컨테이너 클릭, 입력값을 innerText로 읽음)는 앱 문제가 아니어서 스크립트를 고쳤습니다. 이 과정에서 기대값을 엔진 출력에 맞춰 바꾼 사례는 없습니다. D20의 리소스 라벨 기대값("Gate1" → "Gate1 · TEST-ONLY")은 `festival_id`가 있는 행의 리소스를 축제별로 분리하는 QA-02 정책을 문서에서 다시 확인하고 고쳤습니다.
- 사람의 검토가 필요한 부분: 결함 UI-1의 수정 방식(Finding ID 해석), 표시 필터 문구, 추가 Export 열, 통합 fixture의 수기 계산, 10절의 결정 사항.
- `docs/AI_USAGE_LOG.md`는 지시에 따라 수정하지 않았습니다. 이 절을 로그 원본으로 사용할 수 있습니다.

## 12. 변경 파일 목록

수정(13): `src/state/scope.ts`, `src/state/scope.test.ts`, `src/lib/format.ts`, `src/pages/{AnalysisPage,DesignPage,ExportPage,MonitorPage,OverviewPage,RefinePage}.tsx`, `reports/evidence/phase-1-frontend/{cdp.mjs,journey.mjs,qa/qa.mjs,regression-1-1.mjs}`

신규: `src/lib/evidence.ts`, `tests/integration/phase-2-integration.test.ts`, `tests/fixtures/integration/`(CSV 13개 + README), `reports/evidence/phase-2-integration.md`, `reports/evidence/phase-2-feature-gap.md`, `reports/evidence/phase-2-integration/integration-2.mjs`, `reports/evidence/phase-2-integration/runs/`(실행 원문 10개)
