import { useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';

export default function NewConversationModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (id: string) => void;
}) {
  const org = useOrg();
  const [name, setName] = useState('');
  const [type, setType] = useState<'internal' | 'client_facing'>('internal');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadProjects = async (cid: string) => {
    if (!cid) { setProjects([]); setProjectId(''); return; }
    const { data } = await supabase.from('projects').select('id, name').eq('client_id', cid).order('name');
    setProjects((data ?? []) as { id: string; name: string }[]);
    setProjectId('');
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setBusy(false); return; }

    const { data: conv, error: ce } = await supabase
      .from('conversations')
      .insert({
        name: name.trim(),
        type,
        client_id: clientId || null,
        project_id: projectId || null,
        created_by: userId,
      })
      .select('id')
      .single();

    if (ce || !conv) { setError(ce?.message ?? 'Failed'); setBusy(false); return; }

    // Add creator + selected members
    const memberIds = [...new Set([userId, ...selected])];
    await supabase.from('conversation_members').insert(
      memberIds.map((uid) => ({
        conversation_id: conv.id,
        user_id: uid,
        role: uid === userId ? 'admin' : 'member',
        added_by: userId,
      })),
    );

    onCreate(conv.id);
  };

  const inputClass = 'w-full rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--text-main)] clean-input';
  const labelClass = 'block font-display text-xs text-[var(--text-muted)] mb-1';

  // For client_facing chats: show clients and their client-role users as member options
  // For internal chats: show all internal members
  const memberPool = org.members.filter((m) => m.status === 'active');

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--line-color)] bg-[var(--bg-color)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">New conversation</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-red-500 cursor-pointer text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass}>Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Kolkata Brand — Reels"
              autoFocus
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Visibility</label>
            <div className="flex gap-2">
              {(['internal', 'client_facing'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-lg px-3 py-2 font-display text-xs font-medium transition-colors cursor-pointer border ${
                    type === t
                      ? 'bg-[var(--text-main)] text-[var(--bg-color)] border-[var(--text-main)]'
                      : 'border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
                  }`}
                >
                  {t === 'internal' ? '🔒 Internal only' : '🌐 Client visible'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Client</label>
              <select
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); loadProjects(e.target.value); }}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">None</option>
                {org.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Project / Work</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={!clientId || projects.length === 0}
                className={`${inputClass} cursor-pointer disabled:opacity-40`}
              >
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Add members ({selected.size} added)</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {memberPool.map((m) => {
                const on = selected.has(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => toggle(m.user_id)}
                    className={`rounded-full px-3 py-1 font-display text-xs transition-colors cursor-pointer ${
                      on
                        ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold'
                        : 'border border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
                    }`}
                  >
                    {m.display_name ?? m.user_id.slice(0, 8)}
                    <span className="ml-1 opacity-60 text-[9px]">{m.roles.join(',')}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="flex-1 rounded-lg bg-[var(--text-main)] py-2.5 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line-color)] px-5 py-2.5 font-display text-sm cursor-pointer hover:border-[var(--text-main)]">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
