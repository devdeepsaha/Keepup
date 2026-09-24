-- Agenda app schema. Run this once in the Supabase SQL editor.

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 500),
  done         boolean not null default false,
  completed_at timestamptz,
  due_date     date,
  cadence_per_week smallint default 2 check (cadence_per_week between 1 and 3),
  last_updated timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table if not exists public.task_updates (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists task_updates_task_id_idx on public.task_updates (task_id);

-- Row level security: every user only sees and edits their own rows.
alter table public.tasks enable row level security;
alter table public.task_updates enable row level security;

drop policy if exists "tasks: owner select" on public.tasks;
drop policy if exists "tasks: owner insert" on public.tasks;
drop policy if exists "tasks: owner update" on public.tasks;
drop policy if exists "tasks: owner delete" on public.tasks;

create policy "tasks: owner select" on public.tasks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "tasks: owner insert" on public.tasks
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "tasks: owner update" on public.tasks
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "tasks: owner delete" on public.tasks
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "updates: owner select" on public.task_updates;
drop policy if exists "updates: owner insert" on public.task_updates;
drop policy if exists "updates: owner delete" on public.task_updates;

create policy "updates: owner select" on public.task_updates
  for select to authenticated using (user_id = (select auth.uid()));
create policy "updates: owner insert" on public.task_updates
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))
  );
create policy "updates: owner delete" on public.task_updates
  for delete to authenticated using (user_id = (select auth.uid()));

-- Logging an update bumps the parent task's last_updated (drives the stale timer).
create or replace function public.touch_task_on_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.tasks
     set last_updated = greatest(last_updated, least(new.created_at, now()))
   where id = new.task_id;
  return new;
end;
$$;

drop trigger if exists task_updates_touch_task on public.task_updates;
create trigger task_updates_touch_task
  after insert on public.task_updates
  for each row execute function public.touch_task_on_update();

-- Realtime: keep multiple tabs/devices in sync.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_updates') then
    alter publication supabase_realtime add table public.task_updates;
  end if;
end $$;
