import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '../types';
import { supabase } from '../lib/supabase';
import { SELECT } from '../hooks/useTasks';
import { addDays, dayKey, startOfWeek } from '../lib/dates';
import { attentionFor, useNow, type Attention } from '../lib/tasks';
import { groupClients, rhythmScopes } from '../lib/handles';
import { ROLE_LABEL, useOrg, type Person } from '../lib/org';
import { timeAgo } from '../lib/notices';
import AccessEditor from './AccessEditor';

// Founders and managers: everyone whose Mint-more work you can see, at a glance. Click a person for their list.

// Everyone's shared Mint-more tasks that you're allowed to see (the database leaves out the rest).
function useTeamTasks(userId: string) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select(SELECT)
      .eq('workspace', 'agency')
      .neq('user_id', userId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    setTasks((data as unknown as Task[]) ?? []);
  }, [userId]);
  useEffect(() => {
    load();
    const every = window.setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  return { tasks, reload: load };
}

interface Row {
  person: Person;
  open: Task[];
  attention: { task: Task; attention: Attention }[];
  onHold: number;
  pending: number;
  checkIns: number; // logs this week
  lastUpdate: string | null;
  nextPlanned: { date: string; title: string; task: string } | null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export default function TeamView({ userId, onOpenPerson }: { userId: string; onOpenPerson: (id: string) => void }) {
  const org = useOrg();
  const { tasks } = useTeamTasks(userId);
  const now = useNow();
  const todayKey = dayKey(new Date(now));
  const weekStart = startOfWeek(new Date(now)).getTime();
  const [client, setClient] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const clients = useMemo(() => [...groupClients(tasks ?? []).values()].sort((a, b) => a.name.localeCompare(b.name)), [tasks]);

  const rows = useMemo<Row[]>(() => {
    const byPerson = new Map<string, Task[]>();
    for (const t of tasks ?? []) {
      if (!t.user_id) continue;
      byPerson.set(t.user_id, [...(byPerson.get(t.user_id) ?? []), t]);
    }
    const clientTasks = client ? new Set(clients.find((c) => c.key === client)?.tasks.map((t) => t.id)) : null;
    return org.people
      .filter((p) => p.member.status !== 'removed' || byPerson.has(p.member.user_id))
      .map((person) => {
        const mine = byPerson.get(person.member.user_id) ?? [];
        const scopes = rhythmScopes(mine);
        const shown = clientTasks ? mine.filter((t) => clientTasks.has(t.id)) : mine;
        const open = shown.filter((t) => !t.done && t.assignment_status !== 'pending');
        const attention = open
          .map((task) => ({ task, attention: attentionFor(task, now, todayKey, scopes.get(task.id)) }))
          .filter((x): x is { task: Task; attention: Attention } => !!x.attention)
          .sort((a, b) => b.attention.score - a.attention.score);
        const logs = shown.flatMap((t) => t.task_updates);
        const planned = shown
          .flatMap((t) => (t.planned_updates ?? []).filter((p) => p.status === 'planned').map((p) => ({ date: p.send_on, title: p.title, task: t.text })))
          .sort((a, b) => a.date.localeCompare(b.date));
        return {
          person,
          open,
          attention,
          onHold: open.filter((t) => t.waiting_since).length,
          pending: shown.filter((t) => t.assignment_status === 'pending').length,
          checkIns: logs.filter((u) => Date.parse(u.created_at) >= weekStart).length,
          lastUpdate: logs.reduce<string | null>((m, u) => (!m || u.created_at > m ? u.created_at : m), null),
          nextPlanned: planned[0] ?? null,
        };
      })
      .filter((r) => !clientTasks || r.open.length || r.pending)
      .sort((a, b) => b.attention.length - a.attention.length || a.person.member.display_name!.localeCompare(b.person.member.display_name ?? ''));
  }, [tasks, org.people, client, clients, now, todayKey, weekStart]);

  // Founders: appoint managers among their people and decide what each manager sees.
  const founderOnly = org.isFounder && !org.isAdmin;
  const managers = org.members.filter(
    (m) => m.status === 'active' && m.roles.includes('manager') && !m.roles.includes('founder') && !m.roles.includes('admin'),
  );
  const toggleManager = async (p: Person) => {
    setRoleError(null);
    const roles = p.member.roles.includes('manager')
      ? p.member.roles.filter((r) => r !== 'manager')
      : [...new Set([...p.member.roles, 'manager' as const])];
    const { error } = await supabase.rpc('org_set_roles', { target: p.member.user_id, new_roles: roles.length ? roles : ['member'] });
    if (error) setRoleError(error.message);
    await org.refresh();
  };

  const totalAttention = rows.reduce((n, r) => n + r.attention.length, 0);
  const plannedToday = rows.filter((r) => r.nextPlanned && r.nextPlanned.date <= todayKey).length;

  return (
    <div className="px-5 md:px-8 lg:px-10 pt-2 pb-5 max-w-7xl mx-auto">
      <header className="mb-6">
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-2">
          Team · Mint-more
          <span className="text-[var(--text-muted)] font-medium normal-case tracking-normal"> · {org.people.length} {org.people.length === 1 ? 'person' : 'people'} you can see</span>
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
          {tasks === null
            ? 'Loading…'
            : !org.people.length
              ? 'No one shared with you yet.'
              : totalAttention
                ? `${totalAttention} ${totalAttention === 1 ? 'thing needs' : 'things need'} attention.`
                : 'Everyone’s on track.'}
        </h1>
        {plannedToday > 0 && (
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {plannedToday} {plannedToday === 1 ? 'person has' : 'people have'} a client update planned for today.
          </p>
        )}
        {!org.people.length && (
          <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
            {org.isFounder
              ? 'The admin decides whose Mint-more work each founder can see. Ask them to share people with you.'
              : 'A founder decides whose Mint-more work each manager can see.'}
          </p>
        )}
      </header>

      {clients.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5 font-display text-xs">
          <button
            onClick={() => setClient(null)}
            className={`rounded-full px-3 py-1 cursor-pointer ${!client ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'border border-[var(--line-color)] hover:border-[var(--text-main)]'}`}
          >
            Everyone
          </button>
          {clients.map((c) => (
            <button
              key={c.key}
              onClick={() => setClient(client === c.key ? null : c.key)}
              className={`rounded-full px-3 py-1 cursor-pointer ${client === c.key ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'border border-[var(--line-color)] hover:border-[var(--text-main)]'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {roleError && <p className="mb-4 border-l-2 border-red-500 pl-3 text-sm text-red-500">{roleError}</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const name = r.person.member.display_name || 'A colleague';
          const roles = r.person.member.roles.filter((x) => x !== 'member');
          return (
            <div key={r.person.member.user_id} className="flex flex-col rounded-xl border border-[var(--line-color)] bg-[var(--surface)]">
              <button onClick={() => onOpenPerson(r.person.member.user_id)} className="flex flex-1 flex-col gap-3 p-4 text-left cursor-pointer">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white ${
                      r.attention.length ? 'bg-red-500' : 'bg-accent-gradient'
                    }`}
                  >
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-semibold">{name}</span>
                    <span className="block truncate font-display text-xs text-[var(--text-muted)]">
                      {[...roles.map((x) => ROLE_LABEL[x]), r.person.member.status === 'removed' ? 'Left' : null, r.person.level === 'plan' ? 'You plan' : 'You view']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 font-display">
                  {[
                    { n: r.open.length, label: 'open' },
                    { n: r.attention.length, label: 'attention', red: r.attention.length > 0 },
                    { n: r.onHold, label: 'on hold' },
                    { n: r.checkIns, label: 'this wk' },
                  ].map((s) => (
                    <span key={s.label} className="flex flex-col">
                      <span className={`text-xl font-bold tabular-nums ${s.red ? 'text-red-500' : ''}`}>{s.n}</span>
                      <span className="text-[0.6875rem] text-[var(--text-muted)]">{s.label}</span>
                    </span>
                  ))}
                </div>
                {r.attention.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {r.attention.slice(0, 3).map(({ task, attention }) => (
                      <li key={task.id} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                        <span className="min-w-0">
                          <span className="font-medium">{task.text}</span>
                          <span className="text-[var(--text-muted)]"> · {attention.label}</span>
                        </span>
                      </li>
                    ))}
                    {r.attention.length > 3 && <li className="pl-3.5 text-xs text-[var(--text-muted)]">+{r.attention.length - 3} more</li>}
                  </ul>
                )}
                <div className="mt-auto space-y-0.5 font-display text-xs text-[var(--text-muted)]">
                  <div>Last update: {r.lastUpdate ? timeAgo(r.lastUpdate, now) : 'none yet'}</div>
                  {r.nextPlanned && (
                    <div className={r.nextPlanned.date <= todayKey ? 'font-semibold text-[#257ef4]' : ''}>
                      Next client update: {r.nextPlanned.date <= todayKey ? 'today' : r.nextPlanned.date === dayKey(addDays(new Date(now), 1)) ? 'tomorrow' : r.nextPlanned.date} · {r.nextPlanned.title}
                    </div>
                  )}
                  {r.pending > 0 && <div>{r.pending} assigned, not accepted yet</div>}
                </div>
              </button>
              {founderOnly && !r.person.member.roles.includes('founder') && !r.person.member.roles.includes('admin') && (
                <div className="flex justify-end border-t border-[var(--line-color)] px-4 py-2 font-display text-xs">
                  <button onClick={() => toggleManager(r.person)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
                    {r.person.member.roles.includes('manager') ? 'Remove manager role' : 'Make manager'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {founderOnly && (
        <section className="mt-10 max-w-2xl">
          <div className="flex items-end justify-between border-b-2 border-[var(--text-main)] pb-2">
            <h3 className="font-display text-sm font-semibold uppercase tracking-widest">Managers</h3>
            <span className="text-sm text-[var(--text-muted)] font-medium">{managers.length}</span>
          </div>
          <p className="mt-2 mb-4 text-sm text-[var(--text-muted)]">
            Give each manager the people they look after. View: they see the work. Plan: they can also edit it and assign tasks. You can
            only share people you can see yourself.
          </p>
          <AccessEditor
            viewers={managers}
            subjects={org.people.map((p) => p.member)}
            maxLevel={(id) => org.levelFor(id) ?? 'view'}
            emptyText="No managers yet. Use “Make manager” on someone’s card above."
          />
        </section>
      )}
    </div>
  );
}
