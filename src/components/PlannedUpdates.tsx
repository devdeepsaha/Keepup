import { useState } from 'react';
import type { PlannedUpdate } from '../types';
import { keyToDate } from '../lib/dates';

// A task's planned client updates: work split into parts, each sent on its own check-in day.
// Due ones come first, open, with the message to copy; later ones fold down to a date and a title.

interface Props {
  planned: PlannedUpdate[]; // not sent yet
  todayKey: string;
  onMarkSent: (update: PlannedUpdate) => void;
  onMove: (update: PlannedUpdate, sendOn: string) => void;
  onDelete: (update: PlannedUpdate) => void;
}

const dayLabel = (key: string, todayKey: string) => {
  const diff = Math.round((keyToDate(key).getTime() - keyToDate(todayKey).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${-diff}d late`;
  return keyToDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function PlannedUpdates({ planned, todayKey, onMarkSent, onMove, onDelete }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (!planned.length) return null;
  const sorted = [...planned].sort((a, b) => a.send_on.localeCompare(b.send_on) || a.position - b.position);

  const copy = async (u: PlannedUpdate) => {
    try {
      await navigator.clipboard.writeText(u.text);
      setCopied(u.id);
      window.setTimeout(() => setCopied((c) => (c === u.id ? null : c)), 1500);
    } catch {
      // clipboard blocked; the text is on screen to select by hand
    }
  };

  return (
    <div className="rounded-xl border border-[var(--line-color)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="font-display text-xs font-semibold uppercase tracking-widest">Planned client updates</h4>
        <span className="font-display text-[0.6875rem] text-[var(--text-muted)]">{sorted.length} to send</span>
      </div>
      <ol className="space-y-1.5">
        {sorted.map((u, i) => {
          const due = u.send_on <= todayKey;
          const open = due || expanded === u.id;
          return (
            <li
              key={u.id}
              className={`rounded-lg px-2.5 py-2 ${due ? 'bg-[var(--accent-soft)] ring-1 ring-inset ring-[#257ef4]/30' : 'hover:bg-[var(--bg-color)]'}`}
            >
              <button
                type="button"
                onClick={() => !due && setExpanded(open ? null : u.id)}
                className={`flex w-full items-center gap-2.5 text-left ${due ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--line-color)] font-display text-[0.625rem] text-[var(--text-muted)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.title}</span>
                <span
                  className={`shrink-0 font-display text-[0.6875rem] ${
                    u.send_on < todayKey ? 'text-red-500' : due ? 'font-semibold text-[#257ef4]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {dayLabel(u.send_on, todayKey)}
                </span>
              </button>
              {open && (
                <div className="mt-2 pl-7">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-main)]">{u.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-display text-xs">
                    <button
                      type="button"
                      onClick={() => copy(u)}
                      className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2.5 py-1 hover:border-[var(--text-main)] cursor-pointer"
                    >
                      {copied === u.id ? 'Copied ✓' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onMarkSent(u)}
                      title="Logs it as this week's check-in"
                      className="rounded-lg bg-[var(--text-main)] px-2.5 py-1 font-semibold text-[var(--bg-color)] hover:opacity-90 cursor-pointer"
                    >
                      Mark sent
                    </button>
                    <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      Move to
                      <input
                        type="date"
                        value={u.send_on}
                        min={todayKey}
                        onChange={(e) => e.target.value && onMove(u, e.target.value)}
                        className="bg-transparent text-[var(--text-main)] outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => onDelete(u)}
                      className="ml-auto text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
