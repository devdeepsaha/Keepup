import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Task } from '../types';
import { dayKey } from '../lib/dates';
import { attentionFor, byDueThenOldest, useNow, type Attention } from '../lib/tasks';
import { rhythmScopes, taskHandles } from '../lib/handles';
import TaskItem from './TaskItem';

interface Props {
  tasks: Task[];
  loading: boolean;
  focusTask?: { id: string; nonce: number } | null; // scroll to this task
  openId: string | null; // the one open task
  onOpenIdChange: (id: string | null) => void;
  onAddTask: (text: string, due: string | null) => void;
  onToggle: (id: string, done: boolean) => void;
  onRename: (id: string, text: string) => void;
  onSetDue: (id: string, due: string | null) => void;
  onSetCadence: (id: string, perWeek: number | null) => void;
  onSetHandle: (id: string, handle: string | null) => void;
  onSetClient: (id: string, client: string | null) => void;
  onSetWaiting: (id: string, waitingFor: string | null, waiting: boolean, since?: string | null) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onAddUpdate: (id: string, text: string) => void;
  onDeleteUpdate: (taskId: string, updateId: string) => void;
}

interface Entry {
  task: Task;
  attention: Attention | null;
}

const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Workspace({ tasks, loading, focusTask, openId, onOpenIdChange, onAddTask, onToggle, ...itemHandlers }: Props) {
  const now = useNow();
  const today = new Date(now);
  const todayKey = dayKey(today);
  const [newTaskText, setNewTaskText] = useState('');
  const [newDue, setNewDue] = useState('');
  const captureInput = useRef<HTMLInputElement>(null);

  // A task whose panel is open keeps its section and position (the attention it had when opened),
  // so logging an update doesn't make it jump away mid-edit.
  const [pin, setPin] = useState<{ id: string; attention: Attention | null } | null>(null);
  if ((pin?.id ?? null) !== openId) {
    // A different task was opened (or it closed): pin the new one where it is now.
    const open = openId ? tasks.find((t) => t.id === openId) : undefined;
    setPin(open ? { id: open.id, attention: attentionFor(open, now, todayKey, rhythmScopes(tasks).get(open.id)) } : null);
  }

  // Press N anywhere to jump to the capture input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        captureInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleAddTask = (e: FormEvent) => {
    e.preventDefault();
    const text = newTaskText.trim();
    if (!text) return;
    onAddTask(text, newDue || null);
    setNewTaskText('');
    setNewDue('');
  };

  // Tasks grouped by client: the client's check-in rhythm counts once, on its lead task.
  const scopes = rhythmScopes(tasks);
  const entries: Entry[] = tasks
    .filter((t) => !t.done)
    .map((task) => ({ task, attention: task.id === pin?.id ? pin.attention : attentionFor(task, now, todayKey, scopes.get(task.id)) }));
  const needsAttention = entries.filter((e) => e.attention).sort((a, b) => b.attention!.score - a.attention!.score);
  const inProgress = entries.filter((e) => !e.attention && !e.task.waiting_since).sort((a, b) => byDueThenOldest(a.task, b.task));
  // Blocked on the client, nothing due yet: parked here (they move to Needs attention on nudge days).
  const waitingOn = entries
    .filter((e) => !e.attention && e.task.waiting_since)
    .sort((a, b) => a.task.waiting_since!.localeCompare(b.task.waiting_since!));

  const isFirstRun = !loading && tasks.length === 0;

  let headline: string;
  if (loading) headline = 'Loading…';
  else if (isFirstRun) headline = "Let's get started.";
  else if (needsAttention.length) headline = `${plural(needsAttention.length, 'task')} ${needsAttention.length === 1 ? 'needs' : 'need'} attention.`;
  else if (entries.length) headline = 'All caught up.';
  else headline = 'Clear desk.';

  const handles = taskHandles(tasks);

  const renderList = (list: Entry[]) =>
    list.map(({ task }) => (
      <TaskItem
        key={task.id}
        task={task}
        now={now}
        todayKey={todayKey}
        attention={attentionFor(task, now, todayKey, scopes.get(task.id))}
        scope={scopes.get(task.id)}
        handle={handles.get(task.id) ?? ''}
        focusNonce={focusTask?.id === task.id ? focusTask.nonce : undefined}
        open={openId === task.id}
        onOpenChange={(id, open) => onOpenIdChange(open ? id : openId === id ? null : openId)}
        onToggle={(id, done) => {
          if (openId === id) onOpenIdChange(null);
          onToggle(id, done);
        }}
        {...itemHandlers}
      />
    ));

  const sectionHeader = (title: string, count: number, border: string) => (
    <div className={`flex items-end justify-between border-b-2 ${border} pb-2`}>
      <h3 className="font-display text-sm font-semibold uppercase tracking-widest">{title}</h3>
      <span className="text-sm text-[var(--text-muted)] font-medium">{count}</span>
    </div>
  );

  return (
    <div className="px-5 md:px-8 lg:px-10 pt-2 pb-5 max-w-7xl mx-auto">
      {/* Status: what matters right now */}
      <header className="mb-6">
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-2">
          {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          <span className="text-[var(--text-muted)] font-medium normal-case tracking-normal"> · {greeting(today.getHours())}</span>
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">{headline}</h1>
      </header>

      {/* Capture */}
      <form
        onSubmit={handleAddTask}
        className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-[var(--line-color)] focus-within:border-[var(--accent)] transition-colors"
      >
        <span className="font-display text-xl md:text-2xl text-[var(--text-muted)]">+</span>
        <input
          ref={captureInput}
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          placeholder="Add a task"
          maxLength={500}
          autoFocus={isFirstRun}
          className="flex-1 min-w-0 bg-transparent border-none py-2.5 text-xl md:text-2xl font-display font-medium tracking-tight outline-none clean-input focus:text-[var(--accent)] transition-colors"
        />
        {!newTaskText && (
          <kbd className="hidden md:inline font-display text-xs text-[var(--text-muted)] border border-[var(--line-color)] rounded px-1.5 py-0.5">
            N
          </kbd>
        )}
        <label className="flex items-center gap-2 font-display text-xs uppercase tracking-wider text-[var(--text-muted)] pb-2 md:pb-0">
          Due
          <input
            type="date"
            value={newDue}
            min={todayKey}
            onChange={(e) => setNewDue(e.target.value)}
            className={`bg-transparent outline-none text-sm normal-case tracking-normal ${newDue ? 'text-[var(--text-main)]' : 'text-[var(--placeholder)]'}`}
          />
        </label>
        <button
          type="submit"
          disabled={!newTaskText.trim()}
          className="font-display font-semibold uppercase tracking-widest text-sm text-[var(--text-main)] disabled:text-[var(--line-color)] hover:text-[var(--accent)] transition-colors cursor-pointer disabled:cursor-default pb-2 md:pb-0"
        >
          Add
        </button>
      </form>

      {!loading && !isFirstRun && (
        // Two columns only when the list itself is wide enough (not the screen): with the assistant docked on
        // the right, it drops to one column instead of squeezing titles.
        <div className="@container">
          <main
            className={`grid gap-x-12 gap-y-8 ${needsAttention.length && inProgress.length + waitingOn.length ? '@5xl:grid-cols-2' : ''}`}
          >
            {needsAttention.length > 0 && (
              <section id="needs-attention" className="scroll-mt-4">
                {sectionHeader('Needs attention', needsAttention.length, 'border-red-500')}
                {renderList(needsAttention)}
              </section>
            )}

            {inProgress.length + waitingOn.length > 0 && (
              <div className="space-y-8">
                {inProgress.length > 0 && (
                  <section id="in-progress" className="scroll-mt-4">
                    {sectionHeader('In progress', inProgress.length, 'border-[var(--text-main)]')}
                    {renderList(inProgress)}
                  </section>
                )}
                {waitingOn.length > 0 && (
                  <section id="waiting" className="scroll-mt-4">
                    {sectionHeader('On hold', waitingOn.length, 'border-[#257ef4]')}
                    {renderList(waitingOn)}
                  </section>
                )}
              </div>
            )}

            {entries.length === 0 && (
              <p className="text-[var(--text-muted)] font-display text-lg">Nothing active. Enjoy the silence.</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
