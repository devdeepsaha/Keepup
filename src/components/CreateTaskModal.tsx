import { useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import type { TaskReference } from '../types';

// Full task creation form: all fields, assignee, client, deadline, priority, brief, references.

type Priority = 'low' | 'medium' | 'high' | 'urgent';
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_COLOR: Record<Priority, string> = {
  low:    'border-[var(--line-color)] text-[var(--text-muted)]',
  medium: 'border-yellow-400 text-yellow-500',
  high:   'border-orange-400 text-orange-400',
  urgent: 'bg-red-500 text-white border-red-500',
};

export default function CreateTaskModal({
  defaultClientId,
  onClose,
  onCreated,
}: {
  defaultClientId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const org = useOrg();
  const [text, setText] = useState('');
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [assignTo, setAssignTo] = useState('');
  const [topic, setTopic] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [scheduledDate, setScheduledDate] = useState('');
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);

    const targetUser = assignTo || null;
    const me = org.me?.user_id;

    const row: Record<string, unknown> = {
      text: text.trim(),
      workspace: 'agency',
      done: false,
      task_updates: [],
      last_updated: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    if (clientId) row.client_id = clientId;
    if (topic.trim()) row.topic = topic.trim();
    if (priority) row.priority = priority;
    if (scheduledDate) row.scheduled_date = scheduledDate;
    if (deadline) row.deadline = new Date(deadline).toISOString();
    if (brief.trim()) row.task_brief = brief.trim();
    if (refs.length) row.task_references = refs;
    if (targetUser && targetUser !== me) {
      row.user_id = targetUser;
      row.assigned_by = me;
      row.assignment_status = 'pending';
    } else {
      row.user_id = me;
    }

    const { error: err } = await supabase.from('tasks').insert(row);
    if (err) { setError(err.message); setBusy(false); return; }
    onCreated();
  };

  const inputClass = 'w-full rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--text-main)] clean-input';
  const labelClass = 'block font-display text-xs text-[var(--text-muted)] mb-1';

  const assignees = org.people.filter((p) => p.level === 'plan');

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--line-color)] bg-[var(--bg-color)] p-6 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold tracking-tight">New task</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-red-500 cursor-pointer text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Title */}
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

          {/* Client + Assign row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">No client</option>
                {org.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Assign to</label>
              <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">Myself</option>
                {assignees.map((p) => (
                  <option key={p.member.user_id} value={p.member.user_id}>{org.nameOf(p.member.user_id)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Topic */}
          <div>
            <label className={labelClass}>Topic</label>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="e.g. Homepage copy" className={inputClass} />
          </div>

          {/* Priority */}
          <div>
            <label className={labelClass}>Priority</label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 rounded-lg border py-1.5 font-display text-xs font-medium transition-colors cursor-pointer capitalize ${
                    priority === p ? PRIORITY_COLOR[p] : 'border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Scheduled date</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Brief */}
          <div>
            <label className={labelClass}>Task brief</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={3000}
              rows={3}
              placeholder="Context, goals, requirements…"
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
              <input
                value={refLabel}
                onChange={(e) => setRefLabel(e.target.value)}
                placeholder="Label (e.g. Brief)"
                className={`${inputClass} flex-1`}
              />
              <input
                value={refUrl}
                onChange={(e) => setRefUrl(e.target.value)}
                placeholder="https://…"
                type="url"
                className={`${inputClass} flex-1`}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRef())}
              />
              <button type="button" onClick={addRef} className="shrink-0 rounded-lg border border-[var(--line-color)] px-3 font-display text-sm cursor-pointer hover:border-[var(--text-main)]">+</button>
            </div>
          </div>

          {error && <p className="border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="flex-1 rounded-lg bg-[var(--text-main)] py-2.5 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              {busy ? 'Creating…' : 'Create task'}
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
