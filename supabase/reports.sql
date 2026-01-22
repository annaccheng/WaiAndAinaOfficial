-- Schedule reports table for analytics snapshots.
-- Run this in the Supabase SQL editor to create/update the report storage table.

create table if not exists schedule_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  date_label text not null,
  report_title text,
  data jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists schedule_reports_report_date_idx on schedule_reports(report_date);
