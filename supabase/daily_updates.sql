-- Daily user updates table (status review + notes + requests)
-- Run in Supabase SQL editor.

create table if not exists daily_updates (
  id uuid primary key default gen_random_uuid(),
  update_date date not null,
  user_name text not null,
  task_statuses jsonb not null default '[]'::jsonb,
  extra_notes text,
  requests text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists daily_updates_date_user_uidx
  on daily_updates(update_date, user_name);

create index if not exists daily_updates_update_date_idx
  on daily_updates(update_date);

create index if not exists daily_updates_user_name_idx
  on daily_updates(user_name);
