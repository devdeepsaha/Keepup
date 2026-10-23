import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import type { Conversation } from '../types';

type Filter = 'all' | 'internal' | 'client' | 'unread';

interface ConvRow extends Conversation {
  unread: boolean;
  last_message_at: string | null;
  last_message_text: string | null;
  client_name: string | null;
  project_name: string | null;
}

export default function ChatInbox({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const org = useOrg();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    // Fetch conversations the user is a member of
    const { data: memberRows } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '');

    const ids = (memberRows ?? []).map((r) => r.conversation_id as string);
    if (ids.length === 0) { setConvs([]); setLoading(false); return; }

    const { data: rows } = await supabase
      .from('conversations')
      .select('id, client_id, project_id, name, type, created_by, created_at')
      .in('id', ids)
      .order('created_at', { ascending: false });

    if (!rows) { setLoading(false); return; }

    // Fetch client names
    const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const { data: clientRows } = clientIds.length
      ? await supabase.from('clients').select('id, name').in('id', clientIds)
      : { data: [] };
    const clientMap = new Map((clientRows ?? []).map((c) => [c.id, c.name as string]));

    // Fetch project names
    const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
    const { data: projectRows } = projectIds.length
      ? await supabase.from('projects').select('id, name').in('id', projectIds)
      : { data: [] };
    const projectMap = new Map((projectRows ?? []).map((p) => [p.id, p.name as string]));

    // Fetch last messages and read state
    const user = (await supabase.auth.getUser()).data.user;
    const { data: readRows } = await supabase
      .from('message_reads')
      .select('conversation_id, last_read_at')
      .eq('user_id', user?.id ?? '');
    const readMap = new Map((readRows ?? []).map((r) => [r.conversation_id, r.last_read_at]));

    const { data: lastMsgs } = await supabase
      .from('messages')
      .select('conversation_id, text, created_at')
      .in('conversation_id', ids)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const lastMsgMap = new Map<string, { text: string; created_at: string }>();
    for (const msg of lastMsgs ?? []) {
      if (!lastMsgMap.has(msg.conversation_id)) {
        lastMsgMap.set(msg.conversation_id, { text: msg.text, created_at: msg.created_at });
      }
    }

    setConvs(
      rows.map((r) => {
        const last = lastMsgMap.get(r.id);
        const readAt = readMap.get(r.id);
        const unread = !!last && (!readAt || last.created_at > readAt);
        return {
          ...(r as Conversation),
          unread,
          last_message_at: last?.created_at ?? null,
          last_message_text: last?.text ?? null,
          client_name: r.client_id ? (clientMap.get(r.client_id) ?? null) : null,
          project_name: r.project_id ? (projectMap.get(r.project_id) ?? null) : null,
        };
      }),
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const canCreate = org.isAdmin || org.isFounder || org.isManager;

  const visible = convs.filter((c) => {
    if (filter === 'internal') return c.type === 'internal';
    if (filter === 'client') return c.type === 'client_facing';
    if (filter === 'unread') return c.unread;
    return true;
  });

  function fmt(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--line-color)] px-5 md:px-8 pt-6 pb-0">
        <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-3">Chat</div>
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl font-bold tracking-tight">Conversations</h1>
          {canCreate && (
            <button
              onClick={onNew}
              className="rounded-lg bg-[var(--text-main)] px-4 py-2 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white cursor-pointer"
            >
              + New
            </button>
          )}
        </div>
        <nav className="flex gap-0 -mb-px">
          {(['all', 'internal', 'client', 'unread'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2.5 font-display text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                filter === f
                  ? 'border-[var(--text-main)] text-[var(--text-main)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {f === 'client' ? 'Client' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-5 pt-6 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="px-5 pt-8 text-sm text-[var(--text-muted)]">
            {convs.length === 0 ? (
              <>No conversations yet.{canCreate ? ' Hit + New to start one.' : ''}</>
            ) : (
              'No conversations match this filter.'
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line-color)]">
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onOpen(c.id)}
                  className="w-full px-5 md:px-8 py-3.5 text-left hover:bg-[var(--surface)] transition-colors cursor-pointer flex items-start gap-3"
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 shrink-0">
                    {c.unread ? (
                      <div className="w-2 h-2 rounded-full bg-[image:var(--accent-gradient)]" />
                    ) : (
                      <div className="w-2 h-2" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-medium truncate ${c.unread ? 'font-semibold' : ''}`}>{c.name}</span>
                      {c.last_message_at && (
                        <span className="shrink-0 font-display text-xs text-[var(--text-muted)]">{fmt(c.last_message_at)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {/* Internal / Client badge */}
                      <span
                        className={`rounded-full px-2 py-0.5 font-display text-[10px] font-semibold ${
                          c.type === 'client_facing'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-[var(--surface)] text-[var(--text-muted)]'
                        }`}
                      >
                        {c.type === 'client_facing' ? 'Client Visible' : 'Internal'}
                      </span>
                      {c.client_name && (
                        <span className="font-display text-xs text-[var(--text-muted)] truncate">{c.client_name}</span>
                      )}
                      {c.project_name && (
                        <span className="font-display text-xs text-[var(--text-muted)] truncate">· {c.project_name}</span>
                      )}
                    </div>
                    {c.last_message_text && (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)] truncate">{c.last_message_text}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
