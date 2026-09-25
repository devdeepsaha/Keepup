import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CADENCE } from '../lib/cadence';
import { dayKey } from '../lib/dates';
import { supabase } from '../lib/supabase';
import type { PlannedUpdate, Task, TaskUpdate, Workspace } from '../types';

const SELECT =
  'id, text, done, completed_at, due_date, cadence_per_week, handle, client, waiting_since, waiting_for, workspace, archived_at, deleted_at, last_updated, created_at, task_updates (id, task_id, text, created_at), planned_updates (id, task_id, send_on, title, text, position, status, sent_at)';

export const TRASH_DAYS = 30;

// Personal tasks aren't client work, so they start without a check-in rhythm.
export const defaultCadence = (workspace: Workspace) => (workspace === 'agency' ? DEFAULT_CADENCE : null);

// All of one workspace's tasks. `tasks` are the live ones everything else works with; archived and trashed
// ones are kept apart (archived still count as history).
export function useTasks(userId: string, workspace: Workspace) {
  const [loaded, setLoaded] = useState<{ workspace: Workspace; tasks: Task[] } | null>(null);
  // Only the current workspace's tasks: right after a switch, nothing shows until they've loaded.
  const all = useMemo(() => (loaded?.workspace === workspace ? loaded.tasks : []), [loaded, workspace]);
  const loading = loaded?.workspace !== workspace;
  const setTasks = useCallback(
    (update: (prev: Task[]) => Task[]) =>
      setLoaded((prev) => (prev && prev.workspace === workspace ? { workspace, tasks: update(prev.tasks) } : prev)),
    [workspace],
  );
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<number | undefined>(undefined);
  const current = useRef(workspace); // the workspace on screen, so a late response for another is ignored
  useEffect(() => {
    current.current = workspace;
  }, [workspace]);

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select(SELECT)
      .eq('workspace', workspace)
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'task_updates', ascending: true });
    if (current.current !== workspace) return; // switched workspace while this was loading
    if (error) {
      setError(error.message);
      setLoaded((prev) => (prev?.workspace === workspace ? prev : { workspace, tasks: [] }));
    } else {
      setLoaded({ workspace, tasks: data as unknown as Task[] });
      setError(null);
    }
  }, [workspace]);

  // Empty the trash of anything older than 30 days (once per session and workspace).
  useEffect(() => {
    const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
    supabase.from('tasks').delete().eq('workspace', workspace).lt('deleted_at', cutoff).then(() => {});
  }, [workspace]);

  // Initial load + realtime sync across tabs/devices (debounced refetch).
  useEffect(() => {
    fetchTasks();
    const scheduleRefetch = () => {
      window.clearTimeout(refetchTimer.current);
      refetchTimer.current = window.setTimeout(fetchTasks, 300);
    };
    const channel = supabase
      .channel(`agenda-${userId}-${workspace}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_updates', filter: `user_id=eq.${userId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planned_updates', filter: `user_id=eq.${userId}` }, scheduleRefetch)
      .subscribe();
    return () => {
      window.clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [userId, workspace, fetchTasks]);

  // Runs a mutation after an optimistic local change; on failure, surface the error and resync.
  const commit = useCallback(
    async (op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) {
        setError(error.message);
        fetchTasks();
      }
    },
    [fetchTasks],
  );

  const addTask = useCallback(
    (text: string, due_date: string | null = null) => {
      const now = new Date().toISOString();
      const task: Task = {
        id: crypto.randomUUID(),
        text,
        done: false,
        completed_at: null,
        due_date,
        cadence_per_week: defaultCadence(workspace),
        workspace,
        last_updated: now,
        created_at: now,
        task_updates: [],
      };
      setTasks((prev) => [task, ...prev]);
      return commit(
        supabase.from('tasks').insert({ id: task.id, text, due_date, cadence_per_week: defaultCadence(workspace), workspace }),
      );
    },
    [commit, setTasks, workspace],
  );

  const toggleTask = useCallback(
    (id: string, done: boolean) => {
      const completed_at = done ? new Date().toISOString() : null;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done, completed_at } : t)));
      return commit(supabase.from('tasks').update({ done, completed_at }).eq('id', id));
    },
    [commit, setTasks],
  );

  const renameTask = useCallback(
    (id: string, text: string) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
      return commit(supabase.from('tasks').update({ text }).eq('id', id));
    },
    [commit, setTasks],
  );

  const setDueDate = useCallback(
    (id: string, due_date: string | null) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, due_date } : t)));
      return commit(supabase.from('tasks').update({ due_date }).eq('id', id));
    },
    [commit, setTasks],
  );

  const setCadence = useCallback(
    (id: string, cadence_per_week: number | null) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, cadence_per_week } : t)));
      return commit(supabase.from('tasks').update({ cadence_per_week }).eq('id', id));
    },
    [commit, setTasks],
  );

  const setHandle = useCallback(
    (id: string, handle: string | null) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, handle } : t)));
      return commit(supabase.from('tasks').update({ handle }).eq('id', id));
    },
    [commit, setTasks],
  );

  const setClient = useCallback(
    (id: string, client: string | null) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, client } : t)));
      return commit(supabase.from('tasks').update({ client }).eq('id', id));
    },
    [commit, setTasks],
  );

  // Waiting on the client: pauses the quiet timer; check-in days become polite nudges.
  // `since` keeps the original start date when only the "waiting for" text changes.
  const setWaiting = useCallback(
    (id: string, waitingFor: string | null, waiting: boolean, since?: string | null) => {
      const patch = waiting
        ? { waiting_since: since ?? new Date().toISOString(), waiting_for: waitingFor }
        : { waiting_since: null, waiting_for: null };
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return commit(supabase.from('tasks').update(patch).eq('id', id));
    },
    [commit, setTasks],
  );

  // Deleting moves a task to the trash; it can be restored for 30 days.
  const patchTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return commit(supabase.from('tasks').update(patch).eq('id', id));
    },
    [commit, setTasks],
  );
  const deleteTask = useCallback((id: string) => patchTask(id, { deleted_at: new Date().toISOString() }), [patchTask]);
  const restoreTask = useCallback((id: string) => patchTask(id, { deleted_at: null, archived_at: null }), [patchTask]);
  const archiveTask = useCallback(
    (id: string, archived: boolean) => patchTask(id, { archived_at: archived ? new Date().toISOString() : null }),
    [patchTask],
  );
  // Permanent: only from the trash, after the user confirms.
  const purgeTask = useCallback(
    (id: string) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      return commit(supabase.from('tasks').delete().eq('id', id));
    },
    [commit, setTasks],
  );

  const addUpdate = useCallback(
    (taskId: string, text: string) => {
      const now = new Date().toISOString();
      const update: TaskUpdate = { id: crypto.randomUUID(), task_id: taskId, text, created_at: now };
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, last_updated: now, task_updates: [...t.task_updates, update] } : t)),
      );
      return commit(supabase.from('task_updates').insert({ id: update.id, task_id: taskId, text }));
    },
    [commit, setTasks],
  );

  // Planned client updates.
  const patchPlanned = useCallback(
    (taskId: string, id: string, change: ((p: PlannedUpdate) => PlannedUpdate) | null) =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, planned_updates: (t.planned_updates ?? []).flatMap((p) => (p.id !== id ? [p] : change ? [change(p)] : [])) }
            : t,
        ),
      ),
    [setTasks],
  );
  // Sent: logged as a check-in with the message itself.
  const markPlannedSent = useCallback(
    (taskId: string, update: PlannedUpdate) => {
      const sentAt = new Date().toISOString();
      patchPlanned(taskId, update.id, (p) => ({ ...p, status: 'sent', sent_at: sentAt }));
      // Already logged a client update today (e.g. from Bouncy's draft)? Then this is that one: no second log.
      const today = dayKey(new Date());
      const task = all.find((t) => t.id === taskId);
      const loggedToday = task?.task_updates.some((u) => dayKey(u.created_at) === today && u.text.startsWith('Sent client update'));
      if (!loggedToday) {
        const summary = update.text.replace(/\s+/g, ' ').trim();
        addUpdate(taskId, `Sent client update (${update.title}): ${summary.length > 150 ? `${summary.slice(0, 147)}…` : summary}`);
      }
      return commit(supabase.from('planned_updates').update({ status: 'sent', sent_at: sentAt }).eq('id', update.id));
    },
    [commit, patchPlanned, addUpdate, all],
  );
  const movePlanned = useCallback(
    (taskId: string, update: PlannedUpdate, sendOn: string) => {
      patchPlanned(taskId, update.id, (p) => ({ ...p, send_on: sendOn }));
      return commit(supabase.from('planned_updates').update({ send_on: sendOn }).eq('id', update.id));
    },
    [commit, patchPlanned],
  );
  const deletePlanned = useCallback(
    (taskId: string, update: PlannedUpdate) => {
      patchPlanned(taskId, update.id, null);
      return commit(supabase.from('planned_updates').delete().eq('id', update.id));
    },
    [commit, patchPlanned],
  );

  const deleteUpdate = useCallback(
    (taskId: string, updateId: string) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, task_updates: t.task_updates.filter((u) => u.id !== updateId) } : t)),
      );
      return commit(supabase.from('task_updates').delete().eq('id', updateId));
    },
    [commit, setTasks],
  );

  const tasks = useMemo(() => all.filter((t) => !t.deleted_at && !t.archived_at), [all]);
  const archived = useMemo(() => all.filter((t) => !t.deleted_at && t.archived_at), [all]);
  const trashed = useMemo(() => all.filter((t) => t.deleted_at), [all]);
  // Live + archived: what happened, for the calendar and insights.
  const history = useMemo(() => all.filter((t) => !t.deleted_at), [all]);

  return {
    tasks,
    archived,
    trashed,
    history,
    loading,
    error,
    refetch: fetchTasks,
    dismissError: () => setError(null),
    addTask,
    toggleTask,
    renameTask,
    setDueDate,
    setCadence,
    setHandle,
    setClient,
    setWaiting,
    deleteTask,
    restoreTask,
    archiveTask,
    purgeTask,
    addUpdate,
    deleteUpdate,
    markPlannedSent,
    movePlanned,
    deletePlanned,
  };
}
