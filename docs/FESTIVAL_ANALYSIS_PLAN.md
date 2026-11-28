# Festival 분석 계획과 개선 가설

> 수치 표기 규칙: **[독립]** = `validate_festival_logs.py`가 생성된 로그로 직접 계산한 값이다(ProcessPilot 엔진 결과가 아님). **[가설]** = 아직 검증하지 않은 주장. **[엔진에서 확인 필요]** = 시연 전에 ProcessPilot 화면에서 같은 값이 나오는지 확인해야 하는 항목.
> 모든 데이터는 가상 페스티벌 DFO26의 합성 데이터다. 실존 페스티벌의 성과로 해석하지 않는다.

## 1. 여덟 가지 질문 × 세 프로세스

### Q1. 실제로 업무가 어떤 순서로 진행되는가? — Process Discovery (DFG Frequency)
- 필드: process_type, case_id, activity, timestamp, lifecycle(complete/point만 discovery에 사용), event 순서.
- 결과 [독립]: Stage는 99 case, discovery 이벤트 670개, 5개 variant. Audience는 600 case, 2,589개, 11개 variant. Equipment는 143 case, 892개, 5개 variant. 시작 Activity는 Stage Handover, Join Entry Queue, Equipment Requested 하나씩이고, 종료 Activity는 Performance End, Entry Complete/Entry Rejected, Equipment Ready다.
- 확인 가능: 정상 흐름, 선택 경로(Line Check 생략, Wristband Check, Substitute Search), 예외 경로(Troubleshooting, Manual Ticket Check, Additional Screening, Rejection), 반복 경로(Troubleshooting ↔ Recheck, Inspection ↔ Rework).
- 확인 불가: DFG만으로는 AND/XOR 제어 구조를 확정할 수 없다. 그래서 ICN-inspired evidence는 '관측 패턴'으로만 표기한다.

### Q2. 가장 일반적인 경로는? — Variant Analysis
- [독립] Stage 상위 2개 variant가 88.9%다(Line Check 없음 45.5%, 있음 43.4%). Troubleshooting이 포함된 variant는 3개, 합계 11 case(11.1%)다.
- Audience 표준 경로(Join → TV → Security → Entry Complete)는 70.2%, 재입장 경로(Wristband Check 포함)는 17.0%다.
- Equipment 표준 경로는 88.1%다. 나머지 11.9%가 Substitute 또는 Rework를 포함한다.
- 비교 지표: variant별 case 수와 비율, 준비시간 또는 리드타임(아래 Q3), 정시율.

### Q3. 어디에서 시간이 오래 걸리는가? — Performance Map
세 가지 시간 지표를 섞지 않고 구분한다.
- 서비스 시간(matched start → complete) [독립]: Stage Setup 평균 8.9분, Technical Troubleshooting 6.5분, Line Check 4.8분, Handover 4.7분, Technical Check 3.9분. Equipment Substitute Search 21.2분, Transport 14.5분, Inspection Rework 14.2분. Audience Ticket Verification 0.58분(34.8초), Additional Screening 1.75분.
- 활동 간 간격(inter-event, complete → complete): 서비스와 대기가 섞여 있으므로 '대기'라고 부르지 않는다.
- 실제 대기: Audience의 `Join Entry Queue → Ticket Verification start`만 업무 의미상 대기열 대기다. 평균 1.50분, p95 5.25분, 최대 6.92분이다. D1은 평균 2.20분, p95 6.10분이고 D2는 평균 0.89분, p95 2.57분이다.
- Case 경과시간(Stage 평균 62.2분)은 공연시간을 포함한다. 준비시간(Handover start → Stage Ready: 평균 23.2분, 중앙값 21.1분, p90 38.1분)과 구분해서 보고한다. 각 무대 첫 공연은 60분 아침 세팅 창이 있어 준비시간이 길다. 무대 간 비교에서는 이 점을 주의한다.
- 문제 근거 [독립]: Stage Ready ≤ scheduled_start인 비율은 **51.5%**다. 공연 시작 지연은 평균 7.3분, p90 22.3분이다. 무대별 정시 준비율은 RIVER 45.5%, CLUB 45.2%, MAIN 70.8%다. 앞 공연 지연과 다음 공연 지연의 상관계수 r = 0.62다(연관일 뿐 인과는 아님).

### Q4. 어떤 업무가 반복되는가? — Rework Analysis
- Festival 재작업 규칙(adapter `festivalRework`): stage는 `Technical Recheck` 또는 반복된 `Technical Check`, equipment는 `Inspection Rework` 또는 반복된 `Pre-use Inspection`이다.
- [독립] Stage 재점검 case 비율은 11.1%(11 case)이고, 그중 1 case는 Troubleshooting → Recheck를 3회 반복했다. Equipment 검사 재작업률은 7.7%(11 case, 2회 재작업 1 case)다.
- 범용 반복 규칙(같은 Activity가 2번 이상)으로는 stage 1.0%만 잡힌다. Recheck가 별도 Activity명이기 때문이다. Festival 규칙과 범용 규칙의 결과를 구분해서 표시해야 한다.
- 대표 근거 case: PERF-D1-MAIN-08과 PERF-D2-MAIN-08(헤드라이너, complex, 준비 54분, Troubleshooting 1회, 15–17분 늦게 Ready), EQR-0136(대체 장비 + 검사 재작업, 64분 지연).

### Q5. 누가 누구에게 업무를 인계하는가? — WTN-inspired Resource Handoff
- 정의: 같은 case 안에서 인접한 discovery 이벤트의 `resource_id`가 서로 다르고 둘 다 알려진 경우를 인계로 센다. 담당자가 비어 있는 관측 이벤트를 건너뛰어 잇지 않는다.
- [독립] Stage 인계 375회. 무대·교대 안에서 SM → Backline → (Monitor) → FOH → SM 고리가 반복된다. Audience 789회(Lane Checker → Security Screener / Wristband Steward). Equipment 431회(Coordinator → Equipment Manager → Logistics → QC Tech).
- 교대 인계: Late crew의 첫 Handover는 평균 13.1분(n=9), 나머지는 평균 3.8분(n=90)이다. 예: PERF-D1-RIVER-07(RIVER SM L, 16.3분)은 교대 브리핑이 인계 지연으로 관측된다. 이 패턴은 생성 규칙(브리핑 5–15분)에서 나온 것이라 '발견'이 아니라 '설계 조건이 로그에 재현됨'으로 서술해야 한다.
- 확인 불가: 프로세스 간 인력 인계(인력 분리 모델), 인계의 질, 커뮤니케이션 내용.

### Q6. 원래 설계와 무엇이 다른가? — BPMN & Discovered Model Comparison
- 방법: As-is BPMN의 Task 이름이 로그 Activity와 정확히 같으므로 exact 매핑이 되어야 한다. ProcessPilot `getBpmnComparison`(V03 §8)은 매핑된 직접 전이만 허용 adjacency와 비교한다.
- 기대 [엔진에서 확인 필요]: 로그는 As-is 모델에서 생성했으므로 deviation은 0건이어야 한다. 0이 아니면 매핑이나 파서 문제를 의심한다. 이것은 '로그가 모델을 따랐다'는 일관성 확인일 뿐 Conformance Checking(fitness 등)은 아니다.
- 의미 있는 비교: To-be 모델(`audience_to_be.bpmn`)을 reference로 쓰면 재입장 case의 `Join Entry Queue → Ticket Verification` 전이가 To-be에서 허용되지 않는 경로(express lane 우회)로 표시될 것이다 [가설, 엔진에서 확인 필요]. 이는 개선안이 바꾸는 지점을 시각화한다.

### Q7. 어떻게 바꾸면 더 효율적일까? — To-be / Redesign Levers
| 프로세스 | 근거 | 개선 레버 | 정량 평가 가능 여부 |
|---|---|---|---|
| Audience | D1 12:00–12:30 버킷 평균 대기 2.8–4.4분, 최대 6.9분. general TV 평균 42.7초 vs re-entry 9.7초 | (a) 피크 lane 3→4개 (b) 손목밴드 보유자 express lane 분리 | (a) 엔진 서버 수 what-if (b) 독립 모델만 가능 |
| Stage | 정시 준비 51.5%, 지연 전파 r=0.62, 교대 Handover 13.1분, troubleshooting case 준비 42.1분 | 교대 시각을 공연 사이 버퍼 구간으로 옮기기, 교대 브리핑 사전 수행, RIVER 체인지오버 25→30분 또는 공연 길이 조정, complex 공연 앞에 버퍼 배치 | 정성적(엔진에 무대 일정 시뮬레이션 없음) |
| Equipment | 요청 notice < 120분이면 정시율 47.4%(n=19), ≥ 120분이면 100%(n=124). 재작업 variant 정시율 71.4% | late request 마감 규칙(예: required − 2h), 저녁 QC 인력 보강(late shift 1명), 대체 장비 사전 검사 | 정성적. 리드타임 분포 비교만 가능 |
| Cross | 대체·재작업 장비가 연결된 공연의 정시 준비율 43.8%(n=16) vs 정상 연결 58.5%(n=65) | 장비 준비 마감 모니터링을 Stage 일정과 연동 | 연관만 확인. 인과 주장 금지 |

교차 근거 예: PERF-D2-RIVER-02는 연결 장비 EQR-0075가 required_ready_at보다 31분 늦었고, 공연은 Stage Ready가 30분 늦었다. PERF-D1-CLUB-09는 EQR-0044가 92분 늦어 하우스 대체 장비로 진행했다(`equipment_fallback`).

주의:
- 기술 스태프, 보안, 검표 인력의 자격을 무시하고 인력을 재배치하는 안은 제안하지 않는다(예: '보안 인력을 검표로 돌리기' 금지).
- Stage의 '체인지오버 연장'은 공연 수나 종료 시각에 영향을 준다. 비용 정보가 없으므로 효과는 정성적으로만 서술한다.

### Q8. 개선하면 얼마나 달라질까? — What-if Simulation (Audience)
- 모델(엔진 Festival preset): 단일 pooled FCFS 스테이션, 동일 서버, arrival = Join Entry Queue, service = 관측된 Ticket Verification duration, baseline과 candidate에 같은 벡터, baseline_gate_count = 3(manifest).
- [독립, 엔진 등가 코드] 하루별(같은 날 vector):

| Day | Lane | 평균 대기 | p95 | 최대 | 모델 처리량(/h) |
|---|---|---|---|---|---|
| D1 | 3 | 2.02분 | 5.90분 | 6.73분 | 139.9 |
| D1 | 4 | 0.45분 | 2.10분 | 2.60분 | 139.9 |
| D2 | 3 | 0.72분 | 2.42분 | 3.17분 | 161.0 |
| D2 | 4 | 0.11분 | 0.72분 | 1.02분 | 161.0 |

- 전체 600건(이틀 합산) 실행: 3 lane 평균 1.33분, p95 5.08분 → 4 lane 평균 0.27분, p95 1.70분. 이틀 사이 공백이 있어 finish elapsed와 처리량은 의미가 없다. 하루 단위 결과를 사용한다.
- 처리량이 같은 이유: 도착이 같고 모든 시도가 같은 날 처리되므로 마지막 서비스 종료 시각이 거의 같다. 개선 효과는 처리량이 아니라 **대기시간**에서 나타난다.
- 추가 자원: lane +1, 1-qualified-worker 가정이면 Lane Checker +1명(피크 1시간만 운영하면 약 1 인시/일, 비용은 미정).
- 관측과 모델의 차이: 관측 대기에는 lane까지 보행 6–15초가 포함된다. 그래서 관측 평균(1.50분)이 모델 baseline(1.33분)보다 약간 크다. 이 차이는 데이터 오류가 아니라 모델 범위의 차이다.
- 구조 변경(독립 모델, 엔진 불가): 손목밴드 보유자를 express lane 1개로 분리하면 D2(재입장 35%)의 검표 스테이션 p95가 3 lane 기준 2.42분 → 1.35분으로 줄어든다. D1(재입장 6%)은 5.90분 → 5.55분으로 변화가 작다. 4 lane + express를 함께 적용하면 D1 p95는 1.97분이다. **이 수치는 엔진 결과가 아니며 lane 수 변경 효과와 구분해서 보고한다.**
- 해석 한계: 하류 Security 대기, 대기열 이탈, 수요 증가, 인력 교대는 반영하지 않았다. 실제 현장 성과를 약속하지 않는다.

## 2. ICN-inspired Pattern Analysis
- 순차: 각 프로세스의 상위 variant가 그대로 순차 패턴이다.
- 분기(divergence): Stage Setup → {Line Check, Technical Check}, Technical Check → {Stage Ready, Troubleshooting}, Ticket Verification → {Security Check, Wristband Check, Manual Ticket Check}, Availability Check → {Allocation, Substitute Search}, Pre-use Inspection → {Equipment Ready, Inspection Rework}.
- 반복: Troubleshooting → Recheck → Troubleshooting(A,B,A 짧은 루프), Inspection → Rework → Inspection.
- 시간상 병렬(interval overlap): 같은 case 안에서 서로 다른 Activity의 matched interval이 겹치는 경우는 **0건**으로 설계했다. 그래서 overlap 증거가 없다는 결과가 정상이다. AND 구조를 주장하지 않는다.

## 3. Event Log Replay / Monitoring
- 완료 정의: stage `Performance End`, audience `Entry Complete` + `Entry Rejected`(또는 성공만 `Entry Complete`), equipment `Equipment Ready`.
- Replay 장면: D1 12:00–12:30에 TV 활성 interval 3개가 계속 차 있고, `not_yet_observed`이던 case가 빠르게 대기 상태로 쌓이는 모습. 같은 시간 RIVER 무대의 case 진행과 나란히 비교할 수 있다(프로세스를 바꿔 따로 보기).
- 처리량: Audience 15분 버킷의 관측 구간은 D1 12:00–14:00대, D2 같은 시간대다. 버킷 밖은 '관측 안 됨'으로 해석한다.
- 기준 기간과 비교 기간: Audience D1(기준) vs D2(비교). 전이 비율 변화 예: `Ticket Verification → Wristband Check` 비율이 D1 5.7%(16/280)에서 D2 32.8%(105/320)로 바뀐다 [독립]. Stage D1 vs D2·D3(각 33 case)도 비교할 수 있다. 표본은 기간당 30 case 이상이다. 다만 drift의 지원도 판정(`low`/`sufficient`)은 엔진 결과를 따른다.
- Deadline Risk: 진행 중인 case가 없는 완결 로그이므로 사용하지 않는다(관측 기준 시각을 임의로 정하지 않는다).

## 4. Automation & Implementation (평가 입력은 사용자 가정)
| Activity | 로그 근거(빈도 / 서비스) | 규칙 기반 | 디지털 준비도 | 사람 판단 필요 낮음 | 위험 | 난이도 | 메모 |
|---|---|---|---|---|---|---|---|
| Ticket Verification (re-entry 스캔) | 130회 / 9.7초 | 5 | 4 | 4 | low | 2 | RFID 자가 게이트 후보 |
| Ticket Verification (첫 입장) | 470회 / 41.7초 | 3 | 3 | 2 | medium | 3 | 신분증 확인은 사람이 필요 |
| Availability Check | 143회 / 7.1분 | 5 | 4 | 4 | low | 2 | 자산 대장 조회 자동화 |
| Equipment Requested | 143회 / 마커 | 4 | 4 | 3 | low | 1 | 디지털 요청 폼과 마감 규칙 |
| Line Check / Technical Check | 50 / 99회 | 1 | 2 | 0 | **high** | 4 | 안전과 품질 판단 → 자동화 대상 아님(human review) |
| Security Check | 589회 / 23초 | 2 | 2 | 1 | **high** | 5 | 보안은 자동 우선순위에서 제외 |

- 위 1–5 점수는 **사용자 평가 입력 예시**다. Event Log에서 자동으로 정해지는 값이 아니다. 빈도와 서비스 시간만 로그에서 나온다.
- ROI 계산 예시 입력(가정, KRW): 대상 = re-entry 스캔, 기간 = 행사 3일, volume = 재입장 attempt 수(로그 2일 130건 → 3일 전체 규모는 별도 가정), eligible share 0.9, 60×9.7초 → 5초, 시간당 인건비 15,000원(가정), 실현율 0(대기 감소는 인건비로 자동 환산하지 않음), 초기비용과 반복비용은 사용자가 입력한다.
- 절약 시간을 인건비로 환산한 값(capacity value)과 실제 현금 절감(realization)을 분리한다. 관객 대기 감소는 인건비 이익으로 자동 계산하지 않는다(V03 §4).

## 5. BPM Lifecycle과의 연결 (Week 11)
| 단계 | ProcessPilot 화면 | Festival 산출물 |
|---|---|---|
| Identification / Discovery | Overview & Data, Analysis | 3개 프로세스 정의, CSV/XES, DFG, variant |
| Analysis | Performance, Rework, WTN, Patterns | 정시율, 재점검, 인계, 대기 |
| Redesign | Design, Model | Findings → 레버 → `audience_to_be.bpmn` |
| Implementation | Implementation | 자동화 점수, ROI 가정, 단계적 rollout(피크 lane 추가 → express lane 시범 운영) |
| Monitoring & Control | Monitor, Replay | 일별 KPI, 전이 drift, 처리량 |
| Refine | Refine | 3→4 lane what-if, 시나리오 비교 |

## 6. 최종 보고서(15–20쪽) 구성안
1. 주제 선정 이유와 실제 운영 배경(1.5쪽): 대형 페스티벌의 짧은 체인지오버, 입장 대기, 공용 백라인. 출처는 FESTIVAL_SOURCE_REFERENCES.
2. 세 프로세스 정의와 BPMN(4쪽): BUSINESS_PROCESS, BPMN 그림(`reports/evidence/bpmn-preview/*.svg` 또는 ProcessPilot 화면 캡처)
3. 이벤트 로그 구조(2쪽): CSV 23열, XES 매핑 표, 규모
4. 데이터 생성 방법(2쪽): 규칙·분포·seed·보정 이력·한계, AI 활용
5. 도구와 분석 방법(2쪽)
6. 분석 결과(4쪽): Q1–Q6 수치와 대표 case
7. 개선 전략과 시뮬레이션(2쪽): Q7–Q8, 서버 증설과 구조 변경 구분
8. AI 활용 내역(1쪽)
9. 한계와 향후 과제(1쪽)

## 7. 2–3분 시연 영상 장면(실제 생성 데이터 기준, 구현이 확인된 기능만 사용)
1. (0:00–0:15) Festival 샘플 로드. 세 프로세스, 가상 데이터, seed 표시
2. (0:15–0:45) Stage DFG와 Performance Map: Setup·Troubleshooting 구간, 정시 준비 51.5%
3. (0:45–1:00) 재점검 case 근거: PERF-D1-MAIN-08 타임라인(Check → Troubleshooting → Recheck)
4. (1:00–1:20) WTN: 무대별 SM → Backline → FOH 고리, 교대 인계(PERF-D1-RIVER-07)
5. (1:20–1:35) As-is / To-be BPMN 비교(Audience)
6. (1:35–2:05) Audience 탭으로 **전환한 뒤** 3→4 lane what-if(D1 p95 5.9 → 2.1분, 엔진 화면 값으로 교체). 대기 감소일 뿐 무대 문제 해결이 아님을 명시
7. (2:05–2:25) 자동화 후보(re-entry 스캔)와 rollout 계획
8. (2:25–2:45) Equipment ↔ Stage 연계: EQR-0075 → PERF-D2-RIVER-02, notice < 2h 정시율 47%
9. (2:45–2:55) CSV/XES 지원, 한계, AI 사용

영상의 모든 수치는 녹화 전에 ProcessPilot 화면 값으로 다시 확인한다. 위 숫자는 독립 계산값이다.

## 8. 아직 검증하지 않은 가설
- Line Check 생략이 Technical Check 실패를 늘린다는 가설: 생성 규칙에는 +0.12가 들어 있지만, 이번 실현 데이터에서는 밴드 공연 troubleshooting 비율이 Line Check 수행 14.0%(n=50), 생략 4.5%(n=22)로 **반대 방향**이다. 표본이 작아 확인되지 않았다고 보고한다.
- 장비 문제가 공연 지연을 일으킨다는 가설: 연관(43.8% vs 58.5%)만 있고, 인과는 검증하지 않았다.
- 4 lane 운영의 현장 효과와 비용: 미검증이다.
