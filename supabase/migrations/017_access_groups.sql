-- Easier access: instead of setting every person one by one, a founder or manager can be given
--   1. Everyone (everyone in the company, including people who join later; for a manager set up by a founder,
--      everyone that founder can see),
--   2. Teams (named groups the admin makes, e.g. "Design"),
--   3. Exceptions for single people (hide someone, or give them a different level).
-- The most specific wins: a person exception, then the best team level, then Everyone.
-- A rule never gives more than the person who set it has themselves (a founder can't over-share to a manager).

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);

create table if not exists public.team_access (
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  level      text not null check (level in ('view', 'plan')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, team_id)
);

create table if not exists public.viewer_scope (
  viewer_id  uuid primary key references auth.users (id) on delete cascade,
  level      text not null check (level in ('view', 'plan')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Person rows can now also say "none": an exception that hides someone.
alter table public.access drop constraint if exists access_level_check;
alter table public.access add constraint access_level_check check (level in ('none', 'view', 'plan'));

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_access enable row level security;
alter table public.viewer_scope enable row level security;

drop policy if exists "teams: read" on public.teams;
create policy "teams: read" on public.teams for select to authenticated using (true);
drop policy if exists "team members: read" on public.team_members;
create policy "team members: read" on public.team_members for select to authenticated using (true);
drop policy if exists "team access: read" on public.team_access;
create policy "team access: read" on public.team_access for select to authenticated
  using (viewer_id = (select auth.uid()) or public.is_admin() or public.has_role('founder'));
drop policy if exists "viewer scope: read" on public.viewer_scope;
create policy "viewer scope: read" on public.viewer_scope for select to authenticated
  using (viewer_id = (select auth.uid()) or public.is_admin() or public.has_role('founder'));

-- ---------- the resolver ----------
-- 0 = can't see, 1 = view, 2 = plan.
create or replace function public.lvl(l text) returns int language sql immutable set search_path = '' as $$
  select case l when 'plan' then 2 when 'view' then 1 else 0 end;
$$;

create or replace function public.access_level(viewer uuid, subject uuid, depth int default 0)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result int;
  p record;
begin
  if viewer is null or subject is null then return 0; end if;
  if viewer = subject then return 2; end if;
  if not exists (select 1 from public.members m where m.user_id = viewer and m.status = 'active') then return 0; end if;
  if exists (select 1 from public.members m where m.user_id = viewer and m.status = 'active' and 'admin' = any (m.roles)) then return 2; end if;
  if depth >= 2 then return 0; end if;

  -- 1. An exception for this person.
  select a.level, a.granted_by into p from public.access a where a.viewer_id = viewer and a.subject_id = subject;
  if found then
    return least(public.lvl(p.level), public.grant_cap(p.granted_by, subject, depth));
  end if;

  -- 2. The best of their teams.
  select max(least(public.lvl(ta.level), public.grant_cap(ta.granted_by, subject, depth))) into result
    from public.team_access ta
    join public.team_members tm on tm.team_id = ta.team_id
   where ta.viewer_id = viewer and tm.user_id = subject;
  if result is not null and result > 0 then return result; end if;

  -- 3. Everyone (never the admin: an admin is only shared through a team or a person exception).
  if exists (select 1 from public.members m where m.user_id = subject and 'admin' = any (m.roles)) then return 0; end if;
  select least(public.lvl(vs.level), public.grant_cap(vs.granted_by, subject, depth)) into result
    from public.viewer_scope vs where vs.viewer_id = viewer;
  return coalesce(result, 0);
end;
$$;

-- What the person who set a rule can give: everything if they're the admin, otherwise what they can see themselves.
create or replace function public.grant_cap(granter uuid, subject uuid, depth int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when granter is null then 0
    when exists (select 1 from public.members m where m.user_id = granter and m.status = 'active' and 'admin' = any (m.roles)) then 2
    else public.access_level(granter, subject, depth + 1)
  end;
$$;

-- The sharing rules (015) all go through can_see: now it uses the resolver.
create or replace function public.can_see(subject uuid, need text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.access_level((select auth.uid()), subject) >= case when need = 'plan' then 2 else 1 end;
$$;

-- Everyone you can see, and at what level (for the Team page).
create or replace function public.org_my_people()
returns table (user_id uuid, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, case public.access_level((select auth.uid()), m.user_id) when 2 then 'plan' else 'view' end
    from public.members m
   where m.user_id <> (select auth.uid())
     and public.access_level((select auth.uid()), m.user_id) > 0;
$$;

-- Who a given viewer ends up seeing (admin: anyone; founder: their managers), to preview the rules.
create or replace function public.org_people_of(viewer uuid)
returns table (user_id uuid, level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or (public.has_role('founder') and public.has_role('manager', viewer))) then
    raise exception 'Not allowed.';
  end if;
  return query
    select m.user_id, case public.access_level(viewer, m.user_id) when 2 then 'plan' else 'view' end
      from public.members m
     where m.user_id <> viewer and public.access_level(viewer, m.user_id) > 0;
end;
$$;

-- ---------- setting the rules ----------
-- Who may set rules for a viewer: the admin for anyone; a founder for managers (never admins or founders).
create or replace function public.may_set_rules_for(viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.has_role('founder')
          and public.has_role('manager', viewer)
          and not public.has_role('founder', viewer)
          and not public.has_role('admin', viewer)
          and viewer <> (select auth.uid()));
$$;

-- A person exception: 'none' hides them, 'view'/'plan' sets their level, null removes the exception.
create or replace function public.org_set_access(viewer uuid, subject uuid, level_ text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if viewer = subject then raise exception 'Everyone already sees their own work.'; end if;
  if level_ is not null and level_ not in ('none', 'view', 'plan') then raise exception 'Level is none, view or plan.'; end if;
  if not public.may_set_rules_for(viewer) then raise exception 'Founders set access for managers; the admin sets it for founders.'; end if;
  if not public.is_admin() and level_ in ('view', 'plan') and not public.can_see(subject, level_) then
    raise exception 'You can only share people you can see yourself (and plan for, to give plan access).';
  end if;
  if level_ is null then
    delete from public.access where viewer_id = viewer and subject_id = subject;
  else
    insert into public.access (viewer_id, subject_id, level, granted_by)
    values (viewer, subject, level_, (select auth.uid()))
    on conflict (viewer_id, subject_id) do update set level = excluded.level, granted_by = excluded.granted_by, created_at = now();
  end if;
end;
$$;

-- Everyone: 'view' / 'plan', or null for nobody.
create or replace function public.org_set_scope(viewer uuid, level_ text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if level_ is not null and level_ not in ('view', 'plan') then raise exception 'Level is view or plan.'; end if;
  if not public.may_set_rules_for(viewer) then raise exception 'Founders set access for managers; the admin sets it for founders.'; end if;
  if level_ is null then
    delete from public.viewer_scope where viewer_id = viewer;
  else
    insert into public.viewer_scope (viewer_id, level, granted_by) values (viewer, level_, (select auth.uid()))
    on conflict (viewer_id) do update set level = excluded.level, granted_by = excluded.granted_by, created_at = now();
  end if;
end;
$$;

-- A team: 'view' / 'plan', or null to remove.
create or replace function public.org_set_team_access(viewer uuid, team uuid, level_ text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if level_ is not null and level_ not in ('view', 'plan') then raise exception 'Level is view or plan.'; end if;
  if not public.may_set_rules_for(viewer) then raise exception 'Founders set access for managers; the admin sets it for founders.'; end if;
  if level_ is null then
    delete from public.team_access where viewer_id = viewer and team_id = team;
  else
    insert into public.team_access (viewer_id, team_id, level, granted_by) values (viewer, team, level_, (select auth.uid()))
    on conflict (viewer_id, team_id) do update set level = excluded.level, granted_by = excluded.granted_by, created_at = now();
  end if;
end;
$$;

-- Teams themselves: the admin makes, renames and fills them.
create or replace function public.org_save_team(team uuid, team_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := left(btrim(regexp_replace(coalesce(team_name, ''), '\s+', ' ', 'g')), 40);
  result uuid;
begin
  if not public.is_admin() then raise exception 'Only the admin manages teams.'; end if;
  if clean = '' then raise exception 'Give the team a name.'; end if;
  if team is null then
    insert into public.teams (name, created_by) values (clean, (select auth.uid())) returning id into result;
  else
    update public.teams set name = clean where id = team returning id into result;
  end if;
  return result;
end;
$$;

create or replace function public.org_delete_team(team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin manages teams.'; end if;
  delete from public.teams where id = team;
end;
$$;

create or replace function public.org_set_team_member(team uuid, person uuid, member_ boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin manages teams.'; end if;
  if member_ then
    insert into public.team_members (team_id, user_id) values (team, person) on conflict do nothing;
  else
    delete from public.team_members where team_id = team and user_id = person;
  end if;
end;
$$;

-- Losing every viewing role also clears the broader rules (015's org_set_roles clears person rows).
create or replace function public.clear_viewer_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (new.roles && array['admin', 'founder', 'manager']) or new.status = 'removed' then
    delete from public.viewer_scope where viewer_id = new.user_id;
    delete from public.team_access where viewer_id = new.user_id;
    delete from public.access where viewer_id = new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists members_clear_viewer_rules on public.members;
create trigger members_clear_viewer_rules after update of roles, status on public.members
  for each row execute function public.clear_viewer_rules();

-- Founders reading which managers have which people: they now need the person rows of any manager.
drop policy if exists "access: read" on public.access;
create policy "access: read" on public.access for select to authenticated
  using (viewer_id = (select auth.uid()) or subject_id = (select auth.uid()) or public.is_admin() or public.has_role('founder'));

revoke all on function public.lvl(text) from public;
revoke all on function public.access_level(uuid, uuid, int) from public;
revoke all on function public.grant_cap(uuid, uuid, int) from public;
revoke all on function public.org_my_people() from public;
revoke all on function public.org_people_of(uuid) from public;
revoke all on function public.may_set_rules_for(uuid) from public;
revoke all on function public.org_set_scope(uuid, text) from public;
revoke all on function public.org_set_team_access(uuid, uuid, text) from public;
revoke all on function public.org_save_team(uuid, text) from public;
revoke all on function public.org_delete_team(uuid) from public;
revoke all on function public.org_set_team_member(uuid, uuid, boolean) from public;
revoke all on function public.clear_viewer_rules() from public;
grant execute on function public.lvl(text) to authenticated;
grant execute on function public.org_my_people() to authenticated;
grant execute on function public.org_people_of(uuid) to authenticated;
grant execute on function public.org_set_scope(uuid, text) to authenticated;
grant execute on function public.org_set_team_access(uuid, uuid, text) to authenticated;
grant execute on function public.org_save_team(uuid, text) to authenticated;
grant execute on function public.org_delete_team(uuid) to authenticated;
grant execute on function public.org_set_team_member(uuid, uuid, boolean) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.teams; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.team_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.team_access; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.viewer_scope; exception when duplicate_object then null; end;
end $$;
