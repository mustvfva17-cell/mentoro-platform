import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error('No SQL migration files were found in supabase/migrations/.');
}

const filenamePattern = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const versions = new Map();
const contents = new Map();

for (const filename of migrationFiles) {
  const match = filename.match(filenamePattern);
  if (!match) {
    throw new Error(`Migration filename does not follow YYYYMMDDHHMMSS_name.sql: ${filename}`);
  }

  const [, version] = match;
  const previousVersionFile = versions.get(version);
  if (previousVersionFile) {
    throw new Error(
      `Duplicate migration version ${version}: ${previousVersionFile} and ${filename}`
    );
  }
  versions.set(version, filename);

  const source = (await readFile(new URL(filename, migrationDirectory), 'utf8'))
    .replace(/\r\n/g, '\n')
    .trim();
  if (!source) {
    throw new Error(`Migration file is empty: ${filename}`);
  }

  const digest = createHash('sha256').update(source).digest('hex');
  const previousContentFile = contents.get(digest);
  if (previousContentFile) {
    throw new Error(
      `Duplicate migration contents detected in ${previousContentFile} and ${filename}. ` +
      'Keep one ledger-matched migration rather than replaying an identical file under a new version.'
    );
  }
  contents.set(digest, filename);
}

const freshProjectBootstrap = await readFile(
  new URL('20261028060841_restrict_rls_auto_enable_function.sql', migrationDirectory),
  'utf8'
);
if (
  !freshProjectBootstrap.includes("to_regprocedure('public.rls_auto_enable()')") ||
  !freshProjectBootstrap.includes('REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()')
) {
  throw new Error('Fresh-project bootstrap contract failed: optional rls_auto_enable revoke must be guarded.');
}

const medicalOncologySeed = await readFile(
  new URL('20261028165736_seed_medical_oncology_html_logbook_draft.sql', migrationDirectory),
  'utf8'
);
if (
  !medicalOncologySeed.includes("FROM public.specialties s") ||
  !medicalOncologySeed.includes("s.slug = 'medical-oncology'") ||
  medicalOncologySeed.includes('5545aff6-e2d4-4fa8-85b6-1a2468112a86')
) {
  throw new Error('Medical Oncology seed contract failed: specialty must be resolved by slug, not a database-local UUID.');
}

const generalSurgerySeed = await readFile(
  new URL('20261028175703_register_general_surgery_html_logbook.sql', migrationDirectory),
  'utf8'
);
if (
  !generalSurgerySeed.includes("WHERE slug = 'general-surgery'") ||
  !generalSurgerySeed.includes('v_specialty_id') ||
  !generalSurgerySeed.includes("WHERE slug = 'general-surgery-html'") ||
  generalSurgerySeed.includes('d4921709-a57c-4a65-8e3c-34f38343ed1d')
) {
  throw new Error('General Surgery seed contract failed: specialty must be resolved by slug, not a database-local UUID.');
}


const htmlReviewAccessFix = (await readFile(
  new URL('20261104185409_enforce_active_mentor_role_for_html_review_reads.sql', migrationDirectory),
  'utf8'
)).replace(/\\s+/g, ' ');
if (
  !htmlReviewAccessFix.includes('CREATE OR REPLACE FUNCTION app_private.get_my_logbook_html_item_reviews') ||
  !htmlReviewAccessFix.includes('(v_actor_id <> v_mentor_id OR NOT app_private.is_mentor())') ||
  !htmlReviewAccessFix.includes('REVOKE ALL ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid)') ||
  !htmlReviewAccessFix.includes('GRANT EXECUTE ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid) TO authenticated')
) {
  throw new Error('HTML logbook review access contract failed: review reads must require the assigned mentor role to remain active.');
}

console.log(
  `Migration history contract passed: ${migrationFiles.length} SQL files; unique version prefixes, unique normalized contents, and fresh-project optional-helper guard.`
);
