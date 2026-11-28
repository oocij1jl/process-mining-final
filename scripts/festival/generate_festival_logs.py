#!/usr/bin/env python3
"""
generate_festival_logs.py — Demo Festival Operations 2026 (synthetic)

One run builds ONE in-memory event model and serialises it to
  public/datasets/demo_festival_operations_2026.csv   (canonical CSV, DATA_SCHEMA v0.2.1)
  public/datasets/demo_festival_operations_2026.xes   (IEEE XES, V03_CONTRACT §3A subset)
  public/datasets/{stage_operations,audience_entry,equipment_readiness}.xes  (extracted, not re-generated)
  public/datasets/{stage_operations,audience_entry,equipment_readiness}.csv  (extracted)
  public/datasets/resource_shifts.csv
  public/datasets/dataset_manifest.json
  public/bpmn/{stage_as_is,audience_as_is,equipment_as_is,audience_to_be}.bpmn

Python standard library only.  Deterministic: fixed seed, string-seeded sub-streams per process
(random.Random(str) uses SHA-512, independent of PYTHONHASHSEED), integer-second timestamps.

Usage:  python3 scripts/festival/generate_festival_logs.py [--out <festival-assets root>] [--seed 20261127]

All numbers in this file are MODELING ASSUMPTIONS documented in docs/FESTIVAL_DATA_DESIGN.md.
They are not observed values of any real festival.
"""
from __future__ import annotations

import argparse
import bisect
import csv
import io
import json
import math
import os
import random
from datetime import date, datetime, timedelta, timezone
from xml.sax.saxutils import escape

VERSION = "1.0.0"
DEFAULT_SEED = 20261127
TZ = timezone(timedelta(hours=9))
FESTIVAL_ID = "DFO26"
DATASET_NAME = "Demo Festival Operations 2026 (synthetic)"
DAYS = [("D1", date(2026, 8, 7)), ("D2", date(2026, 8, 8)), ("D3", date(2026, 8, 9))]
AUDIENCE_DAYS = {"D1": 280, "D2": 320}          # sampled entrance windows (complete record of one secondary entrance)
BASELINE_LANES = 3

CSV_FIELDS = [
    "event_id", "process_type", "case_id", "activity", "timestamp", "lifecycle", "activity_instance_id",
    "resource", "resource_role", "resource_id", "festival_id", "performance_id", "stage_id", "gate_id",
    "equipment_request_id", "equipment_type", "asset_id", "scheduled_start", "required_ready_at",
    "ticket_type", "issue_type", "act_type", "setup_profile",
]
# Case-constant attributes serialised once at XES trace level (must be constant on every CSV row of the case).
TRACE_FIELDS = {
    "stage": ["process_type", "festival_id", "performance_id", "stage_id", "scheduled_start", "act_type", "setup_profile"],
    "audience": ["process_type", "festival_id", "ticket_type"],
    "equipment": ["process_type", "festival_id", "performance_id", "stage_id", "equipment_request_id",
                  "equipment_type", "required_ready_at"],
}
EVENT_EXTRA_FIELDS = ["resource_id", "gate_id", "asset_id", "issue_type"]

ACTIVITIES = {
    "stage": ["Stage Handover", "Stage Setup", "Line Check", "Technical Check", "Technical Troubleshooting",
              "Technical Recheck", "Stage Ready", "Performance Start", "Performance End"],
    "audience": ["Join Entry Queue", "Ticket Verification", "Manual Ticket Check", "Security Check",
                 "Additional Screening", "Wristband Check", "Entry Complete", "Entry Rejected"],
    "equipment": ["Equipment Requested", "Availability Check", "Equipment Allocation", "Substitute Search",
                  "Equipment Transport", "Pre-use Inspection", "Inspection Rework", "Equipment Ready"],
}

MIN = 60
# Terminal / completion activities per process (for Replay and generic case throughput, V03_CONTRACT §6-§7)
COMPLETION_ACTIVITIES = {
    "stage": ["Performance End"],
    "audience": ["Entry Complete", "Entry Rejected"],   # use ["Entry Complete"] for admitted-entry throughput
    "equipment": ["Equipment Ready"],
}


# ----------------------------------------------------------------------------- time helpers
def at(d: date, hh: int, mm: int = 0, ss: int = 0) -> int:
    """Epoch seconds for a local (+09:00) wall-clock time; hh may be 24 for midnight of next day."""
    base = datetime(d.year, d.month, d.day, tzinfo=TZ) + timedelta(hours=hh, minutes=mm, seconds=ss)
    return int(base.timestamp())


def iso(sec: int) -> str:
    return datetime.fromtimestamp(sec, TZ).strftime("%Y-%m-%dT%H:%M:%S+09:00")


def lognorm(rng: random.Random, median: float, sigma: float, lo: float, hi: float) -> float:
    """Truncated (clamped) log-normal draw; median and bounds in the caller's unit."""
    return min(hi, max(lo, median * math.exp(rng.gauss(0.0, sigma))))


def uni(rng: random.Random, a: int, b: int) -> int:
    return rng.randint(a, b)


# ----------------------------------------------------------------------------- resources
class Resource:
    """A person with shift windows.  Busy intervals are kept sorted; no overlap is ever booked."""

    def __init__(self, rid, name, role, process, area, shifts, activities):
        self.rid, self.name, self.role, self.process, self.area = rid, name, role, process, area
        self.shifts = sorted(shifts)
        self.activities = activities
        self.busy: list[tuple[int, int]] = []

    def on_shift(self, t: int) -> bool:
        return any(s <= t <= e for s, e in self.shifts)

    def earliest(self, ready: int, dur: int):
        for ss, se in self.shifts:
            t = max(ready, ss)
            if t + dur > se:
                continue
            i = bisect.bisect_left(self.busy, (t, -1))
            if i > 0 and self.busy[i - 1][1] > t:
                t = self.busy[i - 1][1]
            ok = True
            while i < len(self.busy):
                bs, be = self.busy[i]
                if be <= t:
                    i += 1
                    continue
                if bs >= t + dur:
                    break
                t = be
                i += 1
            if t + dur <= se and ok:
                return t
        return None

    def book(self, s: int, e: int):
        assert e >= s
        bisect.insort(self.busy, (s, e))


def assign(pool, ready, dur, prefer=None, label=""):
    best = None
    for idx, r in enumerate(pool):
        t = r.earliest(ready, dur)
        if t is None:
            continue
        last_end = max((e for s0, e in r.busy if e <= t), default=-1)  # longest-idle person first on ties
        key = (t, 0 if r is prefer else 1, last_end, idx)
        if best is None or key < best[0]:
            best = (key, r, t)
    if best is None:
        raise RuntimeError(f"No feasible resource slot for {label} ready={iso(ready)} dur={dur}s")
    _, r, t = best
    return r, t


def on_shift_choice(pool, t, prefer=None):
    cands = [r for r in pool if r.on_shift(t)]
    if not cands:
        raise RuntimeError(f"No resource on shift at {iso(t)}")
    if prefer is not None and prefer in cands:
        return prefer
    return cands[0]


# ----------------------------------------------------------------------------- event builder
class Case:
    def __init__(self, process, case_id, const):
        self.process, self.case_id, self.const = process, case_id, dict(const)
        self.events: list[dict] = []
        self.n = 0
        self.last_t = None

    def _check(self, t):
        if self.last_t is not None and t <= self.last_t:
            raise RuntimeError(f"Non-increasing timestamp in {self.case_id}: {iso(t)} <= {iso(self.last_t)}")
        self.last_t = t

    def new_instance(self):
        self.n += 1
        return f"{self.case_id}#{self.n:02d}"

    def emit(self, activity, t, lifecycle, inst, res=None, **extra):
        self._check(t)
        ev = {k: "" for k in CSV_FIELDS}
        ev.update(self.const)
        ev.update({
            "process_type": self.process, "case_id": self.case_id, "activity": activity,
            "_t": t, "timestamp": iso(t), "lifecycle": lifecycle, "activity_instance_id": inst,
            "festival_id": FESTIVAL_ID,
        })
        if res is not None:
            ev.update({"resource": res.name, "resource_role": res.role, "resource_id": res.rid})
        for k, v in extra.items():
            ev[k] = v
        self.events.append(ev)
        return ev

    def task(self, activity, start, end, res, **extra):
        inst = self.new_instance()
        self.emit(activity, start, "start", inst, res, **extra)
        self.emit(activity, end, "complete", inst, res, **extra)
        return inst

    def marker(self, activity, t, res=None, lifecycle="complete", **extra):
        self.emit(activity, t, lifecycle, self.new_instance(), res, **extra)


# ----------------------------------------------------------------------------- staffing
STAGES = {
    # stage_id: (first start hh, mm, set lengths (min), changeovers (min), dj share, complex share)
    "MAIN": ((12, 0), [35, 40, 40, 45, 50, 55, 60, 75], [30, 30, 30, 35, 35, 35, 40], 0.10, 0.45),
    "RIVER": ((11, 30), [30, 30, 30, 35, 35, 35, 35, 40, 40, 40, 45], [25] * 10, 0.15, 0.20),
    "CLUB": ((12, 0), [25] * 10 + [30, 30, 35, 35], [20] * 13, 0.50, 0.08),
}
FIRST_CHANGEOVER_MIN = 60
STAGE_PARAMS = {  # medians in minutes
    "MAIN": dict(handover=3.5, setup=9.0, line=4.5, tech_band=4.0, compress=10, transport=15.0),
    "RIVER": dict(handover=2.5, setup=7.0, line=3.5, tech_band=3.0, compress=8, transport=20.0),
    "CLUB": dict(handover=2.0, setup=5.0, line=3.0, tech_band=2.5, compress=6, transport=8.0),
}
EQUIPMENT_HOLD_LIMIT_MIN = 10   # setup waits for late gear at most until scheduled_start + 10 min, then uses house fallback


def day_shifts(start, end):
    """[(start,end)] for each festival day; times as (hh,mm) local; end hh may be 24."""
    return [(at(d, *start), at(d, *end)) for _, d in DAYS]


def build_staff():
    staff = {"stage": {}, "audience": {}, "equipment": {}}
    rows = []

    def mk(process, rid, name, role, area, shifts, acts):
        r = Resource(rid, name, role, process, area, shifts, acts)
        rows.append(r)
        return r

    stage_roles = [
        ("stage_manager", "Stage Manager", 1, ["Stage Handover", "Stage Ready", "Performance Start", "Performance End"]),
        ("backline_tech", "Backline Tech", 2, ["Stage Setup", "Technical Troubleshooting"]),
        ("monitor_engineer", "Monitor Engineer", 1, ["Line Check", "Technical Troubleshooting"]),
        ("foh_engineer", "FOH Engineer", 1, ["Technical Check", "Technical Recheck"]),
        ("lighting_operator", "Lighting Operator", 1, ["Technical Troubleshooting"]),
    ]
    for st in STAGES:
        staff["stage"][st] = {}
        for role, label, count, acts in stage_roles:
            pool = []
            for crew, (s, e) in (("E", ((10, 0), (17, 30))), ("L", ((16, 0), (24, 0)))):
                for i in range(1, count + 1):
                    suffix = f"{crew}{i}" if count > 1 else crew
                    rid = f"{FESTIVAL_ID}-{st}-{label.replace(' ', '')}-{suffix}"
                    name = f"{st} {label} {suffix}"
                    pool.append(mk("stage", rid, name, role, st, day_shifts(s, e), acts))
            staff["stage"][st][role] = pool

    aud_shift = day_shifts((11, 30), (15, 30))
    aud_days = [(s, e) for (s, e), (dk, _) in zip(aud_shift, DAYS) if dk in AUDIENCE_DAYS]
    a = staff["audience"]
    a["lane"] = [mk("audience", f"{FESTIVAL_ID}-NG-LaneChecker-{i}", f"Lane Checker {i}", "ticket_checker",
                    f"NG-L{i}", aud_days, ["Ticket Verification"]) for i in range(1, BASELINE_LANES + 1)]
    a["support"] = [mk("audience", f"{FESTIVAL_ID}-NG-TicketSupport-{i}", f"Ticket Support {i}", "ticket_supervisor",
                       "NG-DESK", aud_days, ["Manual Ticket Check", "Entry Rejected"]) for i in (1, 2)]
    a["steward"] = [mk("audience", f"{FESTIVAL_ID}-NG-WristbandSteward-1", "Wristband Steward 1", "wristband_steward",
                       "NG-WB", aud_days, ["Wristband Check", "Entry Rejected"])]
    a["security"] = [mk("audience", f"{FESTIVAL_ID}-NG-SecurityScreener-{i}", f"Security Screener {i}", "security_screener",
                        "NG-SEC", aud_days, ["Security Check"]) for i in range(1, 5)]
    a["supervisor"] = [mk("audience", f"{FESTIVAL_ID}-NG-SecuritySupervisor-1", "Security Supervisor 1",
                          "security_supervisor", "NG-SEC", aud_days, ["Additional Screening", "Entry Rejected"])]

    e = staff["equipment"]
    early, late = ((7, 30), (16, 30)), ((13, 0), (23, 0))
    e["coordinator"] = [mk("equipment", f"{FESTIVAL_ID}-PROD-Coordinator-A", "Production Coordinator A",
                           "production_coordinator", "PROD", day_shifts((7, 30), (15, 30)), ["Equipment Requested"]),
                        mk("equipment", f"{FESTIVAL_ID}-PROD-Coordinator-B", "Production Coordinator B",
                           "production_coordinator", "PROD", day_shifts((14, 30), (23, 0)), ["Equipment Requested"])]
    e["manager"] = [mk("equipment", f"{FESTIVAL_ID}-EQ-Manager-{i}", f"Equipment Manager {i}", "equipment_manager",
                       "BACKLINE-STORE", day_shifts(*(early if i <= 2 else late)),
                       ["Availability Check", "Substitute Search", "Equipment Allocation"]) for i in (1, 2, 3)]
    e["logistics"] = [mk("equipment", f"{FESTIVAL_ID}-EQ-Logistics-{i}", f"Logistics Crew {i}", "logistics_crew",
                         "SITE", day_shifts(*(early if i <= 2 else late)), ["Equipment Transport"]) for i in (1, 2, 3, 4)]
    e["qc"] = [mk("equipment", f"{FESTIVAL_ID}-EQ-BacklineQC-{i}", f"Backline QC Tech {i}", "backline_qc_tech",
                  "STAGE-DOCK", day_shifts(*(((8, 0), (16, 30)) if i <= 2 else late)),
                  ["Pre-use Inspection", "Inspection Rework", "Equipment Ready"]) for i in (1, 2, 3)]
    return staff, rows


# ----------------------------------------------------------------------------- plan (schedule)
def build_plan(rng):
    perfs = []
    for dk, d in DAYS:
        for st, ((hh, mm), lengths, changeovers, dj_share, complex_share) in STAGES.items():
            t = at(d, hh, mm)
            n = len(lengths)
            for k in range(n):
                if k > 0:
                    t = t + changeovers[k - 1] * MIN
                length = lengths[k]
                is_last = k == n - 1
                act = "band" if (st == "MAIN" and k >= n - 2) else ("dj" if rng.random() < dj_share else "band")
                complex_ = (st == "MAIN" and k >= n - 2) or (act == "band" and rng.random() < complex_share)
                planned_co = FIRST_CHANGEOVER_MIN if k == 0 else changeovers[k - 1]
                perfs.append(dict(
                    pid=f"PERF-{dk}-{st}-{k + 1:02d}", day=dk, date=d, stage=st, k=k, n=n,
                    S=t, L=length, co=planned_co, act=act, profile="complex" if complex_ else "standard",
                    planned_end=t + length * MIN, last=is_last,
                ))
                t = t + length * MIN
    return perfs


# ----------------------------------------------------------------------------- equipment
EQUIP_TYPES = {  # type: (code, house assets)
    "Drum Kit": ("DRUM", 4), "Guitar Amp": ("GAMP", 8), "Bass Amp": ("BAMP", 4), "Keyboard Rig": ("KEYS", 3),
    "Wireless Mic Kit": ("WMIC", 5), "IEM Pack": ("IEM", 4), "DJ Booth Set": ("DJB", 3),
}
BAND_NEEDS = [("Drum Kit", 0.40), ("Guitar Amp", 0.50), ("Bass Amp", 0.30), ("Keyboard Rig", 0.15),
              ("Wireless Mic Kit", 0.20), ("IEM Pack", 0.10)]
DJ_NEEDS = [("DJ Booth Set", 0.85), ("Wireless Mic Kit", 0.15)]


def gen_equipment(rng, perfs, staff):
    E = staff["equipment"]
    reqs = []
    for p in perfs:
        needs = BAND_NEEDS if p["act"] == "band" else DJ_NEEDS
        for etype, prob in needs:
            if rng.random() < prob:
                required = p["S"] - p["co"] * MIN
                late = rng.random() < 0.15
                lead = uni(rng, 35, 90) if late else uni(rng, 180, 360)
                day_open = at(p["date"], 8, 0)
                t0 = max(required - lead * MIN, day_open + uni(rng, 0, 20) * MIN) + uni(rng, 0, 59)
                reqs.append(dict(perf=p, etype=etype, required=required, t0=t0, late=late))
    reqs.sort(key=lambda r: (r["t0"], r["perf"]["pid"], r["etype"]))
    occupancy = {etype: [[] for _ in range(n)] for etype, (_, n) in EQUIP_TYPES.items()}
    alt_counter = {etype: 0 for etype in EQUIP_TYPES}
    cases, ready_by_perf, issue_by_perf = [], {}, {}

    for i, r in enumerate(reqs, start=1):
        p, etype = r["perf"], r["etype"]
        code = EQUIP_TYPES[etype][0]
        cid = f"EQR-{i:04d}"
        c = Case("equipment", cid, {
            "performance_id": p["pid"], "stage_id": p["stage"], "equipment_request_id": cid,
            "equipment_type": etype, "required_ready_at": iso(r["required"]),
        })
        pc = on_shift_choice(E["coordinator"], r["t0"])
        c.marker("Equipment Requested", r["t0"], pc)

        dur = int(lognorm(rng, 6, 0.4, 2, 20) * MIN) + uni(rng, 0, 59)
        em, s = assign(E["manager"], r["t0"] + uni(rng, 60, 300), dur, label=cid)
        em.book(s, s + dur)
        c.task("Availability Check", s, s + dur, em)
        t = s + dur

        window = (r["required"] - 30 * MIN, p["planned_end"] + 20 * MIN)
        free_idx = None
        for ai, occ in enumerate(occupancy[etype]):
            if all(e2 <= window[0] or s2 >= window[1] for s2, e2 in occ):
                free_idx = ai
                break
        rider_mismatch = rng.random() < 0.07
        substitute = free_idx is None or rider_mismatch
        if substitute:
            issue = "pool_conflict" if free_idx is None else "rider_model_unavailable"
            dur = int(lognorm(rng, 20, 0.45, 8, 50) * MIN) + uni(rng, 0, 59)
            em2, s = assign(E["manager"], t + uni(rng, 30, 180), dur, prefer=em, label=cid)
            em2.book(s, s + dur)
            c.task("Substitute Search", s, s + dur, em2, issue_type=issue)
            t = s + dur
            alt_counter[etype] += 1
            asset = f"ALT-{code}-{alt_counter[etype]:02d}"
            em = em2
        else:
            asset = f"{code}-{free_idx + 1:02d}"
            occupancy[etype][free_idx].append(window)

        dur = int(lognorm(rng, 5, 0.35, 2, 12) * MIN) + uni(rng, 0, 59)
        em3, s = assign(E["manager"], t + uni(rng, 30, 120), dur, prefer=em, label=cid)
        em3.book(s, s + dur)
        c.task("Equipment Allocation", s, s + dur, em3, asset_id=asset)
        t = s + dur

        dur = int(lognorm(rng, STAGE_PARAMS[p["stage"]]["transport"], 0.3, 4, 45) * MIN) + uni(rng, 0, 59)
        lg, s = assign(E["logistics"], t + uni(rng, 120, 600), dur, label=cid)
        lg.book(s, s + dur)
        c.task("Equipment Transport", s, s + dur, lg, asset_id=asset)
        t = s + dur

        reworked = False
        qc_prev = None
        fail_p = 0.07 + (0.12 if substitute else 0.0)
        attempt = 0
        while True:
            attempt += 1
            dur = int(lognorm(rng, 8 if attempt == 1 else 6, 0.35, 3, 20) * MIN) + uni(rng, 0, 59)
            gap = uni(rng, 20, 90)
            qc, s = assign(E["qc"], t + uni(rng, 60, 240) if attempt == 1 else t + uni(rng, 30, 90),
                           dur + gap, prefer=qc_prev, label=cid)
            qc.book(s, s + dur + gap)
            c.task("Pre-use Inspection", s, s + dur, qc, asset_id=asset)
            t = s + dur
            qc_prev = qc
            failed = attempt <= 2 and rng.random() < (fail_p if attempt == 1 else 0.15)
            if not failed:
                c.marker("Equipment Ready", t + gap, qc, asset_id=asset)
                t = t + gap
                break
            reworked = True
            issue = rng.choice(["cable_fault", "connector_damage", "power_supply_fault", "missing_accessory"])
            dur = int(lognorm(rng, 15, 0.45, 5, 45) * MIN) + uni(rng, 0, 59)
            qc2, s = assign(E["qc"], t + uni(rng, 30, 120), dur, prefer=qc, label=cid)
            qc2.book(s, s + dur)
            c.task("Inspection Rework", s, s + dur, qc2, asset_id=asset, issue_type=issue)
            t = s + dur
            qc_prev = qc2
        ready_by_perf[p["pid"]] = max(ready_by_perf.get(p["pid"], 0), t)
        if substitute or reworked:
            issue_by_perf[p["pid"]] = True
        cases.append(c)
    return cases, ready_by_perf, issue_by_perf


# ----------------------------------------------------------------------------- stage
ISSUES_BAND = [("monitor_mix", 0.35), ("signal_path", 0.30), ("wireless_rf", 0.15), ("lighting_cue", 0.20)]
ISSUES_DJ = [("signal_path", 0.50), ("monitor_mix", 0.30), ("lighting_cue", 0.20)]
ISSUE_ROLE = {"monitor_mix": "monitor_engineer", "wireless_rf": "monitor_engineer",
              "signal_path": "backline_tech", "lighting_cue": "lighting_operator"}


def weighted(rng, items):
    x = rng.random() * sum(w for _, w in items)
    for v, w in items:
        x -= w
        if x <= 0:
            return v
    return items[-1][0]


def book_task(pool, ready, dur, prefer=None, label=""):
    r, s = assign(pool, ready, dur, prefer=prefer, label=label)
    r.book(s, s + dur)
    return r, s


def gen_stage(rng, perfs, staff, eq_ready, eq_issue):
    cases = []
    by_stage_day = {}
    for p in perfs:
        by_stage_day.setdefault((p["day"], p["stage"]), []).append(p)
    for key in sorted(by_stage_day, key=lambda k: (k[0], list(STAGES).index(k[1]))):
        plist = by_stage_day[key]
        st = key[1]
        P = STAGE_PARAMS[st]
        crew = staff["stage"][st]
        prev_end, last_sm = None, None
        for p in plist:
            c = Case("stage", p["pid"], {
                "performance_id": p["pid"], "stage_id": st, "scheduled_start": iso(p["S"]),
                "act_type": p["act"], "setup_profile": p["profile"],
            })
            S = p["S"]
            # Stage Handover
            ready = S - FIRST_CHANGEOVER_MIN * MIN if p["k"] == 0 else prev_end + uni(rng, 60, 180)
            dur = int(lognorm(rng, P["handover"], 0.35, 2, 15) * MIN) + uni(rng, 0, 59)
            sm, s = assign(crew["stage_manager"], ready, dur, label=p["pid"])
            if last_sm is not None and sm is not last_sm:  # incoming crew: shift-change briefing (design rule)
                dur += int(lognorm(rng, 9, 0.3, 5, 15) * MIN)
                sm, s = assign(crew["stage_manager"], ready, dur, prefer=sm, label=p["pid"])
            sm.book(s, s + dur)
            c.task("Stage Handover", s, s + dur, sm)
            last_sm = sm
            t = s + dur
            # Stage Setup (must wait for all linked equipment to be ready)
            base = lognorm(rng, P["setup"], 0.3, 3, 60)
            base *= 1.5 if p["profile"] == "complex" else 1.0
            base *= 0.6 if p["act"] == "dj" else 1.0
            base = int(base * MIN) + uni(rng, 0, 59)
            ready = t + uni(rng, 15, 60)
            need = eq_ready.get(p["pid"])
            install = uni(rng, 120, 300)
            hold_limit = S + EQUIPMENT_HOLD_LIMIT_MIN * MIN
            fallback = False
            dur = base
            for _ in range(6):
                bt, s = assign(crew["backline_tech"], ready, dur, label=p["pid"])
                fallback = bool(need) and need + install > max(hold_limit, s + base)
                target_end = min(need + install, max(hold_limit, s + base)) if need else s + base
                want = max(base, target_end - s)
                if want == dur:
                    break
                dur = want
            bt.book(s, s + dur)
            c.task("Stage Setup", s, s + dur, bt, **({"issue_type": "equipment_fallback"} if fallback else {}))
            t = s + dur
            compressed = t > S - P["compress"] * MIN
            skipped_lc = False
            if p["act"] == "band":
                if compressed and rng.random() < 0.6:
                    skipped_lc = True
                else:
                    dur = lognorm(rng, P["line"], 0.3, 2, 20) * (1.2 if p["profile"] == "complex" else 1.0)
                    dur = int(dur * MIN) + uni(rng, 0, 59)
                    me, s = book_task(crew["monitor_engineer"], t + uni(rng, 10, 40), dur, label=p["pid"])
                    c.task("Line Check", s, s + dur, me)
                    t = s + dur
            med = 3.0 if p["act"] == "dj" else P["tech_band"]
            dur = int(lognorm(rng, med, 0.3, 1.5, 15) * (1.2 if p["profile"] == "complex" else 1.0) * MIN) + uni(rng, 0, 59)
            foh, s = book_task(crew["foh_engineer"], t + uni(rng, 10, 40), dur, label=p["pid"])
            c.task("Technical Check", s, s + dur, foh)
            t = s + dur
            p_fail = 0.08 + (0.10 if p["profile"] == "complex" else 0) + (0.12 if skipped_lc else 0) \
                + (0.08 if eq_issue.get(p["pid"]) else 0) + (0.10 if fallback else 0)
            failed = rng.random() < p_fail
            loops = 0
            while failed and loops < 3:
                loops += 1
                issue = weighted(rng, ISSUES_BAND if p["act"] == "band" else ISSUES_DJ)
                dur = int(lognorm(rng, 7, 0.5, 2, 25) * MIN) + uni(rng, 0, 59)
                tech, s = book_task(crew[ISSUE_ROLE[issue]], t + uni(rng, 15, 60), dur, label=p["pid"])
                c.task("Technical Troubleshooting", s, s + dur, tech, issue_type=issue)
                t = s + dur
                dur = int(lognorm(rng, 3, 0.3, 1, 8) * MIN) + uni(rng, 0, 59)
                foh, s = book_task(crew["foh_engineer"], t + uni(rng, 15, 45), dur, prefer=foh, label=p["pid"])
                c.task("Technical Recheck", s, s + dur, foh, issue_type=issue)
                t = s + dur
                failed = loops < 3 and rng.random() < 0.20
            # Milestones by the Stage Manager on shift
            t_ready = t + uni(rng, 15, 60)
            c.marker("Stage Ready", t_ready, on_shift_choice(crew["stage_manager"], t_ready, prefer=sm))
            t_start = max(S, t_ready + uni(rng, 60, 150)) + uni(rng, 0, 120)
            c.marker("Performance Start", t_start, on_shift_choice(crew["stage_manager"], t_start, prefer=sm))
            lateness = max(0, t_start - S)
            cut = min(lateness, int(0.2 * p["L"] * MIN))
            t_end = t_start + p["L"] * MIN - cut + uni(rng, -30, 30)
            c.marker("Performance End", t_end, on_shift_choice(crew["stage_manager"], t_end, prefer=sm))
            prev_end = t_end
            p["actual_ready"], p["actual_start"], p["actual_end"] = t_ready, t_start, t_end
            cases.append(c)
    return cases


# ----------------------------------------------------------------------------- audience
ARRIVAL_PROFILE = {  # (start hh,mm), (end hh,mm), relative weight per minute
    "D1": [((12, 0), (12, 15), 9.0), ((12, 15), (12, 45), 5.0), ((12, 45), (13, 15), 2.5), ((13, 15), (14, 0), 1.0)],
    "D2": [((12, 0), (12, 15), 10.0), ((12, 15), (12, 45), 6.0), ((12, 45), (13, 15), 2.5), ((13, 15), (14, 0), 1.0)],
}
TICKET_MIX = {"D1": [("general", 0.85), ("vip", 0.08), ("re-entry", 0.07)],
              "D2": [("general", 0.55), ("vip", 0.08), ("re-entry", 0.37)]}
TV_SERVICE = {"general": (40, 0.35, 15, 130), "vip": (34, 0.30, 12, 100), "re-entry": (9, 0.35, 4, 30)}
SCAN_FAIL = {"general": 0.07, "vip": 0.04, "re-entry": 0.03}
MANUAL_INVALID = {"general": 0.12, "vip": 0.05, "re-entry": 0.10}


def fcfs_station(items, pool, dur_key, start_key, res_key):
    """Generic FCFS multi-server station; items sorted by ready time, earliest feasible start."""
    for it in sorted(items, key=lambda x: (x["_ready"], x["_order"])):
        r, s = assign(pool, it["_ready"], it[dur_key], label=it["cid"])
        r.book(s, s + it[dur_key])
        it[start_key], it[res_key] = s, r


def gen_audience(rng, staff):
    A = staff["audience"]
    attempts = []
    order = 0
    for dk, d in DAYS:
        if dk not in AUDIENCE_DAYS:
            continue
        segs = [(at(d, *a), at(d, *b), w) for a, b, w in ARRIVAL_PROFILE[dk]]
        mass = [(e - s) * w for s, e, w in segs]
        arr = []
        for _ in range(AUDIENCE_DAYS[dk]):
            x = rng.random() * sum(mass)
            for (s, e, w), m in zip(segs, mass):
                if x <= m:
                    arr.append(s + int(rng.random() * (e - s)))
                    break
                x -= m
        arr.sort()
        for j, t in enumerate(arr, start=1):
            tt = weighted(rng, TICKET_MIX[dk])
            med, sg, lo, hi = TV_SERVICE[tt]
            attempts.append(dict(
                cid=f"ENT-{dk}-{j:04d}", day=dk, date=d, ticket=tt, arrival=t, walk=uni(rng, 6, 15),
                tv=int(round(lognorm(rng, med, sg, lo, hi))), scan_fail=rng.random() < SCAN_FAIL[tt],
                manual=int(round(lognorm(rng, 75, 0.4, 30, 300))), manual_invalid=rng.random() < MANUAL_INVALID[tt],
                wb=int(round(lognorm(rng, 7, 0.3, 3, 20))), wb_fail=rng.random() < 0.04,
                sec=int(round(lognorm(rng, 22, 0.35, 8, 90))), flag=rng.random() < 0.06,
                ads=int(round(lognorm(rng, 100, 0.4, 40, 300))), ads_reject=rng.random() < 0.12,
                g1=uni(rng, 10, 40), g2=uni(rng, 5, 15), g3=uni(rng, 10, 30), g4=uni(rng, 5, 20),
                g_out=uni(rng, 2, 8), g_rej=uni(rng, 5, 20), _order=order,
            ))
            order += 1

    # --- Ticket Verification: ONE pooled FCFS station, identical lanes, engine tie-break (min ready, lane index)
    lanes = A["lane"]
    lane_ready = [0] * len(lanes)
    opening = {dk: at(d, 12, 0) for dk, d in DAYS}
    for a in sorted(attempts, key=lambda x: (x["arrival"] + x["walk"], x["_order"])):
        la = a["arrival"] + a["walk"]
        i = min(range(len(lanes)), key=lambda k: (lane_ready[k], k))
        start = max(la, lane_ready[i], opening[a["day"]])
        a["tv_start"], a["lane"] = start, i
        lane_ready[i] = start + a["tv"]
        lanes[i].book(start, start + a["tv"])
        if not lanes[i].on_shift(start) or not lanes[i].on_shift(start + a["tv"]):
            raise RuntimeError("Lane service outside shift")
    for a in attempts:
        a["t"] = a["tv_start"] + a["tv"]
        a["status"] = "ok"

    # --- Manual Ticket Check (off-lane support desk)
    man = [a for a in attempts if a["scan_fail"]]
    for a in man:
        a["_ready"] = a["t"] + a["g1"]
    fcfs_station(man, A["support"], "manual", "man_start", "man_res")
    for a in man:
        a["t"] = a["man_start"] + a["manual"]
        if a["manual_invalid"]:
            a["status"], a["rej_by"], a["rej_issue"] = "rejected", a["man_res"], "invalid_ticket"

    # --- Wristband Check (re-entry with an existing wristband)
    wbs = [a for a in attempts if a["status"] == "ok" and a["ticket"] == "re-entry"]
    for a in wbs:
        a["_ready"] = a["t"] + a["g2"]
    fcfs_station(wbs, A["steward"], "wb", "wb_start", "wb_res")
    for a in wbs:
        a["t"] = a["wb_start"] + a["wb"]
        if a["wb_fail"]:
            a["status"], a["rej_by"], a["rej_issue"] = "rejected", a["wb_res"], "wristband_tampered"

    # --- Security Check
    secs = [a for a in attempts if a["status"] == "ok"]
    for a in secs:
        a["_ready"] = a["t"] + a["g3"]
    fcfs_station(secs, A["security"], "sec", "sec_start", "sec_res")
    for a in secs:
        a["t"] = a["sec_start"] + a["sec"]

    # --- Additional Screening
    adss = [a for a in secs if a["flag"]]
    for a in adss:
        a["_ready"] = a["t"] + a["g4"]
    fcfs_station(adss, A["supervisor"], "ads", "ads_start", "ads_res")
    for a in adss:
        a["t"] = a["ads_start"] + a["ads"]
        if a["ads_reject"]:
            a["status"], a["rej_by"], a["rej_issue"] = "rejected", a["ads_res"], "prohibited_item"

    cases = []
    for a in sorted(attempts, key=lambda x: x["_order"]):
        c = Case("audience", a["cid"], {"ticket_type": a["ticket"]})
        c.marker("Join Entry Queue", a["arrival"], None, lifecycle="")
        lane = lanes[a["lane"]]
        c.task("Ticket Verification", a["tv_start"], a["tv_start"] + a["tv"], lane, gate_id=lane.area)
        if a["scan_fail"]:
            c.task("Manual Ticket Check", a["man_start"], a["man_start"] + a["manual"], a["man_res"],
                   issue_type="scan_failure")
        if "wb_start" in a:
            c.task("Wristband Check", a["wb_start"], a["wb_start"] + a["wb"], a["wb_res"])
        if "sec_start" in a:
            c.task("Security Check", a["sec_start"], a["sec_start"] + a["sec"], a["sec_res"])
        if "ads_start" in a:
            c.task("Additional Screening", a["ads_start"], a["ads_start"] + a["ads"], a["ads_res"], issue_type="bag_flag")
        if a["status"] == "rejected":
            c.marker("Entry Rejected", a["t"] + a["g_rej"], a["rej_by"], lifecycle="", issue_type=a["rej_issue"])
        else:
            c.marker("Entry Complete", a["t"] + a["g_out"], None, lifecycle="")
        cases.append(c)
    return cases, attempts


# ----------------------------------------------------------------------------- serialisers
PROCESS_RANK = {"stage": 0, "audience": 1, "equipment": 2}


def finalize(cases):
    rows = [ev for c in cases for ev in c.events]
    for idx, ev in enumerate(rows):
        ev["_seq"] = idx
    rows.sort(key=lambda e: (e["_t"], PROCESS_RANK[e["process_type"]], e["case_id"], e["_seq"]))
    for i, ev in enumerate(rows, start=1):
        ev["event_id"] = f"EV{i:06d}"
    return rows


def write_csv(path, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


def xattr(tag, key, value, indent):
    return f'{indent}<{tag} key="{escape(key, {chr(34): "&quot;"})}" value="{escape(value, {chr(34): "&quot;"})}"/>\n'


def write_xes(path, rows, log_name, seed):
    traces = {}
    for r in rows:
        traces.setdefault((PROCESS_RANK[r["process_type"]], r["case_id"]), []).append(r)
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n',
           '<log xes.version="1.0" xes.features="nested-attributes" xmlns="http://www.xes-standard.org/">\n',
           '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>\n',
           '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>\n',
           '  <extension name="Organizational" prefix="org" uri="http://www.xes-standard.org/org.xesext"/>\n',
           '  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>\n',
           '  <extension name="Identity" prefix="identity" uri="http://www.xes-standard.org/identity.xesext"/>\n',
           '  <global scope="trace">\n    <string key="concept:name" value="__INVALID__"/>\n  </global>\n',
           '  <global scope="event">\n    <string key="concept:name" value="__INVALID__"/>\n'
           '    <date key="time:timestamp" value="1970-01-01T00:00:00+00:00"/>\n  </global>\n',
           '  <classifier name="Activity" keys="concept:name"/>\n',
           '  <classifier name="Activity Lifecycle" keys="concept:name lifecycle:transition"/>\n']
    out.append(xattr("string", "concept:name", log_name, "  "))
    out.append(xattr("string", "source_type", "synthetic", "  "))
    out.append(xattr("string", "generator.version", VERSION, "  "))
    out.append(xattr("string", "generator.seed", str(seed), "  "))
    out.append(xattr("string", "timezone", "Asia/Seoul", "  "))
    for (_, cid), evs in sorted(traces.items()):
        proc = evs[0]["process_type"]
        out.append("  <trace>\n")
        out.append(xattr("string", "concept:name", cid, "    "))
        for f in TRACE_FIELDS[proc]:
            vals = {e[f] for e in evs}
            assert len(vals) == 1, (cid, f, vals)
            v = vals.pop()
            if v != "":
                out.append(xattr("string", f, v, "    "))
        for e in evs:
            out.append("    <event>\n")
            out.append(xattr("string", "concept:name", e["activity"], "      "))
            out.append(xattr("date", "time:timestamp", e["timestamp"], "      "))
            if e["lifecycle"]:
                out.append(xattr("string", "lifecycle:transition", e["lifecycle"], "      "))
            out.append(xattr("string", "concept:instance", e["activity_instance_id"], "      "))
            out.append(xattr("id", "identity:id", e["event_id"], "      "))
            if e["resource"]:
                out.append(xattr("string", "org:resource", e["resource"], "      "))
            if e["resource_role"]:
                out.append(xattr("string", "org:role", e["resource_role"], "      "))
            for f in EVENT_EXTRA_FIELDS:
                if e[f]:
                    out.append(xattr("string", f, e[f], "      "))
            out.append("    </event>\n")
        out.append("  </trace>\n")
    out.append("</log>\n")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("".join(out))


def write_shifts(path, staff_rows):
    fields = ["resource_id", "resource", "resource_role", "process_type", "festival_id", "area",
              "shift_date", "shift_start", "shift_end", "assignable_activities"]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in staff_rows:
            for s, e in r.shifts:
                w.writerow(dict(resource_id=r.rid, resource=r.name, resource_role=r.role, process_type=r.process,
                                festival_id=FESTIVAL_ID, area=r.area,
                                shift_date=datetime.fromtimestamp(s, TZ).strftime("%Y-%m-%d"),
                                shift_start=iso(s), shift_end=iso(e), assignable_activities=";".join(r.activities)))


SOURCE_REFERENCES = [
    "Fuji Rock Festival '25 visitor information (wristband exchange, re-entry rule) — https://25.en.fujirockfestival.com/news/0718e/index.htm",
    "Fuji Rock Festival '22 facility guide (entrance gate: bag check, wristband check) — https://en.fujirockfestival.com/2022/?p=27",
    "FUJI ROCK FESTIVAL'25 e+ ticket info (3-day holders exit 05:00, re-entry from 09:00) — https://ib.eplus.jp/fujirock2025",
    "Kyunghyang Shinmun 2026-07-30, 2026 Incheon Pentaport: entry routes split into two to reduce waiting — https://www.khan.co.kr/article/202607300957001",
    "Trip.com blog: 2026 Pentaport entry notes (mobile ticket + ID, no proxy wristband pickup) — https://kr.trip.com/blog/incheon-festival/",
    "Financial News 2025-09-26, 2025 Busan International Rock Festival (stages, daily schedule) — https://www.fnnews.com/news/202509261925182963",
    "ProSoundWeb: festival changeovers often allow only a line check — https://www.prosoundweb.com/?p=36647",
    "FestivalPro: managing rapid artist changeovers (artist advance, key staff) — https://festivalpro.com/festival-management/2012/news/2022/7/28/Managing-Rapid-Artist-Changeovers-for-Music-Festival-Stages.html",
    "Shambala Festival 2025 artist info (check-in 3 h before show, ~30 min changeovers) — https://www.shambalafestival.org/wp-content/uploads/SH25_Artist-Info-2025.pdf",
    "Ministry of the Interior and Safety (KR) crowd-safety guideline 2024 — https://cse.snu.ac.kr/api/v1/file/1730252035876_%5B%EB%B6%99%EC%9E%843%5D%20240905%20%EB%8B%A4%EC%A4%91%EC%9A%B4%EC%A7%91%EC%9D%B8%ED%8C%8C%EC%82%AC%EA%B3%A0%20%EC%95%88%EC%A0%84%EA%B4%80%EB%A6%AC%20%EA%B0%80%EC%9D%B4%EB%93%9C%EB%9D%BC%EC%9D%B8(%EB%B0%B0%ED%8F%AC%EC%9A%A9).pdf",
]

ASSUMPTIONS = [
    "Synthetic dataset. Not an operating record of Pentaport, Busan International Rock Festival, Fuji Rock or any real event.",
    "Fictional festival DFO26: 3 days (2026-08-07..09), stages MAIN/RIVER/CLUB, 99 performances; each stage case runs from this performance's Stage Handover start to Performance End.",
    "Changeovers include a Line Check only for band acts; DJ/playback sets skip it, and band acts skip it with p=0.6 when Stage Setup ends inside the compressed-changeover threshold. Headliner full soundchecks happen earlier in the day and are outside the stage case boundary.",
    "Stage Setup cannot complete before all linked equipment requests are Equipment Ready plus 2-5 min install time.",
    "Technical Check failure probability = 0.08 base + 0.10 complex setup + 0.12 skipped Line Check + 0.08 linked equipment substituted/reworked; Technical Recheck fails again with p=0.20 (max 3 loops).",
    "Stage crews work two overlapping shifts (10:00-17:30, 16:00-24:00); the first handover taken by the incoming Stage Manager includes a 5-15 min shift-change briefing.",
    "Audience = complete record of one secondary entrance (North Gate) during 12:00-14:00 on D1 (280 attempts) and D2 (320 attempts); not total festival attendance.",
    "Ticket Verification is ONE pooled FCFS service station: a single serpentine queue feeds 3 identical staffed lanes (gate_id NG-L1..L3), one qualified Lane Checker per lane, lanes open 12:00. baseline_gate_count = 3 is the staffed lane count, not the number of distinct gate_id values.",
    "Join Entry Queue is recorded when the attendee enters the serpentine; reaching a lane takes 6-15 s walking time, so the observed queue wait includes walking time that the engine's pooled model does not represent.",
    "Ticket Verification = first entry: mobile-ticket QR scan + photo-ID match + wristband fitting by the lane checker (lognormal median general 40 s, VIP 34 s); re-entry / multi-day holders: wristband scan only (median 9 s). Scan failure (general 7%, VIP 4%, re-entry 3%) is resolved off-lane at the Ticket Support desk (Manual Ticket Check) and does not block the lane.",
    "Downstream stations (Ticket Support x2, Wristband Steward x1, Security Screener x4, Security Supervisor x1) are separate FCFS pools; they are NOT part of the modeled service station.",
    "Equipment requests are day-of backline dispatch requests (house backline pool with limited assets per type); 15% are late requests 35-90 min before required_ready_at; substitutes come from an alternative/rental pool (ALT-*).",
    "required_ready_at = planned changeover start of the linked performance (scheduled_start - planned changeover).",
    "Resource identities are explicit resource_id values; no person works in more than one process. Utilization requires resource_shifts.csv, which the current engine does not ingest.",
    "All durations, probabilities and arrival profiles are modeling assumptions fixed before generation; results were not tuned by changing the seed.",
]


def write_manifest(path, seed):
    m = {
        "dataset_id": "demo-festival-ops-2026-v1",
        "name": DATASET_NAME,
        "source_type": "synthetic",
        "csv": "demo_festival_operations_2026.csv",
        "timezone": "Asia/Seoul",
        "baseline_gate_count": BASELINE_LANES,
        "service_activity": "Ticket Verification",
        "missing_resource_values": ["", "NONE", "NULL", "0;n/a"],
        "bpmn": {"stage": "stage_as_is.bpmn", "audience": "audience_as_is.bpmn", "equipment": "equipment_as_is.bpmn"},
        "bpmn_to_be": {"audience": "audience_to_be.bpmn"},
        "festival_config": {
            "technical_check_repeat_activity": "Technical Check",
            "stage_handover_point_fallback": False,
            "equipment_deadline": "required_ready_at",
        },
        "generator": {"version": VERSION, "seed": seed},
        "source_references": SOURCE_REFERENCES,
        "assumptions": ASSUMPTIONS,
    }
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ----------------------------------------------------------------------------- BPMN builder
TASK_W, TASK_H, GW, EV = 130, 80, 50, 36
COL_W = 165
POOL_LABEL = 30


class BpmnModel:
    """Declarative horizontal-swimlane BPMN with deterministic DI layout."""

    def __init__(self, key, name, pool_name, lanes, lane_h=None):
        self.key, self.name, self.pool_name = key, name, pool_name
        self.lanes = lanes  # list of (lane_id, label, height)
        self.nodes = {}    # id -> dict(type, name, lane, col, dy)
        self.order = []
        self.flows = []    # (id, src, tgt, name, waypoints or None)
        self.dobjs = []    # (id, name, lane, col, dx, dy, task_id, direction)
        self.notes = []    # (id, text, lane, col, dx, dy, w, h, attach_id)
        self.ext_pools = []  # (id, name, position 'top'|'bottom')
        self.msgs = []     # (id, name, src, tgt)

    def node(self, nid, ntype, name, lane, col, dy=0):
        self.nodes[nid] = dict(type=ntype, name=name, lane=lane, col=col, dy=dy)
        self.order.append(nid)

    def flow(self, fid, src, tgt, name="", wp=None):
        self.flows.append((fid, src, tgt, name, wp))

    # ---- geometry
    def layout(self):
        self.x0 = 160
        self.y_top = 40
        y = self.y_top
        self.ext_y = {}
        tops = [p for p in self.ext_pools if p[2] == "top"]
        for p in tops:
            self.ext_y[p[0]] = y
            y += 60 + 50
        self.pool_y = y
        self.lane_y = {}
        for lid, _, h in self.lanes:
            self.lane_y[lid] = (y, h)
            y += h
        self.pool_h = y - self.pool_y
        maxcol = max(n["col"] for n in self.nodes.values())
        self.pool_w = POOL_LABEL + 30 + 70 + int((maxcol + 0.5) * COL_W) + 60
        y += 50
        for p in self.ext_pools:
            if p[2] == "bottom":
                self.ext_y[p[0]] = y
                y += 60 + 50
        self.bounds = {}
        for nid, n in self.nodes.items():
            ly, lh = self.lane_y[n["lane"]]
            cx = self.x0 + POOL_LABEL + 30 + 70 + n["col"] * COL_W
            cy = ly + lh / 2 + n["dy"]
            w, h = {"task": (TASK_W, TASK_H), "gateway": (GW, GW), "event": (EV, EV)}[self.kind(n["type"])]
            self.bounds[nid] = (cx - w / 2, cy - h / 2, w, h)

    @staticmethod
    def kind(t):
        if t.endswith("Task") or t == "task":
            return "task"
        if t.endswith("Gateway"):
            return "gateway"
        return "event"

    def c(self, nid):
        x, y, w, h = self.bounds[nid]
        return x + w / 2, y + h / 2

    def edge(self, src, tgt):
        sx, sy, sw, sh = self.bounds[src]
        tx, ty, tw, th = self.bounds[tgt]
        scx, scy, tcx, tcy = sx + sw / 2, sy + sh / 2, tx + tw / 2, ty + th / 2
        s_gw = self.kind(self.nodes[src]["type"]) == "gateway"
        if tcx > scx:
            if abs(scy - tcy) < 1:
                return [(sx + sw, scy), (tx, tcy)]
            if s_gw:
                return [(scx, sy + sh if tcy > scy else sy), (scx, tcy), (tx, tcy)]
            mx = (sx + sw + tx) / 2
            return [(sx + sw, scy), (mx, scy), (mx, tcy), (tx, tcy)]
        # backward loop: route below both nodes
        yl = max(sy + sh, ty + th) + 22
        return [(scx, sy + sh), (scx, yl), (tcx, yl), (tcx, ty + th)]

    def to_xml(self):
        self.layout()
        K = self.key
        pid = f"Process_{K}"
        X = []
        a = X.append
        a('<?xml version="1.0" encoding="UTF-8"?>\n')
        a('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
          'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
          'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
          f'id="Definitions_{K}" targetNamespace="https://processpilot.example/festival/{K}" '
          f'exporter="generate_festival_logs.py" exporterVersion="{VERSION}">\n')
        a(f'  <bpmn:collaboration id="Collaboration_{K}">\n')
        a(f'    <bpmn:participant id="Participant_{K}" name="{escape(self.pool_name)}" processRef="{pid}"/>\n')
        for eid, ename, _ in self.ext_pools:
            a(f'    <bpmn:participant id="{eid}" name="{escape(ename)}"/>\n')
        for mid, mname, ms, mt in self.msgs:
            a(f'    <bpmn:messageFlow id="{mid}" name="{escape(mname)}" sourceRef="{ms}" targetRef="{mt}"/>\n')
        a('  </bpmn:collaboration>\n')
        a(f'  <bpmn:process id="{pid}" name="{escape(self.name)}" isExecutable="false">\n')
        a(f'    <bpmn:laneSet id="LaneSet_{K}">\n')
        for lid, label, _ in self.lanes:
            a(f'      <bpmn:lane id="{lid}" name="{escape(label)}">\n')
            for nid in self.order:
                if self.nodes[nid]["lane"] == lid:
                    a(f'        <bpmn:flowNodeRef>{nid}</bpmn:flowNodeRef>\n')
            a('      </bpmn:lane>\n')
        a('    </bpmn:laneSet>\n')
        inc = {n: [] for n in self.nodes}
        out = {n: [] for n in self.nodes}
        for fid, s, t, _, _ in self.flows:
            out[s].append(fid)
            inc[t].append(fid)
        dobj_in = {}
        dobj_out = {}
        for did, _, _, _, _, _, tid, direction in self.dobjs:
            (dobj_in if direction == "in" else dobj_out).setdefault(tid, []).append(did)
        for nid in self.order:
            n = self.nodes[nid]
            a(f'    <bpmn:{n["type"]} id="{nid}" name="{escape(n["name"])}">\n')
            for f in inc[nid]:
                a(f'      <bpmn:incoming>{f}</bpmn:incoming>\n')
            for f in out[nid]:
                a(f'      <bpmn:outgoing>{f}</bpmn:outgoing>\n')
            if nid in dobj_in:
                a(f'      <bpmn:property id="Property_{nid}" name="__targetRef_placeholder"/>\n')
                for did in dobj_in[nid]:
                    a(f'      <bpmn:dataInputAssociation id="DIA_{did}_{nid}">\n'
                      f'        <bpmn:sourceRef>{did}</bpmn:sourceRef>\n'
                      f'        <bpmn:targetRef>Property_{nid}</bpmn:targetRef>\n'
                      f'      </bpmn:dataInputAssociation>\n')
            for did in dobj_out.get(nid, []):
                a(f'      <bpmn:dataOutputAssociation id="DOA_{nid}_{did}">\n'
                  f'        <bpmn:targetRef>{did}</bpmn:targetRef>\n'
                  f'      </bpmn:dataOutputAssociation>\n')
            a(f'    </bpmn:{n["type"]}>\n')
        for fid, s, t, name, _ in self.flows:
            nm = f' name="{escape(name)}"' if name else ""
            a(f'    <bpmn:sequenceFlow id="{fid}"{nm} sourceRef="{s}" targetRef="{t}"/>\n')
        for did, name, *_ in self.dobjs:
            a(f'    <bpmn:dataObject id="DataObject_{did}"/>\n')
            a(f'    <bpmn:dataObjectReference id="{did}" name="{escape(name)}" dataObjectRef="DataObject_{did}"/>\n')
        for tid, text, *_rest in self.notes:
            a(f'    <bpmn:textAnnotation id="{tid}">\n      <bpmn:text>{escape(text)}</bpmn:text>\n    </bpmn:textAnnotation>\n')
            attach = _rest[-1]
            a(f'    <bpmn:association id="Association_{tid}" associationDirection="None" sourceRef="{attach}" targetRef="{tid}"/>\n')
        a('  </bpmn:process>\n')
        # ---- DI
        a(f'  <bpmndi:BPMNDiagram id="BPMNDiagram_{K}">\n')
        a(f'    <bpmndi:BPMNPlane id="BPMNPlane_{K}" bpmnElement="Collaboration_{K}">\n')

        def bounds(x, y, w, h):
            return f'<dc:Bounds x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}"/>'

        a(f'      <bpmndi:BPMNShape id="Participant_{K}_di" bpmnElement="Participant_{K}" isHorizontal="true">\n'
          f'        {bounds(self.x0, self.pool_y, self.pool_w, self.pool_h)}\n      </bpmndi:BPMNShape>\n')
        for lid, _, h in self.lanes:
            ly, lh = self.lane_y[lid]
            a(f'      <bpmndi:BPMNShape id="{lid}_di" bpmnElement="{lid}" isHorizontal="true">\n'
              f'        {bounds(self.x0 + POOL_LABEL, ly, self.pool_w - POOL_LABEL, lh)}\n      </bpmndi:BPMNShape>\n')
        for eid, _, _ in self.ext_pools:
            a(f'      <bpmndi:BPMNShape id="{eid}_di" bpmnElement="{eid}" isHorizontal="true">\n'
              f'        {bounds(self.x0, self.ext_y[eid], self.pool_w, 60)}\n      </bpmndi:BPMNShape>\n')
        for nid in self.order:
            n = self.nodes[nid]
            x, y, w, h = self.bounds[nid]
            kind = self.kind(n["type"])
            extra = ' isMarkerVisible="true"' if n["type"] == "exclusiveGateway" else ""
            a(f'      <bpmndi:BPMNShape id="{nid}_di" bpmnElement="{nid}"{extra}>\n        {bounds(x, y, w, h)}\n')
            if kind == "gateway" and n["name"]:
                a(f'        <bpmndi:BPMNLabel>{bounds(x - 45, y - 42, 140, 36)}</bpmndi:BPMNLabel>\n')
            elif kind == "event":
                a(f'        <bpmndi:BPMNLabel>{bounds(x - 42, y + h + 4, 120, 40)}</bpmndi:BPMNLabel>\n')
            a('      </bpmndi:BPMNShape>\n')
        for did, _, lane, col, dx, dy, tid, _d in self.dobjs:
            ly, lh = self.lane_y[lane]
            cx = self.x0 + POOL_LABEL + 30 + 70 + col * COL_W + dx
            cy = ly + lh / 2 + dy
            self.bounds[did] = (cx - 18, cy - 25, 36, 50)
            a(f'      <bpmndi:BPMNShape id="{did}_di" bpmnElement="{did}">\n        {bounds(cx - 18, cy - 25, 36, 50)}\n'
              f'        <bpmndi:BPMNLabel>{bounds(cx - 60, cy + 28, 120, 28)}</bpmndi:BPMNLabel>\n      </bpmndi:BPMNShape>\n')
        for tid, text, lane, col, dx, dy, w, h, attach in self.notes:
            ly, lh = self.lane_y[lane]
            cx = self.x0 + POOL_LABEL + 30 + 70 + col * COL_W + dx
            cy = ly + lh / 2 + dy
            self.bounds[tid] = (cx - w / 2, cy - h / 2, w, h)
            a(f'      <bpmndi:BPMNShape id="{tid}_di" bpmnElement="{tid}">\n        {bounds(cx - w / 2, cy - h / 2, w, h)}\n'
              '      </bpmndi:BPMNShape>\n')

        def wps(points):
            return "".join(f'\n        <di:waypoint x="{x:.0f}" y="{y:.0f}"/>' for x, y in points)

        for fid, s, t, name, wp in self.flows:
            pts = wp(self) if callable(wp) else self.edge(s, t)
            a(f'      <bpmndi:BPMNEdge id="{fid}_di" bpmnElement="{fid}">{wps(pts)}\n')
            if name:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                a(f'        <bpmndi:BPMNLabel>{bounds((x1 + x2) / 2 + 4, (y1 + y2) / 2 - 18, 40, 14)}</bpmndi:BPMNLabel>\n')
            a('      </bpmndi:BPMNEdge>\n')
        for mid, _, ms, mt in self.msgs:
            if ms in self.nodes:  # node -> external pool
                x, y, w, h = self.bounds[ms]
                ey = self.ext_y[mt]
                pts = [(x + w / 2, y if ey < y else y + h), (x + w / 2, ey + 60 if ey < y else ey)]
            else:
                x, y, w, h = self.bounds[mt]
                ey = self.ext_y[ms]
                pts = [(x + w / 2, ey + 60 if ey < y else ey), (x + w / 2, y if ey < y else y + h)]
            (x1, y1), (x2, y2) = pts
            a(f'      <bpmndi:BPMNEdge id="{mid}_di" bpmnElement="{mid}">{wps(pts)}\n'
              f'        <bpmndi:BPMNLabel>{bounds(x1 + 6, min(y1, y2) + 8, 150, 28)}</bpmndi:BPMNLabel>\n'
              '      </bpmndi:BPMNEdge>\n')
        for did, _, _, _, _, _, tid, direction in self.dobjs:
            dx, dy, dw, dh = self.bounds[did]
            tx, ty, tw, th = self.bounds[tid]
            dc = (dx + dw / 2, dy + dh / 2)
            tc = (tx + tw / 2, ty + th / 2)
            p_d = (dx + dw if tc[0] > dc[0] else dx, dc[1])
            p_t = (tx if tc[0] > dc[0] else tx + tw, min(max(dc[1], ty + 8), ty + th - 8))
            if abs(tc[0] - dc[0]) < tw / 2:  # vertically aligned
                p_d = (dc[0], dy + dh if tc[1] > dc[1] else dy)
                p_t = (dc[0], ty if tc[1] > dc[1] else ty + th)
            eid = f"DIA_{did}_{tid}" if direction == "in" else f"DOA_{tid}_{did}"
            pts = [p_d, p_t] if direction == "in" else [p_t, p_d]
            a(f'      <bpmndi:BPMNEdge id="{eid}_di" bpmnElement="{eid}">{wps(pts)}\n      </bpmndi:BPMNEdge>\n')
        for tid, *_r in self.notes:
            attach = _r[-1]
            ax, ay, aw, ah = self.bounds[attach]
            nx, ny, nw, nh = self.bounds[tid]
            ac = (ax + aw / 2, ay + ah / 2)
            nc = (nx + nw / 2, ny + nh / 2)
            if abs(nc[1] - ac[1]) < ah / 2 + nh / 2:  # same band: from attach top/bottom to the note's near side
                p1 = (ac[0], ay if nc[1] <= ac[1] else ay + ah)
                p2 = (nx if nc[0] > ac[0] else nx + nw, nc[1])
            else:
                p1 = (ac[0], ay if nc[1] < ac[1] else ay + ah)
                p2 = (min(max(ac[0], nx + 10), nx + nw - 10), ny + nh if nc[1] < ac[1] else ny)
            a(f'      <bpmndi:BPMNEdge id="Association_{tid}_di" bpmnElement="Association_{tid}">{wps([p1, p2])}\n'
              '      </bpmndi:BPMNEdge>\n')
        a('    </bpmndi:BPMNPlane>\n  </bpmndi:BPMNDiagram>\n</bpmn:definitions>\n')
        return "".join(X)


def above(m, src, tgt, track=-48):
    """Bypass route along an upper track of the source lane (gateway top -> track -> target top)."""
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        ly, lh = model.lane_y[model.nodes[src]["lane"]]
        yt = ly + 18
        return [(sx + sw / 2, sy), (sx + sw / 2, yt), (tx + tw / 2, yt), (tx + tw / 2, ty)]
    return f


def below(m, src, tgt):
    """Bypass route along a lower track of the source lane (gateway bottom -> track -> target bottom)."""
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        ly, lh = model.lane_y[model.nodes[src]["lane"]]
        yt = ly + lh - 16
        return [(sx + sw / 2, sy + sh), (sx + sw / 2, yt), (tx + tw / 2, yt), (tx + tw / 2, ty + th)]
    return f


def via_bottom_of_target(src, tgt):
    """Source right -> target x -> up/down into target (avoid joining an occupied side)."""
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        scy = sy + sh / 2
        tcx, tcy = tx + tw / 2, ty + th / 2
        return [(sx + sw, scy), (tcx, scy), (tcx, ty + th if scy > tcy else ty)]
    return f


def right_then_down(src, tgt, frac=0.45):
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        scy, tcy = sy + sh / 2, ty + th / 2
        mx = sx + sw + (tx - sx - sw) * frac
        return [(sx + sw, scy), (mx, scy), (mx, tcy), (tx, tcy)]
    return f


def straight_vertical(src, tgt):
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        x = sx + sw / 2
        return [(x, sy + sh if ty > sy else sy), (x, ty if ty > sy else ty + th)]
    return f


def loop_below_lane(src, tgt):
    def f(model):
        sx, sy, sw, sh = model.bounds[src]
        tx, ty, tw, th = model.bounds[tgt]
        yl = max(sy + sh, ty + th) + 24
        return [(sx + sw / 2, sy + sh), (sx + sw / 2, yl), (tx + tw / 2, yl), (tx + tw / 2, ty + th)]
    return f


def stage_model():
    m = BpmnModel("StageAsIs", "Stage & Technical Operations (As-is)", "Stage & Technical Operations — per performance (As-is)", [
        ("Lane_StageManager", "Stage Manager", 150), ("Lane_Backline", "Backline Technician", 140),
        ("Lane_Monitor", "Monitor Engineer", 150), ("Lane_FOH", "FOH Engineer", 150),
        ("Lane_IssueOwner", "Issue Owner (by issue type)", 160)])
    m.ext_pools = [("Participant_Artist", "Artist / Tour Crew (external)", "top"),
                   ("Participant_Equipment", "Equipment & Technical Readiness (see equipment_as_is.bpmn)", "bottom")]
    N = m.node
    N("Start_Changeover", "startEvent", "Changeover slot begins", "Lane_StageManager", 0)
    N("Task_StageHandover", "userTask", "Stage Handover", "Lane_StageManager", 1)
    N("Task_StageSetup", "manualTask", "Stage Setup", "Lane_Backline", 2)
    N("Gw_LineCheckNeeded", "exclusiveGateway", "Line check performed?", "Lane_Monitor", 3)
    N("Task_LineCheck", "manualTask", "Line Check", "Lane_Monitor", 4)
    N("Gw_LineCheckMerge", "exclusiveGateway", "", "Lane_Monitor", 5)
    N("Task_TechnicalCheck", "userTask", "Technical Check", "Lane_FOH", 6)
    N("Gw_TechCheckPassed", "exclusiveGateway", "Technical check passed?", "Lane_FOH", 7)
    N("Gw_TroubleshootMerge", "exclusiveGateway", "", "Lane_IssueOwner", 8)
    N("Task_TechnicalTroubleshooting", "manualTask", "Technical Troubleshooting", "Lane_IssueOwner", 9)
    N("Task_TechnicalRecheck", "userTask", "Technical Recheck", "Lane_FOH", 10)
    N("Gw_RecheckPassed", "exclusiveGateway", "Recheck passed?", "Lane_FOH", 11)
    N("Gw_ReadyMerge", "exclusiveGateway", "", "Lane_StageManager", 12)
    N("Task_StageReady", "userTask", "Stage Ready", "Lane_StageManager", 13)
    N("Task_PerformanceStart", "sendTask", "Performance Start", "Lane_StageManager", 14)
    N("Task_PerformanceEnd", "userTask", "Performance End", "Lane_StageManager", 15)
    N("End_PerformanceDone", "endEvent", "Performance completed", "Lane_StageManager", 16)
    F = m.flow
    F("Flow_S01", "Start_Changeover", "Task_StageHandover")
    F("Flow_S02", "Task_StageHandover", "Task_StageSetup")
    F("Flow_S03", "Task_StageSetup", "Gw_LineCheckNeeded")
    F("Flow_S04", "Gw_LineCheckNeeded", "Task_LineCheck", "yes")
    F("Flow_S05", "Gw_LineCheckNeeded", "Gw_LineCheckMerge", "no", below(m, "Gw_LineCheckNeeded", "Gw_LineCheckMerge"))
    F("Flow_S06", "Task_LineCheck", "Gw_LineCheckMerge")
    F("Flow_S07", "Gw_LineCheckMerge", "Task_TechnicalCheck")
    F("Flow_S08", "Task_TechnicalCheck", "Gw_TechCheckPassed")
    F("Flow_S09", "Gw_TechCheckPassed", "Gw_ReadyMerge", "yes")
    F("Flow_S10", "Gw_TechCheckPassed", "Gw_TroubleshootMerge", "no")
    F("Flow_S11", "Gw_TroubleshootMerge", "Task_TechnicalTroubleshooting")
    F("Flow_S12", "Task_TechnicalTroubleshooting", "Task_TechnicalRecheck")
    F("Flow_S13", "Task_TechnicalRecheck", "Gw_RecheckPassed")
    F("Flow_S14", "Gw_RecheckPassed", "Gw_ReadyMerge", "yes")
    F("Flow_S15", "Gw_RecheckPassed", "Gw_TroubleshootMerge", "no", loop_below_lane("Gw_RecheckPassed", "Gw_TroubleshootMerge"))
    F("Flow_S16", "Gw_ReadyMerge", "Task_StageReady")
    F("Flow_S17", "Task_StageReady", "Task_PerformanceStart")
    F("Flow_S18", "Task_PerformanceStart", "Task_PerformanceEnd")
    F("Flow_S19", "Task_PerformanceEnd", "End_PerformanceDone")
    m.msgs = [("MsgFlow_ArtistArrives", "Artist crew & gear at stage", "Participant_Artist", "Task_StageHandover"),
              ("MsgFlow_WalkOn", "Walk-on cue", "Task_PerformanceStart", "Participant_Artist"),
              ("MsgFlow_EquipmentReady", "Equipment Ready notice (per linked request)", "Participant_Equipment", "Task_StageSetup")]
    m.dobjs = [("DataObject_RunOfShow", "Run-of-show (scheduled_start)", "Lane_StageManager", 2.4, 0, -8, "Task_StageHandover", "in"),
               ("DataObject_StagePlot", "Stage plot / technical rider", "Lane_Backline", 1, 20, 0, "Task_StageSetup", "in")]
    m.notes = [("Note_LineCheck", "Line Check only for band acts; skipped for DJ/playback sets and, with p=0.6, when setup ends inside the compressed-changeover threshold. Headliner full soundcheck happens earlier in the day (outside this case).",
                "Lane_Monitor", 8.6, 0, -8, 300, 84, "Gw_LineCheckMerge"),
               ("Note_IssueOwner", "Issue owner by issue_type: monitor_mix / wireless_rf -> Monitor Engineer; signal_path -> Backline Tech; lighting_cue -> Lighting Operator. Recheck loop max 3.",
                "Lane_IssueOwner", 12, 40, 0, 300, 70, "Task_TechnicalTroubleshooting"),
               ("Note_Setup", "Setup cannot complete before all linked equipment is Equipment Ready (+2-5 min install).",
                "Lane_Backline", 4, 60, 0, 260, 56, "Task_StageSetup")]
    return m


def audience_as_is_model():
    m = BpmnModel("AudienceAsIs", "Audience Entry & Crowd Management (As-is)", "Audience Entry — North Gate (As-is)", [
        ("Lane_Queue", "Queue & Entry Record", 150), ("Lane_TicketLane", "Ticket Lanes (3 pooled)", 150),
        ("Lane_Support", "Ticket Support Desk", 150), ("Lane_Steward", "Wristband Steward", 150),
        ("Lane_Security", "Security Screener", 150), ("Lane_Supervisor", "Security Supervisor", 150),
        ("Lane_Rejection", "Rejection Record", 150)])
    m.ext_pools = [("Participant_Attendee", "Attendee (external)", "top")]
    N = m.node
    N("Start_Arrive", "startEvent", "Attendee reaches entrance", "Lane_Queue", 0)
    N("Task_JoinEntryQueue", "receiveTask", "Join Entry Queue", "Lane_Queue", 1)
    N("Task_TicketVerification", "userTask", "Ticket Verification", "Lane_TicketLane", 2)
    N("Gw_ScanOK", "exclusiveGateway", "Credential scanned?", "Lane_TicketLane", 3)
    N("Task_ManualTicketCheck", "userTask", "Manual Ticket Check", "Lane_Support", 4)
    N("Gw_TicketValid", "exclusiveGateway", "Ticket valid?", "Lane_Support", 5)
    N("Gw_TicketMerge", "exclusiveGateway", "", "Lane_TicketLane", 6)
    N("Gw_ReEntry", "exclusiveGateway", "Re-entry with wristband?", "Lane_Steward", 7)
    N("Task_WristbandCheck", "manualTask", "Wristband Check", "Lane_Steward", 8)
    N("Gw_WristbandOK", "exclusiveGateway", "Wristband intact?", "Lane_Steward", 9)
    N("Gw_WristbandMerge", "exclusiveGateway", "", "Lane_Steward", 10)
    N("Task_SecurityCheck", "manualTask", "Security Check", "Lane_Security", 11)
    N("Gw_BagFlagged", "exclusiveGateway", "Bag flagged?", "Lane_Security", 12)
    N("Task_AdditionalScreening", "manualTask", "Additional Screening", "Lane_Supervisor", 13)
    N("Gw_Cleared", "exclusiveGateway", "Cleared?", "Lane_Supervisor", 14)
    N("Gw_SecurityMerge", "exclusiveGateway", "", "Lane_Security", 15)
    N("Task_EntryComplete", "serviceTask", "Entry Complete", "Lane_Queue", 16)
    N("End_Admitted", "endEvent", "Admitted", "Lane_Queue", 17)
    N("Gw_Reject1", "exclusiveGateway", "", "Lane_Rejection", 5)
    N("Gw_Reject2", "exclusiveGateway", "", "Lane_Rejection", 9)
    N("Gw_Reject3", "exclusiveGateway", "", "Lane_Rejection", 14)
    N("Task_EntryRejected", "userTask", "Entry Rejected", "Lane_Rejection", 16)
    N("End_Refused", "endEvent", "Entry refused", "Lane_Rejection", 17)
    F = m.flow
    F("Flow_A01", "Start_Arrive", "Task_JoinEntryQueue")
    F("Flow_A02", "Task_JoinEntryQueue", "Task_TicketVerification")
    F("Flow_A03", "Task_TicketVerification", "Gw_ScanOK")
    F("Flow_A04", "Gw_ScanOK", "Gw_TicketMerge", "yes")
    F("Flow_A05", "Gw_ScanOK", "Task_ManualTicketCheck", "no")
    F("Flow_A06", "Task_ManualTicketCheck", "Gw_TicketValid")
    F("Flow_A07", "Gw_TicketValid", "Gw_TicketMerge", "yes", via_bottom_of_target("Gw_TicketValid", "Gw_TicketMerge"))
    F("Flow_A08", "Gw_TicketValid", "Gw_Reject1", "no", straight_vertical("Gw_TicketValid", "Gw_Reject1"))
    F("Flow_A09", "Gw_TicketMerge", "Gw_ReEntry", "", right_then_down("Gw_TicketMerge", "Gw_ReEntry"))
    F("Flow_A10", "Gw_ReEntry", "Task_WristbandCheck", "yes")
    F("Flow_A11", "Gw_ReEntry", "Gw_WristbandMerge", "no", below(m, "Gw_ReEntry", "Gw_WristbandMerge"))
    F("Flow_A12", "Task_WristbandCheck", "Gw_WristbandOK")
    F("Flow_A13", "Gw_WristbandOK", "Gw_WristbandMerge", "yes")
    F("Flow_A14", "Gw_WristbandOK", "Gw_Reject2", "no", straight_vertical("Gw_WristbandOK", "Gw_Reject2"))
    F("Flow_A15", "Gw_WristbandMerge", "Task_SecurityCheck", "", right_then_down("Gw_WristbandMerge", "Task_SecurityCheck"))
    F("Flow_A16", "Task_SecurityCheck", "Gw_BagFlagged")
    F("Flow_A17", "Gw_BagFlagged", "Gw_SecurityMerge", "no")
    F("Flow_A18", "Gw_BagFlagged", "Task_AdditionalScreening", "yes")
    F("Flow_A19", "Task_AdditionalScreening", "Gw_Cleared")
    F("Flow_A20", "Gw_Cleared", "Gw_SecurityMerge", "yes", via_bottom_of_target("Gw_Cleared", "Gw_SecurityMerge"))
    F("Flow_A21", "Gw_Cleared", "Gw_Reject3", "no", straight_vertical("Gw_Cleared", "Gw_Reject3"))
    F("Flow_A22", "Gw_SecurityMerge", "Task_EntryComplete", "", right_then_down("Gw_SecurityMerge", "Task_EntryComplete"))
    F("Flow_A23", "Task_EntryComplete", "End_Admitted")
    F("Flow_A24", "Gw_Reject1", "Gw_Reject2")
    F("Flow_A25", "Gw_Reject2", "Gw_Reject3")
    F("Flow_A26", "Gw_Reject3", "Task_EntryRejected")
    F("Flow_A27", "Task_EntryRejected", "End_Refused")
    m.msgs = [("MsgFlow_AttendeeJoins", "Attendee enters serpentine queue", "Participant_Attendee", "Task_JoinEntryQueue")]
    m.dobjs = [("DataObject_Credential", "Mobile ticket / wristband + photo ID", "Lane_TicketLane", 1, 0, 0, "Task_TicketVerification", "in"),
               ("DataObject_ProhibitedList", "Prohibited items list", "Lane_Security", 10, 30, 30, "Task_SecurityCheck", "in")]
    m.notes = [("Note_PooledLanes", "One serpentine queue feeds 3 identical staffed lanes (gate_id NG-L1..L3), FCFS. This is ONE pooled service station, not a parallel split: each attendee uses exactly one lane.",
                "Lane_Queue", 3.7, 0, 0, 330, 70, "Task_TicketVerification"),
               ("Note_JoinQueue", "Join Entry Queue = observation when the attendee enters the serpentine. First entry: ticket + photo ID checked and wristband fitted at the lane; post-entry crowd movement is out of scope.",
                "Lane_Queue", 6.6, 0, -30, 330, 56, "Task_JoinEntryQueue"),
               ("Note_Rejection", "Entry Rejected is recorded by the decision owner: Ticket Support, Wristband Steward or Security Supervisor.",
                "Lane_Rejection", 11.6, 0, -44, 320, 44, "Task_EntryRejected")]
    return m


def audience_to_be_model():
    m = BpmnModel("AudienceToBe", "Audience Entry & Crowd Management (To-be candidate)",
                  "Audience Entry — North Gate (To-be candidate, not validated)", [
                      ("Lane_Rejection", "Rejection Record", 150), ("Lane_Express", "Express Wristband Lane", 150),
                      ("Lane_Queue", "Queue & Entry Record", 160), ("Lane_TicketLane", "Ticket Lanes (4 at peak)", 150),
                      ("Lane_Support", "Ticket Support Desk", 150), ("Lane_Security", "Security Screener", 150),
                      ("Lane_Supervisor", "Security Supervisor", 150)])
    m.ext_pools = [("Participant_Attendee", "Attendee (external)", "bottom")]
    N = m.node
    N("Start_Arrive", "startEvent", "Attendee reaches entrance", "Lane_Queue", 0)
    N("Task_JoinEntryQueue", "receiveTask", "Join Entry Queue", "Lane_Queue", 1)
    N("Gw_HasWristband", "exclusiveGateway", "Already holds festival wristband?", "Lane_Queue", 2)
    N("Task_WristbandCheck", "manualTask", "Wristband Check", "Lane_Express", 3)
    N("Gw_WristbandOK", "exclusiveGateway", "Wristband intact?", "Lane_Express", 4)
    N("Task_TicketVerification", "userTask", "Ticket Verification", "Lane_TicketLane", 3)
    N("Gw_ScanOK", "exclusiveGateway", "Credential scanned?", "Lane_TicketLane", 4)
    N("Task_ManualTicketCheck", "userTask", "Manual Ticket Check", "Lane_Support", 5)
    N("Gw_TicketValid", "exclusiveGateway", "Ticket valid?", "Lane_Support", 6)
    N("Gw_TicketMerge", "exclusiveGateway", "", "Lane_TicketLane", 7)
    N("Gw_PathMerge", "exclusiveGateway", "", "Lane_TicketLane", 8)
    N("Task_SecurityCheck", "manualTask", "Security Check", "Lane_Security", 9)
    N("Gw_BagFlagged", "exclusiveGateway", "Bag flagged?", "Lane_Security", 10)
    N("Task_AdditionalScreening", "manualTask", "Additional Screening", "Lane_Supervisor", 11)
    N("Gw_Cleared", "exclusiveGateway", "Cleared?", "Lane_Supervisor", 12)
    N("Gw_SecurityMerge", "exclusiveGateway", "", "Lane_Security", 12)
    N("Task_EntryComplete", "serviceTask", "Entry Complete", "Lane_Queue", 12)
    N("End_Admitted", "endEvent", "Admitted", "Lane_Queue", 13)
    N("Gw_Reject1", "exclusiveGateway", "", "Lane_Rejection", 4)
    N("Gw_Reject2", "exclusiveGateway", "", "Lane_Rejection", 6)
    N("Gw_Reject3", "exclusiveGateway", "", "Lane_Rejection", 12.5)
    N("Task_EntryRejected", "userTask", "Entry Rejected", "Lane_Rejection", 13.5)
    N("End_Refused", "endEvent", "Entry refused", "Lane_Rejection", 14.5)

    def no_path(model):
        sx, sy, sw, sh = model.bounds["Gw_HasWristband"]
        tx, ty, tw, th = model.bounds["Task_TicketVerification"]
        mx = sx + sw + 18
        return [(sx + sw, sy + sh / 2), (mx, sy + sh / 2), (mx, ty + th / 2), (tx, ty + th / 2)]

    def yes_path(model):
        sx, sy, sw, sh = model.bounds["Gw_HasWristband"]
        tx, ty, tw, th = model.bounds["Task_WristbandCheck"]
        return [(sx + sw / 2, sy), (sx + sw / 2, ty + th / 2), (tx, ty + th / 2)]

    def express_merge(model):
        sx, sy, sw, sh = model.bounds["Gw_WristbandOK"]
        tx, ty, tw, th = model.bounds["Gw_PathMerge"]
        return [(sx + sw, sy + sh / 2), (tx + tw / 2, sy + sh / 2), (tx + tw / 2, ty)]

    def cleared_no(model):
        sx, sy, sw, sh = model.bounds["Gw_Cleared"]
        tx, ty, tw, th = model.bounds["Gw_Reject3"]
        return [(sx + sw, sy + sh / 2), (tx + tw / 2, sy + sh / 2), (tx + tw / 2, ty + th)]

    F = m.flow
    F("Flow_T01", "Start_Arrive", "Task_JoinEntryQueue")
    F("Flow_T02", "Task_JoinEntryQueue", "Gw_HasWristband")
    F("Flow_T03", "Gw_HasWristband", "Task_WristbandCheck", "yes (express)", yes_path)
    F("Flow_T04", "Gw_HasWristband", "Task_TicketVerification", "no", no_path)
    F("Flow_T05", "Task_WristbandCheck", "Gw_WristbandOK")
    F("Flow_T06", "Gw_WristbandOK", "Gw_PathMerge", "yes", express_merge)
    F("Flow_T07", "Gw_WristbandOK", "Gw_Reject1", "no", straight_vertical("Gw_WristbandOK", "Gw_Reject1"))
    F("Flow_T08", "Task_TicketVerification", "Gw_ScanOK")
    F("Flow_T09", "Gw_ScanOK", "Gw_TicketMerge", "yes")
    F("Flow_T10", "Gw_ScanOK", "Task_ManualTicketCheck", "no")
    F("Flow_T11", "Task_ManualTicketCheck", "Gw_TicketValid")
    F("Flow_T12", "Gw_TicketValid", "Gw_TicketMerge", "yes", via_bottom_of_target("Gw_TicketValid", "Gw_TicketMerge"))
    F("Flow_T13", "Gw_TicketValid", "Gw_Reject2", "no", straight_vertical("Gw_TicketValid", "Gw_Reject2"))
    F("Flow_T14", "Gw_TicketMerge", "Gw_PathMerge")
    F("Flow_T15", "Gw_PathMerge", "Task_SecurityCheck", "", right_then_down("Gw_PathMerge", "Task_SecurityCheck"))
    F("Flow_T16", "Task_SecurityCheck", "Gw_BagFlagged")
    F("Flow_T17", "Gw_BagFlagged", "Gw_SecurityMerge", "no")
    F("Flow_T18", "Gw_BagFlagged", "Task_AdditionalScreening", "yes")
    F("Flow_T19", "Task_AdditionalScreening", "Gw_Cleared")
    F("Flow_T20", "Gw_Cleared", "Gw_SecurityMerge", "yes", straight_vertical("Gw_Cleared", "Gw_SecurityMerge"))
    F("Flow_T21", "Gw_Cleared", "Gw_Reject3", "no", cleared_no)
    F("Flow_T22", "Gw_SecurityMerge", "Task_EntryComplete", "", straight_vertical("Gw_SecurityMerge", "Task_EntryComplete"))
    F("Flow_T23", "Task_EntryComplete", "End_Admitted")
    F("Flow_T24", "Gw_Reject1", "Gw_Reject2")
    F("Flow_T25", "Gw_Reject2", "Gw_Reject3")
    F("Flow_T26", "Gw_Reject3", "Task_EntryRejected")
    F("Flow_T27", "Task_EntryRejected", "End_Refused")
    m.msgs = [("MsgFlow_AttendeeJoins", "Attendee enters queue", "Participant_Attendee", "Task_JoinEntryQueue")]
    m.dobjs = [("DataObject_Credential", "Mobile ticket + photo ID", "Lane_Support", 3, 0, -10, "Task_TicketVerification", "in")]
    m.notes = [("Note_ToBe", "To-be CANDIDATE. (1) Capacity: 4 staffed ticket lanes 12:00-13:00 (quantified only as a server-count what-if). (2) Structure: wristband holders (re-entry / multi-day) bypass the ticket lanes via an express Wristband Check lane (not simulated by the engine). Manual checks stay off-lane.",
                "Lane_Queue", 4.55, 0, 0, 380, 104, "Gw_HasWristband")]
    return m


def equipment_model():
    m = BpmnModel("EquipmentAsIs", "Equipment & Technical Readiness (As-is)", "Equipment & Technical Readiness — per equipment request (As-is)", [
        ("Lane_Coordinator", "Production Coordinator", 150), ("Lane_EquipmentManager", "Equipment Manager", 160),
        ("Lane_Logistics", "Logistics Crew", 150), ("Lane_QC", "Backline QC Technician", 230)])
    m.ext_pools = [("Participant_Artist", "Artist / Tour Management (external)", "top"),
                   ("Participant_Stage", "Stage & Technical Operations (see stage_as_is.bpmn)", "bottom")]
    N = m.node
    N("Start_Need", "startEvent", "Backline need for a performance", "Lane_Coordinator", 0)
    N("Task_EquipmentRequested", "userTask", "Equipment Requested", "Lane_Coordinator", 1)
    N("Task_AvailabilityCheck", "userTask", "Availability Check", "Lane_EquipmentManager", 2)
    N("Gw_Available", "exclusiveGateway", "Requested model free for the window?", "Lane_EquipmentManager", 3)
    N("Task_SubstituteSearch", "userTask", "Substitute Search", "Lane_EquipmentManager", 4)
    N("Gw_AllocMerge", "exclusiveGateway", "", "Lane_EquipmentManager", 5)
    N("Task_EquipmentAllocation", "userTask", "Equipment Allocation", "Lane_EquipmentManager", 6)
    N("Task_EquipmentTransport", "manualTask", "Equipment Transport", "Lane_Logistics", 7)
    N("Gw_InspectMerge", "exclusiveGateway", "", "Lane_QC", 8, dy=-40)
    N("Task_PreUseInspection", "manualTask", "Pre-use Inspection", "Lane_QC", 9, dy=-40)
    N("Gw_InspectionPassed", "exclusiveGateway", "Inspection passed?", "Lane_QC", 10, dy=-40)
    N("Task_InspectionRework", "manualTask", "Inspection Rework", "Lane_QC", 10, dy=50)
    N("Task_EquipmentReady", "sendTask", "Equipment Ready", "Lane_QC", 11, dy=-40)
    N("End_Ready", "endEvent", "Equipment ready at stage", "Lane_QC", 12, dy=-40)

    def rework_back(model):
        sx, sy, sw, sh = model.bounds["Task_InspectionRework"]
        tx, ty, tw, th = model.bounds["Gw_InspectMerge"]
        return [(sx, sy + sh / 2), (tx + tw / 2, sy + sh / 2), (tx + tw / 2, ty + th)]

    F = m.flow
    F("Flow_E01", "Start_Need", "Task_EquipmentRequested")
    F("Flow_E02", "Task_EquipmentRequested", "Task_AvailabilityCheck")
    F("Flow_E03", "Task_AvailabilityCheck", "Gw_Available")
    F("Flow_E04", "Gw_Available", "Gw_AllocMerge", "yes", below(m, "Gw_Available", "Gw_AllocMerge"))
    F("Flow_E05", "Gw_Available", "Task_SubstituteSearch", "no")
    F("Flow_E06", "Task_SubstituteSearch", "Gw_AllocMerge")
    F("Flow_E07", "Gw_AllocMerge", "Task_EquipmentAllocation")
    F("Flow_E08", "Task_EquipmentAllocation", "Task_EquipmentTransport")
    F("Flow_E09", "Task_EquipmentTransport", "Gw_InspectMerge")
    F("Flow_E10", "Gw_InspectMerge", "Task_PreUseInspection")
    F("Flow_E11", "Task_PreUseInspection", "Gw_InspectionPassed")
    F("Flow_E12", "Gw_InspectionPassed", "Task_EquipmentReady", "yes")
    F("Flow_E13", "Gw_InspectionPassed", "Task_InspectionRework", "no", straight_vertical("Gw_InspectionPassed", "Task_InspectionRework"))
    F("Flow_E14", "Task_InspectionRework", "Gw_InspectMerge", "", rework_back)
    F("Flow_E15", "Task_EquipmentReady", "End_Ready")
    m.msgs = [("MsgFlow_Rider", "Technical rider / backline request", "Participant_Artist", "Task_EquipmentRequested"),
              ("MsgFlow_ReadyNotice", "Equipment Ready notice", "Task_EquipmentReady", "Participant_Stage")]
    m.dobjs = [("DataObject_AssetRegister", "Asset register (house backline)", "Lane_EquipmentManager", 1, 40, 0, "Task_AvailabilityCheck", "in"),
               ("DataObject_AllocationRecord", "Allocation record (asset_id)", "Lane_EquipmentManager", 7, 20, -20, "Task_EquipmentAllocation", "out"),
               ("DataObject_Rider", "Technical rider / input list", "Lane_Coordinator", 2.3, 0, -8, "Task_EquipmentRequested", "in")]
    m.notes = [("Note_Substitute", "Substitute = alternative model or rental asset (ALT-*) when the house pool is booked for the window or the rider model is unavailable.",
                "Lane_Logistics", 3.8, 0, 0, 300, 60, "Task_SubstituteSearch"),
               ("Note_Deadline", "On time = Equipment Ready <= required_ready_at (planned changeover start of the linked performance, festival_id + performance_id).",
                "Lane_QC", 11.9, 0, 62, 260, 70, "Task_EquipmentReady"),
               ("Note_Transport", "Transport time depends on destination stage (MAIN / RIVER / CLUB).",
                "Lane_Logistics", 9.6, 0, 0, 300, 44, "Task_EquipmentTransport")]
    return m


# ----------------------------------------------------------------------------- main
def generate(seed: int):
    rng_plan = random.Random(f"{seed}-plan")
    rng_eq = random.Random(f"{seed}-equipment")
    rng_stage = random.Random(f"{seed}-stage")
    rng_aud = random.Random(f"{seed}-audience")
    staff, staff_rows = build_staff()
    perfs = build_plan(rng_plan)
    eq_cases, eq_ready, eq_issue = gen_equipment(rng_eq, perfs, staff)
    st_cases = gen_stage(rng_stage, perfs, staff, eq_ready, eq_issue)
    au_cases, _ = gen_audience(rng_aud, staff)
    rows = finalize(st_cases + au_cases + eq_cases)
    return rows, staff_rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.normpath(os.path.join(here, "..", "..")),
                    help="festival-assets root (writes public/datasets and public/bpmn)")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = ap.parse_args()
    ds = os.path.join(args.out, "public", "datasets")
    bp = os.path.join(args.out, "public", "bpmn")
    os.makedirs(ds, exist_ok=True)
    os.makedirs(bp, exist_ok=True)

    rows, staff_rows = generate(args.seed)
    write_csv(os.path.join(ds, "demo_festival_operations_2026.csv"), rows)
    write_xes(os.path.join(ds, "demo_festival_operations_2026.xes"), rows, DATASET_NAME, args.seed)
    for proc, base, label in (("stage", "stage_operations", "Stage & Technical Operations"),
                              ("audience", "audience_entry", "Audience Entry & Crowd Management"),
                              ("equipment", "equipment_readiness", "Equipment & Technical Readiness")):
        sub = [r for r in rows if r["process_type"] == proc]
        write_csv(os.path.join(ds, f"{base}.csv"), sub)
        write_xes(os.path.join(ds, f"{base}.xes"), sub, f"{DATASET_NAME} — {label}", args.seed)
    write_shifts(os.path.join(ds, "resource_shifts.csv"), staff_rows)
    write_manifest(os.path.join(ds, "dataset_manifest.json"), args.seed)
    for fname, model in (("stage_as_is.bpmn", stage_model()), ("audience_as_is.bpmn", audience_as_is_model()),
                         ("equipment_as_is.bpmn", equipment_model()), ("audience_to_be.bpmn", audience_to_be_model())):
        with open(os.path.join(bp, fname), "w", encoding="utf-8", newline="\n") as f:
            f.write(model.to_xml())
    counts = {p: len({r["case_id"] for r in rows if r["process_type"] == p}) for p in ("stage", "audience", "equipment")}
    print(f"generator {VERSION} seed={args.seed}: {len(rows)} events; cases {counts}; staff {len(staff_rows)}")


if __name__ == "__main__":
    main()
