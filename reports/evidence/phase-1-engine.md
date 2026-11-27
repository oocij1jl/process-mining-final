# Phase 1 엔진 개발 증거

2026-11-27 KST · `feat/engine` 워크트리 · Node.js v24.15.0 · npm 11.12.1

`docs/`의 설계 문서 10개, `src/contracts.ts`, 기존 엔진 진입점과 Phase 0 검수 기록을 검토했다. `src/engine/index.ts`의 공개 함수 12개에 P0 계산을 연결했다. 수기 검증용 CSV와 테스트 내 합성 행을 사용했다.

## 구현 기능

| 기능 | 계산과 근거 |
| --- | --- |
| CSV 검증 및 정규화 | 헤더 매핑으로 문자열 행을 정규화한다. 달력상 유효한 날짜와 명시적 UTC 오프셋을 검증하고, 고정 오프셋은 사용자가 제공한 경우에 적용한다. 원본 timestamp, 원본 행 순서, 매핑되지 않은 속성을 보존한다. 필수값, 잘못된 lifecycle, 중복 ID 등은 행별로 보고하고 유효 부분집합 분석에 제외 동의를 요구한다. |
| 케이스와 lifecycle | 프로세스와 케이스 ID를 함께 키로 사용한다. 시각이 같으면 CSV 순서를 따른다. 완료와 점 이벤트로 발견 시퀀스를 만들고, 시작 행은 경과 및 서비스 측정에 사용한다. 누락·모호·역순 매칭과 빈 발견 케이스를 보고한다. |
| 발견과 성능 | DFG의 활동, 시작·종료, 인접 전이, 자기 루프와 근거 케이스를 집계한다. 정확한 활동 배열로 variant를 식별한다. 케이스 경과, 인접 이벤트 차이, 매칭 서비스, 완료에서 다음 매칭 시작까지의 차이를 각각 계산한다. 음수 매칭 전이 간격은 중첩으로 집계한다. |
| 리소스 | 원시 이벤트, 발견 인스턴스, 활동 분포, 고유 케이스, 역할과 커버리지를 집계한다. 인접한 두 알려진 리소스가 다르면 방향별 인계를 센다. 리소스가 일치하는 lifecycle 구간을 합친다. 교대 데이터로 가용 시간을 합치고, 교대 안의 활동과 교대 밖의 활동을 계산한다. |
| KPI와 목표 | 일반 로그의 케이스 경과와 리소스 지표를 계산한다. Festival 설정이 제공되면 Stage의 준비·정시 준비·재점검, Audience의 대기·입장 경과·수동 확인·결과·시간대 처리량, Equipment의 리드타임·대체·재검사·정시 준비·미연결 건수를 계산한다. 목표는 ID, 단위, 방향, 값을 기준으로 평가한다. |
| Findings | 측정 유형별 가장 긴 평균 전이, 반복 활동, 리소스 집중, Audience 대기, 목표 위반에서 조사 후보를 만든다. 데이터셋·프로세스·필터 범위, 값·단위·표본 수, 케이스와 필요한 경우 전이를 연결한다. 전이 표본이 3개 미만이면 낮은 근거 수준을 표시한다. |
| 게이트 시뮬레이션 | 입장 대기열에 합류한 케이스에서 관측 또는 가정 서비스 수요를 추출하고 제외 이유를 제공한다. 동일 벡터에 대해 게이트 수를 바꿔 FCFS 대기 평균·p95·최댓값, 경과 종료 시간, 시간당 처리량을 계산한다. |

## 구현 결정과 확인한 제약

- CSV 문법 파싱과 원시 미리보기는 UI의 PapaParse 경계에 있다. 엔진 입력은 그 경계에서 파싱된 문자열 행이다. 필수 컬럼은 호출자가 매핑하고, 선택 컬럼 매핑을 추가하면 정규화에 사용한다. 미매핑 속성은 원래 헤더를 유지한다.
- 중복 `event_id`는 첫 원시 등장 이후의 행을 제외 대상으로 표시한다. ID가 없는 동일 행은 경고와 함께 유지한다. 인스턴스 ID가 없는 lifecycle 행은 동일 케이스·활동의 ID 없는 그룹에서 유일하게 짝지을 수 있을 때 서비스 시간을 제공한다. 단독 완료는 유효한 발견 마커로 남긴다.
- 보조 기한 속성 `scheduled_start`, `required_ready_at`에는 명시적 ISO 시간대를 사용한다. 고정 오프셋 옵션은 이벤트 timestamp에 적용한다. 같은 케이스에 서로 다른 기한이 기록되거나 동일한 Festival·공연 키에 Stage 케이스가 여러 개 연결되면 그 근거는 해당 KPI에서 제외한다.
- 비율과 활용률의 단위는 `%`다. 활용률은 일치하는 소유 리소스, 측정 구간과 유효 교대가 모두 있는 리소스의 교대 시간으로 가중한다. `n`은 계산에 포함된 리소스 수이고 `eligible`은 선택 로그의 알려진 리소스 수다. 원시 workload는 별도로 제공한다.
- Audience 처리량의 `value`는 첫 완료 버킷부터 마지막 완료 버킷까지의 버킷당 평균 완료 건수다. 중간 빈 버킷은 평균에 포함되고, `buckets` 시계열은 완료가 기록된 버킷의 경계와 근거를 제공한다. 버킷은 시작 포함, 종료 제외다.
- 관측 서비스는 대기열 합류 시각부터 시작 가능한 구간 중, 지정된 활동의 첫 번째 유효한 양수 매칭 구간이다. 가정 모드는 유효한 합류 기록 모두에 제공된 초 단위 서비스 수요를 적용한다. 단순 완료 시각이나 전체 입장 경과만 있는 경우 관측 서비스 근거가 부족하다.
- `ENGINE_CONTRACT.md`의 첫 문단은 Phase 0 당시의 placeholder 상태를 설명한다. Phase 1 계산은 그 문서의 확정 시그니처와 규칙을 구현했다.

### UI 연동용 KPI ID

| 범위 | ID |
| --- | --- |
| 공통 | `case_elapsed_mean`, `resource_utilization`, `resource_out_of_shift_minutes` |
| Stage | `stage_preparation_mean`, `stage_on_time_rate`, `stage_recheck_rate` |
| Audience | `audience_queue_wait_mean`, `audience_entry_elapsed_mean`, `audience_manual_verification_rate`, `audience_throughput`, `audience_completed_count`, `audience_completed_rate`, `audience_rejected_count`, `audience_rejected_rate` |
| Equipment | `equipment_lead_time_mean`, `equipment_substitution_rate`, `equipment_inspection_rework_rate`, `equipment_on_time_rate`, `equipment_unmatched_performance_count` |

경과와 시간 지표는 `min`, 비율은 `%`, 건수는 `cases`, Audience 처리량은 `cases/bucket`을 사용한다. 근거가 부족하면 `value: null`, `n`, `eligible`, `reason`을 반환한다. 같은 데이터셋의 연계 장비 케이스를 Stage KPI 설정에 전달하면 `equipment_on_time_rate`도 제공된다.

## 변경 파일

| 경로 | 변경 |
| --- | --- |
| `src/engine/index.ts` | 확정된 공개 진입점에 계산 함수 연결 |
| `src/engine/ingestion.ts`, `src/engine/traces.ts` | 검증, 정규화, 케이스 정렬, lifecycle 매칭 |
| `src/engine/discovery.ts`, `src/engine/performance.ts`, `src/engine/resources.ts` | DFG, variant, 경과, 전이 및 서비스, 리소스와 인계 |
| `src/engine/kpis.ts`, `src/engine/festival-kpis.ts`, `src/engine/metrics.ts` | 일반 및 Festival KPI, 교대 클리핑, 목표 평가 |
| `src/engine/findings.ts`, `src/engine/queue.ts` | 근거 기반 개선 후보, 게이트 입력 선택과 시뮬레이션 |
| `tests/phase-0.test.ts`, `tests/engine-plan.test.ts`, `tests/engine-festival.test.ts`, `tests/engine-fixtures.ts`, `tests/fixtures/README.md` | 기존 CSV 구문 검증 유지, placeholder 테스트 12개를 계산 단언으로 교체, 추가 fixture 검증 |
| `reports/evidence/phase-1-engine.md` | 구현, 테스트, 제약, AI 활용 기록 |

## 검증 결과

| TEST_PLAN | 결과 |
| --- | --- |
| T01–T04 | DFG·variant·25분 평균 경과, 반복과 자기 루프, 3/4 리소스 커버리지, 서비스 5·4분과 매칭 간격 3분을 확인했다. T02의 P1 화면 필터는 후속 항목이다. |
| T05–T08 | 동일 UTC 시각의 원본 순서, 따옴표 쉼표, 제외 동의, 프로세스별 분리, 모호한 lifecycle, 잘못된 달력 날짜, 중복 ID, 활용률 N/A를 확인했다. |
| T09 | 같은 입력으로 1 게이트의 평균 대기 3초·종료 12초, 2 게이트의 평균 대기 2/3초·종료 8초를 확인했다. 두 실행의 p95는 각각 최댓값 6초·2초였다. |
| T10 엔진 | 관측 평균 대기 8분에서 최대 목표를 5분에서 10분으로 바꾸었을 때 상태가 `breached`에서 `met`으로 바뀌었다. 관측값은 계속 8분이었다. |
| T13–T14 엔진 | 입력 행 변경으로 전이 근거와 Findings가 다시 계산되었다. Festival 설정이 없는 일반 로그에는 Festival KPI가 없고, 활용률 근거 부족은 `null`과 사유로 표시되었다. |
| T15 | 겹치는 활동에서 15분 busy union과 교대 없는 활용률 N/A를 확인했다. 교대 구간을 제공한 별도 fixture에서 합쳐진 가용 20분, 교대 내 활동 13분에 따른 활용률 65%, 교대 밖 활동 2분을 확인했다. |
| T17 엔진 | 인계의 역방향 엣지, 두 방향의 빈도, 엣지별 케이스 키를 확인했다. |

`npm test -- tests/phase-0.test.ts tests/engine-plan.test.ts`에서 28개, `npm test -- tests/engine-festival.test.ts`에서 5개가 통과했다. 마지막 전체 실행 결과는 다음과 같다.

```text
$ npm test
RUN  v4.1.12
Test Files  3 passed (3)
Tests  33 passed (33)

$ npm run build
> tsc --noEmit && vite build
vite v8.4.0 building client environment for production...
✓ 16 modules transformed.
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-rb5_6vEV.css    8.60 kB │ gzip:  2.63 kB
dist/assets/index-qdDdPNKD.js   219.63 kB │ gzip: 68.78 kB
✓ built in 154ms
```

## 미완료 및 통합 검증

- 최종 Festival 데이터, manifest, BPMN이 준비되면 실제 배포용 샘플에서 필드 매핑, 각 KPI의 관측 커버리지, 기본 서비스 스테이션을 확인해야 한다. 현재 시험은 수기 CSV 및 테스트 내 합성 로그를 사용했다.
- 현재 Vite 빌드는 React 초기 화면으로 수행되었다. 브라우저에서 엔진을 사용하는 전체 흐름과 T10의 화면 갱신, T11–T12의 계획 적용·무효화, T13의 내보내기, T14의 일반 로그 화면·BPMN, T16의 배포, T17의 시각화·드릴다운은 통합 단계에서 검증할 항목이다.
- P1의 그래프 표시 필터, 추가 통계와 XES 변환은 후속 범위다.

## AI 활용 내역

2026-11-27 KST에 Codex로 사용자의 Phase 1 구현 요청과 저장소 계약을 검토했다. Codex가 엔진 코드, 수기 fixture 단언, 테스트와 빌드 실행, 증거 문서를 작성했다. 검토 중 스캔 도중의 입장 완료를 결과 KPI에서 제외하고, 관측 게이트 입력은 합류 뒤 첫 번째 유효 서비스 매칭을 선택하도록 통일했다. 위에 실행으로 확인한 결과를 기록했다. 사람 리뷰와 최종 데이터 검증은 통합 단계에서 진행한다.
