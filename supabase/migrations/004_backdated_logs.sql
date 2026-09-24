-- A log can be backdated ("did X yesterday"). Only move the task's last_updated forward,
-- never back, and use the log's own timestamp rather than now().
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
