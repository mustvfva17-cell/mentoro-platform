import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20261109200900_enforce_single_device_license.sql');
const edge = await read('supabase/functions/mentoro-license/index.ts');

assert.match(migration, /having count\(\*\) > 1[\s\S]*?raise exception/i,
  'The migration must stop before changing any license if a current active license uses multiple phones.');
assert.match(migration, /set device_limit = 1/i);
assert.match(migration, /alter column device_limit set default 1/i);
assert.match(migration, /check \(device_limit = 1\)/i);
assert.match(migration, /'device_limit', 1/);
assert.match(edge, /deviceLimit: 1/);
assert.doesNotMatch(edge, /deviceLimit: 2/);

const generalSurgery = await read('vercel-logbooks/general-surgery/index.html');
assert.match(generalSurgery, /const DB_NAME = ["']mentoro-local-logbooks["']/,
  'General Surgery must retain its established IndexedDB database name.');
assert.match(generalSurgery, /const DB_VERSION = 1/,
  'A UI-only or licensing policy update must not silently recreate the existing IndexedDB schema.');
assert.match(generalSurgery, /function localStateKey\(licenseId, specialtySlug\)/,
  'Saved progress must remain scoped to the same license and specialty.');
assert.match(generalSurgery, /return ["']state:["'] \+ licenseId \+ ["']:["'] \+ specialtySlug/,
  'The license-scoped progress key must remain stable across releases.');

const paths = [
  'vercel-logbooks/general-surgery/index.html',
  'vercel-logbooks/medical-oncology/index.html',
  'vercel-logbooks/pediatrics/index.html',
  'vercel-logbooks/anesthesia-icu/shared/license-runtime.js',
  'vercel-logbooks/cardiology/shared/license-runtime.js',
  'vercel-logbooks/neurology/shared/license-runtime.js',
  'vercel-logbooks/ophthalmology/shared/license-runtime.js'
];

for (const path of paths) {
  const source = await read(path);
  assert.match(source, /One license activates on one phone at a time/,
    `${path} must clearly explain the one-phone policy.`);
  assert.match(source, /deviceLimit: 1/);
  assert.match(source, /payload\.deviceLimit \|\| 1/);
  assert.match(source, /already active on another phone/);
  assert.doesNotMatch(source, /supports up to two devices|Both device activations|deviceLimit: 2|payload\.deviceLimit \|\| 2/);
}
console.log('Single-device license contract passed for all seven standalone logbooks.');
