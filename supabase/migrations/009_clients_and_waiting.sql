-- Client a task belongs to (letters/digits; empty = taken from the title), and "waiting on client".
alter table public.tasks
  add column if not exists client text check (client is null or client ~ '^[a-z0-9]{2,30}$'),
  add column if not exists waiting_since timestamptz,
  add column if not exists waiting_for text check (waiting_for is null or char_length(waiting_for) <= 200);
