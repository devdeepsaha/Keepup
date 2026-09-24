-- Repeating check-in rhythm: N logged updates per Monday–Sunday week, spaced 2+ days apart.
alter table public.tasks
  add column if not exists cadence_per_week smallint check (cadence_per_week between 1 and 3);
