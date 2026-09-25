import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DayPicker, type DateRange, type DayButtonProps, type ChevronProps } from 'react-day-picker';
import type { Task } from '../types';
import { addDays, dayKey, endOfDay, keyToDate, startOfWeek } from '../lib/dates';
import { ACTIVITY_COLORS, buildActivity, type DayActivity } from '../lib/tasks';
import { isWorkingDay } from '../lib/cadence';
import { checkInMarks, type Mark } from '../lib/checkins';
import { clientKeyOf } from '../lib/handles';
import { useClientColors } from '../lib/clientColors';

// Month calendar built on react-day-picker (the engine behind shadcn's Calendar): pick a day or a range,
// month/year dropdowns, week numbers, keyboard navigation and smooth month transitions. Each day shows what
// happened (dots + a heat tint), days off are muted, and the side panel summarises the selection.

interface Props {
  tasks: Task[];
  loading: boolean;
  initialDay?: string;
  onToggle: (id: string, done: boolean) => void;
}

type Kind = 'added' | 'logged' | 'completed' | 'due';
type Filters = Record<Kind, boolean>;

const KINDS: { id: Kind; label: string; dot: string }[] = [
  { id: 'completed', label: 'Completed', dot: ACTIVITY_COLORS.completed },
  { id: 'logged', label: 'Logs', dot: ACTIVITY_COLORS.logged },
  { id: 'added', label: 'Added', dot: ACTIVITY_COLORS.added },
  { id: 'due', label: 'Due', dot: ACTIVITY_COLORS.due },
];

function countOf(a: DayActivity | undefined, filters: Filters) {
  if (!a) return 0;
  return (
    (filters.added ? a.added.length : 0) +
    (filters.logged ? a.logs.length : 0) +
    (filters.completed ? a.completed.length : 0) +
    (filters.due ? a.due.length : 0)
  );
}

// Data the custom day cells need, without re-creating the cell component on every render.
const CalendarData = createContext<{ activity: Map<string, DayActivity>; filters: Filters; marks: Map<string, Mark[]>; showCheckIns: boolean }>({
  activity: new Map(),
  filters: { added: true, logged: true, completed: true, due: true },
  marks: new Map(),
  showCheckIns: true,
});

const MARK_LABEL: Record<Mark['state'], string> = { done: 'checked in', planned: 'check-in planned', late: 'check-in overdue', missed: 'missed check-in' };

// One client check-in on a day: solid once logged, a faint ring while planned, red when late or missed.
function CheckInMark({ mark, color, onGradient = false, size = 7 }: { mark: Mark; color: string; onGradient?: boolean; size?: number }) {
  const title = `${mark.name}: ${mark.nudge && mark.state !== 'done' ? MARK_LABEL[mark.state].replace('check-in', 'nudge') : MARK_LABEL[mark.state]}`;
  if (mark.state === 'missed')
    return (
      <svg viewBox="0 0 8 8" width={size} height={size} className={onGradient ? 'text-white' : 'text-red-500'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <title>{title}</title>
        <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
      </svg>
    );
  const c = onGradient ? '#ffffff' : mark.state === 'late' ? '#ef4444' : color;
  return (
    <span
      title={title}
      className="rounded-full"
      style={{
        width: size,
        height: size,
        background: mark.state === 'done' ? c : 'transparent',
        border: mark.state === 'done' ? undefined : `1.5px ${mark.state === 'late' ? 'solid' : 'dashed'} ${c}`,
        opacity: mark.state === 'planned' && !onGradient ? 0.75 : 1,
      }}
    />
  );
}

function DayCell({ day, modifiers, className: _className, ...props }: DayButtonProps) {
  const { activity, filters, marks, showCheckIns } = useContext(CalendarData);
  const { colorOf } = useClientColors();
  const a = activity.get(dayKey(day.date));
  const dayMarks = showCheckIns ? (marks.get(dayKey(day.date)) ?? []) : [];
  const n = countOf(a, filters);
  const edge = modifiers.range_start || modifiers.range_end || (modifiers.selected && !modifiers.range_middle);
  const middle = modifiers.range_middle && !edge;
  // More activity → deeper blue tint, like a heatmap.
  const heat = n === 0 ? '' : n === 1 ? 'bg-[#257ef4]/[0.05]' : n <= 3 ? 'bg-[#257ef4]/[0.09]' : 'bg-[#257ef4]/[0.15]';
  const dot = (show: boolean | undefined, cls: string) =>
    show ? <span className={`h-1.5 w-1.5 rounded-full ${edge ? 'bg-white/90' : cls}`} /> : null;

  return (
    <button
      {...props}
      className={`group relative flex h-full w-full flex-col items-center gap-1 rounded-xl pt-1.5 pb-1 outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[#257ef4] cursor-pointer ${
        edge
          ? 'bg-accent-gradient text-white shadow-md shadow-[#257ef4]/30'
          : middle
            ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)] ring-1 ring-inset ring-[#257ef4]/30'
            : `${heat} hover:bg-[#257ef4]/[0.12]`
      } ${modifiers.outside ? 'opacity-35' : ''}`}
    >
      <span
        className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 font-display text-sm tabular-nums ${
          modifiers.today && !edge
            ? 'bg-accent-gradient font-semibold text-white shadow-sm shadow-[#257ef4]/30'
            : modifiers.off && !edge
              ? 'text-[var(--text-muted)]'
              : 'font-medium'
        }`}
      >
        {day.date.getDate()}
      </span>
      <span className="flex h-1.5 items-center gap-[3px]">
        {dot(filters.completed && !!a?.completed.length, ACTIVITY_COLORS.completed)}
        {dot(filters.logged && !!a?.logs.length, ACTIVITY_COLORS.logged)}
        {dot(filters.added && !!a?.added.length, ACTIVITY_COLORS.added)}
        {dot(filters.due && !!a?.due.length, ACTIVITY_COLORS.due)}
      </span>
      {dayMarks.length > 0 && (
        <span className="flex h-[7px] items-center gap-[3px]">
          {dayMarks.slice(0, 4).map((m) => (
            <CheckInMark key={`${m.client}${m.state}`} mark={m} color={colorOf(m.client)} onGradient={!!edge} />
          ))}
          {dayMarks.length > 4 && <span className="font-display text-[0.5rem] leading-none text-[var(--text-muted)]">+{dayMarks.length - 4}</span>}
        </span>
      )}
      {modifiers.off && !modifiers.outside && (
        <span className={`hidden lg:block text-[0.5625rem] uppercase tracking-wider ${edge ? 'text-white/80' : 'text-[var(--text-muted)]/70'}`}>
          off
        </span>
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

// Tasks that were open at the end of the given day.
function activeOn(tasks: Task[], key: string) {
  const end = endOfDay(key);
  return tasks.filter(
    (t) =>
      new Date(t.created_at).getTime() <= end &&
      (!t.done || (t.completed_at !== null && new Date(t.completed_at).getTime() > end)) &&
      (!t.archived_at || new Date(t.archived_at).getTime() > end),
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', opts);

function Check({ task, onToggle }: { task: Task; onToggle?: Props['onToggle'] }) {
  return (
    <button
      aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
      disabled={!onToggle}
      onClick={() => onToggle?.(task.id, !task.done)}
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors enabled:cursor-pointer ${
        task.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--text-main)] enabled:hover:bg-[var(--text-main)]'
      }`}
    >
      {task.done && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
    </button>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-2.5 py-1.5 text-sm">{children}</div>;
}

export default function CalendarView({ tasks, loading, initialDay, onToggle }: Props) {
  const todayKey = dayKey(new Date());
  const today = keyToDate(todayKey);
  const start = initialDay ? keyToDate(initialDay) : today;
  const [range, setRange] = useState<DateRange | undefined>({ from: start, to: start });
  const [month, setMonth] = useState<Date>(new Date(start.getFullYear(), start.getMonth(), 1));
  const [filters, setFilters] = useState<Filters>({ added: true, logged: true, completed: true, due: true });
  const [weekNumbers, setWeekNumbers] = useState(true);
  const [showCheckIns, setShowCheckIns] = useState(true);
  const { colorOf } = useClientColors();

  const activity = useMemo(() => buildActivity(tasks), [tasks]);

  const from = range?.from ?? today;
  const to = range?.to ?? from;
  const fromKey = dayKey(from);
  const toKey = dayKey(to);
  const single = fromKey === toKey;

  // Client check-ins (logged, planned, missed) for the visible month and the selection.
  const monthKey = dayKey(month);
  const marks = useMemo(() => {
    const first = dayKey(addDays(month, -7));
    const last = dayKey(addDays(new Date(month.getFullYear(), month.getMonth() + 1, 0), 14));
    return checkInMarks(tasks, fromKey < first ? fromKey : first, toKey > last ? toKey : last, todayKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, monthKey, fromKey, toKey, todayKey]);
  const ctx = useMemo(() => ({ activity, filters, marks, showCheckIns }), [activity, filters, marks, showCheckIns]);

  // Planned client updates (not sent yet), by the day they're due.
  const plannedByDay = useMemo(() => {
    const map = new Map<string, { task: Task; title: string }[]>();
    for (const task of tasks)
      for (const p of task.planned_updates ?? []) {
        if (p.status !== 'planned') continue;
        const list = map.get(p.send_on) ?? [];
        list.push({ task, title: p.title });
        map.set(p.send_on, list);
      }
    return map;
  }, [tasks]);

  // Everything in the selection, newest day first (capped so a huge range stays fast).
  const days = useMemo(() => {
    const keys: string[] = [];
    for (let d = keyToDate(toKey); dayKey(d) >= fromKey && keys.length < 92; d = addDays(d, -1)) keys.push(dayKey(d));
    return keys;
  }, [toKey, fromKey]);
  const totals = useMemo(() => {
    const t = { added: 0, logged: 0, completed: 0, due: 0 };
    for (const k of days) {
      const a = activity.get(k);
      if (!a) continue;
      t.added += a.added.length;
      t.logged += a.logs.length;
      t.completed += a.completed.length;
      t.due += a.due.length;
    }
    return t;
  }, [days, activity]);
  const openAtEnd = single && fromKey <= todayKey ? activeOn(tasks, fromKey) : [];

  const select = (a: Date, b: Date = a) => {
    setRange({ from: a, to: b });
    setMonth(new Date(b.getFullYear(), b.getMonth(), 1));
  };
  const monday = startOfWeek(today);
  const presets: { label: string; from: Date; to: Date }[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
  ];

  const selectionTitle = single
    ? fromKey === todayKey
      ? 'Today'
      : fmt(from, { weekday: 'long', month: 'long', day: 'numeric' })
    : `${fmt(from, { month: 'short', day: 'numeric' })} – ${fmt(to, { month: 'short', day: 'numeric' })}`;

  const timeline = days
    .map((k) => ({ key: k, a: activity.get(k), m: showCheckIns ? (marks.get(k) ?? []) : [], p: showCheckIns ? (plannedByDay.get(k) ?? []) : [] }))
    .filter(({ a, m, p }) => countOf(a, filters) > 0 || m.length > 0 || p.length > 0);

  return (
    <div className="px-5 md:px-8 lg:px-10 pt-2 pb-5 max-w-7xl mx-auto">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-accent-gradient">Calendar</div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            {fmt(month, { month: 'long' })} <span className="text-[var(--text-muted)]">{month.getFullYear()}.</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCheckIns((v) => !v)}
            aria-pressed={showCheckIns}
            title="Client check-ins: solid when logged, faint ring when planned, red ✕ when missed"
            className={`h-9 rounded-full border px-3.5 font-display text-xs transition-colors cursor-pointer ${
              showCheckIns ? 'border-[var(--text-main)] bg-[var(--surface)]' : 'border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
            }`}
          >
            Check-ins
          </button>
          <button
            onClick={() => setWeekNumbers((v) => !v)}
            aria-pressed={weekNumbers}
            className={`h-9 rounded-full border px-3.5 font-display text-xs transition-colors cursor-pointer ${
              weekNumbers ? 'border-[var(--text-main)] bg-[var(--surface)]' : 'border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
            }`}
          >
            Week numbers
          </button>
          <button
            onClick={() => select(today)}
            className="h-9 rounded-full bg-accent-gradient px-4 font-display text-xs font-semibold text-white shadow-sm shadow-[#257ef4]/30 hover:opacity-95 cursor-pointer"
          >
            Today
          </button>
        </div>
      </header>

      {/* Presets */}
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = dayKey(p.from) === fromKey && dayKey(p.to) === toKey;
          return (
            <button
              key={p.label}
              onClick={() => select(p.from, p.to)}
              className={`rounded-full px-3 py-1.5 font-display text-xs transition-colors cursor-pointer ${
                active ? 'bg-[var(--text-main)] text-[var(--bg-color)]' : 'border border-[var(--line-color)] bg-[var(--surface)] hover:border-[var(--text-main)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Calendar */}
        <div className="rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-3 sm:p-4 shadow-sm">
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
              showWeekNumber={weekNumbers}
              showOutsideDays
              fixedWeeks
              animate
              modifiers={{ off: (d: Date) => !isWorkingDay(d) }}
              components={{ DayButton: DayCell, Chevron }}
              classNames={{
                root: 'rdp-root w-full', // keep rdp-root: the month-slide animation hangs off it
                months: 'relative w-full',
                month: 'flex w-full flex-col gap-3',
                month_caption: 'flex h-10 items-center justify-center',
                caption_label:
                  'flex h-9 items-center gap-1 rounded-lg pl-3 pr-2 font-display text-sm font-semibold [&>svg]:text-[var(--text-muted)]',
                dropdowns: 'flex items-center gap-2',
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
                weekday: 'pb-2 font-display text-[0.6875rem] font-medium uppercase tracking-widest text-[var(--text-muted)]',
                week_number_header: 'w-9',
                week_number: 'w-9 pt-2.5 text-center align-top font-display text-[0.625rem] tabular-nums text-[var(--text-muted)]/80',
                week: '',
                day: 'h-[62px] sm:h-[70px] p-[3px] align-top',
                today: '',
                selected: '',
                range_start: '',
                range_middle: '',
                range_end: '',
                outside: '',
              }}
            />
          </CalendarData.Provider>
          <p className="mt-2 px-1 font-display text-[0.6875rem] text-[var(--text-muted)]">
            Click a day, or two days for a range · arrow keys move · days off (Sundays, 2nd &amp; 4th Saturdays) are muted · check-ins: ● logged, ◌ planned, ✕ missed
          </p>
        </div>

        {/* Selection summary */}
        <aside className="rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-4 shadow-sm lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
          <div className="mb-3">
            <div className="font-display text-[0.6875rem] uppercase tracking-widest text-[var(--text-muted)]">
              {single ? (fromKey === todayKey ? fmt(from, { weekday: 'long' }) : fmt(from, { year: 'numeric' })) : `${days.length} days`}
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight">{selectionTitle}</h2>
          </div>

          {/* Totals double as filters */}
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setFilters((f) => ({ ...f, [k.id]: !f[k.id] }))}
                aria-pressed={filters[k.id]}
                title={filters[k.id] ? `Hide ${k.label.toLowerCase()}` : `Show ${k.label.toLowerCase()}`}
                className={`rounded-xl border px-2 py-2 text-left transition-all cursor-pointer ${
                  filters[k.id] ? 'border-[var(--line-color)] bg-[var(--bg-color)]' : 'border-dashed border-[var(--line-color)] opacity-45'
                }`}
              >
                <div className="font-display text-lg font-bold leading-none tabular-nums">{totals[k.id]}</div>
                <div className="mt-1 flex items-center gap-1 text-[0.625rem] text-[var(--text-muted)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
                  {k.label}
                </div>
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : timeline.length === 0 && openAtEnd.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing here{single ? ' on this day' : ' in this range'}.</p>
          ) : (
            <div className="space-y-4">
              {timeline.map(({ key, a, m, p }) => (
                <section key={key}>
                  {!single && (
                    <div className="sticky top-0 bg-[var(--surface)] py-1 font-display text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                      {key === todayKey ? 'Today' : fmt(keyToDate(key), { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  )}
                  <div className="divide-y divide-[var(--line-color)]/60">
                    {p.map(({ task, title }) => (
                      <Row key={`p${task.id}${title}`}>
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2 ring-[#257ef4]/40" style={{ background: colorOf(clientKeyOf(task)) }} />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-display text-[0.6875rem] uppercase tracking-wider text-[var(--text-muted)]">{task.text}</span>
                          <span className="block leading-snug">{title}</span>
                        </span>
                        <span className={`shrink-0 font-display text-[0.6875rem] ${key < todayKey ? 'text-red-500' : 'text-[#257ef4]'}`}>
                          {key < todayKey ? 'update not sent' : 'planned update'}
                        </span>
                      </Row>
                    ))}
                    {m.map((mark) => (
                      <Row key={`m${mark.client}${mark.state}`}>
                        <span className="mt-1 flex h-3 w-4 shrink-0 items-center justify-center">
                          <CheckInMark mark={mark} color={colorOf(mark.client)} size={9} />
                        </span>
                        <span className="flex-1 min-w-0 font-display">{mark.name}</span>
                        <span
                          className={`shrink-0 font-display text-[0.6875rem] ${
                            mark.state === 'missed' || mark.state === 'late' ? 'text-red-500' : mark.state === 'done' ? 'text-emerald-600' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {mark.nudge && mark.state !== 'done' ? MARK_LABEL[mark.state].replace('check-in', 'nudge') : MARK_LABEL[mark.state]}
                        </span>
                      </Row>
                    ))}
                    {filters.completed &&
                      a?.completed.map((t) => (
                        <Row key={`c${t.id}`}>
                          <Check task={t} onToggle={onToggle} />
                          <span className="flex-1 min-w-0 font-display text-[var(--text-muted)] line-through decoration-[var(--text-muted)]">{t.text}</span>
                          <span className="shrink-0 font-display text-[0.6875rem] text-emerald-600">done {t.completed_at && timeOf(t.completed_at)}</span>
                        </Row>
                      ))}
                    {filters.logged &&
                      a?.logs.map(({ task, update }) => (
                        <Row key={`l${update.id}`}>
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(clientKeyOf(task)) }} />
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-display text-[0.6875rem] uppercase tracking-wider text-[var(--text-muted)]">{task.text}</span>
                            <span className="block break-words leading-snug">{update.text}</span>
                          </span>
                          <span className="shrink-0 font-display text-[0.6875rem] text-[var(--text-muted)]">{timeOf(update.created_at)}</span>
                        </Row>
                      ))}
                    {filters.added &&
                      a?.added.map((t) => (
                        <Row key={`a${t.id}`}>
                          <Check task={t} onToggle={onToggle} />
                          <span className={`flex-1 min-w-0 font-display ${t.done ? 'text-[var(--text-muted)] line-through' : ''}`}>{t.text}</span>
                          <span className="shrink-0 font-display text-[0.6875rem] text-[var(--text-muted)]">added {timeOf(t.created_at)}</span>
                        </Row>
                      ))}
                    {filters.due &&
                      a?.due.map((t) => (
                        <Row key={`d${t.id}`}>
                          <Check task={t} onToggle={onToggle} />
                          <span className={`flex-1 min-w-0 font-display ${t.done ? 'text-[var(--text-muted)] line-through' : ''}`}>{t.text}</span>
                          <span className={`shrink-0 font-display text-[0.6875rem] ${!t.done && key < todayKey ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                            {t.done ? 'was due' : key < todayKey ? 'overdue' : 'due'}
                          </span>
                        </Row>
                      ))}
                  </div>
                </section>
              ))}

              {openAtEnd.length > 0 && (
                <section>
                  <div className="py-1 font-display text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    {fromKey === todayKey ? 'Open right now' : 'Still open that day'} · {openAtEnd.length}
                  </div>
                  <div className="divide-y divide-[var(--line-color)]/60">
                    {openAtEnd.map((t) => (
                      <Row key={`o${t.id}`}>
                        <Check task={t.done ? { ...t, done: false } : t} onToggle={t.done ? undefined : onToggle} />
                        <span className="flex-1 min-w-0 font-display">{t.text}</span>
                        {t.done && t.completed_at && (
                          <span className="shrink-0 font-display text-[0.6875rem] text-[var(--text-muted)]">
                            done {fmt(new Date(t.completed_at), { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </Row>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
