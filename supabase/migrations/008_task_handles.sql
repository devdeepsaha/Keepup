-- Custom @tag per task (letters and digits). Empty means the app makes one from the title.
alter table public.tasks
  add column if not exists handle text check (handle is null or handle ~ '^[a-z0-9]{2,30}$');
