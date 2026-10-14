import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';

// The admin's teams (e.g. Design, Dev, Content): give a founder or manager a whole team in one go.
export default function TeamsEditor() {
  const org = useOrg();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setError(error.message);
    await org.refresh();
    setBusy(false);
    return !error;
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run('org_save_team', { team: null, team_name: name })) setName('');
  };

  const active = org.members.filter((m) => m.status !== 'removed');

  return (
    <div className="space-y-3">
      {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}
      {org.teams.map((t) => (
        <div key={t.id} className="rounded-xl border border-[var(--line-color)] p-3">
          <div className="flex items-center gap-2">
            <input
              key={t.name}
              defaultValue={t.name}
              maxLength={40}
              aria-label="Team name"
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => e.currentTarget.value.trim() !== t.name && run('org_save_team', { team: t.id, team_name: e.currentTarget.value })}
              className="min-w-0 flex-1 bg-transparent font-display text-base font-semibold outline-none clean-input"
            />
            <button
              disabled={busy}
              onClick={() => window.confirm(`Delete the team “${t.name}”? Access given through it goes too.`) && run('org_delete_team', { team: t.id })}
              className="shrink-0 font-display text-xs text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
            >
              Delete
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {t.members.map((id) => (
              <span key={id} className="flex items-center gap-1 rounded-full bg-[var(--surface)] py-1 pl-2.5 pr-1 text-xs">
                {org.nameOf(id)}
                <button
                  disabled={busy}
                  onClick={() => run('org_set_team_member', { team: t.id, person: id, member_: false })}
                  aria-label={`Remove ${org.nameOf(id)} from ${t.name}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
            <select
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && run('org_set_team_member', { team: t.id, person: e.target.value, member_: true })}
              className="rounded-full border border-dashed border-[var(--line-color)] bg-[var(--bg-color)] px-2.5 py-1 text-xs text-[var(--text-muted)] outline-none cursor-pointer"
            >
              <option value="">+ Add person</option>
              {active
                .filter((m) => !t.members.includes(m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {org.nameOf(m.user_id)}
                  </option>
                ))}
            </select>
          </div>
        </div>
      ))}
      <form onSubmit={create} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New team, e.g. Design"
          className="min-w-40 flex-1 rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--text-main)] clean-input"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-[var(--text-main)] px-4 py-2 font-display text-sm font-semibold text-[var(--bg-color)] disabled:opacity-40 cursor-pointer"
        >
          Add team
        </button>
      </form>
    </div>
  );
}
