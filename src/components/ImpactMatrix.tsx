/**
 * Impact–difficulty matrix from USER ratings (1–5). Levels 4–5 are high, 1–3 low
 * (V03_CONTRACT §4). The risk gate overrides priority. No optimisation is
 * implied: the order is the user's decision.
 */
import { Badge, cx } from './ui';

export interface MatrixItem {
  id: string;
  label: string;
  impact: number | null;
  difficulty: number | null;
  review: boolean;
  sub?: string;
}

export type Quadrant = 'quick_win' | 'major' | 'fill_in' | 'reconsider';
export const QUADRANT_LABEL: Record<Quadrant, string> = {
  quick_win: 'Quick win',
  major: 'Major project',
  fill_in: 'Fill-in',
  reconsider: 'Reconsider',
};

export function quadrant(impact: number | null, difficulty: number | null): Quadrant | null {
  if (impact === null || difficulty === null) return null;
  const hi = impact >= 4;
  const hd = difficulty >= 4;
  return hi && !hd ? 'quick_win' : hi && hd ? 'major' : !hi && !hd ? 'fill_in' : 'reconsider';
}

export function ImpactMatrix({ items, selected, onSelect }: { items: MatrixItem[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const rated = items.filter((i) => i.impact !== null && i.difficulty !== null);
  const cell = (q: Quadrant) => rated.filter((i) => quadrant(i.impact, i.difficulty) === q);
  const box = (q: Quadrant, tone: string) => (
    <div className={cx('min-h-[110px] rounded-lg p-2', tone)}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{QUADRANT_LABEL[q]}</div>
      <div className="flex flex-wrap gap-1">
        {cell(q).map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onSelect?.(i.id)}
            className={cx('rounded-md border bg-white px-1.5 py-0.5 text-left text-[11.5px] shadow-sm', selected === i.id ? 'border-brand-500 ring-1 ring-brand-300' : 'border-slate-200', i.review && 'border-dashed border-red-300')}
            title={`Impact ${i.impact}, difficulty ${i.difficulty}${i.review ? ' — needs human review' : ''}`}
          >
            {i.label}
            {i.review && <span className="ml-1 text-red-600">⚠</span>}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-[18px_1fr_1fr] gap-1.5">
        <div className="row-span-2 flex items-center justify-center">
          <span className="-rotate-90 whitespace-nowrap text-[11px] font-medium text-slate-500">Impact →</span>
        </div>
        {box('quick_win', 'bg-emerald-50/70')}
        {box('major', 'bg-brand-50/70')}
        {box('fill_in', 'bg-slate-50')}
        {box('reconsider', 'bg-amber-50/60')}
        <div />
        <div className="text-center text-[11px] text-slate-500">low difficulty (1–3)</div>
        <div className="text-center text-[11px] text-slate-500">high difficulty (4–5) →</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>Top row: impact 4–5. Ratings are your judgment, not a prediction.</span>
        <Badge tone="red">⚠ needs human review (high or unassessed risk)</Badge>
        {items.length > rated.length && <span>{items.length - rated.length} not yet rated</span>}
      </div>
    </div>
  );
}
