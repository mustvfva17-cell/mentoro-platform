import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  frontend,
  core,
  policies,
  wrappers,
  mentorAdmin,
  verificationBucket,
  submissionFix,
  submissionTimestamp,
] = await Promise.all([
  read('../src/main.js'),
  read('../supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql'),
  read('../supabase/migrations/20261028061834_rls_policy_and_foreign_key_hardening.sql'),
  read('../supabase/migrations/20261028062421_current_user_workflow_wrappers.sql'),
  read('../supabase/migrations/20261028062818_mentor_reviews_and_admin_training_setup.sql'),
  read('../supabase/migrations/20261028093412_harden_trainee_verification_bucket.sql'),
  read('../supabase/migrations/20261028094412_fix_scoped_logbook_submission_rpc.sql'),
  read('../supabase/migrations/20261028093532_enforce_server_submission_timestamp.sql'),
]);

const allSchemaSql = [core, policies, wrappers, mentorAdmin, submissionFix, submissionTimestamp].join('\n');

function functionBody(sql, schema, name) {
  const match = sql.match(new RegExp(
    'CREATE OR REPLACE FUNCTION\\s+' + schema + '\\.' + name +
    '\\s*\\([\\s\\S]*?\\$\\$;',
    'i',
  ));
  assert.ok(match, 'Missing SQL function ' + schema + '.' + name);
  return match[0];
}

function check(label, callback) {
  callback();
  console.log('✓ ' + label);
}

check('Auth provisions a trainee only from the signed-in, email-confirmed identity', () => {
  assert.match(frontend, /supabase\.auth\.signUp\(/);
  assert.match(frontend, /supabase\.auth\.signInWithPassword\(/);
  assert.match(frontend, /supabase\.rpc\(['"]provision_current_trainee['"]/);
  const provision = functionBody(wrappers, 'app_private', 'provision_current_trainee');
  assert.match(provision, /auth\.uid\(\)/);
  assert.match(provision, /email_confirmed_at\s+IS\s+NOT\s+NULL/i);
  assert.match(provision, /public\.provision_trainee_profile/);
});

check('University ID uploads are owner-scoped and constrained on the server', () => {
  assert.match(frontend, /const path = \x60\$\{user\.id\}\//);
  assert.match(frontend, /storage\.from\(['"]trainee-verification['"]\)\.upload\(path,\s*file/);
  assert.match(frontend, /supabase\.rpc\(['"]record_verification_document['"]/);
  assert.match(verificationBucket, /'trainee-verification'[\s\S]*?false[\s\S]*?8388608/);
  assert.match(verificationBucket, /image\/jpeg/);
  assert.match(verificationBucket, /image\/png/);
  assert.match(verificationBucket, /application\/pdf/);

  const recordDocument = functionBody(wrappers, 'app_private', 'record_current_verification_document');
  assert.match(recordDocument, /auth\.uid\(\)/);
  assert.match(recordDocument, /storage\.foldername\(p_object_path\).*?v_actor_id::text/is);
  assert.match(recordDocument, /bucket_id\s*=\s*'trainee-verification'/i);
  assert.match(recordDocument, /account_status\s+IN\s*\('PENDING_VERIFICATION',\s*'REJECTED'\)/i);
});

check('Application submission sends no decision fields and is gated by RLS', () => {
  assert.match(frontend, /if\s*\(!isVerified\)\s*return/);
  const insert = frontend.match(/supabase\.from\(['"]training_applications['"]\)\.insert\(\{([\s\S]*?)\}\)/);
  assert.ok(insert, 'Application submission insert was not found');
  assert.match(insert[1], /trainee_profile_id:\s*user\.id/);
  assert.match(insert[1], /status:\s*['"]SUBMITTED['"]/);
  assert.doesNotMatch(insert[1], /mentor_decision|admin_decision|decision_by|decided_at/i);

  const policy = policies.match(/CREATE POLICY applications_submit_own[\s\S]*?;/i);
  assert.ok(policy, 'Expected the applications_submit_own RLS policy');
  assert.match(policy[0], /trainee_profile_id\s*=\s*\(SELECT auth\.uid\(\)\)/i);
  assert.match(policy[0], /status\s*=\s*'SUBMITTED'/i);
  assert.match(policy[0], /app_private\.is_verified_trainee\(\)/i);
  assert.match(policy[0], /o\.status\s*=\s*'PUBLISHED'/i);
  assert.match(policy[0], /s\.status\s*=\s*'OPEN'/i);
  assert.match(policy[0], /s\.starts_at\s*>\s*now\(\)/i);
  assert.match(policy[0], /tv\.is_assignable\s*=\s*true/i);
});

check('Booking confirmation creates exactly one enrollment and one logbook instance', () => {
  const enrollments = core.match(/CREATE TABLE public\.training_enrollments\s*\([\s\S]*?\n\);/i)?.[0];
  const instances = core.match(/CREATE TABLE public\.logbook_instances\s*\([\s\S]*?\n\);/i)?.[0];
  assert.ok(enrollments, 'training_enrollments schema was not found');
  assert.ok(instances, 'logbook_instances schema was not found');
  assert.match(enrollments, /source_application_id\s+uuid\s+NOT NULL UNIQUE/i);
  assert.match(instances, /enrollment_id\s+uuid\s+NOT NULL UNIQUE/i);

  const confirm = functionBody(core, 'public', 'admin_confirm_application');
  assert.match(confirm, /v_app\.status\s*<>\s*'MENTOR_APPROVED'/i);
  assert.match(confirm, /p\.account_status\s*=\s*'VERIFIED'/i);
  assert.match(confirm, /tv\.status\s*=\s*'PUBLISHED'\s+AND\s+tv\.is_assignable\s*=\s*true/i);
  assert.match(confirm, /INSERT INTO public\.training_enrollments/i);
  assert.match(confirm, /INSERT INTO public\.logbook_instances\s*\(enrollment_id,\s*template_version_id\)/i);
});

check('Logbook entries start as trainee-owned drafts and submit through the scoped RPC', () => {
  assert.match(frontend, /entry_type:\s*'LEARNING_ACTIVITY'/);
  assert.match(frontend, /status:\s*'DRAFT'/);
  assert.match(frontend, /created_by:\s*user\.id/);
  assert.match(frontend, /supabase\.rpc\(['"]set_logbook_entry_submitted['"]/);

  const submit = functionBody(submissionFix, 'public', 'set_logbook_entry_submitted');
  assert.match(submit, /p_actor_id\s+IS DISTINCT FROM\s+auth\.uid\(\)/i);
  assert.match(submit, /app_private\.owns_instance/);
  assert.match(submit, /FOR UPDATE/i);
  assert.match(submit, /SET status\s*=\s*'SUBMITTED'/i);
  assert.doesNotMatch(submit, /updated_at\s*=|submitted_at\s*=/i);
  assert.match(submissionTimestamp, /NEW\.submitted_at\s*:=\s*statement_timestamp\(\)/i);
  assert.match(submissionTimestamp, /CREATE TRIGGER\s+logbook_entry_submission_timestamp/i);
});

check('Mentor decisions are limited to active mentors assigned to the offering', () => {
  const review = functionBody(core, 'public', 'mentor_review_application');
  assert.match(review, /r\.role\s*=\s*'MENTOR'/i);
  assert.match(review, /r\.revoked_at\s+IS\s+NULL/i);
  assert.match(review, /v_mentor_id\s+IS DISTINCT FROM\s+p_actor_id/i);

  const entryReviewPolicy = mentorAdmin.match(/CREATE POLICY entry_reviews_insert_assigned_mentor[\s\S]*?;/i);
  assert.ok(entryReviewPolicy, 'Expected the assigned-mentor entry review policy');
  assert.match(entryReviewPolicy[0], /app_private\.is_assigned_mentor_for_entry\(entry_id\)/i);
  assert.match(entryReviewPolicy[0], /le\.status\s*=\s*'SUBMITTED'/i);
});

check('Verification reviews and booking confirmation require platform-admin authority', () => {
  const verify = functionBody(wrappers, 'app_private', 'admin_review_trainee_verification');
  assert.match(verify, /auth\.uid\(\)/);
  assert.match(verify, /NOT app_private\.is_platform_admin\(\)/i);

  const confirm = functionBody(wrappers, 'app_private', 'admin_confirm_current_application');
  assert.match(confirm, /auth\.uid\(\)/);
  assert.match(confirm, /NOT app_private\.is_platform_admin\(\)/i);
  assert.match(confirm, /public\.admin_confirm_application\(v_actor_id,\s*p_application_id\)/i);
});

check('Every table created by the core schema has row-level security enabled', () => {
  const tables = [...core.matchAll(/CREATE TABLE public\.([a-z_]+)\s*\(/gi)].map((match) => match[1]);
  assert.ok(tables.length >= 17, 'Expected the current 17-table core schema; found ' + tables.length);
  const missing = tables.filter((table) => !new RegExp(
    'ALTER TABLE\\s+public\\.' + table + '\\s+ENABLE ROW LEVEL SECURITY',
    'i',
  ).test(allSchemaSql));
  assert.deepEqual(missing, [], 'Tables missing ENABLE ROW LEVEL SECURITY: ' + missing.join(', '));
});

console.log('Workflow contract checks passed.');
