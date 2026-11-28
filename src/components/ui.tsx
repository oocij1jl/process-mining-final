import {
  Component,
  useState,
  type ButtonHTMLAttributes,
  type ErrorInfo,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { EngineResult } from '../adapters/engineAdapter';
import { ICON_NAMES, Icon, type IconName } from './icons';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* ---------- Layout ---------- */

/**
 * Page header: lifecycle step, title, one-line purpose and the page's primary next action.
 */
export function PageHeader({
  title,
  subtitle,
  phase,
  actions,
  compact,
}: {
  title: string;
  subtitle?: ReactNode;
  phase?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', compact ? 'mb-3' : 'mb-5')}>
      <div className="min-w-0">
        {phase && <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-600">{phase}</div>}
        <h1 className={cx('font-semibold tracking-tight text-slate-900', compact ? 'text-lg' : 'mt-0.5 text-[22px] leading-tight')}>{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No header divider; for light-weight grouping. */
  flush?: boolean;
}) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {(title || actions) && (
        <header className={cx('flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5', flush ? 'pb-1' : 'border-b border-slate-100 pb-3')}>
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small uppercase section label used inside panels. */
export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cx('mb-1.5 flex items-center justify-between gap-2', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{children}</div>
      {right}
    </div>
  );
}

/* ---------- Controls ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  iconRight,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; iconRight?: IconName }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9 px-3.5 text-[13.5px]',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        variant === 'subtle' && 'bg-brand-50 text-brand-700 hover:bg-brand-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        className,
      )}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
      {iconRight && <Icon name={iconRight} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
    </button>
  );
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs leading-relaxed text-slate-400">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13.5px] text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cx(inputCls, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', className)} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'min-h-[72px]', className)} />;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode; count?: number | string; icon?: IconName; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('mb-4 flex gap-1 overflow-x-auto border-b border-slate-200', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-medium transition disabled:opacity-40',
            value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.icon && <Icon name={t.icon} className="h-4 w-4" />}
          {t.label}
          {t.count !== undefined && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 tabular">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Compact segmented control for modes and metric choices. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: { id: T; label: ReactNode; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={cx(
            'whitespace-nowrap rounded-md font-medium transition disabled:opacity-40',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
            value === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Data display ---------- */

export type Tone = 'neutral' | 'brand' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export function Badge({ tone = 'neutral', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', toneCls[tone], className)}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  badge,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'muted';
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'min-w-0 rounded-xl border bg-white px-4 py-3',
        tone === 'good' ? 'border-emerald-200' : tone === 'bad' ? 'border-red-200 bg-red-50/30' : 'border-slate-200/80',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {badge}
      </div>
      <div className={cx('mt-1 truncate text-[22px] font-semibold tracking-tight tabular', tone === 'muted' ? 'text-slate-400' : 'text-slate-900')}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{sub}</div>}
    </div>
  );
}

/** Inline metric used inside panels: label above, value below. */
export function Metric({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-[15px] font-semibold text-slate-900 tabular">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('pp-scroll overflow-auto rounded-lg border border-slate-200', className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' }) {
  return (
    <th
      className={cx(
        'sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' }) {
  return <td className={cx('border-b border-slate-100 px-3 py-2 align-top', align === 'right' && 'text-right tabular', className)}>{children}</td>;
}

/* ---------- States ---------- */

export function EmptyState({
  title,
  children,
  action,
  icon = 'inbox',
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName | string;
  className?: string;
}) {
  const known = isIconName(icon);
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center', className)}>
      <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400" aria-hidden>
        {known ? <Icon name={icon} className="h-5 w-5" /> : <span className="text-lg">{icon}</span>}
      </div>
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'error' | 'success' | 'fixture' | 'neutral'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50/70 text-sky-950',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-950',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    fixture: 'border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb,#fffbeb_8px,#fef3c7_8px,#fef3c7_16px)] text-amber-950',
  }[tone];
  const icon: IconName = tone === 'error' ? 'alert' : tone === 'warning' || tone === 'fixture' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', cls, className)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
    </div>
  );
}

const statusCopy: Record<Exclude<EngineResult<unknown>['status'], 'ok'>, { title: string; tone: 'warning' | 'error' | 'info' | 'fixture' | 'neutral' }> = {
  not_implemented: { title: 'Not available in this build', tone: 'neutral' },
  fixture_unavailable: { title: 'No test value for this selection', tone: 'fixture' },
  error: { title: 'This calculation could not be completed', tone: 'error' },
  blocked: { title: 'Waiting for an earlier step', tone: 'info' },
};

/** Friendly description of a v0.3 capability, shown in unavailable states. */
const CAPABILITY_COPY: Partial<Record<string, string>> = {
  importXes: 'XES import is handled by the analysis engine. This build does not include the XES importer yet; use a CSV export of the same log.',
  getActivityEvidence: 'Repeat (rework) evidence per activity needs the activity-evidence engine function, which this build does not include yet.',
  scoreAutomation: 'The automation score is calculated by the engine. This build does not include the scoring function yet, so no score is shown.',
  estimateBenefit: 'Benefit and ROI are calculated by the engine. This build does not include the benefit function yet, so no result is shown.',
  extractQueueInputs: 'The general queue model needs the queue-input engine function, which this build does not include yet.',
  compareQueues: 'The general queue comparison needs the queue engine function, which this build does not include yet.',
  getCaseThroughput: 'Throughput by completion activity needs the throughput engine function, which this build does not include yet.',
  getHistoricalTrends: 'Historical trends need the trend engine function, which this build does not include yet.',
  getTransitionDrift: 'Transition drift needs the drift engine function, which this build does not include yet.',
  getPatternEvidence: 'Pattern evidence needs the pattern engine function, which this build does not include yet.',
  buildReplayIndex: 'Event Log Replay needs the replay engine functions, which this build does not include yet.',
  getReplayFrame: 'Event Log Replay needs the replay engine functions, which this build does not include yet.',
  getBpmnComparison: 'Activity mapping and deviation checks need the BPMN comparison engine function, which this build does not include yet. Viewing and editing BPMN still works.',
};

export function capabilityMessage(fn: string): string {
  return CAPABILITY_COPY[fn] ?? 'This analysis is not available in the current engine build.';
}

/** Explicit "not available" panel for a missing engine capability. */
export function Unavailable({ fn, title, children, compact }: { fn: string; title?: string; children?: ReactNode; compact?: boolean }) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500" title={capabilityMessage(fn)}>
        <Icon name="lock" className="h-3.5 w-3.5" /> Not available in this build
      </span>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-4 text-[13px] text-slate-600">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <Icon name="lock" className="h-4 w-4 text-slate-400" />
        {title ?? 'Not available in this build'}
      </div>
      <p className="mt-1 leading-relaxed">{capabilityMessage(fn)}</p>
      {children && <div className="mt-2">{children}</div>}
      <details className="mt-2 text-[11px] text-slate-400">
        <summary className="cursor-pointer">Technical detail</summary>
        Engine function <code className="font-mono">{fn}</code> is not exported by the current build. No values are estimated by the interface.
      </details>
    </div>
  );
}

/** Renders an engine result: children on success, an explicit labelled state otherwise. */
export function EngineGate<T>({
  result,
  children,
  compact,
}: {
  result: EngineResult<T> | null | undefined;
  children: (data: T) => ReactNode;
  compact?: boolean;
}) {
  if (!result) return null;
  if (result.status === 'ok') return <>{children(result.data)}</>;
  if (result.status === 'not_implemented') return <Unavailable fn={result.fn} compact={compact} />;
  const copy = statusCopy[result.status];
  if (compact) {
    return (
      <span className="text-xs text-slate-500" title={result.message}>
        {copy.title}
      </span>
    );
  }
  return (
    <Notice tone={copy.tone} title={copy.title}>
      {result.message}
      <span className="ml-1 font-mono text-[11px] opacity-60">({result.fn})</span>
    </Notice>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <Notice tone="error" title={`${this.props.label} failed to render`}>
          {this.state.error.message}
          <div className="mt-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
          </div>
        </Notice>
      );
    }
    return this.props.children;
  }
}

export function KeyValue({ items, dense }: { items: [ReactNode, ReactNode][]; dense?: boolean }) {
  return (
    <dl className={cx('grid grid-cols-[max-content_1fr] gap-x-4 text-[13px]', dense ? 'gap-y-1' : 'gap-y-1.5')}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small "?" hint with an accessible popover explanation. */
export function InfoTip({ children, label = 'Explain' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="grid h-4 w-4 place-items-center rounded-full text-slate-400 hover:text-slate-700"
      >
        <Icon name="help" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-1/2 top-5 z-50 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}

/** Horizontal proportion bar (presentation of an engine value against its denominator). */
export function Meter({ value, max, tone = 'brand', className }: { value: number; max: number; tone?: 'brand' | 'amber' | 'green' | 'slate'; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bar = { brand: 'bg-brand-500', amber: 'bg-amber-500', green: 'bg-emerald-500', slate: 'bg-slate-400' }[tone];
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cx('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function isIconName(name: string): name is IconName {
  return name in ICON_NAMES;
}
