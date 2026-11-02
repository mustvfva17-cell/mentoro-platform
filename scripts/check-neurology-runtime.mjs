import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../public/logbooks/neurology/index.html");
const app = read("../public/logbooks/neurology/app.js");
const content = JSON.parse(read("../public/logbooks/neurology/content.json"));
const migration = read("../supabase/migrations/20261102040000_register_neurology_html_logbook.sql");
const seedMigration = read("../supabase/migrations/20261102050000_seed_neurology_html_logbook_draft.sql");
const manifest = read("../src/specialties/neurology/manifest.js");

assert.match(html, /<script src="\.\/app\.js" defer><\/script>/,
  "Neurology page must load its central runtime.");
assert.match(html, /id="mentorReviewPanel"/,
  "Neurology page must provide the shared mentor review slot.");
assert.match(html, /patient-identifying information/i,
  "The privacy warning must be visible.");

assert.equal(content.specialty, "neurology");
assert.equal(content.roadmap.length, 115, "All 115 source roadmap items must be preserved.");
assert.deepEqual(
  content.roadmap.reduce((counts, row) => {
    counts[row[1]] = (counts[row[1]] || 0) + 1;
    return counts;
  }, {}),
  { Core: 52, Expanded: 41, Advanced: 22 },
  "Source tier distribution must remain unchanged."
);
assert.equal(new Set(content.roadmap.map((row) => row[0])).size, 115,
  "Roadmap item titles must remain unique.");
for (const row of content.roadmap) {
  assert.equal(row.length, 4, "Each roadmap item must retain item, tier, depth, and frequency.");
  assert.ok(["Core", "Expanded", "Advanced"].includes(row[1]));
  assert.ok(["Observed", "Discussion", "Performed under supervision"].includes(row[2]));
  assert.ok(["Single", "Repeated"].includes(row[3]));
}
assert.equal(content.groups.length, 13, "All source roadmap groups must be retained.");
const covered = new Set();
for (const group of content.groups) {
  const start = content.roadmap.findIndex((row) => row[0] === group.start);
  const end = group.end ? content.roadmap.findIndex((row) => row[0] === group.end) : content.roadmap.length;
  assert.ok(start >= 0 && end > start, `Invalid roadmap boundary for ${group.id}`);
  for (let index = start; index < end; index++) {
    assert.ok(!covered.has(index), `Roadmap group overlap at source row ${index}`);
    covered.add(index);
  }
}
assert.equal(covered.size, 115, "Roadmap groups must cover all 115 source items exactly once.");
assert.equal(content.patientJourney.length, 9, "All patient-journey prompts must be retained.");
assert.equal(content.clinicalInterpretation.length, 5,
  "All clinical-interpretation prompts must be retained.");

assert.equal(Object.keys(content.emergencyTemplates).length, 5,
  "All five emergency templates must be preserved.");
for (const [name, template] of Object.entries(content.emergencyTemplates)) {
  assert.ok(template.redFlags.length >= 3, `${name}: red flags must be present.`);
  assert.ok(template.ddx.length >= 3, `${name}: differentials must be present.`);
  assert.ok(template.investigations.length >= 3, `${name}: investigations must be present.`);
}

for (const messageType of [
  "MENTORO_LOGBOOK_READY",
  "MENTORO_LOGBOOK_STATE_CHANGED",
  "MENTORO_LOGBOOK_LOAD_STATE",
  "MENTORO_LOGBOOK_LOAD_REVIEWS",
  "MENTORO_LOGBOOK_MENTOR_REVIEW",
  "MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT",
  "MENTORO_LOGBOOK_SET_READ_ONLY",
  "MENTORO_LOGBOOK_SAVE_RESULT"
]) {
  assert.ok(app.includes(messageType), `Missing platform bridge message: ${messageType}`);
}
assert.match(app, /mentoro_training_.*_neurology_/,
  "Local cache must be namespaced to the logbook instance and specialty.");
assert.match(app, /function newId\(\)/,
  "Every saved item must have a stable ID for mentor review integrity.");
assert.match(app, /if \(readOnlyMode\).*Backup export is disabled in read-only views/s,
  "Backup export must be blocked in read-only mode.");
assert.match(app, /if \(readOnlyMode\) return;/,
  "Read-only mode must prevent entry mutations.");
assert.doesNotMatch(app, /mentorVerified/,
  "Trainees must not be able to self-mark mentor verification.");
assert.match(app, /content\.roadmap\.length !== 115/,
  "Runtime must validate the exact Neurology roadmap size.");
assert.match(app, /content\.emergencyTemplates\)\.length !== 5/,
  "Runtime must validate all five emergency templates.");
assert.match(app, /coveredIndexes\.size !== content\.roadmap\.length/,
  "Runtime must reject incomplete or overlapping roadmap grouping.");
assert.match(app, /group\.id === "spine"/,
  "Patient-journey prompts must attach to the source Spine/Cord group.");

for (const fn of [
  "app_private.guard_logbook_template_version_schema",
  "app_private.admin_publish_logbook_template_version",
  "app_private.get_my_logbook_html_state",
  "app_private.save_my_logbook_html_state",
  "app_private.get_my_logbook_html_item_reviews",
  "app_private.mentor_review_html_logbook_item"
]) {
  assert.ok(migration.includes(fn), `Migration must preserve and extend ${fn}`);
}
assert.ok(migration.includes("WHERE li.id = p_instance_id AND li.enrollment_id IS NULL"),
  "Neurology state access must retain the newest direct-admin-owned logbook access path.");
assert.ok(migration.includes("v_enrollment_status := 'CONFIRMED'"),
  "Neurology saves must retain the newest direct-admin-owned logbook lifecycle path.");
assert.equal((migration.match(/\/logbooks\/neurology\/index\.html/g) || []).length, 7,
  "Neurology path must be present in the schema, publish, state, and review allowlists.");
assert.match(migration, /AND v_html_path IS DISTINCT FROM '\/logbooks\/neurology\/index\.html' THEN/,
  "Admin publication must include Neurology in the HTML asset check.");
assert.doesNotMatch(migration, /Register the central Cardiology HTML runtime/,
  "Neurology migration header must not retain the source specialty name.");

assert.ok(seedMigration.includes("'neurology-html'"));
assert.ok(seedMigration.includes("'DRAFT'"));
assert.ok(seedMigration.includes("false,"));
assert.ok(seedMigration.includes("sp.slug = 'neurology'"));
assert.ok(seedMigration.includes("bound to a different specialty"));
assert.ok(seedMigration.includes("'/logbooks/neurology/index.html'"));
assert.ok(seedMigration.includes("DRAFT: neurologist review of Tier, Depth, Frequency"));
assert.ok(seedMigration.includes("review of Tier, Depth, and Frequency by a neurologist"),
  "The Neurology source note must preserve the README's clinical review requirement.");
assert.ok(!seedMigration.includes("consent/chaperone"),
  "Do not carry Cardiology-only clinical review wording into Neurology.");

assert.match(manifest, /lifecycle: "draft"/,
  "Neurology must remain non-assignable pending clinical review.");
assert.match(manifest, /htmlPath: "\/logbooks\/neurology\/index\.html"/,
  "Neurology manifest must point at its central runtime.");
assert.match(manifest, /readOnlyMentorReview: true/);

console.log("Neurology runtime contract passed: 115 roadmap items, 13 groups, five emergency templates, and central bridge.");
