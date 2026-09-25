import type { Task } from '../types';
import { addDays, dayKey, keyToDate, startOfWeek } from './dates';
import type { RhythmScope } from './handles';

// A rhythm task needs N check-ins (logged updates) per Monday–Sunday week, with at least one full day
// between them: Tue + Thu or Mon + Fri count as two; Tue + Wed counts as one.
// Check-ins are only expected on working days: not Sundays, and not the 2nd or 4th Saturday of the month.
export const MIN_GAP_DAYS = 2;
export const DEFAULT_CADENCE = 2;
export const CADENCE_OPTIONS = [1, 2, 3] as const;

export function isWorkingDay(d: Date) {
  const dow = d.getDay();
  if (dow === 0) return false;
  if (dow === 6) {
    const nth = Math.ceil(d.getDate() / 7); // which Saturday of the month
    return nth !== 2 && nth !== 4;
  }
  return true;
}

export interface CadenceState {
  target: number;
  perWeek: number; // the full weekly rhythm; target is lower in the week a task was added
  count: number; // spaced check-ins this week
  checkIns: string[]; // day keys that counted this week
  tone: 'green' | 'orange' | 'red';
  progress: number; // 0..1, how much of the window for the next check-in has run out
  label: string; // why it's this colour
  nextFrom: string | null; // earliest working day the next check-in counts (null when complete or impossible)
  latest: string | null; // last working day the next check-in can happen and still fit the week
}

const diffDays = (a: string, b: string) => Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / 86_400_000);
const shift = (key: string, days: number) => dayKey(addDays(keyToDate(key), days));
const weekday = (key: string) => keyToDate(key).toLocaleDateString('en-US', { weekday: 'short' });
const working = (key: string) => isWorkingDay(keyToDate(key));

function workingOnOrAfter(key: string, limit: string) {
  for (let k = key; k <= limit; k = shift(k, 1)) if (working(k)) return k;
  return null;
}

function workingOnOrBefore(key: string, limit: string) {
  for (let k = key; k >= limit; k = shift(k, -1)) if (working(k)) return k;
  return null;
}

function workingDaysBetween(from: string, to: string) {
  let n = 0;
  for (let k = from; k <= to; k = shift(k, 1)) if (working(k)) n++;
  return n;
}

// With a scope, the rhythm belongs to the client: only its lead task carries it, and a log on any of the
// client's tasks counts as the check-in.
export function cadenceFor(task: Task, todayKey: string, scope?: RhythmScope): CadenceState | null {
  if (scope && !scope.isLead) return null;
  const perWeek = task.cadence_per_week;
  if (!perWeek) return null;
  // While waiting on the client, check-ins are nudges asking for what's pending.
  const verb = task.waiting_since ? 'Nudge' : 'Check in';

  const monday = startOfWeek(keyToDate(todayKey));
  const weekStart = dayKey(monday);
  const weekEnd = dayKey(addDays(monday, 6));

  // A task added mid-week only owes the check-ins that still fit from the day after it was added.
  const firstOwed = task.created_at ? shift(dayKey(task.created_at), 1) : weekStart;
  const activeFrom = firstOwed > weekStart ? firstOwed : weekStart;
  let fits = 0;
  for (let k = workingOnOrAfter(activeFrom, weekEnd); k && fits < perWeek; k = workingOnOrAfter(shift(k, MIN_GAP_DAYS), weekEnd)) fits++;
  const target = Math.min(perWeek, fits);
  if (target === 0) {
    return { perWeek, target: 0, count: 0, checkIns: [], tone: 'green', progress: 0, label: 'Added late this week. Check-ins start next week', nextFrom: null, latest: null };
  }

  const updates = (scope ? scope.logsFrom : [task]).flatMap((t) => t.task_updates);
  const days = [...new Set(updates.map((u) => dayKey(u.created_at)))].filter((d) => d <= todayKey).sort();

  // The gap applies across the week boundary too (Sat then Mon is fine; Sun then Mon is not).
  let last = days.filter((d) => d < weekStart).at(-1) ?? null;
  const checkIns: string[] = [];
  for (const d of days.filter((d) => d >= weekStart)) {
    if (!last || diffDays(last, d) >= MIN_GAP_DAYS) {
      checkIns.push(d);
      last = d;
    }
  }

  const count = checkIns.length;
  const remaining = Math.max(0, target - count);
  const base = { target, perWeek, count, checkIns };

  if (remaining === 0) {
    return { ...base, tone: 'green', progress: 0, label: `${count}/${target} this week. All caught up`, nextFrom: null, latest: null };
  }

  const earliest = last ? shift(last, MIN_GAP_DAYS) : activeFrom;
  const nextFrom = workingOnOrAfter(earliest > todayKey ? earliest : todayKey, weekEnd);

  // Latest schedule that still fits: place the remaining check-ins on working days from the end of the week.
  let latest: string | null = null;
  let cursor: string | null = weekEnd;
  for (let i = 0; i < remaining && cursor; i++) {
    latest = workingOnOrBefore(cursor, weekStart);
    cursor = latest ? shift(latest, -MIN_GAP_DAYS) : null;
  }

  // Nothing more fits this week (e.g. you just checked in and the rest of the week is off): nothing to act
  // on until next week, so no alarm. Insights still count the missed one.
  if (!nextFrom) {
    const nextWeek = workingOnOrAfter(shift(weekEnd, 1), shift(weekEnd, 7));
    return {
      ...base,
      tone: 'green',
      progress: 0,
      label: `${count}/${target} this week (${remaining} missed). Next ${task.waiting_since ? 'nudge' : 'check-in'} ${nextWeek ? weekday(nextWeek) : 'next week'}`,
      nextFrom: null,
      latest: null,
    };
  }

  // Behind but one still fits today: do it now.
  if (!latest || nextFrom > latest) {
    return {
      ...base,
      tone: 'red',
      progress: 1,
      label: `${count}/${target} this week. Behind; ${verb.toLowerCase()} as soon as you can`,
      nextFrom,
      latest,
    };
  }

  // Too soon since the last check-in (or today is a day off): nothing to do yet.
  if (nextFrom > todayKey) {
    return {
      ...base,
      tone: 'green',
      progress: 0,
      label: `${count}/${target} this week. Next ${task.waiting_since ? 'nudge' : 'check-in'} from ${weekday(nextFrom)}`,
      nextFrom,
      latest,
    };
  }

  const windowStart = earliest < weekStart ? weekStart : earliest;
  const total = Math.max(1, workingDaysBetween(windowStart, latest));
  const used = workingDaysBetween(windowStart, todayKey);
  const nextWorking = workingOnOrAfter(shift(todayKey, 1), weekEnd);
  const tone = latest === todayKey ? 'red' : latest === nextWorking ? 'orange' : 'green';
  const by =
    latest === todayKey ? 'today' : latest === shift(todayKey, 1) ? 'tomorrow' : `by ${weekday(latest)}`;
  return {
    ...base,
    tone,
    progress: Math.min(1, used / total),
    label: `${count}/${target} this week. ${verb} ${by}`,
    nextFrom,
    latest,
  };
}

export const cadenceName = (n: number) => (n === 1 ? 'Once a week' : n === 2 ? 'Twice a week' : `${n}× a week`);
export const CADENCE_RULE = 'a day between, Mon–Sat, 2nd & 4th Sat off';
