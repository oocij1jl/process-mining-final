# Test & evidence plan v0.2.1
Run unit tests with Vitest; UI integration tests (or reproducible manual checklist if time-limited) plus production build and private-window URL. These are expected values, not executed tests.

| ID | Fixture / action | Expected |
|---|---|---|
| T01 | C1 A@0 B@10 C@30; C2 A@0 C@20 | A→B=1,B→C=1,A→C=1; starts A=2 ends C=2; variants ABC/AC each 50%; mean elapsed 25 min |
| T02 | C1 A,A,B; C2 A,B all complete | A=3,B=2; A→A=1,A→B=2; if P1 filter >=2 only self-loop hidden; underlying data and variants unchanged |
| T03 | C1 A/R1 B/R2 C/R2 D/missing | raw counts R1=1,R2=2, missing=1; handoff R1→R2=1, no same-resource/missing edge; coverage 3/4 |
| T04 | A start 0 complete 5; B start 8 complete 12 | sequence AB; service 5,4; matched gap 3; inter-event gap 7; elapsed 12 |
| T05 | B 10:00+09:00 then A 01:00Z same case, C other case; invalid timestamp row; quoted comma | B→A=1 gap0 tie warning; no cross-case edge; invalid row blocks until exclusion confirmed; quoted comma one field |
| T06 | same local case ID in stage and equipment | separate cases and graphs |
| T07 | repeated A starts with missing instance IDs | ambiguous service skipped with warning, completion trace retained |
| T08 | no resource/shift; NONE placeholder; invalid date Feb 30; repeated event ID | N/A utilization; missing coverage; invalid date and duplicate ID visibly flagged |
| T09 | arrivals 0,1,2 sec, service 4 sec each | 1 gate waits 0,3,6 sec mean3 max6 finish12; 2 gates waits0,0,2 mean2/3 max2 finish8; p95=max in both |
| T10 | same dataset KPI mean wait 8 min, target max 5 then 10 | status breached→met; measured value unchanged |
| T11 | save design, baseline 3 candidate4, run & apply | computed scenario has +1 gate / +1 qualified worker assumption, plan references result; editable owner/date/status |
| T12 | change candidate to5 or dataset/filter after T11 | stale result cannot apply; new run creates new revision; old plan archived/explicitly retained |
| T13 | load different CSV, export results | all metrics/DFG update; exported counts and scope match displayed analysis |
| T14 | generic log without BPMN, lifecycle, targets or festival metadata | no unrelated sample BPMN/targets; unsupported outputs N/A; upload option available |
| T15 | 2+ resource intervals overlap and shift unavailable | busy union if applicable; utilization N/A without shifts; no inflated % |
| T16 | production build, open deployed link in private window, load sample and CSV | loads without auth, no broken assets, core journey works; record real URL and result |
| T17 | T03 fixture, then load C1 A/R2 B/R1; C2 A/R1 B/R2 | graph first shows R1→R2=1 and coverage 3/4; second shows both directions separately, counts 1 each; click edge lists correct case; table matches graph; no unknown or same-resource edge |

T01–T05 adapt the Codex KGU review section E. T06–T17 are additional ProcessPilot acceptance cases. Save actual command output, screenshots and failures/fixes under `reports/evidence/`. For T09, convert seconds to minutes for comparison. The v0.3 contract adds XES structure, local XML handling, CSV/XES equivalence and v0.3 feature cases. [Phase 2 evidence](../reports/evidence/phase-2-integration.md) · [XES acceptance](V03_CONTRACT.md#3a-csv-and-xes-import-p0) · [v0.3 validation cases](V03_CONTRACT.md#10-validation-cases-for-implementation)
