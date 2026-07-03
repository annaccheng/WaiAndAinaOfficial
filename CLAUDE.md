# CLAUDE.md — Wai and Aina Farm Hub

## Stack

Next.js 14+ App Router · TypeScript strict · Supabase (Postgres + REST) · Tailwind CSS · Custom passcode auth (no Supabase Auth)

---

## Scheduling Module Redesign

This is the active work-in-progress. The goal is to replace the current clunky scheduling UI with a cleaner, more intuitive system while minimizing schema migration.

### Core problems being solved

- Task dock is the wrong mental model — replaced by inline cell search
- Recurring tasks pre-generate hundreds of child rows that drift and break
- No way to represent "this task is scheduled today but unassigned" — you can't have an unassigned row
- Assignment is implicit (task lives inside a person's cell) rather than explicit (task has an assignee)
- Status carries over from one day to the next incorrectly
- Recurring ↔ one-off conversion is painful because of orphaned child rows
- Task list cards are tiny and unsearchable
- Editor modal reveals too much at once

---

## Data Model Decisions

### What stays exactly as-is

- `task_types` — category table, no changes
- `capabilities`, `user_capabilities`, `task_capabilities` — no changes
- `shifts` — stays as the global shift template table
- `schedules` — stays with two-copy staging/live pattern (see Publishing below)
- `animals`, `animal_types`, `animal_genders`, `animal_photos`
- `push_subscriptions`, `push_config`
- `requests`, `request_suggestions`, `request_subscribers`
- `schedule_reports`
- `daily_updates`
- `users`, `user_roles` — no auth changes

### `tasks` table — becomes the task library

All tasks (recurring and one-off) live here. Root rows only — the `parent_task_id` child row pattern is abandoned going forward. Existing child rows are discarded in migration.

**Columns added:**

```sql
recurrence_days     int[]   -- [1,3,5] = Mon/Wed/Fri (0=Sun…6=Sat). null if not weekly.
recurrence_end_type text    -- 'never' | 'on_date' | 'after_count'
recurrence_count    integer -- max occurrences, used when end_type = 'after_count'
```

**Existing recurrence columns kept and reused:**

- `recurring boolean` — true = recurring, false = one-off
- `recurrence_interval integer` — the N in "every N weeks"
- `recurrence_unit text` — now supports 'day' | 'week' | 'month' | 'year' (was day/month/year)
- `recurrence_until date` — used when end_type = 'on_date'

**Columns no longer used (kept for history, ignored in new logic):**

- `parent_task_id` — no longer generating child rows
- `origin_date`, `occurrence_date` — occurrence tracking moves to `schedule_tasks`
- `status` — status moves to `schedule_assignments`
- `comments text[]` — stays for now, structured comments are future work

### NEW: `schedule_tasks`

One row per task per day. Created lazily when a day is opened — never pre-generated.

```sql
create table schedule_tasks (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid references schedules(id) on delete cascade,
  task_id         uuid references tasks(id) on delete cascade,
  shift_id        uuid references shifts(id) on delete set null,
  override_notes  text,
  slots_needed    integer not null default 1,
  created_at      timestamptz not null default now()
);
```

- `shift_id = null` means the task has no shift assigned yet → surfaces in unassigned row
- `slots_needed` is copied from `tasks.person_count` at creation time; definition changes do not propagate to existing rows
- References the **staging** schedule row (admins always edit staging)

### NEW: `schedule_assignments`

One row per person per task per day. The explicit assignment record.

```sql
create table schedule_assignments (
  id               uuid primary key default gen_random_uuid(),
  schedule_task_id uuid references schedule_tasks(id) on delete cascade,
  user_name        text not null,
  status           text not null default 'Not Started',
  completed_at     timestamptz,
  completion_notes text,
  created_at       timestamptz not null default now(),
  unique (schedule_task_id, user_name)
);
```

### DROPPED

- `schedule_cells` — replaced by `schedule_tasks` + `schedule_assignments`
- `schedule_people` — replaced by direct `user_name` on `schedule_assignments` (consistent with how `daily_updates`, `requests`, etc. already reference users by name)

### Migration plan

1. For each `schedule_cells` row: create one `schedule_tasks` row per task in the `tasks[]` array, then one `schedule_assignments` row for that cell's person
2. Discard all `tasks` rows where `parent_task_id IS NOT NULL`
3. Drop `schedule_cells` and `schedule_people`

---

## Lazy Occurrence Generation

**Old model:** Creating a recurring task with `recurrence_until = 2026-12-31` immediately writes a row for every future occurrence into `tasks` (potentially hundreds of rows). Editing "this occurrence" means editing one child row; editing "all future" means bulk-updating child rows. Dates drift and need fix scripts.

**New model:** There is exactly one `tasks` row per recurring task. When an admin opens a day, the server evaluates each recurring task's recurrence rule against that date. If it matches, a `schedule_tasks` row is created for today. Nothing is written for future days until someone opens them.

**Auto-populate logic (on new day open):**
1. Find all `tasks` where `recurring = true` whose recurrence rule matches the target date
2. Check `recurrence_end_type`: if `on_date` and today > `recurrence_until`, skip. If `after_count`, count existing `schedule_tasks` rows for this `task_id`; if >= `recurrence_count`, skip.
3. Create a `schedule_tasks` row for each match (with `slots_needed` copied from `tasks.person_count`)
4. Find the most recent previous `schedule_tasks` row with the same `task_id`
5. Copy its `schedule_assignments` to the new row, resetting `status = 'Not Started'`
6. If no previous occurrence exists, or all previous assignees are inactive: leave unassigned

**Editing scope:** No more "apply to: single / future / all" decision. Editing the `tasks` row affects all future auto-population. Editing a `schedule_tasks` row (via `override_notes`) affects only that day. Straightforward.

---

## Recurrence UI

Google Calendar-style. A preset dropdown for common cases; Custom opens a modal.

**Preset dropdown options:**
- Does not repeat
- Daily
- Weekly on [day] — auto-fills from task's first date
- Monthly on the [nth] [weekday]
- Annually on [date]
- Every weekday (Monday to Friday)
- Custom…

**Custom recurrence modal:**
- Repeat every `N` `[day / week / month / year]`
- Repeat on — day pills (S M T W T F S), multi-select (shown when unit = week)
- Ends:
  - Never
  - On [date picker]
  - After [N] occurrences

---

## Staging / Publishing

**Keep the two-copy model.** The current pattern works and is the right UX fit for a farm tool where the admin deliberately decides when volunteers see the schedule.

- Admin always edits the `staging` row
- Volunteers always see the `live` row
- Publishing = copy staging data to a new `live` row, delete old `live` row, send push notifications
- No `visibility_paused` needed — the staging/live separation already provides mid-edit safety
- `schedules` table unchanged

---

## Unassigned Row

A task appears in the unassigned row (amber, pinned above person rows) when either:
- `schedule_tasks.shift_id IS NULL` (no shift assigned)
- `count(schedule_assignments) < schedule_tasks.slots_needed` (not enough people)

Both conditions are independent and computed — never stored. `slots_filled` is always derived.

Chip badge shows `{filled}/{needed}`. Dragging an unassigned chip to a person cell sets `shift_id` and creates a `schedule_assignment`.

---

## UI Decisions

### Schedule canvas — grid layout

Person rows × shift columns. Unassigned row pinned at top (amber). All active users are always shown as rows — no "add person to today" step needed.

### Inline cell search (replaces the dock entirely)

Click any cell (person × shift intersection) → a small dropdown appears anchored to that cell — not a modal, not a floating panel.

The dropdown:
- Text input at top (auto-focused)
- List of matching tasks from the library, filtered as you type
- Recurring tasks shown first with a blue dot; one-offs below with an amber dot
- "＋ Create new task" option pinned at the bottom

**Selecting an existing task from the dropdown:**
- If no `schedule_tasks` row exists for this task today → create one with `shift_id` = this column's shift, `slots_needed` copied from `tasks.person_count`
- Create a `schedule_assignments` row for this person with `status = 'Not Started'`
- Chip appears in the cell; dropdown closes

**Clicking "＋ Create new task":**
- Opens a creation modal (see below) with the typed search text pre-filled as the name
- Dropdown closes

### Task creation modal

Opens from "Create new task" in the dropdown, or from the task library page.

Fields:
- **Name** (pre-filled from search text)
- **Type toggle**: One-off | Recurring
- **Recurrence rule** (shown only when Recurring): Google Calendar-style preset dropdown + Custom modal (see Recurrence UI section)
- **Shift**: pre-filled from the cell that was clicked; changeable
- **Slots needed**: number input, default 1
- **Task category**: dropdown (Animals, Agriculture, etc.)
- **Instructions / notes**: textarea

On save: creates the `tasks` row in the library, creates a `schedule_tasks` row for today, creates a `schedule_assignments` row for the person whose cell was clicked. If slots_needed > 1, task immediately appears in the unassigned row showing 1/N until more people are assigned.

### Task chips

Each assigned task appears as a chip in the person × shift cell.

- Left dot: blue = recurring, amber = one-off
- Task name (truncated if needed)
- Slot badge (only shown if slots_needed > 1): `1/2` in amber if unfilled, green if full
- **Single click** → task detail popover
- **Right-click** → context menu: Edit, Convert type (recurring ↔ one-off), Copy, Remove from today, Delete task

### Task detail popover

Appears on single-click of a chip. Lightweight — not a full modal.

- Task name
- Shift label
- Assigned people list, each with their status (Not Started / In Progress / Completed)
- Instructions/notes (read-only inline; click to open full editor)
- "Edit task definition" button → opens full editor modal
- "Remove from today" → deletes the `schedule_tasks` row for this day only
- "Delete task" → soft-delete (`archived_at`) on the `tasks` definition row

### Full task editor modal

Opened via "Edit task definition" from the popover, or from the task library page.

- Name
- Type toggle (recurring ↔ one-off) + recurrence rule (same UI as creation)
- Task category
- Slots needed
- Default shift (used as hint for auto-populate; not enforced)
- Instructions / notes
- Capabilities

This edits the **definition** — changes affect future auto-population but not existing `schedule_tasks` rows that are already created for past/current days.

### Copying tasks

- **Right-click chip → Copy**: saves the `task_id` to clipboard state
- **Right-click cell → Paste**: checks if a `schedule_tasks` row exists for that `task_id` today; creates one if not; then creates a `schedule_assignments` row for the target person in the target shift
- This works the same as before, just writing to `schedule_tasks` + `schedule_assignments` instead of `schedule_cells`

### Copy from another day

Modal with a date picker (defaults to yesterday or last occurrence). Copies all `schedule_tasks` rows from the source day's staging schedule to the new day, plus all `schedule_assignments` with status reset to Not Started. Creates the new schedule if it doesn't exist yet. `copied_from_date` set on the new `schedules` row for audit trail.

### Task library / admin task list

Replaces the current `/hub/admin/tasks` page.

- Flat, searchable list (no more two-section Recurring / One-off card grid)
- Filter by type, category, status
- Row shows: name, type dot, category, slots needed, recurrence summary (e.g. "Every Mon/Wed/Fri")
- Click row → opens full task editor modal
- "New task" button → opens creation modal without a pre-selected cell (shift left unset)
- No status column — status is per-assignment, not per-definition

### Volunteer view

- Personal task list for today ordered by shift time
- Left bar color: blue = recurring, amber = one-off
- Status dropdown per task (Not Started → In Progress → Completed) — updates `schedule_assignments.status` for that user
- Tapping a card expands: instructions, notes, completion notes field
- Team tab: all people's task names for today, read-only, current user's row highlighted. No statuses shown for others.

---

## What Breaks and What Doesn't

### Fully removed (intentional)

| Thing | Replacement |
|---|---|
| Task dock (floating panel) | Inline cell search dropdown |
| `schedule_people` table | Active users always shown as rows |
| `schedule_cells` table | `schedule_tasks` + `schedule_assignments` |
| `/api/schedule/people` route | No longer needed |
| Child task rows (`parent_task_id`) | Lazy `schedule_tasks` generation |

### APIs that need rewriting (same purpose, new tables)

| Route | Change needed |
|---|---|
| `/api/schedule/route.ts` | Read `schedule_tasks` + `schedule_assignments` instead of `schedule_cells` + `schedule_people` |
| `/api/schedule/update/route.ts` | Write to `schedule_tasks` + `schedule_assignments` |
| `/api/schedule/publish/route.ts` | Copy `schedule_tasks` + `schedule_assignments` instead of `schedule_cells` + `schedule_people` |
| `/api/tasks/route.ts` | Remove child row generation; add recurrence columns |

### Unaffected — no changes needed

- `daily_updates` table and all its UI — stores taskName + taskId in jsonb; taskId references root tasks which still exist
- `custom_tables` — uses task names as strings, not FKs
- `requests`, `request_suggestions`, `request_subscribers`
- `animals` and all animal pages
- `shifts` table and `/admin/shifts` page
- `user_roles`, `users`, `/admin/users` page
- `task_types`, `capabilities`
- `push_subscriptions` / push notification mechanism
- `schedule_reports`

### Subtle risk: daily updates task IDs

`daily_updates.task_statuses` is a jsonb array of `{taskId, taskName, status}`. Currently, `taskId` might reference child row IDs (the pre-generated occurrence rows). After we drop child rows, those IDs won't resolve to anything in the `tasks` table. **This doesn't break display** — the stored `taskName` is always shown — but task name click-through to the task editor would stop working for historical entries. Going forward, `taskId` should reference root task IDs (which is what `schedule_tasks.task_id` points to), so this self-corrects after migration.

---

## Development Environment

The app uses two env vars to talk to Supabase: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (plus `SUPABASE_PROJECT_REF` and `SUPABASE_MANAGEMENT_TOKEN`). These live in `.env.local` which is gitignored.

**Dev vs. production:** `.env.local` points to the dev Supabase project locally. Production env vars are set separately in Vercel — they are never in `.env.local`, so changing `.env.local` never affects the live app.

**Migration workflow:**
1. Build and test all schema changes on dev first
2. Once verified, run the same additive SQL on production (new tables, new columns only)
3. Deploy new code to production
4. Only drop old tables on production after new code has been running stably for a few days

**What lives in `/supabase/`:** SQL files that represent the full schema. Run these in order on any fresh project (see setup doc). `recurring_occurrence_fix.sql` is a one-time data repair script — skip it on fresh setups.

---

## Out of Scope (This Redesign)

- Auth changes — keep existing passcode system
- Custom tables — already built, keep as-is (V2 bugs noted separately)
- Daily updates — already built, keep as-is
- Push notification changes
- Week overview grid
- Mobile admin view
- Conflict detection / double-booking warnings
