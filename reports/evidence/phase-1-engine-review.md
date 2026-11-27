# Phase 1 분석 엔진 최종 검수

2026-11-27 KST · `feat/engine` · Phase 0 기준 `12eb710` · Node.js v24.15.0 · npm 11.12.1

## 판정

**NO-GO — Phase 1 엔진 완료 승인 및 릴리스 기준.** 기존 자동 테스트 33개와 프로덕션 빌드는 통과했다. 새 입력을 사용한 독립 검증 23건에서는 15건이 기대값과 일치하고 8건이 달랐다. 정확히 28%인 비율을 최대 28% 목표의 위반으로 표시하고, 서로 다른 축제의 동명 리소스 구간을 한 리소스로 합친다. 두 문제는 각각 모니터링 판정과 리소스 근거에 영향을 준다. API 및 UI 파일 경계는 Phase 0과 호환된다.

## 검수 기준 및 기능별 판정

`REQUIREMENTS.md`의 P0 범위와 `FUNCTIONAL_SPEC.md`의 F01–F08 출력·인수 조건을 먼저 대응시켰다. `DATA_SCHEMA.md` §6의 정규 규칙과 §7–8의 시뮬레이션·KPI 정의, `ENGINE_CONTRACT.md`의 공개 경계, `TEST_PLAN.md`의 수기 기대값으로 엔진을 대조했다. PASS는 엔진 범위에서 명세 및 검증값 일치, PARTIAL은 핵심 계산이 동작하지만 관측된 경계나 필수 근거에 결함이 있음, FAIL은 명시된 판정 규칙의 반례가 재현됨을 의미한다.

| P0 기능 및 기준 | 판정 | 구현과 검수 결과 |
| --- | --- | --- |
| F01 CSV 검증·정규화, §6, T05·T08 | **PARTIAL** | [ingestion.ts](../../src/engine/ingestion.ts#L27) `validateAndNormalize`, `parseTimestamp`. 컬럼 매핑, 원본 속성, UTC 변환, 원본 순서, 중복·필수값·달력·lifecycle 검증, 제외 동의가 동작한다. 역순 Audience 증거 중 일부는 timestamp 경고 없이 통과한다(Q21). |
| F01 Case 그룹화·시각 정렬, §4·6, T05–T07 | **PASS** | [traces.ts](../../src/engine/traces.ts#L9) `groupCases`, `compareEvents`, `buildCaseKey`. `[processType, caseId]` 직렬화, 시각→원본 행 순서로 정렬, 시작 전용 케이스 보존을 확인했다(Q02·Q22). |
| F02c Lifecycle 매칭, §4·6, T04·T07 | **PASS** | [traces.ts](../../src/engine/traces.ts#L41) `matchLifecycle`. 케이스 안에서 활동·인스턴스 ID별 유일 쌍을 측정한다. 모호한 ID 없는 반복, 역순, 시작 단독은 서비스에서 제외한다. 발견 시퀀스에 완료와 점 이벤트를 유지한다(Q05·Q08). |
| F02a DFG·Start/End·Self-loop, T01·T02·T06 | **PASS** | [discovery.ts](../../src/engine/discovery.ts#L14) `buildDFG`. 케이스 내부 인접 활동의 방향별 횟수, 시작·종료, 반복 및 고유 근거 케이스를 반환한다. 서로 다른 프로세스의 혼합 호출을 거절한다(Q03·Q22). |
| F02b Variant, T01·T02 | **PASS** | [discovery.ts](../../src/engine/discovery.ts#L50) `getVariants`. 순서와 반복을 포함한 배열을 키로 사용하고 비어 있지 않은 발견 케이스를 분모로 삼는다. 서로 다른 길이의 케이스가 한 variant로 합쳐지는 경우의 평균도 확인했다(Q04). |
| F02c Case Duration·Bottleneck, §4, T04·T15 | **PASS** | [discovery.ts](../../src/engine/discovery.ts#L73) `getCaseDurations`, [performance.ts](../../src/engine/performance.ts#L4) `getPerformance`. 케이스 시작·종료 간 분, 인접 이벤트 간격, 쌍의 서비스, 완료→다음 쌍 시작 간격을 각각 집계한다. 음수 매칭 간격을 중첩으로만 집계한다(Q04·Q05·Q09). |
| F02d Resource Workload·Handoff, §6, T03·T15·T17 | **PARTIAL** | [resources.ts](../../src/engine/resources.ts#L55) `getResourceAnalysis`, `resourceIntervals`, `unionIntervals`. 원시·인스턴스·케이스·역할 및 인접 인계를 구하고, 미상·동일 리소스의 전이를 건너뛰며 방향별 케이스 키를 보존한다. 축제별 로컬 이름을 같은 리소스로 합치는 반례가 있다(Q16). |
| F06 KPI 계산·커버리지·시간대 처리량, §7–8 | **PARTIAL** | [kpis.ts](../../src/engine/kpis.ts#L74) `getKPIs`, `shiftMetrics`, [festival-kpis.ts](../../src/engine/festival-kpis.ts#L60) `stageKPIs`, `equipmentKPIs`, `equipmentReadiness`, `audienceKPIs`, `entryOutcome`, `entryThroughput`, [metrics.ts](../../src/engine/metrics.ts#L11) `caseMetric`. 대표 KPI, 명시 기한과 링크, 측정 커버리지가 일치한다. 빈 버킷·관측된 0과 N/A·역순 거절 처리에 차이가 있다(Q14·Q15·Q21). |
| F04·F06 Target Evaluation, T10, 엔진 계약 Targets | **FAIL** | [kpis.ts](../../src/engine/kpis.ts#L86) `evaluateTargets`, [metrics.ts](../../src/engine/metrics.ts#L29) `caseMetric`. 순서·방향·단위·N/A와 일반 등호는 일치한다(Q11). 실제 KPI 생성과 연결하면 7/25를 28.000000000000004%로 계산해 최대 28% 등호 조건을 위반으로 판정한다(Q17). |
| F02e·F07 Findings·개선 후보 | **PARTIAL** | [findings.ts](../../src/engine/findings.ts#L5) `getFindings`, [traces.ts](../../src/engine/traces.ts#L95) `hasRework`. 전이 종류별 평균 순위, 낮은 표본 표시, rework, workload, 목표 위반, Audience 대기와 조사 제안을 범위 및 측정값에 연결한다(Q07). 위반 케이스가 빠지고 인스턴스가 없는 케이스가 근거에 끼는 경우가 있다(Q18·Q19). |
| F04·F07 Gate 입력·Queue Simulation, §7, T09 | **PARTIAL** | [queue.ts](../../src/engine/queue.ts#L4) `getGateInputs`, `simulateGateQueue`. 명시 활동과 근거 있는 양수 서비스, 동일 벡터, FCFS, 가장 빠른 게이트와 인덱스 동률, nearest-rank p95, 전체 경과·처리량 및 오류 검증을 확인했다(Q12·Q13·Q23). 소수 초에서 대기 0이 극소 양수로 나온다(Q20). |

F03의 Design/BPMN, F05의 계획 적용 및 상태, F08의 다운로드와 재현 가능한 내보내기, F01의 CSV 프리뷰·동의 화면과 F02d의 그래프·드릴다운은 계약상 애플리케이션 통합 경로다. 엔진의 근거 DTO·시나리오 결과를 해당 경로에서 소비해야 한다. 이번 판정은 순수 엔진을 대상으로 하며 T10·T13·T14·T17의 화면 검증, T11·T12·T16 전체, 최종 Festival 데이터 및 배포 증거는 미검증이다. `npm run build`는 TypeScript에서 엔진을 검사하고 Vite에서 현재 React 진입점을 빌드한다.

## 새로운 입력과 손계산 결과

저장소 밖 임시 디렉터리에 공개 엔진 진입점을 TypeScript로 컴파일하고 새 fixture를 Node.js에서 실행했다. 기존 테스트와 fixture helper를 가져오지 않았다. CSV 구문에는 프로젝트의 PapaParse를 사용하고, 기대값은 아래 입력에서 수기로 계산한 상수로 비교했다. 반복소수의 표시 정밀도는 소수점 9자리이며, 등호와 0 대기의 실패는 원래 숫자로 비교했다. Q10 초안의 대체·재검사 분모는 준비 증거와 무관하게 발견 시퀀스가 있는 장비 케이스 3건으로 재확인했다.

### 손계산에 사용한 핵심 입력

- Q02–Q07의 시각 단위는 분이다. 케이스 `014`의 원본 행은 `Pack/start@6 R2, Pack/complete@7 R2, Cut/start@0 R1, Cut/complete@3 R1, Cut/start@3 R1, Cut/complete@4 R1, Hold@8 미상` 순이다. `Cut` 두 인스턴스와 `Pack`에는 각각 ID를 부여했다. `018`은 `Cut@10 R1, Cut@11 R1, Pack@20 R2, Hold@30 R3`, `020`은 `Cut@15 R2`, `030`은 시작만 있는 행 하나다.
- Q09의 busy 구간은 R7의 [0,7], [3,9]와 R8의 [2,4]다. 추가 [10,11] 구간은 시작 R7, 완료 R9다. 교대의 합집합은 R7 [1,8]∪[10,12], R8 [0,6]이다. 가용 15분 중 9분이 측정 활동과 겹치고, R7의 2분이 교대 밖이다.
- Q13의 원본 입력 배열을 섞어 제출했다. `sourceOrder`로 정렬한 (도착 초, 서비스 초)는 `(0,8),(0,5),(1,3),(2,7),(3,2),(10,4),(10,6)`이다. 2게이트 대기 초는 `0,0,4,6,5,0,4`, 3게이트는 `0,0,0,2,2,0,0`이다. 따라서 각 평균은 19/7초와 4/7초이며, 종료는 20초와 16초다.

| 사례 | 손계산 기대값 | 실제 엔진 결과 | 판정 |
| --- | --- | --- | --- |
| Q01 매핑·시간대·유효 행 | 별칭 CSV 5행 중 2행 유효. `009` 및 `Check, left` 유지. `12:30:15.250+05:30`과 `07:00:15.250Z` 동률. 사용자 지정 `UNSET`만 미상이며 리소스 `NONE` 유지. 잘못된 윤일·빈 case·`resume` 3행 제외. 동의 전 불가, 후 가능. | 동일. `trimmed_value`, `timestamp_tie`, `invalid_timestamp`, `missing_required`, `invalid_lifecycle` 및 정확한 원본 행 위치. | PASS |
| Q02 정렬·시작 전용 | `014` 순서 `2,3,4,5,0,1,6`, 발견 `Cut,Cut,Pack,Hold`. `030` 시퀀스는 빈 배열. | 동일 | PASS |
| Q03 DFG | Cut/Pack/Hold 5/2/2회. Cut→Cut, Cut→Pack, Pack→Hold 각 2회. 시작 Cut 3, 종료 Hold 2·Cut 1. | 동일 | PASS |
| Q04 Variant·경과 | 두 variant 2/3·1/3, 평균 14·0분. 케이스별 8·20·0·0분, 전체 평균 7분. | 동일 | PASS |
| Q05 서비스·간격 | 유효 쌍 3, Cut 서비스 평균 (3+1)/2=2분. 매칭 Cut→Cut 0·Cut→Pack 2분. 인접 Cut→Pack (3+9)/2=6분, Pack→Hold 5.5분. | 동일 | PASS |
| Q06 workload·handoff | R1 원시 6·인스턴스 4, R2 원시 4·인스턴스 3, R3 원시/인스턴스 1. 알려진 커버리지 11/13·8/9. R1→R2 2회 `014,018`, R2→R3 1회 `018`. | 동일 | PASS |
| Q07 Findings 대표값 | 인접/매칭 최고 평균 6·2분, 둘 다 low. 반복 2/3, R1 인스턴스 4·알려진 표본 8, 평균 경과 7분의 최대 6분 목표 위반. | 동일 | PASS |
| Q08 lifecycle 경계 | `Retry`의 시작 2개/완료 1개는 모호 1그룹. `Reverse` 8→5는 두 행 경고. `Instant` 9→9는 유효 1쌍 및 동률. 시작 단독 경고 1회. 완료 3개 유지. | 동일 | PASS |
| Q09 교대 및 중첩 | R7/R8/R9 활동 9·2·N/A분, 활용 9/15=60%, 교대 밖 2분, n/eligible 2/3, 매칭 중첩 1건. | 동일 | PASS |
| Q10 Stage·Equipment 연계 | Stage 준비 5분, 정시 및 재점검 각 50%. 장비 lead 5·3분 평균 4, 대체·재검사 각 1/3, 같은 공연 ID라도 축제별로 비교해 미연결 1건 및 정시 1/2. | 동일 | PASS |
| Q11 Audience KPI·일반 목표 | 대기 (2+5)/2=3.5분, 성공 경과 7분, 수동/거절 각 50%·표본 2. 최대 3.5, 최소 4, 단위 불일치, N/A 목표는 각각 met/breached/unknown/unknown. | 동일 | PASS |
| Q12 Gate 입력 | `AQ1` 합류 2분, 검표 5→6분, 이후 거절. 관측 서비스 60초로 포함. `AQ2`는 관측 서비스 없음, `AQ3`는 합류 없음. 가정 17초는 `AQ1,AQ2`에 적용. | 동일 | PASS |
| Q13 FCFS 2·3게이트 | (평균, p95, 최대, 종료) 초 및 시간당 처리량은 2게이트 (19/7,6,6,20),1260 및 3게이트 (4/7,2,2,16),1575. | 동일 | PASS |
| Q14 중간 빈 처리량 버킷 | 앵커 0분, 폭 10분, 완료 @4·23분. 시작 0·10·20분의 건수 1·0·1, 평균 2/3. | 평균 2/3. 반환 버킷 0·20분의 1·1만 존재. | FAIL |
| Q15 관측 구간의 0 | 대기열 합류 @1분, 거절 @4분의 확인된 시도 1건. 해당 10분 버킷 내 기록된 완료 0건. | `value: null`, `buckets: []`. | FAIL |
| Q16 축제 간 동명 리소스 | 서로 다른 축제·다른 역할의 로컬 `Local Crew`가 각각 [0,10]과 [5,10] 수행. 2개 리소스·합계 15분·각 1케이스. | 1개 리소스·10분·2케이스. | FAIL |
| Q17 목표 등호 | Stage 25케이스 중 7건 `Technical Recheck` → 28%. 최대 28% → met. | 28.000000000000004%, breached. | FAIL |
| Q18 목표 위반 근거 | `Late` 준비 @18분, 기한 @12분. 정시율 0%, n=1, 최소 80% 위반 근거 `Late`. | 0%, n=1, `caseKeys: []`. | FAIL |
| Q19 인스턴스 집중 근거 | R7 `Finished` 완료 1건, `Started` 시작 1건. 인스턴스 1건의 근거는 `Finished`. | 인스턴스 1건, `caseKeys: [Finished, Started]`. | FAIL |
| Q20 소수 초 0 대기 | 1게이트, (도착, 서비스) 초 `(0,0.1),(0.1,0.2),(0.3,0.05)`. 최댓값 0분. | `9.251858538542971e-19`분. | FAIL |
| Q21 역순 Audience 결과 | 검표 @8–9분, 거절 @10분, 대기열 합류 @11분. 음수 대기 경고, KPI 대기 N/A, 시간 순서가 무효인 결과는 알려진 거절 분모에서 제외. | timestamp 경고 없음, 대기 N/A, 알려진 거절 분모 1 및 거절률 100%. | FAIL |
| Q22 키와 범위 | 구분자 문자가 있는 `['x","y','z']`와 `['x','y","z']`는 분리. 혼합 DFG 거절. | 동일 | PASS |
| Q23 시뮬레이션 오류 | 빈 입력, 게이트 0, 비정수 게이트, NaN 도착은 모두 RangeError. | 동일 | PASS |

## 결함 및 심각도

| ID / 심각도 | 문제와 영향 | 위치 및 재검증 기준 |
| --- | --- | --- |
| QA-01 / **High** | 백분율 산술 오차가 정확한 목표값을 위반으로 만든다. Monitor와 Findings에 거짓 경보가 생긴다. | Q17. [metrics.ts](../../src/engine/metrics.ts#L29) `caseMetric`의 `sum / n * 100`, [kpis.ts](../../src/engine/kpis.ts#L86) `evaluateTargets`의 직접 비교. 수학적 등호와 실제 임계값 초과를 각각 검증해야 한다. |
| QA-02 / **High** | 축제별로 다른 동명 리소스가 한 노드와 한 busy union으로 합쳐진다. workload·활동시간·교대 활용률의 정체성과 분모가 달라지고, 인계의 방향별 귀속에도 영향을 준다. | Q16. [resources.ts](../../src/engine/resources.ts#L13) `resourceIntervals`, [resources.ts](../../src/engine/resources.ts#L55) `getResourceAnalysis`, [kpis.ts](../../src/engine/kpis.ts#L8) `shiftMetrics`가 단일 문자열로 집계. §6의 동명 분리와 의도적 공유를 이벤트·교대에서 일관되게 검증해야 한다. |
| QA-03 / **Medium** | 처리량 시계열에 관측 기간 중 0건 버킷이 빠진다. 완료가 한 번도 없는 유효 거절 로그는 0건과 관측 부족을 구별할 수 없다. | Q14·Q15. [festival-kpis.ts](../../src/engine/festival-kpis.ts#L134) `entryThroughput`. 현재 완료 건만으로 버킷을 생성한다. Q14의 내부 공백은 평균에는 이미 반영된다. Q15의 관측 가능한 시작·끝 범위 정책은 문서에서 확정한 뒤, 기록된 0건과 로그 미수집 구간을 구별해 검증해야 한다. |
| QA-04 / **Medium** | 비율 목표 위반에서 근거 케이스가 빠진다. 정시율 0% 경보를 열어도 찾을 위반 케이스가 없다. 일부 정시 사례가 있어도 현 출력은 그 성공 키만 복사한다. | Q18. [metrics.ts](../../src/engine/metrics.ts#L30) `caseMetric`은 비율 분자 케이스만 담고, [findings.ts](../../src/engine/findings.ts#L74) `getFindings`는 이를 위반 근거에 그대로 사용. 0% 및 부분 위반 KPI의 드릴다운을 시험해야 한다. |
| QA-05 / **Medium** | 인스턴스 workload Finding의 근거에 시작만 수행한 케이스가 포함된다. 원시 workload 노드 드릴다운에는 타당한 키여도 인스턴스 수의 근거로는 부정확하다. | Q19. [findings.ts](../../src/engine/findings.ts#L45) `getFindings`에서 `ResourceSummary.caseKeys`를 그대로 사용. 인스턴스 근거와 원시 이벤트 근거를 각각 시험해야 한다. |
| QA-06 / **Medium** | 합류 전에 검표가 시작된 로그는 대기 KPI에서 빠지지만 시간 경고가 없고, 합류 전의 거절까지 알려진 결과로 센다. 잘못된 순서가 거절률 분모·분자에 들어간다. | Q21. [ingestion.ts](../../src/engine/ingestion.ts#L125) `validateAndNormalize`의 Audience 확인, [festival-kpis.ts](../../src/engine/festival-kpis.ts#L121) `entryOutcome`. 실제로 기록된 역순과 시각 자체가 없는 행을 구별해 검증해야 한다. |
| QA-07 / **Low** | 초 단위 소수의 누적 표현 오차로 무대기 케이스가 양수 대기로 나온다. 최대 대기 0 같은 엄격한 시나리오 기준에서 거짓 위반을 낼 수 있다. | Q20. [queue.ts](../../src/engine/queue.ts#L71) `simulateGateQueue`. 100·200·50 ms 서비스 경계 및 극소값 표시·평가를 검증해야 한다. |

## 기존 테스트의 신뢰성

- 기존 테스트는 3파일 33개다. `phase-0.test.ts` 13개 중 1개는 CSV 문법·원시 값 검사이고 12개는 공개 함수 계산 검사다. `engine-plan.test.ts` 15개와 `engine-festival.test.ts` 5개가 추가 계산과 경계를 검증한다. skip, only, TODO 테스트는 발견되지 않았다.
- 기존 기대값을 원시 행과 대조했다. T01의 평균 25분은 (30+20)/2, T04의 서비스 5·4 및 전이 3·7분은 각각 5−0, 12−8, 8−5, 12−5다. T09의 대기는 1게이트 0·3·6초 및 2게이트 0·0·2초다. 교대 시험의 65%도 13/20으로 맞는다. Phase 0 CSV의 두 케이스 평균은 (15+20)/2=17.5분이다.
- 수치 기대값은 리터럴, 손계산 비율 또는 단위 환산이다. 시간·케이스 키 helper는 입력 생성과 문자열 직렬화에 쓰인다. 테스트가 엔진 알고리즘을 복제해 숫자 기대값을 생성한 경우와, 제품 코드가 fixture의 ID·값을 특례 처리한 경우는 확인되지 않았다. Festival 활동 상수는 데이터 계약에서 정의한 명칭이다.
- 일부 단언은 검증 강도가 낮다. `phase-0.test.ts`의 그룹화 단언은 정규화 엔진 출력 행을 기대 객체 원본으로 재사용한다. 별도의 T05와 Q02가 원본 인덱스와 출력 순서를 직접 확인한다. `engine-festival.test.ts:157`의 빈 선택 KPI `.every()`는 빈 배열에도 참이어서 예상 지표 ID와 개수를 보장하지 않는다.
- 오류 경계는 잘못된 날짜, ID 중복, 제외 동의, 혼합 프로세스, lifecycle 모호성·역순, shift 누락·중첩, 잘못된 gate 입력과 p95 순위를 포함한다. 기존 Audience 처리량 단언은 sparse 출력 정책을 고정하며 대표 분모와 결과를 검증한다. 새 검수에서 재현한 등호·교차 Festival·근거 정확도·소수 초·관측 0은 기존 합격 집합의 사각지대다.
- `EngineNotImplementedError`는 공개 호환 클래스 선언으로 남아 있다. 공개 함수에서 해당 예외를 생성하거나 던지는 경로와 임시 분석값 반환은 확인되지 않았다. `ENGINE_CONTRACT.md` 첫 문단의 모든 함수가 예외를 던진다는 설명은 Phase 0 당시 상태다.

### 실행 기록

```text
npm test
RUN  v4.1.12
Test Files  3 passed (3)
Tests  33 passed (33)

npm run build
> tsc --noEmit && vite build
vite v8.4.0 building client environment for production...
✓ 16 modules transformed.
✓ built in 157ms

독립 Node.js 케이스
{"passed":15,"failed":8,"executed":23}
```

`TEST_PLAN.md` 대응은 T01–T09 및 T15 엔진 통과, T10의 8분 값과 목표 변경 엔진 통과, T13·T14·T17의 일부 엔진 단언 통과다. T02의 P1 표기 임계값은 후속 범위다. T13의 현재 자동 테스트는 입력 행 변경에 따른 Findings를 확인하며, CSV 재업로드·DFG 재렌더링·내보내기까지 실행하는 통합 테스트는 별도로 필요하다. T16에서는 로컬 빌드만 실행했다.

## Phase 0 비교 및 병렬 개발 호환성

| 확인 항목 | 결과 |
| --- | --- |
| `src/contracts.ts` | 커밋 `12eb710`의 파일과 바이트 단위 동일 |
| 공개 함수 | TypeScript checker로 모듈 재내보내기를 해석하고 인자 수·순서·필수/가변 여부·타입·반환 타입을 비교했다. 공개 함수 12개 및 `EngineNotImplementedError` 생성자 시그니처가 기준과 일치했다. |
| Claude 담당 및 공통 설정 | `src/App.tsx`, `src/main.tsx`, components/pages/state/styles, TypeScript·Vite·CI·Netlify 설정과 패키지/lockfile의 기준 대비 diff가 비어 있다. 검수 기준 문서와 `AI_USAGE_LOG.md`의 diff도 비어 있다. |
| 추가 파일 및 라이브러리 | 기존 변경은 엔진 모듈, 테스트·fixture 설명, Phase 1 증거 범위다. 의존성 추가가 없다. 독립 QA 스크립트와 컴파일 결과는 저장소 밖 임시 디렉터리에 작성했다. |
| Git 제외 대상 | `git status --ignored=matching`에서 `node_modules/` 및 `dist/`는 ignored다. 두 경로와 `coverage/`, `.netlify/`에 추적 파일이 없다. |
| 검수 변경 범위 | 이 보고서를 작성했다. 제품 코드나 기존 테스트에 대한 패치 및 Git 이력 작업 없이 동일한 작업 트리를 검사했다. |

## 설계 차이와 프론트엔드 통합 주의사항

- `canAnalyze`를 분석 진입 조건으로 사용한다. 동의 대기 상태에서도 유효 행 미리보기용 `events`가 존재한다. PapaParse 구문 오류와 행 번호는 UI 파싱 경계에서 처리하고, Festival에서는 필수 process mapping 및 보조 필드를 연결한다. 사용자 지정 고정 오프셋은 현재 이벤트 timestamp에 적용된다. `scheduled_start`, `required_ready_at`는 명시적 시간대를 요구한다.
- `groupCases` 후 선택 프로세스 및 첫 이벤트 기준 필터를 적용해 케이스 전체를 전달한다. Equipment 연계는 동일 데이터셋의 `festival_id + performance_id` 조합으로 제공한다. 재점검 Findings에는 Festival별 활동 명칭을 명시한다.
- 축제 간 같은 표시 이름을 가진 리소스는 QA-02 해결 전까지 해당 이름이 같다고 동일 리소스로 취급할 수 없다. 데이터 준비 시 리소스와 교대에 동일한 안정 ID를 사용하고, 표시 이름은 분리한다. 그래프 및 테이블은 같은 `getResourceAnalysis` 결과를 사용한다.
- 활용률은 측정 구간과 유효 교대가 모두 있는 리소스에 대한 가중치 결과다. 관측 기간에 맞는 교대와 `n/eligible`을 함께 전달한다. Stage 점 마커 fallback, Equipment deadline 모드, Audience throughput 앵커와 버킷 폭을 메타데이터와 증거에 표시한다.
- Audience 처리량 값은 첫 완료~마지막 완료 버킷의 평균이고 DTO는 sparse하다. 드문 버킷 사이의 경과를 차트에서 한 칸으로 압축하면 시간이 왜곡된다. 관측 0과 근거 없음의 정책은 QA-03에서 확정해야 한다. QA-04·QA-05의 `caseKeys`를 모든 위반·인스턴스 케이스 목록으로 표시하면 드릴다운이 잘못된다.
- 시나리오 비교는 `getGateInputs`로 만든 동일 벡터를 두 게이트 수에 넘긴다. 관측 KPI와 시뮬레이션 결과의 단위·가정을 표시한다. 게이트 수 차이로 직원 가정 차이를 구하고, 데이터·필터·조건 변경 시 결과 무효화 및 계획 반영을 UI 통합에서 검증한다.
- 최종 Festival 데이터, T10–T14의 화면·내보내기, T16의 배포, T17의 그래프와 드릴다운이 남아 있다. **재승인 조건은 QA-01·QA-02 수정 후 회귀 확인, 나머지 판정 불일치의 처리 방침 확정, 최종 데이터와 통합 인수 시험이다.**
