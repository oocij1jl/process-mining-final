#!/usr/bin/env python3
"""
render_bpmn_preview.py — draw a static SVG preview of each BPMN file from its own DI (BPMNShape/BPMNEdge).

This is a layout check and a report figure helper, NOT a bpmn-js rendering. Standard library only.
Usage: python3 render_bpmn_preview.py [--bpmn-dir ../public/bpmn] [--out ../reports/evidence/bpmn-preview]
"""
import argparse
import os
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL", "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
      "dc": "http://www.omg.org/spec/DD/20100524/DC", "di": "http://www.omg.org/spec/DD/20100524/DI"}


def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def render(path, out_svg):
    root = ET.parse(path).getroot()
    elems = {}
    for el in root.iter():
        if el.get("id"):
            elems[el.get("id")] = el
    shapes, edges = [], []
    for sh in root.iter(f"{{{NS['bpmndi']}}}BPMNShape"):
        b = sh.find("dc:Bounds", NS)
        shapes.append((sh.get("bpmnElement"), *(float(b.get(k)) for k in ("x", "y", "width", "height"))))
    for ed in root.iter(f"{{{NS['bpmndi']}}}BPMNEdge"):
        pts = [(float(w.get("x")), float(w.get("y"))) for w in ed.findall("di:waypoint", NS)]
        edges.append((ed.get("bpmnElement"), pts))
    maxx = max(x + w for _, x, y, w, h in shapes) + 40
    maxy = max(y + h for _, x, y, w, h in shapes) + 60
    S = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{maxx:.0f}" height="{maxy:.0f}" font-family="Arial" font-size="12">',
         '<rect width="100%" height="100%" fill="white"/>',
         '<defs><marker id="a" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">'
         '<path d="M0,0 L10,5 L0,10 z" fill="#222"/></marker>'
         '<marker id="m" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">'
         '<path d="M0,0 L10,5 L0,10 z" fill="white" stroke="#555"/></marker></defs>']
    order = {"participant": 0, "lane": 1}
    shapes.sort(key=lambda s: order.get(elems[s[0]].tag.split("}")[1], 2))
    for eid, x, y, w, h in shapes:
        el = elems[eid]
        tag = el.tag.split("}")[1]
        name = el.get("name", "")
        if tag == "participant":
            S.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#333" stroke-width="1.5"/>')
            S.append(f'<line x1="{x + 30}" y1="{y}" x2="{x + 30}" y2="{y + h}" stroke="#333"/>' if el.get("processRef") else "")
            S.append(f'<text x="{x + 18}" y="{y + h / 2}" transform="rotate(-90 {x + 18} {y + h / 2})" text-anchor="middle" font-weight="bold">{escape(name)}</text>'
                     if el.get("processRef") else f'<text x="{x + w / 2}" y="{y + 35}" text-anchor="middle" font-weight="bold">{escape(name)}</text>')
        elif tag == "lane":
            S.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#999"/>')
            S.append(f'<text x="{x + 16}" y="{y + h / 2}" transform="rotate(-90 {x + 16} {y + h / 2})" text-anchor="middle">{escape(name)}</text>')
        elif tag.endswith("Task"):
            S.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#eef4ff" stroke="#1d4ed8" stroke-width="1.5"/>')
            S.append(f'<text x="{x + 6}" y="{y + 13}" font-size="9" fill="#555">{tag.replace("Task", "")}</text>')
            for i, line in enumerate(wrap(name, 18)):
                S.append(f'<text x="{x + w / 2}" y="{y + h / 2 + 4 + (i - (len(wrap(name, 18)) - 1) / 2) * 14}" text-anchor="middle">{escape(line)}</text>')
        elif tag.endswith("Gateway"):
            cx, cy = x + w / 2, y + h / 2
            S.append(f'<polygon points="{cx},{y} {x + w},{cy} {cx},{y + h} {x},{cy}" fill="#fff7e6" stroke="#b45309" stroke-width="1.5"/>')
            S.append(f'<text x="{cx}" y="{cy + 5}" text-anchor="middle" font-weight="bold">X</text>')
            for i, line in enumerate(wrap(name, 22)):
                S.append(f'<text x="{cx}" y="{y - 22 + i * 13}" text-anchor="middle" font-size="11">{escape(line)}</text>')
        elif tag.endswith("Event"):
            cx, cy = x + w / 2, y + h / 2
            sw = 3 if tag == "endEvent" else 1.5
            S.append(f'<circle cx="{cx}" cy="{cy}" r="{w / 2}" fill="white" stroke="#15803d" stroke-width="{sw}"/>')
            for i, line in enumerate(wrap(name, 18)):
                S.append(f'<text x="{cx}" y="{y + h + 14 + i * 13}" text-anchor="middle" font-size="11">{escape(line)}</text>')
        elif tag == "dataObjectReference":
            S.append(f'<path d="M{x},{y} h{w - 10} l10,10 v{h - 10} h-{w} z" fill="white" stroke="#555"/>')
            for i, line in enumerate(wrap(name, 20)):
                S.append(f'<text x="{x + w / 2}" y="{y + h + 13 + i * 12}" text-anchor="middle" font-size="10">{escape(line)}</text>')
        elif tag == "textAnnotation":
            text = el.find("bpmn:text", NS).text or ""
            S.append(f'<path d="M{x + 12},{y} h-12 v{h} h12" fill="none" stroke="#555"/>')
            for i, line in enumerate(wrap(text, int(w / 6.2))):
                S.append(f'<text x="{x + 6}" y="{y + 13 + i * 12}" font-size="10" fill="#333">{escape(line)}</text>')
    for eid, pts in edges:
        tag = elems[eid].tag.split("}")[1]
        d = " ".join(f"{x},{y}" for x, y in pts)
        if tag == "sequenceFlow":
            S.append(f'<polyline points="{d}" fill="none" stroke="#222" stroke-width="1.3" marker-end="url(#a)"/>')
            name = elems[eid].get("name")
            if name:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                S.append(f'<text x="{(x1 + x2) / 2 + 4}" y="{(y1 + y2) / 2 - 4}" font-size="10" fill="#7c2d12">{escape(name)}</text>')
        elif tag == "messageFlow":
            S.append(f'<polyline points="{d}" fill="none" stroke="#555" stroke-dasharray="6,4" marker-end="url(#m)"/>')
            (x1, y1) = pts[0]
            S.append(f'<text x="{x1 + 6}" y="{(pts[0][1] + pts[-1][1]) / 2}" font-size="10" fill="#555">{escape(elems[eid].get("name", ""))}</text>')
        else:
            S.append(f'<polyline points="{d}" fill="none" stroke="#777" stroke-dasharray="2,3"/>')
    S.append("</svg>")
    with open(out_svg, "w", encoding="utf-8") as f:
        f.write("\n".join(s for s in S if s))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--bpmn-dir", default=os.path.join(here, "..", "..", "public", "bpmn"))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "reports", "evidence", "bpmn-preview"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for f in sorted(os.listdir(a.bpmn_dir)):
        if f.endswith(".bpmn"):
            render(os.path.join(a.bpmn_dir, f), os.path.join(a.out, f.replace(".bpmn", ".svg")))
            print("preview", f)


if __name__ == "__main__":
    main()
