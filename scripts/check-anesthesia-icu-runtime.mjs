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

// Evaluate the source catalogue prefix only; it contains no DOM or browser calls.
const catalogueEnd = runtime.indexOf('const pageParams =');
assert.ok(catalogueEnd > 0, 'The source catalogue must precede the runtime bridge.');
const catalogue = runInNewContext(
  `${runtime.slice(0, catalogueEnd)}\n;({roadmap, emergencyData, emergencyInvestigations, groupDefs, journeyItems, interpretationItems, roadmapItems})`,
  {}
);

assert.equal(catalogue.roadmap.length, 157, 'All source Roadmap rows must be preserved.');
assert.deepEqual(
  catalogue.roadmap.reduce((counts, row) => {
    counts[row[1]] = (counts[row[1]] || 0) + 1;
    return counts;
  }, {}),
  { Core: 69, Expanded: 61, Advanced: 27 },
  'The source Tier distribution must remain unchanged.'
);
assert.equal(new Set(catalogue.roadmap.map((row) => row[0])).size, 157);
for (const row of catalogue.roadmap) {
  assert.equal(row.length, 4);
  assert.ok(['Core', 'Expanded', 'Advanced'].includes(row[1]));
  assert.ok(['Observed', 'Discussion', 'Performed under supervision'].includes(row[2]));
  assert.ok(['Single', 'Repeated'].includes(row[3]));
}

assert.equal(catalogue.groupDefs.length, 17);
const coveredIndexes = new Set();
for (const group of catalogue.groupDefs) {
  const start = catalogue.roadmap.findIndex((row) => row[0] === group.start);
  const end = group.end ? catalogue.roadmap.findIndex((row) => row[0] === group.end) : catalogue.roadmap.length;
  assert.ok(start >= 0 && end > start, `Invalid source roadmap boundary: ${group.id}`);
  for (let index = start; index < end; index += 1) {
    assert.ok(!coveredIndexes.has(index), `Overlapping source Roadmap group at row ${index}`);
    coveredIndexes.add(index);
  }
}
assert.equal(coveredIndexes.size, 157);
assert.equal(catalogue.journeyItems.length, 9);
assert.equal(catalogue.interpretationItems.length, 5);
assert.equal(catalogue.roadmapItems.length, 171);

assert.equal(Object.keys(catalogue.emergencyData).length, 5);
for (const [name, template] of Object.entries(catalogue.emergencyData)) {
  assert.ok(template.redFlags.length >= 3, `${name}: red flags are required`);
  assert.ok(template.ddx.length >= 3, `${name}: differentials are required`);
  assert.ok(catalogue.emergencyInvestigations[name]?.length >= 3, `${name}: investigations are required`);
}
assert.equal(catalogue.emergencyInvestigations['Cardiac Arrest'].length, 5);
assert.equal(catalogue.emergencyInvestigations['Difficult / Failed Airway'].length, 3);

// The central page loads its own runtime and stylesheet, not duplicated inline code.
assert.equal([...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].length, 0);
assert.match(html, /<script src="\\.\\/app\\.js" defer><\\/script>/);
assert.match(html, /<link rel="stylesheet" href="\\.\\/style\\.css">/);
assert.doesNotMatch(html, /<script\\b[^>]*\\bsrc="https?:/i);
assert.doesNotMatch(html, /<link\\b[^>]*href="https?:/i);
for (const id of ['syncStatus', 'readonlyBanner', 'mentorReviewPanel']) assert.ok(html.includes(`id="${id}"`));
assert.match(html, /Do not enter patient-identifying information/i);
assert.match(html, /\\/logbooks\\/anesthesia-icu\\/mentoro_logo\\.svg/);

// Shared cloud bridge and stable record identity.
for (const type of [
  'MENTORO_LOGBOOK_READY', 'MENTORO_LOGBOOK_STATE_CHANGED', 'MENTORO_LOGBOOK_LOAD_STATE',
  'MENTORO_LOGBOOK_LOAD_REVIEWS', 'MENTORO_LOGBOOK_MENTOR_REVIEW',
  'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT', 'MENTORO_LOGBOOK_SET_READ_ONLY',
  'MENTORO_LOGBOOK_SAVE_RESULT', 'MENTORO_LOGBOOK_LOAD_ERROR'
]) assert.ok(runtime.includes(type), `Missing bridge message ${type}`);
assert.match(runtime, /function startCloudBridge\\(\\)/);
assert.match(runtime, /function currentCloudState\\(\\)[\\s\\S]*reflection:data\\.reflection/);
assert.match(runtime, /function normalizeState\\(value\\)/);
assert.match(runtime, /function makeId\\(\\)/);
assert.match(runtime, /o\\.id=existing\\?\\.id\\|\\|makeId\\(\\)/);
assert.match(runtime, /const base=\\{id:makeId\\(\\)/);
assert.match(runtime, /function allReviewableEntries\\(\\)/);
assert.match(runtime, /function renderMentorReviewPanel\\(\\)[\\s\\S]*data-review-submit/);
assert.match(runtime, /MENTORO_LOGBOOK_MENTOR_REVIEW',instanceId,itemId:id,itemType:type,decision,feedback/);

// Platform-mode clinical state is bridged to the parent; local storage is preview-only.
assert.match(runtime, /const storagePrefix = 'mentoro_anesthesia_preview_'/);
assert.match(runtime, /if\\(previewMode\\)\\{try\\{const raw=store\\.get\\('state'/);
assert.match(runtime, /if\\(previewMode\\)\\{store\\.set\\('state'/);
assert.doesNotMatch(runtime, /mentoro_v[34]_(sessions|cases|procedures|roadmap|emergency|reflection)/);
assert.equal((runtime.match(/function save\\(/g) || []).length, 1);
assert.match(runtime, /function save\\(options=\\{\\}\\)\\{\\s*if\\(readOnlyMode\\)return/);
assert.match(runtime, /function toggleRoad\\(id\\)\\{if\\(readOnlyMode\\|\\|\\(!previewMode&&!cloudReady\\)\\)return/);
assert.match(runtime, /function render\\(\\)[\\s\\S]*renderMentorReviewPanel\\(\\);applyReadOnlyMode\\(\\)/);
assert.match(runtime, /function openModal\\(kind,editIndex=null\\)\\{if\\(readOnlyMode/);
assert.match(runtime, /function openEmergency\\(name,editIndex=null\\)\\{if\\(readOnlyMode/);
assert.match(runtime, /function openExposureModal\\(\\)\\{\\s*if\\(readOnlyMode/);

// Trainees cannot self-verify mentor approval; old imported fields are stripped.
assert.doesNotMatch(html, /name=["']mentorVerified["']/i);
assert.doesNotMatch(html, /name=["']mentorDate["']/i);
assert.doesNotMatch(runtime, /<label>Mentor verification<\\/label>/i);
assert.match(runtime, /\\['mentorVerified','mentorDate','mentor_verified','mentor_date'\\]/);
assert.match(runtime, /delete row\\[field\\]/);
assert.match(runtime, /function applyReadOnlyMode\\(\\)/);
assert.match(runtime, /if\\(!readOnlyMode\\|\\|!instanceId\\|\\|previewMode\\)\\{panel\\.hidden=true/);
assert.match(runtime, /if\\(button\\.hasAttribute\\('data-review-submit'\\)\\)button\\.disabled=false/);

// The SQL migration extends the trusted renderer/state/review allowlists.
for (const fn of [
  'app_private.guard_logbook_template_version_schema',
  'app_private.admin_publish_logbook_template_version',
  'app_private.get_my_logbook_html_state',
  'app_private.save_my_logbook_html_state',
  'app_private.get_my_logbook_html_item_reviews',
  'app_private.mentor_review_html_logbook_item'
]) assert.ok(migration.includes(fn), `Anesthesia migration must preserve ${fn}`);
assert.equal((migration.match(/\\/logbooks\\/anesthesia-icu\\/index\\.html/g) || []).length, 7);
assert.equal((migration.match(/v_html_path IS DISTINCT FROM '\\/logbooks\\/anesthesia-icu\\/index\\.html'/g) || []).length, 2);
assert.equal((migration.match(/'\\/logbooks\\/anesthesia-icu\\/index\\.html'/g) || []).length, 5);
assert.match(migration, /WHERE li\\.id = p_instance_id AND li\\.enrollment_id IS NULL/);
assert.match(migration, /v_enrollment_status := 'CONFIRMED'/);

assert.match(seedMigration, /'anesthesia-icu-html'/);
assert.match(seedMigration, /sp\\.slug = 'anesthesia-icu'/);
assert.match(seedMigration, /'DRAFT'/);
assert.match(seedMigration, /false,/);
assert.match(seedMigration, /'\\/logbooks\\/anesthesia-icu\\/index\\.html'/);
assert.match(seedMigration, /anesthesiologist or intensivist review of Tier, Depth, Frequency/);
assert.match(seedMigration, /clinical_review_required', true/);
assert.match(manifest, /lifecycle: "draft"/);
assert.match(manifest, /renderer: "HTML"/);
assert.match(manifest, /htmlPath: "\\/logbooks\\/anesthesia-icu\\/index\\.html"/);
assert.match(manifest, /supportsMentorReview: true/);
assert.match(manifest, /readOnlyMentorReview: true/);
assert.match(manifest, /clinical-review-pending|anesthesiologist-review-pending/);
assert.match(moduleTemplate, /renderer: "HTML"/);
assert.match(moduleTemplate, /htmlPath: "\\/logbooks\\/anesthesia-icu\\/index\\.html"/);
assert.match(registryCheck, /\\/logbooks\\/anesthesia-icu\\/index\\.html/);
assert.ok(packageJson.scripts['check:specialty-registry'].includes('check-anesthesia-icu-runtime.mjs'));

console.log('Anesthesia & Critical Care contract passed: source counts, emergency templates, central bridge, stable IDs, Mentor Review, and Draft SQL registration.');
