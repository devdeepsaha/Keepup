-- Optional due date per task (drives "Needs attention" and the week view).
alter table public.tasks add column if not exists due_date date;
