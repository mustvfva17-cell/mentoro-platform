-- Enforce one active phone per MENTORO standalone logbook license.
-- Stop rather than disconnect a license already active on multiple phones.
do $$
declare
  v_multi_device_licenses integer;
begin
  select count(*)::integer into v_multi_device_licenses
  from (
    select l.id
    from public.logbook_licenses l
    join public.logbook_license_devices d
      on d.license_id = l.id and d.revoked_at is null
    where l.status = 'ACTIVE'
    group by l.id
    having count(*) > 1
  ) active_multi_device;

  if v_multi_device_licenses > 0 then
    raise exception
      'Single-device migration stopped: % active license(s) currently have more than one phone. Resolve these explicitly before applying.',
      v_multi_device_licenses;
  end if;
end;
$$;

alter table public.logbook_licenses
  drop constraint if exists logbook_licenses_device_limit_check;

update public.logbook_licenses
set device_limit = 1,
    updated_at = pg_catalog.now()
where device_limit <> 1;

alter table public.logbook_licenses
  alter column device_limit set default 1;

alter table public.logbook_licenses
  add constraint logbook_licenses_device_limit_check
  check (device_limit = 1);

create or replace function public.issue_mentoro_license(
  p_license_hash text,
  p_license_hint text,
  p_trainee_label text,
  p_trainee_email text,
  p_specialty_slug text,
  p_expires_at timestamptz,
  p_notes text,
  p_issued_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
begin
  if not exists (
    select 1 from public.profile_roles r
    where r.user_id = p_issued_by
      and r.role in ('ADMIN','SUPER_ADMIN')
      and r.revoked_at is null
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_license_hash !~ '^[0-9a-f]{64}$'
     or p_license_hint is null
     or p_trainee_label is null
     or length(btrim(p_trainee_label)) not between 1 and 120
     or (p_trainee_email is not null and length(p_trainee_email) > 254)
     or (p_notes is not null and length(p_notes) > 2000)
     or (p_expires_at is not null and p_expires_at <= pg_catalog.now()) then
    raise exception 'Invalid license details' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.specialties s
    where s.slug = p_specialty_slug and s.is_active
  ) then
    raise exception 'Specialty is not available' using errcode = '22023';
  end if;

  insert into public.logbook_licenses (
    license_hash, license_hint, trainee_label, trainee_email,
    specialty_slug, expires_at, notes, issued_by
  ) values (
    p_license_hash, p_license_hint, btrim(p_trainee_label),
    nullif(lower(btrim(p_trainee_email)), ''), p_specialty_slug,
    p_expires_at, nullif(btrim(p_notes), ''), p_issued_by
  ) returning id into v_license_id;

  insert into public.logbook_license_audit (
    license_id, actor_profile_id, event_type, metadata
  ) values (
    v_license_id, p_issued_by, 'ISSUED',
    pg_catalog.jsonb_build_object('specialty_slug', p_specialty_slug, 'device_limit', 1)
  );

  return pg_catalog.jsonb_build_object('ok', true, 'license_id', v_license_id);
end;
$$;
