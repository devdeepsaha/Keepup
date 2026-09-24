import type { Task, TaskUpdate } from '../types';
import { dayKey } from './dates';
import { clientHistories, clientWeek, mondayOf, shiftKey, type ClientHistory, type ClientWeek } from './checkins';

// Numbers behind the Insights views: the year heatmap, per-client consistency, and range stats.

export interface LogEntry {
  task: Task;
  update: TaskUpdate;
  day: string;
}

export function allLogs(history: Task[], fromKey: string, toKey: string): LogEntry[] {
  return history
    .filter((t) => !t.deleted_at)
    .flatMap((task) => task.task_updates.map((update) => ({ task, update, day: dayKey(update.created_at) })))
    .filter((l) => l.day >= fromKey && l.day <= toKey);
}

// Updates per day across a year.
export function dailyCounts(history: Task[], year: number) {
  const counts = new Map<string, number>();
  for (const l of allLogs(history, `${year}-01-01`, `${year}-12-31`)) counts.set(l.day, (counts.get(l.day) ?? 0) + 1);
  return counts;
}

// Every Monday whose week touches the range.
export function weeksIn(fromKey: string, toKey: string) {
  const weeks: string[] = [];
  for (let w = mondayOf(fromKey); w <= toKey; w = shiftKey(w, 7)) weeks.push(w);
  return weeks;
}

export interface ClientRow {
  client: ClientHistory;
  weeks: (ClientWeek | null)[]; // one per week in the range; null when the client had no rhythm that week
  met: number;
  owed: number; // weeks with a rhythm, finished or already met
}

// Per client: how each week of the range went.
export function consistency(history: Task[], fromKey: string, toKey: string, todayKey: string): ClientRow[] {
  const weeks = weeksIn(fromKey, toKey);
  return clientHistories(history)
    .map((client) => {
      const rows = weeks.map((w) => (w > todayKey ? null : clientWeek(client, w, todayKey)));
      const settled = rows.filter((r): r is ClientWeek => !!r && (r.status !== 'pending' || r.checkIns.length >= r.target));
      return { client, weeks: rows, met: settled.filter((r) => r.status === 'met').length, owed: settled.length };
    })
    .filter((r) => r.weeks.some(Boolean));
}

export interface RangeStats {
  logs: number;
  added: number;
  completed: number;
  onTime: { made: number; owed: number }; // check-ins made vs owed, finished weeks (and this week once met)
  weeksAllMet: { met: number; total: number }; // weeks where every client got its check-ins
  gaps: { client: ClientHistory; avg: number | null; updates: number; last: string | null }[]; // avg days between updates
  weekdays: number[]; // Mon..Sun
  hours: number[]; // 0..23
  medianMinute: number | null; // minute of the day, e.g. 690 = 11:30
}

export function rangeStats(history: Task[], fromKey: string, toKey: string, todayKey: string): RangeStats {
  const live = history.filter((t) => !t.deleted_at);
  const end = toKey < todayKey ? toKey : todayKey;
  const logs = allLogs(live, fromKey, end);

  const weekdays = Array(7).fill(0);
  const hours = Array(24).fill(0);
  const minutes: number[] = [];
  for (const l of logs) {
    const d = new Date(l.update.created_at);
    weekdays[(d.getDay() + 6) % 7]++;
    hours[d.getHours()]++;
    minutes.push(d.getHours() * 60 + d.getMinutes());
  }
  minutes.sort((a, b) => a - b);

  // Check-ins on time, per client-week.
  let made = 0;
  let owed = 0;
  const perWeek = new Map<string, { met: boolean; any: boolean }>();
  const clients = clientHistories(live);
  for (const client of clients) {
    for (const w of weeksIn(fromKey, end)) {
      const week = clientWeek(client, w, todayKey);
      if (!week) continue;
      const finished = shiftKey(w, 6) < todayKey || week.status === 'met';
      if (!finished) continue;
      owed += week.target;
      made += Math.min(week.checkIns.length, week.target);
      const s = perWeek.get(w) ?? { met: true, any: false };
      perWeek.set(w, { met: s.met && week.status === 'met', any: true });
    }
  }
  const settledWeeks = [...perWeek.values()].filter((s) => s.any);

  // Average gap between update days, per client.
  const gaps = clients
    .map((client) => {
      const ids = new Set(client.tasks.map((t) => t.id));
      const days = [...new Set(logs.filter((l) => ids.has(l.task.id)).map((l) => l.day))].sort();
      let total = 0;
      for (let i = 1; i < days.length; i++) total += (new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / 86_400_000;
      return { client, avg: days.length > 1 ? total / (days.length - 1) : null, updates: days.length, last: days.at(-1) ?? null };
    })
    .filter((g) => g.updates > 0)
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  return {
    logs: logs.length,
    added: live.filter((t) => dayKey(t.created_at) >= fromKey && dayKey(t.created_at) <= end).length,
    completed: live.filter((t) => t.done && t.completed_at && dayKey(t.completed_at) >= fromKey && dayKey(t.completed_at) <= end).length,
    onTime: { made, owed },
    weeksAllMet: { met: settledWeeks.filter((s) => s.met).length, total: settledWeeks.length },
    gaps,
    weekdays,
    hours,
    medianMinute: minutes.length ? minutes[Math.floor(minutes.length / 2)] : null,
  };
}

export const formatMinute = (m: number) =>
  new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
