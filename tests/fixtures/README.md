# Phase 0 event log fixture

`phase-0-event-log.csv` contains eight hand-authored events across two generic cases. All timestamps use UTC. The CSV omits `process_type`, so both cases belong to `default`. The file is local test data for Phase 0.

| Check | Expected from a manual calculation |
| --- | --- |
| Discovery | `001` → `A, A, B, C` and `002` → `A, C`. Activity counts A=3, B=1, C=2. A→A, A→B, B→C and A→C each occur once. Starts A=2 and ends C=2. |
| Variants and case duration | Each variant accounts for 1/2 of discovered cases. The cases take 15 and 20 minutes. Mean case duration is 17.5 minutes. |
| Inter-event gaps | A→A=5, A→B=7, B→C=3 and A→C=20 minutes. |
| Lifecycle | A1 and B1 each take 4 minutes of service. The matched A→B gap is 3 minutes (08 − 05). |
| Resource coverage | R1 has 4 raw events and 3 discovery instances. R2 has 3 raw events and 2 discovery instances. Known coverage is 7/8 raw events and 5/6 instances. The C event in `001` has no resource. |
| Handoffs | R1→R2 occurs once in `001`. R2→R1 occurs once in `002`. Each resource has 4 measured active minutes. Utilization is N/A because the fixture has no shifts. |

The Phase 0 suite verifies the CSV data and the engine's explicit placeholder errors. The expected analysis values above support later engine tests.
