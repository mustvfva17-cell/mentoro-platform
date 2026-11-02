import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/logbooks/anesthesia-icu/index.html');
const runtime = read('../public/logbooks/anesthesia-icu/app.js');
const migration = read('../supabase/migrations/20261102080000_register_anesthesia_icu_html_logbook.sql');
const seedMigration = read('../supabase/migrations/20261102090000_seed_anesthesia_icu_html_logbook_draft.sql');
const manifest = read('../src/specialties/anesthesia-icu/manifest.js');
const moduleTemplate = read('../src/specialties/anesthesia-icu/template.js');
const registryCheck = read('../scripts/check-specialty-html-registry.mjs');
const packageJson = JSON.parse(read('../package.json'));

const catalogueEnd = runtime.indexOf('const pageParams =');
assert.ok(catalogueEnd > 0, 'The catalogue must precede the browser runtime.');
const catalogue = runInNewContext(
  runtime.slice(0, catalogueEnd) +
    '\n;({roadmap, emergencyData, emergencyInvestigations, groupDefs, journeyItems, interpretationItems, roadmapItems})',
  {}
);

assert.equal(catalogue.roadmap.length, 157, 'All source Roadmap entries must be preserved.');
const tierCounts = catalogue.roadmap.reduce((counts, row) => {
  counts[row[1]] = (counts[row[1]] || 0) + 1;
  return counts;
}, {});
assert.equal(tierCounts.Core, 69);
assert.equal(tierCounts.Expanded, 61);
assert.equal(tierCounts.Advanced, 27);
assert.equal(new Set(catalogue.roadmap.map((row) => row[0])).size, 157);
for (const row of catalogue.roadmap) {
  assert.equal(row.length, 4);
  assert.ok(['Core', 'Expanded', 'Advanced'].includes(row[1]));
  assert.ok(['Observed', 'Discussion', 'Performed under supervision'].includes(row[2]));
  assert.ok(['Single', 'Repeated'].includes(row[3]));
}

assert.equal(catalogue.groupDefs.length, 17);
const covered = new Set();
for (const group of catalogue.groupDefs) {
  const start = catalogue.roadmap.findIndex((row) => row[0] === group.start);
  const end = group.end
    ? catalogue.roadmap.findIndex((row) => row[0] === group.end)
    : catalogue.roadmap.length;
  assert.ok(start >= 0 && end > start, 'Invalid Roadmap boundary: ' + group.id);
  for (let index = start; index < end; index += 1) {
    assert.ok(!covered.has(index), 'Overlapping Roadmap groups at row ' + index);
    covered.add(index);
  }
}
assert.equal(covered.size, 157, 'The 17 groups must cover every source entry exactly once.');
assert.equal(catalogue.journeyItems.length, 9);
assert.equal(catalogue.interpretationItems.length, 5);
assert.equal(catalogue.roadmapItems.length, 171);

const emergencyNames = Object.keys(catalogue.emergencyData).sort();
assert.deepEqual(emergencyNames, [
  'Acute Respiratory Failure',
  'Anaphylaxis',
  'Cardiac Arrest',
  'Difficult / Failed Airway',
  'Septic Shock'
]);
for (const [name, item] of Object.entries(catalogue.emergencyData)) {
  assert.ok(item.redFlags.length >= 3, name + ' needs red flags.');
  assert.ok(item.ddx.length >= 3, name + ' needs differential diagnoses.');
  assert.ok(catalogue.emergencyInvestigations[name].length >= 3, name + ' needs investigation prompts.');
}
assert.equal(catalogue.emergencyInvestigations['Cardiac Arrest'].length, 5);
assert.equal(catalogue.emergencyInvestigations['Difficult / Failed Airway'].length, 3);

assert.equal(html.split('<script>').length - 1, 0, 'The HTML page must not duplicate an inline runtime.');
assert.ok(html.includes('<script src="./app.js" defer></script>'));
assert.ok(html.includes('<link rel="stylesheet" href="./style.css">'));
assert.ok(html.includes('/logbooks/anesthesia-icu/mentoro_logo.svg'));
assert.ok(html.includes('id="syncStatus"'));
assert.ok(html.includes('id="readonlyBanner"'));
assert.ok(html.includes('id="mentorReviewPanel"'));
assert.ok(html.includes('Do not enter patient-identifying information'));

const requiredMessages = [
  'MENTORO_LOGBOOK_READY',
  'MENTORO_LOGBOOK_STATE_CHANGED',
  'MENTORO_LOGBOOK_LOAD_STATE',
  'MENTORO_LOGBOOK_LOAD_REVIEWS',
  'MENTORO_LOGBOOK_MENTOR_REVIEW',
  'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT',
  'MENTORO_LOGBOOK_SET_READ_ONLY',
  'MENTORO_LOGBOOK_SAVE_RESULT',
  'MENTORO_LOGBOOK_LOAD_ERROR'
];
for (const message of requiredMessages) assert.ok(runtime.includes(message), 'Missing bridge message: ' + message);

for (const contract of [
  'function startCloudBridge()',
  'function currentCloudState()',
  'function normalizeState(value)',
  'function makeId()',
  'o.id=existing?.id||makeId()',
  'const base={id:makeId()',
  'function allReviewableEntries()',
  'function renderMentorReviewPanel()',
  'data-review-submit',
  'MENTORO_LOGBOOK_MENTOR_REVIEW',
  "const storagePrefix = 'mentoro_anesthesia_preview_'",
  "['mentorVerified','mentorDate','mentor_verified','mentor_date']",
  'function applyReadOnlyMode()'
]) assert.ok(runtime.includes(contract), 'Missing runtime contract: ' + contract);

assert.equal(runtime.split('function save(').length - 1, 1, 'Only one save implementation may exist.');
assert.ok(runtime.includes('if(readOnlyMode)return;'));
assert.ok(runtime.includes("delete row[field]"));
assert.ok(runtime.includes("if(!readOnlyMode||!instanceId||previewMode){panel.hidden=true"));
assert.ok(runtime.includes("if(button.hasAttribute('data-review-submit'))button.disabled=false"));
assert.ok(!runtime.includes('mentoro_v3_sessions'));
assert.ok(!runtime.includes('mentoro_v3_cases'));
assert.ok(!runtime.includes('mentoro_v3_procedures'));
assert.ok(!html.includes('name="mentorVerified"'));
assert.ok(!html.includes('name="mentorDate"'));
assert.ok(!runtime.includes('<label>Mentor verification</label>'));

for (const fn of [
  'app_private.guard_logbook_template_version_schema',
  'app_private.admin_publish_logbook_template_version',
  'app_private.get_my_logbook_html_state',
  'app_private.save_my_logbook_html_state',
  'app_private.get_my_logbook_html_item_reviews',
  'app_private.mentor_review_html_logbook_item'
]) assert.ok(migration.includes(fn), 'Migration must preserve ' + fn);

assert.equal(
  migration.split('/logbooks/anesthesia-icu/index.html').length - 1,
  7,
  'Anesthesia path must be present in all seven renderer/state/review allowlist checks.'
);
assert.equal(migration.split("v_html_path IS DISTINCT FROM '/logbooks/anesthesia-icu/index.html'").length - 1, 2);
assert.ok(migration.includes('WHERE li.id = p_instance_id AND li.enrollment_id IS NULL'));
assert.ok(migration.includes("v_enrollment_status := 'CONFIRMED'"));

assert.ok(seedMigration.includes("'anaesthesia-critical-care-html'"));
assert.ok(seedMigration.includes("sp.slug = 'anaesthesia-critical-care'"));
assert.ok(seedMigration.includes("'DRAFT'"));
assert.ok(seedMigration.includes('status, is_assignable'));
assert.ok(seedMigration.includes("'DRAFT',\n      false"));
assert.ok(seedMigration.includes("'clinical_review_required', true"));
assert.ok(seedMigration.includes('/logbooks/anesthesia-icu/index.html'));
assert.ok(seedMigration.includes('anesthesiologist or intensivist review of Tier, Depth, Frequency'));

assert.ok(manifest.includes('id: "anaesthesia-critical-care"'));
assert.ok(manifest.includes('lifecycle: "draft"'));
assert.ok(manifest.includes('renderer: "HTML"'));
assert.ok(manifest.includes('htmlPath: "/logbooks/anesthesia-icu/index.html"'));
assert.ok(manifest.includes('supportsMentorReview: true'));
assert.ok(manifest.includes('readOnlyMentorReview: true'));
assert.ok(moduleTemplate.includes('specialtyId: "anaesthesia-critical-care"'));
assert.ok(moduleTemplate.includes('renderer: "HTML"'));
assert.ok(moduleTemplate.includes('htmlPath: "/logbooks/anesthesia-icu/index.html"'));
assert.ok(registryCheck.includes('/logbooks/anesthesia-icu/index.html'));
assert.ok(packageJson.scripts['check:specialty-registry'].includes('check-anesthesia-icu-runtime.mjs'));

console.log('Anesthesia & Critical Care contract passed: 157 Roadmap entries, 17 groups, 14 supplemental prompts, five emergency templates, central cloud bridge, stable IDs, Mentor Review, and Draft SQL registration.');
