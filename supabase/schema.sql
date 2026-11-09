-- V1.1 project storage
-- Immutable confirmed project snapshots only.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  project_version integer not null check (project_version >= 1),
  profile text not null,
  status text not null check (status = 'CONFIRMED'),
  engine_version text not null,
  confirmed_at timestamptz not null,
  snapshot jsonb not null,
  checksum text not null check (checksum ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz not null default now(),

  constraint projects_project_code_version_key
    unique (project_code, project_version)
);

create index if not exists projects_created_at_idx
  on public.projects (created_at desc);

create index if not exists projects_project_code_idx
  on public.projects (project_code);

alter table public.projects enable row level security;

-- No browser/client policy is created.
-- Netlify Function uses the server-only Supabase service role key.

create or replace function public.prevent_projects_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Confirmed project snapshots are immutable';
end;
$$;

drop trigger if exists projects_immutable_update_delete on public.projects;

create trigger projects_immutable_update_delete
before update or delete on public.projects
for each row
execute function public.prevent_projects_mutation();
