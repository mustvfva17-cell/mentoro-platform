import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261028151500_owner_only_initial_super_admin_bootstrap.sql', import.meta.url),
  'utf8'
);

function check(condition, message) {
  if (!condition) throw new Error(`Initial admin bootstrap contract failed: ${message}`);
  console.log(`✓ ${message}`);
}

check(
  /CREATE OR REPLACE FUNCTION app_private\.bootstrap_initial_super_admin\(p_confirmed_email text\)/i.test(migration) &&
  !/CREATE OR REPLACE FUNCTION public\.bootstrap_initial_super_admin/i.test(migration),
  'bootstrap exists only in the private schema with no public API wrapper'
);

check(
  /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/i.test(migration) &&
  /LOCK TABLE public\.profile_roles IN EXCLUSIVE MODE/i.test(migration),
  'bootstrap uses a pinned search path and serializes concurrent owner attempts'
);

check(
  /email_confirmed_at IS NOT NULL/i.test(migration) &&
  /v_active_roles <> 1/i.test(migration) &&
  /r\.role = 'TRAINEE'/i.test(migration) &&
  /An active platform administrator already exists/i.test(migration),
  'bootstrap requires a confirmed, single-role trainee and refuses a second active admin'
);

check(
  /public\.verification_documents d WHERE d\.trainee_profile_id = v_user_id/i.test(migration) &&
  /public\.training_applications a WHERE a\.trainee_profile_id = v_user_id/i.test(migration) &&
  /public\.training_enrollments e WHERE e\.trainee_profile_id = v_user_id/i.test(migration),
  'bootstrap refuses to convert accounts that already have verification or training activity'
);

check(
  /UPDATE public\.profile_roles[\s\S]*?revoked_at = statement_timestamp\(\)[\s\S]*?INSERT INTO public\.profile_roles \(user_id, role, granted_by\)[\s\S]*?'SUPER_ADMIN'/i.test(migration) &&
  /INITIAL_SUPER_ADMIN_BOOTSTRAPPED/i.test(migration),
  'bootstrap atomically replaces the unused trainee role and records an audit event'
);

check(
  /REVOKE ALL ON FUNCTION app_private\.bootstrap_initial_super_admin\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/i.test(migration) &&
  /No public wrapper; never grant execution to browser\/API roles/i.test(migration),
  'bootstrap execution is revoked from all browser/API roles'
);

console.log('Owner-only initial administrator bootstrap contracts passed.');
