/** Mode-specific panels for the Process Explorer (variants, rework, patterns, replay). */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DFG, Variant } from '../../contracts';
import type { EventWindow, ReplayFrame, ReplayIndex } from '../../v03-contracts';
import { callEngine, hasCapability } from '../../adapters/engineAdapter';
import { useAnalysis } from '../../state/analysis';
import { useWorkspace } from '../../state/store';
import { fmtInstant, fmtNumber, fmtShare, plural } from '../../lib/format';
import { Icon } from '../../components/icons';
import { Badge, Button, EngineGate, InfoTip, Meter, Metric, SectionLabel, Select, Unavailable, cx } from '../../components/ui';
import { CaseList, findingRule } from './inspector';
import { edgesHighlight, type Highlight } from './graphs';

/* ------------------------------ Variants ------------------------------ */

export function VariantList({ variants, selected, onSelect }: { variants: Variant[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const sorted = useMemo(() => [...variants].sort((a, b) => b.count - a.count), [variants]);
  const max = sorted[0]?.count ?? 1;
  let cum = 0;
  return (
    <div className="pp-scroll flex w-64 shrink-0 flex-col overflow-auto border-r border-slate-100 bg-white">
      <div className="sticky top-0 z-[1] border-b border-slate-100 bg-white px-3 py-2">
        <div className="text-[12.5px] font-semibold text-slate-800">{plural(variants.length, 'variant')}</div>
        <div className="text-[11px] text-slate-500">Share of cases with at least one step</div>
      </div>
      <ul className="p-1.5">
        {sorted.map((v, i) => {
          cum += v.share;
          const isSel = v.id === selected;
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(isSel ? null : v.id)}
                aria-pressed={isSel}
                className={cx('mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition', isSel ? 'border-brand-400 bg-brand-50' : 'border-transparent hover:bg-slate-50')}
              >
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="font-semibold text-slate-800">
                    {i === 0 ? 'Main path' : `Variant ${i + 1}`}
                  </span>
                  <span className="tabular text-slate-600">{fmtShare(v.share)}</span>
                </div>
                <Meter value={v.count} max={max} className="mt-1" tone={i === 0 ? 'brand' : 'slate'} />
                <div className="mt-1 text-[11px] text-slate-500 tabular">
                  {plural(v.count, 'case')} · {v.activities.length} steps · cumulative {fmtShare(Math.min(1, cum))}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{v.activities.join(' → ')}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------ Rework ------------------------------ */

export function ReworkPanel({ dfg, onPick, onSelectActivity }: { dfg: DFG | null; onPick: (k: string) => void; onSelectActivity: (a: string) => void }) {
  const { activityEvidence, findings } = useAnalysis();
  const loops = dfg?.edges.filter((e) => e.from === e.to) ?? [];
  const reworkFinding = findings?.status === 'ok' ? findings.data.find((f) => findingRule(f) === 'rework') : undefined;
  if (activityEvidence?.status === 'ok') {
    const ae = activityEvidence.data;
    const rows = ae.activities.filter((x) => x.extraOccurrenceCount > 0).sort((a, b) => b.extraOccurrenceCount - a.extraOccurrenceCount);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Metric label="Cases repeating a step" value={ae.repeatRatePct === null ? 'N/A' : `${fmtNumber(ae.repeatRatePct, 1)}%`} sub={`${ae.repeatedCaseKeys.length} of ${ae.discoveredCases}`} />
          <Metric label="Extra repeats" value={ae.extraOccurrenceCount} />
          <Metric label="Activities" value={rows.length} sub="with repeats" />
        </div>
        <p className="text-[11.5px] leading-relaxed text-slate-500">
          A repeat is the same activity recorded more than once in a case (adjacent or not). Each extra occurrence counts once. Repeats are not automatically errors.
        </p>
        {rows.length ? (
          <div>
            <SectionLabel>Repeated activities</SectionLabel>
            <ul className="space-y-1">
              {rows.map((x) => (
                <li key={x.activity}>
                  <button type="button" onClick={() => onSelectActivity(x.activity)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:border-amber-300 hover:bg-amber-50/40">
                    <div className="flex justify-between gap-2 text-[13px]">
                      <span className="font-medium text-slate-800">{x.activity}</span>
                      <Badge tone="amber">+{x.extraOccurrenceCount}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-500 tabular">{plural(x.repeatedCaseKeys.length, 'case')} · {x.occurrenceCount} occurrences in total</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">No activity is repeated within a case in this scope.</p>
        )}
        <CaseList caseKeys={ae.repeatedCaseKeys} onPick={onPick} label="Cases with a repeated step" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <EngineGate result={activityEvidence}>{() => null}</EngineGate>
      <div>
        <SectionLabel right={<InfoTip>Shown from the process map: an arrow from an activity back to itself means it was recorded twice in a row.</InfoTip>}>Immediate repeats on the map</SectionLabel>
        {loops.length ? (
          <ul className="space-y-1">
            {loops.map((e) => (
              <li key={e.from} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[13px]">
                <div className="flex justify-between"><span>{e.from} → {e.from}</span><span className="tabular text-slate-500">{e.count}×</span></div>
                <div className="text-[11px] text-slate-500">{plural(e.caseKeys.length, 'case')}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">No activity follows itself directly in this scope.</p>
        )}
      </div>
      {reworkFinding && (
        <div>
          <SectionLabel>Engine finding</SectionLabel>
          <p className="text-[13px] text-slate-700">{reworkFinding.text}</p>
          <div className="mt-2"><CaseList caseKeys={reworkFinding.caseKeys} onPick={onPick} /></div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Patterns ------------------------------ */

export function PatternsPanel({ onHighlight, onPick }: { onHighlight: (h: Highlight | null) => void; onPick: (k: string) => void }) {
  const { api, selectedTraces } = useAnalysis();
  const result = useMemo(() => callEngine(api, 'getPatternEvidence', selectedTraces), [api, selectedTraces]);
  const [active, setActive] = useState<string | null>(null);
  const [cases, setCases] = useState<string[] | null>(null);
  const pick = (key: string, h: Highlight, keys: string[]) => {
    if (active === key) {
      setActive(null);
      setCases(null);
      onHighlight(null);
      return;
    }
    setActive(key);
    setCases(keys);
    onHighlight(h);
  };
  return (
    <EngineGate result={result}>
      {(p) => (
        <div className="space-y-4">
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            ICN-inspired evidence from the recorded order. Alternatives and overlaps are candidates: they do not prove an XOR/AND gateway or a dependency.
          </p>
          <PatternSection title="Candidate alternatives" hint="An activity followed by two or more different next steps." empty="No activity has more than one next step.">
            {p.divergences.map((d) => (
              <PatternItem key={`d:${d.from}`} active={active === `d:${d.from}`} onClick={() => pick(`d:${d.from}`, edgesHighlight(d.alternatives), d.caseKeys)}>
                <div className="font-medium">{d.from} → {d.alternatives.length} options</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {d.alternatives.map((x) => <Badge key={x.to}>{x.to} · {fmtShare(x.count / d.outgoingCount)}</Badge>)}
                </div>
              </PatternItem>
            ))}
          </PatternSection>
          <PatternSection title="Loops" hint="Self-loops (A→A) and short loops (A→B→A)." empty="No loops observed.">
            {p.selfLoops.map((e) => (
              <PatternItem key={`s:${e.from}`} active={active === `s:${e.from}`} onClick={() => pick(`s:${e.from}`, edgesHighlight([e]), e.caseKeys)}>
                <span className="font-medium">{e.from} → {e.from}</span> <span className="text-slate-500 tabular">{e.count}×</span>
              </PatternItem>
            ))}
            {p.shortLoops.map((l) => (
              <PatternItem key={`l:${l.outer}:${l.via}`} active={active === `l:${l.outer}:${l.via}`} onClick={() => pick(`l:${l.outer}:${l.via}`, edgesHighlight([{ from: l.outer, to: l.via }, { from: l.via, to: l.outer }]), l.caseKeys)}>
                <span className="font-medium">{l.outer} → {l.via} → {l.outer}</span> <span className="text-slate-500 tabular">{l.count}×</span>
              </PatternItem>
            ))}
          </PatternSection>
          <PatternSection title="Overlapping activities" hint={`Two different activities active at the same time in a case (matched start/complete). ${p.matchedPairs} matched, ${p.ambiguousPairs} ambiguous pairs.`} empty="No overlapping matched intervals.">
            {p.overlaps.map((o) => {
              const k = `o:${o.activities.join('|')}`;
              return (
                <PatternItem key={k} active={active === k} onClick={() => pick(k, edgesHighlight([], o.activities), o.cases.map((c) => c.caseKey))}>
                  <span className="font-medium">{o.activities[0]} ∥ {o.activities[1]}</span> <span className="text-slate-500 tabular">{o.count}× · {plural(o.cases.length, 'case')}</span>
                </PatternItem>
              );
            })}
          </PatternSection>
          <PatternSection title="Observed sequences" hint="Direct successions, most frequent first." empty="No sequences.">
            {[...p.sequences].sort((a, b) => b.count - a.count).slice(0, 12).map((e) => (
              <PatternItem key={`q:${e.from}>${e.to}`} active={active === `q:${e.from}>${e.to}`} onClick={() => pick(`q:${e.from}>${e.to}`, edgesHighlight([e]), e.caseKeys)}>
                <span>{e.from} → {e.to}</span> <span className="text-slate-500 tabular">{e.count}×</span>
              </PatternItem>
            ))}
          </PatternSection>
          {cases && <CaseList caseKeys={cases} onPick={onPick} />}
        </div>
      )}
    </EngineGate>
  );
}

function PatternSection({ title, hint, empty, children }: { title: string; hint: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div>
      <SectionLabel right={<InfoTip>{hint}</InfoTip>}>{title}</SectionLabel>
      {items.length ? <ul className="space-y-1">{children}</ul> : <p className="text-[12.5px] text-slate-500">{empty}</p>}
    </div>
  );
}

function PatternItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-pressed={active} className={cx('w-full rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition', active ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
        {children}
      </button>
    </li>
  );
}

/* ------------------------------ Replay ------------------------------ */

const SPEEDS = [
  { id: 1, label: '1 min/s' },
  { id: 10, label: '10 min/s' },
  { id: 60, label: '1 h/s' },
  { id: 360, label: '6 h/s' },
  { id: 1440, label: '1 day/s' },
];

/**
 * Replay control bar. The engine builds the index (once per scope) and answers
 * each frame query; the UI only owns play/pause/speed/scrub and the window.
 */
export function ReplayBar({ variants, onFrame }: { variants: Variant[]; onFrame: (f: ReplayFrame | null) => void }) {
  const { api, selectedTraces } = useAnalysis();
  const ws = useWorkspace();
  const completion = ws?.completionActivities?.length ? { completionActivities: ws.completionActivities } : undefined;
  const available = hasCapability(api, 'buildReplayIndex') && hasCapability(api, 'getReplayFrame');
  const index = useMemo(
    () => (available ? callEngine(api, 'buildReplayIndex', selectedTraces, completion) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, available, selectedTraces, completion?.completionActivities.join('\u0000')],
  );
  const idx: ReplayIndex | null = index?.status === 'ok' ? index.data : null;
  const obs = idx?.observationWindow ?? null;
  const [win, setWin] = useState<EventWindow | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [variant, setVariant] = useState<string>('all');

  useEffect(() => {
    setWin(obs);
    setCursor(obs ? obs.startMs : null);
    setPlaying(false);
  }, [obs?.startMs, obs?.endMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useMemo(() => {
    if (!idx || !win || cursor === null) return null;
    return callEngine(api, 'getReplayFrame', idx, { window: win, cursorMs: Math.min(Math.max(cursor, win.startMs), win.endMs - 1), variantIds: variant === 'all' ? undefined : [variant] });
  }, [api, idx, win, cursor, variant]);

  useEffect(() => {
    onFrame(frame?.status === 'ok' ? frame.data : null);
  }, [frame, onFrame]);
  useEffect(() => () => onFrame(null), [onFrame]);

  // Interval with real elapsed time: keeps advancing even when the tab is throttled (rAF pauses in background tabs).
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing || !win) return;
    let last = performance.now();
    timer.current = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      setCursor((c) => Math.min((c ?? win.startMs) + dt * speed * 60_000, win.endMs - 1));
    }, 100);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, win]);
  useEffect(() => {
    if (playing && win && cursor !== null && cursor >= win.endMs - 1) setPlaying(false);
  }, [playing, win, cursor]);

  if (!available) {
    return (
      <div className="border-t border-slate-100 p-3">
        <Unavailable fn="buildReplayIndex" title="Event Log Replay is not available in this build" />
      </div>
    );
  }
  if (index && index.status !== 'ok') return <div className="border-t border-slate-100 p-3"><EngineGate result={index}>{() => null}</EngineGate></div>;
  if (!idx || !obs || !win || cursor === null) {
    return <div className="border-t border-slate-100 p-3 text-[13px] text-slate-500">No recorded events to replay in this scope.</div>;
  }
  const toLocal = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const setWindowPart = (part: 'startMs' | 'endMs', value: string) => {
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return;
    const next = { ...win, [part]: ms };
    if (next.endMs <= next.startMs) return;
    setWin(next);
    setCursor((c) => Math.min(Math.max(c ?? next.startMs, next.startMs), next.endMs - 1));
  };
  return (
    <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" icon={playing ? 'pause' : 'play'} onClick={() => {
          if (!playing && cursor >= win.endMs - 1) setCursor(win.startMs);
          setPlaying((p) => !p);
        }}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="ghost" icon="rewind" onClick={() => { setPlaying(false); setCursor(win.startMs); }} aria-label="Back to start" />
        <input
          type="range"
          min={win.startMs}
          max={win.endMs - 1}
          step={1000}
          value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
          className="min-w-[200px] flex-1 accent-brand-600"
          aria-label="Replay time"
        />
        <span className="min-w-[180px] text-right text-[12.5px] font-semibold text-slate-800 tabular">{fmtInstant(cursor)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <label className="flex items-center gap-1.5">Speed
          <Select className="!w-auto !py-0.5 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-1.5">Variant
          <Select className="!w-auto max-w-[200px] !py-0.5 text-xs" value={variant} onChange={(e) => setVariant(e.target.value)}>
            <option value="all">All cases</option>
            {[...variants].sort((a, b) => b.count - a.count).map((v, i) => <option key={v.id} value={v.id}>{i === 0 ? 'Main path' : `Variant ${i + 1}`} ({v.count})</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-1.5">From
          <input type="datetime-local" className="rounded-md border border-slate-300 px-1.5 py-0.5" value={toLocal(win.startMs)} onChange={(e) => setWindowPart('startMs', e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5">to
          <input type="datetime-local" className="rounded-md border border-slate-300 px-1.5 py-0.5" value={toLocal(win.endMs)} onChange={(e) => setWindowPart('endMs', e.target.value)} />
        </label>
        {frame?.status === 'ok' && (
          <span className="ml-auto flex items-center gap-2 tabular">
            <span className="inline-flex items-center gap-1"><Icon name="play" className="h-3 w-3 text-brand-600" />{frame.data.counts.active} active</span>
            <span>{frame.data.counts.latest_observation + frame.data.counts.last_observation} at a step</span>
            <span className="text-emerald-700">{frame.data.counts.completed} completed</span>
            <span className="text-slate-400">{frame.data.counts.not_yet_observed} not started</span>
          </span>
        )}
      </div>
      {!completion && <p className="text-[11px] text-slate-400">“Completed” needs a completion activity (set it in Monitor). Without it, cases end at their last recorded step.</p>}
      {frame && frame.status !== 'ok' && <EngineGate result={frame}>{() => null}</EngineGate>}
    </div>
  );
}
