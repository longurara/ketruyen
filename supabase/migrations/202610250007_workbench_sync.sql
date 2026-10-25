-- Additive after 0006. Separate records keep older frontends compatible.
create or replace function public.reader_workbench_valid(k text,v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare t text; s jsonb; fields text[];
begin
  if k is null or k !~ '^(glossary|vocabulary|profile)/[a-zA-Z0-9_-]{1,80}$'
    or split_part(k,'/',2) in ('__proto__','constructor','prototype') then return false; end if;
  if v is null or v='null'::jsonb then return true; end if;
  if jsonb_typeof(v) is distinct from 'object' or v->>'id' is distinct from split_part(k,'/',2)
    or jsonb_typeof(v->'id') is distinct from 'string' or octet_length(v::text)>16384 then return false; end if;
  t:=split_part(k,'/',1);
  if t='profile' then
    s:=v->'settings';
    return coalesce(v-array['id','name','settings']='{}'::jsonb
      and jsonb_typeof(v->'name')='string' and length(btrim(v->>'name')) between 1 and 60
      and length(v->>'name')<=60 and jsonb_typeof(s)='object'
      and s-array['fontSize','lineHeight','fontFamily','theme','imageMode','eink','continuous','tap','layout']='{}'::jsonb
      and jsonb_typeof(s->'fontSize')='number' and (s->>'fontSize')::numeric between 16 and 28
      and jsonb_typeof(s->'lineHeight')='number' and (s->>'lineHeight')::numeric between 1.4 and 2.6
      and s->>'fontFamily' in ('serif','sans','system') and s->>'theme' in ('light','sepia','dark') and s->>'imageMode' in ('color','mono')
      and jsonb_typeof(s->'eink')='boolean' and jsonb_typeof(s->'continuous')='boolean' and jsonb_typeof(s->'tap')='boolean'
      and jsonb_typeof(s->'layout')='object' and (s->'layout')-array['width','margin','gap']='{}'::jsonb
      and jsonb_typeof(s->'layout'->'width')='number' and (s->'layout'->>'width')::numeric between 460 and 1100
      and jsonb_typeof(s->'layout'->'margin')='number' and (s->'layout'->>'margin')::numeric between 12 and 64
      and jsonb_typeof(s->'layout'->'gap')='number' and (s->'layout'->>'gap')::numeric between 0.4 and 2,false);
  end if;
  fields:=array['id','slug','term','meaning','sentence','volIdx','chapIdx','p'];
  if t='vocabulary' then fields:=fields||array['level','due','added']; end if;
  if not coalesce(v-fields='{}'::jsonb
    and jsonb_typeof(v->'slug')='string' and v->>'slug' ~ '^[a-zA-Z0-9_-]{1,100}$'
    and v->>'slug' not in ('__proto__','constructor','prototype')
    and jsonb_typeof(v->'term')='string' and length(btrim(v->>'term')) between 1 and 80 and length(v->>'term')<=80
    and jsonb_typeof(v->'meaning')='string' and length(btrim(v->>'meaning')) between 1 and 1000 and length(v->>'meaning')<=1000
    and jsonb_typeof(v->'sentence')='string' and length(v->>'sentence')<=1200
    and jsonb_typeof(v->'volIdx')='number' and (v->>'volIdx')::numeric between 0 and 3000 and trunc((v->>'volIdx')::numeric)=(v->>'volIdx')::numeric
    and jsonb_typeof(v->'chapIdx')='number' and (v->>'chapIdx')::numeric between 0 and 3000 and trunc((v->>'chapIdx')::numeric)=(v->>'chapIdx')::numeric
    and jsonb_typeof(v->'p')='number' and (v->>'p')::numeric between 0 and 100000 and trunc((v->>'p')::numeric)=(v->>'p')::numeric,false) then return false; end if;
  if t='glossary' then return true; end if;
  return coalesce(jsonb_typeof(v->'level')='number' and (v->>'level')::numeric between 0 and 6 and trunc((v->>'level')::numeric)=(v->>'level')::numeric
    and jsonb_typeof(v->'due')='number' and (v->>'due')::numeric between 0 and 1e15
    and jsonb_typeof(v->'added')='number' and (v->>'added')::numeric between 0 and 1e15,false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.reader_workbench_valid(text,jsonb) from public,anon,authenticated;

create table if not exists public.reader_workbench_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null,
  value jsonb,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(user_id,record_key),
  check(public.reader_workbench_valid(record_key,value))
);
alter table public.reader_workbench_records enable row level security;
revoke all on public.reader_workbench_records from public,anon,authenticated;
grant select on public.reader_workbench_records to authenticated;
grant all on public.reader_workbench_records to service_role;
drop policy if exists reader_workbench_owner on public.reader_workbench_records;
create policy reader_workbench_owner on public.reader_workbench_records for select to authenticated
  using(user_id=(select auth.uid()) and (select public.reader_device_active()));
drop trigger if exists reader_notify_change on public.reader_workbench_records;
create trigger reader_notify_change after insert or update on public.reader_workbench_records
  for each row execute function public.reader_signal_change();

create or replace function public.reader_workbench_apply(changes jsonb)
returns table(record_key text,value jsonb,revision bigint,applied boolean)
language plpgsql security definer set search_path='' as $$
declare item jsonb; expected bigint; saved public.reader_workbench_records; accepted boolean; own uuid; category text; cap integer;
begin
  perform public.reader_require_device(); own:=auth.uid();
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>100 then raise exception 'Invalid workbench batch'; end if;
  -- Serialize per account, including capacity checks and competing device writes.
  perform pg_advisory_xact_lock(hashtextextended('reader-workbench:'||own::text,0));
  for item in select entry from jsonb_array_elements(changes) batch(entry)
    order by case when entry->'value'='null'::jsonb then 0 else 1 end,entry->>'key' loop
    if jsonb_typeof(item->'key') is distinct from 'string' or coalesce(item->>'expected_revision','') !~ '^\d{1,16}$'
      or not(item ? 'value') or not public.reader_workbench_valid(item->>'key',item->'value') then raise exception 'Invalid workbench record'; end if;
    expected:=(item->>'expected_revision')::bigint;
    select r.* into saved from public.reader_workbench_records r where r.user_id=own and r.record_key=item->>'key';
    if coalesce(saved.revision,0)<>expected then
      return query select item->>'key',saved.value,coalesce(saved.revision,0),false;
      continue;
    end if;
    if (saved.revision is null or saved.value is null) and item->'value'<>'null'::jsonb then
      category:=split_part(item->>'key','/',1); cap:=case when category='profile' then 12 else 1000 end;
      if (select count(*) from public.reader_workbench_records r where r.user_id=own and split_part(r.record_key,'/',1)=category and r.value is not null)>=cap then
        raise exception 'Đã đạt giới hạn 1.000 chú giải, 1.000 từ hoặc 12 hồ sơ trên tài khoản. Hãy giảm số mục rồi thử lại.';
      end if;
    end if;
    if expected=0 then
      insert into public.reader_workbench_records as r(user_id,record_key,value) values(own,item->>'key',nullif(item->'value','null'::jsonb)) returning r.* into saved;
    else
      update public.reader_workbench_records as r set value=nullif(item->'value','null'::jsonb),revision=r.revision+1,updated_at=clock_timestamp()
        where r.user_id=own and r.record_key=item->>'key' and r.revision=expected returning r.* into saved;
    end if;
    accepted:=found;
    return query select item->>'key',saved.value,saved.revision,accepted;
  end loop;
end $$;
revoke all on function public.reader_workbench_apply(jsonb) from public,anon,authenticated;
grant execute on function public.reader_workbench_apply(jsonb) to authenticated;
