import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Drift guard for the logbook trees that are deployed from this repository:
//   public/logbooks/<specialty>/    integrated with the platform (cloud sync through the opener bridge)
//   vercel-logbooks/<specialty>/    standalone licensed, local-first deployments
// app.js and index.html differ on purpose between the two trees (bridge boot vs. licensed boot), so only
// files that must stay byte-identical are compared here. If a divergence is intentional, document it in
// docs/ and remove the file from the lists below in the same pull request.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const digest = (path) => createHash('sha256').update(read(path)).digest('hex');

function assertIdentical(canonical, copies, label) {
  const expected = digest(canonical);
  for (const copy of copies) {
    assert.equal(
      digest(copy),
      expected,
      `${label}: ${copy} differs from ${canonical}. Update every copy in the same pull request.`
    );
    console.log(`✓ ${copy} matches ${canonical}`);
  }
}

// 1. Licensing runtime (activation, device binding, offline grace). The standalone copies carry the
//    one-phone policy that the database enforces; every other copy must match them exactly.
assertIdentical(
  'vercel-logbooks/cardiology/shared/license-runtime.js',
  [
    'vercel-logbooks/anesthesia-icu/shared/license-runtime.js',
    'vercel-logbooks/neurology/shared/license-runtime.js',
    'vercel-logbooks/ophthalmology/shared/license-runtime.js',
    'public/logbooks/shared/license-runtime.js',
    'public/logbooks/anesthesia-icu/license-runtime.js'
  ],
  'Licensing runtime'
);

// 2. Licensing stylesheet.
assertIdentical(
  'vercel-logbooks/cardiology/shared/license.css',
  [
    'vercel-logbooks/anesthesia-icu/shared/license.css',
    'vercel-logbooks/neurology/shared/license.css',
    'vercel-logbooks/ophthalmology/shared/license.css',
    'public/logbooks/shared/license.css',
    'public/logbooks/anesthesia-icu/license.css'
  ],
  'Licensing stylesheet'
);

// 3. Clinical content and styling mirrored between both trees.
const mirrored = {
  'anesthesia-icu': ['style.css', 'mentoro_logo.svg'],
  cardiology: ['content.json', 'style.css'],
  neurology: ['content.json', 'style.css'],
  ophthalmology: ['content.json', 'style.css']
};
for (const [specialty, files] of Object.entries(mirrored)) {
  for (const file of files) {
    assertIdentical(
      `public/logbooks/${specialty}/${file}`,
      [`vercel-logbooks/${specialty}/${file}`],
      `${specialty} mirrored file`
    );
  }
}

// 4. Baseline response headers: the platform and every standalone logbook project use the same set.
assertIdentical(
  'vercel.json',
  [
    'anesthesia-icu',
    'cardiology',
    'general-surgery',
    'medical-oncology',
    'neurology',
    'ophthalmology',
    'pediatrics'
  ].map((specialty) => `vercel-logbooks/${specialty}/vercel.json`),
  'Baseline security headers'
);

console.log('Logbook copy synchronisation contract passed.');
