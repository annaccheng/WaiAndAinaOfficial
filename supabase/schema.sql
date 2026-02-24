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
  goats integer not null default 0,
  best_run integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_name text,
  user_role text,
  device_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_name_idx on push_subscriptions(user_name);
create index if not exists push_subscriptions_user_role_idx on push_subscriptions(user_role);
create index if not exists push_subscriptions_device_id_idx on push_subscriptions(device_id);

create table if not exists push_config (
  id uuid primary key default gen_random_uuid(),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists animal_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default 'default',
  created_at timestamptz not null default now()
);

create table if not exists animal_genders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default 'default',
  created_at timestamptz not null default now()
);

create table if not exists animals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text,
  daily_care_notes text,
  birthday date,
  age_label text,
  age_months integer,
  milking_method text,
  get_milked boolean not null default false,
  breed text,
  behaviors text[] not null default '{}',
  stats jsonb not null default '{}'::jsonb,
  animal_type_id uuid references animal_types(id) on delete set null,
  animal_gender_id uuid references animal_genders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists animal_photos (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid references animals(id) on delete cascade,
  name text,
  path text not null,
  created_at timestamptz not null default now()
);

create index if not exists animal_photos_animal_id_idx on animal_photos(animal_id);

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
  created_by_name text,
  task_help_references text[] not null default '{}',
  occurrence_date date,
  parent_task_id uuid references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_capabilities (
  task_id uuid references tasks(id) on delete cascade,
  capability_id uuid references capabilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, capability_id)
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
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (schedule_id, person_id, shift_id)
);

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
create index if not exists daily_updates_update_date_idx on daily_updates(update_date);
create index if not exists daily_updates_user_name_idx on daily_updates(user_name);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text not null,
  user_name text not null,
  request_type text not null check (request_type in ('App Request', 'Item Request', 'Task Request', 'Other')),
  status text not null default 'In Progress' check (status in ('In Progress', 'Approved', 'Denied')),
  urgent boolean not null default false,
  shareable boolean not null default false,
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists requests_user_name_idx on requests(user_name);
create index if not exists requests_status_idx on requests(status);
create index if not exists requests_updated_at_idx on requests(updated_at desc);

create table if not exists request_suggestions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  author_name text not null,
  content text not null,
  removed boolean not null default false,
  removed_by text,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists request_suggestions_request_id_idx on request_suggestions(request_id);
create index if not exists request_suggestions_created_at_idx on request_suggestions(created_at);

create table if not exists request_subscribers (
  request_id uuid not null references requests(id) on delete cascade,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_name)
);

create index if not exists request_subscribers_user_name_idx on request_subscribers(user_name);
