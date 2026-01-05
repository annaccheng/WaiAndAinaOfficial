create extension if not exists "pgcrypto";

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  user_role_id uuid references user_roles(id) on delete set null,
  phone_number text,
  passcode text not null,
  last_online timestamptz,
  active boolean not null default true,
  capabilities text[] not null default '{}',
  likes text[] not null default '{}',
  dislikes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into user_roles (name)
values
  ('Admin'),
  ('Volunteer'),
  ('Inactive Volunteer'),
  ('External Volunteer')
on conflict (name) do nothing;

insert into users (display_name, user_role_id, phone_number, passcode)
select
  'Colten Lewis',
  user_roles.id,
  null,
  'WAIANDAINA'
from user_roles
where user_roles.name = 'Admin'
on conflict do nothing;

create table if not exists task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'Not Started',
  task_type_id uuid references task_types(id) on delete set null,
  estimated_time text,
  time_slots text[] not null default '{}',
  extra_notes text[] not null default '{}',
  recurring boolean not null default false,
  recurrence_interval integer,
  recurrence_unit text,
  recurrence_until date,
  origin_date date,
  priority text not null default 'Medium',
  links text[] not null default '{}',
  comments text[] not null default '{}',
  person_count integer,
  photos text[] not null default '{}',
  occurrence_date date,
  parent_task_id uuid references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into task_types (name, color)
values
  ('Animals', 'green'),
  ('Agriculture', 'yellow'),
  ('Construction', 'orange'),
  ('Food', 'red'),
  ('Organization', 'blue'),
  ('Business Development', 'purple'),
  ('Landscaping', 'emerald'),
  ('Maintenance', 'gray')
on conflict (name) do nothing;

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  time_range text,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  state text not null default 'staging',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_date, state)
);

create table if not exists schedule_people (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references schedules(id) on delete cascade,
  name text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  unique (schedule_id, name)
);

create table if not exists schedule_cells (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references schedules(id) on delete cascade,
  person_id uuid references schedule_people(id) on delete cascade,
  shift_id uuid references shifts(id) on delete cascade,
  tasks text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  unique (schedule_id, person_id, shift_id)
);

insert into shifts (label, time_range, order_index)
values
  ('Breakfast', '10:30-11:30', 1),
  ('Lunch', '2:30-3:30', 2),
  ('Dinner', null, 3),
  ('Morning Shift 1', '7:30-9:00', 4),
  ('Morning Shift 2', '9:00-10:30', 5),
  ('Noon Shift 1', '11:30-1:00', 6),
  ('Noon Shift 2', '1:00-2:30', 7),
  ('Afternoon Shift 1', '3:30-4:00', 8),
  ('Afternoon Shift 2', '4:00-6:30', 9),
  ('Evening Shift', null, 10),
  ('Weekend Saturday Morning', null, 11),
  ('Weekend Saturday Evening', null, 12),
  ('Weekend Sunday Morning', null, 13),
  ('Weekend Sunday Evening', null, 14)
on conflict do nothing;
