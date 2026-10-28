import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const admin = await read('../src/admin-workspace.js');
const wrappers = await read('../supabase/migrations/20261028062421_current_user_workflow_wrappers.sql');
const adminSetup = await read('../supabase/migrations/20261028062818_mentor_reviews_and_admin_training_setup.sql');
const schema = await read('../supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql');

function check(condition, message) {
  if (!condition) throw new Error(`Admin workspace contract failed: ${message}`);
  console.log(`✓ ${message}`);
}

check(
  admin.includes(".from('trainee-verification')") &&
  admin.includes("createSignedUrl(doc.object_path, 300)") &&
  admin.includes('link expires in 5 min'),
  'private identity documents are opened only through short-lived signed URLs'
);

check(
  admin.includes("supabase.rpc('admin_review_trainee_verification'") &&
  admin.includes("supabase.rpc('admin_confirm_my_application'") &&
  admin.includes("supabase.rpc('admin_create_training_offering'") &&
  admin.includes("supabase.rpc('admin_create_training_slot'"),
  'privileged verification, booking, offering, and slot mutations use server-checked RPCs'
);

check(
  !/\.from\(['"][^'"]+['"]\)\s*\.(?:insert|update|delete|upsert)\s*\(/s.test(admin),
  'admin dashboard does not directly write privileged database tables'
);

check(
  admin.includes("version.template.specialty_id") &&
  admin.includes("templateOption.dataset.specialtyId !== specialtyId") &&
  admin.includes("templateOption.dataset.templateStatus !== 'PUBLISHED'") &&
  admin.includes("templateOption.dataset.assignable !== 'true'") &&
  admin.includes("publishToggle.disabled = !canPublish") &&
  admin.includes("const mentorPublic = mentorOption?.dataset.isPublic === 'true'"),
  'offering creation filters template versions by specialty and disables publishing until prerequisites are met'
);

check(
  admin.includes("card?.querySelector('[data-verification-note]')?.value?.trim() || ''") &&
  admin.includes("if (decision === 'REJECT' && !reason)"),
  'rejecting trainee verification requires an explanation that is saved by the review RPC'
);

check(
  wrappers.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  wrappers.includes('CREATE OR REPLACE FUNCTION public.admin_confirm_my_application') &&
  adminSetup.includes('CREATE OR REPLACE FUNCTION public.admin_create_training_offering') &&
  adminSetup.includes('CREATE OR REPLACE FUNCTION public.admin_create_training_slot') &&
  schema.includes('CREATE TABLE public.logbook_instances') &&
  schema.includes('enrollment_id uuid NOT NULL UNIQUE REFERENCES public.training_enrollments(id)'),
  'privileged RPC definitions and independent logbook table are present in the reviewed migration sources'
);


const templateMigration = await read('../supabase/migrations/20261028143000_admin_create_logbook_template_draft.sql');
check(
  admin.includes('id="admin-template-form"') &&
  admin.includes("supabase.rpc('admin_create_logbook_template_draft'") &&
  admin.includes('schemaDefinition = JSON.parse') &&
  admin.includes('templateDefinition = JSON.parse'),
  'admin workspace validates JSON and creates logbook templates through a dedicated RPC'
);
check(
  templateMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  templateMigration.includes("VALUES (v_template_id, 1, 'DRAFT', false") &&
  templateMigration.includes('LOGBOOK_TEMPLATE_DRAFT_CREATED') &&
  templateMigration.includes('REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_draft') &&
  templateMigration.includes('CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_draft'),
  'template draft creation is admin-checked, audited, non-assignable, and exposed only through a checked wrapper'
);
check(
  templateMigration.includes("IS DISTINCT FROM 'object'") &&
  templateMigration.includes("NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select')") &&
  templateMigration.includes('Schema field keys must be unique') &&
  admin.includes('Publishing stays blocked until the template is clinically reviewed'),
  'template drafts validate field schema and cannot be mistaken for clinically published templates'
);

console.log('Administrator workspace safety contracts passed.');
