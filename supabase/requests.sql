-- Request workflow: public request creation, admin review, and shareable suggestions.

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

-- Optional helper trigger to keep updated_at fresh.
create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists requests_set_updated_at on requests;
create trigger requests_set_updated_at
before update on requests
for each row execute function set_updated_at_timestamp();

drop trigger if exists request_suggestions_set_updated_at on request_suggestions;
create trigger request_suggestions_set_updated_at
before update on request_suggestions
for each row execute function set_updated_at_timestamp();
