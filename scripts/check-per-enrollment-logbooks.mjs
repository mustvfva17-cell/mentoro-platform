import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  policy,
  context,
  registry,
  main,
  admin,
  migration
] = await Promise.all([
  read('../src/logbooks/provisioning-policy.js'),
  read('../src/logbooks/logbook-context.js'),
  read('../src/logbooks/module-registry.js'),
  read('../src/main.js'),
  read('../src/admin-workspace.js'),
  read('../supabase/migrations/20261102100000_restore_enrollment_owned_logbooks.sql')
]);

function check(condition, message) {
  if (!condition) throw new Error(`Per-enrollment logbook contract failed: ${message}`);
  console.log(`✓ ${message}`);
}

check(
  policy.includes('cardinality: "one_per_enrollment"') &&
  policy.includes('enrollmentRequiredForVisibility: true') &&
  policy.includes('repeatAssignment: "new_enrollment_creates_new_logbook"') &&
  policy.includes('activation: "atomic_with_enrollment"') &&
  !policy.includes('one_per_trainee_per_specialty'),
  'provisioning policy requires one independent logbook per enrollment'
);

check(
  context.includes('"enrollmentId"') &&
  context.includes('enrollmentId: input.enrollmentId') &&
  !context.includes('enrollmentId: input.enrollmentId ?? null'),
  'runtime logbook context requires an enrollment identifier'
);

check(
  registry.includes('linked to that trainee\'s specific training enrollment') &&
  !registry.includes('trainee_specialty_logbook'),
  'specialty registration documentation describes enrollment-owned access'
);

check(
  !main.includes('assignedLogbookCard') &&
  !main.includes('assignedLogbooksResult') &&
  !main.includes("supabase.from('logbook_instances').select("),
  'trainee workspace no longer loads direct-to-profile orphan logbooks'
);

check(
  main.includes('!isUuid(enrollmentId)') &&
  main.includes('data-enrollment-id="\' + esc(enrollment.id) + \'" data-html-path') &&
  main.includes('enrollmentId: button.dataset.enrollmentId'),
  'HTML logbook windows require and propagate their enrollment context for trainees and mentors'
);

check(
  migration.includes('WHERE enrollment_id IS NULL') &&
  migration.includes('L-43 migration blocked') &&
  migration.includes('ALTER COLUMN enrollment_id SET NOT NULL') &&
  migration.includes('DROP COLUMN IF EXISTS trainee_profile_id') &&
  migration.includes('logbook_instances_exactly_one_owner'),
  'forward migration fails closed on legacy orphan rows and restores the NOT NULL enrollment owner'
);

check(
  migration.includes('app_private.can_access_enrollment(i.enrollment_id)') &&
  migration.includes('e.trainee_profile_id = auth.uid()') &&
  migration.includes('app_private.can_access_enrollment(li.enrollment_id)') &&
  !migration.includes('li.enrollment_id IS NULL'),
  'instance access, ownership, and template visibility resolve exclusively through the enrollment'
);

check(
  migration.includes('admin_assign_trainee_enrollment_logbook') &&
  migration.includes('p_request_id uuid') &&
  migration.includes('pg_advisory_xact_lock') &&
  migration.includes('audit_logs_admin_assignment_request_id_uidx') &&
  migration.includes('p_request_id::text'),
  'admin provisioning uses a transaction-scoped idempotency key recorded in the audit log'
);

const enrollmentInsert = migration.indexOf('INSERT INTO public.training_enrollments');
const instanceInsert = migration.indexOf('INSERT INTO public.logbook_instances');
check(
  enrollmentInsert >= 0 &&
  instanceInsert > enrollmentInsert &&
  migration.slice(instanceInsert, instanceInsert + 500).includes('enrollment_id, template_version_id') &&
  !migration.slice(instanceInsert, instanceInsert + 700).includes('VALUES (\n    NULL'),
  'admin provisioning creates the enrollment before its non-orphaned logbook in one database transaction'
);

check(
  admin.includes("supabase.rpc('admin_assign_trainee_enrollment_logbook'") &&
  admin.includes('p_slot_id: slotId') &&
  admin.includes('p_request_id: requestId') &&
  admin.includes('assignableAdminSlots') &&
  admin.includes("version.status === 'PUBLISHED'") &&
  admin.includes('version.is_assignable === true') &&
  admin.includes('offering.status !== \'PUBLISHED\'') &&
  !admin.includes("supabase.rpc('admin_assign_trainee_logbook'"),
  'admin UI provisions through an eligible published slot and the idempotent enrollment RPC'
);

check(
  !migration.includes('UNIQUE (trainee_profile_id, specialty_id)') &&
  !migration.includes('one_per_trainee_per_specialty'),
  'no uniqueness rule collapses separate enrollments for the same trainee and specialty'
);

console.log('Per-enrollment logbook contract passed.');
