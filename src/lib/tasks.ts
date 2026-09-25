import { useEffect, useState, type CSSProperties } from 'react';
import type { Task, TaskUpdate } from '../types';
import { cadenceFor } from './cadence';
import type { RhythmScope } from './handles';
import { dayKey, keyToDate } from './dates';

export const DAY_MS = 1000 * 60 * 60 * 24;
export const STALE_DAYS = 7; // red
export const QUIET_DAYS = 4; // orange

export interface Attention {
  kind: 'due' | 'stale' | 'cadence' | 'planned';
  label: string;
  tone: 'red' | 'orange';
  score: number; // higher = more urgent
}

// Current time, refreshed every minute so stale/due labels stay accurate.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function daysSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));
}

export function daysUntilDue(task: Task, todayKey: string): number | null {
  if (!task.due_date) return null;
  return Math.round((keyToDate(task.due_date).getTime() - keyToDate(todayKey).getTime()) / DAY_MS);
}

// Why an active task needs attention, or null if it's on track. `scope` groups tasks by client so the
// client's check-in rhythm is counted once (on its lead task).
export function attentionFor(task: Task, now: number, todayKey: string, scope?: RhythmScope): Attention | null {
  const due = daysUntilDue(task, todayKey);
  const quiet = daysSince(task.last_updated, now);
  const cadence = cadenceFor(task, todayKey, scope);
  const waiting = !!task.waiting_since;
  const who = scope && scope.size > 1 ? `${scope.clientName}: ` : '';
  const waitingFor = task.waiting_for ? ` (ask for ${task.waiting_for})` : '';
  if (due !== null && due < 0) return { kind: 'due', label: `Overdue ${-due}d`, tone: 'red', score: 1000 - due };
  // A planned client update is due: send it today.
  const planned = (task.planned_updates ?? [])
    .filter((p) => p.status === 'planned' && p.send_on <= todayKey)
    .sort((a, b) => a.send_on.localeCompare(b.send_on))[0];
  if (planned)
    return {
      kind: 'planned',
      label: `${who}${planned.send_on < todayKey ? 'Planned update late' : 'Send today'}: ${planned.title}`,
      tone: 'red',
      score: planned.send_on < todayKey ? 950 : 800,
    };
  if (due === 0) return { kind: 'due', label: 'Due today', tone: 'red', score: 900 };
  // Rhythm tasks follow their weekly check-in schedule instead of the generic quiet/stale rule.
  if (cadence) {
    // A full ring is red here too, so the label always matches the ring.
    const label = `${who}${cadence.label}${waiting ? waitingFor : ''}`;
    if (cadence.tone === 'red' || cadence.progress >= 0.999) return { kind: 'cadence', label, tone: 'red', score: 600 };
    if (due === 1) return { kind: 'due', label: 'Due tomorrow', tone: 'orange', score: 400 };
    if (cadence.tone === 'orange') return { kind: 'cadence', label, tone: 'orange', score: 300 };
    return null;
  }
  // Waiting on the client: the quiet/stale timer is paused (it's not your delay).
  if (waiting) return due === 1 ? { kind: 'due', label: 'Due tomorrow', tone: 'orange', score: 400 } : null;
  if (quiet >= STALE_DAYS) return { kind: 'stale', label: `No update in ${quiet} days`, tone: 'red', score: 500 + quiet };
  if (due === 1) return { kind: 'due', label: 'Due tomorrow', tone: 'orange', score: 400 };
  if (quiet >= QUIET_DAYS) return { kind: 'stale', label: `${quiet} days quiet`, tone: 'orange', score: 100 + quiet };
  return null;
}

export function formatDue(dueDate: string, todayKey: string) {
  const d = Math.round((keyToDate(dueDate).getTime() - keyToDate(todayKey).getTime()) / DAY_MS);
  const date = keyToDate(dueDate);
  const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (d < 0) return `Overdue · ${short}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d < 7) return `Due ${date.toLocaleDateString('en-US', { weekday: 'short' })}`;
  return `Due ${short}`;
}

// On-track tasks: soonest due first, then the ones touched longest ago.
export function byDueThenOldest(a: Task, b: Task) {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return new Date(a.last_updated).getTime() - new Date(b.last_updated).getTime();
}

export interface DayActivity {
  added: Task[];
  completed: Task[];
  due: Task[];
  logs: { task: Task; update: TaskUpdate }[];
}

export const emptyDay = (): DayActivity => ({ added: [], completed: [], due: [], logs: [] });

// Everything that happened (or is due) on each local day, keyed by dayKey.
export function buildActivity(tasks: Task[]) {
  const map = new Map<string, DayActivity>();
  const get = (key: string) => {
    let day = map.get(key);
    if (!day) map.set(key, (day = emptyDay()));
    return day;
  };
  for (const task of tasks) {
    get(dayKey(task.created_at)).added.push(task);
    if (task.done && task.completed_at) get(dayKey(task.completed_at)).completed.push(task);
    if (task.due_date) get(task.due_date).due.push(task);
    for (const update of task.task_updates) get(dayKey(update.created_at)).logs.push({ task, update });
  }
  return map;
}

// Shared marker colors for day activity (calendar + week strip).
export const ACTIVITY_COLORS = {
  added: 'bg-[var(--text-main)]',
  logged: 'bg-[var(--accent)]',
  completed: 'bg-emerald-400',
  due: 'border border-[var(--text-main)]',
};

export type Tone = 'green' | 'waiting' | 'orange' | 'red';

export interface Timer {
  progress: number; // 0..1, how much of the task's time has run out
  tone: Tone;
  label: string;
}

const TONE_RANK: Record<Tone, number> = { green: 0, waiting: 0, orange: 1, red: 2 };

// Ring timer for an active task: the more urgent of (a) time elapsed toward the due date
// and (b) time since the last update toward the stale threshold.
export function timerFor(task: Task, now: number, todayKey: string, scope?: RhythmScope): Timer {
  const quietMs = now - new Date(task.last_updated).getTime();
  const quietDays = Math.max(0, Math.floor(quietMs / DAY_MS));
  const cadence = cadenceFor(task, todayKey, scope);
  const waiting = !!task.waiting_since;
  // Waiting on the client pauses the quiet timer; only nudge days and deadlines still count.
  let progress = cadence ? cadence.progress : waiting ? 0 : Math.min(1, Math.max(0, quietMs / (STALE_DAYS * DAY_MS)));
  let tone: Tone = cadence
    ? waiting && cadence.tone === 'green'
      ? 'waiting'
      : cadence.tone
    : waiting
      ? 'waiting'
      : quietDays >= STALE_DAYS
        ? 'red'
        : quietDays >= QUIET_DAYS
          ? 'orange'
          : 'green';
  const parts = [
    cadence ? cadence.label : quietDays === 0 ? 'Updated today' : `No update for ${quietDays} day${quietDays === 1 ? '' : 's'}`,
  ];
  if (waiting) parts.unshift(`Waiting on client${task.waiting_for ? `: ${task.waiting_for}` : ''}`);

  const due = daysUntilDue(task, todayKey);
  if (due !== null && task.due_date) {
    const start = new Date(task.created_at).getTime();
    const end = keyToDate(task.due_date).getTime() + DAY_MS; // end of the due day
    const dueProgress = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
    const dueTone: Tone = due <= 0 ? 'red' : due === 1 || dueProgress >= 0.75 ? 'orange' : 'green';
    progress = Math.max(progress, dueProgress);
    if (TONE_RANK[dueTone] > TONE_RANK[tone]) tone = dueTone;
    parts.unshift(formatDue(task.due_date, todayKey));
  }
  // A full ring means the time is up: always red, whatever the individual rules said.
  if (progress >= 0.999) tone = 'red';
  return { progress, tone, label: parts.join(' · ') };
}

// Typographic urgency: a task's title grows bigger and bolder as its time runs out.
// Eased so fresh tasks stay quiet and only the pressing ones get loud (16px/300 → 36px/700).
export function urgencyType(progress: number): CSSProperties {
  const u = Math.pow(Math.min(1, Math.max(0, progress)), 1.4);
  return {
    fontSize: `calc(var(--title-base) + ${u.toFixed(3)} * var(--title-grow))`, // see index.css (smaller on phones)
    fontWeight: Math.round(300 + u * 400),
    letterSpacing: `${(-0.005 - u * 0.025).toFixed(3)}em`,
    lineHeight: 1.15,
  };
}
