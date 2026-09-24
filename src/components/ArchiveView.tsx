import { useState } from 'react';
import type { Task } from '../types';
import { TRASH_DAYS } from '../hooks/useTasks';
import { clientKeyOf } from '../lib/handles';
import { useClientColors } from '../lib/clientColors';

// Archived tasks (hidden from the lists, kept in history) and the trash (restorable for 30 days).

interface Props {
  archived: Task[];
  trashed: Task[];
  loading: boolean;
  onRestore: (id: string) => void;
  onTrash: (id: string) => void;
  onPurge: (id: string) => void;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const daysLeft = (iso: string) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

function Row({ task, meta, children }: { task: Task; meta: string; children: React.ReactNode }) {
  const { colorOf } = useClientColors();
  return (
    <div className="group flex items-center gap-3 py-3">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(clientKeyOf(task)) }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-display text-[0.9375rem] ${task.done ? 'text-[var(--text-muted)] line-through' : ''}`}>{task.text}</div>
        <div className="font-display text-[0.6875rem] text-[var(--text-muted)]">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

const btn =
  'rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2.5 py-1 font-display text-xs transition-colors hover:border-[var(--text-main)] cursor-pointer';

export default function ArchiveView({ archived, trashed, loading, onRestore, onTrash, onPurge }: Props) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const logs = (t: Task) => `${t.task_updates.length} ${t.task_updates.length === 1 ? 'log' : 'logs'}`;

  return (
    <div className="mx-auto max-w-3xl px-5 pt-2 pb-10 md:px-8">
      <header className="mb-6">
        <div className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-accent-gradient">Archive</div>
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          Put away. <span className="text-[var(--text-muted)]">Not gone.</span>
        </h1>
      </header>

      <section id="archived" className="mb-8 scroll-mt-4">
        <h2 className="mb-1 font-display text-sm font-semibold">
          Archived <span className="text-[var(--text-muted)]">· {archived.length}</span>
        </h2>
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Off your lists and out of the check-in rhythm; their logs still show in the calendar and insights.
        </p>
        <div className="divide-y divide-[var(--line-color)] rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] px-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">Loading…</p>
          ) : archived.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing archived. Archive a task from its Edit panel or the sidebar menu.</p>
          ) : (
            archived.map((t) => (
              <Row key={t.id} task={t} meta={`archived ${fmt(t.archived_at!)} · ${logs(t)}`}>
                <button onClick={() => onRestore(t.id)} className={btn}>
                  Restore
                </button>
                <button onClick={() => onTrash(t.id)} className={`${btn} text-[var(--text-muted)] hover:text-red-500`}>
                  Trash
                </button>
              </Row>
            ))
          )}
        </div>
      </section>

      <section id="trash" className="scroll-mt-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="font-display text-sm font-semibold">
            Trash <span className="text-[var(--text-muted)]">· {trashed.length}</span>
          </h2>
          {trashed.length > 1 && (
            <button
              onClick={() => {
                if (!confirmAll) return setConfirmAll(true);
                trashed.forEach((t) => onPurge(t.id));
                setConfirmAll(false);
              }}
              onBlur={() => setConfirmAll(false)}
              className="font-display text-xs text-red-500 hover:underline cursor-pointer"
            >
              {confirmAll ? `Permanently delete all ${trashed.length}? Click again` : 'Empty trash'}
            </button>
          )}
        </div>
        <p className="mb-2 text-xs text-[var(--text-muted)]">Deleted tasks wait here for {TRASH_DAYS} days, then go for good.</p>
        <div className="divide-y divide-[var(--line-color)] rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] px-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">Loading…</p>
          ) : trashed.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">The trash is empty.</p>
          ) : (
            trashed.map((t) => {
              const left = daysLeft(t.deleted_at!);
              return (
                <Row key={t.id} task={t} meta={`deleted ${fmt(t.deleted_at!)} · ${left === 0 ? 'goes today' : `${left} ${left === 1 ? 'day' : 'days'} left`} · ${logs(t)}`}>
                  <button onClick={() => onRestore(t.id)} className={btn}>
                    Restore
                  </button>
                  <button
                    onClick={() => {
                      if (confirm !== t.id) return setConfirm(t.id);
                      setConfirm(null);
                      onPurge(t.id);
                    }}
                    onBlur={() => setConfirm((c) => (c === t.id ? null : c))}
                    className={`${btn} ${confirm === t.id ? 'border-red-500 text-red-500' : 'text-[var(--text-muted)] hover:text-red-500'}`}
                  >
                    {confirm === t.id ? 'Delete forever?' : 'Delete forever'}
                  </button>
                </Row>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
