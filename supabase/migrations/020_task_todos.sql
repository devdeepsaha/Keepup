-- Phase 8: Task todos — a checklist stored as JSONB on each task.
-- Each item: { id: uuid, text: string, done: boolean, created_at: timestamptz }

alter table public.tasks
  add column if not exists todos jsonb not null default '[]'::jsonb;
