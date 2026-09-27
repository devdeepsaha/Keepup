import { createContext, useContext, useMemo, useState } from 'react';
import { DayPicker, type DateRange, type DayButtonProps, type ChevronProps } from 'react-day-picker';
import type { Task, TaskUpdate } from '../types';
import { addDays, dayKey, keyToDate, startOfWeek } from '../lib/dates';
import { buildActivity, type DayActivity } from '../lib/tasks';
import { isWorkingDay } from '../lib/cadence';
import { checkInMarks, clientHistories, type Mark } from '../lib/checkins';
import { clientKeyOf, monograms } from '../lib/handles';
import { useClientColors } from '../lib/clientColors';

// Month calendar (react-day-picker). Each day shows your clients as the same letter tiles as the sidebar:
// solid = updated, dashed = update planned, red outline = missed. The side panel tells the day's story per client.

interface Props {
  tasks: Task[];
  loading: boolean;
  initialDay?: string;
  onToggle: (id: string, done: boolean) => void;
}

type ClientState = 'updated' | 'planned' | 'late' | 'missed';

// Everything about one client on one day.
interface ClientDay {
  key: string;
  name: string;
  state: ClientState;
  nudge: boolean;
  logs: { task: Task; update: TaskUpdate }[];
  planned: string[]; // titles of planned client updates due that day
}

interface DayInfo {
  clients: ClientDay[];
  completed: Task[];
  due: Task[];
  added: Task[];
}

const STATE_RANK: Record<ClientState, number> = { missed: 0, late: 1, updated: 2, planned: 3 };
const STATE_TEXT: Record<ClientState, string> = { updated: 'Updated', planned: 'Update planned', late: 'Update overdue', missed: 'Missed update' };

function buildDays(tasks: Task[], activity: Map<string, DayActivity>, marks: Map<string, Mark[]>, fromKey: string, toKey: string) {
  const names = new Map(clientHistories(tasks).map((c) => [c.key, c.name]));
  const days = new Map<string, DayInfo>();
  const get = (k: string) => {
    let d = days.get(k);
    if (!d) days.set(k, (d = { clients: [], completed: [], due: [], added: [] }));
    return d;
  };
  const client = (k: string, key: string, state: ClientState) => {
    const d = get(k);
    let c = d.clients.find((x) => x.key === key);
    if (!c) d.clients.push((c = { key, name: names.get(key) ?? key, state, nudge: false, logs: [], planned: [] }));
    else if (STATE_RANK[state] < STATE_RANK[c.state]) c.state = state;
    return c;
  };
  for (const [k, a] of activity) {
    if (k < fromKey || k > toKey) continue;
    for (const l of a.logs) client(k, clientKeyOf(l.task), 'updated').logs.push(l);
    const d = get(k);
    d.completed.push(...a.completed);
    d.due.push(...a.due);
    d.added.push(...a.added);
  }
  for (const [k, list] of marks) {
    for (const m of list) {
      if (m.state === 'done') continue; // covered by the logs
      const c = client(k, m.client, m.state === 'missed' ? 'missed' : m.state === 'late' ? 'late' : 'planned');
      c.nudge = c.nudge || m.nudge;
    }
  }
  for (const task of tasks)
    for (const p of task.planned_updates ?? []) {
      if (p.status !== 'planned' || p.send_on < fromKey || p.send_on > toKey) continue;
      client(p.send_on, clientKeyOf(task), 'planned').planned.push(p.title);
    }
  for (const d of days.values()) d.clients.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name));
  return days;
}

// Data the day cells need, without re-creating the cell component each render.
const CalendarData = createContext<{ days: Map<string, DayInfo>; initials: Map<string, string> }>({ days: new Map(), initials: new Map() });

// A client's letter tile, as in the sidebar.
function Tile({ label, color, state, size = 16, onGradient = false }: { label: string; color: string; state: ClientState; size?: number; onGradient?: boolean }) {
  const red = state === 'missed' || state === 'late';
  const solid = state === 'updated';
  const c = onGradient ? '#ffffff' : red ? '#ef4444' : color;
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-[4px] font-display font-bold leading-none"
      style={{
        height: size,
        minWidth: size,
        padding: '0 2px',
        fontSize: size * 0.56,
        background: solid ? (onGradient ? 'rgba(255,255,255,0.95)' : color) : 'transparent',
        color: solid ? (onGradient ? '#1b5fd6' : '#ffffff') : c,
        border: solid ? undefined : `1.5px ${state === 'planned' ? 'dashed' : 'solid'} ${c}`,
        opacity: state === 'planned' && !onGradient ? 0.85 : 1,
      }}
    >
      {label}
    </span>
  );
}

function DayCell({ day, modifiers, className: _className, ...props }: DayButtonProps) {
  const { days, initials } = useContext(CalendarData);
  const { colorOf } = useClientColors();
  const info = days.get(dayKey(day.date));
  const edge = modifiers.range_start || modifiers.range_end || (modifiers.selected && !modifiers.range_middle);
  const middle = modifiers.range_middle && !edge;
  const clients = info?.clients ?? [];
  const extra = clients.length - 2;

  return (
    <button
      {...props}
      className={`group relative flex h-full w-full flex-col items-center gap-1 rounded-xl pt-1 pb-1 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#257ef4] cursor-pointer ${
        edge ? 'bg-accent-gradient text-white shadow-md shadow-[#257ef4]/30' : middle ? 'bg-[var(--accent-soft)]' : 'hover:bg-[#257ef4]/[0.08]'
      } ${modifiers.outside ? 'opacity-30' : ''}`}
    >
      <span
        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-display text-[0.8125rem] tabular-nums sm:h-7 sm:min-w-7 sm:text-sm ${
          modifiers.today && !edge ? 'bg-accent-gradient font-semibold text-white' : modifiers.off && !edge ? 'text-[var(--text-muted)]' : 'font-medium'
        }`}
      >
        {day.date.getDate()}
      </span>
      {clients.length > 0 && (
        <span className="flex items-center gap-[3px]">
          {clients.slice(0, 2).map((c) => (
            <Tile key={c.key} label={initials.get(c.key) ?? c.name[0]} color={colorOf(c.key)} state={c.state} onGradient={!!edge} />
          ))}
          {extra > 0 && <span className={`font-display text-[0.5625rem] ${edge ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>+{extra}</span>}
        </span>
      )}
      {!!info?.completed.length && (
        <span className={`hidden font-display text-[0.5625rem] sm:block ${edge ? 'text-white/85' : 'text-emerald-600'}`}>✓ {info.completed.length} done</span>
      )}
    </button>
  );
}

function Chevron({ orientation = 'left', className }: ChevronProps) {
  const d = { left: 'M15 18l-6-6 6-6', right: 'M9 6l6 6-6 6', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6' }[orientation];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className ?? ''}`}>
      <path d={d} />
    </svg>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', opts);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A log's text, without the app's "Sent client update (…):" prefix, clamped until tapped.
function LogText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clean = text.replace(/^Sent client update(?: \([^)]*\))?:\s*/, '');
  return (
    <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left cursor-pointer">
      <span className={`block text-sm leading-snug text-[var(--text-main)] ${open ? '' : 'line-clamp-2'}`}>{clean}</span>
    </button>
  );
}

function StatusPill({ state, nudge }: { state: ClientState; nudge: boolean }) {
  const cls =
    state === 'updated'
      ? 'bg-emerald-500/10 text-emerald-600'
      : state === 'planned'
        ? 'bg-[var(--accent-soft)] text-[#257ef4]'
        : 'bg-red-500/10 text-red-500';
  const text = nudge && state !== 'updated' ? STATE_TEXT[state].replace('Update', 'Nudge').replace('update', 'nudge') : STATE_TEXT[state];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 font-display text-[0.6875rem] font-medium ${cls}`}>{text}</span>;
}

// One day's story: clients first (what you told whom), then tasks.
function DayStory({ info, dayKeyStr, todayKey, initials, onToggle }: { info: DayInfo; dayKeyStr: string; todayKey: string; initials: Map<string, string>; onToggle: Props['onToggle'] }) {
  const { colorOf } = useClientColors();
  const taskRow = (t: Task, label: string, tone: string) => (
    <li key={`${label}${t.id}`} className="flex items-center gap-2.5 py-1.5 text-sm">
      <button
        aria-label={t.done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => onToggle(t.id, !t.done)}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] cursor-pointer ${
          t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--text-main)] hover:bg-[var(--text-main)]'
        }`}
      >
        {t.done && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </button>
      <span className={`min-w-0 flex-1 truncate ${t.done ? 'text-[var(--text-muted)] line-through' : ''}`}>{t.text}</span>
      <span className={`shrink-0 font-display text-[0.6875rem] ${tone}`}>{label}</span>
    </li>
  );
  const tasks = [
    ...info.completed.map((t) => taskRow(t, 'completed', 'text-emerald-600')),
    ...info.due.map((t) => taskRow(t, t.done ? 'was due' : dayKeyStr < todayKey ? 'overdue' : 'due', !t.done && dayKeyStr < todayKey ? 'text-red-500' : 'text-amber-600')),
    ...info.added.map((t) => taskRow(t, 'added', 'text-[var(--text-muted)]')),
  ];

  return (
    <div className="space-y-4">
      {info.clients.length > 0 && (
        <ul className="space-y-2">
          {info.clients.map((c) => (
            <li key={c.key} className="rounded-xl border border-[var(--line-color)] p-3">
              <div className="flex items-center gap-2.5">
                <Tile label={initials.get(c.key) ?? c.name[0]} color={colorOf(c.key)} state={c.state} size={20} />
                <span className="min-w-0 flex-1 truncate font-display font-medium">{c.name}</span>
                <StatusPill state={c.state} nudge={c.nudge} />
              </div>
              {c.planned.length > 0 && (
                <p className="mt-2 pl-[30px] text-sm text-[var(--text-muted)]">
                  Planned: <span className="text-[var(--text-main)]">{c.planned.join(', ')}</span>
                </p>
              )}
              {c.logs.length > 0 && (
                <ul className="mt-2 space-y-2 pl-[30px]">
                  {c.logs.map(({ update }) => (
                    <li key={update.id} className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <LogText text={update.text} />
                      </div>
                      <span className="shrink-0 pt-0.5 font-display text-[0.6875rem] text-[var(--text-muted)]">{timeOf(update.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 && (
        <div>
          <div className="mb-1 font-display text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Tasks</div>
          <ul className="divide-y divide-[var(--line-color)]/60">{tasks}</ul>
        </div>
      )}
    </div>
  );
}

// One line that says what the selection holds.
function summarise(infos: DayInfo[], future: boolean) {
  const updated = new Set<string>();
  const planned = new Set<string>();
  const missed = new Set<string>();
  let completed = 0;
  let due = 0;
  for (const d of infos) {
    for (const c of d.clients) (c.state === 'updated' ? updated : c.state === 'planned' ? planned : missed).add(c.key);
    completed += d.completed.length;
    due += d.due.filter((t) => !t.done).length;
  }
  const parts = [
    updated.size && `${plural(updated.size, 'client')} updated`,
    planned.size && `${plural(planned.size, 'update')} planned`,
    missed.size && `${missed.size} missed`,
    completed && `${plural(completed, 'task')} done`,
    due && `${due} due`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : future ? 'Nothing planned yet.' : 'A quiet day.';
}

export default function CalendarView({ tasks, loading, initialDay, onToggle }: Props) {
  const todayKey = dayKey(new Date());
  const today = keyToDate(todayKey);
  const start = initialDay ? keyToDate(initialDay) : today;
  const [range, setRange] = useState<DateRange | undefined>({ from: start, to: start });
  const [month, setMonth] = useState<Date>(new Date(start.getFullYear(), start.getMonth(), 1));
  const from = range?.from ?? today;
  const to = range?.to ?? from;
  const fromKey = dayKey(from);
  const toKey = dayKey(to);
  const single = fromKey === toKey;

  // Everything shown: the visible month (plus spill-over days) and the selection.
  const monthKey = dayKey(month);
  const days = useMemo(() => {
    const first = dayKey(addDays(month, -7));
    const last = dayKey(addDays(new Date(month.getFullYear(), month.getMonth() + 1, 0), 14));
    const lo = fromKey < first ? fromKey : first;
    const hi = toKey > last ? toKey : last;
    return buildDays(tasks, buildActivity(tasks), checkInMarks(tasks, lo, hi, todayKey), lo, hi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, monthKey, fromKey, toKey, todayKey]);
  const initials = useMemo(() => monograms(clientHistories(tasks).map((c) => [c.key, c.name])), [tasks]);
  const ctx = useMemo(() => ({ days, initials }), [days, initials]);

  // The selection, newest day first (capped so a huge range stays fast).
  const selected = useMemo(() => {
    const keys: string[] = [];
    for (let d = keyToDate(toKey); dayKey(d) >= fromKey && keys.length < 92; d = addDays(d, -1)) keys.push(dayKey(d));
    return keys.map((k) => ({ key: k, info: days.get(k) })).filter((x): x is { key: string; info: DayInfo } => !!x.info);
  }, [days, fromKey, toKey]);

  const select = (a: Date, b: Date = a) => {
    setRange({ from: a, to: b });
    setMonth(new Date(b.getFullYear(), b.getMonth(), 1));
  };
  const monday = startOfWeek(today);
  const presets: { label: string; from: Date; to: Date }[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Next week', from: addDays(monday, 7), to: addDays(monday, 13) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) },
  ];

  const title = single
    ? fromKey === todayKey
      ? 'Today'
      : fmt(from, { weekday: 'long', month: 'long', day: 'numeric' })
    : `${fmt(from, { month: 'short', day: 'numeric' })} – ${fmt(to, { month: 'short', day: 'numeric' })}`;
  const summary = summarise(
    selected.map((s) => s.info),
    fromKey > todayKey,
  );

  const legendTile = (state: ClientState, label: string) => (
    <span className="flex items-center gap-1.5">
      <Tile label="T" color="#14b8a6" state={state} />
      {label}
    </span>
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-8 md:px-8 lg:px-10">
      {/* Pinned: the month, Today and the quick ranges stay put while you scroll */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 bg-[var(--bg-color)]/95 px-4 pt-2 pb-3 backdrop-blur md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
      <header className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-accent-gradient">Calendar</div>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {fmt(month, { month: 'long' })} <span className="text-[var(--text-muted)]">{month.getFullYear()}.</span>
          </h1>
        </div>
        <button
          onClick={() => select(today)}
          className="h-9 shrink-0 rounded-full bg-accent-gradient px-4 font-display text-xs font-semibold text-white shadow-sm shadow-[#257ef4]/30 hover:opacity-95 cursor-pointer"
        >
          Today
        </button>
      </header>

      {/* Quick ranges: one row, swipe sideways on phones */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {presets.map((p) => {
          const active = dayKey(p.from) === fromKey && dayKey(p.to) === toKey;
          return (
            <button
              key={p.label}
              onClick={() => select(p.from, p.to)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-xs transition-colors cursor-pointer ${
                active ? 'bg-[var(--text-main)] text-[var(--bg-color)]' : 'border border-[var(--line-color)] bg-[var(--surface)] hover:border-[var(--text-main)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      </div>

      {/* Calendar and the day's story share the width evenly; on big screens both fit the window and the story
          scrolls on its own, so the calendar never moves. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* Calendar */}
        <div className="rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-2 shadow-sm sm:p-4 lg:sticky lg:top-[8.5rem]">
          <CalendarData.Provider value={ctx}>
            <DayPicker
              mode="range"
              resetOnSelect
              selected={range}
              onSelect={(r) => setRange(r ?? { from: today, to: today })}
              month={month}
              onMonthChange={setMonth}
              captionLayout="dropdown"
              startMonth={new Date(today.getFullYear() - 2, 0)}
              endMonth={new Date(today.getFullYear() + 1, 11)}
              weekStartsOn={1}
              ISOWeek
              showOutsideDays
              fixedWeeks
              animate
              modifiers={{ off: (d: Date) => !isWorkingDay(d) }}
              components={{ DayButton: DayCell, Chevron }}
              classNames={{
                root: 'rdp-root w-full', // keep rdp-root: the month-slide animation hangs off it
                months: 'relative w-full',
                month: 'flex w-full flex-col gap-2 sm:gap-3',
                // Room on both sides for the arrows, so the month name is never covered.
                month_caption: 'flex h-10 items-center justify-center px-11',
                caption_label:
                  'flex h-9 items-center gap-1 rounded-lg pl-2.5 pr-1.5 font-display text-sm font-semibold [&>svg]:text-[var(--text-muted)]',
                dropdowns: 'flex items-center gap-1.5',
                dropdown_root:
                  'relative rounded-lg border border-[var(--line-color)] bg-[var(--surface)] transition-colors hover:border-[var(--text-main)] has-focus:border-[#257ef4]',
                dropdown: 'absolute inset-0 cursor-pointer opacity-0',
                // The arrow bar spans the caption; let clicks through it so the month/year dropdowns underneath work.
                nav: 'pointer-events-none absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between [&>button]:pointer-events-auto',
                button_previous:
                  'flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-color)] bg-[var(--surface)] transition-colors hover:border-[var(--text-main)] cursor-pointer disabled:opacity-40',
                button_next:
                  'flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-color)] bg-[var(--surface)] transition-colors hover:border-[var(--text-main)] cursor-pointer disabled:opacity-40',
                month_grid: 'w-full table-fixed border-collapse',
                weekdays: '',
                weekday: 'pb-1.5 font-display text-[0.625rem] font-medium uppercase tracking-widest text-[var(--text-muted)] sm:text-[0.6875rem]',
                week: '',
                day: 'h-[52px] p-[2px] align-top sm:h-[64px]',
                today: '',
                selected: '',
                range_start: '',
                range_middle: '',
                range_end: '',
                outside: '',
              }}
            />
          </CalendarData.Provider>
          {/* What the tiles mean */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 font-display text-[0.6875rem] text-[var(--text-muted)]">
            {legendTile('updated', 'updated')}
            {legendTile('planned', 'update planned')}
            {legendTile('missed', 'missed')}
            <span className="text-emerald-600">✓ tasks done</span>
            <span>Muted dates are days off</span>
          </div>
        </div>

        {/* The selection's story */}
        <aside className="rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-4 shadow-sm sm:p-5 lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
          <div className="mb-4">
            <div className="font-display text-[0.6875rem] uppercase tracking-widest text-[var(--text-muted)]">
              {single ? fmt(from, { year: 'numeric' }) : `${selected.length ? plural(selected.length, 'active day') : 'No activity'}`}
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{loading ? 'Loading…' : summary}</p>
          </div>

          {!loading &&
            (selected.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                {fromKey > todayKey ? 'Nothing planned for these days.' : 'No updates or tasks here.'}
              </p>
            ) : (
              <div className="space-y-6">
                {selected.map(({ key, info }) => (
                  <section key={key}>
                    {!single && (
                      <div className="sticky -top-4 z-20 -mx-4 mb-2 border-b border-[var(--line-color)] bg-[var(--surface)] px-4 py-2 font-display text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] sm:-top-5 sm:-mx-5 sm:px-5">
                        {key === todayKey ? 'Today' : fmt(keyToDate(key), { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    )}
                    <DayStory info={info} dayKeyStr={key} todayKey={todayKey} initials={initials} onToggle={onToggle} />
                  </section>
                ))}
              </div>
            ))}
        </aside>
      </div>
    </div>
  );
}
