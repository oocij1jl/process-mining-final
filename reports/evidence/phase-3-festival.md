# Phase 3 — Festival Business Modeling & Event Log Generation 보고

작성: 2026-11-28 · 데이터 트랙(Claude, 일반 Chat 세션) · 기준 커밋 0aa8887 · 계약 V03_CONTRACT(MD5 4a8ef710…)
저장소는 수정하지 않았다(Git 작업 없음).

## 1. 실제로 확인한 참고 자료
- 프로젝트 문서: START_HERE, AGENT_HANDOFF, DATA_SCHEMA(v0.2.1), **V03_CONTRACT(전문)**, V03_FINAL(Festival 관련 절), KGU_TOOL_ANALYSIS(XES 관련 절), phase-1-frontend-fix §6, phase-2-feature-gap §10
- 코드: `festival/adapter.ts`, `adapter.test.ts`, `engine/festival-kpis.ts`, `audience.ts`, `queue.ts`, `traces.ts`, `ingestion.ts`, `resource-identity.ts`
- 강의자료: Week 9(XES, ICN, WTN 텍스트 추출), Week 10 p.42(Final Report Instructions), Week 3(BPMN 요소 목록). PDF의 그림 슬라이드는 텍스트 추출만 했고 이미지 내용은 확인하지 않았다.
- 읽지 않은 파일: ENGINE_CONTRACT, FUNCTIONAL_SPEC, REQUIREMENTS, SPEC, TEST_PLAN, contracts.ts, 나머지 engine 모듈, phase-1/2 기타 보고서 본문, Week 1·2·4–7·11 강의자료 상세. 이 파일들의 내용은 이 보고서에서 주장하지 않는다.
- 웹: 출처 13건(`docs/FESTIVAL_SOURCE_REFERENCES.md`). 펜타포트 공식 홈페이지는 조회할 수 없었다.

## 2. 실제 생성한 파일
`FILE_MANIFEST.md` 참고. 데이터 6,519 events / 842 cases(stage 99, audience 600, equipment 143), BPMN 4개, manifest, shifts, 스크립트 3개, 문서 7개, 검증 보고서. 전체를 `Festival_Assets.zip`으로 묶었다.

## 3. 직접 실행한 테스트
| 실행 | 환경 | 결과 |
|---|---|---|
| `generate_festival_logs.py` | Python 3.13(cloud) / 3.10(사용자 PC VM) | 성공. 같은 seed로 다시 생성하면 바이트 동일 |
| `validate_festival_logs.py` | 위와 같음 | **23/23 PASS**(C01–C23). 세부 내용은 `festival-data-validation.md` |
| `render_bpmn_preview.py` + rsvg-convert | cloud | 네 모델의 SVG를 육안 확인(교차·겹침 점검) |

**독립 검증과 엔진 검증의 구분**: 위 검증은 모두 문서화된 규칙을 Python으로 다시 구현한 **독립 검증**이다. ProcessPilot 엔진(`validateAndNormalize`, `importXes`, `getKPIs`, `simulateGateQueue`, `getBpmnComparison`)과 bpmn-js는 실행하지 않았다 → **엔진 검증 NOT TESTABLE**.

## 4. 확인된 분석 결과 (독립 계산, 생성 후 측정)
- Stage: 정시 준비율 51.5%, 공연 시작 지연 평균 7.3분(p90 22.3분), RIVER와 CLUB이 낮음(약 45%), 지연 전파 r=0.62, 재점검 11.1%, 교대 첫 Handover 13.1분 vs 3.8분.
- Audience: 관측 대기 평균 1.50분, p95 5.25분. D1(첫 입장 비중 높음)이 D2보다 길다(p95 6.10분 vs 2.57분). 엔진 등가 what-if에서 D1을 3→4 lane으로 바꾸면 평균 2.02→0.45분, p95 5.90→2.10분.
- Equipment: 정시 93.0%. notice < 2h인 요청은 47.4%(n=19), 재작업 variant는 71.4%.
- Cross: 대체·재작업 장비가 연결된 공연의 정시 준비율 43.8% vs 58.5%(연관만 있음).

## 5. 아직 검증하지 않은 가설
- Line Check 생략 → Technical Check 실패 증가: 생성 규칙에는 있지만 실현 데이터에서는 반대 방향이었다(14.0% vs 4.5%, n=50/22). 확인되지 않았다.
- 장비 지연 → 공연 지연 인과, 4 lane과 express lane의 현장 효과, 비용과 ROI.
- Stage·Equipment 개선안의 정량 효과(시뮬레이션 모델 없음 → 정성 제안).

## 6. 계약 관련 추가 확인 사항
README_INTEGRATION §4–§5: completion_activities 확장 제안, XES manifest 키 제안, 선택 열(act_type, setup_profile), shift 미연동, point 이벤트 resource 비움. importXes와 bpmn-js에서 실제 확인 필요.

## 7. 남은 제한사항
- 모든 수치는 가정에 기반한 합성 데이터다. 실존 페스티벌의 대기·인력·실패율은 공개 자료가 없다.
- 생성 파라미터를 한 차례 보정했다(실행 불가능한 일정 수정, 자원 분배 규칙. `FESTIVAL_DATA_DESIGN §1` 기록). seed는 바꾸지 않았다.
- Audience 표본은 입구 1곳의 2일×2시간 기록이다. 하류 Security 대기와 대기열 이탈은 시뮬레이션 범위 밖이다.
- 엔진 Festival queue preset에 이틀치 600건을 함께 넣으면 처리량·종료시간 해석이 어렵다. 하루 단위 필터를 권장한다.
- BPMN은 생성기가 좌표를 계산한다. bpmn-js 실제 렌더링(라벨 줄바꿈 등)은 확인하지 못했다.

## 8. 데이터 자산 통합 판정
**GO (조건부)** — P0 자산(As-is BPMN 3개 + To-be 1개, 재현 가능한 생성기, 전체 CSV/XES와 개별 XES, manifest, 검증, 분석 계획)이 모두 생성되었고 독립 검증 23/23을 통과했다. 기존 manifest 키만 사용해 CSV 경로의 호환성을 유지했다.
조건: 통합 후 ①Festival 샘플 로드 ②XES import accepted ③BPMN 4개 렌더링 ④queue preset 결과가 독립 계산과 일치 — 이 네 가지를 ProcessPilot에서 확인한다. 하나라도 실패하면 해당 자산만 NO-GO로 돌리고 원인(계약 해석 차이)을 기록한다.

## 9. AI 활용 내역 (보고서용)
- Claude(이 세션): 공개 자료 웹 검색·조회와 출처 정리, 기존 계약·코드 검토, 프로세스·BPMN 설계, 생성기·검증기·미리보기 스크립트 작성과 실행, 결과 계산, 문서 초안 작성.
- 사람이 해야 할 일: 가정의 타당성 검토, ProcessPilot에서 실제 확인, 보고서 최종 서술과 수치 교차 확인.
