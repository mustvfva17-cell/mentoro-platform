-- Local-first licensed logbook foundation.
-- Public browser roles receive no table or RPC privileges; only the server-side
-- Supabase secret/service role may access this data.

create table public.logbook_licenses (
  id uuid primary key default gen_random_uuid(),
  license_hash text not null unique check (license_hash ~ '^[0-9a-f]{64}$'),
  license_hint text not null check (length(license_hint) between 4 and 12),
  trainee_label text not null check (length(btrim(trainee_label)) between 1 and 120),
  trainee_email text null check (trainee_email is null or length(trainee_email) <= 254),
  specialty_slug text not null references public.specialties(slug),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED','EXPIRED')),
  expires_at timestamptz null,
  device_limit smallint not null default 2 check (device_limit = 2),
  notes text null check (notes is null or length(notes) <= 2000),
  issued_by uuid not null references public.profiles(id),
  revoked_by uuid null references public.profiles(id),
  revoked_at timestamptz null,
  revoke_reason text null check (revoke_reason is null or length(revoke_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'REVOKED') = (revoked_at is not null))
);

create table public.logbook_license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.logbook_licenses(id) on delete restrict,
  installation_hash text not null check (installation_hash ~ '^[0-9a-f]{64}$'),
  device_token_hash text not null unique check (device_token_hash ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz not null default now(),
  last_validated_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references public.profiles(id),
  revoke_reason text null check (revoke_reason is null or length(revoke_reason) <= 500)
);
create unique index logbook_license_devices_one_active_installation
  on public.logbook_license_devices (license_id, installation_hash) where revoked_at is null;
create index logbook_license_devices_active_by_license
  on public.logbook_license_devices (license_id, activated_at desc) where revoked_at is null;

create table public.logbook_license_audit (
  id bigint generated always as identity primary key,
  license_id uuid null references public.logbook_licenses(id) on delete set null,
  device_id uuid null references public.logbook_license_devices(id) on delete set null,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('ISSUED','ACTIVATED','LICENSE_REVOKED','DEVICE_REVOKED','DEVICES_RESET')),
  outcome text not null default 'SUCCESS' check (outcome in ('SUCCESS','DENIED','FAILED')),
  reason text null check (reason is null or length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 4096),
  occurred_at timestamptz not null default now()
);
create index logbook_license_audit_license_time
  on public.logbook_license_audit (license_id, occurred_at desc);

create table public.logbook_license_rate_limits (
  identifier_hash text primary key check (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.logbook_licenses enable row level security;
alter table public.logbook_license_devices enable row level security;
alter table public.logbook_license_audit enable row level security;
alter table public.logbook_license_rate_limits enable row level security;

revoke all on table public.logbook_licenses, public.logbook_license_devices,
  public.logbook_license_audit, public.logbook_license_rate_limits from public, anon, authenticated;
grant all on table public.logbook_licenses, public.logbook_license_devices,
  public.logbook_license_audit, public.logbook_license_rate_limits to service_role;
grant usage, select on sequence public.logbook_license_audit_id_seq to service_role;

create or replace function public.issue_mentoro_license(
  p_license_hash text, p_license_hint text, p_trainee_label text,
  p_trainee_email text, p_specialty_slug text, p_expires_at timestamptz,
  p_notes text, p_issued_by uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_license_id uuid;
begin
  if not exists (
    select 1 from public.profile_roles r where r.user_id = p_issued_by
      and r.role in ('ADMIN','SUPER_ADMIN') and r.revoked_at is null
  ) then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_license_hash !~ '^[0-9a-f]{64}$' or p_license_hint is null
     or p_trainee_label is null or length(btrim(p_trainee_label)) not between 1 and 120
     or (p_trainee_email is not null and length(p_trainee_email) > 254)
     or (p_notes is not null and length(p_notes) > 2000)
     or (p_expires_at is not null and p_expires_at <= pg_catalog.now()) then
    raise exception 'Invalid license details' using errcode = '22023';
  end if;
  if not exists (select 1 from public.specialties s where s.slug = p_specialty_slug and s.is_active) then
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
  insert into public.logbook_license_audit (license_id, actor_profile_id, event_type, metadata)
  values (v_license_id, p_issued_by, 'ISSUED',
    pg_catalog.jsonb_build_object('specialty_slug', p_specialty_slug, 'device_limit', 2));
  return pg_catalog.jsonb_build_object('ok', true, 'license_id', v_license_id);
end; $$;

create or replace function public.activate_mentoro_license(
  p_license_hash text, p_specialty_slug text, p_installation_hash text, p_device_token_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_license_id uuid; v_license_status text; v_expires_at timestamptz;
  v_device_id uuid; v_active_count integer; v_device_limit smallint;
begin
  if p_license_hash !~ '^[0-9a-f]{64}$' or p_installation_hash !~ '^[0-9a-f]{64}$'
     or p_device_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'license_unavailable');
  end if;
  select l.id, l.status, l.expires_at, l.device_limit
  into v_license_id, v_license_status, v_expires_at, v_device_limit
  from public.logbook_licenses l where l.license_hash = p_license_hash for update;
  if not found or v_license_status <> 'ACTIVE'
     or (v_expires_at is not null and v_expires_at <= pg_catalog.now())
     or not exists (select 1 from public.logbook_licenses l
                    where l.id = v_license_id and l.specialty_slug = p_specialty_slug) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'license_unavailable');
  end if;
  select d.id into v_device_id from public.logbook_license_devices d
  where d.license_id = v_license_id and d.installation_hash = p_installation_hash
    and d.revoked_at is null for update;
  if found then
    update public.logbook_license_devices
    set device_token_hash = p_device_token_hash, last_validated_at = pg_catalog.now()
    where id = v_device_id;
    return pg_catalog.jsonb_build_object(
      'ok', true, 'license_id', v_license_id, 'device_id', v_device_id,
      'expires_at', v_expires_at, 'valid_until', pg_catalog.now() + interval '7 days',
      'device_limit', v_device_limit
    );
  end if;
  select count(*)::integer into v_active_count from public.logbook_license_devices d
  where d.license_id = v_license_id and d.revoked_at is null;
  if v_active_count >= v_device_limit then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'device_limit_reached');
  end if;
  insert into public.logbook_license_devices (license_id, installation_hash, device_token_hash)
  values (v_license_id, p_installation_hash, p_device_token_hash)
  returning id into v_device_id;
  insert into public.logbook_license_audit (license_id, device_id, event_type, metadata)
  values (v_license_id, v_device_id, 'ACTIVATED',
    pg_catalog.jsonb_build_object('specialty_slug', p_specialty_slug));
  return pg_catalog.jsonb_build_object(
    'ok', true, 'license_id', v_license_id, 'device_id', v_device_id,
    'expires_at', v_expires_at, 'valid_until', pg_catalog.now() + interval '7 days',
    'device_limit', v_device_limit, 'device_count', v_active_count + 1
  );
end; $$;

create or replace function public.validate_mentoro_license(
  p_device_token_hash text, p_installation_hash text, p_specialty_slug text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_license_id uuid; v_status text; v_expires_at timestamptz;
  v_trainee_label text; v_license_hint text; v_device_id uuid;
begin
  if p_device_token_hash !~ '^[0-9a-f]{64}$' or p_installation_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'license_invalid');
  end if;
  select l.id, l.status, l.expires_at, l.trainee_label, l.license_hint, d.id
  into v_license_id, v_status, v_expires_at, v_trainee_label, v_license_hint, v_device_id
  from public.logbook_license_devices d
  join public.logbook_licenses l on l.id = d.license_id
  where d.device_token_hash = p_device_token_hash and d.installation_hash = p_installation_hash
    and d.revoked_at is null and l.specialty_slug = p_specialty_slug
  for update of d, l;
  if not found or v_status <> 'ACTIVE'
     or (v_expires_at is not null and v_expires_at <= pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'license_invalid');
  end if;
  update public.logbook_license_devices set last_validated_at = pg_catalog.now() where id = v_device_id;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'license_id', v_license_id, 'device_id', v_device_id,
    'trainee_label', v_trainee_label, 'license_hint', v_license_hint,
    'expires_at', v_expires_at, 'valid_until', pg_catalog.now() + interval '7 days'
  );
end; $$;

create or replace function public.consume_mentoro_license_attempt(
  p_identifier_hash text, p_max_attempts integer default 10, p_window_seconds integer default 900
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started_at timestamptz; v_attempts integer;
begin
  if p_identifier_hash !~ '^[0-9a-f]{64}$'
     or p_max_attempts not between 1 and 30 or p_window_seconds not between 60 and 3600 then
    raise exception 'Invalid rate-limit parameters' using errcode = '22023';
  end if;
  insert into public.logbook_license_rate_limits as rl (
    identifier_hash, window_started_at, attempt_count, updated_at
  ) values (p_identifier_hash, pg_catalog.now(), 1, pg_catalog.now())
  on conflict (identifier_hash) do update set
    attempt_count = case
      when rl.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds) then 1
      else rl.attempt_count + 1 end,
    window_started_at = case
      when rl.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds) then pg_catalog.now()
      else rl.window_started_at end,
    updated_at = pg_catalog.now()
  returning window_started_at, attempt_count into v_started_at, v_attempts;
  return pg_catalog.jsonb_build_object(
    'allowed', v_attempts <= p_max_attempts,
    'attempts_remaining', greatest(0, p_max_attempts - v_attempts),
    'retry_after_seconds', greatest(1,
      ceil(extract(epoch from (v_started_at + pg_catalog.make_interval(secs => p_window_seconds) - pg_catalog.now())))::integer)
  );
end; $$;

create or replace function public.revoke_mentoro_license(
  p_license_id uuid, p_actor_profile_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  if not exists (select 1 from public.profile_roles r where r.user_id = p_actor_profile_id
    and r.role in ('ADMIN','SUPER_ADMIN') and r.revoked_at is null) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'A revocation reason is required' using errcode = '22023';
  end if;
  update public.logbook_licenses set status = 'REVOKED', revoked_by = p_actor_profile_id,
    revoked_at = pg_catalog.now(), revoke_reason = btrim(p_reason), updated_at = pg_catalog.now()
  where id = p_license_id and status = 'ACTIVE';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return pg_catalog.jsonb_build_object('ok', false, 'error', 'license_not_active'); end if;
  update public.logbook_license_devices set revoked_at = pg_catalog.now(),
    revoked_by = p_actor_profile_id, revoke_reason = btrim(p_reason)
  where license_id = p_license_id and revoked_at is null;
  insert into public.logbook_license_audit (license_id, actor_profile_id, event_type, reason)
  values (p_license_id, p_actor_profile_id, 'LICENSE_REVOKED', btrim(p_reason));
  return pg_catalog.jsonb_build_object('ok', true);
end; $$;

create or replace function public.reset_mentoro_license_devices(
  p_license_id uuid, p_actor_profile_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  if not exists (select 1 from public.profile_roles r where r.user_id = p_actor_profile_id
    and r.role in ('ADMIN','SUPER_ADMIN') and r.revoked_at is null) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'A device-reset reason is required' using errcode = '22023';
  end if;
  update public.logbook_license_devices set revoked_at = pg_catalog.now(),
    revoked_by = p_actor_profile_id, revoke_reason = btrim(p_reason)
  where license_id = p_license_id and revoked_at is null;
  get diagnostics v_updated = row_count;
  insert into public.logbook_license_audit (
    license_id, actor_profile_id, event_type, reason, metadata
  ) values (p_license_id, p_actor_profile_id, 'DEVICES_RESET', btrim(p_reason),
    pg_catalog.jsonb_build_object('revoked_device_count', v_updated));
  return pg_catalog.jsonb_build_object('ok', true, 'revoked_device_count', v_updated);
end; $$;

revoke all on function public.issue_mentoro_license(text,text,text,text,text,timestamptz,text,uuid) from public, anon, authenticated;
revoke all on function public.activate_mentoro_license(text,text,text,text) from public, anon, authenticated;
revoke all on function public.validate_mentoro_license(text,text,text) from public, anon, authenticated;
revoke all on function public.consume_mentoro_license_attempt(text,integer,integer) from public, anon, authenticated;
revoke all on function public.revoke_mentoro_license(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reset_mentoro_license_devices(uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.issue_mentoro_license(text,text,text,text,text,timestamptz,text,uuid) to service_role;
grant execute on function public.activate_mentoro_license(text,text,text,text) to service_role;
grant execute on function public.validate_mentoro_license(text,text,text) to service_role;
grant execute on function public.consume_mentoro_license_attempt(text,integer,integer) to service_role;
grant execute on function public.revoke_mentoro_license(uuid,uuid,text) to service_role;
grant execute on function public.reset_mentoro_license_devices(uuid,uuid,text) to service_role;
