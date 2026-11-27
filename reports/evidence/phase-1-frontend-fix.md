# Phase 1.1 — Frontend Bug Fix & Specification Compliance

- 일시: 2026-11-27 KST · 브랜치 `feat/frontend` (worktree `processpilot-frontend`) · 기준 커밋 `12eb710` · Node v24.15.0, npm 11.12.1
- 기준 문서: [Phase 1 QA 검수](phase-1-frontend-review.md), `docs/` 명세, Codex 엔진 보고서 `reports/evidence/phase-1-engine.md`·`phase-1-engine-fix.md`(`feat/engine` worktree, 읽기 전용 참조)
- 작업자: Claude Code (Claude Opus 5.5). 작업 도중 Esc로 한 번 중단되었고, 이후 작업 트리를 확인한 뒤 이어서 진행했습니다. 중단 시점까지 편집이 반쯤 진행된 파일은 없었습니다.
- commit, push, merge, 배포는 하지 않았습니다. `src/contracts.ts`, `src/engine/*`, `tests/*`, 패키지·설정 파일, `docs/AI_USAGE_LOG.md`는 변경하지 않았습니다(`git diff --stat` 결과 비어 있음). 새 라이브러리도 설치하지 않았습니다.

> **용어:** "Fixture 기준 PASS"는 손계산 UI fixture 값으로 **UI 경로**를 확인했다는 뜻입니다. 엔진의 계산 정확성 검증이 아닙니다. 이 worktree의 `src/engine`은 아직 Phase 0 스텁이므로 실제 계산 결과는 **NOT TESTABLE**입니다.

## 1. 수정 전후 비교

| 항목 | 수정 전 (Phase 1 QA) | 수정 후 | 확인 |
|---|---|---|---|
| 그래프 초기화와 엔진 재실행 | `scope` memo가 `view` 전체에 의존. Case drawer를 열면 모든 엔진 함수가 다시 실행되고 그래프 zoom이 초기화됨 (Q6 FAIL) | 분석 입력(dataset, process, 케이스 시작 필터, KPI bucket, Festival 설정, target)만 memo 의존성으로 사용. discovery / KPI / findings / evaluations memo 분리. 빈 workspace 참조를 안정화 | Q6 PASS: 열기 전과 후의 viewport `translate(-123.516px, 216.319px) scale(0.971796)` 동일 (dev, preview) |
| To-be BPMN 안내 | 새로고침 후 참조가 남아 있어도 "change note only"로 표시 (Q13 FAIL) | 4가지 상태 구분: ① 렌더링 ② 참조는 저장됐지만 XML 미로드 ③ manifest 자산 로드 중 또는 실패 ④ 참조 없음(change note only). manifest To-be는 "not linked" 배지와 연결 버튼으로 표시 | Q13 PASS(②), R-BPMN PASS(④) |
| CSV 열 수 오류 | `__parsed_extra` 배열과 누락 키가 그대로 엔진에 전달됨 | 잘못된 행은 원본 행 번호와 사유(TooManyFields, TooFewFields, ParseError)를 표시. **명시적 동의** 없이는 로드 불가. 엔진에는 완전한 문자열 행만 전달. `rowMap`으로 이슈·trace 행 번호를 원본 번호로 표시. 제외 행은 Import report와 Evidence에 남김 | 단위 테스트 4개, R-CSV 6항목 PASS |
| 단위 규칙 | `%` 0–100 가정이 문서화되지 않았고, 처리량은 "buckets가 있는 첫 metric" | 엔진 보고서 규칙을 따르되 변환 없이 unit 기준 표시. 시간 `min`, 비율 `%`(0–100), 건수 `cases`, 처리량 `cases/bucket`, Variant share 0–1, 시뮬레이션 `/h`. 처리량은 ID `audience_throughput`(또는 unit `cases/bucket`)로 식별. sparse bucket은 실제 시간축의 빈칸으로 표시하고 0으로 채우지 않음 | Evidence JSON에서 `audience_queue_wait_mean`·`min` 확인 (R-PROV) |
| Festival 설정 전달 | `equipmentDeadline`과 linked traces만 전달. `rework` 없음 | Festival이 활성화된 경우에만 `FestivalKPIConfig` 5개 필드 전부와 stage/equipment `rework` 전달. manifest `festival_config`로 변경 가능 | 단위 테스트 (5개 필드, rework 범위) |
| 일반 CSV와 Festival 분리 | `audience`라는 process 이름만 있으면 시뮬레이션 활성. Festival 프로세스 이름을 모든 데이터에 적용 | Festival adapter를 **명시적으로 활성화**한 경우에만 Festival KPI, rework, 프로세스 이름, gate 시뮬레이션, manifest BPMN 적용. 업로드 기본값은 OFF. Festival 전용 컬럼은 매핑 화면에서 별도 접힘 그룹 | R-GEN 6항목 PASS |
| 출처와 결과 제공자 | `sourceKind`로 "UI FIXTURE · not engine output" 표시. 데이터셋 이름에 제공자 문구 포함 | **Source**(UI fixture CSV / Synthetic Festival log / User-uploaded log)와 **Provider**(UI fixture hand-authored / engine) 배지를 분리. Fixture 관련 문구는 provider 기준. 이름에서 제공자 문구 제거 | R-PROV 7항목 PASS |
| Plan의 provider | 없음. Fixture plan이 엔진 기반 plan처럼 보일 수 있음 | `PlanRecord.provider`(scenario에서 상속). provider가 다르면 read-only와 경고. Plans CSV, plan JSON, evidence에 provider 기록 | R-PROV PASS (`provider=ui_fixture`) |
| 기록 범위 | workspace 키가 `dataset::process`. target과 design이 필터와 무관하게 공유됨 (SPEC 편차) | 키를 `dataset + provider + process + analysisFilter fingerprint`로 변경. 다른 필터·데이터셋·provider의 기록은 Workspace history에서만 read-only로 조회. target은 사용자가 명시적으로 **복사**할 때만 다른 범위로 넘어감 | R-SCOPE 5항목 PASS, 단위 테스트 |
| 이전 Fixture 기록 | 별도 처리 없음 | v1 저장소는 **삭제하지 않고** 읽기만 해서 `legacy (pre-1.1)` read-only workspace로 표시. plan은 archived | R-LEGACY 2항목 PASS, 단위 테스트 |
| Resource 필터 (F02d) | 미구현 | **표시 전용** 필터: 선택한 리소스와 직접 인계 상대만 그래프와 표에 표시. 커버리지·KPI·Findings·Export·다른 페이지는 전체 범위 그대로 사용하며 화면에 명시 | R-DISPLAY 3항목 PASS |
| manifest To-be | 키 없음 | 선택 필드 `bpmn_to_be` 지원(v1.0 manifest 하위 호환). `festival_config`, `missing_resource_values` 지원. 잘못된 선택 필드는 경고 후 무시. Overview에 BPMN 다운로드 링크 | 단위 테스트 6개 |
| Evidence 출처 | provider 문자열만 있음. plans CSV에 provider 없음. generator·seed 누락. "every file labelled" 문구가 사실과 다름 | JSON에 `provider`, `providerDescription`, workspace scope, file rows, 제외 malformed 행, 행 번호 규칙, Festival 설정, manifest(dataset_id, csv, generator, bpmn, bpmn_to_be) 포함. issue에 `fileRow`. 모든 분석·plan·issue CSV에 provider. 안내 문구 정정 | Q12, R-PROV PASS |
| 엔진 리소스 키 | `@resource:["festival",…]` 키가 그대로 노출됨 | `resourceLabel()`로 표시만 변환("Local Crew · F1"). 키 자체는 변경하지 않고 export에도 원본 키 유지 | 단위 테스트 |

## 2. 변경 파일과 이유

| 파일 | 구분 | 이유 |
|---|---|---|
| `src/festival/adapter.ts` | 신규 | Festival 전용 상수, KPI config, rework, gate 가능 여부, manifest 파서와 하위 호환 처리를 한 모듈에 격리 |
| `src/state/scope.ts` | 신규 | 분석 범위, provider, workspace 키를 순수 함수로 정의. 통합용 단일 스위치 `FIXTURE_DATASET_PROVIDER` |
| `src/components/WorkspaceHistory.tsx` | 신규 | 다른 범위와 legacy 기록의 read-only 조회와 JSON 내보내기. lifecycle 페이지에 안내 링크 |
| `src/lib/files.test.ts`, `src/state/scope.test.ts`, `src/festival/adapter.test.ts` | 신규 | 프론트엔드 순수 로직 단위 테스트 17개 (기존 vitest와 node 환경, 의존성 추가 없음) |
| `src/state/types.ts` | 수정 | `ProviderKind`, `MalformedRow`, `rowMap`, `festivalSettings`, `manifest`, `WorkspaceMeta`, `PlanRecord.provider` 추가 |
| `src/state/store.tsx` | 수정 | v2 저장소 키, v1 legacy 이관(읽기 전용), `SET_FESTIVAL`, `COPY_TARGETS`, 현재 범위에만 쓰는 `updateWorkspace`, 안정적인 `useWorkspace` |
| `src/state/analysis.tsx` | 수정 | memo 의존성 분리(Q6). Festival config와 rework는 활성화된 경우에만 전달. 큰 배열 spread 제거 |
| `src/state/plans.ts` | 수정 | plan에 provider 기록 |
| `src/lib/files.ts` | 수정 | 구조 오류 행 검출, `engineRows`/`rowMap` |
| `src/lib/format.ts` | 수정 | unit 기준 표시 주석, Festival 조건부 프로세스 이름, `resourceLabel` |
| `src/adapters/fixtures/uiFixture.ts` | 수정 | metric ID와 unit을 엔진 규칙에 맞춤(값은 손계산 그대로). 데이터셋 이름 정정. 기본 매핑이 아니면 fixture 값을 반환하지 않음. Festival KPI는 Festival context가 있을 때만 반환 |
| `src/components/layout.tsx`, `src/components/cases.tsx` | 수정 | Source와 Provider 배지 분리, 원본 행 번호 표시 |
| `src/pages/OverviewPage.tsx` | 수정 | manifest 파서, Festival 옵트인, Festival 필드 그룹, malformed 동의 UI, provider 기준 안내, BPMN 링크, 이슈 행 번호 변환 |
| `src/pages/AnalysisPage.tsx` | 수정 | Resource 표시 필터, 리소스 라벨, simulation 종류 판정을 Festival 기준으로 |
| `src/pages/DesignPage.tsx` | 수정 | BPMN 상태 4종 구분, manifest As-is·To-be 자동 로드, simulation 판정 |
| `src/pages/ModelPage.tsx` | 수정 | unit별 target 검증, simulation 판정, 다른 필터 target 복사 |
| `src/pages/RefinePage.tsx` | 수정 | simulation 판정, target check를 `audience_queue_wait_mean`으로 한정, provider 기준 안내, proposal plan provider |
| `src/pages/ImplementationPage.tsx` | 수정 | provider 배지·불일치 read-only, CSV·JSON에 provider와 scope |
| `src/pages/MonitorPage.tsx` | 수정 | 처리량 ID·unit 식별, 실제 시간축, sparse bucket 안내 |
| `src/pages/ExportPage.tsx` | 수정 | Evidence provenance 확장, issue `file_row`, 안내 문구 정정, Workspace history |
| `reports/evidence/phase-1-frontend/cdp.mjs`, `journey.mjs`, `qa/qa.mjs` | 수정 (검증 도구) | 출력과 Chrome 프로필을 **OS 임시 폴더**로 이동하고 실행마다 프로필 초기화. 변경된 UI에 맞게 기대값 갱신 |
| `reports/evidence/phase-1-frontend/regression-1-1.mjs` | 신규 (검증 도구) | Phase 1.1 회귀 31항목 |
| `reports/evidence/phase-1-frontend/phase-1-1/*` | 신규 (증거) | 빌드·테스트·브라우저 실행 원문, 스크린샷 2장 |
| `reports/evidence/phase-1-frontend-review.md` | 정정 주석 추가 | QA 검사 개수 오기 정정(아래 5절) |

## 3. 실제 테스트 결과

| 실행 | 결과 | 원문 (`reports/evidence/phase-1-frontend/phase-1-1/`) |
|---|---|---|
| `rm -rf dist && npm run build` | 성공(타입 오류 0). `index` 1,064.98 kB (gzip 315.50 kB), `BpmnViewer` 197.65 kB lazy. 500 kB 초과 경고 유지 | `build-output.txt` |
| `npm test` | **4 files, 30/30 통과**: Phase 0 13개(Codex) + 프론트엔드 17개 | `test-output.txt` |
| 사용자 흐름 journey (dev / preview) | **19/19 PASS** / **19/19 PASS**, 콘솔 오류 0 | `journey-dev.txt`, `journey-preview.txt` |
| QA 추가 검사 (dev / preview) | **18/18 PASS**, INFO 3. 이전 17개 검사 중 Q10 하나가 "목록 표시"와 "동의 전 차단" 두 개로 나뉨 | `qa-dev.txt`, `qa-preview.txt` |
| Phase 1.1 회귀 (dev / preview) | **31/31 PASS** | `regression-1-1-dev.txt`, `regression-1-1-preview.txt` |

모든 브라우저 실행은 headless Chrome에서 실행마다 새 프로필로 진행했습니다. 프로필과 스크린샷 원본은 OS 임시 폴더에만 있습니다.

### 요청 검증 항목별 결과
| 요청 항목 | 결과 | 근거 |
|---|---|---|
| 기존 사용자 흐름 테스트 19개 | PASS 19/19 | journey. 다른 필터 상태의 plan 확인 항목은 새 규칙에 맞게 "history에만 표시"로 기대값 변경 |
| 추가 QA 테스트 | PASS 18/18 | 5절 정정 참조 |
| 결함 2개 회귀 | PASS | Q6 viewport 동일. Q13 "To-be reference saved, diagram not loaded", R-BPMN "No To-be BPMN: change note only" |
| CSV 잘못된 열 개수와 정상 CSV | PASS | 단위 테스트(따옴표 쉼표, 선행 0, `__parsed_extra`, 문자열 전용, rowMap) + R-CSV(행 1·2 사유 표시, 동의 전 차단, 원본 번호 0·3 유지, 제외 목록) |
| Fixture와 실제 결과의 출처 분리 | PASS (UI) | R-PROV: 배지 분리, fixture plan 라벨, plans CSV·JSON provider. 단위 테스트: provider별 workspace 분리 |
| 분석 필터와 Archived 기록 | PASS (UI) | R-SCOPE: 새 필터는 빈 범위로 시작, 명시적 복사, history에 "other case filter", 필터 해제 시 원래 기록 복원. R-LEGACY: v1 기록 read-only, 원본 키 유지 |
| 일반 CSV의 UI 처리 | PASS (UI) | R-GEN: 업로드 기본 Festival OFF, Festival 필드 접힘, OFF 시 프로세스 이름·audience KPI·시뮬레이션 미적용 |
| 일반 CSV의 실제 분석 결과 | **NOT TESTABLE** | 엔진 스텁이라 `validateAndNormalize`가 not-implemented 상태(R-PROV에서 해당 표시 확인) |
| Festival KPI·rework의 엔진 반영 | **NOT TESTABLE** | 전달 내용만 단위 테스트로 확인. 엔진 결과는 통합 후 확인 |

## 4. General Core와 Festival 기능 분리

- **분리됨 (UI 기준).** Festival 전용 로직은 `src/festival/adapter.ts` 한 곳에 있습니다. 일반 코드가 이를 사용하는 지점은 `dataset.festival === true` 조건 뒤에 있습니다: KPIContext.festival, FindingAnalysis.rework, 프로세스 이름, gate 시뮬레이션, manifest BPMN.
- 업로드 기본값은 Festival OFF이며, 매핑 화면의 체크박스나 Dataset 카드 버튼으로 명시적으로 켭니다. Festival 샘플(manifest)은 자동으로 ON입니다. UI fixture는 audience 케이스가 Festival 스키마를 따르므로 ON으로 로드되며, 화면에 표시되고 끌 수 있습니다.
- Festival 설정을 켜거나 끄면 dataset revision이 바뀝니다. 따라서 그 상태에서 만든 기록이 다른 설정의 결과로 표시되지 않습니다.
- **범용 시뮬레이션 제안 (이번에 구현하지 않음):** 현재 엔진의 `getGateInputs`는 도착 활동을 `Join Entry Queue`로 고정합니다. 범용화하려면 공통 계약에 `GateInputOptions.arrivalActivity?: string`(기본값 `Join Entry Queue`)과 `queueProcessKey`를 추가하는 변경이 필요합니다. Codex 소유 `src/contracts.ts`와 엔진의 합의가 필요하므로 제안만 남깁니다. 그 전까지 UI는 Festival audience에서만 시뮬레이션을 제공합니다.

## 5. 이전 보고 정정

Phase 1 QA 검수 보고서는 추가 QA 결과를 "PASS 17, FAIL 2"와 "QA 19개 검사"로 적었지만, 원문 출력의 실제 값은 **검사 17개 중 PASS 15, FAIL 2**였습니다. 이번 지시의 "추가 QA 테스트 19개"도 이 오기를 따른 숫자입니다. 검수 보고서 상단에 정정 주석을 추가했습니다. 이번 실행의 QA는 같은 17개 검사 중 Q10 하나를 두 개로 나눈 18개입니다.

## 6. 최종 Festival manifest와 BPMN 경로

경로(Netlify base `/` 기준):
- `public/datasets/dataset_manifest.json` → `/datasets/dataset_manifest.json`
- `public/datasets/<csv>` → `/datasets/<csv>`
- `public/bpmn/<file>.bpmn` → `/bpmn/<file>.bpmn`

```json
{
  "dataset_id": "demo-festival-ops-2026-v1",
  "name": "Demo Festival Operations 2026 (synthetic)",
  "source_type": "synthetic",
  "csv": "demo_festival_operations_2026.csv",
  "timezone": "Asia/Seoul",
  "baseline_gate_count": 3,
  "service_activity": "Ticket Verification",
  "missing_resource_values": ["", "NONE", "NULL", "0;n/a"],
  "bpmn": { "stage": "stage_as_is.bpmn", "audience": "audience_as_is.bpmn", "equipment": "equipment_as_is.bpmn" },
  "bpmn_to_be": { "audience": "audience_to_be.bpmn" },
  "festival_config": {
    "technical_check_repeat_activity": "Technical Check",
    "stage_handover_point_fallback": false,
    "equipment_deadline": "required_ready_at"
  },
  "generator": { "version": "1.0.0", "seed": 20261127 },
  "source_references": ["https://…"],
  "assumptions": ["Gate service times are modeling assumptions, not observed festival data."]
}
```

| 키 | 필수 | 규칙 (`parseManifest`) |
|---|---|---|
| `csv` | **필수** | `public/datasets/` 기준 상대 파일명. `..`, 절대 경로, URL scheme은 거부. 없으면 Festival 샘플 비활성 |
| `name`, `dataset_id`, `timezone` | 선택 | 비어 있지 않은 문자열. 이름은 가상 이름이어야 함 |
| `source_type` | 선택 | `synthetic` 또는 `user_upload`. 다른 값은 경고 후 무시 |
| `baseline_gate_count` | 선택 | 1 이상 정수. 아니면 경고 후 무시(Model에서 직접 입력) |
| `service_activity` | 선택 | CSV 활동명과 정확히 일치 |
| `missing_resource_values` | 선택 (v1.1) | 문자열 배열. 빈 문자열은 blank |
| `bpmn` | 선택 | `{ process_type: 파일명 }`. 키는 CSV의 `process_type`과 정확히 일치(`stage`, `audience`, `equipment`) |
| `bpmn_to_be` | 선택 (v1.1) | `bpmn`과 같은 형식. To-be 탭에 "not linked" 배지로 표시되고, 사용자가 design에 연결 |
| `festival_config.*` | 선택 (v1.1) | 위 예시의 3개 키. 없으면 기본값(`Technical Check`, `false`, `required_ready_at`) |
| `generator`, `assumptions`, `source_references` | 선택 | Overview와 Evidence JSON에 기록 |

v1.0 manifest(새 키 없음)도 그대로 유효합니다(단위 테스트로 확인). 모르는 키는 무시합니다.

**CSV 형식:**
- UTF-8, 쉼표 구분, **모든 행의 열 수가 같아야 함**.
- 헤더는 DATA_SCHEMA canonical 이름을 사용합니다(자동 매핑).
- `process_type`은 소문자 `stage` / `audience` / `equipment`.
- 시간은 offset이 있는 ISO 8601.
- 활동명은 DATA_SCHEMA §2와 정확히 일치. audience는 `Join Entry Queue`, `Ticket Verification`(start/complete), `Entry Complete` / `Entry Rejected`.
- 축제 간 같은 이름의 리소스는 엔진 QA-02 정책에 따라 `festival_id`로 구분되고, 같은 사람이면 `resource_id`를 사용합니다. UI 매핑 목록에 `resource_id`를 추가했습니다.

**BPMN 형식:** BPMN 2.0 XML, 루트 `definitions`, **`bpmndi:BPMNDiagram`(DI) 필수**입니다. DI가 없으면 렌더링하지 못하고 오류를 표시합니다(Q13 확인).

## 7. 통합 단계에서 필요한 변경

1. 엔진 브랜치를 merge하고 엔진 테스트를 실행합니다.
2. `src/state/scope.ts`의 `FIXTURE_DATASET_PROVIDER`를 `'engine'`으로 바꾸면 fixture CSV도 엔진으로 분석됩니다. 라벨, workspace 키, plan provider가 자동으로 따라 바뀝니다. 이전 fixture 기록은 "other provider"로 history에 남습니다.
3. 브라우저 스크립트 갱신: journey와 qa의 일부 기대값은 fixture 전용입니다(`fixture.tied_timestamp`, "No UI fixture value", 부분 필터 시 fixture-unavailable). 엔진 결과에 맞게 바꿔야 합니다.
4. 엔진 결과로 다시 확인할 항목:
   - T01–T09 화면 값, T13(다른 CSV → 전체 갱신과 export 일치), T14(일반 로그 N/A), T17(실제 handoff와 `@resource:` 라벨)
   - throughput dense/sparse 정책(QA-03)에서 차트 빈칸 표시
   - QA-04/05 case drill-down
5. Festival 자산이 투입되면 Festival 경로(manifest 자동 로드, As-is/To-be, Festival KPI, rework finding)를 확인합니다.
6. 계약 변경 제안(합의 필요): 범용 gate 시뮬레이션용 `arrivalActivity`(4절).

## 8. 남은 결함과 한계

- 실제 계산 결과는 엔진 스텁 때문에 NOT TESTABLE입니다. UI는 fixture 값으로만 확인했습니다.
- 메인 번들 1.06 MB(경고). 이번 범위에서 제외했습니다.
- Festival linked traces(stage↔equipment)는 데이터셋 전체를 사용하며 케이스 필터를 적용하지 않습니다. 의도한 동작이지만 엔진과 재확인이 필요합니다.
- 분석은 렌더 중 동기적으로 실행됩니다. 대용량 로그에서 화면이 멈출 수 있고 loading 표시가 없습니다(미측정).
- Legacy v1 기록의 provider는 engine scenario가 있었는지로 추정합니다. Phase 1 기간에는 엔진이 스텁이었으므로 사실상 모두 `ui_fixture`입니다.
- localStorage에 design의 finding 텍스트가 저장됩니다. 엔진 finding에 리소스 이름이 들어가면 브라우저에 남을 수 있습니다.
- 데이터셋이 바뀌면 이전 기록은 Workspace history(Evidence Export)에서만 조회할 수 있습니다. 각 lifecycle 페이지에는 한 줄 안내만 표시합니다.
- Refine 페이지 부제목 문구("computed audience gate scenario")는 Festival이 꺼진 경우에도 그대로 표시됩니다(경미한 문구 문제).
- `datetime-local` placeholder는 브라우저 로캘을 따릅니다.
- Phase 1 당시의 1회성 실행 출력과 수정 전 라벨의 스크린샷 8장은 git 업로드 전 정리에서 삭제했습니다(수치는 각 보고서 본문에 기록).
- `.gitignore` 변경은 필요하지 않습니다. 검증 산출물을 저장소 밖에 쓰도록 바꿨습니다.

## 9. 프론트엔드 단독 GO / NO-GO

**GO: 엔진 통합 착수 기준 (프론트엔드 단독 범위).** QA에서 재현된 결함 2건은 회귀 테스트로 해결을 확인했습니다. 지시된 명세 준수 항목(범위 키, 출처 분리, CSV 처리, Festival 분리, Resource 필터, manifest 확장)은 빌드, 단위 테스트, 브라우저 3개 스위트(dev와 preview)에서 모두 통과했습니다.

**NO-GO: 릴리스 기준.** 실제 엔진 결과(T01–T17의 화면 검증), Festival 자산, 배포(T16)가 남아 있으므로 이 결과만으로 릴리스를 승인할 수 없습니다.

## 10. AI 활용 내역

- 도구: Claude Code (Claude Opus 5.5). 사용자 지시 프롬프트 2건(Phase 1.1 수정 지시, 중단 후 재개 지시).
- 수행: Codex 엔진 보고서와 소스 읽기(쓰기 없음), 2절의 파일 수정과 생성, 단위·브라우저 테스트 작성과 실행, 이 보고서와 정정 주석 작성.
- 작업 중 발견하고 수정한 것:
  1. 첫 QA 재실행에서 Q13이 실패했는데, 원인은 앱이 아니라 검사 문자열이 To-be 참조 드롭다운의 `— change note only —` 옵션과도 일치한 것이었습니다. 빈 상태 제목만 비교하도록 검사를 고쳤습니다. 화면은 처음부터 올바른 상태를 표시했습니다.
  2. 이전 검수 보고서의 QA 개수 오기를 발견해 정정했습니다(5절).
- `docs/AI_USAGE_LOG.md`는 수정하지 않았습니다.
