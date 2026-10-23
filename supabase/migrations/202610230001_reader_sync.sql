-- Run once in the Supabase SQL editor. No service-role key is used by the app.
create table if not exists public.reader_sync_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null check (length(record_key) <= 300 and record_key ~ '^(progress|chapter|history|favorite|status|groups|mark)/[a-zA-Z0-9_:/-]+$'),
  value jsonb check (value is null or octet_length(value::text) <= 524288),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_key)
);
alter table public.reader_sync_records enable row level security;
drop policy if exists reader_sync_select on public.reader_sync_records;
drop policy if exists reader_sync_insert on public.reader_sync_records;
drop policy if exists reader_sync_update on public.reader_sync_records;
create policy reader_sync_select on public.reader_sync_records for select to authenticated using ((select auth.uid()) = user_id);
create policy reader_sync_insert on public.reader_sync_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reader_sync_update on public.reader_sync_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.reader_sync_records from anon, authenticated;
grant select, insert, update on public.reader_sync_records to authenticated;

-- Compare-and-swap: a stale/offline device cannot silently overwrite a newer
-- revision. NULL values are tombstones, retained so deletions reach old devices.
create or replace function public.reader_sync_apply(changes jsonb)
returns table(record_key text, value jsonb, revision bigint, applied boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  item jsonb;
  expected bigint;
  saved public.reader_sync_records%rowtype;
  did_apply boolean;
begin
  if owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 100 then raise exception 'Invalid sync batch'; end if;
  for item in select entry from jsonb_array_elements(changes) as batch(entry) order by entry->>'key' loop
    if jsonb_typeof(item->'key') <> 'string' or item->>'expected_revision' !~ '^[0-9]+$' or not (item ? 'value') then raise exception 'Invalid sync record'; end if;
    expected := (item->>'expected_revision')::bigint;
    if expected = 0 then
      insert into public.reader_sync_records as target(user_id, record_key, value)
      values(owner, item->>'key', nullif(item->'value', 'null'::jsonb))
      on conflict do nothing returning target.* into saved;
    else
      update public.reader_sync_records as target
      set value = nullif(item->'value', 'null'::jsonb), revision = target.revision + 1, updated_at = now()
      where target.user_id = owner and target.record_key = item->>'key' and target.revision = expected
      returning target.* into saved;
    end if;
    did_apply := found;
    if not did_apply then
      select target.* into saved from public.reader_sync_records as target where target.user_id = owner and target.record_key = item->>'key';
    end if;
    return query select item->>'key', saved.value, coalesce(saved.revision, 0), did_apply;
  end loop;
end;
$$;
revoke all on function public.reader_sync_apply(jsonb) from public, anon;
grant execute on function public.reader_sync_apply(jsonb) to authenticated;
