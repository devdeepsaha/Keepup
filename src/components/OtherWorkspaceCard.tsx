import { useState } from 'react';
import type { OtherItem } from '../hooks/useOtherWorkspace';
import type { Workspace } from '../types';
import { dayKey } from '../lib/dates';
import { WORKSPACES } from './Sidebar';

// A slim reminder from the other workspace: what needs attention there, without mixing it into this list.
// "Hide for today" keeps it out of the way until tomorrow.

interface Props {
  other: Workspace;
  items: OtherItem[];
  onOpen: (taskId: string) => void; // switch to that workspace and open the task
}

const HIDE_KEY = 'agenda.otherHidden';

export default function OtherWorkspaceCard({ other, items, onOpen }: Props) {
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
  const name = WORKSPACES[other].name;
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
              onClick={() => onOpen(task.id)}
              className="group flex w-full items-baseline gap-2 rounded-lg py-1 text-left cursor-pointer"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-[var(--accent)]">{task.text}</span>
              <span className={`shrink-0 font-display text-[0.6875rem] ${attention.tone === 'red' ? 'text-red-500' : 'text-amber-600'}`}>
                {attention.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button
          onClick={() => onOpen(items[3].task.id)}
          className="mt-1 font-display text-[0.6875rem] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
        >
          + {items.length - 3} more in {name} →
        </button>
      )}
    </div>
  );
}
