import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Task } from '../types';
import { addDays, dayKey, keyToDate, startOfWeek } from '../lib/dates';
import { isWorkingDay } from '../lib/cadence';
import { useClientColors } from '../lib/clientColors';
import { consistency, dailyCounts, formatMinute, rangeStats, weeksIn } from '../lib/insights';
import type { ClientWeek } from '../lib/checkins';

// Insights: a GitHub-style year of client updates with per-client consistency, and stats for a range.

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => keyToDate(key).toLocaleDateString('en-US', opts);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Header({ eyebrow, title, muted, children }: { eyebrow: string; title: string; muted?: string; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-accent-gradient">{eyebrow}</div>
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          {title} {muted && <span className="text-[var(--text-muted)]">{muted}</span>}
        </h1>
      </div>
      {children}
    </header>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-4 shadow-sm ${className}`}>{children}</div>;
}

function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <Card>
      <div className="font-display text-3xl font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-2 text-xs text-[var(--text-muted)]">{label}</div>
      {hint && <div className="mt-0.5 font-display text-[0.6875rem] text-[var(--text-muted)]/80">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------- Year

const HEAT = ['var(--line-color)', 'rgba(37,126,244,0.28)', 'rgba(37,126,244,0.5)', 'rgba(37,126,244,0.75)', '#1b5fd6'];
const heatLevel = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4);

function WeekSquare({ week, color }: { week: ClientWeek | null; color: string }) {
  const base = 'h-3 w-3 shrink-0 rounded-[3px]';
  if (!week) return <span className={`${base} bg-[var(--line-color)]/40`} />;
  const label = `${fmt(week.weekStart, { month: 'short', day: 'numeric' })}: ${week.checkIns.length}/${week.target} check-ins`;
  if (week.status === 'met') return <span title={`${label} · on track`} className={base} style={{ background: color }} />;
  if (week.status === 'partial') return <span title={`${label} · partly`} className={base} style={{ background: color, opacity: 0.4 }} />;
  if (week.status === 'missed')
    return (
      <span title={`${label} · missed`} className={`${base} flex items-center justify-center border border-red-400/70 text-red-500`}>
        <svg viewBox="0 0 12 12" className="h-2 w-2" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </span>
    );
  return <span title={`${label} · this week`} className={`${base} border border-dashed`} style={{ borderColor: color }} />;
}

export function YearView({ tasks, loading, onOpenDay }: { tasks: Task[]; loading: boolean; onOpenDay: (day: string) => void }) {
  const { colorOf } = useClientColors();
  const todayKey = dayKey(new Date());
  const thisYear = new Date().getFullYear();
  const firstYear = useMemo(
    () => Math.min(thisYear, ...tasks.map((t) => new Date(t.created_at).getFullYear())),
    [tasks, thisYear],
  );
  const [year, setYear] = useState(thisYear);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const counts = useMemo(() => dailyCounts(tasks, year), [tasks, year]);
  const rows = useMemo(() => consistency(tasks, from, to, todayKey), [tasks, from, to, todayKey]);
  const weeks = useMemo(() => weeksIn(from, to), [from, to]);

  // Totals and streaks (a streak counts working days in a row with an update; days off don't break it).
  const summary = useMemo(() => {
    let total = 0;
    let active = 0;
    let best = 0;
    let run = 0;
    const end = to < todayKey ? to : todayKey;
    for (let d = keyToDate(from); dayKey(d) <= end; d = addDays(d, 1)) {
      const n = counts.get(dayKey(d)) ?? 0;
      total += n;
      if (n) active++;
      if (n) run++;
      else if (isWorkingDay(d) && dayKey(d) !== todayKey) run = 0;
      best = Math.max(best, run);
    }
    const met = rows.reduce((a, r) => a + r.met, 0);
    const owed = rows.reduce((a, r) => a + r.owed, 0);
    return { total, active, best, current: run, met, owed };
  }, [counts, from, to, todayKey, rows]);

  // Months across the top: the column where each month starts.
  const monthStarts = weeks
    .map((w, i) => ({ i, month: keyToDate(dayKey(addDays(keyToDate(w), 6))).getMonth(), w }))
    .filter((m, i, all) => i === 0 || m.month !== all[i - 1].month);

  const cell = 13;
  const gap = 3;

  // On narrow screens the grids scroll sideways: start them at the current week, not January.
  const heatScroll = useRef<HTMLDivElement>(null);
  const rhythmScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const idx = year === thisYear ? Math.max(0, weeks.findIndex((w) => w > todayKey) - 1) : weeks.length - 1;
    const show = (el: HTMLDivElement | null, before: number, step: number, after: number) => {
      if (!el) return;
      // Keep a few weeks of room to the right of this week (the future is empty anyway).
      el.scrollLeft = Math.max(0, before + (idx + 4) * step - el.clientWidth + after);
    };
    show(heatScroll.current, 36, cell + gap, 0);
    const nameWidth = rhythmScroll.current?.querySelector<HTMLElement>('[data-name]')?.offsetWidth ?? 144;
    show(rhythmScroll.current, nameWidth + 12, 12 + gap, 64);
  }, [year, thisYear, weeks, todayKey, loading, rows.length]);

  return (
    <div className="mx-auto max-w-7xl px-5 pt-2 pb-10 md:px-8 lg:px-10">
      <Header eyebrow="Insights · Year" title={`${year}.`} muted="How steady were your client updates?">
        <div className="flex items-center gap-1.5">
          <button
            disabled={year <= firstYear}
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-color)] bg-[var(--surface)] hover:border-[var(--text-main)] disabled:opacity-40 cursor-pointer"
          >
            ‹
          </button>
          <button
            disabled={year >= thisYear}
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-color)] bg-[var(--surface)] hover:border-[var(--text-main)] disabled:opacity-40 cursor-pointer"
          >
            ›
          </button>
        </div>
      </Header>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={summary.total} label="updates logged" hint={`on ${plural(summary.active, 'day')}`} />
        <Stat
          value={summary.owed ? `${Math.round((summary.met / summary.owed) * 100)}%` : '–'}
          label="client-weeks on rhythm"
          hint={summary.owed ? `${summary.met} of ${summary.owed}` : 'no finished weeks yet'}
        />
        <Stat value={summary.current} label="day streak now" hint="working days with an update" />
        <Stat value={summary.best} label="longest streak" hint="days off don't break it" />
      </div>

      <Card className="mb-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold">Every update, every day</h2>
          <div className="flex items-center gap-1 font-display text-[0.6875rem] text-[var(--text-muted)]">
            Less
            {HEAT.map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
            ))}
            More
          </div>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <div ref={heatScroll} className="overflow-x-auto pb-1">
            <div className="inline-flex gap-2">
              <div className="sticky left-0 z-10 flex flex-col bg-[var(--surface)] pr-1 pt-5" style={{ gap }}>
                {WEEKDAYS.map((d, i) => (
                  <span key={d} className="font-display text-[0.625rem] leading-none text-[var(--text-muted)]" style={{ height: cell, lineHeight: `${cell}px` }}>
                    {i % 2 === 0 ? d : ''}
                  </span>
                ))}
              </div>
              <div>
                <div className="relative mb-1.5 h-3.5" style={{ width: weeks.length * (cell + gap) }}>
                  {monthStarts.map((m) => (
                    <span
                      key={m.w}
                      className="absolute font-display text-[0.625rem] text-[var(--text-muted)]"
                      style={{ left: m.i * (cell + gap) }}
                    >
                      {keyToDate(dayKey(addDays(keyToDate(m.w), 6))).toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                  ))}
                </div>
                <div className="flex" style={{ gap }}>
                  {weeks.map((w) => (
                    <div key={w} className="flex flex-col" style={{ gap }}>
                      {WEEKDAYS.map((_, i) => {
                        const key = dayKey(addDays(keyToDate(w), i));
                        if (key < from || key > to) return <span key={i} style={{ width: cell, height: cell }} />;
                        const n = counts.get(key) ?? 0;
                        const future = key > todayKey;
                        const off = !isWorkingDay(keyToDate(key));
                        return (
                          <button
                            key={i}
                            onClick={() => onOpenDay(key)}
                            title={`${fmt(key, { weekday: 'short', month: 'short', day: 'numeric' })} · ${plural(n, 'update')}${off ? ' · day off' : ''}`}
                            className={`rounded-[3px] transition-transform hover:scale-125 cursor-pointer ${key === todayKey ? 'ring-1 ring-[var(--text-main)]' : ''}`}
                            style={{
                              width: cell,
                              height: cell,
                              background: future ? 'transparent' : HEAT[heatLevel(n)],
                              opacity: off && !n ? 0.45 : 1,
                              border: future ? '1px dashed var(--line-color)' : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold">Check-in rhythm, week by week</h2>
          <div className="flex flex-wrap items-center gap-3 font-display text-[0.6875rem] text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent)]" /> on track
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent)] opacity-40" /> partly
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-red-400" /> missed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-[var(--accent)]" /> this week
            </span>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">No client rhythms in {year} yet.</p>
        ) : (
          <div ref={rhythmScroll} className="overflow-x-auto">
            <div className="inline-flex min-w-full flex-col gap-2">
              {rows.map((r) => {
                const color = colorOf(r.client.key);
                return (
                  <div key={r.client.key} className="flex items-center gap-3">
                    {/* Name and score stay put while the weeks scroll sideways. */}
                    <span data-name className="sticky left-0 z-10 flex w-24 shrink-0 items-center gap-2 truncate bg-[var(--surface)] text-sm sm:w-36">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="truncate">{r.client.name}</span>
                    </span>
                    <div className="flex" style={{ gap }}>
                      {r.weeks.map((w, i) => (
                        <WeekSquare key={weeks[i]} week={w} color={color} />
                      ))}
                    </div>
                    <span className="sticky right-0 ml-auto w-12 shrink-0 bg-[var(--surface)] pl-2 text-right font-display text-xs tabular-nums text-[var(--text-muted)]">
                      {r.owed ? `${Math.round((r.met / r.owed) * 100)}%` : '–'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Stats

type Preset = { label: string; from: string; to: string };

function presets(todayKey: string): Preset[] {
  const today = keyToDate(todayKey);
  const monday = startOfWeek(today);
  return [
    { label: 'This week', from: dayKey(monday), to: todayKey },
    { label: 'Last 4 weeks', from: dayKey(addDays(monday, -21)), to: todayKey },
    { label: 'This month', from: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: todayKey },
    { label: 'Last 3 months', from: dayKey(new Date(today.getFullYear(), today.getMonth() - 2, 1)), to: todayKey },
    { label: 'This year', from: `${today.getFullYear()}-01-01`, to: todayKey },
  ];
}

function Bars({ values, labels, highlight, format }: { values: number[]; labels: string[]; highlight?: number; format?: (v: number) => string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-32 gap-1">
      {values.map((v, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center gap-1" title={`${labels[i]}: ${format ? format(v) : v}`}>
          <span className="font-display text-[0.625rem] tabular-nums text-[var(--text-muted)] opacity-0 group-hover:opacity-100">{v || ''}</span>
          <div className="relative w-full flex-1">
            <div
              className={`absolute inset-x-0 bottom-0 rounded-t-md transition-all ${i === highlight ? 'bg-accent-gradient' : 'bg-[var(--accent)]/25'}`}
              style={{ height: `${Math.max(v ? 6 : 2, (v / max) * 100)}%` }}
            />
          </div>
          <span className={`font-display text-[0.625rem] ${i === highlight ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsView({ tasks, loading }: { tasks: Task[]; loading: boolean }) {
  const { colorOf } = useClientColors();
  const todayKey = dayKey(new Date());
  const options = presets(todayKey);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: options[1].from, to: options[1].to });
  const s = useMemo(() => rangeStats(tasks, range.from, range.to, todayKey), [tasks, range, todayKey]);

  const pct = s.onTime.owed ? Math.round((s.onTime.made / s.onTime.owed) * 100) : null;
  const busiest = s.weekdays.some(Boolean) ? s.weekdays.indexOf(Math.max(...s.weekdays)) : undefined;
  const peakHour = s.hours.some(Boolean) ? s.hours.indexOf(Math.max(...s.hours)) : undefined;
  // Hours to show: the working part of the day, widened to include any updates outside it.
  const used = s.hours.map((n, h) => (n ? h : -1)).filter((h) => h >= 0);
  const firstHour = Math.min(8, ...used);
  const lastHour = Math.max(21, ...used);
  const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  const maxGap = Math.max(1, ...s.gaps.map((g) => g.avg ?? 0));

  return (
    <div className="mx-auto max-w-7xl px-5 pt-2 pb-10 md:px-8 lg:px-10">
      <Header
        eyebrow="Insights · Stats"
        title={`${fmt(range.from, { month: 'short', day: 'numeric' })} – ${fmt(range.to, { month: 'short', day: 'numeric' })}.`}
        muted={`${Math.round((keyToDate(range.to).getTime() - keyToDate(range.from).getTime()) / 86_400_000) + 1} days`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {options.map((p) => {
          const active = p.from === range.from && p.to === range.to;
          return (
            <button
              key={p.label}
              onClick={() => setRange({ from: p.from, to: p.to })}
              className={`rounded-full px-3 py-1.5 font-display text-xs transition-colors cursor-pointer ${
                active ? 'bg-[var(--text-main)] text-[var(--bg-color)]' : 'border border-[var(--line-color)] bg-[var(--surface)] hover:border-[var(--text-main)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <span className="flex items-center gap-1.5 rounded-full border border-[var(--line-color)] bg-[var(--surface)] px-3 py-1 font-display text-xs">
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
            className="bg-transparent outline-none"
            aria-label="From"
          />
          –
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={todayKey}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
            className="bg-transparent outline-none"
            aria-label="To"
          />
        </span>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line-color)" strokeWidth="4" />
                  {pct !== null && (
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke={pct >= 80 ? '#34d399' : pct >= 50 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
                    />
                  )}
                </svg>
                <div className="font-display text-3xl font-bold tabular-nums leading-none">{pct === null ? '–' : `${pct}%`}</div>
              </div>
              <div className="mt-2 text-xs text-[var(--text-muted)]">check-ins on time</div>
              <div className="mt-0.5 font-display text-[0.6875rem] text-[var(--text-muted)]/80">
                {s.onTime.owed ? `${s.onTime.made} of ${s.onTime.owed} made in finished weeks` : 'no finished weeks yet'}
              </div>
            </Card>
            <Stat
              value={s.weeksAllMet.total ? `${s.weeksAllMet.met}/${s.weeksAllMet.total}` : '–'}
              label="weeks every client was covered"
            />
            <Stat value={s.logs} label="updates logged" hint={s.medianMinute !== null ? `usually around ${formatMinute(s.medianMinute)}` : undefined} />
            <Stat value={s.completed} label="tasks completed" hint={`${s.added} added`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <h2 className="font-display text-sm font-semibold">Busiest weekday</h2>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                {busiest === undefined ? 'No updates in this range.' : `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][busiest]}s, with ${plural(s.weekdays[busiest], 'update')}.`}
              </p>
              <Bars values={s.weekdays} labels={WEEKDAYS} highlight={busiest} />
            </Card>

            <Card>
              <h2 className="font-display text-sm font-semibold">When you send updates</h2>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                {peakHour === undefined
                  ? 'No updates in this range.'
                  : `Most often ${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}; half are sent before ${formatMinute(s.medianMinute!)}.`}
              </p>
              <Bars
                values={s.hours.slice(firstHour, lastHour + 1)}
                labels={s.hours.slice(firstHour, lastHour + 1).map((_, i) => ((firstHour + i) % 3 === 0 ? hourLabel(firstHour + i) : ''))}
                highlight={peakHour === undefined ? undefined : peakHour - firstHour}
              />
            </Card>

            <Card>
              <h2 className="font-display text-sm font-semibold">Average gap between updates</h2>
              <p className="mb-3 text-xs text-[var(--text-muted)]">Days between update days, per client. Longest gaps first.</p>
              {s.gaps.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--text-muted)]">No updates in this range.</p>
              ) : (
                <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto pr-1">
                  {s.gaps.map((g) => {
                    const color = colorOf(g.client.key);
                    return (
                      <div key={g.client.key}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                            <span className="truncate">{g.client.name}</span>
                          </span>
                          <span className="shrink-0 font-display text-xs tabular-nums text-[var(--text-muted)]">
                            {g.avg === null ? 'one update' : `every ${g.avg.toFixed(1)} days`}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--line-color)]/60">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${g.avg === null ? 4 : Math.max(4, (g.avg / maxGap) * 100)}%`, background: (g.avg ?? 0) > 4 ? '#ef4444' : color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
