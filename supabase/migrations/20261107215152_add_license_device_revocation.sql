-- Allow an administrator to revoke one device activation without
-- resetting the other device attached to the same license.
create or replace function public.revoke_mentoro_license_device(
  p_license_id uuid,
  p_device_id uuid,
  p_actor_profile_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  if not exists (
    select 1 from public.profile_roles r
    where r.user_id = p_actor_profile_id
      and r.role in ('ADMIN','SUPER_ADMIN')
      and r.revoked_at is null
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'A device-revocation reason is required' using errcode = '22023';
  end if;

  update public.logbook_license_devices
  set revoked_at = pg_catalog.now(),
      revoked_by = p_actor_profile_id,
      revoke_reason = btrim(p_reason)
  where id = p_device_id
    and license_id = p_license_id
    and revoked_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'device_not_active');
  end if;

  insert into public.logbook_license_audit (
    license_id, device_id, actor_profile_id, event_type, reason
  ) values (
    p_license_id, p_device_id, p_actor_profile_id, 'DEVICE_REVOKED', btrim(p_reason)
  );

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.revoke_mentoro_license_device(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.revoke_mentoro_license_device(uuid,uuid,uuid,text)
  to service_role;
