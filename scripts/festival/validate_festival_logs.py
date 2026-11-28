#!/usr/bin/env python3
"""
validate_festival_logs.py — independent validation of the Demo Festival Operations 2026 assets.

Python standard library only.  It does NOT run the ProcessPilot engine: every number it reports is an
INDEPENDENT re-implementation of the documented rules (DATA_SCHEMA v0.2.1, V03_CONTRACT §3A/§5/§6/§10)
and must not be described as an engine result.

Usage:
  python3 scripts/festival/validate_festival_logs.py [--root <festival-assets root>] [--skip-regen]
Writes:
  reports/evidence/festival-data-validation.md
  reports/evidence/validation_results.json
Exit code 1 if any check FAILs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import statistics as st
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
XES_NS = "http://www.xes-standard.org/"
BPMN_NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL", "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
           "dc": "http://www.omg.org/spec/DD/20100524/DC", "di": "http://www.omg.org/spec/DD/20100524/DI"}
VOCAB = {
    "stage": ["Stage Handover", "Stage Setup", "Line Check", "Technical Check", "Technical Troubleshooting",
              "Technical Recheck", "Stage Ready", "Performance Start", "Performance End"],
    "audience": ["Join Entry Queue", "Ticket Verification", "Manual Ticket Check", "Security Check",
                 "Additional Screening", "Wristband Check", "Entry Complete", "Entry Rejected"],
    "equipment": ["Equipment Requested", "Availability Check", "Equipment Allocation", "Substitute Search",
                  "Equipment Transport", "Pre-use Inspection", "Inspection Rework", "Equipment Ready"],
}
COMPLETION = {"stage": ["Performance End"], "audience": ["Entry Complete", "Entry Rejected"], "equipment": ["Equipment Ready"]}
FESTIVAL_FIELDS = ["festival_id", "performance_id", "stage_id", "gate_id", "equipment_request_id", "equipment_type",
                   "asset_id", "scheduled_start", "required_ready_at", "ticket_type", "issue_type", "resource_id",
                   "resource_role", "act_type", "setup_profile"]
TS_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
LIMITS = dict(bytes=8 * 1024 * 1024, events=50_000, traces=10_000, elements=500_000, depth=32)

RESULTS = OrderedDict()


def check(cid, title, ok, detail, status=None):
    RESULTS[cid] = dict(title=title, status=status or ("PASS" if ok else "FAIL"), detail=detail)


def ts(s):
    return datetime.fromisoformat(s).timestamp()


# ----------------------------------------------------------------------------- loading
def load_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        raw = f.read()
    reader = list(csv.reader(io.StringIO(raw)))
    header, body = reader[0], reader[1:]
    widths = Counter(len(r) for r in reader)
    rows = [dict(zip(header, r)) for r in body]
    for i, r in enumerate(rows):
        r["_order"] = i
    return header, rows, widths


def xes_guard(path):
    """Structural/security/limit scan per V03_CONTRACT §3A (independent)."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        data = f.read()
    text = data.decode("utf-8")
    unsafe = any(tok in text for tok in ("<!DOCTYPE", "<!ENTITY", "xi:include", "<?xml-stylesheet"))
    depth = maxdepth = elements = 0
    for ev, el in ET.iterparse(io.BytesIO(data), events=("start", "end")):
        if ev == "start":
            depth += 1
            elements += 1
            maxdepth = max(maxdepth, depth)
        else:
            depth -= 1
    root = ET.fromstring(data)
    traces = root.findall(f"{{{XES_NS}}}trace")
    events = sum(len(t.findall(f"{{{XES_NS}}}event")) for t in traces)
    return dict(bytes=size, elements=elements, depth=maxdepth, traces=len(traces), events=events, unsafe=unsafe,
                root=root.tag, encoding_decl='encoding="UTF-8"' in text[:100])


def xes_rows(path):
    """Emulate the §3A mapping: trace scalars inherited, event scalars override, canonical keys mapped."""
    root = ET.parse(path).getroot()
    rows, problems = [], []
    allowed = {f"{{{XES_NS}}}{t}" for t in ("extension", "global", "classifier", "trace", "string", "date", "int",
                                             "float", "boolean", "id")}
    for child in root:
        if child.tag not in allowed:
            problems.append(f"unsupported log child {child.tag}")
    seen_keys = set()
    order = 0
    for ti, tr in enumerate(root.findall(f"{{{XES_NS}}}trace")):
        tattrs = {}
        for a in tr:
            if a.tag == f"{{{XES_NS}}}event":
                continue
            k = a.get("key")
            if k in tattrs:
                problems.append(f"duplicate trace attribute {k}")
            tattrs[k] = a.get("value")
        case_id = tattrs.get("concept:name")
        proc = tattrs.get("process_type", "default")
        key = (proc, case_id)
        if key in seen_keys:
            problems.append(f"xes_duplicate_trace_key {key}")
        seen_keys.add(key)
        for ei, ev in enumerate(tr.findall(f"{{{XES_NS}}}event")):
            eattrs = {}
            for a in ev:
                k = a.get("key")
                if k in eattrs:
                    problems.append(f"duplicate event attribute {k}")
                eattrs[k] = a.get("value")
            merged = {k: v for k, v in tattrs.items() if k != "concept:name"}
            merged.update({k: v for k, v in eattrs.items()})
            lc = eattrs.get("lifecycle:transition", "")
            if lc not in ("", "start", "complete"):
                problems.append(f"lifecycle {lc}")
            row = {
                "process_type": merged.get("process_type", ""), "case_id": case_id,
                "activity": eattrs.get("concept:name"), "timestamp": eattrs.get("time:timestamp"),
                "lifecycle": lc, "activity_instance_id": eattrs.get("concept:instance", ""),
                "event_id": eattrs.get("identity:id", ""), "resource": eattrs.get("org:resource", ""),
                "resource_role": eattrs.get("org:role", ""), "_order": order, "_loc": (ti, ei),
            }
            for f in FESTIVAL_FIELDS:
                if f not in row:
                    row[f] = merged.get(f, merged.get(f"festival:{f}", ""))
            rows.append(row)
            order += 1
    return rows, problems


# ----------------------------------------------------------------------------- analytics (independent)
def group(rows):
    cases = OrderedDict()
    for r in rows:
        cases.setdefault((r["process_type"], r["case_id"]), []).append(r)
    for k in cases:
        cases[k].sort(key=lambda r: (ts(r["timestamp"]), r["_order"]))
    return cases


def discovery(evs):
    return [e for e in evs if e["lifecycle"] != "start"]


def pairs(evs):
    g = defaultdict(list)
    for e in evs:
        if e["lifecycle"] in ("start", "complete"):
            g[(e["activity"], e["activity_instance_id"])].append(e)
    out, bad = [], 0
    for (act, iid), es in g.items():
        s = [e for e in es if e["lifecycle"] == "start"]
        c = [e for e in es if e["lifecycle"] == "complete"]
        if len(s) == 1 and len(c) == 1 and ts(c[0]["timestamp"]) >= ts(s[0]["timestamp"]):
            out.append((s[0], c[0]))
        elif len(s) == 0 and len(c) == 1:
            pass  # complete marker (point semantics)
        else:
            bad += 1
    return out, bad


def analyze(rows, proc):
    cases = OrderedDict((k, v) for k, v in group(rows).items() if k[0] == proc)
    dfg, starts, ends = Counter(), Counter(), Counter()
    variants = Counter()
    gaps = defaultdict(list)
    svc = defaultdict(list)
    hand = Counter()
    hand_pairs = Counter()
    rework = 0
    for key, evs in cases.items():
        seq = discovery(evs)
        acts = [e["activity"] for e in seq]
        variants[tuple(acts)] += 1
        if acts:
            starts[acts[0]] += 1
            ends[acts[-1]] += 1
        if any(n > 1 for n in Counter(acts).values()):
            rework += 1
        for a, b in zip(seq, seq[1:]):
            dfg[(a["activity"], b["activity"])] += 1
            gaps[(a["activity"], b["activity"])].append((ts(b["timestamp"]) - ts(a["timestamp"])) / 60)
            ra, rb = a.get("resource_id") or a.get("resource"), b.get("resource_id") or b.get("resource")
            if ra and rb and ra != rb:
                hand[(a["resource"], b["resource"])] += 1
                hand_pairs[(a["activity"], b["activity"])] += 1
        for s, c in pairs(evs)[0]:
            svc[s["activity"]].append((ts(c["timestamp"]) - ts(s["timestamp"])) / 60)
    n = len(cases)
    return dict(
        cases=n, events=sum(len(v) for v in cases.values()),
        discovery_events=sum(len(discovery(v)) for v in cases.values()),
        dfg={f"{a} -> {b}": c for (a, b), c in sorted(dfg.items(), key=lambda x: -x[1])},
        starts=dict(starts), ends=dict(ends),
        variants=[dict(count=c, share=c / n, sequence=list(v)) for v, c in variants.most_common()],
        service_mean_min={a: dict(n=len(v), mean=st.mean(v), p90=sorted(v)[max(0, math.ceil(0.9 * len(v)) - 1)])
                          for a, v in sorted(svc.items())},
        inter_event_gap_mean_min={f"{a} -> {b}": dict(n=len(v), mean=st.mean(v)) for (a, b), v in gaps.items()},
        handoffs_total=sum(hand.values()),
        handoffs_top=[dict(source=a, target=b, count=c) for (a, b), c in hand.most_common(12)],
        handoff_activity_pairs={f"{a} -> {b}": c for (a, b), c in hand_pairs.most_common()},
        repeated_case_rate_pct=100 * rework / n if n else None,
    )


def nearest_rank(vals, q):
    v = sorted(vals)
    return v[max(0, math.ceil(q * len(v)) - 1)]


def engine_equivalent_queue(inputs, servers):
    """Pooled FCFS, identical servers, min(ready, index) — mirrors queue.ts semantics (independent code)."""
    arr = sorted(inputs, key=lambda x: (x[1], x[3]))
    first = arr[0][1]
    ready = [0.0] * min(servers, len(arr))
    waits, finish = [], 0.0
    for cid, a, svc, _ in arr:
        t = a - first
        i = min(range(len(ready)), key=lambda k: (ready[k], k))
        s = max(t, ready[i])
        ready[i] = s + svc
        finish = max(finish, ready[i])
        waits.append(s - t)
    return dict(servers=servers, n=len(arr), mean_wait_min=st.mean(waits) / 60,
                p95_wait_min=nearest_rank(waits, 0.95) / 60, max_wait_min=max(waits) / 60,
                finish_elapsed_min=finish / 60, throughput_per_hour=len(arr) * 3600 / finish if finish else None)


# ----------------------------------------------------------------------------- BPMN
def bpmn_check(path, vocab):
    root = ET.parse(path).getroot()
    ok, notes = True, []
    if root.tag != f"{{{BPMN_NS['bpmn']}}}definitions":
        return False, ["root is not bpmn:definitions"], {}
    ids = {}
    for el in root.iter():
        if el.get("id"):
            if el.get("id") in ids:
                ok = False
                notes.append(f"duplicate id {el.get('id')}")
            ids[el.get("id")] = el
    shapes = {s.get("bpmnElement"): s for s in root.iter(f"{{{BPMN_NS['bpmndi']}}}BPMNShape")}
    edges = {e.get("bpmnElement"): e for e in root.iter(f"{{{BPMN_NS['bpmndi']}}}BPMNEdge")}
    if not root.findall("bpmndi:BPMNDiagram", BPMN_NS):
        ok = False
        notes.append("missing BPMNDiagram")
    procs = root.findall("bpmn:process", BPMN_NS)
    node_tags = ("task", "userTask", "manualTask", "serviceTask", "sendTask", "receiveTask", "startEvent", "endEvent",
                 "exclusiveGateway", "parallelGateway", "inclusiveGateway", "intermediateCatchEvent", "intermediateThrowEvent")
    info = {}
    proc_of = {}
    for p in procs:
        for el in p:
            proc_of[el.get("id")] = p.get("id")
    for p in procs:
        nodes = {el.get("id"): el for el in p if el.tag.split("}")[1] in node_tags}
        flows = [el for el in p if el.tag.endswith("sequenceFlow")]
        for nid in nodes:
            if nid not in shapes:
                ok = False
                notes.append(f"no DI shape for {nid}")
        for el in p:
            t = el.tag.split("}")[1]
            if t in ("dataObjectReference", "textAnnotation") and el.get("id") not in shapes:
                ok = False
                notes.append(f"no DI shape for {el.get('id')}")
            if t in ("sequenceFlow", "association") and el.get("id") not in edges:
                ok = False
                notes.append(f"no DI edge for {el.get('id')}")
        for lane in p.iter(f"{{{BPMN_NS['bpmn']}}}lane"):
            if lane.get("id") not in shapes:
                ok = False
                notes.append(f"no DI shape for lane {lane.get('id')}")
        inc, out = defaultdict(list), defaultdict(list)
        for f in flows:
            s, t = f.get("sourceRef"), f.get("targetRef")
            if s not in nodes or t not in nodes:
                ok = False
                notes.append(f"sequenceFlow {f.get('id')} leaves its process")
            out[s].append(t)
            inc[t].append(s)
        for nid, el in nodes.items():
            decl_in = [x.text for x in el.findall("bpmn:incoming", BPMN_NS)]
            decl_out = [x.text for x in el.findall("bpmn:outgoing", BPMN_NS)]
            real_in = [f.get("id") for f in flows if f.get("targetRef") == nid]
            real_out = [f.get("id") for f in flows if f.get("sourceRef") == nid]
            if sorted(decl_in) != sorted(real_in) or sorted(decl_out) != sorted(real_out):
                ok = False
                notes.append(f"incoming/outgoing mismatch at {nid}")
        starts = [n for n, el in nodes.items() if el.tag.endswith("startEvent")]
        endsn = [n for n, el in nodes.items() if el.tag.endswith("endEvent")]
        seen, stack = set(), list(starts)
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            stack.extend(out[x])
        unreachable = set(nodes) - seen
        rev, stack2 = set(), list(endsn)
        while stack2:
            x = stack2.pop()
            if x in rev:
                continue
            rev.add(x)
            stack2.extend(inc[x])
        dead = set(nodes) - rev
        if unreachable or dead:
            ok = False
            notes.append(f"unreachable={sorted(unreachable)} cannot-reach-end={sorted(dead)}")
        tasks = {el.get("name") for el in nodes.values() if el.tag.split("}")[1].endswith("Task") or el.tag.endswith("}task")}
        kinds = Counter(el.tag.split("}")[1] for el in nodes.values())
        supported = (len(starts) == 1 and all(len(inc[e]) == 1 and not out[e] for e in endsn)
                     and not any(k in kinds for k in ("parallelGateway", "inclusiveGateway", "intermediateCatchEvent",
                                                       "intermediateThrowEvent"))
                     and all(len(inc[n]) <= 1 and len(out[n]) <= 1 for n, el in nodes.items()
                             if el.tag.split("}")[1].endswith("Task")))
        info = dict(process=p.get("id"), tasks=sorted(tasks), gateway_kinds=dict(kinds),
                    tasks_not_in_vocab=sorted(tasks - set(vocab)), vocab_not_in_tasks=sorted(set(vocab) - tasks),
                    lanes=len(list(p.iter(f"{{{BPMN_NS['bpmn']}}}lane"))),
                    sequence_flows=len(flows), comparison_supported_structure=supported)
        if info["tasks_not_in_vocab"]:
            ok = False
            notes.append(f"task names outside vocabulary: {info['tasks_not_in_vocab']}")
    pools = {pp.get("id"): pp.get("processRef") for pp in root.iter(f"{{{BPMN_NS['bpmn']}}}participant")}
    for mf in root.iter(f"{{{BPMN_NS['bpmn']}}}messageFlow"):
        s, t = mf.get("sourceRef"), mf.get("targetRef")
        sp = s if s in pools else [k for k, v in pools.items() if v == proc_of.get(s)][0]
        tp = t if t in pools else [k for k, v in pools.items() if v == proc_of.get(t)][0]
        if sp == tp:
            ok = False
            notes.append(f"messageFlow {mf.get('id')} inside one pool")
        if mf.get("id") not in edges:
            ok = False
            notes.append(f"no DI edge for {mf.get('id')}")
    for e in edges.values():
        if len(e.findall("di:waypoint", BPMN_NS)) < 2:
            ok = False
            notes.append(f"edge {e.get('bpmnElement')} has <2 waypoints")
    # overlapping flow-node shapes (layout sanity)
    boxes = []
    for nid, s in shapes.items():
        el = ids.get(nid)
        if el is None:
            continue
        t = el.tag.split("}")[1]
        if t in node_tags or t in ("dataObjectReference", "textAnnotation"):
            b = s.find("dc:Bounds", BPMN_NS)
            boxes.append((nid, *(float(b.get(k)) for k in ("x", "y", "width", "height"))))
    overlaps = [(a[0], b[0]) for i, a in enumerate(boxes) for b in boxes[i + 1:]
                if a[1] < b[1] + b[3] and b[1] < a[1] + a[3] and a[2] < b[2] + b[4] and b[2] < a[2] + a[4]]
    if overlaps:
        ok = False
        notes.append(f"overlapping shapes {overlaps}")
    info["message_flows"] = len(list(root.iter(f"{{{BPMN_NS['bpmn']}}}messageFlow")))
    info["pools"] = len(pools)
    return ok, notes, info


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.normpath(os.path.join(HERE, "..", "..")))
    ap.add_argument("--skip-regen", action="store_true")
    a = ap.parse_args()
    root = a.root
    ds = os.path.join(root, "public", "datasets")
    bp = os.path.join(root, "public", "bpmn")
    manifest = json.load(open(os.path.join(ds, "dataset_manifest.json"), encoding="utf-8"))
    csv_path = os.path.join(ds, manifest["csv"])
    header, rows, widths = load_csv(csv_path)
    cases = group(rows)
    by_proc = defaultdict(list)
    for (p, c), evs in cases.items():
        by_proc[p].append((c, evs))

    # 1 determinism
    if a.skip_regen:
        check("C01", "Same seed reproduces identical files", True, "skipped (--skip-regen)", "NOT RUN")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, os.path.join(HERE, "generate_festival_logs.py"), "--out", tmp,
                            "--seed", str(manifest["generator"]["seed"])], check=True, capture_output=True)
            diffs = []
            for sub in ("public/datasets", "public/bpmn"):
                for f in sorted(os.listdir(os.path.join(root, sub))):
                    h1 = hashlib.sha256(open(os.path.join(root, sub, f), "rb").read()).hexdigest()
                    p2 = os.path.join(tmp, sub, f)
                    h2 = hashlib.sha256(open(p2, "rb").read()).hexdigest() if os.path.exists(p2) else None
                    if h1 != h2:
                        diffs.append(f)
            check("C01", "Same seed reproduces identical files", not diffs,
                  "all public/datasets + public/bpmn files byte-identical (SHA-256)" if not diffs else f"differs: {diffs}")

    # 2 counts
    cc = {p: len(v) for p, v in by_proc.items()}
    ec = Counter(r["process_type"] for r in rows)
    check("C02", "Case and event counts", set(cc) == {"stage", "audience", "equipment"},
          f"cases {dict(cc)}; events {dict(ec)}; total events {len(rows)}")
    # 3 event ids
    dup = [k for k, v in Counter(r["event_id"] for r in rows).items() if v > 1]
    check("C03", "event_id unique", not dup and all(r["event_id"] for r in rows), f"{len(rows)} ids, duplicates {len(dup)}")
    # 4 required fields + column width
    req = ["event_id", "process_type", "case_id", "activity", "timestamp", "festival_id"]
    miss = [r["event_id"] for r in rows if any(not r[f] for f in req)]
    nores = [r["event_id"] for r in rows if not r["resource_id"] and not (r["process_type"] == "audience" and r["activity"] in ("Join Entry Queue", "Entry Complete"))]
    check("C04", "Required fields present, constant CSV width", not miss and not nores and len(widths) == 1,
          f"missing required {len(miss)}; staff events without resource_id {len(nores)} (audience Join/Entry Complete are unstaffed observations by design); row widths {dict(widths)}")
    # 5 vocabulary
    bad_act = Counter((r["process_type"], r["activity"]) for r in rows if r["activity"] not in VOCAB.get(r["process_type"], []))
    used = {p: sorted({r["activity"] for r in rows if r["process_type"] == p}) for p in VOCAB}
    check("C05", "Activity names match DATA_SCHEMA vocabulary", not bad_act,
          f"unknown {dict(bad_act)}; unused vocabulary {[(p, sorted(set(VOCAB[p]) - set(u))) for p, u in used.items()]}")
    # 6 timestamps
    badts = [r["event_id"] for r in rows if not TS_RE.match(r["timestamp"])]
    for f in ("scheduled_start", "required_ready_at"):
        badts += [r["event_id"] for r in rows if r[f] and not TS_RE.match(r[f])]
    check("C06", "ISO 8601 timestamps with explicit offset", not badts, f"invalid {len(badts)}; offsets {Counter(r['timestamp'][-6:] for r in rows)}")
    # 7 lifecycle
    lc = Counter(r["lifecycle"] for r in rows)
    badpairs = 0
    unpaired_starts = 0
    for (p, c), evs in cases.items():
        pr, bad = pairs(evs)
        badpairs += bad
        unpaired_starts += sum(1 for e in evs if e["lifecycle"] == "start") - len(pr)
    check("C07", "Lifecycle start/complete matching by activity_instance_id", badpairs == 0 and unpaired_starts == 0
          and set(lc) <= {"", "start", "complete"},
          f"lifecycle values {dict(lc)}; ambiguous/invalid instances {badpairs}; starts without completion {unpaired_starts}")
    # 8 ordering
    viol = []
    for (p, c), evs in cases.items():
        t = [ts(e["timestamp"]) for e in evs]
        if any(b <= a for a, b in zip(t, t[1:])):
            viol.append((c, "tie/non-increasing"))
        acts = [e["activity"] for e in evs]
        if p == "audience" and (acts[0] != "Join Entry Queue" or acts[-1] not in ("Entry Complete", "Entry Rejected")):
            viol.append((c, "audience boundary"))
        if p == "stage" and acts[-3:] != ["Stage Ready", "Performance Start", "Performance End"]:
            viol.append((c, "stage tail"))
        if p == "stage" and acts[0] != "Stage Handover":
            viol.append((c, "stage head"))
        if p == "equipment" and (acts[0] != "Equipment Requested" or acts[-1] != "Equipment Ready"):
            viol.append((c, "equipment boundary"))
    check("C08", "No impossible within-case ordering (no ties, boundaries respected)", not viol, f"violations {viol[:5]} (n={len(viol)})")
    # 9 + 10 resources & shifts
    shifts = defaultdict(list)
    assignable = defaultdict(set)
    for s in csv.DictReader(open(os.path.join(ds, "resource_shifts.csv"), encoding="utf-8")):
        shifts[s["resource_id"]].append((ts(s["shift_start"]), ts(s["shift_end"])))
        assignable[s["resource_id"]].update(s["assignable_activities"].split(";"))
    intervals = defaultdict(list)
    for (p, c), evs in cases.items():
        for s, e in pairs(evs)[0]:
            if s["resource_id"] != e["resource_id"]:
                viol.append((c, "pair resource mismatch"))
            intervals[s["resource_id"]].append((ts(s["timestamp"]), ts(e["timestamp"]), c, s["activity"]))
    overl = []
    for rid, iv in intervals.items():
        iv.sort()
        for x, y in zip(iv, iv[1:]):
            if y[0] < x[1]:
                overl.append((rid, x[2], y[2]))
    check("C09", "No resource performs two activity instances at once", not overl,
          f"{len(intervals)} staffed resources with intervals; overlaps {len(overl)} {overl[:3]}")
    outside, wrongact, noshift = [], [], set()
    for r in rows:
        rid = r["resource_id"]
        if not rid:
            continue
        if rid not in shifts:
            noshift.add(rid)
            continue
        t = ts(r["timestamp"])
        if not any(a0 <= t <= b0 for a0, b0 in shifts[rid]):
            outside.append(r["event_id"])
        if r["activity"] not in assignable[rid]:
            wrongact.append(r["event_id"])
    check("C10", "Every staffed event inside a shift of resource_shifts.csv and assignable", not outside and not wrongact and not noshift,
          f"events outside shift {len(outside)}; activity not assignable {len(wrongact)}; resource_ids without shifts {len(noshift)}")
    # 11 stage-equipment link
    stage_key = Counter((evs[0]["festival_id"], evs[0]["performance_id"]) for c, evs in by_proc["stage"])
    link_bad, setup_viol, eq_ready = [], [], defaultdict(float)
    for c, evs in by_proc["equipment"]:
        k = (evs[0]["festival_id"], evs[0]["performance_id"])
        if stage_key.get(k) != 1:
            link_bad.append(c)
        eq_ready[k] = max(eq_ready[k], ts([e for e in evs if e["activity"] == "Equipment Ready"][0]["timestamp"]))
    fallback = 0
    for c, evs in by_proc["stage"]:
        k = (evs[0]["festival_id"], evs[0]["performance_id"])
        sc = [e for e in evs if e["activity"] == "Stage Setup" and e["lifecycle"] == "complete"][0]
        if k in eq_ready and ts(sc["timestamp"]) < eq_ready[k]:
            if sc["issue_type"] == "equipment_fallback":
                fallback += 1
            else:
                setup_viol.append(c)
    check("C11", "Stage<->Equipment link on festival_id + performance_id", not link_bad and not setup_viol,
          f"{len(by_proc['equipment'])} requests -> {len(eq_ready)} distinct performances, unmatched/ambiguous {len(link_bad)}; "
          f"Stage Setup completed before linked Equipment Ready without fallback flag {len(setup_viol)}; documented fallbacks {fallback}")
    # 12 schedule overlap
    sched = defaultdict(list)
    for c, evs in by_proc["stage"]:
        d = {e["activity"]: ts(e["timestamp"]) for e in evs if e["lifecycle"] != "start"}
        ho = ts([e for e in evs if e["activity"] == "Stage Handover"][0]["timestamp"])
        sched[(c.split("-")[1], evs[0]["stage_id"])].append((d["Performance Start"], d["Performance End"], ho, c))
    sov = []
    for k, lst in sched.items():
        lst.sort()
        for x, y in zip(lst, lst[1:]):
            if y[0] < x[1] or y[2] < x[1]:
                sov.append((x[3], y[3]))
    check("C12", "No overlapping performances / handovers on one stage", not sov, f"{len(sched)} stage-days, conflicts {sov}")
    # 13 audience FCFS
    aud = []
    for c, evs in by_proc["audience"]:
        j = [e for e in evs if e["activity"] == "Join Entry Queue"][0]
        s = [e for e in evs if e["activity"] == "Ticket Verification" and e["lifecycle"] == "start"][0]
        e2 = [e for e in evs if e["activity"] == "Ticket Verification" and e["lifecycle"] == "complete"][0]
        aud.append(dict(c=c, join=ts(j["timestamp"]), s=ts(s["timestamp"]), e=ts(e2["timestamp"]), gate=s["gate_id"],
                        res=s["resource"], order=j["_order"], ticket=evs[0]["ticket_type"], evs=evs))
    lanes = defaultdict(list)
    for x in aud:
        lanes[x["gate"]].append((x["s"], x["e"]))
    lane_ok = all(b[0] >= a[1] for iv in lanes.values() for a, b in zip(sorted(iv), sorted(iv)[1:]))
    gate_res = {(x["gate"], x["res"]) for x in aud}
    wc_viol = 0
    for x in aud:
        if x["s"] - x["join"] > 15:  # waited beyond the max walking time -> every lane must be busy just before
            t = x["s"] - 1
            if any(not any(a <= t < b for a, b in iv) for iv in lanes.values()):
                wc_viol += 1
    srt = sorted(aud, key=lambda x: x["join"])
    order_viol = sum(1 for i, x in enumerate(srt) for y in srt[i + 1:i + 40] if y["join"] > x["join"] + 15 and y["s"] < x["s"])
    check("C13", "Audience lanes: one pooled FCFS station, no lane overlap, work-conserving",
          lane_ok and wc_viol == 0 and order_viol == 0 and len(gate_res) == len(lanes),
          f"lanes {sorted(lanes)}; lane<->checker pairs {sorted(gate_res)}; FCFS order violations {order_viol}; "
          f"idle-lane-while-waiting violations {wc_viol}; baseline_gate_count={manifest['baseline_gate_count']} (staffed lanes, not inferred from gate_id)")

    # XES checks
    xes_path = os.path.join(ds, "demo_festival_operations_2026.xes")
    g = xes_guard(xes_path)
    lim_ok = (g["bytes"] <= LIMITS["bytes"] and g["events"] <= LIMITS["events"] and g["traces"] <= LIMITS["traces"]
              and g["elements"] <= LIMITS["elements"] and g["depth"] <= LIMITS["depth"] and not g["unsafe"]
              and g["root"] == f"{{{XES_NS}}}log")
    check("C21", "Combined XES within V03 §3A limits, no unsafe XML", lim_ok,
          f"{g['bytes']:,} B (<= 8,388,608), {g['events']:,} events (<= 50,000), {g['traces']:,} traces (<= 10,000), "
          f"{g['elements']:,} elements (<= 500,000), depth {g['depth']} (<= 32); DTD/entity/XInclude/stylesheet: {g['unsafe']}")
    xrows, xprob = xes_rows(xes_path)
    xcases = group(xrows)
    check("C14", "CSV and XES: same [process_type, case_id] set and event counts", not xprob and
          set(xcases) == set(cases) and all(len(xcases[k]) == len(cases[k]) for k in cases),
          f"CSV cases {len(cases)} / XES traces {len(xcases)}; CSV events {len(rows)} / XES events {len(xrows)}; parser problems {xprob[:3]}")
    cmp_fields = ["event_id", "activity", "timestamp", "lifecycle", "activity_instance_id", "resource", "resource_role"]
    mism = 0
    for k in cases:
        for e1, e2 in zip(cases[k], xcases.get(k, [])):
            if any((e1[f] or "") != (e2[f] or "") for f in cmp_fields):
                mism += 1
    check("C15", "CSV and XES: identical within-case order, timestamps, resources, lifecycle", mism == 0,
          f"field mismatches {mism}; point events carry no lifecycle:transition; 'point' literal used: "
          f"{'point' in open(xes_path, encoding='utf-8').read().split('lifecycle:transition')[1:2]}")
    fm = Counter()
    for k in cases:
        for e1, e2 in zip(cases[k], xcases[k]):
            for f in FESTIVAL_FIELDS:
                if (e1.get(f) or "") != (e2.get(f) or ""):
                    fm[f] += 1
    check("C16", "Festival extension attributes preserved (trace inheritance + event scalars)", not fm,
          f"mismatched fields {dict(fm)}; compared {', '.join(FESTIVAL_FIELDS)}")
    sub_bad = []
    for proc, fname in (("stage", "stage_operations.xes"), ("audience", "audience_entry.xes"), ("equipment", "equipment_readiness.xes")):
        srows, sp = xes_rows(os.path.join(ds, fname))
        sc = group(srows)
        whole = {k: v for k, v in xcases.items() if k[0] == proc}
        if sp or set(sc) != set(whole) or any([e["event_id"] for e in sc[k]] != [e["event_id"] for e in whole[k]] for k in whole):
            sub_bad.append(fname)
        gg = xes_guard(os.path.join(ds, fname))
        if gg["bytes"] > LIMITS["bytes"]:
            sub_bad.append(fname + " size")
    check("C17", "Per-process XES files equal the extracted part of the combined XES", not sub_bad, f"problems {sub_bad}")
    # equivalence of independent analytics on CSV vs XES
    eq_diff = []
    for proc in ("stage", "audience", "equipment"):
        A1, A2 = analyze(rows, proc), analyze(xrows, proc)
        for key in ("cases", "dfg", "starts", "ends", "variants", "handoffs_total", "handoff_activity_pairs"):
            if A1[key] != A2[key]:
                eq_diff.append((proc, key))
        for act, v in A1["service_mean_min"].items():
            if abs(v["mean"] - A2["service_mean_min"][act]["mean"]) > 1e-9:
                eq_diff.append((proc, "service", act))
    check("C22", "Independent CSV-vs-XES analysis equivalence (DFG, start/end, variants, handoffs, service)", not eq_diff,
          f"differences {eq_diff}. Independent re-implementation, NOT the ProcessPilot importXes/engine.")

    # 18/19 BPMN
    binfo, bnotes, bok = {}, [], True
    for f, proc in (("stage_as_is.bpmn", "stage"), ("audience_as_is.bpmn", "audience"), ("equipment_as_is.bpmn", "equipment"),
                    ("audience_to_be.bpmn", "audience")):
        ok, notes, info = bpmn_check(os.path.join(bp, f), VOCAB[proc])
        bok &= ok
        binfo[f] = info
        bnotes += [f"{f}: {n}" for n in notes]
    check("C18", "BPMN 2.0 XML structure, DI shapes/edges, sequence vs message flows, reachability", bok,
          "; ".join(bnotes) or "4 files: every flow node/lane/data object/annotation has a BPMNShape, every flow/association has a BPMNEdge, "
          "message flows only between pools, all nodes on a start->end path, no overlapping shapes")
    cov = []
    for f, proc in (("stage_as_is.bpmn", "stage"), ("audience_as_is.bpmn", "audience"), ("equipment_as_is.bpmn", "equipment")):
        missing = sorted(set(used[proc]) - set(binfo[f]["tasks"]))
        if missing or binfo[f]["tasks_not_in_vocab"]:
            cov.append((f, missing))
    check("C19", "Every logged activity has an exact-name BPMN task (As-is), no extra task names", not cov,
          f"problems {cov}; ProcessPilot comparison-supported structure (task/start/end/XOR only): "
          + ", ".join(f"{k}={v['comparison_supported_structure']}" for k, v in binfo.items()))
    # 20 manifest
    mprob = []
    for k in ("dataset_id", "name", "source_type", "csv", "timezone", "baseline_gate_count", "service_activity", "bpmn", "generator"):
        if k not in manifest:
            mprob.append(f"missing {k}")
    if not os.path.exists(csv_path):
        mprob.append("csv missing")
    for kk in ("bpmn", "bpmn_to_be"):
        for proc, fn in manifest.get(kk, {}).items():
            if ".." in fn or fn.startswith("/") or not os.path.exists(os.path.join(bp, fn)):
                mprob.append(f"{kk}.{proc} -> {fn}")
            if proc not in VOCAB:
                mprob.append(f"{kk} key {proc}")
    if not (isinstance(manifest.get("baseline_gate_count"), int) and manifest["baseline_gate_count"] >= 1):
        mprob.append("baseline_gate_count")
    if manifest.get("service_activity") not in VOCAB["audience"]:
        mprob.append("service_activity")
    if manifest.get("source_type") != "synthetic":
        mprob.append("source_type")
    check("C20", "Manifest paths and keys valid for adapter.ts parseManifest", not mprob,
          f"problems {mprob}; keys {list(manifest)}; no new keys added (XES/completion are documented as proposals)")
    # trace-constant attributes
    tc_bad = []
    tfields = {"stage": ["performance_id", "stage_id", "scheduled_start", "festival_id", "act_type", "setup_profile"],
               "audience": ["ticket_type", "festival_id"],
               "equipment": ["performance_id", "stage_id", "equipment_request_id", "equipment_type", "required_ready_at", "festival_id"]}
    for (p, c), evs in cases.items():
        for f in tfields[p]:
            if len({e[f] for e in evs}) != 1:
                tc_bad.append((c, f))
        if p == "stage" and evs[0]["performance_id"] != c:
            tc_bad.append((c, "case_id != performance_id"))
        if p == "equipment" and evs[0]["equipment_request_id"] != c:
            tc_bad.append((c, "case_id != equipment_request_id"))
    check("C23", "Case-constant KPI attributes single-valued (scheduled_start, required_ready_at, IDs)", not tc_bad, f"problems {tc_bad[:5]}")

    # ------------------------------------------------------------------ analysis (independent)
    AN = {p: analyze(rows, p) for p in ("stage", "audience", "equipment")}
    K = {}
    # stage KPIs
    prep, ontime, elapsed, rech, lateness, prev_late = [], [], [], [], {}, []
    shift_change, normal_ho = [], []
    by_var_prep = defaultdict(list)
    lc_skip_fail, lc_done_fail = [0, 0], [0, 0]
    ready_dev = []
    for c, evs in by_proc["stage"]:
        ho = [e for e in evs if e["activity"] == "Stage Handover"]
        sr = ts([e for e in evs if e["activity"] == "Stage Ready"][0]["timestamp"])
        S = ts(evs[0]["scheduled_start"])
        p = (sr - ts(ho[0]["timestamp"])) / 60
        prep.append(p)
        ontime.append(sr <= S)
        ready_dev.append((sr - S) / 60)
        elapsed.append((ts(evs[-1]["timestamp"]) - ts(evs[0]["timestamp"])) / 60)
        acts = [e["activity"] for e in evs if e["lifecycle"] != "start"]
        rech.append("Technical Recheck" in acts or acts.count("Technical Check") > 1)
        ps = ts([e for e in evs if e["activity"] == "Performance Start"][0]["timestamp"])
        lateness[c] = (ps - S) / 60
        by_var_prep["with Line Check" if "Line Check" in acts else "without Line Check"].append(p)
        if "Technical Troubleshooting" in acts:
            by_var_prep["with troubleshooting"].append(p)
        hod = (ts(ho[1]["timestamp"]) - ts(ho[0]["timestamp"])) / 60
        band = evs[0]["act_type"] == "band"
        if band:
            tgt = lc_done_fail if "Line Check" in acts else lc_skip_fail
            tgt[0] += 1
            tgt[1] += "Technical Troubleshooting" in acts
        ho_res = ho[0]["resource"]
        (shift_change if ho_res.endswith(" L") and c.split("-")[-1] != "01" else normal_ho).append((hod, c, ho_res))
    # shift change = first case of a stage-day handled by late crew
    sc_cases = {}
    for c, evs in sorted(by_proc["stage"]):
        key = (c.split("-")[1], evs[0]["stage_id"])
        r = [e for e in evs if e["activity"] == "Stage Handover"][0]["resource"]
        if r.endswith(" L") and key not in sc_cases:
            sc_cases[key] = c
    sc_set = set(sc_cases.values())
    ho_sc = [(ts(e2["timestamp"]) - ts(e1["timestamp"])) / 60 for c, evs in by_proc["stage"] if c in sc_set
             for e1, e2 in [[e for e in evs if e["activity"] == "Stage Handover"]]]
    ho_other = [(ts(e2["timestamp"]) - ts(e1["timestamp"])) / 60 for c, evs in by_proc["stage"] if c not in sc_set
                for e1, e2 in [[e for e in evs if e["activity"] == "Stage Handover"]]]
    seqs = defaultdict(list)
    for c, evs in by_proc["stage"]:
        seqs[(c.split("-")[1], evs[0]["stage_id"])].append(c)
    xs, ys = [], []
    for k, lst in seqs.items():
        lst.sort()
        for a1, b1 in zip(lst, lst[1:]):
            xs.append(lateness[a1])
            ys.append(lateness[b1])
    corr = st.correlation(xs, ys) if len(xs) > 2 else None
    first_slot = [lateness[sorted(l)[0]] for l in seqs.values()]
    eq_issue_cases = set()
    for c, evs in by_proc["equipment"]:
        if any(e["activity"] in ("Substitute Search", "Inspection Rework") for e in evs):
            eq_issue_cases.add(evs[0]["performance_id"])
    linked_ot = defaultdict(list)
    for c, evs in by_proc["stage"]:
        sr = ts([e for e in evs if e["activity"] == "Stage Ready"][0]["timestamp"])
        k = (evs[0]["festival_id"], c)
        grp = "no linked request" if k not in eq_ready else "linked request, no substitution/rework"
        linked_ot["equipment substituted/reworked" if c in eq_issue_cases else grp].append(sr <= ts(evs[0]["scheduled_start"]))
    K["stage"] = dict(
        cases=len(prep), prep_mean_min=st.mean(prep), prep_median_min=st.median(prep), prep_p90_min=nearest_rank(prep, 0.9),
        ready_on_time_pct=100 * sum(ontime) / len(ontime), case_elapsed_mean_min=st.mean(elapsed),
        recheck_case_rate_pct=100 * sum(rech) / len(rech),
        performance_start_delay_mean_min=st.mean(lateness.values()),
        performance_start_delay_p90_min=nearest_rank(list(lateness.values()), 0.9),
        ready_minus_scheduled_median_min=st.median(ready_dev),
        delay_propagation_corr_prev_to_next=corr, first_slot_delay_mean_min=st.mean(first_slot),
        prep_by_group={k: dict(n=len(v), mean=st.mean(v)) for k, v in by_var_prep.items()},
        band_tc_failure_rate={"line_check_done": dict(n=lc_done_fail[0], pct=100 * lc_done_fail[1] / lc_done_fail[0] if lc_done_fail[0] else None),
                              "line_check_skipped": dict(n=lc_skip_fail[0], pct=100 * lc_skip_fail[1] / lc_skip_fail[0] if lc_skip_fail[0] else None)},
        handover_shift_change=dict(n=len(ho_sc), mean_min=st.mean(ho_sc) if ho_sc else None),
        handover_other=dict(n=len(ho_other), mean_min=st.mean(ho_other)),
        ready_on_time_by_equipment_link={k: dict(n=len(v), pct=100 * sum(v) / len(v)) for k, v in linked_ot.items()},
        by_stage={s: dict(n=sum(1 for c, e in by_proc["stage"] if e[0]["stage_id"] == s),
                          ready_on_time_pct=100 * st.mean([o for (c, e), o in zip(by_proc["stage"], ontime) if e[0]["stage_id"] == s]),
                          start_delay_mean_min=st.mean([lateness[c] for c, e in by_proc["stage"] if e[0]["stage_id"] == s]))
                  for s in ("MAIN", "RIVER", "CLUB")},
    )
    # audience KPIs
    waits = [(x["s"] - x["join"]) / 60 for x in aud]
    svc = [(x["e"] - x["s"]) for x in aud]
    outcome = Counter(x["evs"][-1]["activity"] for x in aud)
    manual = sum(1 for x in aud if any(e["activity"] == "Manual Ticket Check" for e in x["evs"]))
    entry_el = [(ts(x["evs"][-1]["timestamp"]) - x["join"]) / 60 for x in aud if x["evs"][-1]["activity"] == "Entry Complete"]
    buckets = defaultdict(list)
    for x in aud:
        b = datetime.fromtimestamp(x["join"], timezone.utc).astimezone().replace(second=0)
        loc = datetime.fromisoformat(x["evs"][0]["timestamp"])
        key = f"{x['c'].split('-')[1]} {loc.strftime('%H')}:{(loc.minute // 15) * 15:02d}"
        buckets[key].append(x)
    bucket_rows = []
    for k in sorted(buckets):
        xs_ = buckets[k]
        bucket_rows.append(dict(bucket=k, arrivals=len(xs_), mean_wait_min=st.mean([(x["s"] - x["join"]) / 60 for x in xs_]),
                                max_wait_min=max((x["s"] - x["join"]) / 60 for x in xs_),
                                mean_tv_service_s=st.mean([x["e"] - x["s"] for x in xs_]),
                                reentry_share_pct=100 * sum(x["ticket"] == "re-entry" for x in xs_) / len(xs_)))
    per_day = {}
    for d in ("D1", "D2"):
        xs_ = [x for x in aud if f"-{d}-" in x["c"]]
        w = [(x["s"] - x["join"]) / 60 for x in xs_]
        per_day[d] = dict(n=len(xs_), mean_wait_min=st.mean(w), p95_wait_min=nearest_rank(w, 0.95), max_wait_min=max(w),
                          mean_tv_service_s=st.mean([x["e"] - x["s"] for x in xs_]),
                          ticket_mix={k: v for k, v in Counter(x["ticket"] for x in xs_).items()})
    by_ticket = {t: dict(n=sum(1 for x in aud if x["ticket"] == t), mean_tv_service_s=st.mean([x["e"] - x["s"] for x in aud if x["ticket"] == t]))
                 for t in ("general", "vip", "re-entry")}
    inputs = [(x["c"], x["join"], x["e"] - x["s"], x["order"]) for x in aud]
    sims = {n: engine_equivalent_queue(inputs, n) for n in (3, 4, 5)}
    sims_day = {d: {n: engine_equivalent_queue([i for i in inputs if f"-{d}-" in i[0]], n) for n in (3, 4)} for d in ("D1", "D2")}
    # structural what-if (independent model, NOT the engine): wristband holders leave the ticket station
    tick = [i for i, x in zip(inputs, aud) if x["ticket"] != "re-entry"]
    expr = []
    for i, x in zip(inputs, aud):
        if x["ticket"] == "re-entry":
            wb = [e for e in x["evs"] if e["activity"] == "Wristband Check"]
            extra = ts(wb[1]["timestamp"]) - ts(wb[0]["timestamp"]) if len(wb) == 2 else 0
            expr.append((i[0], i[1], i[2] + extra, i[3]))
    structural = {}
    for n in (3, 4):
        r1, r2 = [], []
        for d in ("D1", "D2"):
            t1 = engine_equivalent_queue([i for i in tick if f"-{d}-" in i[0]], n)
            e1 = engine_equivalent_queue([i for i in expr if f"-{d}-" in i[0]], 1)
            r1.append(t1)
            r2.append(e1)
        structural[f"{n} ticket lanes + 1 express lane"] = dict(
            ticket_station={d: dict(n=r["n"], mean_wait_min=r["mean_wait_min"], p95_wait_min=r["p95_wait_min"], max_wait_min=r["max_wait_min"]) for d, r in zip(("D1", "D2"), r1)},
            express_station={d: dict(n=r["n"], mean_wait_min=r["mean_wait_min"], p95_wait_min=r["p95_wait_min"], max_wait_min=r["max_wait_min"]) for d, r in zip(("D1", "D2"), r2)})
    staffed_lane_wait = defaultdict(list)
    K["audience"] = dict(
        attempts=len(aud), observed_queue_wait_mean_min=st.mean(waits), observed_queue_wait_p95_min=nearest_rank(waits, 0.95),
        observed_queue_wait_max_min=max(waits), tv_service_mean_s=st.mean(svc), outcomes=dict(outcome),
        rejection_rate_pct=100 * outcome["Entry Rejected"] / len(aud), manual_check_rate_pct=100 * manual / len(aud),
        entry_elapsed_mean_min=st.mean(entry_el), per_day=per_day, by_ticket=by_ticket, buckets_15min=bucket_rows,
        engine_equivalent_queue=sims, engine_equivalent_queue_by_day=sims_day, structural_what_if_independent=structural,
    )
    # equipment KPIs
    lead, ot, sub, rw, late_lead = [], [], 0, 0, []
    by_var = defaultdict(list)
    by_stage_ot = defaultdict(list)
    for c, evs in by_proc["equipment"]:
        t0 = ts(evs[0]["timestamp"])
        tr = ts([e for e in evs if e["activity"] == "Equipment Ready"][0]["timestamp"])
        req = ts(evs[0]["required_ready_at"])
        lead.append((tr - t0) / 60)
        ot.append(tr <= req)
        acts = [e["activity"] for e in evs if e["lifecycle"] != "start"]
        s_, r_ = "Substitute Search" in acts, "Inspection Rework" in acts
        sub += s_
        rw += r_
        by_var["substituted" if s_ else ("inspection rework" if r_ else "normal")].append(((tr - t0) / 60, tr <= req))
        late_lead.append(((req - t0) / 60, tr <= req))
        by_stage_ot[evs[0]["stage_id"]].append(tr <= req)
    short = [o for l, o in late_lead if l < 120]
    longl = [o for l, o in late_lead if l >= 120]
    K["equipment"] = dict(
        requests=len(lead), lead_time_mean_min=st.mean(lead), lead_time_p90_min=nearest_rank(lead, 0.9),
        on_time_pct=100 * sum(ot) / len(ot), substitution_rate_pct=100 * sub / len(lead), inspection_rework_rate_pct=100 * rw / len(lead),
        by_variant={k: dict(n=len(v), lead_mean_min=st.mean([a for a, b in v]), on_time_pct=100 * st.mean([b for a, b in v])) for k, v in by_var.items()},
        on_time_by_request_notice={"< 120 min before required_ready_at": dict(n=len(short), pct=100 * st.mean(short) if short else None),
                                   ">= 120 min": dict(n=len(longl), pct=100 * st.mean(longl) if longl else None)},
        on_time_by_stage={k: dict(n=len(v), pct=100 * st.mean(v)) for k, v in by_stage_ot.items()},
        linked_performances=len(eq_ready),
    )
    # workload / utilization with shifts (independent; engine does not ingest shifts)
    busy = defaultdict(float)
    count = Counter()
    for rid, iv in intervals.items():
        for a0, b0, _, _ in iv:
            busy[rid] += (b0 - a0) / 3600
            count[rid] += 1
    shift_h = {rid: sum((b0 - a0) / 3600 for a0, b0 in s) for rid, s in shifts.items()}
    role_of = {r["resource_id"]: (r["resource_role"], r["process_type"]) for r in rows if r["resource_id"]}
    util = defaultdict(lambda: [0.0, 0.0, 0])
    for rid, (role, proc) in role_of.items():
        u = util[(proc, role)]
        u[0] += busy[rid]
        u[1] += shift_h[rid]
        u[2] += 1
    K["utilization_independent"] = [dict(process=p, role=r, people=v[2], busy_h=v[0], shift_h=v[1], utilization_pct=100 * v[0] / v[1])
                                    for (p, r), v in sorted(util.items())]

    results = dict(checks=RESULTS, analytics=AN, kpis=K, xes_guard=g, bpmn=binfo, generator=manifest["generator"],
                   completion_activities=COMPLETION)
    out_dir = os.path.join(root, "reports", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "validation_results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=lambda o: list(o) if isinstance(o, tuple) else str(o))
    write_report(os.path.join(out_dir, "festival-data-validation.md"), results)
    fails = [k for k, v in RESULTS.items() if v["status"] == "FAIL"]
    for k, v in RESULTS.items():
        print(f"{k} {v['status']:<8} {v['title']}")
    print("FAILED:", fails if fails else "none")
    sys.exit(1 if fails else 0)


def f2(x, nd=2):
    return "N/A" if x is None else f"{x:.{nd}f}"


def write_report(path, R):
    K = R["kpis"]
    L = []
    w = L.append
    w("# Festival data validation (independent)\n")
    w("> Auto-generated by `scripts/festival/validate_festival_logs.py`. Every value below comes from an **independent "
      "Python re-implementation** of the documented rules. The ProcessPilot engine (`importXes`, `getKPIs`, "
      "`simulateGateQueue`, …) was **not executed** in this environment, so none of these numbers is an engine result.\n")
    w(f"Generator {R['generator']['version']}, seed {R['generator']['seed']}.\n")
    w("## 1. Checks\n")
    w("| ID | Check | Status | Evidence |\n|---|---|---|---|")
    for k, v in R["checks"].items():
        w(f"| {k} | {v['title']} | **{v['status']}** | {v['detail'].replace('|', '/')} |")
    w("\n### Not testable here\n")
    w("| Item | Status | Why |\n|---|---|---|")
    for item, why in [
        ("ProcessPilot `importXes` acceptance of the XES files", "NOT TESTABLE — engine slice not available in this workspace; §3A rules emulated in C14–C17, C21–C22"),
        ("ProcessPilot CSV upload / Festival sample load with this manifest", "NOT TESTABLE — repository not run; manifest keys checked against `adapter.ts parseManifest` (C20)"),
        ("bpmn-js rendering of the four BPMN files", "NOT TESTABLE — bpmn-js not installable offline; DI structure checked (C18), static previews in `reports/evidence/bpmn-preview/`"),
        ("`getBpmnComparison` mapping/adjacency on these models", "NOT TESTABLE — v0.3 runtime slice pending; structure pre-check in C19"),
        ("Replay, throughput, drift, pattern APIs (v0.3 P0-B)", "NOT TESTABLE — not implemented at checkpoint 0aa8887"),
        ("KGU Process Mining Tool / ProM import of the XES", "NOT VERIFIED — no external tool was run"),
        ("Shift-based utilization inside ProcessPilot", "NOT SUPPORTED by current engine (I-9 deferred); independent figures only (§2.4)"),
    ]:
        head, _, tail = why.partition(' — ')
        w(f"| {item} | {head} | {tail} |")
    w("\n## 2. Independent analysis results (computed post hoc from the generated log)\n")
    S = K["stage"]
    w("### 2.1 Stage & Technical Operations\n")
    w(f"- Cases {S['cases']}; preparation (first Stage Handover start → Stage Ready) mean {f2(S['prep_mean_min'], 1)} min, "
      f"median {f2(S['prep_median_min'], 1)}, p90 {f2(S['prep_p90_min'], 1)}; full case elapsed mean {f2(S['case_elapsed_mean_min'], 1)} min (includes the performance itself).")
    w(f"- Stage Ready ≤ scheduled_start: **{f2(S['ready_on_time_pct'], 1)}%**; Performance Start delay mean {f2(S['performance_start_delay_mean_min'], 1)} min, p90 {f2(S['performance_start_delay_p90_min'], 1)} min.")
    w(f"- Technical recheck case rate {f2(S['recheck_case_rate_pct'], 1)}%; repeated-activity case rate {f2(R['analytics']['stage']['repeated_case_rate_pct'], 1)}%.")
    w(f"- Start-delay correlation between consecutive performances on the same stage-day: r = {f2(S['delay_propagation_corr_prev_to_next'], 2)} (association, not causation). First slot of each stage-day: mean delay {f2(S['first_slot_delay_mean_min'], 1)} min.")
    w(f"- Stage Handover at the late-crew takeover: mean {f2(S['handover_shift_change']['mean_min'], 1)} min (n={S['handover_shift_change']['n']}) vs other handovers {f2(S['handover_other']['mean_min'], 1)} min (n={S['handover_other']['n']}).")
    w("- Band acts — Technical Check needed troubleshooting: " + ", ".join(f"{k} {f2(v['pct'], 1)}% (n={v['n']})" for k, v in S["band_tc_failure_rate"].items()))
    w("- Preparation by group: " + "; ".join(f"{k}: {f2(v['mean'], 1)} min (n={v['n']})" for k, v in S["prep_by_group"].items()))
    w("- Ready on time by equipment link: " + "; ".join(f"{k}: {f2(v['pct'], 1)}% (n={v['n']})" for k, v in S["ready_on_time_by_equipment_link"].items()))
    w("- By stage: " + "; ".join(f"{k}: ready on time {f2(v['ready_on_time_pct'], 1)}%, start delay {f2(v['start_delay_mean_min'], 1)} min (n={v['n']})" for k, v in S["by_stage"].items()))
    A = K["audience"]
    w("\n### 2.2 Audience Entry\n")
    w(f"- Attempts {A['attempts']}; outcomes {A['outcomes']}; rejection {f2(A['rejection_rate_pct'], 1)}%; manual ticket check {f2(A['manual_check_rate_pct'], 1)}%.")
    w(f"- Observed queue wait (Join Entry Queue → Ticket Verification start): mean {f2(A['observed_queue_wait_mean_min'])} min, p95 {f2(A['observed_queue_wait_p95_min'])}, max {f2(A['observed_queue_wait_max_min'])}. Ticket Verification service mean {f2(A['tv_service_mean_s'], 1)} s. Entry elapsed (admitted) mean {f2(A['entry_elapsed_mean_min'])} min.")
    w("- Per day: " + "; ".join(f"{d}: n={v['n']}, mean wait {f2(v['mean_wait_min'])} min, p95 {f2(v['p95_wait_min'])}, max {f2(v['max_wait_min'])}, mean service {f2(v['mean_tv_service_s'], 1)} s, mix {v['ticket_mix']}" for d, v in A["per_day"].items()))
    w("- Ticket Verification service by ticket type: " + "; ".join(f"{k} {f2(v['mean_tv_service_s'], 1)} s (n={v['n']})" for k, v in A["by_ticket"].items()))
    w("\n15-minute arrival buckets (local time):\n")
    w("| Bucket | Arrivals | Mean wait (min) | Max wait (min) | Mean TV service (s) | Re-entry share |\n|---|---|---|---|---|---|")
    for b in A["buckets_15min"]:
        w(f"| {b['bucket']} | {b['arrivals']} | {f2(b['mean_wait_min'])} | {f2(b['max_wait_min'])} | {f2(b['mean_tv_service_s'], 1)} | {f2(b['reentry_share_pct'], 0)}% |")
    w("\n**Engine-equivalent pooled FCFS what-if** (independent code mirroring `simulateGateQueue`: arrival = Join Entry Queue, service = observed Ticket Verification duration, identical servers, same vector for every run; the log's 6–15 s walking time is inside the observed wait but not in the model):\n")
    w("| Servers | n | Mean wait (min) | p95 (min) | Max (min) | Finish elapsed (min) | Throughput (/h) |\n|---|---|---|---|---|---|---|")
    for n, r in A["engine_equivalent_queue"].items():
        w(f"| {n} | {r['n']} | {f2(r['mean_wait_min'])} | {f2(r['p95_wait_min'])} | {f2(r['max_wait_min'])} | {f2(r['finish_elapsed_min'], 1)} | {f2(r['throughput_per_hour'], 1)} |")
    w("\nThe whole-log run spans two days, so finish elapsed and throughput are dominated by the overnight gap; use the per-day rows below for capacity reading.\n")
    w("| Day | Servers | Mean wait (min) | p95 (min) | Max (min) | Throughput (/h) |\n|---|---|---|---|---|---|")
    for d, rr in A["engine_equivalent_queue_by_day"].items():
        for n, r in rr.items():
            w(f"| {d} | {n} | {f2(r['mean_wait_min'])} | {f2(r['p95_wait_min'])} | {f2(r['max_wait_min'])} | {f2(r['throughput_per_hour'], 1)} |")
    w("\n**Structural what-if (independent model, NOT available in the engine):** re-entry/multi-day wristband holders use one express lane (service = their observed wristband scan + Wristband Check); all others use the ticket lanes.\n")
    w("| Scenario | Day | Ticket station mean / p95 / max wait (min) | Express station mean / p95 / max (min) |\n|---|---|---|---|")
    for sc, v in A["structural_what_if_independent"].items():
        for d in ("D1", "D2"):
            t, e = v["ticket_station"][d], v["express_station"][d]
            w(f"| {sc} | {d} | {f2(t['mean_wait_min'])} / {f2(t['p95_wait_min'])} / {f2(t['max_wait_min'])} (n={t['n']}) | {f2(e['mean_wait_min'])} / {f2(e['p95_wait_min'])} / {f2(e['max_wait_min'])} (n={e['n']}) |")
    E = K["equipment"]
    w("\n### 2.3 Equipment & Technical Readiness\n")
    w(f"- Requests {E['requests']} linked to {E['linked_performances']} performances; lead time mean {f2(E['lead_time_mean_min'], 1)} min, p90 {f2(E['lead_time_p90_min'], 1)}; on time (≤ required_ready_at) **{f2(E['on_time_pct'], 1)}%**; substitution {f2(E['substitution_rate_pct'], 1)}%; inspection rework {f2(E['inspection_rework_rate_pct'], 1)}%.")
    w("- By variant: " + "; ".join(f"{k}: lead {f2(v['lead_mean_min'], 1)} min, on time {f2(v['on_time_pct'], 1)}% (n={v['n']})" for k, v in E["by_variant"].items()))
    w("- By request notice: " + "; ".join(f"{k}: on time {f2(v['pct'], 1)}% (n={v['n']})" for k, v in E["on_time_by_request_notice"].items()))
    w("\n### 2.4 Resource utilization with shifts (independent; ProcessPilot does not ingest shifts yet)\n")
    w("| Process | Role | People | Busy h (matched intervals) | Shift h | Utilization |\n|---|---|---|---|---|---|")
    for u in K["utilization_independent"]:
        w(f"| {u['process']} | {u['role']} | {u['people']} | {f2(u['busy_h'], 1)} | {f2(u['shift_h'], 1)} | {f2(u['utilization_pct'], 1)}% |")
    w("\nStart/complete markers (Stage Ready, Performance Start/End, Equipment Requested/Ready) have no duration and add no busy time.\n")
    w("\n### 2.5 Discovery summaries\n")
    for p in ("stage", "audience", "equipment"):
        an = R["analytics"][p]
        w(f"**{p}** — cases {an['cases']}, raw events {an['events']}, discovery events {an['discovery_events']}, variants {len(an['variants'])}, "
          f"direct handoffs {an['handoffs_total']}.\n")
        w("| Variant share | Count | Sequence |\n|---|---|---|")
        for v in an["variants"][:6]:
            w(f"| {100 * v['share']:.1f}% | {v['count']} | {' → '.join(v['sequence'])} |")
        w("\nTop handoffs (resource → resource, adjacent discovery events, distinct known resource_id):\n")
        w("| From | To | Count |\n|---|---|---|")
        for h in an["handoffs_top"][:8]:
            w(f"| {h['source']} | {h['target']} | {h['count']} |")
        w("")
    w("## 3. Completion activities (for Replay / generic throughput)\n")
    for p, acts in R["completion_activities"].items():
        w(f"- `{p}`: {', '.join(acts)}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
