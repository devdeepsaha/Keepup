import { useState } from 'react';
import type { OtherItem } from '../hooks/useOtherWorkspace';
import { dayKey } from '../lib/dates';
import { useSpaces } from '../lib/spaces';

// A slim reminder from your other spaces: what needs attention there, without mixing it into this list.
// "Hide for today" keeps it out of the way until tomorrow.

interface Props {
  items: OtherItem[];
  onOpen: (taskId: string, space: string) => void; // switch to that space and open the task
}

const HIDE_KEY = 'agenda.otherHidden';

export default function OtherWorkspaceCard({ items, onOpen }: Props) {
  const { spaceOf } = useSpaces();
  const other = 'others';
  const today = dayKey(new Date());
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(`${HIDE_KEY}.${other}`) === today;
    } catch {
      return false;
    }
  });
  if (!items.length || hidden) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(`${HIDE_KEY}.${other}`, today);
    } catch {
      // storage unavailable: hidden until reload
    }
  };
  const spacesInvolved = [...new Set(items.map((i) => i.task.workspace ?? 'agency'))];
  const name = spacesInvolved.length === 1 ? spaceOf(spacesInvolved[0]).name : 'Other spaces';
  const urgent = items.some((i) => i.attention.tone === 'red');

  return (
    <div
      className={`mb-6 rounded-2xl border px-4 py-3 ${
        urgent ? 'border-red-500/30 bg-red-500/[0.04]' : 'border-amber-500/30 bg-amber-500/[0.05]'
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-widest">
          <span className={`h-2 w-2 rounded-full ${urgent ? 'bg-red-500' : 'bg-amber-500'}`} />
          {name} · {items.length} {items.length === 1 ? 'needs' : 'need'} attention
        </div>
        <button onClick={hide} className="shrink-0 font-display text-[0.6875rem] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
          Hide for today
        </button>
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, 3).map(({ task, attention }) => (
          <li key={task.id}>
            <button
              onClick={() => onOpen(task.id, task.workspace ?? 'agency')}
              className="group flex w-full items-baseline gap-2 rounded-lg py-1 text-left cursor-pointer"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-[var(--accent)]">
                {task.text}
                {spacesInvolved.length > 1 && (
                  <span className="ml-1.5 font-display text-[0.6875rem] font-normal text-[var(--text-muted)]">{spaceOf(task.workspace ?? 'agency').name}</span>
                )}
              </span>
              <span className={`shrink-0 font-display text-[0.6875rem] ${attention.tone === 'red' ? 'text-red-500' : 'text-amber-600'}`}>
                {attention.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button
          onClick={() => onOpen(items[3].task.id, items[3].task.workspace ?? 'agency')}
          className="mt-1 font-display text-[0.6875rem] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
        >
          + {items.length - 3} more {spacesInvolved.length === 1 ? `in ${name}` : 'elsewhere'} →
        </button>
      )}
    </div>
  );
}
