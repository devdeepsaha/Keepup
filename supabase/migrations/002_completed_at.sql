-- Records when a task was completed (drives the calendar view).
alter table public.tasks add column if not exists completed_at timestamptz;

-- Backfill tasks that were already done: best guess is their last activity.
update public.tasks set completed_at = last_updated where done and completed_at is null;
