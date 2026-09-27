import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rhythmScopes } from '../lib/handles';
import { attentionFor, useNow, type Attention } from '../lib/tasks';
import { dayKey } from '../lib/dates';
import type { Task, Workspace } from '../types';

const SELECT =
  'id, text, done, completed_at, due_date, cadence_per_week, handle, client, waiting_since, waiting_for, workspace, archived_at, deleted_at, last_updated, created_at, task_updates (id, task_id, text, created_at), planned_updates (id, task_id, send_on, title, text, position, status, sent_at)';

export interface OtherItem {
  task: Task;
  attention: Attention;
}

// What needs attention in the workspace you're NOT looking at, so it can nudge you from here.
// Refreshed on load, every few minutes, when the tab comes back into view, and on any task change.
export function useOtherWorkspace(userId: string, current: Workspace) {
  const other: Workspace = current === 'agency' ? 'personal' : 'agency';
  const [tasks, setTasks] = useState<Task[]>([]);
  const now = useNow();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select(SELECT)
      .eq('workspace', other)
      .eq('done', false)
      .is('deleted_at', null)
      .is('archived_at', null);
    if (data) setTasks(data as unknown as Task[]);
  }, [other]);

  useEffect(() => {
    setTasks([]);
    load();
    const every = window.setInterval(load, 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    const channel = supabase
      .channel(`other-${userId}-${other}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_updates', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [load, userId, other]);

  const items = useMemo(() => {
    const todayKey = dayKey(new Date(now));
    const scopes = rhythmScopes(tasks);
    return tasks
      .map((task) => ({ task, attention: attentionFor(task, now, todayKey, scopes.get(task.id)) }))
      .filter((x): x is OtherItem => x.attention !== null)
      .sort((a, b) => b.attention.score - a.attention.score);
  }, [tasks, now]);

  return { other, items };
}
