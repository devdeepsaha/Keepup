import { useState } from 'react';
import type { Task } from '../types';
import { keyToDate } from '../lib/dates';
import { useOrg } from '../lib/org';

// A task a founder or manager gave you: accept it into your list, or decline it with a note they'll see.
export default function AssignmentCard({
  task,
  todayKey,
  onAnswer,
}: {
  task: Task;
  todayKey: string;
  onAnswer: (id: string, accept: boolean, note: string | null) => void;
}) {
  const { nameOf } = useOrg();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const from = nameOf(task.assigned_by);
  const due = task.due_date
    ? task.due_date < todayKey
      ? 'overdue'
      : `due ${keyToDate(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
    : null;

  return (
    <div className="rounded-xl border border-[var(--line-color)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold break-words">{task.text}</p>
          <p className="font-display text-xs text-[var(--text-muted)]">
            From <span className="font-semibold text-[var(--text-main)]">{from}</span>
            {due && ` · ${due}`}
          </p>
        </div>
        {!declining && (
          <div className="flex items-center gap-2 font-display text-xs">
            <button
              onClick={() => setDeclining(true)}
              className="rounded-lg border border-[var(--line-color)] px-3 py-1.5 font-semibold hover:border-red-500 hover:text-red-500 cursor-pointer"
            >
              Decline
            </button>
            <button
              onClick={() => onAnswer(task.id, true, null)}
              className="rounded-lg bg-[var(--text-main)] px-3 py-1.5 font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white cursor-pointer"
            >
              Accept
            </button>
          </div>
        )}
      </div>
      {declining && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAnswer(task.id, false, note.trim() || null);
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={`Why? ${from} will see this, e.g. “Fully booked until Friday”`}
            className="min-w-48 flex-1 rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[var(--text-main)] clean-input"
          />
          <button type="button" onClick={() => setDeclining(false)} className="font-display text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-red-500 px-3 py-1.5 font-display text-xs font-semibold text-white hover:opacity-90 cursor-pointer">
            Decline
          </button>
        </form>
      )}
    </div>
  );
}
