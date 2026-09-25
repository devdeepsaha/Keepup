// Agenda assistant: answers questions about the user's tasks and turns what they tell it
// (text or screenshots) into task changes. Runs as the signed-in user, so row level
// security still scopes every read and write to their own data.
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { ApiError as GeminiApiError, GoogleGenAI, ThinkingLevel, type Content } from 'npm:@google/genai@2.24.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ACTION_TYPES, RESPONSE_SCHEMA, SYSTEM_PROMPT, type Action, type AssistantOutput } from './prompt.ts';

// Provider: Gemini when GEMINI_API_KEY is set, otherwise Claude (ANTHROPIC_API_KEY).
const CLAUDE_MODEL = 'claude-opus-5';
// Flash-Lite is Google's lowest-latency model and is plenty for this job; bigger Flash models are fallbacks.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite';
// Tried in order when the preferred model is overloaded, rate limited or unavailable.
const GEMINI_FALLBACKS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
// Models are raced: if the current one hasn't answered after HEDGE_MS, the next starts alongside it.
// The first good answer wins and the others are cancelled.
const GEMINI_HEDGE_MS = 2_500;
const GEMINI_TOTAL_TIMEOUT_MS = 35_000;
// Replies are small JSON; capping output stops a model that gets stuck emitting padding in JSON mode.
const GEMINI_MAX_OUTPUT_TOKENS = 4096; // room for a plan of several client messages
const GEMINI_RETRYABLE = new Set([404, 429, 500, 503, 504]);
// Set once a working model has been found by asking the API (survives while the function stays warm).
let discoveredGeminiModel: string | null = null;

// Ask the API which models this key can use: general-purpose Flash / Flash-Lite, stable first, newest first.
async function discoverGeminiModels(ai: GoogleGenAI): Promise<string[]> {
  const candidates: { id: string; version: number; stable: boolean }[] = [];
  for await (const m of await ai.models.list()) {
    const id = (m.name ?? '').replace(/^models\//, '');
    if (!m.supportedActions?.includes('generateContent')) continue;
    if (!/^gemini-[\d.]+-flash/.test(id)) continue;
    if (/live|image|tts|audio|embed|thinking|8b/.test(id)) continue;
    candidates.push({
      id,
      version: Number.parseFloat(id.match(/^gemini-([\d.]+)/)?.[1] ?? '0'),
      stable: !/preview|exp|latest/.test(id),
    });
  }
  candidates.sort((a, b) => Number(b.stable) - Number(a.stable) || b.version - a.version || a.id.length - b.id.length);
  console.log('Gemini models available:', candidates.map((c) => c.id).join(', ') || '(none)');
  return candidates.map((c) => c.id);
}
const MAX_HISTORY = 12;
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 5_000_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const DAY_MS = 86_400_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface RequestBody {
  message: string;
  images?: { media_type: string; data: string }[];
  history?: { role: 'user' | 'assistant'; text: string }[];
  mentions?: { id: string; handle: string }[]; // tasks the user tagged with @handle
  clients?: { key: string; name: string; taskIds: string[] }[]; // clients with several active tasks
  tz: { name: string; offsetMinutes: number }; // offsetMinutes = Date#getTimezoneOffset()
  workspace?: 'agency' | 'personal'; // the assistant only sees and changes this workspace's tasks
}

type WorkspaceId = 'agency' | 'personal';

interface TaskRow {
  id: string;
  text: string;
  done: boolean;
  completed_at: string | null;
  due_date: string | null;
  cadence_per_week: number | null;
  last_updated: string;
  created_at: string;
  task_updates: { id: string; text: string; created_at: string }[];
  waiting_since?: string | null;
  waiting_for?: string | null;
  planned_updates?: { send_on: string; title: string; text: string; status: string }[];
}

interface PlannedRow {
  id: string;
  send_on: string;
  title: string;
  text: string;
  position: number;
}

// Undo recipes the client can replay to reverse each change.
type Undo =
  | { type: 'delete_task'; taskId: string }
  | { type: 'delete_update'; taskId: string; updateId: string; lastUpdated: string }
  | { type: 'reopen'; taskId: string; updateId: string | null; lastUpdated: string }
  | { type: 'complete'; taskId: string; completedAt: string | null }
  | { type: 'set_due'; taskId: string; dueDate: string | null }
  | { type: 'rename'; taskId: string; text: string }
  | { type: 'set_cadence'; taskId: string; perWeek: number | null }
  | { type: 'set_waiting'; taskId: string; since: string | null; waitingFor: string | null }
  | { type: 'replace_planned'; taskId: string; ids: string[]; restore: PlannedRow[]; deleteTask?: boolean };

interface Result {
  kind: 'added' | 'logged' | 'completed' | 'reopened' | 'due' | 'renamed' | 'rhythm' | 'waiting' | 'planned' | 'skipped';
  title: string;
  detail: string | null;
  undo: Undo | null;
}

// ---------- time, in the user's timezone ----------

function makeClock(offsetMinutes: number) {
  const shift = offsetMinutes * 60_000;
  const local = (ms: number) => new Date(ms - shift); // UTC fields of this Date read as local time
  const keyOf = (ms: number) => local(ms).toISOString().slice(0, 10);
  const today = keyOf(Date.now());
  return {
    today,
    keyOf: (iso: string) => keyOf(Date.parse(iso)),
    daysBetween: (fromKey: string, toKey: string) => Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS),
    // A date the model gave for "when it happened" → timestamp. Today (or anything invalid/future) → now.
    toTimestamp(key: string | null) {
      if (!key || !isDateKey(key) || key >= today) return new Date().toISOString();
      const [y, m, d] = key.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12) + shift).toISOString(); // midday local
    },
    describeNow() {
      const now = local(Date.now());
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const time = now.toISOString().slice(11, 16);
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      return { weekday, time, weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10) };
    },
  };
}
type Clock = ReturnType<typeof makeClock>;

const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const DEFAULT_CADENCE = 2; // every task gets a twice-a-week rhythm unless told otherwise
const validCadence = (n: number | null) => (n === 1 || n === 2 || n === 3 ? n : null);
// add_task: 0 means no rhythm (paused / on hold); null means the workspace default.
const newTaskCadence = (n: number | null, workspace: 'agency' | 'personal') =>
  n === 0 ? null : (validCadence(n) ?? (workspace === 'agency' ? DEFAULT_CADENCE : null));
const clean = (s: string | null, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- pacing planned client updates ----------
// Date keys are plain calendar days (YYYY-MM-DD), handled in UTC so no timezone can shift them.
const addDaysKey = (key: string, n: number) => new Date(Date.parse(key) + n * DAY_MS).toISOString().slice(0, 10);
const dowOf = (key: string) => new Date(Date.parse(key)).getUTCDay();
// Same working days as the app: not Sundays, not the 2nd or 4th Saturday.
function isWorkingKey(key: string) {
  const d = dowOf(key);
  if (d === 0) return false;
  if (d === 6) {
    const nth = Math.ceil(Number(key.slice(8, 10)) / 7);
    return nth !== 2 && nth !== 4;
  }
  return true;
}
// Preferred days (0 = Monday): twice a week → Tue + Fri; three times → Mon, Wed, Fri.
const IDEAL_DAYS: Record<number, number[]> = { 2: [1, 4], 3: [0, 2, 4] };

// Up to n dates from `from` on the rhythm's days, a day apart, skipping taken days, not after `until`.
function rhythmDates(n: number, from: string, perWeek: number, taken: Set<string>, until: string | null) {
  const ideal = IDEAL_DAYS[perWeek];
  const out: string[] = [];
  let last: string | null = null;
  const limit = until ?? addDaysKey(from, 7 * 26);
  for (let k = from; k <= limit && out.length < n; k = addDaysKey(k, 1)) {
    if (!isWorkingKey(k) || taken.has(k) || !ideal.includes((dowOf(k) + 6) % 7)) continue;
    if (last && (Date.parse(k) - Date.parse(last)) / DAY_MS < 2) continue;
    out.push(k);
    last = k;
  }
  return out;
}

// Dates for the parts that weren't pinned to a day: 2 a week (or the task's 3), from tomorrow; never more
// than 3 a week. With a deadline they finish the day before it, going up to 3 a week; if even that can't fit
// them, the extras share the last day.
function scheduleParts(n: number, today: string, cadence: number | null, due: string | null, taken: Set<string>) {
  if (!n) return [];
  const from = addDaysKey(today, 1);
  const until = due ? addDaysKey(due, -1) : null;
  const base = cadence === 3 ? 3 : 2;
  if (until && until >= from) {
    for (const perWeek of base === 3 ? [3] : [2, 3]) {
      const dates = rhythmDates(n, from, perWeek, taken, until);
      if (dates.length === n) return dates;
    }
    const dates = rhythmDates(n, from, 3, taken, until);
    if (!dates.length) {
      for (let k = until; k >= from; k = addDaysKey(k, -1)) if (isWorkingKey(k)) { dates.push(k); break; }
    }
    while (dates.length && dates.length < n) dates.push(dates[dates.length - 1]);
    if (dates.length) return dates;
  }
  return rhythmDates(n, from, base, taken, null);
}

// ---------- the per-request context block ----------

type ClientInfo = { key: string; name: string; taskIds: string[] };

function buildContext(tasks: TaskRow[], clock: Clock, tzName: string, clients: ClientInfo[] = [], workspace: WorkspaceId = 'agency') {
  const clientOf = new Map(clients.flatMap((c) => c.taskIds.map((id) => [id, c] as const)));
  const refs = new Map<string, TaskRow>();
  const { weekday, time, weekStart, weekEnd } = clock.describeNow();
  const active = tasks.filter((t) => !t.done);
  const recentDone = tasks.filter(
    (t) => t.done && t.completed_at && clock.daysBetween(clock.keyOf(t.completed_at), clock.today) <= 21,
  );

  const weekdayOf = (key: string) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

  const line = (t: TaskRow) => {
    const ref = `T${refs.size + 1}`;
    refs.set(ref, t);
    const lastKey = clock.keyOf(t.last_updated);
    const quiet = clock.daysBetween(lastKey, clock.today);
    const parts = [
      `added ${clock.keyOf(t.created_at)}`,
      t.done && t.completed_at
        ? `completed ${clock.keyOf(t.completed_at)}`
        : `last update ${lastKey} (${quiet === 0 ? 'today' : `${quiet} day${quiet === 1 ? '' : 's'} ago`})`,
      t.due_date ? `due ${t.due_date}` : 'no due date',
    ];
    if (t.waiting_since) {
      parts.push(`WAITING ON CLIENT since ${clock.keyOf(t.waiting_since)}${t.waiting_for ? ` for: ${t.waiting_for}` : ''}`);
    }
    const client = !t.done ? clientOf.get(t.id) : undefined;
    if (client) {
      parts.push(`client ${client.name} (@${client.key}); check-ins are shared across the client's tasks, see <clients>`);
    } else if (t.cadence_per_week) {
      const days = [...new Set(t.task_updates.map((u) => clock.keyOf(u.created_at)))]
        .filter((d) => d >= weekStart && d <= clock.today)
        .sort();
      parts.push(
        `rhythm ${t.cadence_per_week}x per week (working days, a day between); logged this week on: ${
          days.length ? days.map((d) => `${weekdayOf(d)} ${d}`).join(', ') : 'none'
        }`,
      );
    }
    const plan = (t.planned_updates ?? []).filter((p) => p.status === 'planned').sort((a, b) => a.send_on.localeCompare(b.send_on));
    if (plan.length) {
      parts.push(`PLANNED CLIENT UPDATES (not sent yet): ${plan.map((p) => `${weekdayOf(p.send_on)} ${p.send_on} "${p.title}"`).join(', ')}`);
      // The one due now, in full: a draft for this client should be this message.
      const dueNow = plan.find((p) => p.send_on <= clock.today);
      if (dueNow) parts.push(`DUE NOW, planned message "${dueNow.title}": ${dueNow.text.replace(/\s+/g, ' ')}`);
    }
    const logs = [...t.task_updates]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)
      .map((u) => `    ${clock.keyOf(u.created_at)}: ${u.text}`);
    return [`${ref} "${t.text}" | ${parts.join(' | ')}`, ...(logs.length ? ['  logs, newest first:', ...logs] : [])].join('\n');
  };

  const text: string[] = [
    '<context>',
    `Today: ${weekday} ${clock.today}, ${time} local time (${tzName}).`,
    `This week: Monday ${weekStart} to Sunday ${weekEnd}.`,
    workspace === 'personal'
      ? "Workspace: Personal (the user's own tasks, not client work; new tasks get no rhythm unless asked; there are no client updates to draft unless the user asks)."
      : 'Workspace: Mint-more (agency client work).',
    '</context>',
    '<tasks>',
    'Active:',
    active.length ? active.map(line).join('\n') : '(none)',
    '',
    'Completed in the last 21 days:',
    recentDone.length ? recentDone.map(line).join('\n') : '(none)',
    '</tasks>',
  ];

  // Clients with several tasks: one check-in rhythm per client; a log on any of its tasks counts.
  if (clients.length) {
    const refOf = new Map([...refs].map(([ref, t]) => [t.id, ref]));
    text.push('<clients>');
    for (const c of clients) {
      const members = c.taskIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is TaskRow => !!t);
      if (!members.length) continue;
      const perWeek = members[0].cadence_per_week;
      const days = [...new Set(members.flatMap((t) => t.task_updates.map((u) => clock.keyOf(u.created_at))))]
        .filter((d) => d >= weekStart && d <= clock.today)
        .sort();
      text.push(
        `${c.name} (@${c.key}): ${members.map((t) => refOf.get(t.id)).filter(Boolean).join(', ')}` +
          (perWeek
            ? ` | rhythm ${perWeek}x per week for the client (working days, a day between); logged this week on: ${
                days.length ? days.map((d) => `${weekdayOf(d)} ${d}`).join(', ') : 'none'
              }`
            : ''),
      );
    }
    text.push('</clients>');
  }

  return { refs, text: text.join('\n') };
}

// ---------- applying the model's actions ----------

// "Hotel Sonajhuri website" and "hotel  sonajhuri Website!" are the same task.
const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const weekdayOf = (key: string) => new Date(Date.parse(key)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

async function applyActions(db: SupabaseClient, actions: Action[], refs: Map<string, TaskRow>, clock: Clock, workspace: WorkspaceId) {
  const results: Result[] = [];
  const skip = (title: string, detail: string) => results.push({ kind: 'skipped', title, detail, undo: null });

  // Active tasks as they are right now (re-read, so a repeated or overlapping request can't add a second copy),
  // plus anything added earlier in this batch (a model may list the same task twice).
  const { data: activeNow } = await db
    .from('tasks')
    .select('id, text, last_updated')
    .eq('done', false)
    .eq('workspace', workspace)
    .is('deleted_at', null)
    .is('archived_at', null);
  const existing = new Map((activeNow ?? []).map((t) => [titleKey(t.text), t as { id: string; text: string; last_updated: string }]));

  for (const a of actions) {
    if (!ACTION_TYPES.includes(a.type)) continue;
    const task = a.task_ref ? refs.get(a.task_ref.trim().toUpperCase()) : undefined;
    const dueDate = a.due_date && isDateKey(a.due_date) ? a.due_date : null;

    if (a.type === 'add_task') {
      const title = clean(a.text, 500);
      if (!title) continue;
      const done = a.done === true;
      const same = existing.get(titleKey(title));
      if (same && !done) {
        // Never duplicate: keep the existing task, and log the note on it if there was one.
        const note = clean(a.note, 2000);
        if (note) {
          const { data } = await db
            .from('task_updates')
            .insert({ task_id: same.id, text: note, created_at: clock.toTimestamp(a.date) })
            .select('id')
            .single();
          if (data)
            results.push({
              kind: 'logged',
              title: same.text,
              detail: note,
              undo: { type: 'delete_update', taskId: same.id, updateId: data.id, lastUpdated: same.last_updated },
            });
        } else {
          skip(same.text, 'already on your list');
        }
        continue;
      }
      // Work handed over earlier ("got it on the 14th") starts on that day, so its rhythm counts from then.
      const started = a.start_date && isDateKey(a.start_date) && a.start_date < clock.today ? clock.toTimestamp(a.start_date) : null;
      const waitingFor = done ? '' : clean(a.waiting_for, 200);
      const { data, error } = await db
        .from('tasks')
        .insert({
          text: title,
          due_date: dueDate,
          done,
          completed_at: done ? clock.toTimestamp(a.date) : null,
          cadence_per_week: newTaskCadence(a.cadence_per_week, workspace),
          workspace,
          ...(started ? { created_at: started, last_updated: started } : {}),
          ...(waitingFor ? { waiting_since: started ?? new Date().toISOString(), waiting_for: waitingFor } : {}),
        })
        .select('id')
        .single();
      if (error) {
        skip(title, error.message);
        continue;
      }
      if (!done) existing.set(titleKey(title), { id: data.id, text: title, last_updated: new Date().toISOString() });
      const note = clean(a.note, 2000);
      if (note) await db.from('task_updates').insert({ task_id: data.id, text: note, created_at: clock.toTimestamp(a.date) });
      results.push({
        kind: 'added',
        title,
        detail: done
          ? 'already done'
          : [
              started && `since ${a.start_date}`,
              dueDate && `due ${dueDate}`,
              waitingFor && `waiting: ${waitingFor}`,
              a.cadence_per_week === 0 ? 'no rhythm' : validCadence(a.cadence_per_week) && `${a.cadence_per_week}x a week`,
            ]
              .filter(Boolean)
              .join(' · ') || null,
        undo: { type: 'delete_task', taskId: data.id },
      });
      continue;
    }

    if (a.type === 'plan_updates') {
      // Target: the referenced task, an existing task with this title, or a new one.
      let target: { id: string; text: string; cadence: number | null; due: string | null } | null = task
        ? { id: task.id, text: task.text, cadence: task.cadence_per_week, due: task.due_date }
        : null;
      let created = false;
      if (!target) {
        const title = clean(a.text, 500);
        const same = title ? existing.get(titleKey(title)) : undefined;
        if (same) {
          const { data } = await db.from('tasks').select('cadence_per_week, due_date').eq('id', same.id).single();
          target = { id: same.id, text: same.text, cadence: data?.cadence_per_week ?? DEFAULT_CADENCE, due: data?.due_date ?? null };
        } else if (title) {
          const { data, error } = await db
            .from('tasks')
            .insert({ text: title, cadence_per_week: workspace === 'agency' ? DEFAULT_CADENCE : null, workspace })
            .select('id')
            .single();
          if (error) {
            skip(title, error.message);
            continue;
          }
          target = { id: data.id, text: title, cadence: DEFAULT_CADENCE, due: null };
          existing.set(titleKey(title), { id: data.id, text: title, last_updated: new Date().toISOString() });
          created = true;
        }
      }
      if (!target) {
        skip(a.task_ref ?? 'Unknown task', "Couldn't find that task");
        continue;
      }
      const parts = (a.parts ?? [])
        .map((p) => ({
          title: clean(p?.title ?? null, 120),
          text: String(p?.text ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, 2000),
          on: p?.send_on && isDateKey(p.send_on) && p.send_on >= clock.today ? p.send_on : null,
        }))
        .filter((p) => p.title && p.text)
        .slice(0, 12);
      if (!parts.length) {
        skip(target.text, 'no updates to plan');
        continue;
      }
      // A new plan replaces whatever was still waiting to be sent.
      const { data: old } = await db
        .from('planned_updates')
        .select('id, send_on, title, text, position')
        .eq('task_id', target.id)
        .eq('status', 'planned');
      if (old?.length) await db.from('planned_updates').delete().in('id', old.map((o) => o.id));
      const pinned = new Set(parts.filter((p) => p.on).map((p) => p.on!));
      const dates = scheduleParts(parts.filter((p) => !p.on).length, clock.today, target.cadence, target.due, pinned);
      let next = 0;
      const rows = parts.map((p, i) => ({ task_id: target!.id, send_on: p.on ?? dates[next++], title: p.title, text: p.text, position: i }));
      const { data: inserted, error } = await db.from('planned_updates').insert(rows).select('id, send_on');
      if (error || !inserted) {
        skip(target.text, error?.message ?? 'could not save the plan');
        continue;
      }
      const days = inserted.map((r) => r.send_on as string).sort();
      const short = (k: string) => `${weekdayOf(k)} ${Number(k.slice(8))} ${new Date(Date.parse(k)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
      results.push({
        kind: 'planned',
        title: target.text,
        detail: `${rows.length} ${rows.length === 1 ? 'update' : 'updates'}, ${days[0] === clock.today ? 'first one today' : short(days[0])}${
          days.length > 1 ? ` → ${short(days[days.length - 1])}` : ''
        }`,
        undo: { type: 'replace_planned', taskId: target.id, ids: inserted.map((r) => r.id as string), restore: (old ?? []) as PlannedRow[], deleteTask: created },
      });
      continue;
    }

    if (!task) {
      skip(a.task_ref ?? 'Unknown task', "Couldn't find that task");
      continue;
    }

    switch (a.type) {
      case 'log_update': {
        const text = clean(a.text, 2000);
        if (!text) break;
        const createdAt = clock.toTimestamp(a.date);
        const { data, error } = await db
          .from('task_updates')
          .insert({ task_id: task.id, text, created_at: createdAt })
          .select('id')
          .single();
        if (error) skip(task.text, error.message);
        else
          results.push({
            kind: 'logged',
            title: task.text,
            detail: `${text}${clock.keyOf(createdAt) !== clock.today ? ` (${clock.keyOf(createdAt)})` : ''}`,
            undo: { type: 'delete_update', taskId: task.id, updateId: data.id, lastUpdated: task.last_updated },
          });
        break;
      }
      case 'complete_task': {
        if (task.done) break;
        const completedAt = clock.toTimestamp(a.date);
        const { error } = await db.from('tasks').update({ done: true, completed_at: completedAt }).eq('id', task.id);
        if (error) {
          skip(task.text, error.message);
          break;
        }
        let updateId: string | null = null;
        const note = clean(a.note, 2000);
        if (note) {
          const { data } = await db
            .from('task_updates')
            .insert({ task_id: task.id, text: note, created_at: completedAt })
            .select('id')
            .single();
          updateId = data?.id ?? null;
        }
        results.push({
          kind: 'completed',
          title: task.text,
          detail: note || null,
          undo: { type: 'reopen', taskId: task.id, updateId, lastUpdated: task.last_updated },
        });
        break;
      }
      case 'reopen_task': {
        if (!task.done) break;
        const { error } = await db.from('tasks').update({ done: false, completed_at: null }).eq('id', task.id);
        if (error) skip(task.text, error.message);
        else
          results.push({
            kind: 'reopened',
            title: task.text,
            detail: null,
            undo: { type: 'complete', taskId: task.id, completedAt: task.completed_at },
          });
        break;
      }
      case 'set_due_date': {
        if (a.due_date && !dueDate) break; // unparseable date: don't silently clear the deadline
        const { error } = await db.from('tasks').update({ due_date: dueDate }).eq('id', task.id);
        if (error) skip(task.text, error.message);
        else
          results.push({
            kind: 'due',
            title: task.text,
            detail: dueDate ? `due ${dueDate}` : 'no due date',
            undo: { type: 'set_due', taskId: task.id, dueDate: task.due_date },
          });
        break;
      }
      case 'set_waiting':
      case 'clear_waiting': {
        const waiting = a.type === 'set_waiting';
        const waitingFor = waiting ? clean(a.text, 200) || task.waiting_for || null : null;
        const patch = waiting
          ? { waiting_since: task.waiting_since ?? new Date().toISOString(), waiting_for: waitingFor }
          : { waiting_since: null, waiting_for: null };
        if (!waiting && !task.waiting_since) break;
        const { error } = await db.from('tasks').update(patch).eq('id', task.id);
        if (error) skip(task.text, error.message);
        else
          results.push({
            kind: 'waiting',
            title: task.text,
            detail: waiting ? `waiting on client${waitingFor ? `: ${waitingFor}` : ''}` : 'no longer waiting',
            undo: { type: 'set_waiting', taskId: task.id, since: task.waiting_since ?? null, waitingFor: task.waiting_for ?? null },
          });
        break;
      }
      case 'set_cadence': {
        const perWeek = validCadence(a.cadence_per_week);
        if (perWeek === task.cadence_per_week) break;
        const { error } = await db.from('tasks').update({ cadence_per_week: perWeek }).eq('id', task.id);
        if (error) skip(task.text, error.message);
        else
          results.push({
            kind: 'rhythm',
            title: task.text,
            detail: perWeek ? `${perWeek}x a week, 2+ days apart` : 'no rhythm',
            undo: { type: 'set_cadence', taskId: task.id, perWeek: task.cadence_per_week },
          });
        break;
      }
      case 'rename_task': {
        const text = clean(a.text, 500);
        if (!text || text === task.text) break;
        const { error } = await db.from('tasks').update({ text }).eq('id', task.id);
        if (error) skip(task.text, error.message);
        else
          results.push({ kind: 'renamed', title: text, detail: `was "${task.text}"`, undo: { type: 'rename', taskId: task.id, text: task.text } });
        break;
      }
    }
  }
  return results;
}

// ---------- model providers ----------

interface ModelRequest {
  context: string; // per-request <context>/<tasks> block
  history: { role: 'user' | 'assistant'; text: string }[];
  message: string;
  images: { media_type: (typeof IMAGE_TYPES)[number]; data: string }[];
}

// A user-facing failure: message + HTTP status.
class AssistantError extends Error {
  constructor(
    message: string,
    readonly status: number,
    public details?: string, // what each model did, shown under the error in the app
  ) {
    super(message);
  }
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

const REFUSAL: AssistantOutput = { reply: "I can't help with that one.", actions: [] };

interface ModelResult {
  raw: string | AssistantOutput;
  model: string;
  tried: string[];
}

async function callClaude(req: ModelRequest): Promise<ModelResult> {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  try {
    const response = await anthropic.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: req.context },
      ],
      messages: [
        ...req.history.map((m) => ({ role: m.role, content: m.text })),
        {
          role: 'user',
          content: [
            ...req.images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
            })),
            { type: 'text' as const, text: req.message },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal') return { raw: REFUSAL, model: CLAUDE_MODEL, tried: [CLAUDE_MODEL] };
    const text = response.content.find((b) => b.type === 'text');
    return { raw: text && text.type === 'text' ? text.text : '', model: CLAUDE_MODEL, tried: [CLAUDE_MODEL] };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new AssistantError('The assistant is busy. Try again in a moment.', 429);
    if (error instanceof Anthropic.AuthenticationError) throw new AssistantError('The assistant is not configured (API key).', 500);
    if (error instanceof Anthropic.APIError) throw new AssistantError(`Assistant error (${error.status}).`, 502);
    throw new AssistantError('Could not reach the assistant.', 502);
  }
}

function geminiFailure(error: unknown): AssistantError {
  if (error instanceof GeminiApiError) {
    if (error.status === 429) return new AssistantError('Free-tier limit reached. Try again in a minute.', 429);
    if (error.status === 503 || error.status === 500 || error.status === 504)
      return new AssistantError('Gemini is overloaded right now. Try again in a moment.', 503);
    if (error.status === 400 || error.status === 401 || error.status === 403)
      return new AssistantError(`The assistant is not configured correctly (Gemini ${error.status}).`, 500);
    return new AssistantError(`Assistant error (Gemini ${error.status}).`, 502);
  }
  if (isTimeout(error)) return new AssistantError('Gemini is responding slowly right now. Try again in a moment.', 504);
  return new AssistantError('Could not reach Gemini.', 502);
}

const geminiRetryable = (e: unknown) =>
  isTimeout(e) ||
  (e instanceof Error && e.message === 'MAX_TOKENS') ||
  (e instanceof GeminiApiError && GEMINI_RETRYABLE.has(e.status));

async function callGemini(req: ModelRequest, apiKey: string): Promise<ModelResult> {
  const ai = new GoogleGenAI({ apiKey });
  const contents: Content[] = [
    ...req.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
    {
      role: 'user',
      parts: [...req.images.map((img) => ({ inlineData: { mimeType: img.media_type, data: img.data } })), { text: req.message }],
    },
  ];

  const stop = new AbortController(); // cancels the losers once one model answers
  const failures: string[] = [];
  const describe = (e: unknown) =>
    e instanceof GeminiApiError ? `error ${e.status}` : isTimeout(e) ? 'timed out' : e instanceof Error ? e.message : 'failed';

  // One model call; retries once without the thinking setting if the model rejects it.
  const runOne = async (model: string, signal: AbortSignal): Promise<string | AssistantOutput> => {
    for (const thinking of [true, false]) {
      const started = Date.now();
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: `${SYSTEM_PROMPT}\n\n${req.context}`,
            responseMimeType: 'application/json',
            responseJsonSchema: RESPONSE_SCHEMA,
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            // Minimal thinking = fastest first token; the task is simple.
            ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
            abortSignal: signal,
          },
        });
        console.log(`Gemini ${model} answered in ${Date.now() - started}ms (finish: ${response.candidates?.[0]?.finishReason})`);
        if (response.promptFeedback?.blockReason) return REFUSAL;
        // Hit the output cap: almost always runaway padding, not a real answer. Treat as a failed attempt.
        if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('MAX_TOKENS');
        return response.text ?? '';
      } catch (error) {
        if (stop.signal.aborted) throw error; // lost the race: cancelled on purpose, not a failure
        failures.push(`${model}: ${describe(error)} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
        console.error(
          `Gemini ${model} failed after ${Date.now() - started}ms:`,
          error instanceof GeminiApiError ? `${error.status} ${error.message}` : error,
        );
        if (thinking && error instanceof GeminiApiError && error.status === 400 && /thinking/i.test(error.message)) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  };

  const models = [...new Set([discoveredGeminiModel, GEMINI_MODEL, ...GEMINI_FALLBACKS].filter((m): m is string => !!m))];
  const tried: string[] = [];
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(GEMINI_TOTAL_TIMEOUT_MS)]);

  return await new Promise<ModelResult>((resolve, reject) => {
    let next = 0;
    let running = 0;
    let settled = false;
    let discovered = false;
    let lastError: unknown;
    let hedge: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedge);
      stop.abort();
      fn();
    };

    // Out of known models: look up this key's other models once, straight away (a hung model may still be
    // running, and it shouldn't hold the backups back). Give up only when nothing is left and nothing runs.
    let discovering = false;
    const exhausted = async () => {
      if (!discovered && (lastError === undefined || geminiRetryable(lastError))) {
        discovered = discovering = true;
        const more = await discoverGeminiModels(ai).catch(() => [] as string[]);
        discovering = false;
        models.push(...more.filter((m) => !models.includes(m)).slice(0, 3));
        if (next < models.length) return launch();
      }
      if (running === 0 && !discovering) finish(() => reject(withDetails(geminiFailure(lastError))));
    };

    const withDetails = (e: AssistantError) => {
      e.details = failures.join(' · ') || undefined;
      return e;
    };

    const launch = () => {
      if (settled) return;
      if (next >= models.length) {
        if (!discovered || running === 0) void exhausted();
        return;
      }
      const model = models[next++];
      tried.push(model);
      running++;
      runOne(model, signal).then(
        (raw) =>
          finish(() => {
            discoveredGeminiModel = model; // try the winner first next time
            resolve({ raw, model, tried });
          }),
        (error) => {
          running--;
          if (settled) return;
          lastError = error;
          if (!geminiRetryable(error)) return finish(() => reject(withDetails(geminiFailure(error))));
          launch(); // failed fast (busy / retired): start the next model right away
        },
      );
      clearTimeout(hedge);
      hedge = setTimeout(launch, GEMINI_HEDGE_MS); // still waiting: start the next one in parallel
    };

    launch();
  });
}

// ---------- request handling ----------

async function handle(req: Request): Promise<Response> {
  const t0 = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!userData.user) return json({ error: 'Not signed in' }, 401);
  const tAuth = Date.now();

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  if (!body.message?.trim() && !body.images?.length) return json({ error: 'Say something first' }, 400);

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey && !Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'The assistant has no API key yet. Add GEMINI_API_KEY in Supabase → Edge Functions → Secrets.' }, 500);
  }

  const clock = makeClock(Number.isFinite(body.tz?.offsetMinutes) ? body.tz.offsetMinutes : 0);

  const workspace: WorkspaceId = body.workspace === 'personal' ? 'personal' : 'agency';
  // This workspace's tasks, leaving out archived ones and the trash.
  const { data: tasks, error: tasksError } = await db
    .from('tasks')
    .select(
      'id, text, done, completed_at, due_date, cadence_per_week, waiting_since, waiting_for, last_updated, created_at, task_updates (id, text, created_at), planned_updates (send_on, title, text, status)',
    )
    .eq('workspace', workspace)
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (tasksError) return json({ error: tasksError.message }, 500);
  const tTasks = Date.now();

  const clientInfo: ClientInfo[] = (body.clients ?? [])
    .filter((c) => c && typeof c.key === 'string' && typeof c.name === 'string' && Array.isArray(c.taskIds))
    .slice(0, 100)
    .map((c) => ({ key: clean(c.key, 40), name: clean(c.name, 60), taskIds: c.taskIds.filter((id) => typeof id === 'string') }));
  const { refs, text: contextText } = buildContext(tasks as unknown as TaskRow[], clock, clean(body.tz?.name ?? 'UTC', 64), clientInfo, workspace);

  const history = (body.history ?? [])
    .slice(-MAX_HISTORY)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text?.trim())
    .map((m) => ({ role: m.role, text: clean(m.text, 6000) }));
  // Both APIs need the conversation to start with a user turn.
  while (history.length && history[0].role !== 'user') history.shift();

  const images: ModelRequest['images'] = [];
  for (const img of (body.images ?? []).slice(0, MAX_IMAGES)) {
    const mediaType = IMAGE_TYPES.find((t) => t === img.media_type);
    if (mediaType && typeof img.data === 'string' && img.data.length <= MAX_IMAGE_B64) images.push({ media_type: mediaType, data: img.data });
  }

  // Tasks tagged with @ in the message: tell the model exactly which refs they are.
  const refOf = new Map([...refs].map(([ref, t]) => [t.id, ref]));
  const tagged = (body.mentions ?? [])
    .filter((m) => m && typeof m.id === 'string' && typeof m.handle === 'string')
    .map((m) => {
      const ref = refOf.get(m.id);
      return ref ? `@${clean(m.handle, 40)} = ${ref} ("${refs.get(ref)!.text}")` : null;
    })
    .filter(Boolean);
  const message = clean(body.message, 4000) || '(no text; see the attached image)';

  const modelRequest: ModelRequest = {
    context: contextText,
    history,
    message: tagged.length ? `${message}\n\n<tagged_tasks>\n${tagged.join('\n')}\n</tagged_tasks>` : message,
    images,
  };

  let output: AssistantOutput;
  let result: ModelResult;
  try {
    result = geminiKey ? await callGemini(modelRequest, geminiKey) : await callClaude(modelRequest);
    const raw = result.raw;
    output = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof output.reply !== 'string' || !Array.isArray(output.actions)) throw new Error('bad shape');
  } catch (error) {
    if (error instanceof AssistantError) return json({ error: error.message, details: error.details }, error.status);
    return json({ error: 'The assistant gave an unreadable answer. Try rephrasing.' }, 502);
  }

  const tModel = Date.now();
  const results = await applyActions(db, output.actions, refs, clock, workspace);
  // A drafted client message, tied back to its task so the app can log it as sent.
  const draftTask = output.draft?.task_ref ? refs.get(output.draft.task_ref.trim().toUpperCase()) : undefined;
  const draft =
    output.draft && typeof output.draft.text === 'string' && output.draft.text.trim()
      ? { taskId: draftTask?.id ?? null, title: draftTask?.text ?? null, text: output.draft.text.trim() }
      : null;
  const tEnd = Date.now();
  const meta = {
    model: result.model,
    tried: result.tried,
    ms: { auth: tAuth - t0, tasks: tTasks - tAuth, ai: tModel - tTasks, save: tEnd - tModel, total: tEnd - t0 },
  };
  console.log('agenda-ai timing', JSON.stringify(meta));
  return json({ reply: output.reply, results, raw: output, meta, draft });
}

// Any unexpected failure still returns JSON with CORS headers, so the app can show a real message.
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('agenda-ai failed:', error);
    return json({ error: 'Something went wrong on the server. Try again.' }, 500);
  }
});
