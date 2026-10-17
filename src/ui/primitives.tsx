import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'primary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
        variant === 'primary' && 'bg-emerald-500 text-black hover:bg-emerald-400',
        variant === 'secondary' && 'bg-neutral-800 text-neutral-100 hover:bg-neutral-700',
        variant === 'danger' && 'bg-rose-500 text-white hover:bg-rose-400',
        variant === 'ghost' && 'text-neutral-300 hover:bg-neutral-800',
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatPill({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col rounded-xl px-3 py-2',
        tone === 'neutral' && 'bg-neutral-800/80',
        tone === 'good' && 'bg-emerald-500/15 text-emerald-300',
        tone === 'warn' && 'bg-amber-500/15 text-amber-300',
        tone === 'bad' && 'bg-rose-500/15 text-rose-300',
      )}
    >
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="truncate text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-neutral-800 text-neutral-300',
        tone === 'good' && 'bg-emerald-500/15 text-emerald-300',
        tone === 'warn' && 'bg-amber-500/15 text-amber-300',
        tone === 'bad' && 'bg-rose-500/15 text-rose-300',
      )}
    >
      {children}
    </span>
  );
}

export function ErrorCard({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-900/60 bg-rose-950/30 p-6 text-center">
      <p className="font-semibold text-rose-200">{title}</p>
      <p className="max-w-sm text-sm text-rose-200/70">{message}</p>
      {action}
    </div>
  );
}
