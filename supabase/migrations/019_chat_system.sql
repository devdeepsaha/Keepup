-- Phase 8: Bouncy Chat — client portal, projects, group chat, @mention tasks, AI digests.
-- Tables created first (dependency order), then functions and policies.

-- ─────────────────────────────────────────────
-- 1. Extend members.roles to allow 'client'
-- ─────────────────────────────────────────────
alter table public.members drop constraint if exists members_roles_check;
alter table public.members add constraint members_roles_check
  check (roles <@ '{admin,founder,manager,member,client}'::text[]);

-- ─────────────────────────────────────────────
-- 2. Tables (dependency order)
-- ─────────────────────────────────────────────

-- client_members: which client does this auth user represent
create table if not exists public.client_members (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id   uuid not null references auth.users (id)    on delete cascade,
  added_by  uuid references auth.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (client_id, user_id)
);

-- projects: works per client (SEO, Dev, Shoot…)
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  status      text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- conversations: group chats, internal or client-facing
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.clients (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  name       text not null check (char_length(name) between 1 and 100),
  type       text not null default 'internal' check (type in ('internal', 'client_facing')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- conversation_members: who is in each chat
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null default 'member' check (role in ('admin', 'member')),
  added_by        uuid references auth.users (id) on delete set null,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- messages: chat messages with optional media and @mentions
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  text            text not null check (char_length(text) between 1 and 4000),
  media           jsonb not null default '[]'::jsonb,    -- [{url, type, name, size}]
  mentions        jsonb not null default '[]'::jsonb,    -- [{user_id, display_name}]
  reply_to        uuid references public.messages (id) on delete set null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);

-- message_reads: per-user read state
create table if not exists public.message_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- digest_settings: workspace default (conversation_id IS NULL) + per-conversation overrides
create table if not exists public.digest_settings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid unique references public.conversations (id) on delete cascade,
  interval_hours  int not null default 24 check (interval_hours in (1, 6, 12, 24, 48)),
  enabled         boolean not null default true,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- digests: stored AI-generated summaries
create table if not exists public.digests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  content         text not null,
  message_range   jsonb not null default '{}'::jsonb,  -- {from, to, count}
  generated_at    timestamptz not null default now(),
  next_digest_at  timestamptz not null
);

-- ─────────────────────────────────────────────
-- 3. Enable RLS on all new tables
-- ─────────────────────────────────────────────
alter table public.client_members        enable row level security;
alter table public.projects              enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.messages              enable row level security;
alter table public.message_reads         enable row level security;
alter table public.digest_settings       enable row level security;
alter table public.digests               enable row level security;

-- ─────────────────────────────────────────────
-- 4. Helper functions (tables exist now)
-- ─────────────────────────────────────────────

create or replace function public.is_client()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.has_role('client');
end;
$$;

create or replace function public.my_client_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (select array_agg(cm.client_id)
     from public.client_members cm
     where cm.user_id = auth.uid()),
    '{}'::uuid[]
  );
end;
$$;

-- is_internal(): true when user holds any non-client role
create or replace function public.is_internal()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.members m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.roles && '{admin,founder,manager,member}'::text[]
  );
end;
$$;

-- ─────────────────────────────────────────────
-- 5. RLS policies
-- ─────────────────────────────────────────────

-- client_members
drop policy if exists "client_members: read" on public.client_members;
create policy "client_members: read" on public.client_members for select to authenticated
  using (public.is_internal() or user_id = auth.uid());

drop policy if exists "client_members: write admin" on public.client_members;
create policy "client_members: write admin" on public.client_members for all to authenticated
  using  (public.is_admin() or public.has_role('founder'))
  with check (public.is_admin() or public.has_role('founder'));

-- projects
drop policy if exists "projects: read" on public.projects;
create policy "projects: read" on public.projects for select to authenticated
  using (
    public.is_internal()
    or client_id = any (public.my_client_ids())
  );

drop policy if exists "projects: write" on public.projects;
create policy "projects: write" on public.projects for all to authenticated
  using  (public.is_admin() or public.has_role('founder') or public.has_role('manager'))
  with check (public.is_admin() or public.has_role('founder') or public.has_role('manager'));

-- conversations
drop policy if exists "conversations: read" on public.conversations;
create policy "conversations: read" on public.conversations for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "conversations: insert" on public.conversations;
create policy "conversations: insert" on public.conversations for insert to authenticated
  with check (public.is_admin() or public.has_role('founder') or public.has_role('manager'));

drop policy if exists "conversations: update" on public.conversations;
create policy "conversations: update" on public.conversations for update to authenticated
  using (public.is_admin() or public.has_role('founder'));

drop policy if exists "conversations: delete" on public.conversations;
create policy "conversations: delete" on public.conversations for delete to authenticated
  using (public.is_admin());

-- conversation_members
drop policy if exists "conv_members: read" on public.conversation_members;
create policy "conv_members: read" on public.conversation_members for select to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.conversation_members cm2
      where cm2.conversation_id = conversation_id and cm2.user_id = auth.uid()
    )
  );

drop policy if exists "conv_members: write" on public.conversation_members;
create policy "conv_members: write" on public.conversation_members for all to authenticated
  using  (public.is_admin() or public.has_role('founder') or public.has_role('manager'))
  with check (public.is_admin() or public.has_role('founder') or public.has_role('manager'));

-- messages
drop policy if exists "messages: read" on public.messages;
create policy "messages: read" on public.messages for select to authenticated
  using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "messages: insert" on public.messages;
create policy "messages: insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "messages: update own" on public.messages;
create policy "messages: update own" on public.messages for update to authenticated
  using (
    sender_id = auth.uid()
    and (created_at > now() - interval '15 minutes')
  );

-- message_reads
drop policy if exists "message_reads: owner" on public.message_reads;
create policy "message_reads: owner" on public.message_reads for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- digest_settings
drop policy if exists "digest_settings: read" on public.digest_settings;
create policy "digest_settings: read" on public.digest_settings for select to authenticated
  using (public.is_internal());

drop policy if exists "digest_settings: write" on public.digest_settings;
create policy "digest_settings: write" on public.digest_settings for all to authenticated
  using  (public.is_admin() or public.has_role('founder'))
  with check (public.is_admin() or public.has_role('founder'));

-- digests
drop policy if exists "digests: read" on public.digests;
create policy "digests: read" on public.digests for select to authenticated
  using (
    public.is_admin()
    or public.has_role('founder')
    or public.has_role('manager')
    or (
      public.is_internal()
      and exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "digests: insert" on public.digests;
create policy "digests: insert" on public.digests for insert to authenticated
  with check (public.is_admin() or public.has_role('founder'));

-- ─────────────────────────────────────────────
-- 6. @mention → pending task trigger
-- ─────────────────────────────────────────────
create or replace function public.handle_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m          jsonb;
  conv_name  text;
  cid        uuid;
begin
  if jsonb_array_length(NEW.mentions) = 0 then
    return NEW;
  end if;

  select name, client_id into conv_name, cid
  from public.conversations
  where id = NEW.conversation_id;

  for m in select * from jsonb_array_elements(NEW.mentions)
  loop
    -- Skip self-mentions
    if (m->>'user_id')::uuid = NEW.sender_id then
      continue;
    end if;
    -- Only create task if mentioned user is in the conversation
    if not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = NEW.conversation_id
        and cm.user_id = (m->>'user_id')::uuid
    ) then
      continue;
    end if;

    insert into public.tasks (
      user_id, assigned_by, text, workspace, done,
      assignment_status, last_updated, created_at,
      task_brief, client_id, task_references
    ) values (
      (m->>'user_id')::uuid,
      NEW.sender_id,
      substring(NEW.text, 1, 200),
      'agency',
      false,
      'pending',
      now(), now(),
      'Delegated from chat: ' || coalesce(conv_name, 'Unknown'),
      cid,
      '[]'::jsonb
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists message_mentions_trigger on public.messages;
create trigger message_mentions_trigger
  after insert on public.messages
  for each row execute function public.handle_message_mentions();

-- ─────────────────────────────────────────────
-- 7. Seed workspace default digest settings
-- ─────────────────────────────────────────────
insert into public.digest_settings (conversation_id, interval_hours, enabled)
values (null, 24, true)
on conflict (conversation_id) do nothing;

-- ─────────────────────────────────────────────
-- 8. Realtime
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.client_members;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reads;
alter publication supabase_realtime add table public.digests;
