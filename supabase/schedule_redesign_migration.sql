-- Schedule redesign: data migration from old tables to new
-- Reads from schedule_cells + schedule_people, writes to schedule_tasks + schedule_assignments.
-- Old tables are NOT dropped here — drop them separately after verifying the new data looks correct.
--
-- Run AFTER schedule_redesign_schema.sql.
-- Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.
--
-- ⚠️  On dev: only run this if you have existing schedule_cells data to migrate.
--     If you seeded fresh dev data there's nothing to migrate — skip this file.
-- ⚠️  On prod: run this during the deployment window, before switching to new code.

-- ─── Step 1: schedule_tasks ──────────────────────────────────────────────────
-- For each unique (schedule, task, shift) combination found in schedule_cells,
-- create one schedule_tasks row. If a task appears in multiple people's cells
-- in the same shift on the same day, it still only gets one schedule_tasks row.
-- If a cell task_id references a child occurrence row (parent_task_id not null),
-- we use the root task id instead so schedule_tasks always points to definitions.

insert into schedule_tasks (schedule_id, task_id, shift_id, slots_needed)
select distinct
  sc.schedule_id,
  coalesce(t.parent_task_id, t.id) as task_id,
  sc.shift_id,
  coalesce(
    (select person_count from tasks root where root.id = coalesce(t.parent_task_id, t.id)),
    1
  ) as slots_needed
from schedule_cells sc
cross join lateral unnest(sc.tasks) as cell_task(id_text)
join tasks t on t.id = cell_task.id_text::uuid
where cardinality(sc.tasks) > 0
on conflict (schedule_id, task_id) do nothing;


-- ─── Step 2: schedule_assignments ────────────────────────────────────────────
-- For each person who had a task in their cell, create a schedule_assignments row
-- pointing to the schedule_tasks row we just created.
-- Status is always reset to 'Not Started' — we don't carry over old status.

insert into schedule_assignments (schedule_task_id, user_name, status)
select
  st.id          as schedule_task_id,
  sp.name        as user_name,
  'Not Started'  as status
from schedule_cells sc
join schedule_people sp on sp.id = sc.person_id
cross join lateral unnest(sc.tasks) as cell_task(id_text)
join tasks t on t.id = cell_task.id_text::uuid
join schedule_tasks st
  on st.schedule_id = sc.schedule_id
  and st.task_id = coalesce(t.parent_task_id, t.id)
where cardinality(sc.tasks) > 0
on conflict (schedule_task_id, user_name) do nothing;


-- ─── Verification queries ─────────────────────────────────────────────────────
-- Run these after the migration to sanity-check the data.
-- Uncomment and run manually.

-- Count comparison: schedule_tasks should have one row per unique task per day
-- select count(*) from schedule_tasks;

-- Count comparison: schedule_assignments should have at least one row per cell task
-- select count(*) from schedule_assignments;

-- Check a specific day
-- select
--   st.id,
--   t.name as task_name,
--   s.label as shift,
--   array_agg(sa.user_name) as assigned_to
-- from schedule_tasks st
-- join tasks t on t.id = st.task_id
-- left join shifts s on s.id = st.shift_id
-- left join schedule_assignments sa on sa.schedule_task_id = st.id
-- join schedules sch on sch.id = st.schedule_id
-- where sch.schedule_date = current_date
-- group by st.id, t.name, s.label
-- order by s.label, t.name;
