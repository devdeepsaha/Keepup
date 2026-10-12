import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ROLE_LABEL, useOrg, type Level, type Member } from '../lib/org';

// Who a founder or manager can see: pick the viewer, then None / View / Plan for each person.
// The admin uses it for founders (and managers); a founder uses it for their managers.
export default function AccessEditor({
  viewers,
  subjects,
  maxLevel,
  emptyText,
}: {
  viewers: Member[]; // people whose access is being set
  subjects: Member[]; // people they could be given
  maxLevel?: (subjectId: string) => Level; // a founder can't give more than they have
  emptyText: string;
}) {
  const { access, refresh, nameOf } = useOrg();
  const [viewerId, setViewerId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const viewer = viewers.find((v) => v.user_id === viewerId) ?? viewers[0];

  if (!viewers.length) return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>;

  const levelOf = (subjectId: string): Level | null =>
    access.find((a) => a.viewer_id === viewer.user_id && a.subject_id === subjectId)?.level ?? null;

  const set = async (subjectId: string, level: Level | null) => {
    setBusy(subjectId);
    setError(null);
    const { error } = await supabase.rpc('org_set_access', { viewer: viewer.user_id, subject: subjectId, level_: level });
    if (error) setError(error.message);
    await refresh();
    setBusy(null);
  };

  const list = subjects.filter((s) => s.user_id !== viewer.user_id && s.status !== 'removed');

  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 font-display text-sm">
        <span className="text-[var(--text-muted)]">What can</span>
        <select
          value={viewer.user_id}
          onChange={(e) => setViewerId(e.target.value)}
          className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2 py-1 font-semibold outline-none cursor-pointer"
        >
          {viewers.map((v) => (
            <option key={v.user_id} value={v.user_id}>
              {nameOf(v.user_id)} ({v.roles.filter((r) => r !== 'member').map((r) => ROLE_LABEL[r]).join(', ')})
            </option>
          ))}
        </select>
        <span className="text-[var(--text-muted)]">see?</span>
      </label>
      {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}
      {list.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No one to give yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line-color)] rounded-xl border border-[var(--line-color)]">
          {list.map((s) => {
            const current = levelOf(s.user_id);
            const max = maxLevel?.(s.user_id) ?? 'plan';
            const options: { level: Level | null; label: string; hint: string }[] = [
              { level: null, label: 'None', hint: 'Can’t see their work' },
              { level: 'view', label: 'View', hint: 'Sees their Mint-more tasks, logs and planned updates' },
              ...(max === 'plan' ? [{ level: 'plan' as Level, label: 'Plan', hint: 'Also edits them and assigns new tasks' }] : []),
            ];
            return (
              <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  {nameOf(s.user_id)}
                  {s.status === 'invited' && <span className="ml-2 text-xs text-[var(--text-muted)]">invited</span>}
                </span>
                <span className="flex overflow-hidden rounded-lg border border-[var(--line-color)] font-display text-xs">
                  {options.map((o) => (
                    <button
                      key={o.label}
                      title={o.hint}
                      disabled={busy === s.user_id}
                      onClick={() => current !== o.level && set(s.user_id, o.level)}
                      className={`px-2.5 py-1 transition-colors cursor-pointer disabled:opacity-50 ${
                        current === o.level ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'hover:bg-[var(--bg-color)]'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
