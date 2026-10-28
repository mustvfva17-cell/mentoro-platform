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

console.log(`Logbook entry-type contract passed: ${[...new Set(usedTypes)].join(', ')}.`);
