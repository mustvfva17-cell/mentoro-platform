import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../public/logbooks/pediatrics/index.html");
const migration = read("../supabase/migrations/20261102060000_register_pediatrics_html_logbook.sql");
const seedMigration = read("../supabase/migrations/20261102070000_seed_pediatrics_html_logbook_draft.sql");
const manifest = read("../src/specialties/pediatrics/manifest.js");

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const catalogueScript = inlineScripts.find((source) => source.includes("window.MENTORO_PEDIATRICS_CONTENT"));
const runtime = inlineScripts.find((source) => source.includes("function startCloudBridge()"));
assert.ok(catalogueScript, "The source Pediatrics catalogue must be embedded in the central HTML asset.");
assert.ok(runtime, "The central Pediatrics runtime and cloud bridge must be embedded in the page.");

const assignmentIndex = catalogueScript.indexOf("=");
assert.ok(assignmentIndex >= 0, "The source catalogue assignment must be present.");
const catalogueJSON = catalogueScript.slice(assignmentIndex + 1).trim().replace(/;\s*$/, "");
const content = JSON.parse(catalogueJSON);

// Parse every inline JavaScript block without executing browser-dependent code.
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new Script(source, { filename: `pediatrics-inline-${index}.js` }),
    `Inline JavaScript block ${index + 1} must parse.`);
}

assert.equal(content.specialty, "pediatrics");
assert.equal(content.roadmap.length, 137, "All 137 source roadmap entries must be preserved.");
assert.deepEqual(
  content.roadmap.reduce((counts, row) => {
    counts[row[1]] = (counts[row[1]] || 0) + 1;
    return counts;
  }, {}),
  { Core: 63, Expanded: 51, Advanced: 23 },
  "The source Tier distribution must remain unchanged."
);
assert.equal(new Set(content.roadmap.map((row) => row[0])).size, 137,
  "Roadmap item titles must remain unique.");
for (const row of content.roadmap) {
  assert.equal(row.length, 4, "Every roadmap row must preserve item, Tier, Depth, and Frequency.");
  assert.ok(["Core", "Expanded", "Advanced"].includes(row[1]));
  assert.ok(["Observed", "Discussion", "Performed under supervision"].includes(row[2]));
  assert.ok(["Single", "Repeated"].includes(row[3]));
}

assert.equal(content.groups.length, 14, "All 14 source roadmap groups must be retained.");
const coveredIndexes = new Set();
for (const group of content.groups) {
  const start = content.roadmap.findIndex((row) => row[0] === group.start);
  const end = group.end ? content.roadmap.findIndex((row) => row[0] === group.end) : content.roadmap.length;
  assert.ok(start >= 0 && end > start, `Invalid roadmap boundary for ${group.id}`);
  for (let index = start; index < end; index++) {
    assert.ok(!coveredIndexes.has(index), `Roadmap groups overlap at source row ${index}`);
    coveredIndexes.add(index);
  }
}
assert.equal(coveredIndexes.size, 137, "The 14 roadmap groups must cover all 137 source rows exactly once.");
assert.equal(content.patientJourney.length, 9, "All nine patient-journey prompts must be retained.");
assert.equal(content.clinicalInterpretation.length, 5, "All five clinical-interpretation prompts must be retained.");

assert.equal(Object.keys(content.emergencyTemplates).length, 5,
  "All five emergency templates must be preserved.");
for (const [name, template] of Object.entries(content.emergencyTemplates)) {
  assert.ok(Array.isArray(template.redFlags) && template.redFlags.length >= 3, `${name}: red flags must be present.`);
  assert.ok(Array.isArray(template.ddx) && template.ddx.length >= 3, `${name}: differentials must be present.`);
  assert.ok(Array.isArray(template.investigations) && template.investigations.length >= 3, `${name}: investigations must be present.`);
}
assert.ok(content.roadmap.some((row) =>
  row[0] === "Genital and pubertal examination" && row[1] === "Expanded" &&
  row[2] === "Observed" && row[3] === "Single"),
  "The source genital and pubertal examination row must remain Expanded / Observed / Single.");
assert.equal(content.clinicalGovernance.guardianConsentRequiredForExamination, true);
assert.equal(content.clinicalGovernance.intimateAndPubertalExaminationRole, "Observed");
assert.equal(content.clinicalGovernance.clinicalReviewRequired, true);

// Single-file delivery: no dependency on adjacent specialty files or external assets.
assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i, "The Pediatrics runtime must be self-contained.");
assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=/i,
  "The Pediatrics stylesheet must be inlined in the central HTML page.");
assert.match(html, /id="mentorReviewPanel"/);
assert.match(html, /id="readonlyBanner"/);
assert.match(html, /Do not enter patient-identifying information/i);
assert.match(html, /id="syncStatus"/);

// Shared authenticated state bridge and scoped browser cache.
for (const messageType of [
  "MENTORO_LOGBOOK_READY",
  "MENTORO_LOGBOOK_STATE_CHANGED",
  "MENTORO_LOGBOOK_LOAD_STATE",
  "MENTORO_LOGBOOK_LOAD_REVIEWS",
  "MENTORO_LOGBOOK_MENTOR_REVIEW",
  "MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT",
  "MENTORO_LOGBOOK_SET_READ_ONLY",
  "MENTORO_LOGBOOK_SAVE_RESULT",
  "MENTORO_LOGBOOK_LOAD_ERROR"
]) {
  assert.ok(runtime.includes(messageType), `Missing MENTORO parent bridge message: ${messageType}`);
}
assert.match(runtime, /mentoro_training_.*_pediatrics_/,
  "Local cache must be scoped to the logbook instance and Pediatrics.");
assert.match(runtime, /function makeId\(\)/,
  "Saved records must receive stable IDs.");
assert.match(runtime, /function currentCloudState\(\)[\s\S]*governance/,
  "Guardian-consent evidence must be part of the cloud state.");
assert.match(runtime, /function exportLogbook\(\)[\s\S]*Backup export is disabled in read-only review views/s,
  "Backup export must be disabled in mentor read-only views.");
assert.match(runtime, /instanceId&&!previewMode&&!cloudReady/,
  "Backup export must wait for the cloud state handshake.");
assert.match(runtime, /if\(readOnlyMode\)return;/,
  "The runtime must block local entry mutations in read-only mode.");
assert.match(runtime, /mentorVerified[\s\S]*delete row\.mentorVerified/,
  "Legacy trainee self-verification fields must be stripped from imported entries.");
assert.doesNotMatch(html, /name=["']mentorVerified["']/i,
  "The trainee UI must not expose a mentor-verification input.");

// Pediatrics safeguarding: guardian consent is collected for clinical entries,
// and intimate / pubertal examination is only recorded as Observed.
assert.match(runtime, /guardianConsentStatus/,
  "The guardian-consent status must be represented in entry forms and state.");
assert.match(runtime, /sensitiveActivity[\s\S]*guardianConsentStatus!=='Confirmed'[\s\S]*o\.role!=='Observed'/,
  "Detailed session / case / procedure entries must reject unconsented or performed intimate examinations.");
assert.match(runtime, /sensitiveEmergency[\s\S]*guardianConsentStatus!=='Confirmed'[\s\S]*o\.role!=='Observed'/,
  "Emergency template entries must enforce the same safeguarding gate.");
assert.match(runtime, /sensitiveExposure[\s\S]*consentStatus!=='Confirmed'[\s\S]*exposureRole!=='Observed'/,
  "Quick exposure entries must enforce the same safeguarding gate.");
assert.match(runtime, /target\?\.item==='Genital and pubertal examination'[\s\S]*recordIntimateExamEvidence/,
  "Roadmap completion of the sensitive item must record explicit observed-only governance evidence.");
assert.match(runtime, /function recordIntimateExamEvidence[\s\S]*data\.governance\.intimateExams/,
  "Sensitive-examination governance evidence must be persisted in the logbook state.");
assert.match(runtime, /o\.id=existing\?\.id\|\|makeId\(\);delete o\.mentorVerified/,
  "Emergency template entries must receive stable IDs and remove obsolete self-verification fields.");
assert.match(runtime, /base\.id=makeId\(\)/,
  "Quick exposure entries must receive stable IDs before entering their collection.");
assert.match(runtime, /function renderMentorReviewPanel[\s\S]*data-review-submit/,
  "Saved entries must be reviewable through the parent MENTORO mentor-review bridge.");
assert.match(runtime, /button\.hasAttribute\('data-review-submit'\)/,
  "Read-only mode must keep mentor-review actions available while disabling trainee mutations.");

// Trusted RPC allowlists: retain current direct-admin-aware functions and append Pediatrics.
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
  "HTML state loading must retain the current direct-admin-owned logbook access path.");
assert.ok(migration.includes("v_enrollment_status := 'CONFIRMED'"),
  "HTML state saving must retain the current direct-admin-owned lifecycle path.");
assert.equal((migration.match(/\/logbooks/pediatrics/index\.html/g) || []).length, 7,
  "Pediatrics path must be present in each trusted HTML renderer / state / review allowlist.");
assert.match(migration, /AND v_html_path IS DISTINCT FROM '\/logbooks\/pediatrics\/index\.html' THEN/,
  "Admin publication must include Pediatrics in the HTML asset check.");

// Draft seed: private and non-assignable until authorized clinical review.
assert.ok(seedMigration.includes("'pediatrics-html'"));
assert.ok(seedMigration.includes("sp.slug = 'pediatrics'"));
assert.ok(seedMigration.includes("'DRAFT'"));
assert.ok(seedMigration.includes("false,"));
assert.ok(seedMigration.includes("'/logbooks/pediatrics/index.html'"));
assert.ok(seedMigration.includes("pediatrician review of Tier, Depth, Frequency"));
assert.ok(seedMigration.includes("guardian consent"));
assert.ok(seedMigration.includes("Observed-only"));
assert.ok(seedMigration.includes("not independent proof of legal consent"));

assert.match(manifest, /lifecycle: "draft"/);
assert.match(manifest, /renderer: "HTML"/);
assert.match(manifest, /htmlPath: "\/logbooks\/pediatrics\/index\.html"/);
assert.match(manifest, /supportsMentorReview: true/);
assert.match(manifest, /readOnlyMentorReview: true/);

console.log("Pediatrics runtime contract passed: 137 roadmap rows, 14 groups, five emergency templates, cloud bridge, and safeguarding checks.");
