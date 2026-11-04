import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const html = await read("../public/logbooks/ophthalmology/index.html");
const app = await read("../public/logbooks/ophthalmology/app.js");
const content = JSON.parse(await read("../public/logbooks/ophthalmology/content.json"));
const manifest = await read("../src/specialties/ophthalmology/manifest.js");
const registry = await read("../src/logbooks/module-registry.js");
const registration = await read("../supabase/migrations/20261104214000_register_ophthalmology_html_logbook.sql");
const seed = await read("../supabase/migrations/20261104214100_seed_ophthalmology_html_logbook_draft.sql");

for (const [index, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].entries()) {
  if (!match[1].trim()) continue;
  assert.doesNotThrow(() => new Script(match[1], { filename: `ophthalmology-inline-${index + 1}.js` }),
    `Ophthalmology inline script ${index + 1} must parse.`);
}
assert.doesNotThrow(() => new Script(app, { filename: "ophthalmology-app.js" }));

assert.equal(content.specialty, "ophthalmology");
assert.equal(content.roadmap.length, 49, "The course schedule and examination checklist must preserve all 49 source entries.");
assert.equal(content.groups.length, 5, "All four weekly blocks and the examination checklist must be represented.");
const covered = new Set();
for (const group of content.groups) {
  assert.ok(Number.isInteger(group.startIndex) && Number.isInteger(group.endIndex));
  assert.ok(group.startIndex >= 0 && group.endIndex > group.startIndex && group.endIndex <= content.roadmap.length);
  for (let i = group.startIndex; i < group.endIndex; i += 1) {
    assert.ok(!covered.has(i), `Ophthalmology roadmap groups overlap at row ${i}`);
    covered.add(i);
  }
}
assert.equal(covered.size, 49, "Ophthalmology roadmap groups must cover every row exactly once.");
assert.equal(content.courseObjectives.length, 8);
assert.equal(content.weeklySchedule.length, 4);
assert.equal(content.weeklySchedule.map((block) => block.weeks).join(","), "1–3,4–6,7–9,12–14");
assert.equal(content.assessment.stations, 3);
assert.equal(content.assessment.minutesPerStation, 5);
assert.equal(content.assessment.marksPerStation, 15);
assert.equal(content.assessment.totalMarks, 45);
assert.deepEqual(Object.keys(content.emergencyTemplates), [],
  "No emergency algorithms should be invented for this source-only draft.");

assert.equal(content.clinicalGovernance.clinicalReviewRequired, true);
assert.equal(content.clinicalGovernance.exposureIsNotCompetence, true);
assert.equal(content.clinicalGovernance.consentAndSupervisionRequired, true);
assert.equal(content.clinicalGovernance.emergencyProtocolsIncluded, false);

assert.match(html, /id="view-course"/);
assert.match(html, /id="courseObjectives"/);
assert.match(html, /id="weeklySchedule"/);
assert.match(html, /id="osceAssessment"/);
assert.match(html, /id="ophthalmology-exam-safety-note"/);
assert.match(html, /id="readonlyBanner"/);
assert.match(html, /id="mentorReviewPanel"/);
assert.match(html, /id="syncStatus"/);
assert.match(html, /Do not enter patient-identifying information/i);
assert.match(html, /Personal Tier, Depth and Frequency targets[\s\S]*not stated as university requirements/i);
assert.match(html, /<script src="\.\/app\.js" defer><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\.\/style\.css">/);
assert.doesNotMatch(html, /<script\b[^>]*\bsrc="https?:/i);

for (const message of [
  "MENTORO_LOGBOOK_READY",
  "MENTORO_LOGBOOK_STATE_CHANGED",
  "MENTORO_LOGBOOK_LOAD_STATE",
  "MENTORO_LOGBOOK_LOAD_REVIEWS",
  "MENTORO_LOGBOOK_MENTOR_REVIEW",
  "MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT",
  "MENTORO_LOGBOOK_SET_READ_ONLY",
  "MENTORO_LOGBOOK_SAVE_RESULT",
  "MENTORO_LOGBOOK_LOAD_ERROR"
]) assert.ok(app.includes(message), `Ophthalmology cloud/review bridge is missing ${message}`);

assert.match(app, /event\.origin !== window\.location\.origin/);
assert.match(app, /event\.source !== window\.opener/);
assert.match(app, /function currentCloudState\(\)/);
assert.match(app, /function applyReadOnlyMode\(\)/);
assert.match(app, /data-review-submit/);
assert.match(app, /mentoro_training_.*_ophthalmology_/);
assert.match(manifest, /id: "ophthalmology"/);
assert.match(manifest, /lifecycle: "draft"/);
assert.match(manifest, /htmlPath: "\/logbooks\/ophthalmology\/index.html"/);
assert.match(registry, /import ophthalmology from "\.\.\/specialties\/ophthalmology\/manifest\.js"/);
assert.match(registry, /\bophthalmology,/);
assert.match(registration, /\/logbooks\/ophthalmology\/index\.html/);
assert.match(seed, /'ophthalmology-html'/);
assert.match(seed, /'DRAFT'/);
assert.match(seed, /false,/);
assert.match(seed, /clinical_review_required', true/);
assert.match(seed, /Ophthalmologist review is required/);

console.log("Ophthalmology runtime contract passed: 49 source entries, 5 groups, 4 week blocks, 17-point examination checklist, and 3-station OSCE.");
