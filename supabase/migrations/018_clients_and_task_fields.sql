-- Phase 7: Clients as first-class entities, richer task fields, manager auto-access,
-- and founder History/Access visibility.

-- ---------- 1. Clients ----------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  team_id     uuid references public.teams (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.clients enable row level security;

drop policy if exists "clients: read" on public.clients;
create policy "clients: read" on public.clients for select to authenticated using (true);
drop policy if exists "clients: insert" on public.clients;
create policy "clients: insert" on public.clients for insert to authenticated
  with check (public.is_admin() or public.has_role('founder'));
drop policy if exists "clients: update" on public.clients;
create policy "clients: update" on public.clients for update to authenticated
  using (public.is_admin() or public.has_role('founder'));
drop policy if exists "clients: delete" on public.clients;
create policy "clients: delete" on public.clients for delete to authenticated
  using (public.is_admin() or public.has_role('founder'));

-- ---------- 2. Richer task fields ----------
alter table public.tasks
  add column if not exists scheduled_date  date,
  add column if not exists deadline        timestamptz,
  add column if not exists priority        text check (priority in ('low', 'medium', 'high', 'urgent')),
  add column if not exists topic           text check (char_length(topic) <= 80),
  add column if not exists task_brief      text check (char_length(task_brief) <= 3000),
  add column if not exists client_id       uuid references public.clients (id) on delete set null,
  add column if not exists task_references jsonb not null default '[]'::jsonb;

-- ---------- 3. Manager auto-sees teammates (same team) ----------
-- Replaces the access_level() from 017 with one extra step:
-- If the viewer is a manager and is in a team together with the subject, grant plan (2) automatically.
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

  -- 2. The best of their explicitly-granted teams.
  select max(least(public.lvl(ta.level), public.grant_cap(ta.granted_by, subject, depth))) into result
    from public.team_access ta
    join public.team_members tm on tm.team_id = ta.team_id
   where ta.viewer_id = viewer and tm.user_id = subject;
  if result is not null and result > 0 then return result; end if;

  -- 2b. Managers automatically see their own teammates (same team membership → plan level).
  --     This is implicit: the admin controls team membership via TeamsEditor.
  if exists (select 1 from public.members m where m.user_id = viewer and m.status = 'active' and 'manager' = any(m.roles)) then
    if exists (
      select 1
        from public.team_members tm1
        join public.team_members tm2 on tm2.team_id = tm1.team_id and tm2.user_id = subject
       where tm1.user_id = viewer
    ) then
      return 2;
    end if;
  end if;

  -- 3. Everyone (never the admin).
  if exists (select 1 from public.members m where m.user_id = subject and 'admin' = any (m.roles)) then return 0; end if;
  select least(public.lvl(vs.level), public.grant_cap(vs.granted_by, subject, depth)) into result
    from public.viewer_scope vs where vs.viewer_id = viewer;
  return coalesce(result, 0);
end;
$$;

-- ---------- 4. Founders can read audit history ----------
drop policy if exists "task_events: read" on public.task_events;
create policy "task_events: read" on public.task_events for select to authenticated
  using (
    notify_id = (select auth.uid()) or
    owner_id  = (select auth.uid()) or
    actor_id  = (select auth.uid()) or
    public.is_admin() or
    public.has_role('founder')
  );

-- ---------- 5. Client helper functions ----------
create or replace function public.org_save_client(p_client_id uuid, p_name text, p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean  text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  result uuid;
begin
  if not (public.is_admin() or public.has_role('founder')) then
    raise exception 'Only admins and founders manage clients.';
  end if;
  if clean = '' then raise exception 'Give the client a name.'; end if;
  if p_client_id is null then
    insert into public.clients (name, team_id, created_by)
    values (clean, p_team_id, (select auth.uid()))
    returning id into result;
  else
    update public.clients set name = clean, team_id = p_team_id where id = p_client_id
    returning id into result;
  end if;
  return result;
end;
$$;

create or replace function public.org_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_role('founder')) then
    raise exception 'Only admins and founders manage clients.';
  end if;
  delete from public.clients where id = p_client_id;
end;
$$;

revoke all on function public.org_save_client(uuid, text, uuid) from public;
revoke all on function public.org_delete_client(uuid) from public;
grant execute on function public.org_save_client(uuid, text, uuid) to authenticated;
grant execute on function public.org_delete_client(uuid) to authenticated;

-- Realtime for clients
do $$ begin
  begin alter publication supabase_realtime add table public.clients; exception when duplicate_object then null; end;
end $$;
