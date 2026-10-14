import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import type { Task } from '../types';
import { SELECT } from '../hooks/useTasks';
import CreateTaskModal from './CreateTaskModal';
import BulkAssignModal from './BulkAssignModal';

const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-500 text-white',
  high: 'bg-orange-400 text-white',
  medium: 'bg-yellow-400 text-black',
  low: 'bg-[var(--surface)] text-[var(--text-muted)]',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(task: Task) {
  if (task.done) return false;
  const d = task.deadline || (task.due_date ? task.due_date + 'T23:59:59' : null);
  return d ? new Date(d) < new Date() : false;
}

type Filter = 'all' | 'open' | 'done' | 'urgent' | 'overdue';

export default function ClientsView() {
  const org = useOrg();
  const [clientId, setClientId] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [topicFilter, setTopicFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  // New client form
  const [newClientName, setNewClientName] = useState('');
  const [newClientTeam, setNewClientTeam] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [clientBusy, setClientBusy] = useState(false);

  const client = org.clients.find((c) => c.id === clientId);
  const team = client?.team_id ? org.teams.find((t) => t.id === client.team_id) : null;

  // Set first client on load
  useEffect(() => {
    if (!clientId && org.clients.length > 0) setClientId(org.clients[0].id);
  }, [clientId, org.clients]);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    const { data } = await supabase
      .from('tasks')
      .select(SELECT)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const topics = [...new Set(tasks.map((t) => t.topic).filter(Boolean))] as string[];

  const visible = tasks.filter((t) => {
    if (topicFilter && t.topic !== topicFilter) return false;
    if (filter === 'open') return !t.done && !t.archived_at;
    if (filter === 'done') return !!t.done;
    if (filter === 'urgent') return t.priority === 'urgent';
    if (filter === 'overdue') return isOverdue(t);
    return !t.archived_at;
  });

  const total = tasks.filter((t) => !t.archived_at).length;
  const done = tasks.filter((t) => t.done && !t.archived_at).length;
  const urgent = tasks.filter((t) => t.priority === 'urgent' && !t.done && !t.archived_at).length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const canEdit = org.isAdmin || org.isFounder || org.isManager;
  const canManageClients = org.isAdmin || org.isFounder;

  const createClient = async () => {
    if (!newClientName.trim()) return;
    setClientBusy(true);
    const { data, error } = await supabase.rpc('org_save_client', {
      p_client_id: null,
      p_name: newClientName.trim(),
      p_team_id: newClientTeam || null,
    });
    if (!error && data) {
      setClientId(data as string);
      setNewClientName('');
      setNewClientTeam('');
      setAddingClient(false);
      await org.refresh();
    }
    setClientBusy(false);
  };

  if (org.clients.length === 0 && !addingClient) {
    return (
      <div className="px-5 md:px-8 lg:px-10 pt-8 max-w-4xl mx-auto">
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-4">Clients</div>
        <h1 className="font-display text-3xl font-bold tracking-tight mb-2">No clients yet.</h1>
        {canManageClients ? (
          <button
            onClick={() => setAddingClient(true)}
            className="mt-4 rounded-lg bg-[var(--text-main)] px-5 py-2.5 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white cursor-pointer"
          >
            + Add first client
          </button>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No clients have been set up yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 md:px-8 lg:px-10 pt-6 pb-10 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-3">Clients</div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setFilter('all'); setTopicFilter(''); }}
            className="font-display text-2xl font-bold bg-transparent outline-none cursor-pointer border-b-2 border-[var(--text-main)] pb-1"
          >
            {org.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {canManageClients && !addingClient && (
            <button
              onClick={() => setAddingClient(true)}
              className="rounded-full border border-dashed border-[var(--line-color)] px-3 py-1 font-display text-xs text-[var(--text-muted)] hover:border-[var(--text-main)] hover:text-[var(--text-main)] cursor-pointer"
            >
              + New client
            </button>
          )}
        </div>
        {addingClient && canManageClients && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              maxLength={80}
              placeholder="Client name"
              autoFocus
              className="rounded-lg border border-[var(--line-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--text-main)] clean-input"
              onKeyDown={(e) => e.key === 'Enter' && createClient()}
            />
            <select
              value={newClientTeam}
              onChange={(e) => setNewClientTeam(e.target.value)}
              className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-3 py-2 text-sm outline-none cursor-pointer"
            >
              <option value="">No team</option>
              {org.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              disabled={clientBusy || !newClientName.trim()}
              onClick={createClient}
              className="rounded-lg bg-[var(--text-main)] px-4 py-2 font-display text-sm font-semibold text-[var(--bg-color)] disabled:opacity-40 cursor-pointer"
            >
              {clientBusy ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setAddingClient(false)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">Cancel</button>
          </div>
        )}
        {team && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--line-color)] px-3 py-1 font-display text-xs text-[var(--text-muted)]">
              Team: {team.name}
            </span>
            {team.members.slice(0, 4).map((id) => (
              <span key={id} className="rounded-full bg-[var(--surface)] px-2.5 py-1 font-display text-xs">{org.nameOf(id)}</span>
            ))}
            {team.members.length > 4 && (
              <span className="font-display text-xs text-[var(--text-muted)]">+{team.members.length - 4} more</span>
            )}
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="rounded-xl border border-[var(--line-color)] p-4 space-y-3">
        <div className="flex flex-wrap gap-4 font-display text-sm">
          <span><b>{total}</b> <span className="text-[var(--text-muted)]">tasks</span></span>
          <span><b>{done}</b> <span className="text-[var(--text-muted)]">done</span></span>
          <span><b>{total - done}</b> <span className="text-[var(--text-muted)]">open</span></span>
          {urgent > 0 && <span className="text-red-500"><b>{urgent}</b> urgent</span>}
          {overdue > 0 && <span className="text-orange-400"><b>{overdue}</b> overdue</span>}
        </div>
        <div className="h-2 rounded-full bg-[var(--line-color)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[image:var(--accent-gradient)] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="font-display text-xs text-[var(--text-muted)]">{pct}% complete</div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'open', 'done', 'urgent', 'overdue'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 font-display text-xs transition-colors cursor-pointer ${
              filter === f
                ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold'
                : 'border border-[var(--line-color)] text-[var(--text-muted)] hover:border-[var(--text-main)]'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        {topics.length > 0 && (
          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            className="ml-auto rounded-full border border-[var(--line-color)] bg-[var(--surface)] px-3 py-1 font-display text-xs outline-none cursor-pointer"
          >
            <option value="">All topics</option>
            {topics.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
          </select>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No tasks match this filter.</p>
      ) : (
        <ul className="divide-y divide-[var(--line-color)]">
          {visible.map((task) => {
            const due = task.deadline ? fmt(task.deadline) : task.due_date ? fmt(task.due_date + 'T00:00:00') : null;
            const over = isOverdue(task);
            return (
              <li key={task.id} className={`py-3 flex flex-wrap items-start gap-2 ${task.done ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    {task.priority && task.priority !== 'medium' && (
                      <span className={`rounded-full px-2 py-0.5 font-display text-[10px] font-semibold ${PRIORITY_COLOR[task.priority]}`}>
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    )}
                    {task.topic && (
                      <span className="rounded-full border border-[var(--line-color)] px-2 py-0.5 font-display text-[10px] text-[var(--text-muted)]">
                        {task.topic}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium">{task.text}</p>
                  {task.task_brief && (
                    <p className="mt-0.5 text-xs text-[var(--text-muted)] line-clamp-2">{task.task_brief}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-display text-xs text-[var(--text-muted)]">
                    {task.user_id && <span>{org.nameOf(task.user_id)}</span>}
                    {due && (
                      <span className={over ? 'text-red-500 font-semibold' : ''}>
                        {over ? 'Overdue · ' : ''}due {due}
                      </span>
                    )}
                    {task.task_references && task.task_references.length > 0 && (
                      <span className="flex gap-1.5">
                        {task.task_references.map((r, i) => (
                          <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--text-main)]">
                            {r.label}
                          </a>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Actions */}
      {canEdit && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-[var(--text-main)] px-4 py-2 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white transition-colors cursor-pointer"
          >
            + Create task
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="rounded-lg border border-[var(--line-color)] px-4 py-2 font-display text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-main)] transition-colors cursor-pointer"
          >
            Bulk assign
          </button>
        </div>
      )}

      {showCreate && client && (
        <CreateTaskModal
          defaultClientId={client.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {showBulk && client && (
        <BulkAssignModal
          defaultClientId={client.id}
          onClose={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); load(); }}
        />
      )}
    </div>
  );
}
