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
  admin.includes("templateOption.dataset.assignable !== 'true'"),
  'offering creation filters template versions by specialty and checks publish prerequisites'
);

check(
  wrappers.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  wrappers.includes('CREATE OR REPLACE FUNCTION public.admin_confirm_my_application') &&
  adminSetup.includes('CREATE OR REPLACE FUNCTION public.admin_create_training_offering') &&
  adminSetup.includes('CREATE OR REPLACE FUNCTION public.admin_create_training_slot') &&
  schema.includes('CREATE TABLE public.logbook_instances') &&
  schema.includes('UNIQUE REFERENCES public.training_enrollments(id)') === false,
  'privileged RPC definitions and independent logbook table are present in the reviewed migration sources'
);

console.log('Administrator workspace safety contracts passed.');
