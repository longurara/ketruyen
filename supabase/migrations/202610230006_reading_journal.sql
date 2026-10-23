-- Additive after 0005. Diary data is permanent metadata, not ebook storage.
create table if not exists public.reader_journal_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null check(record_key ~* '^journal/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  value jsonb, revision bigint not null default 1 check(revision>0), updated_at timestamptz not null default now(),
  primary key(user_id,record_key),
  check(value is null or coalesce(jsonb_typeof(value)='object' and octet_length(value::text)<=262144
    and value->>'id'=substring(record_key from 9) and value->>'kind' in ('run','entry','event') and value->>'slug' ~ '^[a-zA-Z0-9_-]{1,100}$'
    and jsonb_typeof(value->'title')='string' and length(value->>'title') between 1 and 250 and value->>'scope' in ('book','volume'),false))
);
alter table public.reader_journal_records enable row level security;
revoke all on public.reader_journal_records from public,anon,authenticated;
grant select on public.reader_journal_records to authenticated;
grant all on public.reader_journal_records to service_role;
drop policy if exists reader_journal_owner on public.reader_journal_records;
create policy reader_journal_owner on public.reader_journal_records for select to authenticated
  using(user_id=(select auth.uid()) and (select public.reader_device_active()));
drop trigger if exists reader_notify_change on public.reader_journal_records;
create trigger reader_notify_change after insert or update on public.reader_journal_records
  for each row execute function public.reader_signal_change();
create or replace function public.reader_journal_apply(changes jsonb)
returns table(record_key text,value jsonb,revision bigint,applied boolean)
language plpgsql security definer set search_path = '' as $$
declare item jsonb; expected bigint; saved public.reader_journal_records; accepted boolean;
begin
  perform public.reader_require_device();
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>100 then raise exception 'Invalid journal batch'; end if;
  for item in select entry from jsonb_array_elements(changes) batch(entry) order by entry->>'key' loop
    if jsonb_typeof(item->'key') is distinct from 'string' or coalesce(item->>'expected_revision','') !~ '^\d+$' or not(item ? 'value') then raise exception 'Invalid journal record'; end if;
    expected:=(item->>'expected_revision')::bigint;
    if expected=0 then
      insert into public.reader_journal_records as r(user_id,record_key,value) values(auth.uid(),item->>'key',nullif(item->'value','null'::jsonb)) on conflict do nothing returning r.* into saved;
    else
      update public.reader_journal_records as r set value=nullif(item->'value','null'::jsonb),revision=r.revision+1,updated_at=clock_timestamp()
        where r.user_id=auth.uid() and r.record_key=item->>'key' and r.revision=expected returning r.* into saved;
    end if;
    accepted:=found;
    if not accepted then select r.* into saved from public.reader_journal_records r where r.user_id=auth.uid() and r.record_key=item->>'key'; end if;
    return query select item->>'key',saved.value,coalesce(saved.revision,0),accepted;
  end loop;
end $$;
revoke all on function public.reader_journal_apply(jsonb) from public,anon,authenticated;
grant execute on function public.reader_journal_apply(jsonb) to authenticated;

alter table public.reader_ebook_inventory add column if not exists confirmed_at timestamptz not null default now();
alter table public.reader_ebook_inventory add column if not exists labels jsonb not null default '{}';
-- Heartbeats confirm inventory without triggering an endless Realtime loop.
drop trigger if exists reader_notify_change on public.reader_ebook_inventory;
drop trigger if exists reader_inventory_insert on public.reader_ebook_inventory;
drop trigger if exists reader_inventory_update on public.reader_ebook_inventory;
create trigger reader_inventory_insert after insert on public.reader_ebook_inventory for each row execute function public.reader_signal_change();
create trigger reader_inventory_update after update on public.reader_ebook_inventory for each row
  when ((old.slugs,old.ignored,old.enabled,old.labels) is distinct from (new.slugs,new.ignored,new.enabled,new.labels)) execute function public.reader_signal_change();
create or replace function public.reader_ebook_inventory_set(books jsonb, excluded_books jsonb default '[]', active boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare listed jsonb; skipped jsonb;
begin
  perform public.reader_require_device();
  if jsonb_typeof(books) is distinct from 'array' or jsonb_typeof(excluded_books) is distinct from 'array'
    or jsonb_array_length(books)>10000 or jsonb_array_length(excluded_books)>10000 or active is null
    or exists(select 1 from jsonb_array_elements(books||excluded_books) e where jsonb_typeof(e)<>'string' or e#>>'{}' !~ '^ebook-[a-f0-9]{24}$') then raise exception 'Invalid ebook inventory'; end if;
  select coalesce(jsonb_agg(s order by s),'[]'::jsonb) into listed from (select distinct value s from jsonb_array_elements_text(books)) x;
  select coalesce(jsonb_agg(s order by s),'[]'::jsonb) into skipped from (select distinct value s from jsonb_array_elements_text(excluded_books)) x;
  insert into public.reader_ebook_inventory(user_id,device_id,slugs,ignored,enabled) values(auth.uid(),public.reader_current_device(),listed,skipped,active)
    on conflict(user_id,device_id) do update set slugs=excluded.slugs,ignored=excluded.ignored,enabled=excluded.enabled,confirmed_at=clock_timestamp(),
      updated_at=case when (reader_ebook_inventory.slugs,reader_ebook_inventory.ignored,reader_ebook_inventory.enabled) is distinct from (excluded.slugs,excluded.ignored,excluded.enabled) then clock_timestamp() else reader_ebook_inventory.updated_at end;
end $$;
create or replace function public.reader_ebook_inventory_labels(titles jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if jsonb_typeof(titles) is distinct from 'object' or octet_length(titles::text)>5242880 then raise exception 'Invalid ebook titles'; end if;
  if exists(select 1 from jsonb_each(titles) x where x.key !~ '^ebook-[a-f0-9]{24}$' or jsonb_typeof(x.value) is distinct from 'object'
    or jsonb_typeof(x.value->'title') is distinct from 'string' or length(x.value->>'title') not between 1 and 250
    or jsonb_typeof(x.value->'author') is distinct from 'string' or length(x.value->>'author')>150) then raise exception 'Invalid ebook titles'; end if;
  update public.reader_ebook_inventory set labels=titles where user_id=auth.uid() and device_id=public.reader_current_device() and labels is distinct from titles;
end $$;
revoke all on function public.reader_ebook_inventory_labels(jsonb) from public,anon,authenticated;
grant execute on function public.reader_ebook_inventory_labels(jsonb) to authenticated;
