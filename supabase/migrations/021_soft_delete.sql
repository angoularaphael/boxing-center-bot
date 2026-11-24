-- Soft delete (meme projet que gestion-manager / Infobox).

create table if not exists public.deleted_records (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id text not null,
  payload jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by text
);

create index if not exists deleted_records_source_idx
  on public.deleted_records (source_table, source_id, deleted_at desc);

alter table public.deleted_records enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'portet_clients',
    'managers',
    'boxeurs',
    'promoteurs',
    'app_users',
    'outbound_messages'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    end if;
  end loop;
end $$;
