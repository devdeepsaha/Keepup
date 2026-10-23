import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import type { Project } from '../types';

export default function ClientProjectsView({ onOpenChat }: { onOpenChat?: (projectId: string) => void }) {
  const org = useOrg();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    if (org.myClientIds.length === 0) { setLoading(false); return; }
    const { data } = await supabase
      .from('projects')
      .select('*')
      .in('client_id', org.myClientIds)
      .order('created_at', { ascending: false });
    setProjects((data ?? []) as Project[]);
    setLoading(false);
  }, [org.myClientIds]);

  useEffect(() => { load(); }, [load]);

  const statusColor: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-600',
    paused: 'bg-yellow-400/15 text-yellow-600',
    done: 'bg-[var(--surface)] text-[var(--text-muted)]',
  };

  const clientName = (cid: string) => org.clients.find((c) => c.id === cid)?.name ?? 'Client';

  return (
    <div className="px-5 md:px-8 pt-6 pb-10 max-w-3xl mx-auto">
      <div className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient mb-3">My Projects</div>
      <h1 className="font-display text-2xl font-bold tracking-tight mb-6">Your work with us</h1>
      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No projects yet. Your account manager will add them soon.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--line-color)] p-4 space-y-2 hover:border-[var(--text-main)] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold text-sm">{p.name}</p>
                  <p className="font-display text-xs text-[var(--text-muted)]">{clientName(p.client_id)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 font-display text-[10px] font-semibold ${statusColor[p.status]}`}>
                  {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                </span>
              </div>
              {p.description && (
                <p className="text-xs text-[var(--text-muted)] line-clamp-2">{p.description}</p>
              )}
              {onOpenChat && (
                <button
                  onClick={() => onOpenChat(p.id)}
                  className="mt-1 font-display text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  Open chat →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
