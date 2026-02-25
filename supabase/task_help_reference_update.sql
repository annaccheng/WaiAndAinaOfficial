alter table if exists tasks
  add column if not exists created_by_name text,
  add column if not exists task_help_references text[] not null default '{}';

update tasks
set task_help_references = array[created_by_name]
where (task_help_references is null or cardinality(task_help_references) = 0)
  and created_by_name is not null
  and btrim(created_by_name) <> '';

-- Optional: backfill from schedule editor ownership mapping if your system tracks it elsewhere.
