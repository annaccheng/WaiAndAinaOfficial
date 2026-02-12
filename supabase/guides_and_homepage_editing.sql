-- Guides + homepage editing schema
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content_markdown text not null default '',
  is_restricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists guides_set_updated_at on public.guides;
create trigger guides_set_updated_at
before update on public.guides
for each row
execute procedure public.set_updated_at();

-- homepage editing storage
do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'site_content'
  ) then
    create table public.site_content (
      id uuid primary key default gen_random_uuid(),
      key text not null unique,
      content jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  end if;
end $$;

drop trigger if exists site_content_set_updated_at on public.site_content;
create trigger site_content_set_updated_at
before update on public.site_content
for each row
execute procedure public.set_updated_at();

insert into public.site_content (key, content)
values (
  'homepage',
  jsonb_build_object(
    'heroTitle', 'Sustainable Living, Ag Education, Conservation',
    'heroSubtitle', 'Step into Wai & Aina''s world of regenerative farming, joyful animals, and hands-on learning.',
    'aboutText', 'We grow papaya, dragonfruit, mango, ulu, coffee, cacao, lilikoi, starfruit, rollinia, lychee, and oranges.'
  )
)
on conflict (key) do nothing;
