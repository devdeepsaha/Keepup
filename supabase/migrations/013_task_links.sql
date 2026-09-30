-- Site links per task (e.g. Live and Test), so client messages can end with the right "Link:".
alter table public.tasks
  add column if not exists links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 6);
