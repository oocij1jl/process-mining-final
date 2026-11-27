import { Component, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { EngineResult } from '../adapters/engineAdapter';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* ---------- Layout ---------- */

export function PageHeader({
  title,
  subtitle,
  phase,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  phase?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {phase && <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">{phase}</div>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
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
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- Controls ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  'block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} className={cx(inputCls, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', className)} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'min-h-[80px]', className)} />;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number | string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
            value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 tabular">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- Data display ---------- */

type Tone = 'neutral' | 'brand' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', toneCls[tone])}>
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
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'muted';
  badge?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-lg border bg-white p-4 shadow-sm',
        tone === 'good' ? 'border-emerald-200' : tone === 'bad' ? 'border-red-200' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {badge}
      </div>
      <div className={cx('mt-1.5 text-2xl font-semibold tracking-tight tabular', tone === 'muted' ? 'text-slate-400' : 'text-slate-900')}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-auto rounded-md border border-slate-200', className)}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' }) {
  return (
    <th
      className={cx(
        'sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500',
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

export function EmptyState({ title, children, action, icon = '◌' }: { title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <div className="mb-2 text-2xl text-slate-300" aria-hidden>
        {icon}
      </div>
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'error' | 'success' | 'fixture'; title?: string; children: ReactNode }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    fixture: 'border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb,#fffbeb_8px,#fef3c7_8px,#fef3c7_16px)] text-amber-950',
  }[tone];
  return (
    <div className={cx('rounded-md border px-3 py-2 text-sm', cls)} role={tone === 'error' ? 'alert' : undefined}>
      {title && <div className="font-semibold">{title}</div>}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}

const statusCopy: Record<Exclude<EngineResult<unknown>['status'], 'ok'>, { title: string; tone: 'warning' | 'error' | 'info' | 'fixture' }> = {
  not_implemented: { title: 'Engine function not implemented yet', tone: 'warning' },
  fixture_unavailable: { title: 'No UI fixture value for this scope', tone: 'fixture' },
  error: { title: 'Engine error', tone: 'error' },
  blocked: { title: 'Waiting for an upstream step', tone: 'info' },
};

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
  const copy = statusCopy[result.status];
  if (compact) {
    return (
      <span className="text-xs text-slate-500" title={result.message}>
        {copy.title} · <code className="font-mono">{result.fn}</code>
      </span>
    );
  }
  return (
    <Notice tone={copy.tone} title={copy.title}>
      <code className="font-mono text-xs">{result.fn}()</code> — {result.message}
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

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
