import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlannedUpdate, Task } from '../types';
import { daysSince, daysUntilDue, timerFor, urgencyType, type Attention } from '../lib/tasks';
import { keyToDate } from '../lib/dates';
import { CADENCE_OPTIONS, CADENCE_RULE, cadenceFor, cadenceName } from '../lib/cadence';
import { cleanHandle, clientKeyOf, type RhythmScope } from '../lib/handles';
import TimerRing from './TimerRing';
import PlannedUpdates from './PlannedUpdates';

const STRIKE_MS = 650; // circle fills + line draws through the title
const LEAVE_MS = 450; // row folds away, then the task moves lists

interface Props {
  task: Task;
  now: number;
  todayKey: string;
  attention: Attention | null;
  handle: string; // this task's @tag (custom or automatic)
  scope?: RhythmScope; // the task's client: its check-in rhythm is shared and carried by the lead task
  focusNonce?: number; // changes when something asks to open this task (e.g. the sidebar)
  open: boolean; // one task is open at a time; the list decides which
  onOpenChange: (id: string, open: boolean) => void;
  onToggle: (id: string, done: boolean) => void;
  onRename: (id: string, text: string) => void;
  onSetDue: (id: string, due: string | null) => void;
  onSetCadence: (id: string, perWeek: number | null) => void;
  onSetHandle: (id: string, handle: string | null) => void;
  onSetClient: (id: string, client: string | null) => void;
  onSetWaiting: (id: string, waitingFor: string | null, waiting: boolean, since?: string | null) => void;
  onDelete: (id: string) => void; // moves it to the trash (restorable for 30 days)
  onArchive: (id: string) => void;
  onAddUpdate: (id: string, text: string) => void;
  onDeleteUpdate: (taskId: string, updateId: string) => void;
  onMarkPlannedSent: (taskId: string, update: PlannedUpdate) => void;
  onMovePlanned: (taskId: string, update: PlannedUpdate, sendOn: string) => void;
  onDeletePlanned: (taskId: string, update: PlannedUpdate) => void;
}

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function TaskItem({
  task,
  now,
  todayKey,
  attention,
  handle,
  scope,
  focusNonce,
  open: isOpen,
  onOpenChange,
  onToggle,
  onRename,
  onSetDue,
  onSetCadence,
  onSetHandle,
  onSetClient,
  onSetWaiting,
  onDelete,
  onArchive,
  onAddUpdate,
  onDeleteUpdate,
  onMarkPlannedSent,
  onMovePlanned,
  onDeletePlanned,
}: Props) {
  const [updateText, setUpdateText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false); // due date / repeat / delete, folded away
  const [phase, setPhase] = useState<'idle' | 'striking' | 'leaving'>('idle');
  const titleInput = useRef<HTMLInputElement>(null);
  const updateInput = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  useEffect(() => {
    if (isEditing) titleInput.current?.select();
  }, [isEditing]);

  // Reset the delete confirmation if the user doesn't follow through.
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  // While animating, show the state the task is heading to.
  const done = phase === 'idle' ? task.done : !task.done;

  const setOpen = (open: boolean) => onOpenChange(task.id, open);

  // Opened from elsewhere (sidebar): bring into view and put the cursor in the update box.
  useEffect(() => {
    if (!focusNonce) return;
    window.setTimeout(() => {
      root.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      updateInput.current?.focus({ preventScroll: true });
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const openForLogging = () => {
    setOpen(true);
    window.setTimeout(() => updateInput.current?.focus({ preventScroll: true }), 0);
  };

  const handleToggle = () => {
    if (phase !== 'idle') return;
    setPhase('striking');
    setOpen(false);
    timers.current.push(
      window.setTimeout(() => setPhase('leaving'), STRIKE_MS),
      window.setTimeout(() => onToggle(task.id, !task.done), STRIKE_MS + LEAVE_MS),
    );
  };

  const handleAddUpdate = (e: FormEvent) => {
    e.preventDefault();
    const text = updateText.trim();
    if (text) {
      onAddUpdate(task.id, text);
      setUpdateText('');
    }
  };

  const saveTitle = () => {
    const text = draftTitle.trim();
    if (text && text !== task.text) onRename(task.id, text);
    else setDraftTitle(task.text);
    setIsEditing(false);
  };

  const timer = timerFor(task, now, todayKey, scope);
  const waiting = !!task.waiting_since;
  const waitingDays = waiting ? daysSince(task.waiting_since!, now) : 0;
  const titleType = urgencyType(timer.progress);

  // Shown in the ring's hover card.
  const quietDays = daysSince(task.last_updated, now);
  const dueIn = daysUntilDue(task, todayKey);
  const cadence = cadenceFor(task, todayKey, scope);
  const dueText =
    task.due_date && dueIn !== null
      ? dueIn < 0
        ? `${-dueIn}d late`
        : dueIn === 0
          ? 'Today'
          : dueIn === 1
            ? 'Tomorrow'
            : shortDate(keyToDate(task.due_date)).replace(/^\w+, /, '')
      : 'None';
  const details = {
    // What to do next, in words.
    headline: attention?.label ?? (cadence ? (cadence.label.split('. ')[1] ?? cadence.label) : 'Nothing pressing'),
    // The facts that matter at a glance.
    primary: [
      { label: 'Last update', value: quietDays === 0 ? 'Today' : quietDays === 1 ? 'Yesterday' : `${quietDays}d ago` },
      { label: 'Due', value: dueText },
      cadence
        ? { label: 'This week', value: `${cadence.count}/${cadence.target}` }
        : { label: 'Logs', value: String(task.task_updates.length) },
    ],
    // Background, in small print.
    secondary: [
      cadence &&
        `${scope && scope.size > 1 ? `${cadenceName(cadence.perWeek)} for ${scope.clientName} (any of its ${scope.size} tasks)` : cadenceName(cadence.perWeek)}${
          cadence.checkIns.length
            ? ` · done ${cadence.checkIns.map((d) => keyToDate(d).toLocaleDateString('en-US', { weekday: 'short' })).join(' + ')}`
            : ''
        }`,
      cadence && `Check-in days: ${CADENCE_RULE}`,
      `Added ${shortDate(new Date(task.created_at))}${cadence ? ` · ${task.task_updates.length} ${task.task_updates.length === 1 ? 'log' : 'logs'}` : ''}`,
    ].filter((x): x is string => !!x),
  };

  return (
    <div ref={root} className={`row-collapse ${phase === 'leaving' ? 'is-leaving' : ''}`}>
      <div className="overflow-hidden">
        <div className="border-b border-[var(--line-color)] group">
          {/* Task header: one compact line (title + status chips) */}
          <div
            className="@container py-3 flex items-start @2xl:items-center gap-3 cursor-pointer"
            onClick={() => !isEditing && phase === 'idle' && setOpen(!isOpen)}
          >
            <button
              aria-label={done ? 'Mark as not done' : 'Mark as done'}
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              className={`mt-1 @2xl:mt-0 w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-300 cursor-pointer ${
                done ? 'border-[var(--text-muted)] bg-transparent' : 'border-[var(--text-main)] hover:bg-[var(--text-main)]'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  done ? 'bg-[var(--text-muted)] scale-100' : 'bg-[var(--bg-color)] scale-0'
                }`}
              />
            </button>

            {/* Narrow row (e.g. two columns): status chips sit under the title so the title gets the full width. */}
            <div className="flex-1 min-w-0 flex flex-col @2xl:flex-row @2xl:items-center gap-x-4 gap-y-1.5">
              {/* Title. Double-click to rename. */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    ref={titleInput}
                    value={draftTitle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') {
                        setDraftTitle(task.text);
                        setIsEditing(false);
                      }
                    }}
                    maxLength={500}
                    style={titleType}
                    className="w-full bg-transparent border-none outline-none font-display text-[var(--accent)]"
                  />
                ) : (
                  <h2
                    title={`${task.text} (double-click to rename)`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setDraftTitle(task.text);
                      setIsEditing(true);
                    }}
                    style={titleType}
                    className={`font-display max-w-full break-words ${isOpen ? '' : 'line-clamp-2'} ${
                      done ? 'text-[var(--text-muted)]' : 'text-[var(--text-main)]'
                    }`}
                  >
                    {/* Long titles wrap (up to two lines while closed) instead of being cut off. */}
                    <span className={`elegant-strike ${done ? 'is-done' : ''}`}>{task.text}</span>
                  </h2>
                )}
              </div>

              {/* Status chips */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 @2xl:shrink-0 font-display text-xs whitespace-nowrap">
                {waiting && !done && (
                  <span
                    title={`On hold${task.waiting_for ? `: waiting for ${task.waiting_for}` : ''}`}
                    className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-[#257ef4]"
                  >
                    On hold
                  </span>
                )}
                {cadence && cadence.target > 0 && !done && (
                  <span
                    className="flex items-center gap-1"
                    title={
                      cadence.target < cadence.perWeek
                        ? `Added this week, so only ${cadence.target} of the usual ${cadence.perWeek} check-ins still fit before Sunday. From next week it's ${cadence.perWeek}.`
                        : `${cadence.count} of ${cadence.target} check-ins this week`
                    }
                  >
                    {Array.from({ length: cadence.target }, (_, i) => (
                      <span
                        key={i}
                        className={`w-2 h-2 rounded-full border border-[var(--text-main)] ${i < cadence.count ? 'bg-[var(--text-main)]' : ''}`}
                      />
                    ))}
                    <span className="ml-1 text-[var(--text-muted)]">
                      {cadence.count}/{cadence.target}
                      <span className="max-sm:hidden"> {cadence.target < cadence.perWeek ? 'first wk' : 'this wk'}</span>
                    </span>
                  </span>
                )}
                <span className="text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors">
                  {task.task_updates.length} {task.task_updates.length === 1 ? 'log' : 'logs'}
                </span>
                {attention && !done && !isOpen && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openForLogging();
                    }}
                    className="px-2.5 py-1 rounded-full border border-[var(--accent)] font-semibold uppercase tracking-wider text-[0.625rem] text-[var(--accent)] hover:bg-[image:var(--accent-gradient)] hover:border-transparent hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="sm:hidden">{attention.kind === 'planned' ? 'Send update' : waiting ? 'Nudge' : 'Log update'}</span>
                    <span className="max-sm:hidden">
                      {attention.kind === 'planned' ? 'Send planned update' : waiting ? 'Log nudge' : cadence ? 'Log client update' : 'Log update'}
                    </span>
                  </button>
                )}
                {!done && (
                  <span className="flex max-sm:order-first">
                    <TimerRing timer={timer} details={details} />
                  </span>
                )}
                {/* Quick delete: appears on hover; first click asks, second moves it to the trash. */}
                <button
                  aria-label={confirmDelete ? 'Confirm move to trash' : 'Move to trash'}
                  title={confirmDelete ? 'Click again to move it to the trash' : 'Move to trash (restorable for 30 days)'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmDelete) onDelete(task.id);
                    else setConfirmDelete(true);
                  }}
                  className={`max-sm:hidden transition-opacity cursor-pointer ${
                    confirmDelete
                      ? 'opacity-100 font-semibold uppercase tracking-wider text-[0.625rem] text-red-500'
                      : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-red-500'
                  }`}
                >
                  {confirmDelete ? (
                    'Trash?'
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Expandable logs section */}
          <div className={`expand-grid ${isOpen ? 'is-open' : ''}`}>
            <div className="expand-inner">
              <div className="pl-9 pb-4 pr-1 space-y-3">
                {/* 0. Planned client updates, with today's one ready to copy */}
                <PlannedUpdates
                  planned={(task.planned_updates ?? []).filter((p) => p.status === 'planned')}
                  todayKey={todayKey}
                  onMarkSent={(u) => onMarkPlannedSent(task.id, u)}
                  onMove={(u, d) => onMovePlanned(task.id, u, d)}
                  onDelete={(u) => onDeletePlanned(task.id, u)}
                />
                {/* 1. Write an update: the main thing you open a task for */}
                <form
                  onSubmit={handleAddUpdate}
                  className="flex items-center gap-2 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] pl-3 pr-1.5 py-1.5 focus-within:border-[var(--text-main)] transition-colors"
                >
                  <input
                    ref={updateInput}
                    type="text"
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    placeholder="What's the latest?"
                    maxLength={2000}
                    className="w-full min-w-0 bg-transparent border-none text-sm outline-none clean-input py-1"
                  />
                  <button
                    type="submit"
                    disabled={!updateText.trim()}
                    className="shrink-0 rounded-lg bg-[var(--text-main)] text-[var(--bg-color)] px-3 py-1.5 font-display text-xs font-semibold disabled:bg-[var(--line-color)] disabled:text-[var(--text-muted)] transition-colors cursor-pointer disabled:cursor-default"
                  >
                    Post
                  </button>
                </form>

                {/* 2. Logs, newest first: the latest status reads darkest, history fades */}
                {task.task_updates.length === 0 ? (
                  <p className="pl-1 text-xs text-[var(--text-muted)]">No updates yet.</p>
                ) : (
                  <ol className="space-y-1.5 pl-1">
                    {[...task.task_updates].reverse().map((update, i) => (
                      <li key={update.id} className="flex items-baseline gap-3 group/log">
                        <span className="w-12 shrink-0 font-display text-[0.6875rem] tabular-nums text-[var(--text-muted)]">
                          {new Date(update.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <p
                          className={`flex-1 min-w-0 text-sm leading-relaxed break-words ${
                            i === 0 ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {update.text}
                        </p>
                        <button
                          aria-label="Delete log"
                          onClick={() => onDeleteUpdate(task.id, update.id)}
                          className="text-[var(--text-muted)] opacity-0 group-hover/log:opacity-100 focus:opacity-100 hover:text-red-500 transition-all text-sm cursor-pointer"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                )}

                {/* 3. Settings: rarely changed, so folded into one quiet line */}
                <div className="pl-1 font-display text-xs text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={() => setShowSettings((v) => !v)}
                    aria-expanded={showSettings}
                    className="hover:text-[var(--text-main)] transition-colors cursor-pointer"
                  >
                    {task.due_date ? `Due ${shortDate(keyToDate(task.due_date))}` : 'No due date'}
                    {' · '}
                    {task.cadence_per_week ? cadenceName(task.cadence_per_week) : 'No rhythm'}
                    {' · '}
                    <span className="text-[#257EF4]">@{handle}</span>
                    {waiting && (
                      <>
                        {' · '}
                        <span className="text-[#257EF4]">
                          On hold{task.waiting_for ? `: waiting for ${task.waiting_for}` : ''} ({waitingDays === 0 ? 'since today' : `${waitingDays}d`})
                        </span>
                      </>
                    )}
                    {' · '}
                    <span className="underline underline-offset-2">{showSettings ? 'Done' : 'Edit'}</span>
                  </button>

                  {showSettings && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <label className="flex items-center gap-2">
                        <span className="uppercase tracking-wider">Due</span>
                        <input
                          type="date"
                          value={task.due_date ?? ''}
                          onChange={(e) => onSetDue(task.id, e.target.value || null)}
                          className="bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5"
                        />
                        {task.due_date && (
                          <button
                            type="button"
                            onClick={() => onSetDue(task.id, null)}
                            className="hover:text-[var(--text-main)] transition-colors cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </label>

                      <label className="flex items-center gap-2" title={`Check-ins: ${CADENCE_RULE}`}>
                        <span className="uppercase tracking-wider">Repeat</span>
                        <select
                          value={task.cadence_per_week ?? ''}
                          onChange={(e) => onSetCadence(task.id, e.target.value ? Number(e.target.value) : null)}
                          className="bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5 cursor-pointer"
                        >
                          <option value="">No rhythm</option>
                          {CADENCE_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {cadenceName(n)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center gap-2" title="Letters and numbers only. Leave empty for the automatic tag.">
                        <span className="uppercase tracking-wider">Tag</span>
                        <span className="text-[#257EF4]">@</span>
                        <input
                          key={handle}
                          defaultValue={task.handle ?? ''}
                          placeholder={handle}
                          maxLength={30}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          onBlur={(e) => {
                            const next = cleanHandle(e.currentTarget.value);
                            const value = next.length >= 2 ? next : null;
                            if (value !== (task.handle ?? null)) onSetHandle(task.id, value);
                          }}
                          className="w-28 bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[#257EF4] py-0.5 clean-input"
                        />
                      </label>

                      <label className="flex items-center gap-2" title="Tasks with the same client share one check-in rhythm and the client's @tag.">
                        <span className="uppercase tracking-wider">Client</span>
                        <input
                          key={clientKeyOf(task)}
                          defaultValue={task.client ?? ''}
                          placeholder={clientKeyOf(task)}
                          maxLength={30}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          onBlur={(e) => {
                            const next = cleanHandle(e.currentTarget.value);
                            const value = next.length >= 2 ? next : null;
                            if (value !== (task.client ?? null)) onSetClient(task.id, value);
                          }}
                          className="w-28 bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5 clean-input"
                        />
                      </label>

                      {/* Blocked on the client: pauses the quiet timer; check-in days become nudges. */}
                      <div className="flex basis-full flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSetWaiting(task.id, task.waiting_for ?? null, !waiting)}
                          aria-pressed={waiting}
                          className={`rounded-full px-2.5 py-1 uppercase tracking-wider transition-colors cursor-pointer ${
                            waiting ? 'bg-accent-gradient text-white' : 'border border-[var(--line-color)] hover:border-[var(--text-main)]'
                          }`}
                        >
                          {waiting ? 'On hold ✓' : 'On hold?'}
                        </button>
                        {waiting && (
                          <input
                            key={task.waiting_for ?? ''}
                            defaultValue={task.waiting_for ?? ''}
                            placeholder="for… e.g. homepage content"
                            maxLength={200}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            onBlur={(e) => {
                              const value = e.currentTarget.value.trim() || null;
                              if (value !== (task.waiting_for ?? null)) onSetWaiting(task.id, value, true, task.waiting_since);
                            }}
                            className="min-w-48 flex-1 bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5 clean-input normal-case"
                          />
                        )}
                      </div>

                      <span className="ml-auto flex items-center gap-4">
                        <button
                          onClick={() => onArchive(task.id)}
                          title="Hide it from your lists without completing it. Restore it from Archive."
                          className="uppercase tracking-wider transition-colors whitespace-nowrap hover:text-[var(--text-main)] cursor-pointer"
                        >
                          Archive
                        </button>
                        <button
                          onClick={() => (confirmDelete ? onDelete(task.id) : setConfirmDelete(true))}
                          title="Restorable from the trash for 30 days"
                          className={`uppercase tracking-wider transition-colors whitespace-nowrap cursor-pointer ${
                            confirmDelete ? 'text-red-500' : 'hover:text-red-500'
                          }`}
                        >
                          {confirmDelete ? 'Move to trash?' : 'Delete'}
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
