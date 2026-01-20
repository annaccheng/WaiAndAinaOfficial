-- Capability tagging schema and helpers.
-- Run this in the Supabase SQL editor to create or update capability tables.

create table if not exists capabilities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists user_capabilities (
  user_id uuid references users(id) on delete cascade,
  capability_id uuid references capabilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, capability_id)
);

create table if not exists task_capabilities (
  task_id uuid references tasks(id) on delete cascade,
  capability_id uuid references capabilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, capability_id)
);

create index if not exists user_capabilities_user_id_idx on user_capabilities(user_id);
create index if not exists user_capabilities_capability_id_idx on user_capabilities(capability_id);
create index if not exists task_capabilities_task_id_idx on task_capabilities(task_id);
create index if not exists task_capabilities_capability_id_idx on task_capabilities(capability_id);
