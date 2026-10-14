import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { orgAction, ROLE_LABEL, useOrg, type Member, type Role } from '../lib/org';
import { describeEvent, timeAgo, type TaskEvent } from '../lib/notices';
import AccessEditor from './AccessEditor';
import TeamsEditor from './TeamsEditor';

type Tab = 'people' | 'teams' | 'access' | 'history';

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'people',  label: 'People',  desc: 'Invite, roles and remove' },
  { id: 'teams',   label: 'Teams',   desc: 'Groups for bulk access' },
  { id: 'access',  label: 'Access',  desc: 'Who sees whose work' },
  { id: 'history', label: 'History', desc: 'What changed and when' },
];

interface Account {
  user_id: string;
  email: string;
  last_sign_in_at: string | null;
  invited_at: string | null;
}

const ROLE_CHOICES: Role[] = ['admin', 'founder', 'manager'];

export default function AdminView({ userId }: { userId: string }) {
  const org = useOrg();
  const [tab, setTab] = useState<Tab>('people');
  const [accounts, setAccounts] = useState<Map<string, Account>>(new Map());
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'member' as Role });
  const [inviteState, setInviteState] = useState<{ busy: boolean; error: string | null; done: string | null }>({ busy: false, error: null, done: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase.rpc('org_emails');
    if (data) setAccounts(new Map((data as Account[]).map((a) => [a.user_id, a])));
  }, []);
  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('task_events')
      .select('id, task_id, owner_id, actor_id, notify_id, kind, detail, created_at, seen_at')
      .order('created_at', { ascending: false })
      .limit(60);
    if (data) setEvents(data as TaskEvent[]);
  }, []);
  useEffect(() => {
    loadAccounts();
    loadEvents();
  }, [loadAccounts, loadEvents, org.members]);

  if (!org.isAdmin) return <p className="px-6 pt-6 text-[var(--text-muted)]">Only the admin can open this page.</p>;

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviteState({ busy: true, error: null, done: null });
    const roles: Role[] = invite.role === 'member' ? ['member'] : [invite.role, 'member'];
    const err = await orgAction({ action: 'invite', email: invite.email, name: invite.name, roles });
    if (err) setInviteState({ busy: false, error: err, done: null });
    else {
      setInviteState({ busy: false, error: null, done: `Invite sent to ${invite.email}.` });
      setInvite({ email: '', name: '', role: 'member' });
      await org.refresh();
    }
  };

  const setRole = async (m: Member, role: Role, on: boolean) => {
    setBusy(m.user_id);
    setError(null);
    const roles = on ? [...new Set([...m.roles, role])] : m.roles.filter((r) => r !== role);
    const { error } = await supabase.rpc('org_set_roles', { target: m.user_id, new_roles: roles.includes('member') ? roles : [...roles, 'member'] });
    if (error) setError(error.message);
    await org.refresh();
    setBusy(null);
  };

  const removeOrRestore = async (m: Member) => {
    const removing = m.status !== 'removed';
    const name = org.nameOf(m.user_id);
    if (removing && !window.confirm(`Remove ${name}? They won't be able to sign in. Their Mint-more tasks stay so you can hand them over.`)) return;
    setBusy(m.user_id);
    setError(null);
    const err = await orgAction({ action: removing ? 'remove' : 'restore', userId: m.user_id });
    if (err) setError(err);
    await org.refresh();
    setBusy(null);
  };

  const realName = (id: string | null | undefined) => org.members.find((m) => m.user_id === id)?.display_name || 'Someone';
  const people = [...org.members].sort(
    (a, b) => Number(a.status === 'removed') - Number(b.status === 'removed') || (a.display_name ?? '').localeCompare(b.display_name ?? ''),
  );
  const viewers = org.members.filter(
    (m) => m.status === 'active' && !m.roles.includes('admin') && (m.roles.includes('founder') || m.roles.includes('manager')),
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-[var(--line-color)] px-5 md:px-8 lg:px-10 pt-6">
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-4">Admin · Mint-more</div>
        <nav className="flex gap-0 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 font-display text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === t.id
                  ? 'border-[var(--text-main)] text-[var(--text-main)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-5 md:px-8 lg:px-10 py-6 max-w-4xl">
        {error && <p className="mb-4 border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}

        {/* ── People ── */}
        {tab === 'people' && (
          <div className="space-y-8">
            <section>
              <h2 className="font-display text-xl font-bold tracking-tight mb-1">Invite someone</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">They'll get an email link to join. Supabase sends a few per hour — space them out.</p>
              <form onSubmit={sendInvite} className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-52 flex-1 flex-col gap-1 font-display text-xs text-[var(--text-muted)]">
                  Email
                  <input
                    type="email"
                    required
                    value={invite.email}
                    onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                    placeholder="name@mint-more.com"
                    className="rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-[var(--text-main)] clean-input"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 font-display text-xs text-[var(--text-muted)]">
                  Name
                  <input
                    required
                    value={invite.name}
                    onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                    placeholder="Rahul Sen"
                    maxLength={60}
                    className="rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-[var(--text-main)] clean-input"
                  />
                </label>
                <label className="flex flex-col gap-1 font-display text-xs text-[var(--text-muted)]">
                  Role
                  <select
                    value={invite.role}
                    onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}
                    className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text-main)] outline-none cursor-pointer"
                  >
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                    <option value="founder">Founder</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={inviteState.busy}
                  className="rounded-lg bg-[var(--text-main)] px-4 py-2 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white disabled:opacity-50 cursor-pointer"
                >
                  {inviteState.busy ? 'Sending…' : 'Send invite'}
                </button>
              </form>
              {inviteState.error && <p className="mt-2 border-l-2 border-red-500 pl-3 text-sm text-red-500">{inviteState.error}</p>}
              {inviteState.done && <p className="mt-2 border-l-2 border-emerald-400 pl-3 text-sm">{inviteState.done}</p>}
            </section>

            <section>
              <h2 className="font-display text-xl font-bold tracking-tight mb-1">
                People
                <span className="ml-2 font-normal text-base text-[var(--text-muted)]">{org.members.filter((m) => m.status !== 'removed').length}</span>
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">Click a role chip to toggle it. You can't remove your own admin role.</p>
              <ul className="divide-y divide-[var(--line-color)]">
                {people.map((m) => {
                  const acct = accounts.get(m.user_id);
                  const self = m.user_id === userId;
                  return (
                    <li key={m.user_id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${m.status === 'removed' ? 'opacity-50' : ''}`}>
                      <span className="min-w-48 flex-1">
                        <span className="block text-sm font-medium">
                          {m.display_name || <span className="text-[var(--text-muted)]">No name yet</span>}
                          {self && <span className="text-[var(--text-muted)]"> (you)</span>}
                        </span>
                        <span className="block font-display text-xs text-[var(--text-muted)]">
                          {acct?.email ?? '…'}
                          {' · '}
                          {m.status === 'invited'
                            ? 'invited, not joined yet'
                            : m.status === 'removed'
                            ? 'removed'
                            : acct?.last_sign_in_at
                            ? `seen ${timeAgo(acct.last_sign_in_at)}`
                            : 'never signed in'}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 font-display text-xs">
                        {ROLE_CHOICES.map((r) => {
                          const on = m.roles.includes(r);
                          return (
                            <button
                              key={r}
                              disabled={busy === m.user_id || m.status === 'removed' || (self && r === 'admin')}
                              onClick={() => setRole(m, r, !on)}
                              title={self && r === 'admin' ? "You can't remove your own admin role" : on ? `Remove ${ROLE_LABEL[r]}` : `Make ${ROLE_LABEL[r]}`}
                              className={`rounded-full px-2.5 py-1 transition-colors cursor-pointer disabled:cursor-default ${
                                on ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'border border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
                              }`}
                            >
                              {ROLE_LABEL[r]}
                            </button>
                          );
                        })}
                        {!self && (
                          <button
                            disabled={busy === m.user_id}
                            onClick={() => removeOrRestore(m)}
                            className="ml-2 text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                          >
                            {m.status === 'removed' ? 'Restore' : 'Remove'}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}

        {/* ── Teams ── */}
        {tab === 'teams' && (
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight mb-1">Teams</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Groups of people — Design, Dev, Content, etc. Give a founder or manager an entire team at once under <button onClick={() => setTab('access')} className="underline cursor-pointer">Access</button>. New team members are included automatically.
            </p>
            <TeamsEditor />
          </div>
        )}

        {/* ── Access ── */}
        {tab === 'access' && (
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight mb-1">Access</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Pick a founder or manager, then set <b>Everyone</b>, a whole <b>team</b>, or individual exceptions. Founders can pass on their reach to managers — never more than they have themselves. You already see everyone's Mint-more work.
            </p>
            <AccessEditor
              viewers={viewers}
              subjects={org.members.filter((m) => m.status !== 'removed')}
              emptyText="No founders or managers yet. Give someone the Founder or Manager role in People."
            />
          </div>
        )}

        {/* ── History ── */}
        {tab === 'history' && (
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight mb-1">History</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Every change someone made to another person's Mint-more task, and every assignment and reply.
            </p>
            {events.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nothing yet.</p>
            ) : (
              <ol className="divide-y divide-[var(--line-color)]">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 py-2.5 text-sm">
                    <span className="w-16 shrink-0 font-display text-xs text-[var(--text-muted)] pt-0.5">{timeAgo(e.created_at)}</span>
                    <span className="min-w-0 flex-1">
                      {describeEvent(e, realName, '')
                        .replace(/ gave you /, ` gave ${realName(e.owner_id)} `)
                        .replace(/ over to you$/, ` over to ${realName(e.owner_id)}`)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
