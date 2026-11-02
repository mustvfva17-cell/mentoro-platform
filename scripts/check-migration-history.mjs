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

console.log(
  `Migration history contract passed: ${migrationFiles.length} SQL files; unique version prefixes, unique normalized contents, and fresh-project optional-helper guard.`
);
