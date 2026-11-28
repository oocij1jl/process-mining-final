# Phase 1.1 엔진 결함 수정 및 회귀 검증

2026-11-27 KST · `feat/engine` · 검수 기준 [Phase 1 엔진 최종 검수](phase-1-engine-review.md)

## 수정 전 확정한 정책

- **목표 비교.** 백분율은 분자에 100을 곱한 뒤 나눈다. 최대·최소 비교는 같은 부동소수점 상대 오차 기준을 사용한다. 고정 소수 자릿수 반올림 없이 수치 표현 수준의 인접값만 등호로 취급한다.
- **리소스.** `attrs.resource_id`의 비어 있지 않은 값은 데이터셋 내 명시적 공유 ID다. `festival_id`가 있는 행의 일반 `resource`는 축제별 로컬 이름이다. 단일 축제만 알려진 케이스의 비어 있는 행에는 해당 축제 ID를 적용한다. 축제 ID도 공유 ID도 없는 일반 로그는 원래 리소스 문자열을 사용한다. 축제별 로컬 키는 `@resource:` 뒤에 JSON 배열 `["festival", festival_id, resource]`를 붙이고 공유 키는 `["shared", resource_id]`를 붙인다. 다른 축제 ID가 혼재한 케이스에서 행의 축제를 특정할 수 없으면 `["unresolved", caseKey, resource]`를 사용한다. 예약 접두사로 시작하는 일반 리소스 문자열은 `["literal", resource]`로 구분한다. 교대의 `resource`는 해당 그래프 노드의 키와 일치해야 한다.
- **처리량.** 현재 계약은 버킷 폭과 정렬 앵커를 받는다. 선택한 Audience 케이스 중 유효한 대기열 합류 또는 알려진 입장 결과가 있는 케이스의 유효 이벤트 시각 범위를 로그 관측 구간으로 사용한다. 시작 버킷부터 끝 버킷까지 동일 범위의 기록된 완료 건수를 반환하고 평균은 전체 버킷 수로 나눈다. 범위 안의 0은 기록된 완료가 0건이라는 뜻이다. 로그 연속 수집이나 범위 밖의 실제 처리량은 관측 근거가 없다. `n`은 완료 건수로 유지한다. 유효한 로그 관측 근거가 없으면 `null`이다.
- **Finding 근거.** 이진 KPI의 원래 근거는 분자 케이스다. 최소 목표의 분석용 근거에는 유효 분모 중 분자에 포함되지 않은 케이스를 사용한다. 최대 목표는 분자 쪽을 사용한다. 연속 측정 및 교대 등 집계 지표는 집계 근거를 제공한다. 원시 workload와 발견 인스턴스 workload는 해당 이벤트 집합에서 근거를 추출한다.
- **Audience 순서.** 합류 시각보다 빠른 모델상 후속 행은 경고 대상으로 기록한다. 검표보다 이른 입장 완료나 서로 모순되는 결과도 경고한다. 관련 KPI가 유효하지 않은 증거를 제외하되 원시 행과 발견 시퀀스는 보존한다. 합류나 검표가 누락된 경우에는 확인 가능한 시간 관계만 검사한다. 관측 시뮬레이션에는 합류 이후 첫 유효 서비스 쌍을 계속 사용한다.
- **시뮬레이션 정밀도.** 입력 수의 십진 표현에 맞춘 공통 정수 틱으로 도착, 시작, 가용 시각, 대기를 계산한다. 출력 경계에서만 계약 단위의 숫자로 환산한다.

## 최종 판정

**GO — Phase 1 분석 엔진 검수 완료.** QA-01~QA-07의 실패 사례 8개가 통과했다. 전체 Vitest 62개, 별도 실행한 독립 검증 Q01~Q23, 프로덕션 빌드, Phase 0 공개 계약 호환성 검사를 통과했다. 실제 프론트엔드 연결, 최종 Festival 데이터와 배포 인수 시험은 별도 통합 단계에 남아 있다.

## 결함별 수정 전후

| 결함 | 수정 전 | 수정 후 및 검증 | 구현 파일 및 함수 |
| --- | --- | --- | --- |
| QA-01 목표 판정 | 재점검 7/25가 `28.000000000000004%`로 표시되고 최대 28%가 `breached`였다. | KPI는 28%, 양방향 등호는 `met`이다. 최대 목표 `28 - 1e-12` 및 최소 목표 `28 + 1e-12`는 각각 `breached`다. 양수 측정값과 0 목표도 구분한다. | [metrics.ts](../../src/engine/metrics.ts) `caseMetric`, `compareMeasured`, [kpis.ts](../../src/engine/kpis.ts) `evaluateTargets`, `shiftMetrics` |
| QA-02 리소스 식별 | F1/F2 동명 리소스가 1개 노드·10분으로 합쳐졌다. | F1 10분과 F2 5분을 2개 노드로 반환한다. 같은 축제의 로컬 ID와 명시적 공유 ID는 각각 병합하며, 동일 키를 busy union·인계·그래프 근거·교대에서 사용한다. 추가 사례의 교대 활용률은 23/40=57.5%다. | [resource-identity.ts](../../src/engine/resource-identity.ts) `resourceKeyForTrace`, [resources.ts](../../src/engine/resources.ts) `getResourceAnalysis`, `resourceIntervals`, [kpis.ts](../../src/engine/kpis.ts) `shiftMetrics` |
| QA-03 처리량 버킷 | 중간 빈 버킷이 빠지고, 거절만 있는 기록은 `null`이었다. | 0·10·20분 시작 버킷의 건수는 1·0·1, 평균은 2/3이다. 관측된 거절만 있는 범위는 0을 반환한다. 유효 관측 근거가 없는 경우는 `null`과 사유를 반환한다. | [festival-kpis.ts](../../src/engine/festival-kpis.ts) `entryThroughput`, `audienceKPIs` |
| QA-04 목표 Finding 근거 | 정시율 0%, 최소 목표 80%의 위반 Finding에 케이스가 없었다. | Finding에 유효한 지연 케이스 `Late`가 나타난다. 혼합 케이스에서 최소 정시율은 지연 케이스, 최대 재점검율은 실제 재점검 케이스에 연결한다. 근거 누락 케이스는 분모와 문제 사례에서 제외한다. | [metrics.ts](../../src/engine/metrics.ts) `caseMetric`, `targetEvidence`, [findings.ts](../../src/engine/findings.ts) `getFindings` |
| QA-05 workload Finding 근거 | 시작 전용 `Started`가 완료 인스턴스 Finding에 포함됐다. | 인스턴스 근거는 `Finished`만 반환한다. 그래프 노드는 원시 사건이 있는 `Finished`와 `Started`를 모두 제공한다. 원시 workload Finding은 시작 사건의 케이스도 제공한다. | [findings.ts](../../src/engine/findings.ts) `getFindings`, [resources.ts](../../src/engine/resources.ts) `getResourceAnalysis` |
| QA-06 Audience 순서 | 합류 11분보다 이른 검표 8–9분과 거절 10분에 경고가 없고 알려진 거절 분모는 1이었다. | Festival 모드에서 원본 행 1–3에 시간 경고가 생긴다. 대기와 입장 결과 KPI의 유효 관측 수는 0이다. 동일 행·시간·원본 순서를 보존하고, 합류가 단순 누락된 케이스의 알려진 결과와 구별한다. | [audience.ts](../../src/engine/audience.ts) `audienceTimeline`, [ingestion.ts](../../src/engine/ingestion.ts) `validateAndNormalize`, [festival-kpis.ts](../../src/engine/festival-kpis.ts) `audienceKPIs` |
| QA-07 큐 소수 정밀도 | 무대기 입력의 최대 대기가 `9.251858538542971e-19`분이었다. | 평균·p95·최대가 정확히 0이다. 별도 입력은 실제 0.1µs 대기를 보존한다. 동일 도착과 2·3게이트 FCFS의 p95 및 처리량이 기존 수기값과 일치한다. | [queue.ts](../../src/engine/queue.ts) `decimal`, `simulateGateQueue` |

### 정책의 실행 세부 사항

- `compareMeasured`는 양방향에 `Number.EPSILON × max(|측정값|, |목표값|)`의 상대 허용치만 적용한다. 고정 절대 허용치나 표시 자릿수 기준 반올림은 사용하지 않는다. 표현 오차와 같은 크기의 값 차이는 등호에 포함되는 수치 정책이다.
- `resource_id`는 운영 측에서 동일 리소스에 명시적으로 제공하는 안정 ID다. 표시 이름이 같아도 공유 ID가 없으면 `festival_id`가 각 로컬 공간을 구분한다. 교대는 리소스 그래프와 동일한 키를 사용하며, 여러 축제에 동일한 표시 이름의 교대를 암묵적으로 배분하지 않는다. 누락된 축제 범위가 케이스에서 유일하게 확인되면 그 범위를 사용한다.
- 처리량의 첫·끝 버킷은 유효 로그 이벤트 범위를 UTC 앵커에 정렬한 결과다. 각 버킷은 시작 포함·끝 제외이며 경계 버킷도 반환한다. `value = 기록된 유효 완료 수 / 반환 버킷 수`이고 `n`은 유효 완료 수다. 기존 Festival 테스트는 완료 버킷 범위 5개와 희소 버킷 2개로 평균 0.4를 기대했다. 유효 합류 @0분부터 끝 이벤트 @50분까지 범위를 사용하면서 손계산 정답은 2/6 및 버킷 6개가 됐다. 이전의 두 비어 있지 않은 버킷의 경계와 케이스 단언을 유지했다. 비정상적으로 넓은 구간이나 촘촘한 폭으로 배열이 100,000개를 넘으면 폭 또는 범위를 조정할 수 있도록 `null`과 사유를 반환한다.
- KPI 숫자와 KPI `caseKeys`는 기존 DTO로 전달한다. 원래 객체의 이진 지표 문제 사례는 엔진 내부의 약한 참조로 보관한다. Finding의 문구는 집계 목표 비교와 검토용 근거를 설명한다. 같은 KPI에서 성공 사례와 실패 사례를 구분할 수 있으며, 합계나 평균이 위반이라는 이유로 전체 케이스에 개별 위반을 부여하지 않는다.
- 큐는 각 `number` 입력의 십진 문자열에서 필요한 자릿수를 구하고 상대 시간 계산을 `BigInt` 틱으로 수행한다. FCFS 정렬은 도착·원본 순서, 게이트 선택은 가장 이른 가용 시각·게이트 인덱스다. nearest-rank p95와 출력 분 단위 및 시간당 처리량을 유지한다. 출력값은 기존 `number` 범위와 정밀도를 따른다.

## General Core와 Festival 어댑터

| 범위 | 구현 경계 |
| --- | --- |
| General Core | CSV 매핑·정규화, 정렬·lifecycle, DFG, Variant, Performance, Workload·Handoff, 목표 비교, 근거 기반 Findings, elapsed 및 shift KPI는 임의의 활동 문자열을 처리한다. Resource 분석은 입력 메타데이터에서 해석된 불투명 키를 사용한다. 공유 ID와 로컬 범위가 없는 일반 CSV는 기본 리소스 ID를 사용한다. |
| Festival KPI 및 시간 검증 | `getKPIs`는 `KPIContext.festival`을 제공한 호출에서만 Festival KPI와 관련 시간 규칙을 계산한다. 가져오기 경고는 기존 `ImportOptions`에서 `requireProcessType: true`와 명시적 `mapping.festival_id`를 함께 설정하여 활성화한다. 이 설정의 Audience 프로세스에서만 활동 시간 경고를 적용한다. `process_type: audience` 및 동일 활동명만 있는 일반 로그의 분석은 범용 경로를 따른다. Audience 대기 개선 후보는 Festival KPI 출력에 근거한다. |
| Queue Simulation | [audience.ts](../../src/engine/audience.ts)의 `getGateInputs`는 Festival 입장 벡터 추출이다. [queue.ts](../../src/engine/queue.ts)의 `simulateGateQueue`는 준비된 `GateInput[]`와 서버 수만 사용하며 Festival 활동명·프로세스·메타데이터에 의존하지 않는다. |
| 일반 데이터 검증 | [Order Processing CSV](../../tests/fixtures/order-processing-event-log.csv) 11행으로 Festival 컬럼 없는 정규화, 케이스 3건, 평균 9분, variant 2/3·1/3, 지불 서비스 2분, 포장→출하 평균 5.5분, 담당자 인계, 타깃과 Findings를 확인했다. 출력 KPI는 공통 3개였다. 준비된 주문 처리 도착·서비스 벡터로 범용 큐도 검증했다. |

### 향후 인터페이스 제안

- 범용 KPI는 선택적 `KPIDefinition`에 지표 ID, 단위, 적격 조건, 집계 방식과 이진 지표의 양성 조건을 명시하는 타입을 검토할 수 있다. DTO를 저장하거나 복제한 뒤에도 설명을 보존할 수 있도록 유효 분모와 방향별 근거를 별도 계약으로 제공할 수 있다.
- 사용자 지정 시뮬레이션에는 `extractQueueInputs(traces, { arrival, service })`를 추가하는 방안을 제안한다. `arrival`은 활동명과 사용할 lifecycle, `service`는 활동명과 관측 매칭 또는 명시 가정을 지정한다. 기존 `getGateInputs`는 Festival 설정을 사용하는 어댑터가 되고 `simulateGateQueue`는 현재 입력을 받아 동작한다. 이 제안은 인터페이스에 반영하지 않았다.

## 회귀 테스트 및 독립 재검증

- [engine-review-regression.test.ts](../../tests/engine-review-regression.test.ts)에 Q01~Q23 전체를 손계산 단언으로 저장했다. Q14~Q21을 재현하는 각 단언 외에 로컬·공유 교대, 방향별 Finding 근거, Festival 순서 검증의 opt-in, 앵커·버킷 크기 경계를 추가했다.
- [engine-general.test.ts](../../tests/engine-general.test.ts)에 일반 CSV 분석과 준비된 범용 큐 벡터의 테스트 2개를 추가했다. [engine-festival.test.ts](../../tests/engine-festival.test.ts)의 빈 선택은 정확한 KPI ID 8개, 각 `null`, 표본·적격 0 및 비어 있지 않은 사유를 확인한다.
- 기존 33개는 수정 후에도 통과했다. 변경한 기존 단언은 확정한 관측 구간에 따른 처리량과 빈 KPI 검사이며, 기존 Festival의 원본 시간 경고 테스트에는 명시적 가져오기 설정을 제공했다. 추가 테스트 총 29개가 fixture에 독립적인 검증 범위를 넓힌다.
- 기존 독립 스크립트를 임시 디렉터리에 복사하고 공개 진입점을 다시 컴파일하여 실행했다. Q21에 명시적인 Festival import 설정을 전달했다. 원본 입력 행과 Q01~Q23의 수기 기대 결과는 유지했다.

| 독립 사례 | 재검증 결과 |
| --- | --- |
| Q01·Q02 | PASS. CSV 매핑, 유효 2/5, 선택 리소스 누락값, 원본 순서 및 시작 전용 시퀀스. |
| Q03·Q04·Q05 | PASS. DFG 횟수, Variant 2/3·1/3과 평균 14·0분, 케이스 시간, 구분된 서비스·전이 유형. |
| Q06·Q07·Q08·Q09 | PASS. workload·인계 커버리지, Findings 수치, lifecycle 경계, 교대 활용 60%와 교대 밖 2분. |
| Q10·Q11·Q12·Q13 | PASS. Stage/Equipment 연계, Audience KPI·단위 판단, 관측/가정 벡터, 2·3게이트 종료 20초·16초. |
| Q14 | PASS. `[0분:1, 10분:0, 20분:1]`, 평균 2/3. |
| Q15 | PASS. 관측된 거절 범위에서 완료 0, 버킷 건수 0. |
| Q16 | PASS. 축제별 로컬 2개, 활동 시간 합계 15분. |
| Q17 | PASS. 28%와 최대 28% 목표는 `met`. |
| Q18 | PASS. 정시율 0%, n=1의 최소 목표 Finding 근거 `Late`. |
| Q19 | PASS. 발견 인스턴스 1건, Finding 근거 `Finished`. |
| Q20 | PASS. 소수 초 무대기 입력의 최대 대기 0. |
| Q21 | PASS. timestamp 경고 있음, 대기 N/A, 유효 거절 분모 0. |
| Q22·Q23 | PASS. 충돌 없이 케이스 분리, 혼합 DFG와 비정상 큐 입력 거절. |

### 실제 실행 결과

```text
npm test
RUN  v4.1.12
Test Files  5 passed (5)
Tests  62 passed (62)

npm run build
> tsc --noEmit && vite build
vite v8.4.0 building client environment for production...
✓ 16 modules transformed.
✓ built in 258ms

독립 Node.js 검증
{"passed":23,"failed":0,"executed":23}
```

Phase 0 커밋 `12eb710`과 TypeScript checker로 비교해 공개 함수 12개와 호환 클래스 생성자의 인자·반환 타입이 일치함을 확인했다. `src/contracts.ts`는 바이트 단위로 일치한다. Claude 소유 경로, 공통 빌드 및 패키지 설정, `ENGINE_CONTRACT.md`, `TEST_PLAN.md`, `AI_USAGE_LOG.md`의 기준 대비 diff는 비어 있다. `git diff --check`도 통과했다.

## Claude 통합 주의사항 및 한계

- Festival 업로드 어댑터에서 `process_type`과 `festival_id`를 매핑하고 필수 프로세스 옵션을 활성화한다. KPI 및 검수 화면에는 명시적인 `KPIContext.festival`을 전달한다. 일반 업로드는 기본값으로 범용 경로를 사용한다.
- Graph와 인계 표는 같은 리소스 분석을 사용한다. 선택, 집계, 교대 연결은 반환된 리소스 키로 하고 표시 이름은 사용자에게 읽기 쉬운 별도 레이블로 사용한다. `resource_id` 할당과 `ResourceShift.resource` 입력은 동일 키 정책으로 준비한다. 축제나 리소스의 정체성이 입력에 없는 경우 자동으로 추론할 근거가 없다.
- 같은 범위의 원래 `Metric` 객체를 `getFindings`에 전달한다. JSON 직렬화나 값 복제 후에는 KPI를 현재 데이터에서 재계산해야 전용 문제 사례를 복원할 수 있다. 기존 DTO만으로 복원 시에는 제공된 집계 근거를 사용한다.
- 처리량 0은 해당 로그 범위에서 기록된 완료 0건이다. `null`은 유효 근거 또는 지원 범위 부족이며 이유를 함께 표시한다. 캡처 중단 시각이나 운영 시간은 현재 계약에 없으므로 실제 처리량을 추정할 수 없다.
- 현재 검증 범위에서 QA-01~QA-07 잔존 실패는 확인되지 않았다. 최종 Festival 로그와 교대 파일, React 그래프·Findings 드릴다운·Monitor, 시나리오 계획 적용 및 배포는 통합 시험 대상이다.
