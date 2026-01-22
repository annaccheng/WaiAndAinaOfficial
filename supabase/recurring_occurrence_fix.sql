-- Fix recurring occurrences that had their occurrence_date overwritten to the same value.
-- This script recalculates occurrence_date for child rows using the series root's
-- origin_date + (row_number * recurrence_interval), ordered by created_at.
--
-- ✅ Review the SELECT preview first, then run the UPDATE.
--
-- Assumptions:
-- - Series roots have parent_task_id IS NULL and recurring = true.
-- - Child occurrences have parent_task_id = series root id.
-- - The bug set child occurrence_date to the same value as the root's occurrence_date.

-- Preview the rows that will be updated.
with series as (
  select
    root.id as root_id,
    coalesce(root.origin_date, root.occurrence_date) as root_date,
    coalesce(root.recurrence_interval, 1) as interval,
    coalesce(root.recurrence_unit, 'day') as unit
  from tasks root
  where root.parent_task_id is null
    and root.recurring = true
    and root.occurrence_date is not null
),
ordered_children as (
  select
    child.id as child_id,
    child.parent_task_id as root_id,
    row_number() over (
      partition by child.parent_task_id
      order by child.created_at, child.id
    ) as occurrence_index
  from tasks child
  where child.parent_task_id is not null
),
targets as (
  select
    oc.child_id,
    s.root_id,
    s.root_date,
    s.interval,
    s.unit,
    case
      when s.unit = 'month' then s.root_date + (oc.occurrence_index * s.interval || ' months')::interval
      when s.unit = 'year' then s.root_date + (oc.occurrence_index * s.interval || ' years')::interval
      else s.root_date + (oc.occurrence_index * s.interval || ' days')::interval
    end as next_date
  from ordered_children oc
  join series s on s.root_id = oc.root_id
)
select
  t.child_id,
  t.root_id,
  t.root_date,
  t.interval,
  t.unit,
  t.next_date::date as new_occurrence_date
from targets t
join tasks child on child.id = t.child_id
join tasks root on root.id = t.root_id
where child.occurrence_date = root.occurrence_date
order by t.root_id, t.new_occurrence_date;

-- Apply the fix. Uncomment to run.
-- with series as (
--   select
--     root.id as root_id,
--     coalesce(root.origin_date, root.occurrence_date) as root_date,
--     coalesce(root.recurrence_interval, 1) as interval,
--     coalesce(root.recurrence_unit, 'day') as unit
--   from tasks root
--   where root.parent_task_id is null
--     and root.recurring = true
--     and root.occurrence_date is not null
-- ),
-- ordered_children as (
--   select
--     child.id as child_id,
--     child.parent_task_id as root_id,
--     row_number() over (
--       partition by child.parent_task_id
--       order by child.created_at, child.id
--     ) as occurrence_index
--   from tasks child
--   where child.parent_task_id is not null
-- ),
-- targets as (
--   select
--     oc.child_id,
--     s.root_id,
--     s.root_date,
--     s.interval,
--     s.unit,
--     case
--       when s.unit = 'month' then s.root_date + (oc.occurrence_index * s.interval || ' months')::interval
--       when s.unit = 'year' then s.root_date + (oc.occurrence_index * s.interval || ' years')::interval
--       else s.root_date + (oc.occurrence_index * s.interval || ' days')::interval
--     end as next_date
--   from ordered_children oc
--   join series s on s.root_id = oc.root_id
-- )
-- update tasks as child
-- set occurrence_date = targets.next_date::date
-- from targets
-- join tasks root on root.id = targets.root_id
-- where child.id = targets.child_id
--   and child.occurrence_date = root.occurrence_date;
