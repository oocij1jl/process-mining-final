# ProcessPilot v0.3 Phase 3 엔진 검증

- 작업 브랜치는 `feat/v03-engine`이며 시작 시 작업 트리는 깨끗했다. 승인 기준점은 `acc513fb0cec31874d1e6b05f74e9c1ca5c4bc57`다. `feat/v03-ui` 워크트리도 확인 당시 같은 기준점이었다.
- **엔진 통합 GO.** P0-A1, P0-A2, P0-B와 후속 승인된 Stage–Equipment 연결 API를 구현했다. 최종 139개 테스트와 프로덕션 빌드가 통과했다.
- **공개 릴리스 NO-GO.** 새 UI의 브라우저 통합, 최종 Festival 자산, 공개 URL 검증이 남았다. Stage–Equipment의 개별 연결과 KPI 일관성은 합성 fixture로 검증했다.

기준 명세는 [제품 사양](../../docs/V03_FINAL.md), [공통 계약](../../docs/V03_CONTRACT.md), [기존 DTO](../../src/contracts.ts), [v0.3 DTO](../../src/v03-contracts.ts)다. 모든 신규 런타임 진입점은 [engine/index.ts](../../src/engine/index.ts)를 통해 export한다.

## 구현 및 검증

| 단계 | 구현 | 검증 근거 |
|---|---|---|
| P0-A1 | I-1 Finding rule/definition, I-2 DFG 시작·종료 사례, I-3 방향별 KPI 근거 및 Finding evidence kind, I-4 명시적 Festival 검증 | ENT009 최소 완료율 위반은 원본·복제·JSON에서 동일하다. KPI 분자 8건을 유지한다. QA-06은 명시 true, false와 기존 자동 활성화를 각각 검증했다. |
| P0-A1 | `importXes` 및 CSV/XES 동등성 | 일반, Stage, Audience의 쌍별 fixture를 정규화한 후 DFG, variants, resources/WTN, performance/coverage, 활동 근거와 KPI를 정확 비교했다. 독립 기대값에서 일반 B 서비스 2분, Stage 정시율 100%, Audience 완료율 50%, 버킷 [1, 0]을 확인했다. |
| P0-A1 | XES 구조, 보안 및 한도 | 잘못된 XML·UTF-8과 미지원 구조, 중복 사례 키, DTD·엔티티 선언·XInclude·stylesheet를 거부한다. 스키마 URL은 불활성 문자열이며 Node 테스트에서 `fetch` 호출이 0건이다. 8 MiB, 이벤트 50,000, 트레이스 10,000, 요소 500,000, 깊이 32의 경계 및 초과를 검증했다. |
| P0-A1 | `getActivityEvidence`, 일반 반복 Finding, 전이 커버리지, handoff 활동 쌍 | 비인접 반복도 집계한다. 시작만 있는 사례를 분모에서 제외하며 양쪽 사례와 관측 서비스 커버리지를 제공한다. 독립 예시에서 반복 1/2, 추가 발생 1, 서비스 1/2를 확인했다. 전이 3건 중 측정 간격 1건, 겹침 1건, 전제 부족 1건을 분리했다. |
| P0-A2 | `getBpmnComparison` | XOR 대안, 명시적 매핑, 중복 이름, 유효한 순환, 미지원 요소 및 연결되지 않은 구조를 검증했다. 미지원 구조도 매핑 결과를 반환한다. |
| P0-A2 | `scoreAutomation`, `estimateBenefit` | B의 기회 83.3333점, 적합성 80점, 점수 81.6667점을 독립 계산과 대조했다. 기간 내 20/3시간, 잠재 시간 가치 100,000 KRW, 실현 가정 적용 50,000 KRW, 순편익 0, ROI 0%를 확인했다. 평가 없음, 높은 위험, 실현율 없음, 비용 0, 음의 시간 변화도 확인했다. |
| P0-A2 | `getHistoricalTrends` | Order fixture의 첫 이벤트 기준 5분 구간은 사례 수 [2, 0, 0, 1], 경과 평균 [12.5, null, null, 2]분이다. 시작 전용 사례는 관측 span에는 포함하고 반복 지표 분모에서는 제외한다. |
| P0-B | `buildReplayIndex`, `getReplayFrame` | 시각 동률의 원본 순서, 창 시작 전의 활성 interval, 동시 interval, variant 필터, 절단 경계, rewind 및 사례 수 보존을 검증했다. |
| P0-B | `extractQueueInputs`, `compareQueues` | 기존 FCFS 스케줄러로 동일 arrivals 벡터를 비교한다. T09의 1/2 서버 평균 대기 3초와 2/3초, 종료 12초와 8초를 확인했다. 도착·서비스 제외 사유, 동일 조건 동일 결과, 명시적 staffing, 소수 초와 multiplier 정밀도를 검증했다. |
| P0-B | `getCaseThroughput` | Order 출하 지표는 버킷 [0, 0, 1, 1], 평균 0.5 cases/bucket이다. 취소도 종료 정의에 포함하면 [0, 0, 1, 2]와 새 정의 키를 반환한다. 종료 설정 누락, 빈 범위, 유효한 0 및 KPI 목표의 정의 키 불일치를 검증했다. |
| P0-B | `getTransitionDrift`, `getPatternEvidence` | 2/4→3/4는 +25 pp다. 기간 배정 기준은 목적지 이벤트 시각이다. 분모 0 및 낮은 gap 표본을 처리한다. 관측 순서, 분기 대안, self-loop, A→B→A, 양의 matched interval 겹침의 건수와 사례를 검증했다. |
| Festival 후속 | `getFestivalReadinessLinks` | 선택·상대 범위, 원본 이벤트 참조, 중복 및 미연결 상태, 두 기한 정책과 불충분한 관측을 검증했다. Equipment와 Stage KPI의 값, 분모와 방향별 근거가 링크 행의 판정과 일치한다. |

[Phase 3 엔진 테스트](../../tests/v03/) · [CSV/XES 동등성 fixture](../../tests/fixtures/v03/) · [Phase 2 통합 회귀](../../tests/integration/phase-2-integration.test.ts)

## 실행 기록

| 시점 | `npm test` | `npm run build` |
|---|---:|---|
| P0-A1 | 114/114, 10 files | PASS |
| P0-A2 | 121/121, 11 files | PASS |
| P0-B | 130/130, 12 files | PASS |
| Phase 3 최종 보강 | 133/133, 13 files | PASS |
| Festival 개별 연결 추가 후 | **139/139, 13 files** | **PASS** |

Phase 3의 133개 테스트를 보존하고 신규 연결 시험 6개를 추가했다. 연결 테스트 파일을 단독 실행했을 때 기존 1개와 신규 6개가 모두 통과했다. Phase 2의 96개 검증도 전체 실행에 포함됐다. 새 DTO 필드를 엄격한 기대값에 추가했고, I-3 통합 테스트는 복제 시 잘못된 8건을 기대하던 진단을 복제·JSON 후에도 실제 ENT009를 요구하는 회귀 검증으로 교체했다. 원본 객체 시험 및 분자 8건 확인도 유지했다. 기존 Festival audience 3→4 게이트의 8개 서비스 벡터, ENT009 제외와 평균 대기 26.25→10초 검증이 통과했다.

최종 빌드는 TypeScript와 Vite 8.4.0을 통과했다. 메인 JS는 1,097.13 kB(압축 326.14 kB)이며 기존 500 kB 기준 경고가 발생했다. 기존 공개 시그니처를 유지하고 승인된 `FestivalReadinessLink`와 `getFestivalReadinessLinks`를 추가했다. 패키지·설정, 프론트엔드와 배포 자산은 변경 범위에 포함하지 않았다. XES 실행 코드는 Node와 브라우저가 공유하는 로컬 UTF-8 토크나이저와 기존 정규화기를 사용한다.

## 성능 측정

macOS 15.7.7 arm64, Node.js v24.15.0, Vitest 4.1.12에서 합성 입력으로 `npm exec -- vitest bench --run tests/v03/engine.bench.ts`를 실행했다. 파일 I/O, 브라우저 업로드·렌더링, 실제 Festival 자산은 측정 범위 밖이다. XES 측정 입력 5,904,901 bytes는 동일 시각·중복 행 경고 경로를 포함하며, 50,000개 이벤트를 모두 수용했다.

| 작업 | 입력 | 평균 ms | p99 ms | 표본 |
|---|---|---:|---:|---:|
| XES 바이트 해석 및 정규화 | 1,000 traces, 50,000 point events | 805.64 | 976.37 | 8 |
| DFG + Performance + WTN | 850 cases, 10,200 events | 28.38 | 47.65 | 18 |
| Replay index | 850 cases, 10,200 events | 5.40 | 12.61 | 93 |
| Replay frame | index 재사용, 850 cases | 0.097 | 0.187 | 5,181 |
| Patterns | 4,250 matched intervals | 10.47 | 16.57 | 48 |
| FCFS 비교 실행 | 850 cases, 2→3 servers | 2.19 | 3.17 | 229 |

XES p99는 8회 표본의 최대치와 같다. 이 측정값은 브라우저 반응 시간이나 더 큰 파일의 처리량을 예측하지 않는다. [재실행 가능한 벤치마크](../../tests/v03/engine.bench.ts)

## Stage–Equipment 연결

**개별 연결 및 KPI 일관성 PASS.** 기존 Festival KPI와 신규 API는 같은 연결 인덱스, 관측 선택, 기한 해석과 판정 함수를 사용한다. 동일 `festival_id + performance_id`를 가진 유일한 Stage 사례에 Equipment를 연결한다. Audience와의 결합은 없다. [공통 계약 §3B](../../docs/V03_CONTRACT.md#3b-festival-stageequipment-readiness) · [교차 프로세스 테스트](../../tests/v03/festival-links.test.ts)

```ts
getFestivalReadinessLinks(
  traces: readonly Trace[],
  config: FestivalKPIConfig,
  processKey: 'stage' | 'equipment',
): FestivalReadinessLink[];

interface FestivalReadinessLink {
  festivalId: string | null;
  performanceId: string | null;
  linkStatus: 'linked' | 'missing_key' | 'missing_stage' | 'ambiguous_stage' | 'stage_scope_unavailable';
  stageCaseKey: CaseKey | null;
  equipmentCaseKey: CaseKey;
  stageSetupStart: EventEvidenceRef | null;
  stageReady: EventEvidenceRef | null;
  stageDeadlineMs: number | null;
  stageOnTime: boolean | null;
  equipmentReady: EventEvidenceRef | null;
  equipmentDeadlineMs: number | null;
  equipmentDeadlineSource: NonNullable<FestivalKPIConfig['equipmentDeadline']>;
  equipmentOnTime: boolean | null;
}
```

- **Equipment 선택**에서는 필터링된 Equipment 사례와 전체 Stage 후보 `config.linkedStageTraces`를 전달한다. 미연결·중복 상태를 포함해 선택된 장비당 한 행을 반환한다. 후보 범위 생략과 조회 결과가 빈 경우를 구분한다.
- **Stage 선택**에서는 필터링된 Stage 사례와 전체 Equipment 후보 `config.linkedEquipmentTraces`를 전달한다. 선택된 Stage에 유일하게 연결된 장비만 행으로 반환한다. Stage의 정시율은 장비 연결과 무관하게 선택된 Stage 전체를 집계하므로, 장비 링크 행을 Stage KPI의 전체 분모로 쓰지 않는다.
- 준비 이벤트와 Setup 시작은 `{ caseKey, timestampMs, sourceOrder }`를 반환한다. 시각 단위는 UTC epoch ms다. Stage 마감은 `scheduled_start`이며, Equipment 마감은 `required_ready_at` 또는 연결 Stage의 Setup 시작 시각이다. 관측이나 유효한 기한이 없는 쪽은 `null`이고, 같거나 이르면 `true`, 늦으면 `false`다. 자체 Equipment 기한은 Stage 연결 유무와 독립적으로 판정한다.

## Claude에 전달할 연결 지점

| 화면 | 엔진 출력 |
|---|---|
| Overview | `importXes(bytes, options)`의 `rejected` 또는 `parsed`와 `validation.canAnalyze`를 확인한다. `eventLocations`로 이벤트 오류를 원본 문서 위치에 연결한다. CSV/XES 모두 정규화된 `EventRow`를 `groupCases`에 전달한다. |
| Festival 연결 | `callEngine(api, 'getFestivalReadinessLinks', selectedTraces, festivalConfig, processKey)`로 호출한다. KPI와 같은 설정을 넘긴다. 범위 필터는 선택 프로세스에만 적용하며, 이벤트는 전체 데이터셋의 `traceByKey`에서 사례 키와 `sourceOrder`로 찾는다. Equipment에서 개별 상태를 표시하고, Stage의 빈 출력은 유일 연결 장비가 없다는 의미로 표시한다. |
| Analysis / Design | `DFG.startCases/endCases`, `transitionCoverage`, handoff `activityPairs`, `getActivityEvidence`를 사용한다. Finding ID는 보존하고 UI 분기에는 `rule`, `definition`, `evidenceKind`를 사용한다. |
| Model | BPMN의 선택 프로세스를 중립 `BpmnReference`로 변환해 `getBpmnComparison`을 호출한다. Parallel, inclusive, subprocess 및 복합·조건부 지원 외 요소를 중립 DTO에서 `unsupported`로 표시한다. |
| Implementation | `scoreAutomation`의 근거 종류·분모, 적합성 및 위험 게이트를 표시한다. `estimateBenefit`의 시간, 잠재 가치, 실현 가정과 비용·ROI를 구분한다. |
| Refine | `extractQueueInputs`의 제외 사례와 `compareQueues`의 기본·후보 출력, 서버 수와 nullable staffing을 사용한다. Festival preset은 기존 함수를 사용한다. |
| Monitor | `getHistoricalTrends`, `getCaseThroughput`, `getTransitionDrift`를 사용한다. 설정 가능한 KPI 목표는 `definitionKey`를 함께 저장한다. |
| Replay / Patterns | `buildReplayIndex`를 사례 범위에서 재사용하고 커서 이동마다 `getReplayFrame`을 호출한다. `getPatternEvidence`의 사례·관측 예시를 표시한다. |

XES MIME/확장자와 파일 크기 사전 확인, 제외 동의 UI, 브라우저에서 네트워크 요청 검증, BPMN Modeler 왕복, 최종 Festival 자산으로의 검증은 통합 작업에 남았다. XES의 브라우저 응답성을 확인할 때는 한도 근처 입력과 축소 사례를 모두 측정할 수 있다.

## 변경 파일

- 기존 엔진 `audience.ts`, `discovery.ts`, `festival-kpis.ts`, `findings.ts`, `index.ts`, `ingestion.ts`, `kpis.ts`, `metrics.ts`, `performance.ts`, `queue.ts`, `resources.ts`, `traces.ts`.
- 신규 엔진 `activity-evidence.ts`, `automation.ts`, `bpmn-comparison.ts`, `completion.ts`, `festival-readiness.ts`, `generic-queue.ts`, `history.ts`, `patterns.ts`, `replay.ts`, `time.ts`, `transition-drift.ts`, `xes-xml.ts`, `xes.ts`.
- 기존 테스트 `tests/engine-plan.test.ts`, `tests/engine-review-regression.test.ts`, `tests/integration/phase-2-integration.test.ts`, `tests/phase-0.test.ts`.
- 신규 테스트 및 fixture `tests/v03/{a1.test.ts,a2.test.ts,b.test.ts,festival-links.test.ts,fixtures.ts,engine.bench.ts}`, `tests/fixtures/v03/{parity.csv,parity.xes}`.
- 후속 공통 계약 및 보고서 `docs/V03_CONTRACT.md`, `src/v03-contracts.ts`, `reports/evidence/phase-3-engine.md`.
