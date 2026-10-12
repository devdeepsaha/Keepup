import { keyToDate } from './dates';

// A change someone made to another person's task, or a reply to an assignment (task_events).
export interface TaskEvent {
  id: string;
  task_id: string | null;
  owner_id: string;
  actor_id: string | null;
  notify_id: string | null;
  kind: string;
  detail: Record<string, unknown>;
  created_at: string;
  seen_at: string | null;
}

const day = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? keyToDate(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'no date';
const q = (v: unknown) => `“${String(v ?? 'a task')}”`;

// "Rahul moved the due date of “Tomboy homepage” to Fri, Oct 16"
export function describeEvent(e: TaskEvent, nameOf: (id: string | null | undefined) => string, viewerId: string): string {
  const who = nameOf(e.actor_id);
  const d = e.detail ?? {};
  const whose = e.owner_id === viewerId ? '' : ` (${nameOf(e.owner_id)}’s)`;
  switch (e.kind) {
    case 'assigned':
      return `${who} gave you ${q(d.title)}`;
    case 'accepted':
      return `${who} accepted ${q(d.title)}`;
    case 'declined':
      return `${who} declined ${q(d.title)}${d.note ? `: “${d.note}”` : ''}`;
    case 'handed_over':
      return `${who} handed ${q(d.title)} over to you`;
    case 'planned_insert':
      return `${who} planned a client update for ${day(d.send_on)}: ${q(d.title)}${whose}`;
    case 'planned_update':
      return `${who} changed the planned update ${q(d.title)} (now ${day(d.send_on)})${whose}`;
    case 'planned_delete':
      return `${who} removed the planned update ${q(d.title)}${whose}`;
    case 'edited': {
      const parts: string[] = [];
      const pair = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]) : null);
      if (pair('due')) parts.push(`due date → ${day(pair('due')![1])}`);
      if (pair('title')) parts.push(`renamed it from ${q(pair('title')![0])}`);
      if (d.done !== undefined) parts.push(d.done ? 'marked it done' : 'reopened it');
      if (pair('rhythm')) parts.push(`rhythm → ${pair('rhythm')![1] ? `${pair('rhythm')![1]}× a week` : 'none'}`);
      if (pair('client')) parts.push(`client → ${pair('client')![1] ?? 'automatic'}`);
      if (pair('hold')) parts.push(pair('hold')![2] ? `put it on hold${pair('hold')![1] ? ` (waiting for ${pair('hold')![1]})` : ''}` : 'took it off hold');
      if (d.links) parts.push('updated its links');
      if (pair('tag')) parts.push('changed its tag');
      return `${who} changed ${q(d.title_now)}${whose}: ${parts.join(', ') || 'details'}`;
    }
    default:
      return `${who} changed ${q(d.title)}`;
  }
}

export function timeAgo(iso: string, now = Date.now()) {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
