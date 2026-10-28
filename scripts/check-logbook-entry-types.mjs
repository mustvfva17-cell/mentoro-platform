import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const migrationPath = new URL('../supabase/migrations/20261028061628_core_independent_enrollment_schema_v1.sql', import.meta.url);
let migration = null;

try {
  migration = await readFile(migrationPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const fallbackTypes = [
  'SESSION',
  'CASE',
  'PROCEDURE',
  'EMERGENCY',
  'REFLECTION',
  'ROADMAP',
  'LEARNING_ACTIVITY',
];

let allowedTypes = new Set(fallbackTypes);
if (migration !== null) {
  const match = migration.match(
    /entry_type\s+text\s+NOT NULL\s+CHECK\s*\(\s*entry_type\s+IN\s*\(([^)]+)\)\s*\)/is
  );
  if (!match) {
    throw new Error('Could not locate the logbook_entries.entry_type check constraint in the core migration.');
  }
  allowedTypes = new Set(Array.from(match[1].matchAll(/'([A-Z_]+)'/g), (item) => item[1]));
} else {
  console.warn('Core schema migration is not present on this branch; using the reviewed entry-type contract until migration recovery is merged.');
}

const usedTypes = Array.from(
  frontend.matchAll(/entry_type\s*:\s*['"]([A-Z_]+)['"]/g),
  (item) => item[1]
);

if (!usedTypes.length) {
  throw new Error('No literal logbook entry_type assignments were found in src/main.js.');
}

const invalid = [...new Set(usedTypes)].filter((type) => !allowedTypes.has(type));
if (invalid.length) {
  throw new Error(
    `Unsupported logbook entry type(s) in src/main.js: ${invalid.join(', ')}. Allowed: ${[...allowedTypes].join(', ')}.`
  );
}

const usesScopedSubmissionRpc = /supabase\.rpc\(['"]set_logbook_entry_submitted['"]/.test(frontend);
if (!usesScopedSubmissionRpc) {
  throw new Error('Logbook submission must use the scoped set_logbook_entry_submitted RPC.');
}

const submissionMigrationPath = new URL('../supabase/migrations/20261028094412_fix_scoped_logbook_submission_rpc.sql', import.meta.url);
let submissionMigration = null;
try {
  submissionMigration = await readFile(submissionMigrationPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const submissionSource = submissionMigration ?? migration;
if (submissionSource !== null) {
  const submitFunction = submissionSource.match(/CREATE OR REPLACE FUNCTION public\.set_logbook_entry_submitted\([\s\S]*?\$\$;?/i);
  if (submitFunction && /updated_at\s*=|submitted_at\s*=/i.test(submitFunction[0])) {
    throw new Error('Submission RPC must rely on database triggers for timestamps, not write timestamp columns directly.');
  }
}

console.log(`Logbook entry-type and scoped-submission contracts passed: ${[...new Set(usedTypes)].join(', ')}.`);
