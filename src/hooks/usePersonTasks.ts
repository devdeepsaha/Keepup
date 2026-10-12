import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_CADENCE } from '../lib/cadence';
import { supabase } from '../lib/supabase';
import type { PlannedUpdate, Task, TaskLink } from '../types';
import { SELECT } from './useTasks';

// A colleague's Mint-more tasks, as a founder or manager sees them. What you may change is decided by the
// database (plan access: edit and assign; view: read only). Their Personal and other spaces never load.
// Colleagues' changes don't stream live (the database only shares them with the app's own requests), so this
// refreshes every minute and whenever the tab comes back.
export function usePersonTasks(personId: string | null) {
  const [all, setAll] = useState<Task[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!personId) return;
    const { data, error } = await supabase
      .from('tasks')
      .select(SELECT)
      .eq('user_id', personId)
      .eq('workspace', 'agency')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'task_updates', ascending: true });
    if (error) setError(error.message);
    else {
      setAll(data as unknown as Task[]);
      setError(null);
    }
    setLoadedFor(personId);
  }, [personId]);

  useEffect(() => {
    load();
    const every = window.setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const commit = useCallback(
    async (op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) setError(error.message);
      load();
    },
    [load],
  );

  const patch = useCallback(
    (id: string, change: Partial<Task>) => {
      setAll((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t)));
      return commit(supabase.from('tasks').update(change).eq('id', id));
    },
    [commit],
  );

  // Assigning: a new Mint-more task in their list, waiting for them to accept it.
  const assignTask = useCallback(
    (text: string, due_date: string | null) => {
      if (!personId) return;
      return commit(
        supabase.from('tasks').insert({ user_id: personId, text, due_date, workspace: 'agency', cadence_per_week: DEFAULT_CADENCE }),
      );
    },
    [commit, personId],
  );

  const patchPlanned = (taskId: string, id: string, change: ((p: PlannedUpdate) => PlannedUpdate) | null) =>
    setAll((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, planned_updates: (t.planned_updates ?? []).flatMap((p) => (p.id !== id ? [p] : change ? [change(p)] : [])) }
          : t,
      ),
    );

  const loading = loadedFor !== personId;
  const tasks = useMemo(() => (loading ? [] : all.filter((t) => !t.archived_at)), [all, loading]);
  const declined = useMemo(() => all.filter((t) => t.archived_at && t.assignment_status === 'declined'), [all]);

  return {
    tasks,
    declined,
    loading,
    error,
    dismissError: () => setError(null),
    refetch: load,
    assignTask,
    toggleTask: (id: string, done: boolean) => patch(id, { done, completed_at: done ? new Date().toISOString() : null }),
    renameTask: (id: string, text: string) => patch(id, { text }),
    setDueDate: (id: string, due_date: string | null) => patch(id, { due_date }),
    setCadence: (id: string, cadence_per_week: number | null) => patch(id, { cadence_per_week }),
    setHandle: (id: string, handle: string | null) => patch(id, { handle }),
    setClient: (id: string, client: string | null) => patch(id, { client }),
    setLinks: (id: string, links: TaskLink[]) => patch(id, { links }),
    setWaiting: (id: string, waitingFor: string | null, waiting: boolean, since?: string | null) =>
      patch(
        id,
        waiting ? { waiting_since: since ?? new Date().toISOString(), waiting_for: waitingFor } : { waiting_since: null, waiting_for: null },
      ),
    movePlanned: (taskId: string, update: PlannedUpdate, sendOn: string) => {
      patchPlanned(taskId, update.id, (p) => ({ ...p, send_on: sendOn }));
      return commit(supabase.from('planned_updates').update({ send_on: sendOn }).eq('id', update.id));
    },
    deletePlanned: (taskId: string, update: PlannedUpdate) => {
      patchPlanned(taskId, update.id, null);
      return commit(supabase.from('planned_updates').delete().eq('id', update.id));
    },
  };
}
