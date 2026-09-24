import type { Task } from '../types';
import { COMMON_WORDS } from './commonWords';

// Short @handles. Every task belongs to a client, named by the first distinctive word of its title
// ("Hotel Sonajhuri website" → sonajhuri) unless the user set one. A client with one task is tagged
// @sonajhuri; with several, @sonajhuri is the client and each task gets @sonajhuri/website, @sonajhuri/social…

const words = (s: string) => new Set(s.trim().split(/\s+/));
const ARTICLES = words('a an the and or of for to with on in at by from my our your');
const VERBS = words(
  'update updates review fix build make send call finish finalize finalise create design write check prepare ' +
    'revamp redesign rebuild refresh launch relaunch setup migrate migration optimize optimise integrate implement ' +
    'develop deploy test edit add improve upgrade plan follow up get set do start draft share sync',
);
// Business-type words: the name next to them is the useful part ("Hotel Sonajhuri" → sonajhuri).
const BUSINESS = words(
  'hotel hotels resort resorts restaurant cafe bar bakery kitchen salon spa clinic hospital school academy ' +
    'beach villa villas homestay lodge inn palace residency suites retreat camp ' +
    'store shop boutique mart clothing fashion apparel trading traders studio studios agency company co ' +
    'pvt private ltd limited inc llp llc group enterprises industries solutions services consultancy tech',
);
// Kinds of work: never a client name, but great sub-tags (@sonajhuri/website, @venturescape/logo).
const WORK = words(
  'shoot photoshoot catalog catalogue logo branding content copy seo weekly daily monthly meeting ' +
    'client clients website site web app project task work team page landing social media posts ' +
    'old new big small final first next last quick all some more',
);
const GENERIC = new Set([...ARTICLES, ...VERBS, ...BUSINESS, ...WORK]);

const splitWords = (title: string) => title.split(/[^A-Za-z0-9]+/).filter(Boolean);

export function baseHandle(title: string) {
  const all = splitWords(title);
  const distinctive = all
    .map((w, i) => ({ w, i, common: COMMON_WORDS.has(w.toLowerCase()), caps: /^[A-Z]/.test(w) }))
    .filter(({ w }) => w.length >= 3 && !GENERIC.has(w.toLowerCase()) && !/^\d+$/.test(w));
  // In order: a word the user capitalised on purpose (not just the sentence-case first word), a word that
  // isn't ordinary English (works for all-lowercase titles: "hotel sonajhuri" → sonajhuri), any capitalised
  // word ("Sunrise Hotel" → sunrise), then simply the first distinctive word.
  const pick =
    distinctive.find(({ i, caps, common }) => caps && (i > 0 || !common)) ??
    distinctive.find(({ common }) => !common) ??
    distinctive.find(({ caps }) => caps) ??
    distinctive[0];
  return pick?.w.toLowerCase() ?? all[0]?.toLowerCase() ?? 'task';
}

// The part of a title that says which piece of the client's work it is: "Hotel Sonajhuri website" → website.
function subHandle(title: string, client: string) {
  const rest = splitWords(title)
    .map((w) => w.toLowerCase())
    .filter((w) => w !== client && !ARTICLES.has(w) && !/^\d+$/.test(w));
  return rest.find((w) => !VERBS.has(w) && !BUSINESS.has(w)) ?? rest.find((w) => !VERBS.has(w)) ?? rest[0] ?? 'task';
}

// Custom tags/client names the user typed: letters and digits only, 2–30 long.
export const cleanHandle = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);

export const clientKeyOf = (t: Task) => {
  const custom = t.client ? cleanHandle(t.client) : '';
  return custom.length >= 2 ? custom : baseHandle(t.text);
};

export interface ClientGroup {
  key: string; // also the client's @tag
  name: string; // display name, e.g. "Sonajhuri"
  tasks: Task[]; // oldest first
  lead: Task; // carries the client's check-in rhythm
}

// Active tasks grouped by client (with `includeDone`, finished ones too, for history).
export function groupClients(tasks: Task[], includeDone = false): Map<string, ClientGroup> {
  const groups = new Map<string, ClientGroup>();
  for (const t of [...tasks].filter((t) => includeDone || !t.done).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = clientKeyOf(t);
    const g = groups.get(key);
    if (g) g.tasks.push(t);
    else {
      // Show the name as the user wrote it in the title ("Sonajhuri"), else capitalise the key.
      const asWritten = splitWords(t.text).find((w) => w.toLowerCase() === key);
      const name = asWritten && /^[A-Z]/.test(asWritten) ? asWritten : key.charAt(0).toUpperCase() + key.slice(1);
      groups.set(key, { key, name, tasks: [t], lead: t });
    }
  }
  return groups;
}

// How a task relates to its client's single check-in rhythm.
export interface RhythmScope {
  isLead: boolean; // the task that carries the client's rhythm
  logsFrom: Task[]; // a log on any of these counts as the client's check-in
  clientName: string;
  size: number; // tasks in the client
}

export function rhythmScopes(tasks: Task[]): Map<string, RhythmScope> {
  const scopes = new Map<string, RhythmScope>();
  for (const g of groupClients(tasks).values()) {
    for (const t of g.tasks) {
      scopes.set(t.id, { isLead: t.id === g.lead.id, logsFrom: g.tasks, clientName: g.name, size: g.tasks.length });
    }
  }
  return scopes;
}

// Stable, unique @tag per task. Custom tags win; otherwise the client's tag, or client/sub-tag when the
// client has several active tasks.
export function taskHandles(tasks: Task[]): Map<string, string> {
  const handles = new Map<string, string>();
  const used = new Set<string>();
  for (const t of tasks) {
    const custom = t.handle ? cleanHandle(t.handle) : '';
    if (custom.length >= 2 && !used.has(custom)) {
      used.add(custom);
      handles.set(t.id, custom);
    }
  }
  const groups = groupClients(tasks);
  for (const g of groups.values()) used.add(g.key); // client tags are reserved for the client itself
  for (const t of [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (handles.has(t.id)) continue;
    const key = clientKeyOf(t);
    const g = groups.get(key);
    let base: string;
    if (!g || g.tasks.length === 1) {
      // Only task of its client (or already done): the client's tag is the task's tag.
      if (g && g.tasks[0].id === t.id) {
        handles.set(t.id, key);
        continue;
      }
      base = key;
    } else {
      base = `${key}/${subHandle(t.text, key)}`;
    }
    let handle = base;
    for (let n = 2; used.has(handle); n++) handle = `${base}${n}`;
    used.add(handle);
    handles.set(t.id, handle);
  }
  return handles;
}

// Client tags that stand for several tasks (so "@sonajhuri" means the client).
export function clientTags(tasks: Task[]): Map<string, ClientGroup> {
  return new Map([...groupClients(tasks)].filter(([, g]) => g.tasks.length > 1));
}
