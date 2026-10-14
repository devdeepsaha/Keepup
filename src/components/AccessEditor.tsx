import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ROLE_LABEL, useOrg, type Level, type Member } from '../lib/org';

// What a founder or manager can see, in three layers instead of one person at a time:
//   Everyone → Teams → exceptions for single people. The most specific wins.
// The admin uses it for founders (and managers); a founder uses it for their managers, and can never give more
// than they have themselves (the database caps it).

type Choice = Level | null;
const LEVELS: { level: Choice; label: string }[] = [
  { level: null, label: 'None' },
  { level: 'view', label: 'View' },
  { level: 'plan', label: 'Plan' },
];

function Segmented({ value, onChange, busy, options = LEVELS }: { value: Choice; onChange: (v: Choice) => void; busy: boolean; options?: typeof LEVELS }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--line-color)] font-display text-xs">
      {options.map((o) => (
        <button
          key={o.label}
          disabled={busy}
          onClick={() => value !== o.level && onChange(o.level)}
          className={`px-2.5 py-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
            value === o.level ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'hover:bg-[var(--bg-color)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export default function AccessEditor({
  viewers,
  subjects,
  founderMode = false,
  emptyText,
}: {
  viewers: Member[]; // the founders/managers whose access is being set
  subjects: Member[]; // everyone they could be given
  founderMode?: boolean; // a founder setting up their managers: "Everyone" means everyone the founder sees
  emptyText: string;
}) {
  const org = useOrg();
  const [viewerId, setViewerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [preview, setPreview] = useState<Map<string, Level>>(new Map());
  const viewer = viewers.find((v) => v.user_id === viewerId) ?? viewers[0];

  // What the chosen person actually ends up seeing, from the database.
  const loadPreview = useCallback(async () => {
    if (!viewer) return;
    const { data } = await supabase.rpc('org_people_of', { viewer: viewer.user_id });
    setPreview(new Map(((data ?? []) as { user_id: string; level: Level }[]).map((r) => [r.user_id, r.level])));
  }, [viewer]);
  useEffect(() => {
    loadPreview();
  }, [loadPreview, org.access, org.teamAccess, org.scopes, org.teams]);

  if (!viewer) return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;

  const run = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setError(error.message);
    await org.refresh();
    await loadPreview();
    setBusy(false);
  };

  const everyone = org.scopes.find((s) => s.viewer_id === viewer.user_id)?.level ?? null;
  const teamLevel = (teamId: string) => org.teamAccess.find((t) => t.viewer_id === viewer.user_id && t.team_id === teamId)?.level ?? null;
  const exceptionOf = (id: string) => org.access.find((a) => a.viewer_id === viewer.user_id && a.subject_id === id)?.level ?? null;
  const people = subjects.filter((s) => s.user_id !== viewer.user_id && s.status !== 'removed');
  const exceptions = people.filter((p) => exceptionOf(p.user_id));
  const planCount = [...preview.values()].filter((l) => l === 'plan').length;

  return (
    <div className="space-y-5">
      <label className="flex flex-wrap items-center gap-2 font-display text-sm">
        <span className="text-[var(--text-muted)]">What can</span>
        <select
          value={viewer.user_id}
          onChange={(e) => setViewerId(e.target.value)}
          className="max-w-full rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2 py-1.5 font-semibold outline-none cursor-pointer"
        >
          {viewers.map((v) => (
            <option key={v.user_id} value={v.user_id}>
              {org.nameOf(v.user_id)} ({v.roles.filter((r) => r !== 'member').map((r) => ROLE_LABEL[r]).join(', ')})
            </option>
          ))}
        </select>
        <span className="text-[var(--text-muted)]">see?</span>
      </label>

      {/* The result, so it's clear what the settings below add up to */}
      <p className="rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm">
        <span className="font-semibold">
          Sees {preview.size} {preview.size === 1 ? 'person' : 'people'}
        </span>
        {preview.size > 0 && (
          <span className="text-[var(--text-muted)]">
            {' · '}can plan for {planCount}
            {' · '}
            {[...preview.keys()]
              .slice(0, 6)
              .map((id) => org.nameOf(id))
              .join(', ')}
            {preview.size > 6 ? ` +${preview.size - 6}` : ''}
          </span>
        )}
      </p>

      {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}

      {/* 1. Everyone */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-color)] px-3 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{founderMode ? 'Everyone I can see' : 'Everyone'}</span>
          <span className="block text-xs text-[var(--text-muted)]">
            {founderMode
              ? 'All the people you can see, now and later.'
              : 'All of Mint-more, including people who join later. Never includes the admin.'}
          </span>
        </span>
        <Segmented value={everyone} busy={busy} onChange={(v) => run('org_set_scope', { viewer: viewer.user_id, level_: v })} />
      </div>

      {/* 2. Teams */}
      <div className="rounded-xl border border-[var(--line-color)]">
        <div className="border-b border-[var(--line-color)] px-3 py-2 font-display text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Teams
        </div>
        {org.teams.length === 0 ? (
          <p className="px-3 py-3 text-sm text-[var(--text-muted)]">
            {org.isAdmin ? 'No teams yet. Make them under Teams below.' : 'No teams yet. The admin makes them.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line-color)]">
            {org.teams.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {t.members.length ? t.members.map((id) => org.nameOf(id)).join(', ') : 'No one yet'}
                  </span>
                </span>
                <Segmented
                  value={teamLevel(t.id)}
                  busy={busy}
                  onChange={(v) => run('org_set_team_access', { viewer: viewer.user_id, team: t.id, level_: v })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3. Exceptions: single people, over everything above */}
      <div className="rounded-xl border border-[var(--line-color)]">
        <button
          onClick={() => setShowPeople((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 font-display text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] cursor-pointer"
        >
          <span>Exceptions{exceptions.length ? ` · ${exceptions.length}` : ''}</span>
          <span className="normal-case tracking-normal font-normal">{showPeople ? 'Hide people' : 'Change one person'}</span>
        </button>
        {(showPeople || exceptions.length > 0) && (
          <ul className="divide-y divide-[var(--line-color)] border-t border-[var(--line-color)]">
            {(showPeople ? people : exceptions).map((p) => {
              const ex = exceptionOf(p.user_id);
              const now = preview.get(p.user_id) ?? null;
              return (
                <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-sm">
                    {org.nameOf(p.user_id)}
                    <span className="ml-2 text-xs text-[var(--text-muted)]">{now === 'plan' ? 'plans' : now === 'view' ? 'views' : 'hidden'}</span>
                  </span>
                  <select
                    value={ex ?? ''}
                    disabled={busy}
                    onChange={(e) => run('org_set_access', { viewer: viewer.user_id, subject: p.user_id, level_: e.target.value || null })}
                    className={`rounded-lg border px-2 py-1 font-display text-xs outline-none cursor-pointer ${
                      ex ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line-color)] bg-[var(--surface)]'
                    } bg-[var(--surface)]`}
                  >
                    <option value="">Follow the rules above</option>
                    <option value="none">Hide this person</option>
                    <option value="view">View only</option>
                    <option value="plan">Plan</option>
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
