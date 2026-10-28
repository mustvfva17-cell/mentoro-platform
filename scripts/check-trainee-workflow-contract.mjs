import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const compact = (value) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const contains = (source, fragment) => compact(source).includes(compact(fragment));
const checks = [];

function check(name, condition) {
  assert.ok(condition, `Trainee workflow contract failed: ${name}`);
  checks.push(name);
}

const [
  frontend,
  coreSchema,
  accessPolicies,
  applicationPolicyFix,
  currentUserWrappers,
  mentorAdminSetup,
  privateBucket,
  serverTimestamp,
  scopedSubmission,
  submissionTimestampRevocation,
  traineeRoleGuard,
  browserMaintainPrivilege,
  mentorInboxMigration,
  secureMentorInboxMigration,
  logbookReviewMigration
] = await Promise.all([
  read('src/main.js'),
  read('supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql'),
  read('supabase/migrations/20261028061834_rls_policy_and_foreign_key_hardening.sql'),
  read('supabase/migrations/20261028100024_fix_application_offering_slot_binding.sql'),
  read('supabase/migrations/20261028062421_current_user_workflow_wrappers.sql'),
  read('supabase/migrations/20261028062818_mentor_reviews_and_admin_training_setup.sql'),
  read('supabase/migrations/20261028093412_harden_trainee_verification_bucket.sql'),
  read('supabase/migrations/20261028093532_enforce_server_submission_timestamp.sql'),
  read('supabase/migrations/20261028094412_fix_scoped_logbook_submission_rpc.sql'),
  read('supabase/migrations/20261028101524_revoke_submission_timestamp_client_write.sql'),
  read('supabase/migrations/20261028103649_prevent_nontrainee_self_provisioning.sql'),
  read('supabase/migrations/20261028113918_revoke_browser_maintain_privilege.sql'),
  read('supabase/migrations/20261028115852_mentor_scoped_application_inbox.sql'),
  read('supabase/migrations/20261028115928_secure_mentor_inbox_wrapper.sql'),
  read('supabase/migrations/20261028120703_logbook_review_return_workflow.sql')
]);

// Authentication and identity provisioning.
// Frontend-only role/workspace behavior is validated by PR #1; this stacked PR validates the database-side guard below.
// Frontend callsite/role-gate contracts are enforced on PR #1; this branch checks the server-side migration guard.
check('email/password sign-up is implemented', /supabase\.auth\.signUp\s*\(/.test(frontend));
check('email/password sign-in is implemented', /supabase\.auth\.signInWithPassword\s*\(/.test(frontend));
check('frontend uses current-user provisioning RPC', /supabase\.rpc\(['"]provision_current_trainee['"]/.test(frontend));

check('active mentor role routes to the mentor workspace and uses the current-user decision RPC',
  contains(frontend, "roles.has('MENTOR')") &&
  contains(frontend, "if (role === 'MENTOR') return renderMentorDashboard(user);") &&
  /supabase\.rpc\(['"]mentor_review_my_application['"]/.test(frontend) &&
  contains(currentUserWrappers, 'CREATE OR REPLACE FUNCTION public.mentor_review_my_application(') &&
  contains(currentUserWrappers, 'app_private.mentor_review_current_application(p_application_id, p_decision, p_reason)'));

check('mentor application inbox is limited to the authenticated active mentor and assigned offerings',
  contains(mentorInboxMigration, "v_actor_id uuid := auth.uid()") &&
  contains(mentorInboxMigration, "IF v_actor_id IS NULL OR NOT app_private.is_mentor()") &&
  contains(mentorInboxMigration, "WHERE o.mentor_profile_id = v_actor_id") &&
  contains(mentorInboxMigration, "p_limit < 1 OR p_limit > 200") &&
  !contains(mentorInboxMigration, "p.email"));
check('public mentor inbox endpoint uses SECURITY INVOKER and delegates to the private implementation',
  contains(secureMentorInboxMigration, "LANGUAGE sql STABLE SECURITY INVOKER") &&
  contains(secureMentorInboxMigration, "FROM app_private.mentor_list_my_applications(p_limit)") &&
  contains(secureMentorInboxMigration, "REVOKE ALL ON FUNCTION public.mentor_list_my_applications(integer) FROM PUBLIC, anon, service_role"));
check('mentor application cards use the scoped inbox RPC and escape trainee display fields',
  /supabase\.rpc\(['"]mentor_list_my_applications['"]/.test(frontend) &&
  contains(frontend, "esc(item.trainee_name || 'Trainee')") &&
  contains(frontend, "esc(education)") &&
  contains(frontend, "data-mentor-decision=\"APPROVE\""));

check('mentor logbook inbox is scoped to assigned mentor submissions and excludes already-reviewed submissions',
  contains(logbookReviewMigration, 'IF v_actor_id IS NULL OR NOT app_private.is_mentor()') &&
  contains(logbookReviewMigration, 'WHERE e.mentor_profile_id = v_actor_id') &&
  contains(logbookReviewMigration, "AND le.status = 'SUBMITTED'") &&
  contains(logbookReviewMigration, 'le.submitted_at > recent.reviewed_at') &&
  !contains(logbookReviewMigration, 'p.email'));
check('mentor logbook review uses a bounded private definer and an invoker-only public endpoint',
  contains(logbookReviewMigration, 'CREATE OR REPLACE FUNCTION app_private.mentor_review_current_entry') &&
  contains(logbookReviewMigration, 'WHERE le.id = p_entry_id') &&
  contains(logbookReviewMigration, 'AND e.mentor_profile_id = v_actor_id') &&
  contains(logbookReviewMigration, "p_decision NOT IN ('VERIFIED', 'FEEDBACK', 'NEEDS_REVISION')") &&
  contains(logbookReviewMigration, 'CREATE OR REPLACE FUNCTION public.mentor_review_my_entry') &&
  contains(logbookReviewMigration, 'SECURITY INVOKER'));
check('requesting revision returns the entry and requires a feedback note',
  contains(logbookReviewMigration, "p_decision IN ('FEEDBACK', 'NEEDS_REVISION') AND nullif(btrim(p_feedback), '') IS NULL") &&
  contains(logbookReviewMigration, "UPDATE public.logbook_entries SET status = 'RETURNED'"));
check('browser roles cannot directly change logbook submission state or insert review decisions',
  contains(logbookReviewMigration, 'REVOKE UPDATE (status) ON TABLE public.logbook_entries FROM authenticated') &&
  contains(logbookReviewMigration, 'REVOKE INSERT (entry_id, reviewer_profile_id, decision, feedback)') &&
  contains(logbookReviewMigration, 'REVOKE ALL ON FUNCTION public.mentor_review_my_entry(uuid, text, text) FROM PUBLIC, anon, service_role'));
check('resubmission from RETURNED uses a private wrapper and refreshes database timestamp/audit',
  contains(logbookReviewMigration, 'app_private.submit_current_logbook_entry(p_actor_id, p_entry_id)') &&
  contains(logbookReviewMigration, "OLD.status IN ('DRAFT', 'RETURNED') AND NEW.status = 'SUBMITTED'") &&
  contains(logbookReviewMigration, "THEN 'LOGBOOK_ENTRY_RESUBMITTED'") &&
  contains(logbookReviewMigration, "status IN ('DRAFT', 'RETURNED')"));

check('administrator roles are recognized without opening the trainee workspace',
  contains(frontend, "roles.has('SUPER_ADMIN')") &&
  contains(frontend, "roles.has('ADMIN')") &&
  contains(frontend, "return renderAdminWorkspace(user)"));check('database provisioning requires a confirmed auth email', contains(currentUserWrappers, 'u.email_confirmed_at IS NOT NULL'));
check('provisioning derives the identity from auth.uid()', contains(currentUserWrappers, 'v_user_id uuid := auth.uid()'));
check('provisioning creates trainee role and trainee profile', contains(coreSchema, "VALUES (p_user_id, 'TRAINEE')") && contains(coreSchema, 'INSERT INTO public.trainee_profiles (profile_id)'));
check('existing profiles cannot self-provision a TRAINEE role without an active trainee assignment',
  contains(traineeRoleGuard, 'IF EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = v_user_id ) AND NOT EXISTS') &&
  contains(traineeRoleGuard, "r.role = 'TRAINEE'") &&
  contains(traineeRoleGuard, 'r.revoked_at IS NULL') &&
  contains(traineeRoleGuard, 'Account is not assigned to the trainee workspace'));
check('new confirmed identities without a profile can still provision as trainees',
  contains(traineeRoleGuard, 'RETURN public.provision_trainee_profile(v_user_id, v_email, p_full_name)'));

check('PostgreSQL 17+ MAINTAIN privilege is revoked from browser roles on existing public tables',
  contains(browserMaintainPrivilege, 'current_setting(\'server_version_num\')::integer >= 170000') &&
  contains(browserMaintainPrivilege, 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated'));

// University ID verification: client checks are backed by Storage and RPC restrictions.
check('client allows only JPEG, PNG and PDF uploads', contains(frontend, "const allowed = ['image/jpeg', 'image/png', 'application/pdf'];"));
check('client rejects uploads larger than 8 MiB', contains(frontend, 'file.size > 8 * 1024 * 1024'));
check('upload path is namespaced by the signed-in user', contains(frontend, 'const path = `${user.id}/${Date.now()}-${safeName}`;'));
check('verification upload uses the private bucket and records the document via RPC',
  contains(frontend, "storage.from('trainee-verification').upload(path, file") &&
  /supabase\.rpc\(['"]record_verification_document['"]/.test(frontend));
check('Storage bucket enforces private visibility, size and MIME types',
  contains(privateBucket, "'trainee-verification'") &&
  contains(privateBucket, 'false, 8388608') &&
  contains(privateBucket, "ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]"));
check('database binds verification object path to the current user and uploaded object',
  contains(currentUserWrappers, 'storage.foldername(p_object_path))[1] IS DISTINCT FROM v_actor_id::text') &&
  contains(currentUserWrappers, "so.bucket_id = 'trainee-verification'") &&
  contains(currentUserWrappers, 'so.name = p_object_path'));
check('verification upload RLS restricts the first folder to auth.uid()',
  contains(accessPolicies, "CREATE POLICY trainee_verification_upload_own ON storage.objects") &&
  contains(accessPolicies, '(storage.foldername(name))[1] = (SELECT auth.uid())::text'));
check('administrator-only verification review is enforced by the database',
  contains(currentUserWrappers, 'IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  contains(currentUserWrappers, "v_target_status := CASE WHEN p_decision = 'APPROVE' THEN 'VERIFIED' ELSE 'REJECTED' END"));

// Training discovery and applications.
check('frontend only lists published offerings and future open slots',
  contains(frontend, ".eq('status', 'PUBLISHED')") &&
  contains(frontend, "slot.status === 'OPEN' && new Date(slot.starts_at) > new Date()"));
check('unverified trainees cannot apply through the UI',
  contains(frontend, 'if (!isVerified) return;') &&
  contains(frontend, "${isVerified ? 'Apply for training' : 'Verify account to apply'}"));
check('application insert is scoped to the current trainee and starts submitted',
  contains(frontend, 'trainee_profile_id: user.id, offering_id: offeringId, slot_id: slotId, status: \'SUBMITTED\''));
check('database RLS requires verified ownership and submitted status for applications',
  contains(accessPolicies, 'CREATE POLICY applications_submit_own ON public.training_applications') &&
  contains(accessPolicies, 'trainee_profile_id = (SELECT auth.uid())') &&
  contains(accessPolicies, "status = 'SUBMITTED'") &&
  contains(accessPolicies, 'app_private.is_verified_trainee()'));
check('database application policy requires a matching published offering, open future slot and assignable active template',
  contains(accessPolicies, "o.status = 'PUBLISHED'") &&
  contains(accessPolicies, "s.status = 'OPEN'") &&
  contains(accessPolicies, 's.starts_at > now()') &&
  contains(accessPolicies, "tv.status = 'PUBLISHED' AND tv.is_assignable = true") &&
  contains(accessPolicies, 't.is_active = true') &&
  contains(accessPolicies, 't.specialty_id = o.specialty_id'));
check('application RLS explicitly binds the outer application offering and slot IDs',
  contains(applicationPolicyFix, 'WHERE o.id = training_applications.offering_id') &&
  contains(applicationPolicyFix, 'AND s.id = training_applications.slot_id'));

// An independent enrollment/logbook is anchored to the confirmed application and its template version.
// One-to-one PostgREST rendering behavior is validated on the frontend PR; schema uniqueness is checked below.
check('one enrollment per source application is enforced by a unique constraint',
  contains(coreSchema, 'source_application_id uuid NOT NULL UNIQUE'));
check('one logbook instance per enrollment is enforced by a unique constraint',
  contains(coreSchema, 'enrollment_id uuid NOT NULL UNIQUE REFERENCES public.training_enrollments'));
check('confirmed enrollment creation seeds a logbook instance from the selected template version',
  contains(coreSchema, 'public.admin_confirm_application') &&
  contains(coreSchema, 'INSERT INTO public.logbook_instances') &&
  contains(coreSchema, 'template_version_id'));
check('trainee dashboard queries only the current trainee’s enrollments',
  contains(frontend, ".from('training_enrollments')") &&
  contains(frontend, ".eq('trainee_profile_id', user.id)"));

// Logbook draft creation and submission.
check('draft form writes a learning activity owned by the signed-in trainee',
  contains(frontend, ".from('logbook_entries').insert({") &&
  contains(frontend, "entry_type: 'LEARNING_ACTIVITY'") &&
  contains(frontend, "status: 'DRAFT'") &&
  contains(frontend, 'created_by: user.id'));
check('RLS only permits a trainee to insert their own draft into an owned instance',
  contains(accessPolicies, 'CREATE POLICY logbook_entries_insert_own_drafts ON public.logbook_entries') &&
  contains(accessPolicies, "status = 'DRAFT' AND submitted_at IS NULL") &&
  contains(accessPolicies, 'created_by = (SELECT auth.uid())') &&
  contains(accessPolicies, 'app_private.owns_instance(instance_id)'));

check('logbook entry deletion is restricted to owned DRAFT entries',
  contains(accessPolicies, 'CREATE POLICY logbook_entries_delete_own_drafts ON public.logbook_entries') &&
  contains(accessPolicies, 'FOR DELETE TO authenticated') &&
  contains(accessPolicies, "USING (status = 'DRAFT' AND app_private.owns_instance(instance_id))"));
check('submission uses the scoped RPC instead of direct client timestamp writes',
  /supabase\.rpc\(['"]set_logbook_entry_submitted['"]/.test(frontend) &&
  contains(scopedSubmission, "IF p_actor_id IS DISTINCT FROM auth.uid()") &&
  contains(scopedSubmission, 'app_private.owns_instance(le.instance_id)') &&
  contains(scopedSubmission, "UPDATE public.logbook_entries SET status = 'SUBMITTED'"));
check('submission RPC cannot directly update submitted_at or updated_at',
  !/SET[\s\S]{0,160}(submitted_at|updated_at)\s*=/i.test(
    scopedSubmission.match(/CREATE OR REPLACE FUNCTION public\.set_logbook_entry_submitted\([\s\S]*?\$\$;/i)?.[0] || ''
  ));
check('browser role cannot directly update submitted_at',
  /REVOKE UPDATE\s*\(submitted_at\)[\s\S]*?FROM authenticated/i.test(submissionTimestampRevocation));
check('database trigger overwrites submitted_at on the DRAFT-to-SUBMITTED transition',
  contains(serverTimestamp, "IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN") &&
  contains(serverTimestamp, 'NEW.submitted_at := statement_timestamp()') &&
  contains(serverTimestamp, 'BEFORE UPDATE OF status ON public.logbook_entries'));

// Mentor review is limited to the assigned mentor and entries already submitted.
check('mentor review RLS requires the assigned mentor and a submitted entry',
  contains(mentorAdminSetup, 'CREATE POLICY entry_reviews_insert_assigned_mentor ON public.entry_reviews') &&
  contains(mentorAdminSetup, 'reviewer_profile_id = (SELECT auth.uid())') &&
  contains(mentorAdminSetup, 'app_private.is_assigned_mentor_for_entry(entry_id)') &&
  contains(mentorAdminSetup, "le.status = 'SUBMITTED'"));

// Additional authority and schema-wide checks beyond the trainee UI's own happy path.
const adminConfirmCurrent = currentUserWrappers.match(
  /CREATE OR REPLACE FUNCTION app_private\.admin_confirm_current_application\([\s\S]*?\$\$;/i
)?.[0] || '';
const adminConfirmCore = coreSchema.match(
  /CREATE OR REPLACE FUNCTION public\.admin_confirm_application\([\s\S]*?\$\$;/i
)?.[0] || '';
const mentorReviewCore = coreSchema.match(
  /CREATE OR REPLACE FUNCTION public\.mentor_review_application\([\s\S]*?\$\$;/i
)?.[0] || '';

check('current-user booking confirmation verifies platform-admin authority before calling the privileged routine',
  contains(adminConfirmCurrent, 'v_actor_id uuid := auth.uid()') &&
  contains(adminConfirmCurrent, 'IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  contains(adminConfirmCurrent, 'public.admin_confirm_application(v_actor_id, p_application_id)'));
check('booking confirmation itself requires an active administrator and a mentor-approved application',
  contains(adminConfirmCore, "r.role IN ('ADMIN', 'SUPER_ADMIN')") &&
  contains(adminConfirmCore, 'r.revoked_at IS NULL') &&
  contains(adminConfirmCore, "v_app.status <> 'MENTOR_APPROVED'") &&
  contains(adminConfirmCore, "p.account_status = 'VERIFIED'"));
check('application review is restricted to an active mentor assigned to that offering',
  contains(mentorReviewCore, "r.role = 'MENTOR'") &&
  contains(mentorReviewCore, 'r.revoked_at IS NULL') &&
  contains(mentorReviewCore, 'v_mentor_id IS DISTINCT FROM p_actor_id'));
const coreTables = [...coreSchema.matchAll(/CREATE TABLE public\.([a-z_]+)\s*\(/gi)].map((match) => match[1]);
check('all tables in the core schema enable row-level security',
  coreTables.length >= 17 &&
  coreTables.every((table) => new RegExp(
    'ALTER TABLE\\s+public\\.' + table + '\\s+ENABLE ROW LEVEL SECURITY',
    'i',
  ).test(coreSchema)));

console.log(`Trainee workflow contract checks passed: ${checks.length}.`);
for (const name of checks) console.log(`  ✓ ${name}`);
