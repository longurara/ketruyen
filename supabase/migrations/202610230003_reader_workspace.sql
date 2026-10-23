-- Preparation migration. Deploy the new frontend before applying 0004.
create table if not exists public.reader_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, device_id uuid not null, name text not null check(length(name) between 1 and 80),
  last_seen timestamptz not null default now(), revoked_at timestamptz, reading jsonb,
  primary key(user_id, session_id), check(reading is null or octet_length(reading::text) <= 4096)
);
create or replace function public.reader_device_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reader_devices d join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
    where d.user_id=auth.uid() and d.session_id=nullif(auth.jwt()->>'session_id','')::uuid and d.revoked_at is null);
$$;
create or replace function public.reader_current_device() returns uuid
language sql stable security definer set search_path = '' as $$
  select device_id from public.reader_devices where user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid and revoked_at is null;
$$;
create or replace function public.reader_require_device() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.reader_device_active() then raise exception 'device-revoked' using errcode='42501'; end if;
end;
$$;
create or replace function public.reader_device_register(installation uuid, label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sid uuid := nullif(auth.jwt()->>'session_id','')::uuid; result public.reader_devices;
begin
  if not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then raise exception 'device-revoked' using errcode='42501'; end if;
  if installation is null or length(trim(label)) not between 1 and 80 then raise exception 'Invalid device'; end if;
  -- A new login may replace this installation's old binding, never its own
  -- revoked binding. An exception rolls the whole registration back.
  update public.reader_devices set revoked_at=now(),reading=null where user_id=auth.uid() and device_id=installation and session_id<>sid and revoked_at is null;
  insert into public.reader_devices(user_id,session_id,device_id,name) values(auth.uid(),sid,installation,
    coalesce((select name from public.reader_devices where user_id=auth.uid() and device_id=installation order by last_seen desc limit 1),trim(label)))
    on conflict(user_id,session_id) do update set last_seen=now() where reader_devices.revoked_at is null returning * into result;
  if result.session_id is null then raise exception 'device-revoked' using errcode='42501'; end if;
  return to_jsonb(result) || jsonb_build_object('server_time',now());
end;
$$;
create or replace function public.reader_device_touch(reading_position jsonb default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if reading_position is not null and (jsonb_typeof(reading_position) is distinct from 'object' or octet_length(reading_position::text)>4096 or coalesce(reading_position->>'slug','') !~ '^[a-zA-Z0-9_-]{1,100}$'
    or jsonb_typeof(reading_position->'anchor') is distinct from 'object' or coalesce(reading_position->>'volIdx','') !~ '^\d+$' or coalesce(reading_position->>'chapIdx','') !~ '^\d+$'
    or coalesce(reading_position->'anchor'->>'block','') !~ '^\d+$' or jsonb_typeof(reading_position->'anchor'->'offset') is distinct from 'number'
    or (reading_position->'anchor'->>'offset')::numeric not between 0 and 1) then raise exception 'Invalid reading position'; end if;
  update public.reader_devices set last_seen=clock_timestamp(), reading=reading_position where user_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid;
  return clock_timestamp();
end;
$$;
create or replace function public.reader_device_manage(target uuid, action text, label text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if action='rename' and length(trim(label)) between 1 and 80 then
    update public.reader_devices set name=trim(label) where user_id=auth.uid() and session_id=target and revoked_at is null;
  elsif action='revoke' then
    update public.reader_devices set revoked_at=now(),reading=null where user_id=auth.uid() and session_id=target;
  elsif action='revoke_others' then
    update public.reader_devices set revoked_at=now(),reading=null where user_id=auth.uid() and session_id<>(auth.jwt()->>'session_id')::uuid and revoked_at is null;
  else raise exception 'Invalid device action'; end if;
end;
$$;
create table if not exists public.reader_workspace_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activity_revision bigint not null default 0, legacy jsonb, legacy_device uuid, cutover_ms bigint,
  check(legacy is null or octet_length(legacy::text)<=1048576)
);
create table if not exists public.reader_activity (
  user_id uuid not null references auth.users(id) on delete cascade, id uuid not null, device_id uuid not null,
  value jsonb not null, revision bigint not null, primary key(user_id,id), check(octet_length(value::text)<=2048)
);
create index if not exists reader_activity_changes on public.reader_activity(user_id,revision);
create or replace function public.reader_activity_upload(events jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare item jsonb; rev bigint; installation uuid; started double precision; ended double precision;
begin
  perform public.reader_require_device(); installation:=public.reader_current_device();
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>100 then raise exception 'Invalid activity batch'; end if;
  -- Serialize writers per account so revisions are also commit-ordered.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  insert into public.reader_workspace_meta(user_id) values(auth.uid()) on conflict do nothing;
  update public.reader_workspace_meta set activity_revision=activity_revision+1 where user_id=auth.uid() returning activity_revision into rev;
  for item in select value from jsonb_array_elements(events) loop
    started:=(item->>'start')::double precision; ended:=(item->>'end')::double precision;
    if coalesce(item->>'kind','') not in ('read','listen','chapter') or coalesce(item->>'slug','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or jsonb_typeof(item->'start') is distinct from 'number' or jsonb_typeof(item->'end') is distinct from 'number'
      or jsonb_typeof(item->'interaction') is distinct from 'number' or item->>'id' is null
      or started is null or ended is null or started<0 or ended<started or ended-started>30000
      or ended>extract(epoch from clock_timestamp())*1000+300000 then raise exception 'Invalid activity'; end if;
    if item->>'kind'='chapter' and (item->>'chapter' is null or length(item->>'chapter')>1024) then raise exception 'Invalid chapter activity'; end if;
    insert into public.reader_activity(user_id,id,device_id,value,revision) values(auth.uid(),(item->>'id')::uuid,installation,item,rev)
    on conflict(user_id,id) do update set value=excluded.value,revision=excluded.revision
      where reader_activity.device_id=installation and reader_activity.value->>'start'=item->>'start'
        and reader_activity.value->>'kind'=item->>'kind' and reader_activity.value->>'slug'=item->>'slug'
        and (reader_activity.value->>'end')::double precision <= ended;
  end loop;
  return rev;
end;
$$;
create or replace function public.reader_import_legacy(snapshot jsonb, cutoff bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(snapshot->'days') is distinct from 'object' or cutoff is null or cutoff<0 or cutoff>extract(epoch from now())*1000+300000 then raise exception 'Invalid legacy snapshot'; end if;
  insert into public.reader_workspace_meta(user_id) values(auth.uid()) on conflict do nothing;
  update public.reader_workspace_meta set legacy=snapshot,legacy_device=public.reader_current_device(),cutover_ms=cutoff where user_id=auth.uid() and legacy is null;
  if not found then raise exception 'legacy-already-imported' using errcode='40001'; end if;
end;
$$;
create table if not exists public.reader_note_versions (
  user_id uuid not null references auth.users(id) on delete cascade, id uuid not null, mark_id text not null,
  value jsonb not null, deleted boolean not null default false, recorded_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '30 days'), revision bigint,
  primary key(user_id,id), check(mark_id ~ '^[a-zA-Z0-9_-]{1,100}$'), check(octet_length(value::text)<=524288)
);
create table if not exists public.reader_note_purges (
  user_id uuid not null references auth.users(id) on delete cascade, mark_id text not null, purged_at timestamptz not null default now(), primary key(user_id,mark_id)
);
create or replace function public.reader_archive_notes(entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare item jsonb; recorded timestamptz;
begin
  perform public.reader_require_device();
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>100 then raise exception 'Invalid note archive'; end if;
  for item in select value from jsonb_array_elements(entries) loop
    recorded:=to_timestamp((item->>'at')::double precision/1000);
    if recorded < now()-interval '30 days' then continue; end if;
    if recorded is null or recorded > now()+interval '5 minutes' or jsonb_typeof(item->'value') is distinct from 'object' or item->'value'->>'id' is distinct from item->>'markId' then raise exception 'Invalid archived note'; end if;
    if exists(select 1 from public.reader_note_purges p where p.user_id=auth.uid() and p.mark_id=item->>'markId'
      and (p.purged_at>=recorded or not exists(select 1 from public.reader_sync_records r where r.user_id=auth.uid() and r.record_key='mark/'||p.mark_id and r.value is not null))) then continue; end if;
    insert into public.reader_note_versions(user_id,id,mark_id,value,deleted,recorded_at,expires_at)
      values(auth.uid(),(item->>'id')::uuid,item->>'markId',item->'value',coalesce((item->>'deleted')::boolean,false),least(recorded,now()),least(recorded,now())+interval '30 days') on conflict do nothing;
  end loop;
end;
$$;
create or replace function public.reader_note_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare change uuid;
begin
  if old.record_key like 'mark/%' and old.value is not null and old.value is distinct from new.value then
    change:=coalesce(nullif(current_setting('reader.mutation_id',true),'')::uuid,gen_random_uuid());
    insert into public.reader_note_versions(user_id,id,mark_id,value,deleted,revision)
      values(old.user_id,change,substr(old.record_key,6),old.value,new.value is null,old.revision) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists reader_archive_before_edit on public.reader_sync_records;
create trigger reader_archive_before_edit before update on public.reader_sync_records for each row execute function public.reader_note_snapshot();
create or replace function public.reader_note_restore(version_id uuid, expected bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.reader_note_versions; result public.reader_sync_records;
begin
  perform public.reader_require_device();
  select * into item from public.reader_note_versions where user_id=auth.uid() and id=version_id and expires_at>now();
  if not found then raise exception 'Note version expired'; end if;
  if expected=0 then
    insert into public.reader_sync_records(user_id,record_key,value) values(auth.uid(),'mark/'||item.mark_id,item.value) on conflict do nothing returning * into result;
  else
    update public.reader_sync_records set value=item.value,revision=revision+1,updated_at=now()
      where user_id=auth.uid() and record_key='mark/'||item.mark_id and revision=expected returning * into result;
  end if;
  if not found then raise exception 'note-conflict' using errcode='40001'; end if;
  insert into public.reader_note_versions(user_id,id,mark_id,value,deleted,revision)
    values(auth.uid(),gen_random_uuid(),item.mark_id,item.value,false,result.revision);
  return to_jsonb(result);
end;
$$;
create or replace function public.reader_note_purge(note_id text, expected bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if expected=0 then
    insert into public.reader_sync_records(user_id,record_key,value) values(auth.uid(),'mark/'||note_id,null) on conflict do nothing;
  else
    update public.reader_sync_records set value=null,revision=revision+1,updated_at=now()
      where user_id=auth.uid() and record_key='mark/'||note_id and revision=expected and value is null;
  end if;
  if not found then raise exception 'note-conflict' using errcode='40001'; end if;
  delete from public.reader_note_versions where user_id=auth.uid() and mark_id=note_id;
  insert into public.reader_note_purges(user_id,mark_id) values(auth.uid(),note_id) on conflict(user_id,mark_id) do update set purged_at=now();
end;
$$;
create table if not exists public.reader_book_requests (
  user_id uuid not null references auth.users(id) on delete cascade,id uuid not null,source_session uuid not null,
  target_device uuid not null,slug text not null check(slug ~ '^ebook-[a-f0-9]{24}$'),resolved boolean not null default false,
  created_at timestamptz not null default now(),primary key(user_id,id)
);
create or replace function public.reader_book_request(source uuid, book text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  if not exists(select 1 from public.reader_devices where user_id=auth.uid() and session_id=source and revoked_at is null) then raise exception 'Source unavailable'; end if;
  insert into public.reader_book_requests(user_id,id,source_session,target_device,slug) values(auth.uid(),gen_random_uuid(),source,public.reader_current_device(),book);
end;
$$;
alter table public.reader_ebook_transfers add column if not exists recipient_device uuid;
grant insert(recipient_device) on public.reader_ebook_transfers to authenticated;
create table if not exists public.reader_signals(user_id uuid primary key references auth.users(id) on delete cascade,version bigint not null default 1);
create or replace function public.reader_signal_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reader_signals(user_id) values(new.user_id) on conflict(user_id) do update set version=reader_signals.version+1;
  return new;
end;
$$;
do $$ declare tbl text; begin
  foreach tbl in array array['reader_devices','reader_activity','reader_workspace_meta','reader_note_versions','reader_note_purges','reader_book_requests','reader_signals'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant select on public.%I to authenticated',tbl);
    execute format('grant all on public.%I to service_role',tbl);
    execute format('drop policy if exists reader_workspace_owner on public.%I',tbl);
    execute format('create policy reader_workspace_owner on public.%I for select to authenticated using(user_id=(select auth.uid()) and (select public.reader_device_active())%s)',tbl,case when tbl='reader_note_versions' then ' and expires_at>now()' else '' end);
    if tbl<>'reader_signals' then
      execute format('drop trigger if exists reader_notify_change on public.%I',tbl);
      execute format('create trigger reader_notify_change after insert or update on public.%I for each row execute function public.reader_signal_change()',tbl);
    end if;
  end loop;
  foreach tbl in array array['reader_sync_records','reader_ebook_transfers'] loop
    execute format('drop trigger if exists reader_notify_change on public.%I',tbl);
    execute format('create trigger reader_notify_change after insert or update on public.%I for each row execute function public.reader_signal_change()',tbl);
  end loop;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reader_signals') then
    alter publication supabase_realtime add table public.reader_signals;
  end if;
end $$;
grant update(resolved) on public.reader_book_requests to authenticated;
drop policy if exists reader_book_request_resolve on public.reader_book_requests;
create policy reader_book_request_resolve on public.reader_book_requests for update to authenticated
  using(user_id=auth.uid() and source_session=(auth.jwt()->>'session_id')::uuid and public.reader_device_active())
  with check(user_id=auth.uid() and source_session=(auth.jwt()->>'session_id')::uuid and public.reader_device_active());
alter table public.reader_sync_records drop constraint if exists reader_sync_records_record_key_check;
alter table public.reader_sync_records add constraint reader_sync_records_record_key_check check(length(record_key)<=300 and record_key ~ '^(progress|chapter|history|favorite|status|groups|mark|goal)/[a-zA-Z0-9_:/-]+$');
-- The existing invoker RPC keeps its CAS contract; pass mutation IDs to the
-- history trigger without putting credentials or history into reading records.
create or replace function public.reader_sync_apply(changes jsonb)
returns table(record_key text,value jsonb,revision bigint,applied boolean)
language plpgsql security invoker set search_path = '' as $$
declare owner uuid:=auth.uid();item jsonb;expected bigint;saved public.reader_sync_records;did_apply boolean;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes)>100 then raise exception 'Invalid sync batch'; end if;
  for item in select entry from jsonb_array_elements(changes) batch(entry) order by entry->>'key' loop
    if jsonb_typeof(item->'key')<>'string' or item->>'expected_revision' !~ '^\d+$' or not(item ? 'value') then raise exception 'Invalid sync record'; end if;
    perform set_config('reader.mutation_id',coalesce(item->>'mutation_id',''),true);
    expected:=(item->>'expected_revision')::bigint;
    if expected=0 then
      insert into public.reader_sync_records as target(user_id,record_key,value) values(owner,item->>'key',nullif(item->'value','null'::jsonb)) on conflict do nothing returning target.* into saved;
    else
      update public.reader_sync_records as target set value=nullif(item->'value','null'::jsonb),revision=target.revision+1,updated_at=now()
        where target.user_id=owner and target.record_key=item->>'key' and target.revision=expected returning target.* into saved;
    end if;
    did_apply:=found;
    if not did_apply then select target.* into saved from public.reader_sync_records target where target.user_id=owner and target.record_key=item->>'key'; end if;
    return query select item->>'key',saved.value,coalesce(saved.revision,0),did_apply;
  end loop;
  perform set_config('reader.mutation_id','',true);
end;
$$;
create or replace function public.reader_workspace_housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reader_note_versions where expires_at<=now();
  delete from public.reader_activity where (value->>'end')::double precision<extract(epoch from now()-interval '366 days')*1000;
  delete from public.reader_book_requests where created_at<now()-interval '30 minutes';
end;
$$;
-- Explicitly grant only public RPCs; trigger functions are not callable APIs.
do $$ declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('reader_device_active','reader_current_device','reader_require_device','reader_device_register','reader_device_touch','reader_device_manage','reader_activity_upload','reader_import_legacy','reader_archive_notes','reader_note_restore','reader_note_purge','reader_book_request','reader_note_snapshot','reader_signal_change','reader_workspace_housekeeping') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    if fn::text not like '%reader_workspace_housekeeping%' and fn::text not like '%reader_note_snapshot%' and fn::text not like '%reader_signal_change%' then execute format('grant execute on function %s to authenticated',fn); end if;
  end loop;
end $$;
grant execute on function public.reader_workspace_housekeeping() to service_role;
