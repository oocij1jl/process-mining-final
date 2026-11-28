# Phase 2 — Feature Gap Audit (내일 개발용)

- 기준: `feat/integration` 작업 트리(Phase 2 통합 후), 2026-11-27 KST. 실제 코드와 [Phase 2 통합 검증](phase-2-integration.md)의 실행 결과를 기준으로 했습니다.
- 이 문서는 분석과 제안만 담습니다. 여기 적은 신규 기능은 구현하지 않았습니다.

## 0. 상태 정의와 요구사항 출처

| 상태 | 의미 |
| --- | --- |
| **IMPLEMENTED** | 엔진과 UI가 모두 있고, Phase 2에서 실제 엔진 결과로 브라우저 검증을 마침 |
| **PARTIAL** | 일부만 있음(엔진만, UI만, 특정 프로세스만, 데이터 부재로 미검증 등) |
| **NOT IMPLEMENTED** | 최초 설계 범위(P0/프로젝트 경계)에 있으나 코드가 없음 |
| **DEFERRED** | 설계 문서에서 P1/P2 또는 제외로 명시됐거나 이후 제안된 확장이라 의도적으로 보류함 |

| 출처 코드 | 의미 | 근거 문서 |
| --- | --- | --- |
| **C** | 과목 요구(필수) | REQUIREMENTS "Course requirements": 고유 프로세스, BPMN, 생성 로그와 설명, AI 개발 도구의 process discovery, 개선안, 6단계 BPM lifecycle GUI(가능한 한 많이), 공개 URL |
| **P0 / P1 / P2** | 내부 우선순위 | REQUIREMENTS v0.2.1 |
| **L** | 강의자료 예시 기능 | REQUIREMENTS: Week 11 pp.17–21 예시는 "suggestions, not mandatory". KGU 도구 분석(ICN, WTN, DFG, loop). 강의자료 원문은 저장소에 없어 문서 인용 범위에서만 분류 |
| **N** | 이후 제안된 신규 확장 | Codex/Claude Phase 1 보고서의 제안과 Phase 2 지시 7절 목록 |

## 1. 전체 기능 구현 현황표

### 1.1 Process Discovery

| 기능 | 출처 | 상태 | 엔진 (파일·함수) | UI | 통합 검증 | 누락 / 비고 | 의존성 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DFG (활동·전이 빈도, Start/End, self-loop) | C, P0 F02a | **IMPLEMENTED** | `discovery.ts` `buildDFG` | `AnalysisPage` `ProcessMap`, `FlowGraph` | A10–A17, T01, T02 | Start/End 엣지의 케이스 키가 계약에 없음. 최소 엣지 표시 필터(P1) 없음 | groupCases |
| Exact variant | P0 F02b | **IMPLEMENTED** | `getVariants` | `Variants` | A20–A21, T01b, T02b | 정렬·drill-down 있음 | — |
| Trace view / Case drawer | P0 F01 | **IMPLEMENTED** | `groupCases` | `OverviewPage` Trace view, `cases.tsx` | A05, A07 | — | — |
| ICN (Information Control Net) | L, P2 | **DEFERRED** | 없음 | 없음 | — | REQUIREMENTS P2 "Full ICN/ρ algorithm". KGU 알고리즘은 컴파일된 JAR뿐이라 확인 불가 | AND/OR 발견 |
| AND/OR gateway, concurrency 발견 | L, P2 | **DEFERRED** | 없음. 순서로 근사 | DFG 부제에 "Concurrency is approximated by order" 표시 | — | lifecycle 겹침(`overlaps`)은 계산하지만 병렬 구조는 추론하지 않음 | ICN |
| BPMN Viewer | C, P0 F03 | **IMPLEMENTED** | — (모델 자산) | `BpmnViewer.tsx`, `DesignPage`(import, As-is/To-be 탭, DFG 비교 탭) | D22, Q13, R-BPMN, A51 | DI 없는 BPMN은 오류 표시. manifest 자동 로드는 자산 부재로 미검증 | BPMN 자산 |
| BPMN Discovery(로그 → BPMN 자동 생성) | P2 / 제외 | **DEFERRED** | 없음 | 없음(가짜 BPMN 생성 금지) | — | REQUIREMENTS: "no … automatic BPMN discovery". Viewer는 모델링된 산출물을 보여 주는 것이고 발견 결과가 아님. conformance 점수 없음 | ICN, gateway 발견 |

### 1.2 Organizational Mining

| 기능 | 출처 | 상태 | 엔진 | UI | 통합 검증 | 누락 / 비고 | 의존성 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Resource workload (raw, instance, case, activity mix, 커버리지, active min) | P0 F02d | **IMPLEMENTED** | `resources.ts` `getResourceAnalysis`, `resource-identity.ts` | `Resources` 표·차트·Inspector | A30–A36, C10, C12, C14, C17 | — | 리소스 키 정책 |
| WTN-inspired resource handoff (표와 방향 그래프) | P0 (v0.2.1 승격) | **IMPLEMENTED** | `getResourceAnalysis().handoffs` | `handoffGraph`, Handoff table | A31–A38, B02–B08 (T17) | 표시 필터(P1)는 구현됨 | — |
| Full WTN (KGU 재현) | L, P2 | **DEFERRED** | 없음 | 없음 | — | 2.2절 참고 | KGU 알고리즘 정보 |
| Resource utilization | P0 F02d(N/A 처리), DATA_SCHEMA §6 | **PARTIAL** | `kpis.ts` `shiftMetrics`(교대 합집합, 구간 clip, 교대 밖 시간) | KPI로만 표시. 교대 입력 UI 없음 → 항상 N/A | A43, C11, C13 | 엔진 단위 테스트로 65%, 57.5%, 60% 검증. UI에서 값이 나오는 경로 없음 | Resource Shift 입력 |
| Resource Shift (`resource_shifts.csv`) | DATA_SCHEMA §1·6 (선택, 우선순위 미지정) | **PARTIAL** | 계약 `ResourceShift`, `KPIContext.shifts` | 없음 | — | 파일 형식, 파서, 리소스 키 매핑(축제 스코프 키) 없음 | 리소스 키 공개 함수 |
| Cross-process resource analysis / Festival overview | REQUIREMENTS 프로젝트 경계("linked dashboard"), FUNCTIONAL_SPEC "Stage and Equipment deliverables" | **NOT IMPLEMENTED** | stage↔equipment 연계 KPI만 있음(`equipment_on_time_rate`, `equipment_unmatched_performance_count`) | 없음(프로세스 하나씩 선택) | — | Phase 1 검수에서 "팀 결정 필요"로 남음. 프로세스 간 KPI 나란히 보기, 시간대·역할별 workload 비교 없음 | Festival 데이터, 공유 `resource_id` |

### 1.3 Performance Analysis

| 기능 | 출처 | 상태 | 엔진 | UI | 통합 검증 | 누락 / 비고 | 의존성 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bottleneck (inter-event, matched gap, service 분리) | P0 F02c | **IMPLEMENTED** | `performance.ts` `getPerformance` | `Performance` 표, low support 배지, DFG Inspector | A22–A25, T04, C08 | 평균만 있음 | lifecycle 매칭 |
| Case duration | P0 | **IMPLEMENTED** | `getCaseDurations`, `Trace.elapsedMin` | 히스토그램, KPI `case_elapsed_mean` | A43, T01c | — | — |
| Rework | P0 F02e | **IMPLEMENTED**(일반) / **PARTIAL**(Festival) | `findings.ts`(self-loop 또는 설정 활동), `hasRework`, `stage_recheck_rate` | Findings, Festival 설정 전달 `festivalRework` | 일반 rework 경로 단위 테스트. Festival은 adapter 단위 테스트만 | Stage/Equipment 실데이터 미검증 | Festival 데이터 |
| Throughput | P0 F06("historical throughput") | **PARTIAL** | `festival-kpis.ts` `entryThroughput`(audience, 관측 구간 dense 버킷) | Monitor 처리량 차트 | D03–D05 | 일반 프로세스와 stage/equipment에는 처리량 없음(D4) | 완료 활동 정의 |
| Outlier (mean + 2SD) | P1 | **DEFERRED** | 없음 | 없음 | — | 모집단/표본 정의 필요(REQUIREMENTS) | 분포 통계 |
| Median, p95 | FUNCTIONAL_SPEC F02c "optionally", P1 추가 분포 통계 | **PARTIAL** | p95는 큐 시뮬레이션에만 있음(nearest rank). `GapSummary`/elapsed는 평균만 | 시뮬레이션 p95 표시 | D33 | 관측 성능 지표의 median/p95 없음 | 계약 필드 추가 |

### 1.4 BPM Lifecycle

| 기능 | 출처 | 상태 | 엔진 | UI | 통합 검증 | 누락 / 비고 | 의존성 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Findings → Design record | C, P0 F02e/F03 | **IMPLEMENTED** | `getFindings` | `Findings`, `DesignPage` | A50–A52, D21 | design 목표 KPI가 Finding ID(`inter_event` 등)를 기본값으로 가져옴(KPI가 아님) | — |
| 범용 KPI | P0 F04/F06 | **PARTIAL** | `case_elapsed_mean`, `resource_utilization`, `resource_out_of_shift_minutes` | Model, Monitor | A43–A49 | 사용자 정의 KPI 계산식(N) 없음. 일반 로그 KPI는 3개 | KPIDefinition 계약 |
| Festival KPI (stage, audience, equipment) | P0 F06, DATA_SCHEMA §8 | **PARTIAL** | `festival-kpis.ts` 전부 | KPI 표시, 처리량 | audience만 검증(D02–D15) | stage/equipment는 데이터 부재로 UI 미검증 | Festival 데이터 |
| Target 설정과 평가 | P0 F04/F06 | **IMPLEMENTED** | `evaluateTargets`, `compareMeasured` | Model `TargetsCard`, Monitor 알림 | A45–A49, D10–D15, E01–E02 | — | — |
| 범용 Simulation | P0 F07(audience 한정), N(범용) | **PARTIAL** | `simulateGateQueue`(입력 벡터만 사용, 범용). `getGateInputs`는 `audience`와 `Join Entry Queue`로 고정 | Refine은 Festival audience에서만 제공 | D30–D45, T09, E07 | 범용 도착/서비스 정의 없음 | `extractQueueInputs` 계약 |
| Action Plan | P0 F05 | **IMPLEMENTED** | — | `ImplementationPage`, `plans.ts` | A54–A57, D36–D43 | 실제 배포 주장 없음 | Refine |
| Monitor | P0 F06 | **IMPLEMENTED** | `getKPIs`, `evaluateTargets`, `getFindings` | `MonitorPage` | A43–A49, A58, D10–D15, D37 | live monitoring 아님(명시) | — |
| Improvement backlog | P0 F07 "evidence-linked recommendations" | **PARTIAL** | Findings | Refine 추천 목록, design 상태(draft/ready/approved/rejected) | A53 | 우선순위, 정렬, 담당이 있는 backlog 화면 없음 | — |
| Resource allocation | P0 F05 "proposed staffing" / P2 optimization solver | **PARTIAL** | 게이트 수 차이로 staffing delta 계산 | plan의 staffing 열 | D36 | 최적화나 리소스별 배치 없음(P2 DEFERRED) | 교대, 역할 정보 |
| Gantt timeline | N | **DEFERRED** | — | 없음 | — | plan task의 기한만 있음 | plan 시작일 필드 |
| ROI calculator | N | **DEFERRED** | — | 없음 | — | DATA_SCHEMA: cost는 단위·통화·가정이 문서화된 경우에만 유효 | 비용 가정 |

### 1.5 Data Support

| 기능 | 출처 | 상태 | 엔진 | UI | 통합 검증 | 누락 / 비고 | 의존성 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CSV import, 매핑, 검증, 제외 동의 | C, P0 F01 | **IMPLEMENTED** | `ingestion.ts` `validateAndNormalize`, `parseTimestamp` | `OverviewPage`, `lib/files.ts` | A01–A07, C01–C11, R-CSV, Q10 | — | — |
| XES | P1(외부 subset converter), 전체 XES 브라우저 import는 제외 | **DEFERRED** | 없음 | `.xes` 업로드 시 "not supported" 안내 | Q10 | DATA_SCHEMA §6 매핑 규칙만 문서화됨 | 변환 스크립트 |
| Lifecycle (start/complete, instance ID, 모호성) | P0 | **IMPLEMENTED** | `traces.ts` `matchLifecycle` | 성능, 경고 | T04, C07–C08, QA-05 | — | — |
| Resource shift | DATA_SCHEMA | **PARTIAL** | 계약과 계산 있음 | 입력 없음 | — | 1.2절 참고 | — |
| Festival manifest | P0 F08 | **PARTIAL** | — | `festival/adapter.ts` `parseManifest`, `settingsFromManifest`, Overview loader | 단위 테스트 6개. 브라우저 미검증 | 데이터 트랙이 manifest를 게시하지 않음 | 데이터 트랙 |
| BPMN assets | C, P0 F03 | **PARTIAL** | — | manifest `bpmn`/`bpmn_to_be` 로드, 다운로드 링크 | 업로드 경로만 검증(D22) | `public/bpmn/` 비어 있음 | 데이터 트랙 |
| Evidence export | P0 F08 | **IMPLEMENTED** | — | `ExportPage`(JSON + CSV 9종), plan CSV/JSON, Workspace history | A56–A70, B08, C16, D42–D43 | generator/seed는 manifest가 있을 때만 기록 | — |
| 샘플 CSV 다운로드 | P0 F08 | **PARTIAL** | — | UI fixture CSV 다운로드 | — | Festival 샘플 없음 | 데이터 트랙 |
| 공개 HTTPS 배포, T16 | C, P0 F08 | **NOT IMPLEMENTED** | — | `netlify.toml` 있음 | NOT TESTABLE | 2026-11-29 23:00 KST 제출 | 배포 |

## 2. WTN / ICN의 정확한 구현 범위

### 2.1 ICN

구현하지 않았습니다. 현재 제공하는 것은 DFG입니다. DFG는 케이스 안에서 인접한 완료·point 이벤트의 방향별 횟수를 셉니다. AND/OR split·join, 병렬, 루프 구조, ρ 지표는 추론하지 않습니다. self-loop는 같은 활동이 연속될 때만 DFG 엣지로 나타납니다. 더 긴 순환은 별도 구조로 표시하지 않습니다.

### 2.2 WTN-inspired handoff와 Full WTN의 차이

| 항목 | 현재 구현 | Full WTN / KGU (재현하지 않음) |
| --- | --- | --- |
| 노드 | 범위 안의 모든 known resource 키(isolated 포함). 축제별 로컬 키와 공유 `resource_id` | KGU의 노드 정의와 집계는 확인 불가 |
| 엣지 | 같은 케이스에서 **인접한 발견 이벤트 쌍**의 서로 다른 두 known resource. 방향별 횟수와 기여 케이스 | KGU 가중치·정규화·출력 의미는 확인 불가 |
| 결측·동일 리소스 | 결측 endpoint는 건너뜀(다음 이벤트로 점프하지 않음). 같은 리소스 연속은 제외 | 확인 불가 |
| 간접 인계(k단계), 인과성, 시간 창 | 없음 | 확인 불가 |
| 가중치(시간, 빈도 정규화, 케이스 수 정규화) | 없음(raw count만) | 확인 불가 |
| 다른 사회적 지표(working together, similar task, subcontracting) | 없음 | 확인 불가 |
| 실제 의사소통 여부 | 주장하지 않음(UI 문구에 명시) | — |

KGU 도구는 소스가 없는 JAR이고, WTN은 스크립트 대상 파일명에만 나옵니다(KGU_TOOL_ANALYSIS C절). 따라서 Full WTN을 "재현"할 수는 없습니다. 할 수 있는 것은 문헌상의 handover-of-work, working-together 지표를 독자적으로 정의하고 구현하는 것입니다. 이 경우 "KGU parity"가 아니라고 표기해야 합니다.

## 3. 범용 기능과 Festival 특화 기능의 구분

| 구분 | 포함 기능 | 활성 조건 | 코드 |
| --- | --- | --- | --- |
| 범용 core | CSV 매핑·검증, 케이스·lifecycle, DFG, variant, 성능, workload·handoff, `case_elapsed_mean`, 교대 기반 utilization(교대 입력 시), 목표 평가, Findings(전이, self-loop rework, workload, 목표 위반), plan, Monitor, Export | 항상 | `src/engine/*`(Festival 모듈 제외), 모든 페이지 |
| 범용 스케줄러 | `simulateGateQueue`(준비된 도착·서비스 벡터) | 입력 벡터가 있을 때 | `engine/queue.ts` |
| Festival 어댑터 | Stage/Audience/Equipment KPI, rework 설정, audience 처리량, 게이트 입력 추출, 게이트 시나리오 UI, Festival 프로세스 이름, manifest BPMN | dataset이 Festival adapters를 명시적으로 켬(업로드 기본 OFF) | `engine/festival-kpis.ts`, `engine/audience.ts`, `src/festival/adapter.ts` |
| Festival import 시간 순서 검증 | `audience_event_before_arrival` 등 | `requireProcessType: true` + `mapping.festival_id` | `engine/ingestion.ts` |

Phase 2에서 일반 로그에 Festival KPI, 규칙, 이름, 시뮬레이션이 붙지 않는 것을 확인했습니다(A42, A53, R-GEN, E03–E04).

## 4. 현재 지원하는 기능과 지원하지 않는 기능 (사용자 관점)

**지원:** CSV 업로드와 매핑, 검증·제외 동의, trace 조회, DFG·variant·성능·리소스·handoff 분석, 근거가 연결된 Findings, Design record와 BPMN 보기, KPI 목표와 Monitor, Festival audience 게이트 시나리오(3→4 등), 시나리오/제안 기반 plan 편집과 revision, Evidence Export(JSON/CSV), 범위별 workspace와 history.

**미지원:** XES 직접 import, ICN·gateway·BPMN 자동 발견, KGU WTN 재현, 교대 입력과 utilization 값, 프로세스 간 리소스 대시보드, 일반 프로세스 처리량, median/p95/outlier, 그래프 최소 엣지 필터와 이미지 export, 사용자 정의 KPI, 범용 큐 시뮬레이션 UI, BPMN 편집기, Gantt, ROI, live monitoring, 실제 배포 주장.

## 5. P0 / P1 / P2별 미완료 기능

| 우선순위 | 미완료 항목 | 상태 |
| --- | --- | --- |
| **P0** | F08 Festival 합성 데이터 generator + seed 문서화, 샘플 CSV 다운로드 | 데이터 트랙 대기 |
| P0 | F03 Festival As-is BPMN 3개 + audience To-be 1개 | 데이터 트랙 대기 |
| P0 | F06 stage/equipment KPI, Festival Findings의 화면 검증 | 데이터 대기 |
| P0 | 공개 HTTPS 배포와 T16 시크릿 창 smoke test | 미실행 |
| P0(해석 필요) | FUNCTIONAL_SPEC "Festival overview compares KPIs and time/role workload" | NOT IMPLEMENTED. 팀 결정 필요 |
| P0(해석 필요) | F06 "historical throughput": 일반 프로세스 | audience만 있음 |
| **P1** | 최소 엣지 수 표시 필터, SVG/PNG export, outlier, XES subset converter, 추가 분포 통계, stage 시뮬레이션 또는 추가 To-be BPMN, 번들 분할 | DEFERRED |
| **P2** | Full ICN/ρ, KGU parity, 자동 gateway/concurrency 발견, XPDL, replay conformance, model editor, optimization solver, ML, backend/login | DEFERRED |

## 6. 내일 재검토해야 할 설계 사항

1. **Festival overview(프로세스 간 비교)를 P0로 볼지.** REQUIREMENTS 프로젝트 경계에는 있지만 P0 F-목록에는 없습니다.
2. **처리량의 범위.** F06의 historical throughput을 일반 프로세스에도 요구할지 정해야 합니다. 요구한다면 완료 활동을 어떻게 정의할지(사용자 지정 또는 마지막 이벤트)도 정해야 합니다.
3. **Finding → Design 목표 KPI 매핑.** `inter_event`, `resource_instance_count` 같은 Finding metric ID를 KPI 목록과 분리할지, Finding에서 대응 KPI를 제안할지 정해야 합니다.
4. **Festival 활성화 플래그의 단일화.** UI의 Festival 토글과 엔진의 import 검증 조건(`requireProcessType` + `festival_id`)을 하나로 합칠지 정해야 합니다.
5. **리소스 키와 교대 입력.** 교대 파일의 리소스를 엔진의 `@resource:` 키로 연결하는 규칙(공유 `resource_id`, 축제별 이름)을 정해야 합니다.
6. **범용 시뮬레이션의 범위.** audience 게이트 외 프로세스에 큐 모델을 적용할 근거가 있는지, 보고서에 정량 시나리오 1개(MVP)면 충분한지 정해야 합니다.
7. **분포 통계 정의.** median과 p95(nearest rank), outlier의 모집단/표본 정의.
8. **Festival linked traces와 케이스 필터의 관계**(통합 보고서 D9).
9. **번들 분할**은 공통 설정(`vite.config.ts`) 소유자의 승인이 필요합니다.

## 7. 신규 기능의 공통 인터페이스 변경 제안 (`src/contracts.ts`, Codex 소유, 한 커밋으로 합의)

| # | 제안 | 해결하는 문제 / 재현 | 영향 범위 |
| --- | --- | --- | --- |
| I-1 | `Finding.rule?: 'slow_transition' \| 'rework' \| 'workload' \| 'audience_queue' \| 'target_max' \| 'target_min'` | UI가 Finding ID JSON의 4번째 요소를 해석함(`src/lib/evidence.ts`). ID 형식이 바뀌면 Monitor 위반 근거가 KPI 케이스로 되돌아감 | findings.ts, MonitorPage |
| I-2 | `DFG.startCases?: Record<string, CaseKey[]>`, `DFG.endCases?` | Start/End 엣지 클릭 시 케이스 조회 불가(D3) | discovery.ts, AnalysisPage |
| I-3 | `Metric.problemCaseKeys?: { min: CaseKey[]; max: CaseKey[] }` 또는 Finding 전용으로 명시 | 문제 사례가 `WeakMap`에만 있어 직렬화·저장·Export한 KPI로는 복원 불가(통합 단위 테스트에서 재현: `structuredClone` 후 ENT009 → 8건) | metrics.ts, Export, 저장된 기록 |
| I-4 | `ImportOptions.festivalValidation?: boolean` | Festival import 시간 순서 검증이 묵시 조건에 의존(D7) | ingestion.ts, OverviewPage |
| I-5 | `extractQueueInputs(traces, { arrival: { activity, lifecycle? }, service: { activity } \| { assumedSec } })`. `getGateInputs`는 Festival 어댑터로 유지 | 범용 큐 시뮬레이션(N). Codex fix 보고서의 제안 | audience.ts, RefinePage, ScenarioParams |
| I-6 | `KPIDefinition { id, unit, eligibility, aggregation, positive? }` + `KPIContext.custom?: KPIDefinition[]` | 사용자 정의 KPI(N). Codex 제안 | kpis.ts, ModelPage |
| I-7 | `GapSummary.medianMin?`, `p95Min?`(nearest rank), elapsed 분포 요약 | median/p95(P1) | performance.ts, Performance 표, Export |
| I-8 | `KPIContext.throughput.completionActivities?: string[]` → 일반 `case_throughput` | 일반 프로세스 처리량(D4) | kpis.ts, MonitorPage |
| I-9 | 엔진 공개 함수 `resourceKeyFor(attrs, resource, trace?)` | 교대 파일·외부 입력을 엔진 리소스 키에 맞추기 | resource-identity.ts, shift UI |
| I-10 | `HandoffSummary.meanGapMin?`, 옵션 `{ maxSteps?: number }` | WTN 확장(가중치, 간접 인계). KGU parity가 아님을 표기 | resources.ts |
| I-11 | `getOutliers(traces, { method: 'mean_plus_2sd', population: 'sample' \| 'population' })` | Outlier(P1) | 신규 모듈 |
| I-12 | `DatasetMetadata.generator?: { version, seed }`, `datasetId?` | Export provenance(Phase 1 검수 제안) | contracts, Export |
| I-13 | `PlanTask.startDate?` | Gantt(N)를 할 경우의 선행 조건 | state/types(UI 소유) |

## 8. Codex / Claude 추가 개발 분담안

| 담당 | 작업 | 선행 조건 |
| --- | --- | --- |
| **Codex** (engine, contracts, tests, scripts) | I-1·I-2·I-3·I-4 계약 보완(작고 안전). I-7 median/p95. I-8 일반 처리량. I-9 리소스 키 공개. 선택: I-5 범용 큐, I-6 KPIDefinition, I-11 outlier. `scripts/`의 XES subset → CSV 변환기(브라우저 밖). Festival generator 스크립트 지원(데이터 트랙과 협의) | 6절 결정 |
| **Claude** (UI, state, adapters, styles) | I-1–I-4 반영(ID 해석 제거, Start/End drill-down, 검증 플래그). Festival 데이터 투입 후 manifest·BPMN·Stage/Equipment 화면 검증. 최소 엣지 표시 필터(P1, 표시 전용). 그래프 SVG/PNG export(P1). median/p95 표시. 교대 CSV 업로드 UI(I-9 이후). Festival overview(결정 시). Design 목표 KPI UX | Codex 계약 커밋, 데이터 자산 |
| **학생 / 데이터 트랙** | Festival 비즈니스 프로세스 문서, BPMN 4개, 고정 seed generator, manifest, 최종 CSV. 배포와 T16. 6절 결정 | — |
| **공통** | Festival 데이터로 integration-2 확장 실행. 대용량(600–850 케이스) 성능 측정 | 데이터 |

## 9. 기능별 우선순위와 선행 조건 (제출 일정 기준)

제출 기한: 공개 URL 2026-11-29 23:00 KST(LMS 공지 인용, 재확인 필요). 최종 보고서는 Week 15.

### 9.1 필수 (11-29 공개 URL 전)

| 순서 | 작업 | 담당 | 선행 |
| --- | --- | --- | --- |
| 1 | Festival 데이터, generator·seed, manifest, BPMN(As-is 3, audience To-be 1) | 학생/데이터 | — |
| 2 | Festival 경로 통합 검증(manifest 로드, Stage/Equipment KPI, rework Finding, 3→4 게이트) | Claude | 1 |
| 3 | 계약 보완 I-1–I-4(작은 변경) | Codex → Claude | 6절 결정 |
| 4 | Netlify 배포와 T16 시크릿 창 smoke test | 학생 | 2 |
| 5 | 문서 정정: ENGINE_CONTRACT 첫 문단(D1), TEST_PLAN 증거 경로(D2) | Codex / 학생 | — |

### 9.2 선택 (시간이 남을 때, P1)

최소 엣지 표시 필터 → median/p95 → 그래프 SVG/PNG export → 일반 처리량 → XES subset converter → outlier → 교대 입력과 utilization → Festival overview → 번들 분할.

### 9.3 제출 후 / 보류 (P2, N)

Full ICN, KGU WTN 재현, 자동 gateway·BPMN 발견, BPMN 편집기, optimization solver, 범용 큐 UI, 사용자 정의 KPI, Gantt, ROI, 전체 UI 리뉴얼.

## 10. Festival 데이터와 BPMN 제작 요구사항 (Phase 2에서 확인한 사항 포함)

Phase 1.1 보고서 6절의 manifest·CSV·BPMN 형식은 그대로 유효합니다. 통합 과정에서 확인한 추가 요구는 다음과 같습니다.

- **`process_type`**은 모든 행에 소문자 `stage` / `audience` / `equipment`로 넣습니다. **`festival_id`**도 모든 행에 넣습니다. 둘 다 있어야 import 단계의 audience 시간 순서 검증이 켜집니다(Festival 샘플은 `requireProcessType`이 자동 ON).
- **리소스 이름**은 `festival_id`별로 분리됩니다. 화면에는 "Gate1 · DEMOFEST"처럼 표시됩니다. 여러 축제에 같은 사람이 있으면 `resource_id`(공유 안정 ID)를 넣습니다. 교대 파일을 만든다면 같은 ID 정책을 따릅니다.
- **Ticket Verification**은 `start`/`complete`와 `activity_instance_id`를 넣습니다. 관측 서비스 시간 근거가 되고, 검표 없는 거절은 시뮬레이션에서 제외됩니다(D31). 서비스 시간 분포는 modeling assumption으로 문서화합니다.
- `Join Entry Queue`는 대기열 합류 point 이벤트입니다. 합류 전 검표·입장 기록이 있으면 경고가 생기고 KPI에서 제외되므로 generator가 시간 순서를 보장해야 합니다.
- `scheduled_start`와 `required_ready_at`은 명시적 offset이 있는 ISO 형식이어야 하고, 케이스 안에서 한 값이어야 합니다(여러 값이면 해당 KPI에서 제외).
- Equipment↔Stage 연결은 같은 데이터셋의 `festival_id` + `performance_id`입니다. 한 공연 키에 stage 케이스가 둘이면 연결에서 제외됩니다.
- **manifest:** `baseline_gate_count`(게이트 ID 개수로 추론하지 않음), `service_activity`, `bpmn`, `bpmn_to_be.audience`, `generator.version/seed`, `assumptions[]`, 가상 데이터셋 이름.
- **BPMN**은 반드시 DI(`bpmndi:BPMNDiagram`)를 포함합니다. DI가 없으면 렌더링되지 않습니다.
- **열 개수**는 모든 행에서 같아야 합니다. 시각은 `Z` 또는 `±HH:MM` offset을 씁니다.
- **처리량**은 관측 구간의 dense 버킷으로 계산됩니다. 로그 기록 구간 밖은 관측 안 됨으로 해석하므로, 보고서에 로그 수집 구간을 함께 적습니다.
- 크기 권장(DATA_SCHEMA §3): stage 100, audience 600, equipment 150 케이스. 투입 후 렌더링 시간을 측정합니다.
