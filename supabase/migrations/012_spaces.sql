-- Your own spaces, beyond the built-in Mint-more ("agency") and Personal. A space is a key tasks, chats and
-- client colours are filed under; "work" spaces have clients and check-in rhythms, "personal" ones don't.
create table if not exists public.spaces (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9][a-z0-9-]{1,29}$'),
  name       text not null check (char_length(name) between 1 and 40),
  kind       text not null default 'work' check (kind in ('work', 'personal')),
  color      text not null default '#257ef4' check (color ~ '^#[0-9a-f]{6}$'),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.spaces enable row level security;

drop policy if exists "spaces: owner all" on public.spaces;
create policy "spaces: owner all" on public.spaces
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Any space key, not just the two built-ins (same format as spaces.key).
alter table public.tasks drop constraint if exists tasks_workspace_check;
alter table public.tasks add constraint tasks_workspace_check check (workspace ~ '^[a-z0-9][a-z0-9-]{1,29}$');
alter table public.chats drop constraint if exists chats_workspace_check;
alter table public.chats add constraint chats_workspace_check check (workspace ~ '^[a-z0-9][a-z0-9-]{1,29}$');
alter table public.client_colors drop constraint if exists client_colors_workspace_check;
alter table public.client_colors add constraint client_colors_workspace_check check (workspace ~ '^[a-z0-9][a-z0-9-]{1,29}$');
