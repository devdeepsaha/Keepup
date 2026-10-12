import { useState } from 'react';
import { usePersonTasks } from '../hooks/usePersonTasks';
import { useOrg } from '../lib/org';
import { supabase } from '../lib/supabase';
import Workspace from './Workspace';

// One colleague's Mint-more list, for a founder or manager who can see them. With plan access you can edit
// tasks and assign new ones; they still log their own updates. Their other spaces never load.
export default function PersonView({ personId, onBack }: { personId: string; onBack: () => void }) {
  const org = useOrg();
  const level = org.levelFor(personId);
  const p = usePersonTasks(level ? personId : null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [handoverTo, setHandoverTo] = useState('');
  const [handover, setHandover] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const name = org.nameOf(personId);
  const member = org.members.find((m) => m.user_id === personId);

  if (!level) {
    return (
      <div className="px-5 md:px-8 lg:px-10 pt-6 max-w-3xl mx-auto">
        <p className="text-[var(--text-muted)]">You can’t see this person’s work.</p>
        <button onClick={onBack} className="mt-3 font-display text-sm underline cursor-pointer">Back to team</button>
      </div>
    );
  }

  const noop = () => {};
  const mode = level === 'plan' ? 'plan' : 'view';
  // Handing over (someone left, or is overloaded): everyone else you plan for.
  const handoverTargets = org.people.filter((x) => x.level === 'plan' && x.member.user_id !== personId && x.member.status === 'active');

  const doHandover = async () => {
    if (!handoverTo) return;
    if (!window.confirm(`Move all of ${name}'s open Mint-more tasks to ${org.nameOf(handoverTo)}? They'll be asked to accept them.`)) return;
    setHandover({ busy: true, message: null });
    const { data, error } = await supabase.rpc('org_handover', { from_user: personId, to_user: handoverTo });
    setHandover({ busy: false, message: error ? error.message : `${data ?? 0} tasks handed over to ${org.nameOf(handoverTo)}.` });
    p.refetch();
  };

  return (
    <>
      <div className="px-5 md:px-8 lg:px-10 max-w-7xl mx-auto">
        <button onClick={onBack} className="font-display text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
          ← Team
        </button>
        {member?.status === 'removed' && (
          <p className="mt-2 border-l-2 border-orange-400 pl-3 text-sm">{name} has left. Their tasks stay here until you hand them over.</p>
        )}
        {p.error && (
          <p className="mt-2 flex justify-between gap-3 border-l-2 border-red-500 pl-3 text-sm text-red-500">
            {p.error}
            <button onClick={p.dismissError} className="text-[var(--text-muted)] cursor-pointer">Dismiss</button>
          </p>
        )}
      </div>
      <Workspace
        mode={mode}
        personName={name}
        tasks={p.tasks}
        loading={p.loading}
        openId={openId}
        onOpenIdChange={setOpenId}
        onAddTask={(text, due) => p.assignTask(text, due)}
        onToggle={p.toggleTask}
        onRename={p.renameTask}
        onSetDue={p.setDueDate}
        onSetCadence={p.setCadence}
        onSetHandle={p.setHandle}
        onSetClient={p.setClient}
        onSetLinks={p.setLinks}
        onSetWaiting={p.setWaiting}
        onDelete={noop}
        onArchive={noop}
        onAddUpdate={noop}
        onDeleteUpdate={noop}
        onMarkPlannedSent={noop}
        onMovePlanned={p.movePlanned}
        onDeletePlanned={p.deletePlanned}
        footer={
          <div className="mt-10 space-y-8">
            {p.declined.length > 0 && (
              <section>
                <div className="flex items-end justify-between border-b-2 border-[var(--line-color)] pb-2">
                  <h3 className="font-display text-sm font-semibold uppercase tracking-widest">Declined</h3>
                  <span className="text-sm text-[var(--text-muted)] font-medium">{p.declined.length}</span>
                </div>
                <ul className="divide-y divide-[var(--line-color)]">
                  {p.declined.map((t) => (
                    <li key={t.id} className="py-2.5 text-sm">
                      <span className="font-medium">{t.text}</span>
                      <span className="text-[var(--text-muted)]">
                        {' · '}from {org.nameOf(t.assigned_by)}
                        {t.assignment_note ? `: “${t.assignment_note}”` : ' (no note)'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {mode === 'plan' && handoverTargets.length > 0 && (
              <section className="max-w-2xl">
                <div className="border-b-2 border-[var(--line-color)] pb-2">
                  <h3 className="font-display text-sm font-semibold uppercase tracking-widest">Hand over</h3>
                </div>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Moves all of {name}’s open Mint-more tasks (with their logs and planned updates) to someone else, who accepts them like an
                  assignment. Use it when someone leaves.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-display text-sm">
                  <select
                    value={handoverTo}
                    onChange={(e) => setHandoverTo(e.target.value)}
                    className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-2 py-1.5 outline-none cursor-pointer"
                  >
                    <option value="">Hand over to…</option>
                    {handoverTargets.map((x) => (
                      <option key={x.member.user_id} value={x.member.user_id}>
                        {org.nameOf(x.member.user_id)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={doHandover}
                    disabled={!handoverTo || handover.busy}
                    className="rounded-lg bg-[var(--text-main)] px-3 py-1.5 font-semibold text-[var(--bg-color)] disabled:opacity-40 cursor-pointer"
                  >
                    {handover.busy ? 'Moving…' : 'Hand over'}
                  </button>
                </div>
                {handover.message && <p className="mt-2 text-sm">{handover.message}</p>}
              </section>
            )}
          </div>
        }
      />
    </>
  );
}
