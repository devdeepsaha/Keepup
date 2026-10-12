-- The company: members and their roles, who can see whom, invites, assignments and a change log.
-- Additive only: the owner-only privacy rules stay until 015 swaps in the shared ones.

create table if not exists public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  roles        text[] not null default '{member}'
                 check (roles <@ array['admin', 'founder', 'manager', 'member']::text[] and cardinality(roles) > 0),
  status       text not null default 'active' check (status in ('invited', 'active', 'removed')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Who can see whom: a viewer (founder or manager) and a person, at "view" or "plan" level.
create table if not exists public.access (
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  level      text not null check (level in ('view', 'plan')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, subject_id),
  check (viewer_id <> subject_id)
);
create index if not exists access_subject_idx on public.access (subject_id);

-- Pending invites (read and written by the org server function only).
create table if not exists public.invites (
  email        text primary key check (email = lower(email)),
  display_name text,
  roles        text[] not null default '{member}',
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

-- Assigned tasks: who assigned it, whether it was accepted, the note on a decline, and who changed it last.
alter table public.tasks
  add column if not exists assigned_by uuid references auth.users (id) on delete set null,
  add column if not exists assignment_status text check (assignment_status in ('pending', 'accepted', 'declined')),
  add column if not exists assignment_note text check (assignment_note is null or char_length(assignment_note) <= 500),
  add column if not exists changed_by uuid references auth.users (id) on delete set null;

-- Notices and audit: changes someone made to another person's task.
create table if not exists public.task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists task_events_owner_idx on public.task_events (owner_id, created_at desc);

-- Locked for now: nothing reads these directly until 015 adds the rules (the server function uses the admin key).
alter table public.members enable row level security;
alter table public.access enable row level security;
alter table public.invites enable row level security;
alter table public.task_events enable row level security;

-- Helpers used by the privacy rules (015). Security definer so they can read members/access themselves.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and m.status = 'active' and 'admin' = any (m.roles)
  );
$$;

-- Can the current user see (need = 'view') or plan (need = 'plan') this person's shared work?
create or replace function public.can_see(subject uuid, need text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select subject = (select auth.uid())
    or (
      exists (select 1 from public.members me where me.user_id = (select auth.uid()) and me.status = 'active')
      and (
        public.is_admin()
        or exists (
          select 1 from public.access a
          where a.viewer_id = (select auth.uid())
            and a.subject_id = subject
            and (need = 'view' or a.level = 'plan')
        )
      )
    );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.can_see(uuid, text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_see(uuid, text) to authenticated;

-- Everyone already using Keepup joins the company as a member; Devdeep is admin and founder.
insert into public.members (user_id, roles, status)
select u.id,
       case when u.email = 'devdeep120205@gmail.com' then array['admin', 'founder', 'member'] else array['member'] end,
       'active'
from auth.users u
on conflict (user_id) do nothing;
