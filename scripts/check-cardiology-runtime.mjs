import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/logbooks/cardiology/index.html');
const app = read('../public/logbooks/cardiology/app.js');
const content = JSON.parse(read('../public/logbooks/cardiology/content.json'));
const migration = read('../supabase/migrations/20261102020000_register_cardiology_html_logbook.sql');
const seedMigration = read('../supabase/migrations/20261102030000_seed_cardiology_html_logbook_draft.sql');
const manifest = read('../src/specialties/cardiology/manifest.js');

assert.match(html, /<script src="\.\/app\.js" defer><\/script>/,
  'Cardiology page must load its central runtime.');
assert.match(html, /id="mentorReviewPanel"/,
  'Cardiology page must provide the shared mentor review slot.');
assert.match(html, /patient-identifying information/i,
  'The privacy warning must be visible.');

assert.equal(content.specialty, 'cardiology');
assert.equal(content.roadmap.length, 117, 'All 117 source roadmap items must be preserved.');
assert.equal(Object.keys(content.emergencyTemplates).length, 5,
  'All five source emergency templates must be preserved.');

for (const messageType of [
  'MENTORO_LOGBOOK_READY',
  'MENTORO_LOGBOOK_STATE_CHANGED',
  'MENTORO_LOGBOOK_LOAD_STATE',
  'MENTORO_LOGBOOK_LOAD_REVIEWS',
  'MENTORO_LOGBOOK_MENTOR_REVIEW',
  'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT',
  'MENTORO_LOGBOOK_SET_READ_ONLY',
  'MENTORO_LOGBOOK_SAVE_RESULT'
]) {
  assert.ok(app.includes(messageType), `Missing platform bridge message: ${messageType}`);
}

assert.match(app, /mentoro_training_.*_cardiology_/,
  'Local cache must be namespaced to the logbook instance and specialty.');
assert.match(app, /function newId\(\)/,
  'Every saved item must have a stable ID for mentor review integrity.');
assert.match(app, /if \(readOnlyMode\).*Backup export is disabled in read-only views/s,
  'Backup export must be blocked in read-only mode.');
assert.match(app, /if \(readOnlyMode\) return;/,
  'Read-only mode must prevent entry mutations.');
assert.doesNotMatch(app, /mentorVerified/,
  'Trainees must not be able to self-mark mentor verification.');

for (const fn of [
  'app_private.guard_logbook_template_version_schema',
  'app_private.admin_publish_logbook_template_version',
  'app_private.get_my_logbook_html_state',
  'app_private.save_my_logbook_html_state',
  'app_private.get_my_logbook_html_item_reviews',
  'app_private.mentor_review_html_logbook_item'
]) {
  assert.ok(migration.includes(fn), `Migration must preserve and extend ${fn}`);
}
assert.ok(migration.includes('WHERE li.id = p_instance_id AND li.enrollment_id IS NULL'),
  'Cardiology state load must retain the newest direct-admin-owned logbook access path.');
assert.ok(migration.includes("v_enrollment_status := 'CONFIRMED'"),
  'Cardiology saves must retain the newest direct-admin-owned logbook lifecycle path.');
assert.ok((migration.match(/\/logbooks\/cardiology\/index\.html/g) || []).length >= 6,
  'The Cardiology path must be added to the schema, publish, state, and review allowlists.');
assert.ok(migration.includes("AND v_html_path IS DISTINCT FROM '/logbooks/cardiology/index.html' THEN"),
  'Admin publication must include Cardiology in the three-way HTML asset check.');

assert.ok(seedMigration.includes("'cardiology-html'"));
assert.ok(seedMigration.includes("'DRAFT'"));
assert.ok(seedMigration.includes("false,"));
assert.ok(seedMigration.includes("sp.slug = 'cardiology'"));
assert.ok(seedMigration.includes('bound to a different specialty'));
assert.ok(seedMigration.includes("'/logbooks/cardiology/index.html'"),
  'The seeded draft must point to the central Cardiology runtime.');
assert.ok(seedMigration.includes('cardiologist review of Tier, Depth, and Frequency'),
  'The draft seed must preserve the clinical review requirement.');

assert.match(manifest, /lifecycle: "draft"/,
  'Cardiology must remain non-assignable pending clinical review.');
assert.match(manifest, /htmlPath: "\/logbooks\/cardiology\/index\.html"/,
  'Cardiology manifest must point at its central runtime.');

console.log('Cardiology runtime contract passed: 117 roadmap items, five emergency templates, bridge, read-only review, and SQL allowlist.');
