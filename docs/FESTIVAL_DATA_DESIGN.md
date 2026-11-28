# Festival 합성 이벤트 로그 설계

생성기: `scripts/festival/generate_festival_logs.py` v1.0.0 · seed **20261127** · Python 표준 라이브러리만 사용 · 실행 한 번으로 CSV, XES, BPMN, manifest, shift 파일을 모두 생성한다.
기준 계약: DATA_SCHEMA v0.2.1, **V03_CONTRACT (2026-11-28, MD5 4a8ef710…)** §1, §3A, §5–§8, adapter.ts `parseManifest`.

## 1. 생성 원칙
1. **단일 공통 이벤트 모델**: 이벤트 행 리스트 하나를 만든 뒤 같은 리스트를 CSV와 XES로 직렬화한다. 프로세스별 CSV와 XES는 이 리스트에서 `process_type`으로 걸러 만든 것이며, 다시 랜덤 생성하지 않는다.
2. **재현성**: 프로세스마다 문자열 seed 서브스트림(`f"{seed}-plan|equipment|stage|audience"`)을 쓴다. Python `random.Random(str)`은 SHA-512 기반이라 PYTHONHASHSEED의 영향을 받지 않는다. 같은 seed로 다시 생성하면 모든 산출물이 바이트 단위로 같다(검증 C01).
3. **규칙 기반 생성**: BPMN 흐름, 업무 규칙, 자원 제약(근무시간 + 동시 작업 금지)을 먼저 정의하고 이벤트를 만든다. 자원 배정은 '근무시간 안에서 가장 빨리 가능한 시각'(동률이면 가장 오래 쉰 사람)으로 하며 비선점이다. Audience 검표 lane만 엔진과 같은 pooled FCFS 규칙(가장 먼저 비는 lane, 동률이면 index 순)을 쓴다.
4. **결과 비조작**: seed는 한 번도 바꾸지 않았다. 결과를 특정 방향으로 맞추려고 값을 직접 넣지 않았다.
   - 보정 이력(투명성 기록): 처음 넣은 무대 작업시간으로 생성하자 표준 체인지오버가 계획 시간 안에 끝나지 않아 공연이 자정을 넘기는 **실행 불가능한 일정**이 나왔다. 그래서 (a) 무대 작업시간 중앙값과 체인지오버 길이를 '표준 체인지오버가 계획 슬롯의 약 70–85%를 쓰는' 수준으로 다시 정했고, (b) 늦은 장비를 기다리는 상한(공연 시작 +10분, 이후 하우스 대체 장비 사용)을 추가했고, (c) 하우스 백라인 수량을 늘렸고, (d) 동률 자원 배정을 '가장 오래 쉰 사람 우선'으로 바꿨다. 모든 보정은 운영 현실성(일정 실현 가능성, 업무 분배)을 위한 것이다. 분석 결과는 생성 이후에 계산했다.

## 2. 데이터 규모와 범위
| 프로세스 | Case | Event | 범위 |
|---|---|---|---|
| stage | 99 | 1,043 | 3일 × (MAIN 8 + RIVER 11 + CLUB 14) 공연 |
| audience | 600 | 3,978 | North Gate, D1 12:00–14:00 도착 280건 + D2 320건(해당 입구·시간대 전수, 전체 관객 아님) |
| equipment | 143 | 1,498 | 당일 백라인 배송 요청, 연결 공연 81건 |
| 합계 | 842 | 6,519 | 인력 59명(`resource_shifts.csv` 166행) |

권장 규모(100 / 600 / 150) 대비: 공연 수는 무대별 run-of-show 구조상 99건이다. 장비 요청 수는 공연 특성별 확률 결과라 143건이다(목표 수치에 맞춰 강제로 조정하지 않음).

## 3. Activity 사전, Lifecycle, BPMN 매핑

| process | Activity (로그 = BPMN Task 이름) | Lifecycle | BPMN element id | Task type | Lane |
|---|---|---|---|---|---|
| stage | Stage Handover | start/complete | Task_StageHandover | userTask | Stage Manager |
| stage | Stage Setup | start/complete | Task_StageSetup | manualTask | Backline Technician |
| stage | Line Check | start/complete (선택) | Task_LineCheck | manualTask | Monitor Engineer |
| stage | Technical Check | start/complete | Task_TechnicalCheck | userTask | FOH Engineer |
| stage | Technical Troubleshooting | start/complete (예외) | Task_TechnicalTroubleshooting | manualTask | Issue Owner |
| stage | Technical Recheck | start/complete (반복) | Task_TechnicalRecheck | userTask | FOH Engineer |
| stage | Stage Ready | complete 마커 | Task_StageReady | userTask | Stage Manager |
| stage | Performance Start | complete 마커 | Task_PerformanceStart | sendTask | Stage Manager |
| stage | Performance End | complete 마커 (**완료 Activity**) | Task_PerformanceEnd | userTask | Stage Manager |
| audience | Join Entry Queue | point(빈 lifecycle) | Task_JoinEntryQueue | receiveTask | Queue & Entry Record |
| audience | Ticket Verification | start/complete (**service_activity**) | Task_TicketVerification | userTask | Ticket Lanes |
| audience | Manual Ticket Check | start/complete (예외) | Task_ManualTicketCheck | userTask | Ticket Support Desk |
| audience | Wristband Check | start/complete (선택) | Task_WristbandCheck | manualTask | Wristband Steward / Express Lane |
| audience | Security Check | start/complete | Task_SecurityCheck | manualTask | Security Screener |
| audience | Additional Screening | start/complete (예외) | Task_AdditionalScreening | manualTask | Security Supervisor |
| audience | Entry Complete | point (**완료 Activity**) | Task_EntryComplete | serviceTask | Queue & Entry Record |
| audience | Entry Rejected | point (**완료 Activity**, 거절) | Task_EntryRejected | userTask | Rejection Record |
| equipment | Equipment Requested | complete 마커 | Task_EquipmentRequested | userTask | Production Coordinator |
| equipment | Availability Check | start/complete | Task_AvailabilityCheck | userTask | Equipment Manager |
| equipment | Substitute Search | start/complete (선택) | Task_SubstituteSearch | userTask | Equipment Manager |
| equipment | Equipment Allocation | start/complete | Task_EquipmentAllocation | userTask | Equipment Manager |
| equipment | Equipment Transport | start/complete | Task_EquipmentTransport | manualTask | Logistics Crew |
| equipment | Pre-use Inspection | start/complete (반복 가능) | Task_PreUseInspection | manualTask | Backline QC Technician |
| equipment | Inspection Rework | start/complete (예외) | Task_InspectionRework | manualTask | Backline QC Technician |
| equipment | Equipment Ready | complete 마커 (**완료 Activity**) | Task_EquipmentReady | sendTask | Backline QC Technician |

- 모든 Activity는 DATA_SCHEMA §2의 이름 그대로다. 새 Activity는 추가하지 않았다(C05).
- 로그에 기록되지 않는 BPMN 요소: Start/End Event, 모든 XOR Gateway(`Gw_*`), Data Object, Text Annotation, Message Flow.
- 마커 표기: Stage/Equipment의 순간 마일스톤은 DATA_SCHEMA §5 예시대로 `complete` 단일 행이다. Audience 관측 이벤트는 DATA_SCHEMA §2의 'point event'대로 lifecycle을 비운다. 두 방식 모두 엔진에서 discovery 이벤트가 되며 duration은 만들지 않는다.

### 완료 Activity (Replay / Throughput 정의용)
| process | completion activities | 메모 |
|---|---|---|
| stage | `Performance End` | 공연 완료 처리량 |
| audience | `Entry Complete`, `Entry Rejected` | 처리된 attempt 수(결과 확정). 입장 성공 처리량만 볼 때는 `Entry Complete`만 사용(기존 `audience_throughput`과 같은 의미) |
| equipment | `Equipment Ready` | 준비 완료 처리량 |

V03 §6 `getCaseThroughput(completion.completionActivities)`와 §7 replay `completion`에 위 목록을 그대로 넣으면 된다. 현재 manifest 스키마에는 이 필드가 없어서 manifest에는 넣지 않았다(README_INTEGRATION §4의 확장 제안 참고).

## 4. 필드 정의 (CSV 23열, 모든 행의 열 수 동일)
| 필드 | 값 / 규칙 | 수준 |
|---|---|---|
| event_id | `EV000001`… 전역 고유. CSV 순서 = (timestamp, process, case, 생성순) | event |
| process_type | `stage` / `audience` / `equipment` | case 상수 |
| case_id | `PERF-D1-MAIN-01`, `ENT-D1-0001`, `EQR-0001`. 접두어 덕분에 프로세스 간에도 고유 | case |
| activity | §3 사전 | event |
| timestamp | `2026-08-07T12:00:05+09:00` (초 단위, 명시적 offset) | event |
| lifecycle | `start` / `complete` / 빈 값 | event |
| activity_instance_id | `{case_id}#NN`. 같은 활동 인스턴스의 start·complete를 연결하고, 반복 시 새 번호를 쓴다 | event |
| resource, resource_role, resource_id | 표시 이름 / 역할 / `DFO26-…` 전역 고유 ID. 담당자 없는 관측 이벤트(Join Entry Queue, Entry Complete)는 비움 | event |
| festival_id | `DFO26` (모든 행) | case 상수 |
| performance_id | stage = case_id, equipment = 연결 공연 | case 상수 |
| stage_id | `MAIN`/`RIVER`/`CLUB` (stage, equipment) | case 상수 |
| gate_id | `NG-L1..3` (Ticket Verification 행에만, 검표 lane) | event |
| equipment_request_id | equipment = case_id | case 상수 |
| equipment_type | Drum Kit, Guitar Amp, Bass Amp, Keyboard Rig, Wireless Mic Kit, IEM Pack, DJ Booth Set | case 상수 |
| asset_id | `GAMP-03`, `ALT-DRUM-01`… Allocation 이후 행 | event |
| scheduled_start | stage 모든 행(공연 계획 시작) | case 상수 |
| required_ready_at | equipment 모든 행(연결 공연 계획 체인지오버 시작) | case 상수 |
| ticket_type | `general` / `vip` / `re-entry` (audience 모든 행) | case 상수 |
| issue_type | 예외 행에만: scan_failure, bag_flag, invalid_ticket, wristband_tampered, prohibited_item, monitor_mix, signal_path, wireless_rf, lighting_cue, equipment_fallback, pool_conflict, rider_model_unavailable, cable_fault, connector_damage, power_supply_fault, missing_accessory | event |
| act_type, setup_profile | stage만: `band`/`dj`, `standard`/`complex`. **계약 외 선택 열**(attrs로 보존). 계획 단계에서 아는 속성 | case 상수 |

## 5. 생성 모델 파라미터 (모두 [가정])

### 5.1 Stage
| 항목 | MAIN | RIVER | CLUB |
|---|---|---|---|
| 첫 공연 / 공연 수 | 12:00 / 8 | 11:30 / 11 | 12:00 / 14 |
| 공연 길이(분) | 35–75 | 30–45 | 25–35 |
| 계획 체인지오버(분) | 30–40 | 25 | 20 |
| DJ 비율 / complex 비율 | 0.10 / 0.45 (마지막 2개는 band·complex) | 0.15 / 0.20 | 0.50 / 0.08 |
| Handover 중앙값 | 3.5 | 2.5 | 2.0 |
| Setup 중앙값 (×1.5 complex, ×0.6 DJ) | 9.0 | 7.0 | 5.0 |
| Line Check / Tech Check(band) 중앙값 | 4.5 / 4.0 | 3.5 / 3.0 | 3.0 / 2.5 |
| 압축 체인지오버 임계(분 전) | 10 | 8 | 6 |

시간 분포: 절단 로그정규 `median·exp(N(0,σ))`, σ=0.3–0.5, 하한·상한으로 clamp. 단계 사이 대기 10–90초 균등, 각 duration에 0–59초를 더한다. Troubleshooting 중앙값 7분(σ 0.5), Recheck 3분, 교대 브리핑 9분(5–15). 확률은 BUSINESS_PROCESS §2.4를 따른다.

### 5.2 Audience
| 항목 | D1 (280) | D2 (320) |
|---|---|---|
| 도착 프로파일(분당 상대 가중치) | 12:00–12:15 ×9, –12:45 ×5, –13:15 ×2.5, –14:00 ×1 | ×10, ×6, ×2.5, ×1 |
| ticket mix | general 85% · VIP 8% · re-entry 7% | 55% · 8% · 37% (다일권 손목밴드 보유자) |

도착은 고정 건수의 조건부 포아송 방식이다(구간 가중치에 비례해 무작위 시각을 뽑아 정렬, 초 단위). TV 서비스 중앙값: general 40초, VIP 34초, re-entry 9초. lane까지 보행 6–15초. Manual 75초, Wristband 7초, Security 22초, Additional Screening 100초. 하류 이동 5–40초. 스테이션별 인원은 BUSINESS_PROCESS §3.2를 따른다.

### 5.3 Equipment
요청 확률: band 공연 → Drum 0.40, Guitar Amp 0.50, Bass 0.30, Keys 0.15, Wireless Mic 0.20, IEM 0.10 / DJ 공연 → DJ Booth 0.85, Wireless Mic 0.15.
하우스 자산 수: Drum 4, GAMP 8, BAMP 4, KEYS 3, WMIC 5, IEM 4, DJB 3.
요청 시점: 85%는 `required_ready_at` 180–360분 전, 15%는 35–90분 전(08:00 이후).
duration 중앙값: Availability 6분, Substitute 20분, Allocation 5분, Transport(MAIN 15 / RIVER 20 / CLUB 8분), Inspection 8분(재검사 6분), Rework 15분.
검사 실패 확률: 0.07, 대체 장비면 +0.12. 재검사 실패 0.15, 재작업 최대 2회.

### 5.4 자원과 근무시간
- `resource_shifts.csv`: resource_id, resource, resource_role, process_type, festival_id, area, shift_date, shift_start, shift_end, assignable_activities.
- 모든 staffed 이벤트는 해당 인원의 근무시간 안에 있고 assignable 활동에 속한다(C10). 같은 사람이 두 활동 인스턴스를 동시에 수행하지 않는다(C09).
- **엔진 연동 상태**: 현재 엔진은 shift CSV를 읽지 않는다(V03 §11 I-9 deferred). 이 파일은 **미연동 참고 자산**이며, 활용률은 검증 스크립트의 독립 계산으로만 제공한다.

## 6. CSV → XES 직렬화 (V03_CONTRACT §3A 준수)

| 항목 | 규칙 |
|---|---|
| 문서 구조 | UTF-8, XML 1.0 선언, 루트 `log`(xmlns `http://www.xes-standard.org/`), 직계 `trace`, 그 아래 직계 `event`. extension(Concept, Time, Organizational, Lifecycle, Identity), global, classifier는 메타데이터로만 사용. DTD, entity, XInclude, stylesheet 없음 |
| Trace identity | trace `concept:name` = 원래 `case_id` 문자열, trace 속성 `process_type`. 복원 키는 `[process_type, case_id]`. case_id에 프로세스 접두어가 있어 전체 XES에서도 trace 이름이 충돌하지 않고, `xes_duplicate_trace_key`가 발생하지 않는다 |
| Trace 수준 속성 | case 상수 필드: stage(process_type, festival_id, performance_id, stage_id, scheduled_start, act_type, setup_profile) / audience(process_type, festival_id, ticket_type) / equipment(process_type, festival_id, performance_id, stage_id, equipment_request_id, equipment_type, required_ready_at). §3A 상속 규칙에 따라 모든 이벤트로 상속되므로 CSV의 모든 행과 같은 값이다(C16, C23) |
| Event 필수 | `concept:name`(activity), `time:timestamp`(`<date>`, CSV와 같은 문자열) |
| Lifecycle | `start`/`complete`만 `lifecycle:transition`에 기록한다. point 이벤트는 속성을 생략하며(→ import 시 point), 문자열 `point`는 쓰지 않는다 |
| 인스턴스 / 이벤트 ID | `concept:instance` = activity_instance_id, `identity:id`(`<id>`) = event_id. 별칭(`activity_instance_id`, `event_id` 키)은 중복을 피하려고 쓰지 않는다 |
| 자원 | `org:resource` = resource, `org:role` = resource_role(§3A 매핑), `resource_id`는 확장 문자열 |
| 기타 event 속성 | gate_id, asset_id, issue_type(값이 있을 때만, `<string>`, `festival:` 접두어 없음) |
| 순서 | trace = stage, audience, equipment 순으로 case_id 정렬. trace 안 event = 시간순(CSV within-case 순서와 동일). 시간이 같은 이벤트는 없다(C08) |
| 크기 | 전체 3,365,990 B, 6,519 events, 842 traces, 61,612 요소, depth 4. 상한(8 MiB / 50,000 / 10,000 / 500,000 / 32) 이내(C21) |
| 빈 값 | XES에서는 속성을 생략하고, CSV에서는 빈 문자열로 둔다. §3A import 시 기본값이 같다 |

XES 확장 속성 표

| key | XES 타입 | 위치 | CSV 열 |
|---|---|---|---|
| process_type, festival_id, performance_id, stage_id, scheduled_start, required_ready_at, equipment_request_id, equipment_type, ticket_type, act_type, setup_profile | string | trace | 같은 이름 |
| resource_id, gate_id, asset_id, issue_type | string | event | 같은 이름 |
| concept:instance | string | event | activity_instance_id |
| identity:id | id | event | event_id |
| org:role | string | event | resource_role |

`scheduled_start`와 `required_ready_at`은 계약대로 문자열 그대로 보존하려고 `<string>`으로 넣었다. ProM류 도구가 이 값을 날짜로 해석하지는 않는다.

## 7. 데이터 품질 정책
- 시간이 같은 이벤트(timestamp tie)는 case 안에 0건이다. 엔진 `timestamp_tie` 경고가 발생하지 않는다.
- 짝 없는 start, 모호한 instance, 음수 duration은 0건이다(C07).
- Audience의 시간 순서 경고(`audience_event_before_arrival`, `entry_before_scan`) 조건을 만족하는 행은 0건이다(C08).
- 생성기는 '단조 증가 timestamp' 조건과 자원 근무시간 위반이 생기면 바로 예외를 내고 멈춘다.
