-- Planned client updates: finished work split into parts and sent on later check-in days.
create table if not exists public.planned_updates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null references public.tasks (id) on delete cascade,
  send_on    date not null,
  title      text not null check (char_length(title) between 1 and 120),  -- short label, e.g. "Welcome page"
  text       text not null check (char_length(text) between 1 and 2000),  -- the message, ready to send
  position   int not null default 0,
  status     text not null default 'planned' check (status in ('planned', 'sent')),
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists planned_updates_task_idx on public.planned_updates (task_id, send_on);

alter table public.planned_updates enable row level security;

drop policy if exists "planned updates: owner all" on public.planned_updates;
create policy "planned updates: owner all" on public.planned_updates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))
  );

-- Realtime, like tasks and task_updates, so every open tab sees plan changes.
do $$
begin
  alter publication supabase_realtime add table public.planned_updates;
exception when duplicate_object then null;
end $$;
