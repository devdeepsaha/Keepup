-- Two workspaces (agency work and personal), archive, a 30-day trash, and a colour per client.

-- Which workspace a task or chat belongs to. Everything so far is agency work.
alter table public.tasks
  add column if not exists workspace text not null default 'agency' check (workspace in ('agency', 'personal')),
  add column if not exists archived_at timestamptz, -- hidden from the lists, kept in history
  add column if not exists deleted_at timestamptz;  -- in the trash; purged after 30 days

alter table public.chats
  add column if not exists workspace text not null default 'agency' check (workspace in ('agency', 'personal'));

create index if not exists tasks_user_workspace_idx on public.tasks (user_id, workspace);

-- A colour picked for a client (by its @tag key). Clients without a row get an automatic colour.
create table if not exists public.client_colors (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace  text not null default 'agency' check (workspace in ('agency', 'personal')),
  key        text not null check (key ~ '^[a-z0-9]{2,30}$'),
  color      text not null check (color ~ '^#[0-9a-f]{6}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace, key)
);

alter table public.client_colors enable row level security;

drop policy if exists "client colors: owner all" on public.client_colors;
create policy "client colors: owner all" on public.client_colors
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
