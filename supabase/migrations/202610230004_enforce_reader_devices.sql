-- Apply ONLY AFTER deploying the frontend that calls reader_device_register.
drop policy if exists reader_require_active_device on public.reader_sync_records;
create policy reader_require_active_device on public.reader_sync_records as restrictive for all to authenticated
  using((select public.reader_device_active())) with check((select public.reader_device_active()));
drop policy if exists reader_require_active_device on public.reader_ebook_transfers;
create policy reader_require_active_device on public.reader_ebook_transfers as restrictive for all to authenticated
  using((select public.reader_device_active()) and (sender_device=public.reader_current_device() or recipient_device is null or recipient_device=public.reader_current_device()))
  with check((select public.reader_device_active()) and sender_device=public.reader_current_device());
drop policy if exists reader_require_active_device on storage.objects;
create policy reader_require_active_device on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'ebook-transfers' or ((select public.reader_device_active()) and exists(
    select 1 from public.reader_ebook_transfers t where name=t.user_id::text||'/'||t.id::text||'/book.zip' and t.user_id=auth.uid())))
  with check(bucket_id<>'ebook-transfers' or ((select public.reader_device_active()) and exists(
    select 1 from public.reader_ebook_transfers t where name=t.user_id::text||'/'||t.id::text||'/book.zip' and t.user_id=auth.uid() and t.sender_device=public.reader_current_device())));
-- Existing definer RPCs must check the session as well as user ownership.
create or replace function public.reader_ebook_received(transfer_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  update public.reader_ebook_transfers set received_at=coalesce(received_at,now()) where id=transfer_id and user_id=auth.uid() and ready and expires_at>now()
    and (recipient_device is null or recipient_device=public.reader_current_device());
  if not found then raise exception 'Transfer expired or unavailable' using errcode='42501'; end if;
end $$;
create or replace function public.reader_ebook_forget(transfer_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.reader_require_device();
  delete from public.reader_ebook_transfers t where id=transfer_id and user_id=auth.uid()
    and(sender_device=public.reader_current_device() or recipient_device is null or recipient_device=public.reader_current_device())
    and not exists(select 1 from storage.objects o where o.bucket_id='ebook-transfers' and o.name=t.user_id::text||'/'||t.id::text||'/book.zip');
  if not found then raise exception 'Remove the temporary object first' using errcode='42501'; end if;
end $$;
drop policy if exists reader_private_presence on realtime.messages;
create policy reader_private_presence on realtime.messages for all to authenticated
  using((select public.reader_device_active()) and realtime.topic()='reader:'||(select auth.uid())::text)
  with check((select public.reader_device_active()) and realtime.topic()='reader:'||(select auth.uid())::text);
