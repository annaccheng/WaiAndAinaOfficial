-- Schedule redesign: new tables + column additions
-- Safe to run on any environment — all additive, no existing data touched.
-- Run this BEFORE schedule_redesign_migration.sql

-- ─── New columns on tasks ────────────────────────────────────────────────────
-- recurrence_unit already exists but previously only used 'day'|'month'|'year'
-- 'week' is now valid — no schema change needed, just a note.

alter table tasks
  add column if not exists recurrence_days    int[],        -- [1,3,5] = Mon/Wed/Fri (0=Sun)
  add column if not exists recurrence_end_type text,        -- 'never' | 'on_date' | 'after_count'
  add column if not exists recurrence_count   integer;      -- used when end_type = 'after_count'

-- Backfill end_type for existing recurring tasks
update tasks
set recurrence_end_type = case
  when recurrence_until is not null then 'on_date'
  else 'never'
end
where recurring = true
  and recurrence_end_type is null;


-- ─── schedule_tasks ──────────────────────────────────────────────────────────
-- One row per task per day. Created lazily when a schedule day is opened.
-- References the staging schedule row.

create table if not exists schedule_tasks (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references schedules(id) on delete cascade,
  task_id       uuid not null references tasks(id) on delete cascade,
  shift_id      uuid references shifts(id) on delete set null,
  override_notes text,
  slots_needed  integer not null default 1,
  created_at    timestamptz not null default now(),
  unique (schedule_id, task_id)
);

create index if not exists schedule_tasks_schedule_id_idx on schedule_tasks(schedule_id);
create index if not exists schedule_tasks_task_id_idx     on schedule_tasks(task_id);


-- ─── schedule_assignments ────────────────────────────────────────────────────
-- One row per person per task per day.

create table if not exists schedule_assignments (
  id                uuid primary key default gen_random_uuid(),
  schedule_task_id  uuid not null references schedule_tasks(id) on delete cascade,
  user_name         text not null,
  status            text not null default 'Not Started',
  completed_at      timestamptz,
  completion_notes  text,
  created_at        timestamptz not null default now(),
  unique (schedule_task_id, user_name)
);

create index if not exists schedule_assignments_task_id_idx   on schedule_assignments(schedule_task_id);
create index if not exists schedule_assignments_user_name_idx on schedule_assignments(user_name);
