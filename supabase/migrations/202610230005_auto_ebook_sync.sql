-- Additive: apply after 0004. Temporary files use the existing bucket and cleanup job.
create table if not exists public.reader_ebook_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null, slugs jsonb not null default '[]', ignored jsonb not null default '[]',
  enabled boolean not null default true, updated_at timestamptz not null default now(),
  primary key(user_id,device_id),
  check(jsonb_typeof(slugs)='array' and jsonb_typeof(ignored)='array' and octet_length(slugs::text)+octet_length(ignored::text)<=1048576)
);
alter table public.reader_ebook_inventory enable row level security;
revoke all on public.reader_ebook_inventory from anon,authenticated;
grant select on public.reader_ebook_inventory to authenticated;
grant all on public.reader_ebook_inventory to service_role;
drop policy if exists reader_inventory_owner on public.reader_ebook_inventory;
create policy reader_inventory_owner on public.reader_ebook_inventory for select to authenticated
  using(user_id=(select auth.uid()) and (select public.reader_device_active()));
drop trigger if exists reader_notify_change on public.reader_ebook_inventory;
create trigger reader_notify_change after insert or update on public.reader_ebook_inventory
  for each row execute function public.reader_signal_change();

create or replace function public.reader_ebook_inventory_set(books jsonb, excluded_books jsonb default '[]', active boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare listed jsonb; skipped jsonb;
begin
  perform public.reader_require_device();
  if jsonb_typeof(books) is distinct from 'array' or jsonb_typeof(excluded_books) is distinct from 'array'
    or jsonb_array_length(books)>10000 or jsonb_array_length(excluded_books)>10000 or active is null
    or exists(select 1 from jsonb_array_elements(books||excluded_books) e where jsonb_typeof(e)<>'string' or e#>>'{}' !~ '^ebook-[a-f0-9]{24}$') then
    raise exception 'Invalid ebook inventory';
  end if;
  select coalesce(jsonb_agg(s order by s),'[]'::jsonb) into listed from (select distinct value s from jsonb_array_elements_text(books)) x;
  select coalesce(jsonb_agg(s order by s),'[]'::jsonb) into skipped from (select distinct value s from jsonb_array_elements_text(excluded_books)) x;
  insert into public.reader_ebook_inventory(user_id,device_id,slugs,ignored,enabled) values(auth.uid(),public.reader_current_device(),listed,skipped,active)
    on conflict(user_id,device_id) do update set slugs=excluded.slugs,ignored=excluded.ignored,enabled=excluded.enabled,updated_at=now()
    where (reader_ebook_inventory.slugs,reader_ebook_inventory.ignored,reader_ebook_inventory.enabled) is distinct from (excluded.slugs,excluded.ignored,excluded.enabled);
end $$;

alter table public.reader_ebook_transfers add column if not exists automatic boolean not null default false;
create unique index if not exists reader_one_auto_ebook on public.reader_ebook_transfers(user_id,recipient_device,slug)
  where automatic and received_at is null;

create or replace function public.reader_ebook_auto_reserve(book text,label text,size bigint,digest text,target uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reserved uuid; source uuid;
begin
  perform public.reader_require_device(); source:=public.reader_current_device();
  if target=source or target is null then return null; end if;
  if not exists(select 1 from public.reader_ebook_inventory i where i.user_id=auth.uid() and i.device_id=source and i.enabled and i.slugs ? book)
    or not exists(select 1 from public.reader_ebook_inventory i join public.reader_devices d on d.user_id=i.user_id and d.device_id=i.device_id
      join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
      where i.user_id=auth.uid() and i.device_id=target and i.enabled and not(i.slugs ? book) and not(i.ignored ? book)
        and d.revoked_at is null and d.last_seen>now()-interval '90 seconds') then return null; end if;
  insert into public.reader_ebook_transfers(id,user_id,sender_device,recipient_device,slug,title,bytes,sha256,automatic)
    values(gen_random_uuid(),auth.uid(),source,target,book,label,size,digest,true) on conflict do nothing returning id into reserved;
  return reserved;
end $$;

-- Publish the durable receipt and inventory together. Peers cannot resend in
-- the gap between removing a temporary transfer and the next browser heartbeat.
create or replace function public.reader_ebook_received(transfer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare saved text;
begin
  perform public.reader_require_device();
  update public.reader_ebook_transfers set received_at=coalesce(received_at,now())
    where id=transfer_id and user_id=auth.uid() and ready and expires_at>now()
      and (recipient_device is null or recipient_device=public.reader_current_device()) returning slug into saved;
  if not found then raise exception 'Transfer expired or unavailable' using errcode='42501'; end if;
  insert into public.reader_ebook_inventory(user_id,device_id,slugs) values(auth.uid(),public.reader_current_device(),jsonb_build_array(saved))
    on conflict(user_id,device_id) do update set slugs=case when reader_ebook_inventory.slugs ? saved then reader_ebook_inventory.slugs else reader_ebook_inventory.slugs||jsonb_build_array(saved) end,updated_at=now();
end $$;
revoke all on function public.reader_ebook_inventory_set(jsonb,jsonb,boolean),public.reader_ebook_auto_reserve(text,text,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.reader_ebook_inventory_set(jsonb,jsonb,boolean),public.reader_ebook_auto_reserve(text,text,bigint,text,uuid) to authenticated;
