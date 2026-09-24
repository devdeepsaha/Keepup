export interface TaskUpdate {
  id: string;
  task_id: string;
  text: string;
  created_at: string;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  completed_at: string | null;
  due_date: string | null; // 'YYYY-MM-DD'
  cadence_per_week: number | null; // check-ins per week, spaced 2+ days apart
  handle?: string | null; // custom @tag; automatic one when empty
  client?: string | null; // client this task belongs to; taken from the title when empty
  waiting_since?: string | null; // set while blocked on the client (pauses the quiet timer)
  waiting_for?: string | null; // what we're waiting for, e.g. "homepage content"
  workspace?: Workspace;
  archived_at?: string | null; // archived: hidden from the lists, kept in history
  deleted_at?: string | null; // in the trash; purged after 30 days
  last_updated: string;
  created_at: string;
  task_updates: TaskUpdate[];
}

export type Workspace = 'agency' | 'personal';
