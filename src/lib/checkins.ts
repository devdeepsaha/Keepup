import type { Task } from '../types';
import { addDays, dayKey, keyToDate, startOfWeek } from './dates';
import { isWorkingDay, MIN_GAP_DAYS } from './cadence';
import { groupClients } from './handles';

// Client check-ins week by week, past and future: which were logged, which were missed, and which are
// planned under the rhythm. Feeds the calendar markers, the year heatmap and the stats.

export type MarkState = 'done' | 'planned' | 'late' | 'missed';

export interface Mark {
  client: string; // client key (also its @tag)
  name: string;
  state: MarkState;
  nudge: boolean; // waiting on the client: the check-in is a nudge
}

export interface ClientWeek {
  weekStart: string;
  target: number; // check-ins owed this week (prorated for partial weeks)
  checkIns: string[]; // days that counted
  planned: string[]; // this week and later: days the remaining check-ins are planned for
  late: boolean; // this week: the remaining check-ins no longer fit
  missed: string[]; // past weeks: the days check-ins were owed but not made
  status: 'met' | 'partial' | 'missed' | 'pending';
}

export interface ClientHistory {
  key: string;
  name: string;
  tasks: Task[];
}

export const shiftKey = (key: string, days: number) => dayKey(addDays(keyToDate(key), days));
const working = (key: string) => isWorkingDay(keyToDate(key));
export const mondayOf = (key: string) => dayKey(startOfWeek(keyToDate(key)));
const daysApart = (a: string, b: string) => Math.round(Math.abs(keyToDate(b).getTime() - keyToDate(a).getTime()) / 86_400_000);
const FAR = '9999-12-31';

// Preferred days for each rhythm (0 = Monday): once → Wed; twice → Tue + Fri; three times → Mon, Wed, Fri.
const IDEAL: Record<number, number[]> = { 1: [2], 2: [1, 4], 3: [0, 2, 4] };
const offsetOf = (key: string) => (keyToDate(key).getDay() + 6) % 7;

// How many spaced check-ins fit from `from` to `to`.
function fitsFrom(from: string, to: string, limit = 7) {
  let n = 0;
  for (let k = from; k <= to && n < limit; ) {
    if (working(k)) {
      n++;
      k = shiftKey(k, MIN_GAP_DAYS);
    } else k = shiftKey(k, 1);
  }
  return n;
}

// Plan n check-ins between from and to, on the rhythm's preferred days wherever the rest still fits.
function place(n: number, from: string, to: string, perWeek: number) {
  const ideal = IDEAL[perWeek] ?? [];
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i < n; i++) {
    const candidates: string[] = [];
    for (let k = cursor; k <= to; k = shiftKey(k, 1)) {
      if (working(k) && fitsFrom(shiftKey(k, MIN_GAP_DAYS), to) >= n - i - 1) candidates.push(k);
    }
    const pick = candidates.find((k) => ideal.includes(offsetOf(k))) ?? candidates[0];
    if (!pick) break;
    out.push(pick);
    cursor = shiftKey(pick, MIN_GAP_DAYS);
  }
  return out;
}

const startDay = (t: Task) => dayKey(t.created_at);
// The day a task stopped needing check-ins: completed or archived. Open tasks run on.
const endDay = (t: Task) => (t.done && t.completed_at ? dayKey(t.completed_at) : t.archived_at ? dayKey(t.archived_at) : FAR);

// Every client that ever had a task (done and archived included), for history.
export function clientHistories(history: Task[]): ClientHistory[] {
  return [...groupClients(history.filter((t) => !t.deleted_at), true).values()].map((g) => ({
    key: g.key,
    name: g.name,
    tasks: g.tasks,
  }));
}

export function clientWeek(client: ClientHistory, weekStart: string, todayKey: string): ClientWeek | null {
  const weekEnd = shiftKey(weekStart, 6);
  const open = client.tasks.filter((t) => startDay(t) <= weekEnd && endDay(t) >= weekStart);
  if (!open.length) return null;
  const perWeek = open[0].cadence_per_week; // the oldest open task carries the client's rhythm
  if (!perWeek) return null;

  // Owed from the day after the first task was added, until the client's work ended.
  const firstOwed = shiftKey(open.map(startDay).sort()[0], 1);
  const activeFrom = firstOwed > weekStart ? firstOwed : weekStart;
  const lastEnd = open.map(endDay).sort().at(-1)!;
  const activeTo = lastEnd < weekEnd ? lastEnd : weekEnd;
  if (activeFrom > activeTo) return null;
  const target = Math.min(perWeek, fitsFrom(activeFrom, activeTo, perWeek));
  if (!target) return null;

  // Check-ins: log days a day apart (the gap carries over from the previous week).
  const days = [...new Set(client.tasks.flatMap((t) => t.task_updates.map((u) => dayKey(u.created_at))))]
    .filter((d) => d <= todayKey)
    .sort();
  let last = days.filter((d) => d < weekStart).at(-1) ?? null;
  const checkIns: string[] = [];
  for (const d of days.filter((d) => d >= weekStart && d <= weekEnd)) {
    if (!last || daysApart(last, d) >= MIN_GAP_DAYS) {
      checkIns.push(d);
      last = d;
    }
  }
  const remaining = Math.max(0, target - checkIns.length);
  const base = { weekStart, target, checkIns, planned: [] as string[], late: false, missed: [] as string[] };

  if (remaining === 0) return { ...base, status: 'met' };

  if (weekEnd < todayKey) {
    // Past week: mark the owed days that had no check-in near them.
    const plan = place(target, activeFrom, activeTo, perWeek);
    const missed = plan.filter((d) => !checkIns.some((c) => daysApart(c, d) < MIN_GAP_DAYS)).slice(-remaining);
    return { ...base, missed, status: checkIns.length ? 'partial' : 'missed' };
  }

  // This week or a later one: plan what's left from today (or the gap after the last check-in).
  const afterLast = last ? shiftKey(last, MIN_GAP_DAYS) : activeFrom;
  const from = [activeFrom, afterLast, todayKey].sort().at(-1)!;
  // Behind: plan as many as still fit (the first one is late); if none fit, today is.
  const fit = Math.min(remaining, fitsFrom(from, activeTo, remaining));
  const late = fit < remaining;
  const planned = place(fit, from, activeTo, late ? 0 : perWeek); // behind: as soon as possible, not the usual days
  if (late && !planned.length && working(todayKey) && todayKey >= weekStart && todayKey <= weekEnd) planned.push(todayKey);
  return { ...base, planned, late, status: 'pending' };
}

// Check-in markers per day for the given range.
export function checkInMarks(history: Task[], fromKey: string, toKey: string, todayKey: string) {
  const marks = new Map<string, Mark[]>();
  const add = (day: string, m: Mark) => {
    if (day < fromKey || day > toKey) return;
    const list = marks.get(day);
    if (list) list.push(m);
    else marks.set(day, [m]);
  };
  for (const client of clientHistories(history)) {
    const nudge = client.tasks.some((t) => !t.done && !t.archived_at && t.waiting_since);
    for (let w = mondayOf(fromKey); w <= toKey; w = shiftKey(w, 7)) {
      const week = clientWeek(client, w, todayKey);
      if (!week) continue;
      const mark = (state: MarkState): Mark => ({ client: client.key, name: client.name, state, nudge: (state === 'planned' || state === 'late') && nudge });
      week.checkIns.forEach((d) => add(d, mark('done')));
      week.missed.forEach((d) => add(d, mark('missed')));
      week.planned.forEach((d, i) => add(d, mark(week.late && i === 0 ? 'late' : 'planned')));
    }
  }
  return marks;
}
