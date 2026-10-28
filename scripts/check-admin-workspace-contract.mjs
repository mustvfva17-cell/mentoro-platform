import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const admin = await read('../src/admin-workspace.js');
const wrappers = await read('../supabase/migrations/20261028062421_current_user_workflow_wrappers.sql');
const adminSetup = await read('../supabase/migrations/20261028062818_mentor_reviews_and_admin_training_setup.sql');
const schema = await read('../supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql');
const legacyHtml = await read('../public/logbooks/medical-oncology/index.html');

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


const templateMigration = await read('../supabase/migrations/20261028143433_admin_create_logbook_template_draft.sql');
const schemaGuardMigration = await read('../supabase/migrations/20261028145034_guard_logbook_template_schema.sql');
check(
  admin.includes('id="admin-template-form"') &&
  admin.includes("supabase.rpc('admin_create_logbook_template_draft'") &&
  admin.includes('schemaDefinition = JSON.parse') &&
  admin.includes('templateDefinition = JSON.parse'),
  'admin workspace validates JSON and creates logbook templates through a dedicated RPC'
);
check(
  templateMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  templateMigration.includes("v_template_id, 1, 'DRAFT', false") &&
  templateMigration.includes('LOGBOOK_TEMPLATE_DRAFT_CREATED') &&
  templateMigration.includes('REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_draft') &&
  templateMigration.includes('FROM PUBLIC, anon, authenticated, service_role') &&
  templateMigration.includes('CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_draft'),
  'template draft creation is admin-checked, audited, non-assignable, and exposed only through a checked wrapper'
);
check(
  templateMigration.includes("IS DISTINCT FROM 'object'") &&
  templateMigration.includes("NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select')") &&
  templateMigration.includes('Schema field keys must be unique') &&
  admin.includes('Use this only when no existing HTML logbook is available'),
  'template drafts validate field schema and cannot be mistaken for clinically published templates'
);


check(
  admin.includes("const allTemplateVersions = (templateVersionResult.data || []).map") &&
  admin.includes("LOGBOOK REVIEW") &&
  admin.includes("const templateVersions = allTemplateVersions.filter((version) => version.template?.is_active)") &&
  admin.includes("Pending clinical review. Publishing remains disabled"),
  'template drafts are visible in an admin review queue but inactive drafts cannot be offered for booking'
);
check(
  schemaGuardMigration.includes("CREATE TRIGGER guard_logbook_template_version_schema") &&
  schemaGuardMigration.includes("Select options must be non-empty strings") &&
  schemaGuardMigration.includes("Logbook schema field keys must be unique") &&
  schemaGuardMigration.includes("A published/assignable template requires structured fields") &&
  schemaGuardMigration.includes("A published/assignable template requires source and clinical review notes"),
  'database trigger validates schema fields and blocks publishing without structure and source notes'
);


check(
  admin.includes("import { getTemplateFields } from './logbook-schema.js';") &&
  admin.includes("const allTemplateVersions = (templateVersionResult.data || []).map") &&
  admin.includes("LOGBOOK REVIEW") &&
  admin.includes("const templateVersions = allTemplateVersions.filter((version) => version.template?.is_active)") &&
  admin.includes("Pending clinical review. Publishing remains disabled"),
  'template drafts are visible to admins but inactive draft templates cannot be selected for offerings'
);
check(
  schemaGuardMigration.includes("CREATE TRIGGER guard_logbook_template_version_schema") &&
  schemaGuardMigration.includes("Select options must be non-empty strings") &&
  schemaGuardMigration.includes("Logbook schema field keys must be unique") &&
  schemaGuardMigration.includes("A published/assignable template requires structured fields") &&
  schemaGuardMigration.includes("A published/assignable template requires source and clinical review notes"),
  'database trigger validates structured schemas and blocks publication without fields and review/source notes'
);


const publicationMigration = await read('../supabase/migrations/20261028151327_admin_publish_logbook_template_version.sql');
const publicationVersioningMigration = await read('../supabase/migrations/20261028153201_keep_only_latest_assignable_template_version.sql');
const templateVersionDraftMigration = await read('../supabase/migrations/20261028153539_admin_create_logbook_template_version_draft.sql');
check(
  admin.includes('CLINICAL GOVERNANCE') &&
  admin.includes('data-publish-template') &&
  admin.includes("supabase.rpc('admin_publish_logbook_template_version'") &&
  admin.includes('Clinical review decision / notes'),
  'admin can review template source/schema and request publication with documented clinical notes'
);
check(
  publicationMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  publicationMigration.includes("v_status <> 'DRAFT'") &&
  publicationMigration.includes("SET status = 'PUBLISHED'") &&
  publicationMigration.includes('is_assignable = true') &&
  publicationMigration.includes('LOGBOOK_TEMPLATE_VERSION_PUBLISHED') &&
  publicationMigration.includes('FROM PUBLIC, anon, authenticated, service_role'),
  'template publication is admin-only, draft-only, audited, and its private implementation remains role-guarded'
);
check(
  publicationVersioningMigration.includes('SET is_assignable = false') &&
  publicationVersioningMigration.includes('WHERE template_id = v_template_id') &&
  publicationVersioningMigration.includes('AND id <> p_version_id') &&
  publicationVersioningMigration.includes('SET status = \'PUBLISHED\'') &&
  publicationVersioningMigration.toLowerCase().includes('because existing offerings, enrollments, and logbook instances still reference them'),
  'publishing a new version stops assigning older versions to new offerings while preserving historical references'
);

check(
  admin.includes('id="admin-template-version-form"') &&
  admin.includes("supabase.rpc('admin_create_logbook_template_version_draft'") &&
  admin.includes('latestTemplateById') &&
  admin.includes('Older versions and existing logbooks were left unchanged'),
  'admin can create the next draft version under an existing template without overwriting history'
);
check(
  templateVersionDraftMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  templateVersionDraftMigration.includes('FOR UPDATE') &&
  templateVersionDraftMigration.includes('coalesce(max(v.version_number), 0) + 1') &&
  templateVersionDraftMigration.includes("'DRAFT', false") &&
  templateVersionDraftMigration.includes('LOGBOOK_TEMPLATE_VERSION_DRAFT_CREATED') &&
  templateVersionDraftMigration.includes('FROM PUBLIC, anon, authenticated, service_role') &&
  templateVersionDraftMigration.includes('CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_version_draft'),
  'creating a template version is admin-only, serialized, audited, non-assignable, and exposed through a checked wrapper'
);

const apiWrappersMigration = await read('../supabase/migrations/20261028154338_admin_template_api_invoker_wrappers.sql');
check(
  apiWrappersMigration.includes('CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_draft') &&
  apiWrappersMigration.includes('CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_version_draft') &&
  apiWrappersMigration.includes('CREATE OR REPLACE FUNCTION public.admin_publish_logbook_template_version') &&
  (apiWrappersMigration.match(/SECURITY INVOKER/g) || []).length === 3 &&
  !/CREATE OR REPLACE FUNCTION public\.admin_(?:create_logbook_template_draft|create_logbook_template_version_draft|publish_logbook_template_version)[\s\S]*?SECURITY DEFINER/i.test(apiWrappersMigration),
  'public admin template RPCs use SECURITY INVOKER rather than SECURITY DEFINER'
);
check(
  apiWrappersMigration.includes('GRANT EXECUTE ON FUNCTION app_private.admin_create_logbook_template_draft') &&
  apiWrappersMigration.includes('GRANT EXECUTE ON FUNCTION app_private.admin_create_logbook_template_version_draft') &&
  apiWrappersMigration.includes('GRANT EXECUTE ON FUNCTION app_private.admin_publish_logbook_template_version') &&
  templateMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  templateVersionDraftMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()') &&
  publicationMigration.includes('IF v_actor_id IS NULL OR NOT app_private.is_platform_admin()'),
  'public template RPCs use invoker wrappers; authenticated execution on private helpers is required for delegation, and each helper enforces the active-admin role'
);

check(
  admin.includes('EXISTING HTML LOGBOOKS') &&
  admin.includes('/logbooks/medical-oncology/index.html?mode=preview') &&
  admin.includes('<details class="admin-advanced-template-details">'),
  'existing HTML logbooks are surfaced first and the manual JSON authoring tools are optional/collapsed'
);

check(
  legacyHtml.includes('id="roadmap"') &&
  legacyHtml.includes('id="logbook"') &&
  legacyHtml.includes('id="emergency"') &&
  legacyHtml.includes("pageParams.get('mode')==='preview'") &&
  legacyHtml.includes('mentoro_medical_oncology_preview_') &&
  legacyHtml.includes('not linked to a confirmed training'),
  'existing Medical Oncology HTML is preserved with isolated preview storage and a clear local-only warning'
);


const htmlPublicationWrapper = await read('../supabase/migrations/20261028165257_fix_html_template_publication_wrapper.sql');
const htmlScopeMigration = await read('../supabase/migrations/20261028165610_scope_html_state_rpc_to_registered_assets.sql');
const htmlSeedMigration = await read('../supabase/migrations/20261028165736_seed_medical_oncology_html_logbook_draft.sql');
check(
  admin.includes("const isRegisteredHtml = templateDefinition.renderer === 'HTML'") &&
  admin.includes("REGISTERED_HTML_LOGBOOK_PATHS.has(templateDefinition.html_path)") &&
  admin.includes("Preview existing logbook") &&
  admin.includes("href=\"/logbooks/general-surgery/index.html?mode=preview\"") &&
  admin.includes("const canPublishReviewedRuntime = isRegisteredHtml || version.fields.length > 0") &&
  admin.includes("data-publish-template") &&
  admin.includes("Pending clinical review. Publishing remains disabled until the HTML asset and source are reviewed."),
  'existing HTML templates are shown as HTML, can be previewed, and are publication-eligible only through the registered asset review path'
);
check(
  htmlPublicationWrapper.includes('SECURITY INVOKER') &&
  htmlScopeMigration.includes("v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'") &&
  htmlScopeMigration.includes("v_template_definition ->> 'html_path' IS DISTINCT FROM '/logbooks/medical-oncology/index.html'") &&
  htmlScopeMigration.includes("Only the assigned trainee can save this HTML logbook") &&
  htmlSeedMigration.includes('medical-oncology-html') &&
  htmlSeedMigration.includes("'DRAFT'") &&
  htmlSeedMigration.includes('ON CONFLICT (id) DO NOTHING'),
  'HTML publication wrapper, registered-asset access boundary, and non-assignable existing HTML seed migration are source-controlled'
);

console.log('Administrator workspace safety contracts passed.');
