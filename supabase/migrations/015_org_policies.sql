-- The company's privacy rules. Only the Mint-more space ("agency") is ever shared, and only with the admin and
-- the people the admin (for founders) or a founder (for managers) granted. Personal and custom spaces, Bouncy
-- chats, client colours and spaces stay visible to their owner alone, admin included.
--
-- Rollout guard: shared rows are only returned to requests from the new app, which sends "x-keepup-org: 1".
-- The live site's older code doesn't send it, so it keeps seeing exactly what it does today until it's updated.
-- (016 removes the guard once the new code is live; realtime can't see request headers.)

create or replace function public.org_client()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-keepup-org') = '1', false);
$$;

-- Can I see (or plan for) this person's Mint-more work, from this client?
create or replace function public.shares(subject uuid, need text default 'view')
returns boolean
language sql
stable
set search_path = ''
as $$
  select subject = (select auth.uid()) or (public.org_client() and public.can_see(subject, need));
$$;

grant execute on function public.org_client() to authenticated;
grant execute on function public.shares(uuid, text) to authenticated;

-- Notices go to someone in particular: the task's owner for a colleague's edit, the assigner for a reply.
alter table public.task_events add column if not exists notify_id uuid references auth.users (id) on delete cascade;
create index if not exists task_events_notify_idx on public.task_events (notify_id, created_at desc);

-- ---------- tasks ----------
drop policy if exists "tasks: owner select" on public.tasks;
drop policy if exists "tasks: owner insert" on public.tasks;
drop policy if exists "tasks: owner update" on public.tasks;
drop policy if exists "tasks: owner delete" on public.tasks;
drop policy if exists "tasks: select" on public.tasks;
drop policy if exists "tasks: insert" on public.tasks;
drop policy if exists "tasks: update" on public.tasks;
drop policy if exists "tasks: delete" on public.tasks;

create policy "tasks: select" on public.tasks for select to authenticated
  using (user_id = (select auth.uid()) or (workspace = 'agency' and public.shares(user_id, 'view')));
-- Your own, or a Mint-more task for someone you plan for (an assignment).
create policy "tasks: insert" on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()) or (workspace = 'agency' and public.shares(user_id, 'plan')));
create policy "tasks: update" on public.tasks for update to authenticated
  using (user_id = (select auth.uid()) or (workspace = 'agency' and public.shares(user_id, 'plan')))
  with check (user_id = (select auth.uid()) or (workspace = 'agency' and public.shares(user_id, 'plan')));
create policy "tasks: delete" on public.tasks for delete to authenticated
  using (user_id = (select auth.uid()));

-- What a colleague may and may not do to your task, who changed it, and the notices that follow.
create or replace function public.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  changes jsonb := '{}'::jsonb;
begin
  if me is null or current_setting('keepup.handover', true) = 'on' then
    return new; -- the server itself (maintenance) or org_handover moving tasks
  end if;

  if tg_op = 'INSERT' then
    new.changed_by := me;
    if new.user_id <> me then
      -- An assignment: it waits for the person to accept it.
      new.assigned_by := me;
      new.assignment_status := 'pending';
      new.assignment_note := null; -- (the notice is sent once the row exists: tasks_assigned)
    else
      new.assigned_by := null;
      new.assignment_status := null;
      new.assignment_note := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.user_id is distinct from old.user_id then
    raise exception 'A task can''t change hands here; ask an admin or founder to hand it over.';
  end if;
  new.changed_by := me;

  if old.user_id <> me then
    -- A planner: can edit the work, not where it lives, whether it exists, or the person's answer.
    if new.workspace is distinct from old.workspace
       or new.deleted_at is distinct from old.deleted_at
       or new.archived_at is distinct from old.archived_at
       or new.assigned_by is distinct from old.assigned_by
       or new.assignment_status is distinct from old.assignment_status
       or new.assignment_note is distinct from old.assignment_note then
      raise exception 'Only the task''s owner can move, archive, delete or answer it.';
    end if;
    if new.text is distinct from old.text then changes := changes || jsonb_build_object('title', jsonb_build_array(old.text, new.text)); end if;
    if new.due_date is distinct from old.due_date then changes := changes || jsonb_build_object('due', jsonb_build_array(old.due_date, new.due_date)); end if;
    if new.done is distinct from old.done then changes := changes || jsonb_build_object('done', new.done); end if;
    if new.cadence_per_week is distinct from old.cadence_per_week then changes := changes || jsonb_build_object('rhythm', jsonb_build_array(old.cadence_per_week, new.cadence_per_week)); end if;
    if new.client is distinct from old.client then changes := changes || jsonb_build_object('client', jsonb_build_array(old.client, new.client)); end if;
    if new.waiting_since is distinct from old.waiting_since or new.waiting_for is distinct from old.waiting_for then
      changes := changes || jsonb_build_object('hold', jsonb_build_array(old.waiting_for, new.waiting_for, new.waiting_since is not null));
    end if;
    if new.links is distinct from old.links then changes := changes || jsonb_build_object('links', true); end if;
    if new.handle is distinct from old.handle then changes := changes || jsonb_build_object('tag', jsonb_build_array(old.handle, new.handle)); end if;
    if changes <> '{}'::jsonb then
      insert into public.task_events (task_id, owner_id, actor_id, notify_id, kind, detail)
      values (new.id, new.user_id, me, new.user_id, 'edited', changes || jsonb_build_object('title_now', new.text));
    end if;
  elsif new.assignment_status is distinct from old.assignment_status and old.assigned_by is not null then
    -- The owner answered an assignment: tell whoever assigned it.
    insert into public.task_events (task_id, owner_id, actor_id, notify_id, kind, detail)
    values (new.id, new.user_id, me, old.assigned_by, coalesce(new.assignment_status, 'reset'),
            jsonb_build_object('title', new.text, 'note', new.assignment_note));
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tasks_guard();

-- "Rahul gave you a task": sent once the assigned task exists.
create or replace function public.tasks_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_by is not null and new.assigned_by <> new.user_id then
    insert into public.task_events (task_id, owner_id, actor_id, notify_id, kind, detail)
    values (new.id, new.user_id, new.assigned_by, new.user_id, 'assigned', jsonb_build_object('title', new.text));
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_assigned on public.tasks;
create trigger tasks_assigned after insert on public.tasks
  for each row execute function public.tasks_assigned();

-- ---------- logs: readable like their task; only ever written by the task's owner ----------
drop policy if exists "updates: owner select" on public.task_updates;
drop policy if exists "updates: select" on public.task_updates;
create policy "updates: select" on public.task_updates for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and t.workspace = 'agency' and public.shares(t.user_id, 'view'))
  );
-- (insert and delete keep the owner-only policies from schema.sql)

-- ---------- planned client updates: readable like their task; the owner or a planner can change them ----------
drop policy if exists "planned updates: owner all" on public.planned_updates;
drop policy if exists "planned updates: select" on public.planned_updates;
drop policy if exists "planned updates: write" on public.planned_updates;
create policy "planned updates: select" on public.planned_updates for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and t.workspace = 'agency' and public.shares(t.user_id, 'view'))
  );
create policy "planned updates: write" on public.planned_updates for all to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_id and t.user_id = planned_updates.user_id
            and (t.user_id = (select auth.uid()) or (t.workspace = 'agency' and public.shares(t.user_id, 'plan'))))
  )
  with check (
    exists (select 1 from public.tasks t where t.id = task_id and t.user_id = planned_updates.user_id
            and (t.user_id = (select auth.uid()) or (t.workspace = 'agency' and public.shares(t.user_id, 'plan'))))
  );

-- A planned update always belongs to its task's owner, whoever wrote it; a colleague's change is a notice.
create or replace function public.planned_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  row_ public.planned_updates;
  owner uuid;
begin
  if tg_op = 'DELETE' then row_ := old; else row_ := new; end if;
  select t.user_id into owner from public.tasks t where t.id = row_.task_id;
  if tg_op = 'INSERT' and owner is not null then
    new.user_id := owner;
    row_ := new;
  end if;
  if me is not null and owner is not null and owner <> me and coalesce(current_setting('keepup.handover', true), '') <> 'on' then
    insert into public.task_events (task_id, owner_id, actor_id, notify_id, kind, detail)
    values (row_.task_id, owner, me, owner, 'planned_' || lower(tg_op),
            jsonb_build_object('title', row_.title, 'send_on', row_.send_on));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists planned_guard on public.planned_updates;
create trigger planned_guard before insert or update or delete on public.planned_updates
  for each row execute function public.planned_guard();

-- ---------- the company tables ----------
-- Names and roles of everyone in the company (to show "From Rahul").
drop policy if exists "members: read" on public.members;
create policy "members: read" on public.members for select to authenticated using (true);

-- Who can see whom: the viewer, the person, the admin, and founders for the people they can see themselves.
drop policy if exists "access: read" on public.access;
create policy "access: read" on public.access for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or subject_id = (select auth.uid())
    or public.is_admin()
    or (exists (select 1 from public.members m where m.user_id = (select auth.uid()) and m.status = 'active' and 'founder' = any (m.roles))
        and public.can_see(subject_id, 'view'))
  );

-- Notices: yours to read and mark seen. The admin can read them all (change history).
drop policy if exists "events: read" on public.task_events;
drop policy if exists "events: mark seen" on public.task_events;
create policy "events: read" on public.task_events for select to authenticated
  using (notify_id = (select auth.uid()) or public.is_admin());
create policy "events: mark seen" on public.task_events for update to authenticated
  using (notify_id = (select auth.uid())) with check (notify_id = (select auth.uid()));
revoke update on public.task_events from authenticated;
grant update (seen_at) on public.task_events to authenticated;

-- ---------- joining ----------
-- Every new account joins as a member; an invite decides its name and roles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invites;
begin
  select * into inv from public.invites i where i.email = lower(new.email);
  insert into public.members (user_id, display_name, roles, status, invited_by)
  values (new.id, inv.display_name, coalesce(inv.roles, array['member']),
          case when new.invited_at is not null then 'invited' else 'active' end, inv.invited_by)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Signed in: an invited person becomes active; sets your display name.
create or replace function public.org_hello(p_name text default null)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  result public.members;
  clean text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.members (user_id) values (me) on conflict (user_id) do nothing;
  update public.members m
     set status = case when m.status = 'invited' then 'active' else m.status end,
         display_name = coalesce(left(clean, 60), m.display_name)
   where m.user_id = me
  returning * into result;
  update public.invites set accepted_at = coalesce(accepted_at, now())
   where email = (select lower(u.email) from auth.users u where u.id = me);
  return result;
end;
$$;

-- ---------- running the company (all checks live here; the org function calls these as the user) ----------
create or replace function public.has_role(r text, who uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m
                 where m.user_id = coalesce(who, (select auth.uid())) and m.status = 'active' and r = any (m.roles));
$$;

-- Roles: the admin sets any; a founder makes people they can see managers or members (never admins/founders).
create or replace function public.org_set_roles(target uuid, new_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  roles_ text[] := array(select distinct r from unnest(new_roles) r where r in ('admin', 'founder', 'manager', 'member'));
begin
  if cardinality(roles_) = 0 then roles_ := array['member']; end if;
  if public.is_admin() then
    if target = me and not ('admin' = any (roles_)) then
      raise exception 'You can''t remove your own admin role.';
    end if;
  elsif public.has_role('founder') then
    if target = me then raise exception 'Ask the admin to change your own roles.'; end if;
    if not public.can_see(target, 'view') then raise exception 'You can only set roles for people you can see.'; end if;
    if public.has_role('admin', target) or public.has_role('founder', target) then
      raise exception 'Only the admin can change an admin''s or founder''s roles.';
    end if;
    if roles_ && array['admin', 'founder'] then raise exception 'Only the admin can make someone a founder or admin.'; end if;
  else
    raise exception 'Only the admin and founders can set roles.';
  end if;
  update public.members set roles = roles_ where user_id = target;
  if not found then raise exception 'No such person.'; end if;
  -- No longer a viewer: whatever they could see goes with the role.
  if not (roles_ && array['admin', 'founder', 'manager']) then
    delete from public.access where viewer_id = target;
  end if;
end;
$$;

-- Who can see whom. level null removes it.
-- The admin: anyone for anyone. A founder: gives their managers people they can see themselves, at most at their own level.
create or replace function public.org_set_access(viewer uuid, subject uuid, level_ text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if viewer = subject then raise exception 'Everyone already sees their own work.'; end if;
  if level_ is not null and level_ not in ('view', 'plan') then raise exception 'Level is view or plan.'; end if;
  if not public.is_admin() then
    if not public.has_role('founder') then raise exception 'Only the admin and founders can give access.'; end if;
    if not public.has_role('manager', viewer) or public.has_role('founder', viewer) or public.has_role('admin', viewer) then
      raise exception 'Founders give access to managers; the admin gives it to founders.';
    end if;
    if not public.can_see(subject, coalesce(level_, 'view')) then
      raise exception 'You can only share people you can see yourself (and plan for, to give plan access).';
    end if;
  end if;
  if level_ is not null and not (public.has_role('founder', viewer) or public.has_role('manager', viewer) or public.has_role('admin', viewer)) then
    raise exception 'Make them a manager or founder first.';
  end if;
  if level_ is null then
    delete from public.access where viewer_id = viewer and subject_id = subject;
  else
    insert into public.access (viewer_id, subject_id, level, granted_by)
    values (viewer, subject, level_, me)
    on conflict (viewer_id, subject_id) do update set level = excluded.level, granted_by = excluded.granted_by, created_at = now();
  end if;
end;
$$;

-- Someone left: they lose access (the org function also blocks their sign-in). Their Mint-more tasks stay for handover.
create or replace function public.org_remove(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can remove people.'; end if;
  if target = (select auth.uid()) then raise exception 'You can''t remove yourself.'; end if;
  update public.members set status = 'removed' where user_id = target;
  delete from public.access where viewer_id = target;
end;
$$;

create or replace function public.org_restore(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can restore people.'; end if;
  update public.members set status = 'active' where user_id = target;
end;
$$;

-- Handing over: someone's open Mint-more tasks (with their logs and planned updates) move to someone else.
create or replace function public.org_handover(from_user uuid, to_user uuid, task_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  moved integer;
begin
  if not (public.can_see(from_user, 'plan') and public.can_see(to_user, 'plan')) or from_user = to_user then
    raise exception 'You need plan access to both people to hand work over.';
  end if;
  create temporary table if not exists _handover (id uuid) on commit drop;
  delete from _handover;
  insert into _handover
    select t.id from public.tasks t
     where t.user_id = from_user and t.workspace = 'agency' and t.deleted_at is null and not t.done
       and (task_ids is null or t.id = any (task_ids));
  -- The guard lets org_handover change owners (and only it: switched off again below).
  perform set_config('keepup.handover', 'on', true);
  update public.tasks set user_id = to_user, assigned_by = me, assignment_status = 'pending', assignment_note = null, archived_at = null
   where id in (select id from _handover);
  get diagnostics moved = row_count;
  update public.task_updates set user_id = to_user where task_id in (select id from _handover);
  update public.planned_updates set user_id = to_user where task_id in (select id from _handover);
  insert into public.task_events (task_id, owner_id, actor_id, notify_id, kind, detail)
    select t.id, to_user, me, to_user, 'handed_over', jsonb_build_object('title', t.text, 'from', from_user)
      from public.tasks t where t.id in (select id from _handover);
  perform set_config('keepup.handover', 'off', true);
  return moved;
end;
$$;

-- Email addresses and last sign-in, for the admin's people list (colleagues only ever see names).
create or replace function public.org_emails()
returns table (user_id uuid, email text, last_sign_in_at timestamptz, invited_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.last_sign_in_at, u.invited_at
    from auth.users u
   where public.is_admin();
$$;

revoke all on function public.org_emails() from public;
grant execute on function public.org_emails() to authenticated;
revoke all on function public.org_hello(text) from public;
revoke all on function public.has_role(text, uuid) from public;
revoke all on function public.org_set_roles(uuid, text[]) from public;
revoke all on function public.org_set_access(uuid, uuid, text) from public;
revoke all on function public.org_remove(uuid) from public;
revoke all on function public.org_restore(uuid) from public;
revoke all on function public.org_handover(uuid, uuid, uuid[]) from public;
grant execute on function public.org_hello(text) to authenticated;
grant execute on function public.has_role(text, uuid) to authenticated;
grant execute on function public.org_set_roles(uuid, text[]) to authenticated;
grant execute on function public.org_set_access(uuid, uuid, text) to authenticated;
grant execute on function public.org_remove(uuid) to authenticated;
grant execute on function public.org_restore(uuid) to authenticated;
grant execute on function public.org_handover(uuid, uuid, uuid[]) to authenticated;
revoke all on function public.tasks_guard() from public;
revoke all on function public.planned_guard() from public;
revoke all on function public.tasks_assigned() from public;
revoke all on function public.handle_new_user() from public;

-- Realtime for the company tables (notices, roles, access).
do $$
begin
  begin alter publication supabase_realtime add table public.task_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.access; exception when duplicate_object then null; end;
end $$;
