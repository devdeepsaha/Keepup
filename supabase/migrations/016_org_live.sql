-- APPLY ONLY AFTER the company version of the app is live on keepup.devdeepsaha.in.
-- Until then (015) shared rows only reach requests marked "x-keepup-org: 1", so the older live code can't
-- mix colleagues' tasks into anyone's own list. Once every client asks for "only mine" itself, the marker can go,
-- which also lets live updates (realtime) flow for team views.
create or replace function public.shares(subject uuid, need text default 'view')
returns boolean
language sql
stable
set search_path = ''
as $$
  select subject = (select auth.uid()) or public.can_see(subject, need);
$$;
