import { useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import type { TaskReference } from '../types';

// Assign the same task to multiple people at once.
// Creates one task row per assignee, all linked to the same client.

type Priority = 'low' | 'medium' | 'high' | 'urgent';

export default function BulkAssignModal({
  defaultClientId,
  onClose,
  onDone,
}: {
  defaultClientId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const org = useOrg();
  const [text, setText] = useState('');
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamId, setTeamId] = useState('');
  const [topic, setTopic] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [deadline, setDeadline] = useState('');
  const [brief, setBrief] = useState('');
  const [refs, setRefs] = useState<TaskReference[]>([]);
  const [refLabel, setRefLabel] = useState('');
  const [refUrl, setRefUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const addRef = () => {
    if (!refUrl.trim()) return;
    setRefs((r) => [...r, { label: refLabel.trim() || refUrl.trim(), url: refUrl.trim() }]);
    setRefLabel('');
    setRefUrl('');
  };

  const assignees = org.people.filter((p) => p.level === 'plan');

  // When a team is selected, toggle all its members into the selection
  const selectTeam = (tid: string) => {
    setTeamId(tid);
    if (!tid) return;
    const t = org.teams.find((t) => t.id === tid);
    if (!t) return;
    const inScope = new Set(assignees.map((p) => p.member.user_id));
    const teamMembers = t.members.filter((id) => inScope.has(id));
    setSelected(new Set(teamMembers));
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
    if (!text.trim() || selected.size === 0) return;
    setBusy(true);
    setError(null);

    const me = org.me?.user_id;
    const rows = [...selected].map((userId) => ({
      text: text.trim(),
      workspace: 'agency',
      done: false,
      last_updated: new Date().toISOString(),
      created_at: new Date().toISOString(),
      user_id: userId,
      assigned_by: me,
      assignment_status: 'pending',
      ...(clientId ? { client_id: clientId } : {}),
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      priority,
      ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      ...(brief.trim() ? { task_brief: brief.trim() } : {}),
      ...(refs.length ? { task_references: refs } : {}),
    }));

    const { error: err } = await supabase.from('tasks').insert(rows);
    if (err) { setError(err.message); setBusy(false); return; }
    onDone();
  };

  const inputClass = 'w-full rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--text-main)] clean-input';
  const labelClass = 'block font-display text-xs text-[var(--text-muted)] mb-1';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--line-color)] bg-[var(--bg-color)] p-6 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold tracking-tight">Bulk assign task</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-red-500 cursor-pointer text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass}>Task title *</label>
            <input
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="What needs to be done?"
              autoFocus
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">No client</option>
                {org.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={`${inputClass} cursor-pointer`}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Topic</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="Homepage copy" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Brief</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={3000}
              rows={2}
              placeholder="Context and requirements…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* References */}
          <div>
            <label className={labelClass}>References</label>
            {refs.map((r, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm text-[var(--accent)] underline truncate">{r.label}</a>
                <button type="button" onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-red-500 cursor-pointer">×</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input value={refLabel} onChange={(e) => setRefLabel(e.target.value)} placeholder="Label" className={`${inputClass} flex-1`} />
              <input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://…" type="url" className={`${inputClass} flex-1`}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRef())} />
              <button type="button" onClick={addRef} className="shrink-0 rounded-lg border border-[var(--line-color)] px-3 font-display text-sm cursor-pointer hover:border-[var(--text-main)]">+</button>
            </div>
          </div>

          {/* Assignees */}
          <div>
            <label className={labelClass}>Assign to ({selected.size} selected)</label>
            {org.teams.length > 0 && (
              <select value={teamId} onChange={(e) => selectTeam(e.target.value)} className={`${inputClass} mb-2 cursor-pointer`}>
                <option value="">Pick individuals below, or select a team…</option>
                {org.teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>)}
              </select>
            )}
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {assignees.map((p) => {
                const on = selected.has(p.member.user_id);
                return (
                  <button
                    key={p.member.user_id}
                    type="button"
                    onClick={() => toggle(p.member.user_id)}
                    className={`rounded-full px-3 py-1 font-display text-xs transition-colors cursor-pointer ${
                      on ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold' : 'border border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
                    }`}
                  >
                    {org.nameOf(p.member.user_id)}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || !text.trim() || selected.size === 0}
              className="flex-1 rounded-lg bg-[var(--text-main)] py-2.5 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              {busy ? 'Assigning…' : `Assign to ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`}
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
