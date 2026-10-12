-- Privacy test for the company rules (015). Creates throwaway people and tasks, checks what each one can see
-- and do, then ROLLS EVERYTHING BACK: nothing stays in the database.
-- Run: npx supabase db query --linked -f supabase/tests/org_privacy_test.sql
--
-- Cast: A admin · F founder (granted X at plan, Y at view) · M manager (given X at view by F)
--       X, Y, Z members (nobody was given Z).

begin;

create temp table _r (n serial, check_name text, ok boolean, got text);
grant all on _r to authenticated;
grant usage on sequence _r_n_seq to authenticated;

-- Act as someone. new_app: whether the request comes from the new app (sends x-keepup-org: 1).
create function pg_temp.act(who uuid, new_app boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true),
         set_config('request.headers', case when new_app then '{"x-keepup-org":"1"}' else '{}' end, true);
$$;
create function pg_temp.expect(name text, ok boolean, got text default null) returns void language sql as $$
  insert into _r (check_name, ok, got) values (name, ok, got);
$$;
-- Which of the test tasks this person can see, as a sorted list of short names.
create function pg_temp.seen() returns text language sql as $$
  select coalesce(string_agg(t.text, ',' order by t.text), '') from public.tasks t where t.text like 'T:%';
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- People
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, now(), now(), now()
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'zz-test-admin@keepup.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'zz-test-founder@keepup.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'zz-test-manager@keepup.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'zz-test-x@keepup.test'),
  ('aaaaaaaa-0000-4000-8000-000000000005'::uuid, 'zz-test-y@keepup.test'),
  ('aaaaaaaa-0000-4000-8000-000000000006'::uuid, 'zz-test-z@keepup.test')
) v(id, email);

select pg_temp.expect('new accounts join as members', (select count(*) = 6 from public.members where user_id::text like 'aaaaaaaa-%' and roles = '{member}'));

update public.members set roles = '{admin,founder,member}' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.members set roles = '{founder,member}' where user_id = 'aaaaaaaa-0000-4000-8000-000000000002';
update public.members set roles = '{manager,member}' where user_id = 'aaaaaaaa-0000-4000-8000-000000000003';
-- The real admin(s) would see test tasks too; pretend they're the only admin for this test by checking only T: tasks.

-- Their work: Mint-more (agency), Personal, and a custom space, with logs, planned updates and a chat.
insert into public.tasks (id, user_id, text, workspace) values
  ('bbbbbbbb-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'T:A-mint', 'agency'),
  ('bbbbbbbb-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'T:A-personal', 'personal'),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000002', 'T:F-mint', 'agency'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000003', 'T:M-mint', 'agency'),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000004', 'T:X-mint', 'agency'),
  ('bbbbbbbb-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000004', 'T:X-personal', 'personal'),
  ('bbbbbbbb-0000-4000-8000-0000000000d3', 'aaaaaaaa-0000-4000-8000-000000000004', 'T:X-side', 'side-gig'),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000005', 'T:Y-mint', 'agency'),
  ('bbbbbbbb-0000-4000-8000-0000000000e2', 'aaaaaaaa-0000-4000-8000-000000000005', 'T:Y-personal', 'personal'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000006', 'T:Z-mint', 'agency');
insert into public.task_updates (task_id, user_id, text) values
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000004', 'L:X-mint'),
  ('bbbbbbbb-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000004', 'L:X-personal');
insert into public.planned_updates (task_id, user_id, send_on, title, text) values
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000004', current_date + 2, 'P:X', 'Planned for X');
insert into public.chats (id, user_id, title) values ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000004', 'X private chat');
insert into public.chat_messages (chat_id, user_id, role, data) values ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000004', 'user', '{"text":"secret"}');

set role authenticated;

-- ===== Access is granted through the functions =====
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select public.org_set_access('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'plan');
select public.org_set_access('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000005', 'view');

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select public.org_set_access('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', 'view');

do $$ begin
  perform public.org_set_access('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000006', 'view');
  perform pg_temp.expect('founder cannot give a manager someone the founder cannot see', false);
exception when others then perform pg_temp.expect('founder cannot give a manager someone the founder cannot see', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_access('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000005', 'plan');
  perform pg_temp.expect('founder with view access cannot give plan access', false);
exception when others then perform pg_temp.expect('founder with view access cannot give plan access', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_access('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000004', 'view');
  perform pg_temp.expect('founder cannot give access to a plain member', false);
exception when others then perform pg_temp.expect('founder cannot give access to a plain member', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000001', '{member}');
  perform pg_temp.expect('founder cannot change the admin''s roles', false);
exception when others then perform pg_temp.expect('founder cannot change the admin''s roles', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000002', '{admin,founder}');
  perform pg_temp.expect('founder cannot make themselves admin', false);
exception when others then perform pg_temp.expect('founder cannot make themselves admin', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000006', '{manager}');
  perform pg_temp.expect('founder cannot set roles for someone they cannot see', false);
exception when others then perform pg_temp.expect('founder cannot set roles for someone they cannot see', true, sqlerrm);
end $$;
do $$ begin
  perform public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000005', '{founder}');
  perform pg_temp.expect('founder cannot make others founders', false);
exception when others then perform pg_temp.expect('founder cannot make others founders', true, sqlerrm);
end $$;

-- ===== What each person sees =====
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.expect('admin: own work + everyone''s Mint-more, no one else''s Personal/custom', pg_temp.seen() = 'T:A-mint,T:A-personal,T:F-mint,T:M-mint,T:X-mint,T:Y-mint,T:Z-mint', pg_temp.seen());
select pg_temp.expect('admin cannot read others'' chats', (select count(*) = 0 from public.chats where user_id <> 'aaaaaaaa-0000-4000-8000-000000000001' and title = 'X private chat'));
select pg_temp.expect('admin cannot read others'' chat messages', (select count(*) = 0 from public.chat_messages where chat_id = 'cccccccc-0000-4000-8000-000000000004'));
select pg_temp.expect('admin sees Mint-more logs, not Personal logs', (select string_agg(text, ',' order by text) = 'L:X-mint' from public.task_updates where text like 'L:%'), (select string_agg(text, ',') from public.task_updates where text like 'L:%'));

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001', false);
select pg_temp.expect('without the app marker the rules are the same (016: no rollout switch)', pg_temp.seen() = 'T:A-mint,T:A-personal,T:F-mint,T:M-mint,T:X-mint,T:Y-mint,T:Z-mint', pg_temp.seen());

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.expect('founder: own + only the granted people''s Mint-more (not admin, not Z)', pg_temp.seen() = 'T:F-mint,T:X-mint,T:Y-mint', pg_temp.seen());
select pg_temp.expect('founder sees the planned updates of people they see', (select count(*) = 1 from public.planned_updates where title = 'P:X'));

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.expect('manager: own + only the people given to them', pg_temp.seen() = 'T:M-mint,T:X-mint', pg_temp.seen());
select pg_temp.expect('manager sees planned updates of their people', (select count(*) = 1 from public.planned_updates where title = 'P:X'));

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.expect('member: only their own work, all spaces', pg_temp.seen() = 'T:X-mint,T:X-personal,T:X-side', pg_temp.seen());
select pg_temp.expect('member can see who can see them', (select count(*) = 2 from public.access where subject_id = 'aaaaaaaa-0000-4000-8000-000000000004'));

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.expect('ungranted member sees nobody else', pg_temp.seen() = 'T:Z-mint', pg_temp.seen());
select pg_temp.expect('ungranted member sees no one''s planned updates', (select count(*) = 0 from public.planned_updates where title = 'P:X'));

-- ===== What each person can do =====
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
do $$ declare n int; begin
  update public.tasks set due_date = current_date + 5 where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  perform pg_temp.expect('founder with plan access can change X''s due date', n = 1, n::text);
end $$;
do $$ declare n int; begin
  update public.tasks set due_date = current_date + 5 where id = 'bbbbbbbb-0000-4000-8000-0000000000e1';
  get diagnostics n = row_count;
  perform pg_temp.expect('founder with view access cannot edit Y''s task', n = 0, n::text);
end $$;
do $$ declare n int; begin
  update public.tasks set text = 'hacked' where id = 'bbbbbbbb-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  perform pg_temp.expect('founder cannot touch X''s Personal task', n = 0, n::text);
end $$;
do $$ begin
  update public.tasks set deleted_at = now() where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  perform pg_temp.expect('a planner cannot trash someone''s task', false);
exception when others then perform pg_temp.expect('a planner cannot trash someone''s task', true, sqlerrm);
end $$;
do $$ begin
  update public.tasks set workspace = 'personal' where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  perform pg_temp.expect('a planner cannot move someone''s task to another space', false);
exception when others then perform pg_temp.expect('a planner cannot move someone''s task to another space', true, sqlerrm);
end $$;
do $$ begin
  insert into public.task_updates (task_id, user_id, text) values ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000004', 'forged');
  perform pg_temp.expect('nobody can write a log on someone else''s task', false);
exception when others then perform pg_temp.expect('nobody can write a log on someone else''s task', true, sqlerrm);
end $$;
do $$ begin
  insert into public.task_updates (task_id, text) values ('bbbbbbbb-0000-4000-8000-0000000000d1', 'forged');
  perform pg_temp.expect('nobody can log on someone else''s task as themselves', false);
exception when others then perform pg_temp.expect('nobody can log on someone else''s task as themselves', true, sqlerrm);
end $$;
do $$ declare n int; begin
  delete from public.tasks where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  perform pg_temp.expect('nobody can delete someone else''s task', n = 0, n::text);
end $$;
do $$ declare n int; begin
  delete from public.task_updates where text = 'L:X-mint';
  get diagnostics n = row_count;
  perform pg_temp.expect('nobody can delete someone else''s log', n = 0, n::text);
end $$;
-- Assigning
insert into public.tasks (id, user_id, text, workspace)
  values ('bbbbbbbb-0000-4000-8000-0000000000d9', 'aaaaaaaa-0000-4000-8000-000000000004', 'T:X-assigned', 'agency');
select pg_temp.expect('an assignment waits for the person to accept it',
  (select assignment_status = 'pending' and assigned_by = 'aaaaaaaa-0000-4000-8000-000000000002' from public.tasks where id = 'bbbbbbbb-0000-4000-8000-0000000000d9'));
do $$ begin
  insert into public.tasks (user_id, text, workspace) values ('aaaaaaaa-0000-4000-8000-000000000004', 'T:X-personal-push', 'personal');
  perform pg_temp.expect('nobody can add tasks to someone''s Personal space', false);
exception when others then perform pg_temp.expect('nobody can add tasks to someone''s Personal space', true, sqlerrm);
end $$;
do $$ begin
  insert into public.tasks (user_id, text, workspace) values ('aaaaaaaa-0000-4000-8000-000000000005', 'T:Y-assigned', 'agency');
  perform pg_temp.expect('view access cannot assign', false);
exception when others then perform pg_temp.expect('view access cannot assign', true, sqlerrm);
end $$;
insert into public.planned_updates (task_id, send_on, title, text)
  values ('bbbbbbbb-0000-4000-8000-0000000000d1', current_date + 3, 'P:by-founder', 'Written by the founder');
select pg_temp.expect('a planned update written by a planner belongs to the task''s owner',
  (select user_id = 'aaaaaaaa-0000-4000-8000-000000000004' from public.planned_updates where title = 'P:by-founder'));

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
do $$ declare n int; begin
  update public.tasks set due_date = current_date + 9 where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  perform pg_temp.expect('manager with view access cannot edit', n = 0, n::text);
end $$;
do $$ declare n int; begin
  update public.planned_updates set send_on = current_date + 9 where title = 'P:X';
  get diagnostics n = row_count;
  perform pg_temp.expect('manager with view access cannot move planned updates', n = 0, n::text);
end $$;

-- The member answers
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.expect('the member gets notices: assigned, edited, planned',
  (select count(distinct kind) = 3 from public.task_events where notify_id = 'aaaaaaaa-0000-4000-8000-000000000004' and kind in ('assigned', 'edited', 'planned_insert')),
  (select string_agg(kind, ',') from public.task_events where notify_id = 'aaaaaaaa-0000-4000-8000-000000000004'));
update public.tasks set assignment_status = 'declined', assignment_note = 'No time this week'
  where id = 'bbbbbbbb-0000-4000-8000-0000000000d9';
do $$ declare n int; begin
  update public.task_events set seen_at = now() where notify_id = 'aaaaaaaa-0000-4000-8000-000000000004';
  get diagnostics n = row_count;
  perform pg_temp.expect('the member can mark their notices seen', n >= 3, n::text);
end $$;
do $$ begin
  update public.task_events set kind = 'x' where notify_id = 'aaaaaaaa-0000-4000-8000-000000000004';
  perform pg_temp.expect('notices cannot be rewritten', false);
exception when others then perform pg_temp.expect('notices cannot be rewritten', true, sqlerrm);
end $$;

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.expect('the founder hears about the decline, with the note',
  (select count(*) = 1 from public.task_events where notify_id = 'aaaaaaaa-0000-4000-8000-000000000002' and kind = 'declined' and detail ->> 'note' = 'No time this week'));
do $$ begin
  update public.tasks set assignment_status = 'accepted' where id = 'bbbbbbbb-0000-4000-8000-0000000000d9';
  perform pg_temp.expect('only the person can answer an assignment', false);
exception when others then perform pg_temp.expect('only the person can answer an assignment', true, sqlerrm);
end $$;

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.expect('others never see someone''s notices', (select count(*) = 0 from public.task_events where notify_id <> 'aaaaaaaa-0000-4000-8000-000000000005'));

-- Roles: a founder makes someone they can see a manager; losing every viewing role removes what they could see.
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000004', '{manager,member}');
select pg_temp.expect('founder can make someone they see a manager', (select roles @> '{manager}' from public.members where user_id = 'aaaaaaaa-0000-4000-8000-000000000004'));
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select public.org_set_roles('aaaaaaaa-0000-4000-8000-000000000003', '{member}');
select pg_temp.expect('a manager made a member again loses their people',
  (select count(*) = 0 from public.access where viewer_id = 'aaaaaaaa-0000-4000-8000-000000000003'));

-- Leaving and handover
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select public.org_remove('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.expect('a removed founder sees only their own again', pg_temp.seen() = 'T:F-mint', pg_temp.seen());
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select public.org_handover('aaaaaaaa-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.expect('handover moves a leaver''s open Mint-more tasks',
  (select user_id = 'aaaaaaaa-0000-4000-8000-000000000005' and assignment_status = 'pending' from public.tasks where id = 'bbbbbbbb-0000-4000-8000-0000000000b1'));
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
do $$ declare n int; begin
  update public.tasks set user_id = 'aaaaaaaa-0000-4000-8000-000000000005' where id = 'bbbbbbbb-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  perform pg_temp.expect('a member cannot give their task away', false, n::text);
exception when others then perform pg_temp.expect('a member cannot give their task away', true, sqlerrm);
end $$;

reset role;
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, got from _r order by n;
rollback;
