# Demo Festival Operations 2026 — Business Process 정의

> 문서 범위: Music Festival Operations & Resource Optimization 사례의 세 프로세스(Stage, Audience, Equipment)를 비즈니스 관점에서 정의한다. 데이터 필드·확률·분포는 `FESTIVAL_DATA_DESIGN.md`에, 공개 근거는 `FESTIVAL_SOURCE_REFERENCES.md`에 정리했다.
> **가상 데이터셋이다.** DFO26은 가상의 3일짜리 페스티벌이며, 인천펜타포트·부산국제록페스티벌·Fuji Rock의 실제 운영 기록이 아니다.

## 0. 정보의 세 층위

| 표시 | 의미 | 예 |
|---|---|---|
| **[F] 확인 사실** | 공개 자료에서 직접 확인한 운영 관행 | Fuji Rock은 손목밴드를 풀면 재입장이 안 된다. 입구에서 가방 검사와 손목밴드 검사를 한다. 펜타포트는 모바일 티켓과 신분증으로 본인 확인을 한다. 페스티벌 체인지오버는 라인체크 위주로 짧게 진행된다. |
| **[M] 업무 모델** | 확인된 관행을 바탕으로 설계한 합리적 업무 흐름 | 단일 serpentine 대기열이 3개의 검표 lane으로 이어지는 구조, 장비 요청부터 준비 완료까지의 단계 |
| **[A] 실험 가정** | 합성 로그를 만들기 위해 정한 수치 | 서비스 시간 중앙값, 실패 확률, 도착 강도, 근무시간 |

## 1. 공통 배경

- 가상 행사: **DFO26 (Demo Festival Operations 2026)**, 2026-08-07(금)~09(일) 3일, 무대 MAIN / RIVER / CLUB. [A]
- 대형 록 페스티벌은 3일간 여러 무대에서 수십 팀이 공연하고, 무대마다 정해진 run-of-show와 짧은 체인지오버로 운영된다. [F: 부산국제록페스티벌 2025 4개 무대·3일·오전 11:30~22:00, 2026 99개 팀] 이 구조를 축소해 무대 3개, 하루 33개, 총 99개 공연으로 모델링했다. [M]
- 세 프로세스는 같은 행사에 속하지만 **Case 단위가 다르다**. 서로 다른 프로세스를 한 trace로 합치지 않는다.

| 프로세스 | process_type | Case | 시작 | 종료(완료 Activity) |
|---|---|---|---|---|
| MAIN Stage & Technical Operations | `stage` | 개별 공연 `performance_id` (= `case_id`) | 해당 공연 체인지오버의 `Stage Handover` start | `Performance End` |
| SUB1 Audience Entry & Crowd Management | `audience` | 입장 시도 1회 `entry_id` (= `case_id`, 재입장은 새 ID) | `Join Entry Queue` | `Entry Complete` 또는 `Entry Rejected` |
| SUB2 Equipment & Technical Readiness | `equipment` | 장비 요청 1건 `equipment_request_id` (= `case_id`) | `Equipment Requested` | `Equipment Ready` |

연결 규칙
- Stage ↔ Equipment: `festival_id + performance_id`. 장비 요청 여러 건이 공연 1건에 연결된다(many-to-one). 생성 결과는 요청 143건이 공연 81건에 연결되고, 연결되지 않거나 모호한 요청은 0건이다.
- Audience ↔ 나머지: `festival_id`와 운영 시간대로 **비교만** 한다. 관객 한 명을 특정 공연 Case로 추적하지 않는다.
- 자원: 프로세스마다 인력이 분리되어 있다(`resource_id` 기준, 프로세스 간 공유 인력 0명). 이름이 같다는 이유로 같은 사람으로 취급하지 않는다.
- 시간적 동시성은 인과관계가 아니다. 프로세스 간 비교 결과는 '연관'으로만 기술한다.

---

## 2. MAIN — Stage & Technical Operations

### 2.1 배경과 목적
페스티벌 무대는 공연과 공연 사이 15~40분의 체인지오버 동안 이전 공연 장비를 철수하고, 다음 공연의 백라인을 세팅하고, 신호를 점검한 뒤 정시에 공연을 시작해야 한다. 짧은 체인지오버에서는 전체 사운드체크 대신 라인체크만 하는 경우가 흔하다. [F: ProSoundWeb, Shambala 약 30분 체인지오버, FestivalPro advance] 목적은 **공연 준비시간(Handover → Ready)을 줄이고 정시 준비율을 높이는 것**이다.

### 2.2 참여자(역할 → BPMN Lane)
| 역할 `resource_role` | 담당 Activity | 인원 [A] |
|---|---|---|
| `stage_manager` | Stage Handover, Stage Ready, Performance Start, Performance End | 무대별 2명(Early 10:00–17:30 / Late 16:00–24:00) |
| `backline_tech` | Stage Setup, Technical Troubleshooting(signal_path) | 무대별 4명(교대별 2명) |
| `monitor_engineer` | Line Check, Troubleshooting(monitor_mix, wireless_rf) | 무대별 2명 |
| `foh_engineer` | Technical Check, Technical Recheck | 무대별 2명 |
| `lighting_operator` | Troubleshooting(lighting_cue) | 무대별 2명 |
| (외부) Artist / Tour Crew | 장비·크루 도착, walk-on cue 수신 | collapsed pool |

### 2.3 Activity, 입력·출력
| Activity | Lifecycle | 입력 | 출력 |
|---|---|---|---|
| Stage Handover | start/complete | run-of-show(`scheduled_start`), 이전 공연 종료 | 무대 인수 |
| Stage Setup | start/complete | stage plot·technical rider, 연결된 장비의 `Equipment Ready` | 백라인 배치 완료 |
| Line Check (선택) | start/complete | 입력 목록 | 채널별 신호 확인 |
| Technical Check | start/complete | 모니터·조명 큐 | 통과 또는 이슈(`issue_type`) |
| Technical Troubleshooting (예외) | start/complete | 이슈 유형 | 수리·조정 |
| Technical Recheck (반복) | start/complete | 수리 결과 | 통과 또는 재이슈 |
| Stage Ready | complete 마커 | 점검 통과 | 무대 준비 완료 선언 |
| Performance Start / End | complete 마커 | walk-on cue | 공연 시작·종료 |

### 2.4 Business Rules [M]/[A]
1. 첫 공연의 Handover는 `scheduled_start - 60분`, 이후 공연은 이전 공연 `Performance End` 후 1~3분에 시작한다.
2. **Stage Setup은 연결된 모든 장비가 `Equipment Ready`이고 설치 2~5분이 지난 뒤에 완료된다.** 장비가 `scheduled_start + 10분`까지도 오지 않으면 하우스 대체 장비로 진행하고 Setup에 `issue_type=equipment_fallback`을 기록한다(3건).
3. Line Check는 **밴드 공연에만** 수행한다. DJ·playback 세트는 생략한다. 밴드 공연이라도 Setup이 무대별 압축 임계값(MAIN 10, RIVER 8, CLUB 6분 전)을 넘겨 끝나면 60% 확률로 생략한다(compressed changeover).
4. 헤드라이너의 전체 사운드체크는 당일 오전에 이루어지며 **이 Case 범위 밖**이다. 모든 공연에 같은 규모의 사운드체크가 있다고 가정하지 않는다.
5. Technical Check 실패 확률은 기본 0.08이고, complex setup이면 +0.10, Line Check 생략 시 +0.12, 연결 장비가 대체되거나 재작업되었으면 +0.08, fallback이면 +0.10을 더한다. Recheck 재실패는 0.20이며 반복은 최대 3회다.
6. 문제 담당자는 `issue_type`으로 정한다: monitor_mix·wireless_rf → Monitor Engineer, signal_path → Backline Tech, lighting_cue → Lighting Operator.
7. Performance Start = max(`scheduled_start`, Stage Ready + 1~2.5분) + 0~2분. 늦게 시작하면 공연 길이를 지연분만큼(최대 20%) 줄여 일정을 회복한다.
8. 교대: Late crew Stage Manager가 처음 맡는 Handover에는 5~15분의 교대 브리핑이 추가된다.

### 2.5 흐름
- **정상**: Handover → Setup → (Line Check) → Technical Check → Stage Ready → Performance Start → Performance End
- **선택**: Line Check 생략(DJ / compressed)
- **예외·반복**: Technical Check 실패 → Troubleshooting → Recheck → (실패 시 다시 Troubleshooting) → Stage Ready
- **병렬**: 하나의 공연 Case 안에서 Activity들은 순차로 기록된다. 실제로는 음향·조명 점검이 동시에 진행되기도 하지만, 계약의 Activity 단위(`Technical Check` 1개)에서는 관측되지 않는다. 그래서 Parallel Gateway를 쓰지 않았다(§5 참고).

### 2.6 로그로 관측할 수 있는 것
공연 준비시간, 정시 준비율, 재점검률, 변형 경로, 활동별 서비스 시간, 인계 간격, 무대·교대별 인력 간 인계, 장비 연결.
관측할 수 없는 것: 실제 아티스트 요구, 관객 반응, 헤드라이너 사운드체크, 공연 품질.

### 2.7 성과 지표
`stage_preparation_mean`(Handover start → Ready), `stage_on_time_rate`(Ready ≤ scheduled_start), `stage_recheck_rate`, 공연 시작 지연, Case 경과시간(공연시간 포함이므로 준비시간과 구분), 역할별 작업량.

---

## 3. SUB1 — Audience Entry & Crowd Management

### 3.1 배경과 목적
대형 페스티벌은 개장 직후 입구에 수요가 몰린다. 펜타포트는 2026년에 장시간 대기를 줄이기 위해 입장 동선을 두 곳으로 나눴다. [F] 이 모델은 **보조 입구 1곳(North Gate)** 의 분석 시간대(D1·D2 12:00~14:00) 입장 시도 600건을 **전수 기록**한 가상 표본이다. 페스티벌 전체 관객 규모가 아니다. 목적은 대기시간(평균·p95)을 줄이는 것이다.

### 3.2 참여자
| 역할 | Activity | 인원 [A] |
|---|---|---|
| (관측 지점) Queue & Entry Record | Join Entry Queue, Entry Complete | 담당자 없음(관측·기록 이벤트, `resource` 비움) |
| `ticket_checker` | Ticket Verification | 3명. lane NG-L1~L3에 1명씩 |
| `ticket_supervisor` | Manual Ticket Check, Entry Rejected | 2명(검표 lane과 분리된 Support Desk) |
| `wristband_steward` | Wristband Check, Entry Rejected | 1명 |
| `security_screener` | Security Check | 4명 |
| `security_supervisor` | Additional Screening, Entry Rejected | 1명 |

### 3.3 흐름과 규칙
1. `Join Entry Queue`(point): 관객이 serpentine 대기열에 들어선 시각이다. lane까지 걷는 데 6~15초가 걸린다. [A]
2. `Ticket Verification`(start/complete): **하나의 serpentine 대기열이 동일한 3개 lane에 FCFS로 배정되는 단일 pooled 서비스 스테이션**이다. 한 관객은 한 lane만 이용한다. 여러 lane을 병렬로 통과하는 구조(AND)가 아니다. 첫 입장은 QR 스캔, 신분증 확인, 손목밴드 부착을 한다. [F: 펜타포트 본인 확인, 대리 수령 불가] 재입장·다일권 보유자는 손목밴드 스캔만 한다.
   - lane 배정은 엔진과 같은 규칙을 따른다: 가장 먼저 비는 lane, 동률이면 lane 번호 순. lane은 12:00에 연다.
3. 스캔 실패(general 7%, VIP 4%, re-entry 3%)는 **lane을 막지 않고** Support Desk의 `Manual Ticket Check`로 보낸다. 무효 티켓이면 `Entry Rejected`(`invalid_ticket`)로 끝난다.
4. 재입장자는 `Wristband Check`를 받는다. 손목밴드를 풀면 재입장할 수 없다는 규칙에 따라 [F: Fuji Rock] 훼손 시(4%) `Entry Rejected`(`wristband_tampered`)로 끝난다.
5. `Security Check`(가방 검사) [F: Fuji Rock 입구 Bag Check]: 플래그가 뜨면(6%) `Additional Screening`으로 가고, 반입금지품을 거부하면(12%) `Entry Rejected`(`prohibited_item`)로 끝난다.
6. `Entry Complete`(point, 담당자 없음) 또는 `Entry Rejected`(point, 결정 담당자 기록)로 종료한다.
7. 범위 밖: 입장 후 관객 이동, 대기열 이탈(reneging), 혼잡도(별도 집계 데이터가 필요).

### 3.4 게이트·인력·순서의 관계
- `baseline_gate_count = 3`은 **유인 검표 lane 수**다. lane마다 자격 있는 Lane Checker 1명이 배치된다. 서로 다른 `gate_id` 개수로 추정하지 않는다.
- ProcessPilot의 Festival 시뮬레이션은 `Ticket Verification`만 단일 pooled FCFS 스테이션으로 모델링한다. 하류 스테이션(Support, Steward, Security)과 lane까지 걷는 시간은 모델에 포함되지 않는다. 그래서 관측 대기에는 6~15초의 보행시간이 포함되고 모델 대기에는 포함되지 않는다.

### 3.5 지표
`audience_queue_wait_mean`(Join → 첫 TV start), p95·최대 대기(시뮬레이션), 입장 경과(성공 건), 수동 확인률, 거절률, 15분 단위 처리량, lane별 작업량.

---

## 4. SUB2 — Equipment & Technical Readiness

### 4.1 배경과 목적
페스티벌은 공용 하우스 백라인(드럼, 앰프 등)을 여러 공연이 돌려 쓰고, 라이더에 있는 장비가 없으면 대체품이나 렌탈을 준비한다. [F: technical rider·advance 관행, 공용 백라인으로 체인지오버 단축] 이 모델은 **공연 당일의 백라인 배송 요청**(dispatch request)을 Case로 본다. 목적은 장비가 `required_ready_at`(연결 공연의 계획 체인지오버 시작) 전에 무대에 준비되는 것이다.

### 4.2 참여자
| 역할 | Activity | 인원 [A] |
|---|---|---|
| `production_coordinator` | Equipment Requested | 2명(A 07:30–15:30, B 14:30–23:00) |
| `equipment_manager` | Availability Check, Substitute Search, Equipment Allocation | 3명(2명 early, 1명 late) |
| `logistics_crew` | Equipment Transport | 4명 |
| `backline_qc_tech` | Pre-use Inspection, Inspection Rework, Equipment Ready | 3명(2명 early, 1명 late) |
| (외부) Artist/Tour Management, Stage pool | rider 수신, ready 통보 | collapsed pool |

### 4.3 흐름과 규칙
1. `Equipment Requested`(complete 마커): 요청의 85%는 `required_ready_at` 3~6시간 전, 15%는 35~90분 전(late request)에 들어온다. [A]
2. `Availability Check`: 하우스 풀(유형별 자산 3~8대)에서 `[required−30분, 계획 종료+20분]` 구간에 비어 있는 자산을 찾는다.
3. 자산이 없거나 라이더 모델이 맞지 않으면(7%) `Substitute Search`를 거쳐 대체·렌탈 자산 `ALT-*`을 쓴다.
4. `Equipment Allocation`(`asset_id` 확정) → `Equipment Transport`(무대별 이동시간: MAIN 15, RIVER 20, CLUB 8분 중앙값)
5. `Pre-use Inspection`: 실패 확률 7%, 대체 장비면 +12%. 실패하면 `Inspection Rework` 후 다시 Inspection을 한다(최대 2회 재작업).
6. `Equipment Ready`(complete 마커): Stage pool로 준비 통보(message flow)를 보내고, 연결 공연의 Stage Setup 완료 조건이 된다.

### 4.4 지표
요청 → Ready 리드타임, 대체율, 검사 재작업률, `equipment_on_time_rate`(Ready ≤ `required_ready_at`), 미연결 요청 수, 장비 인력 작업량, 장비 담당자 ↔ QC 기술자 인계.

---

## 5. BPMN 모델 설명

| 파일 | Pool / Lane | Gateway | Message Flow | Data Object / Annotation |
|---|---|---|---|---|
| `stage_as_is.bpmn` | Stage pool(5 lane) + Artist, Equipment collapsed pool | XOR 6개(Line Check 분기·합류, Check/Recheck 결과, troubleshooting 루프 합류, Ready 합류) | Artist → Handover, Performance Start → Artist, Equipment → Stage Setup | Run-of-show, Stage plot / 주석 3개 |
| `audience_as_is.bpmn` | Audience pool(7 lane) + Attendee collapsed pool | XOR 11개(분기 5, 합류 3, 거절 체인 3) | Attendee → Join Entry Queue | Credential, Prohibited items list / 주석 3개 |
| `equipment_as_is.bpmn` | Equipment pool(4 lane) + Artist, Stage collapsed pool | XOR 4개(가용성, 할당 합류, 검사 루프 합류, 검사 결과) | Artist → Requested, Equipment Ready → Stage | Asset register, Allocation record(출력), Rider / 주석 3개 |
| `audience_to_be.bpmn` | 동일 vocabulary, Express lane 추가 | XOR 12개 | Attendee → Join | 개선 후보 주석 |

- Task 이름은 모두 로그 Activity와 **대소문자까지 정확히 같다**. 그래서 ProcessPilot의 exact-name 자동 매핑이 가능하다(검증 C19).
- Gateway·Start/End Event·Data Object는 로그의 별도 행이 아니다. 로그에는 Task만 기록된다.
- **Parallel / Inclusive Gateway 정책**: 세 프로세스 모두 하나의 Case 안에서 계약 Activity 단위의 실제 병렬 수행이 관측되지 않는다. lane 다중화는 pooled 스테이션이지 AND split이 아니다. 따라서 Parallel·Inclusive Gateway가 필요하지 않았다. 이후 모델을 바꿔 실제로 필요해지면 그대로 모델링해도 되지만, 그 경우 ProcessPilot의 제한적 전이 비교(`getBpmnComparison`: task, plain start/end, XOR만 지원, V03_CONTRACT §8)에서는 adjacency 검사가 `unsupported`로 표시되고 매핑만 사용할 수 있다. 현재 네 파일은 모두 지원 구조다(C19 사전 점검, 엔진 실행은 하지 않음).
- As-is BPMN은 **합성 로그를 생성한 기준 모델**이다. 로그에서 발견한 DFG와는 별개이고, 비교는 Model 화면에서 한다.
- 각 BPMN 요소와 로그 Activity의 매핑은 `FESTIVAL_DATA_DESIGN.md §3`에 정리했다.

## 6. To-be 후보 (Audience)
`audience_to_be.bpmn`은 **검증되지 않은 개선 후보**다.
1. **용량 변경**: 피크(12:00–13:00)에 유인 검표 lane을 3개에서 4개로 늘린다. ProcessPilot 서버 수 what-if로 정량화할 수 있다.
2. **구조 변경**: 손목밴드 보유자(재입장·다일권)는 검표 lane 대신 Express Wristband lane으로 보낸다. 엔진 시뮬레이션 범위 밖이며, 독립 계산 결과만 `festival-data-validation.md §2.2`에 참고로 제시한다.
3. Manual Ticket Check는 계속 off-lane으로 처리한다.

서버 증설 효과를 구조 변경 효과로 확대 해석하지 않는다. 두 결과는 따로 보고한다.
