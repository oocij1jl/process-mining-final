# Phase 3 Festival 자산 통합 및 엔진 검증

2026-11-28 KST · `feat/v03-engine` · 엔진 기준 `edb9d13` · 합성 데이터 DFO26 · seed `20261127`

**Festival 자산 및 엔진 연결 GO.** 전체 CSV/XES가 제외와 경고 없이 수용됐고, 주요 지표와 일별 큐 결과가 독립 계산과 일치했다. As-is 세 모델은 허용 전이와 모두 일치했다. **브라우저 통합 및 공개 릴리스 판정은 보류**한다. UI 샘플 로딩, bpmn-js 표시와 편집 왕복, 최종 브라우저 검증은 별도 단계다.

## 1. 적용한 파일과 충돌 확인

ZIP의 `README_INTEGRATION.md`, `FILE_MANIFEST.md`, 아래 네 설계 문서와 두 검증 보고서를 읽고 현재 트리와 대조했다. 운영 로그, BPMN, manifest와 문서는 이미 해당 경로에 있었다. ZIP과 바이트가 같은 세 Python 파일을 `scripts/`에서 지정된 `scripts/festival/`로 이동했다. 데이터 트랙 파일 28개 중 27개는 ZIP과 바이트 단위로 동일하다. 기존 `validation_results.json`은 상관계수 한 값만 ZIP의 `0.6200514768914571`과 기존 사본의 `0.6200514768914572`로 달라 기존 사본을 보존했다. 임시 사본의 Python 재실행은 ZIP 값을 재현했다. 검사 항목과 주요 지표는 동일하다. ZIP 안내서 두 개는 패키지에서 읽었다.

| 경로 | 적용 확인 |
|---|---|
| `public/datasets/` | `demo_festival_operations_2026`, `stage_operations`, `audience_entry`, `equipment_readiness` 각각 `.csv`와 `.xes`, `dataset_manifest.json`, `resource_shifts.csv` |
| `public/bpmn/` | `stage_as_is.bpmn`, `audience_as_is.bpmn`, `equipment_as_is.bpmn`, `audience_to_be.bpmn` |
| `scripts/festival/` | `generate_festival_logs.py`, `validate_festival_logs.py`, `render_bpmn_preview.py` |
| `docs/` | `BUSINESS_PROCESS.md`, `FESTIVAL_DATA_DESIGN.md`, `FESTIVAL_ANALYSIS_PLAN.md`, `FESTIVAL_SOURCE_REFERENCES.md` |
| `reports/evidence/` | `phase-3-festival.md`, `festival-data-validation.md`, `validation_results.json`, `bpmn-preview/`의 네 SVG |

데이터와 manifest를 원본 그대로 사용했다. 기존 테스트, fixture, 엔진 및 UI 코드는 변경 없이 검증했다. [데이터 트랙 보고서](phase-3-festival.md) · [독립 계산](festival-data-validation.md) · [원래 수치](validation_results.json)

## 2. 실제 엔진 정규화 및 CSV/XES 동등성

CSV는 저장소의 `parseCsv` → `engineRows` → `validateAndNormalize`를, XES는 `importXes`를 실행했다. 두 포맷 모두 `requireProcessType: true`, `festivalValidation: true`, `acceptExclusions: false`를 전달했다. 기존 `parseManifest`와 `settingsFromManifest`는 오류 0건으로 manifest를 읽었다. 전체 파일과 세 개별 CSV/XES 쌍 모두 아래 수치와 일치했다.

| 프로세스 | Cases | Events | Discovery events | DFG edges | Variants | WTN 인계 횟수 | 매칭된 서비스 구간 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stage | 99 | 1,043 | 670 | 11 | 5 | 375 | 373 |
| Audience | 600 | 3,978 | 2,589 | 13 | 11 | 789 | 1,389 |
| Equipment | 143 | 1,498 | 892 | 9 | 5 | 431 | 606 |
| 합계 | **842** | **6,519** | **4,151** | | | | **2,368** |

- 두 포맷 모두 제외 0, 검증 이슈 0, 모호한 서비스 매칭 0이었다. 메모리에서만 한 성공 로그를 도착 이전으로 옮긴 음성 대조군으로 `festivalValidation: true`에서 `audience_event_before_arrival` 경고가 발생하고 명시적 `false`에서 사라지는 것을 확인했다. 경고가 있는 경우에도 행은 유지됐다.
- 이벤트 ID로 연결해 case/활동/시각/원본 timestamp/lifecycle/instance/resource, Festival 확장 속성, `act_type`과 `setup_profile`, 사례 내 이벤트 및 discovery 순서를 비교했다. XES의 공통 trace 속성 상속과 CSV 빈 값에 대응하는 선택 속성 생략이 분석에 영향을 주지 않았다.
- 전체 파일에서 6,519개 이벤트의 `sourceOrder`가 형식 간 서로 달랐다. CSV는 원본 행과 `rowMap`을, XES는 `eventLocations`의 trace/event 위치를 유지했다. 근거 이벤트는 이벤트 ID로 대응시켰고, Finding은 각 입력의 dataset ID와 opaque ID를 유지했다. 비교할 때만 순서 비의존 목록과 포맷별 provenance를 분리했다.
- DFG 시작/종료 근거, Variant, WTN와 handoff 활동 쌍, Performance와 커버리지, KPI와 방향별 근거, Findings는 동등했다. Stage의 Variant 평균 1개와 KPI 평균 2개에서 합산 순서에 따른 최대 `1.4211e-14`분의 차이가 있었다. 실수 동등성 기준 `1e-10` 이내이며 건수·키·사례 근거는 정확히 일치했다. 독립 JSON과도 DFG, 시작/종료, Variant, WTN 총횟수·활동 쌍, 관측 간격·서비스 평균과 표본 수, 일반 반복률을 대조했다.

### Activity Evidence, Replay, Throughput, Drift, Patterns

| 프로세스 | 동일 활동 반복 사례 / 추가 발생 | 최종 Replay 완료 | 15분 처리량 건수 / 버킷 | 분기 / 짧은 루프 발생 / 구간 겹침 |
|---|---:|---:|---:|---:|
| Stage | 1 / 4 | 99 | 99 / 241 | 3 / 4 / 0 |
| Audience | 0 / 0 | 600 | 600 / 105 | 5 / 0 / 0 |
| Equipment | 11 / 13 | 143 | 143 / 243 | 2 / 13 / 0 |

- 두 형식에서 Activity Evidence, Replay 인덱스와 시작·중간·종료 프레임, 처리량, Drift, Patterns와 Readiness Links가 동등했다. Replay 상태 합계는 각 프레임에서 사례 수를 보존했다. 모든 프로세스에서 self-loop는 0건이다.
- Audience 성공 입장만 세면 **587건**이다. 제네릭 성공 처리량과 기존 `audience_throughput`의 버킷도 일치했다. 전체 두 날의 105개 15분 버킷 중 87개가 완료 0건이다. 일별 종료 시각 버킷은 각각 9개였으며 D1 완료/성공 **280/278건**, D2 **320/309건**이다. 이어진 축의 야간 0은 운영 중 측정치로 해석할 수 없다.
- Asia/Seoul 8월 7일과 8일의 날짜 경계로 세 프로세스의 Drift를 실행했다. Audience의 `Ticket Verification → Wristband Check`는 **16/280 → 105/320**, **+27.098214285714285 pp**, 지원도 `sufficient`였다. 이 비교는 관측 분포 변화다.
- Stage의 일반 반복률은 1/99다. Festival 재점검 규칙은 별도 `Technical Recheck` 활동도 포함하므로 11/99다. Replay는 원본 이벤트와 매칭 구간을 표시한다. 분석 계획의 대기열 장면은 관측 기록과 대기 KPI로 설명하며 Replay 상태만으로 대기 중인 사례를 판정할 수 없다.

## 3. 독립 지표 및 일별 큐 모델 대조

표의 독립값은 작업 트리 `validation_results.json`에서 읽었다. 소수 표기 차이는 실수 오차 허용치 `1e-10` 이내다.

| 지표 | 독립 JSON | 실제 엔진 |
|---|---:|---:|
| Stage 정시 준비율 (%) | 51.515151515151516 | 51.515151515151516 (51/99) |
| Stage 평균 준비시간 (분) | 23.2493265993266 | 23.249326599326594 |
| Stage 기술 재점검률 (%) | 11.11111111111111 | 11.11111111111111 (11/99) |
| Audience 입장 완료 / 거절 | 587 / 13 | 587 / 13 |
| Audience 평균 관측 대기시간 (분) | 1.5008611111111112 | 1.500861111111112 (n=600) |
| Equipment 요청 / 연결 공연 | 143 / 81 | 143 / 81 |
| Equipment 정시 준비율 (%) | 93.00699300699301 | 93.00699300699301 (133/143) |
| Equipment 평균 요청→준비 리드타임 (분) | 66.65384615384616 | 66.65384615384612 |

`getGateInputs` / `simulateGateQueue`와 `extractQueueInputs` / `compareQueues`의 관측 서비스 벡터와 결과가 일치했다. D1은 280건, D2는 320건을 수용했다. 기존 preset 결과를 JSON 원래 값과 대조한 결과 표본, 평균, p95, 최대 대기, 종료 경과, 처리량이 일치했다. 아래 표는 읽기 쉬운 자리수로 표시했다.

| 사례 범위 | 서버 3→4 평균 대기 (분) | p95 (분) | 종료 경과 (분) | 모델 처리량 (건/시간) |
|---|---:|---:|---:|---:|
| D1 · 2026-08-07 KST | 2.023452 → 0.454107 | 5.900000 → 2.100000 | 120.100000 → 120.100000 | 139.883430 → 139.883430 |
| D2 · 2026-08-08 KST | 0.719479 → 0.110469 | 2.416667 → 0.716667 | 119.283333 → 119.283333 | 160.961297 → 160.961297 |
| 이틀 통합 · 영향 확인용 | 1.328000 → 0.270833 | 5.083333 → 1.700000 | 1,558.850000 → 1,558.850000 | 23.093947 → 23.093947 |

이틀 통합의 종료 경과에서 각각의 일별 종료 경과를 빼면 **1,319.466667분**의 야간 공백이 포함된다. 전체 처리량은 이 공백까지 분모에 들어가므로 D1/D2 용량 판단은 일별 표를 사용한다. 일별 관측 대기도 JSON과 일치했다(D1 2.1967857142857152분, D2 0.891927083333333분). 관측 대기는 설정된 보행 시간을 포함하고, 엔진은 검표 스테이션의 FCFS 대기를 모델링한다. 관측 평균 1.500861…분과 통합 모델 baseline 1.328분의 차이는 정의 차이다. 서버를 늘리면 대기는 감소하지만 두 날 모두 마지막 서비스 종료 시각은 같았다.

## 4. BPMN XML, DI 및 엔진 비교

로컬 XML 검사에서 모델별 BPMN 루트, 고유 ID, 유효한 협업/프로세스 참조, DI plane, 양의 shape 크기, edge waypoint와 노드·흐름 참조를 확인했다. 중립 `BpmnReference`는 실제 업무 프로세스의 Task subtype, 평범한 Start/End, XOR와 sequence flow에서 만들었다. Lane·collapsed pool·message flow·주석은 시각 자산에 속한다.

| 모델 | DI shapes / edges | exact 활동 매핑 | 검사 전이 발생 / 건너뜀 | 허용 목록 밖 전이 |
|---|---:|---:|---:|---|
| Stage As-is | 30 / 27 | 9/9 | 571 / 0 | 0 |
| Audience As-is | 37 / 33 | 8/8 | 1,989 / 0 | 0 |
| Equipment As-is | 27 / 23 | 8/8 | 749 / 0 | 0 |
| Audience To-be | 34 / 30 | 8/8 | 1,989 / 0 | 2개 전이 유형, 129회 |

실제 `getBpmnComparison`에서 네 모델 모두 `supported`였다. To-be의 차이는 `Ticket Verification → Wristband Check` **121회**, `Manual Ticket Check → Wristband Check` **8회**였다. 분석 계획의 `Join Entry Queue → Ticket Verification` 예상과 다른 이유는 To-be에서 해당 전이가 첫 입장 분기로 여전히 허용되기 때문이다. 이 API는 표기된 XOR의 Task 인접 관계를 검사하며 사례의 손목밴드 보유 조건을 평가하지 않는다. As-is의 Audience XOR 개수는 XML에서 **12개**로, 업무 문서의 11개 표기와 다르다. 이는 설명 문서의 개수 차이이며 XML이나 매핑 실패가 아니다. 메모리 중립 모델의 미지원 control에서는 매핑을 유지하고 전이 검사만 `unsupported_elements`로 반환했다.

## 5. Stage–Equipment 교차 분석

`getFestivalReadinessLinks`에서 **143개 요청 → 81개 공연**, 미연결 및 모호 0건을 확인했다. 장비 링크 없는 Stage 사례는 18건이다. 전체 Stage와 Equipment 선택으로 얻은 쌍 데이터가 같고, 같은 데이터셋의 상대 프로세스 전체를 넘기되 Stage 선택을 D1으로 좁히면 선택 Stage 33건 중 공연 27건에 장비 49건이 연결됐다. Audience는 별도 traces로 유지했다.

명시 기한 `required_ready_at` 기준으로 장비 지연 근거 10건과 성공 근거 133건이 KPI의 방향별 근거와 일치했다. 세 이벤트 참조는 각 원본 사례 키, 시각, 원본 순서로 해석했다. 예를 들어 `EQR-0075 → PERF-D2-RIVER-02`의 KST 관측은 아래와 같다.

| 관측 | 시각/판정 |
|---|---|
| Stage Setup 시작 | 8월 8일 12:05:35 |
| Equipment Ready / 마감 | 12:31:28 / 12:00:00, 31.466667분 늦음 |
| Stage Ready / 마감 | 12:55:01 / 12:25:00, 30.016667분 늦음 |

Stage Setup **완료** 뒤에 장비 준비가 기록된 경우는 독립 검증의 `equipment_fallback` 3개 Stage 사례와 일치했다. 이 비교에는 원본 Stage Setup 완료 이벤트를 사용했다. 연결 및 시간 차이는 관측 근거이며 인과 판정을 제공하지 않는다.

## 6. UI 전달 설정과 범위

- 기본 Festival 로더는 기존 manifest의 `csv`와 BPMN 경로를 그대로 쓴다. 샘플에는 명시적 Festival 검증을 전달하고 데이터셋은 synthetic으로 표시한다. Queue는 `Ticket Verification`, 기준 3 서버, D1/D2의 whole-case 날짜 선택을 사용한다. 전체 파일을 합친 큐 처리량에는 야간 공백이 포함된다고 표시한다.
- Replay 및 일반 처리량에는 아래 종료 정의를 넘긴다. 성공 입장 처리량은 `['Entry Complete']`를 별도로 사용한다. Stage 또는 Equipment 사례를 선택해도 상대 검색은 동일 데이터셋 전체다.
- `resource_shifts.csv`는 참고 자산으로 유지했다. 이 검증에 KPI shifts 입력을 전달하지 않았고 이용률은 모든 프로세스에서 `null`이었다. 구조적 Express lane 시나리오, 조건 기반 conformance, 일정 최적화, ROI와 인과 추론은 이 실행 결과의 범위 밖이다.
- 기존 CSV 샘플에는 새 manifest 키가 필요 없다. XES는 UI에서 파일 업로드 경로를 연결하면 `importXes`에 전달할 수 있고, 종료 활동은 기존 엔진 API의 인자로 공급할 수 있다. 샘플 UI에서 두 포맷과 기본 완료 정의를 자동 제공할 때만 아래 **선택 키 두 개**를 추가하는 것이 최소 변경이다. 기존 파서는 두 키를 무시하고 기존 manifest 결과와 오류 목록을 그대로 반환하는 것을 메모리에서 검증했다. 새 UI 파서가 키를 사용하도록 연결할 때는 `csv`를 유지하고 `xes`는 동일 경로 규칙의 상대 파일명, `completion_activities`는 프로세스별 비어 있지 않은 고유 활동명 배열로 검증한다. 이번에는 생성 manifest를 그대로 유지했다.

```json
{
  "xes": "demo_festival_operations_2026.xes",
  "completion_activities": {
    "stage": ["Performance End"],
    "audience": ["Entry Complete", "Entry Rejected"],
    "equipment": ["Equipment Ready"]
  }
}
```

## 7. 실행 기록

| 실행 | 결과 |
|---|---|
| `python3 scripts/festival/validate_festival_logs.py --root <임시 검증 사본>` | **23/23 PASS**. 임시 사본에서 seed 재생성과 ZIP 자산 검증을 실행했다. |
| 임시 Python XML/DI 점검 및 중립 모델 추출 | **4/4 PASS**. 실제 분석에는 추출된 sequence flow를 사용했다. |
| 로컬 Rolldown으로 현재 엔진/어댑터/CSV 모듈을 임시 ESM으로 빌드하고 Node.js로 실행 | **347/347 PASS**. 포맷 동등성, 독립 수치, 날짜별 큐, BPMN, 교차 연결과 대조군 포함. |
| `npm test` | **139/139 PASS**, 13개 파일. 기존 테스트 및 fixture 변경 없음. |
| `npm run build` | **PASS**, TypeScript 및 Vite. 기존 500 kB 번들 경고 발생. |

Node.js v24.15.0 단일 검증 실행에서 전체 파일 읽기·파싱·정규화는 CSV 약 152 ms, XES 약 226 ms, 양쪽 형식의 그룹화 이후 분석 묶음은 약 186 ms였다. 브라우저 렌더링 측정은 포함하지 않았다.
