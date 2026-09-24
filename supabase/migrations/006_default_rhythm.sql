-- Every task gets a twice-a-week check-in rhythm by default (can be turned off per task).
alter table public.tasks alter column cadence_per_week set default 2;

-- Give existing active tasks the default rhythm too.
update public.tasks set cadence_per_week = 2 where cadence_per_week is null and not done;
