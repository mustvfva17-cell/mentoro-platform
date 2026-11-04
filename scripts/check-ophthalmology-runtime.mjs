import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../public/logbooks/ophthalmology/index.html");
const app = read("../public/logbooks/ophthalmology/app.js");
const content = JSON.parse(read("../public/logbooks/ophthalmology/content.json"));
const migration = read("../supabase/migrations/20261104220000_register_ophthalmology_html_logbook.sql");
const seed = read("../supabase/migrations/20261104221000_seed_ophthalmology_html_logbook_draft.sql");
const manifest = read("../src/specialties/ophthalmology/manifest.js");

assert.match(html, /<script src="\.\/app\.js" defer><\/script>/);
assert.match(html, /id="mentorReviewPanel"/);
assert.match(html, /patient-identifying information/i);
assert.match(html, /obtain consent first/i);
assert.match(html, /data-view="lectures"/);
assert.match(html, /id="view-lectures"/);
assert.ok(app.includes("function renderLectures()"));
assert.ok(app.includes('data.roadmap["lecture:" + lecture.id]'));
assert.ok(app.includes("data-lecture-toggle"));
assert.doesNotMatch(html, /id="ophthalmology-exam-safety-note" hidden/);

assert.equal(content.specialty, "ophthalmology");
assert.equal(content.roadmap.length, 32);
assert.equal(content.lectures.length, 18);
assert.equal(new Set(content.lectures.map((lecture) => lecture.id)).size, 18);
assert.equal(content.courseAims.length, 9);
assert.equal(content.clinicalSchedule.length, 4);
assert.ok(app.includes('end: "IOP assessment by digital palpation"'));
assert.ok(app.includes('start: "IOP assessment by digital palpation", end: "Cataract case"'));
for (const item of ["External eye inspection & examination","Corneal fluorescein staining","Lacrimal gland palpation","Lid elevation test","Lid closure test","Regurgitation test","Schiotz indentation tonometry","Indirect ophthalmoscopy","Corneal light reflection test"]) assert.ok(content.roadmap.some((row) => row[0] === item), "Missing official clinical item: " + item);
assert.ok(app.includes('let activeGroup = "vision"'));
assert.ok(app.includes('group: "patientJourney"'));
assert.ok(app.includes('group: "interpretation"'));
assert.equal(new Set(content.roadmap.map((row) => row[0])).size, 32);
const roadmapTitles = content.roadmap.map((row) => row[0]);
assert.ok(roadmapTitles.indexOf("External eye inspection & examination") < roadmapTitles.indexOf("Visual acuity assessment"));
assert.ok(roadmapTitles.indexOf("Corneal case") < roadmapTitles.indexOf("Corneal fluorescein staining"));
assert.ok(roadmapTitles.indexOf("Corneal fluorescein staining") < roadmapTitles.indexOf("Corneal sensation / reflex"));
assert.ok(roadmapTitles.indexOf("Lacrimal sac case") < roadmapTitles.indexOf("Lacrimal gland palpation"));
assert.ok(roadmapTitles.indexOf("Lacrimal gland palpation") < roadmapTitles.indexOf("Regurgitation test"));
assert.deepEqual(Object.keys(content.emergencyTemplates), []);
for (const row of content.roadmap) {
  assert.equal(row.length, 4);
  assert.ok(["Core", "Expanded", "Advanced"].includes(row[1]));
  assert.ok(["Observed", "Discussion", "Performed under supervision"].includes(row[2]));
  assert.ok(["Single", "Repeated"].includes(row[3]));
}

for (const messageType of [
  "MENTORO_LOGBOOK_READY","MENTORO_LOGBOOK_STATE_CHANGED","MENTORO_LOGBOOK_LOAD_STATE",
  "MENTORO_LOGBOOK_LOAD_REVIEWS","MENTORO_LOGBOOK_MENTOR_REVIEW",
  "MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT","MENTORO_LOGBOOK_SET_READ_ONLY",
  "MENTORO_LOGBOOK_SAVE_RESULT"
]) assert.ok(app.includes(messageType), "Missing bridge message: " + messageType);

assert.match(app, /mentoro_training_.*_ophthalmology_/);
assert.match(app, /function newId\(\)/);
assert.match(app, /if \(readOnlyMode\) return;/);
assert.match(app, /Emergency templates are withheld pending ophthalmologist review/);
assert.ok(!app.includes("cardiology"));
assert.ok(!html.includes("Cardiology"));

for (const fn of [
  "app_private.guard_logbook_template_version_schema",
  "app_private.admin_publish_logbook_template_version",
  "app_private.get_my_logbook_html_state",
  "app_private.save_my_logbook_html_state",
  "app_private.get_my_logbook_html_item_reviews",
  "app_private.mentor_review_html_logbook_item"
]) assert.ok(migration.includes(fn));
assert.equal(migration.split("/logbooks/ophthalmology/index.html").length - 1, 7);
assert.ok(seed.includes("'ophthalmology-html'"));
assert.ok(seed.includes("'DRAFT'"));
assert.ok(seed.includes("false,"));
assert.ok(seed.includes("clinical_review_required', true"));
assert.ok(seed.includes("ophthalmologist review"));

assert.match(manifest, /lifecycle: "draft"/);
assert.match(manifest, /htmlPath: "\/logbooks\/ophthalmology\/index\.html"/);
assert.match(manifest, /readOnlyMentorReview: true/);

console.log("Ophthalmology runtime contract passed: 18 lectures, 32 clinical training items, course aims, weekly schedule, central cloud bridge, read-only mentor review, and Draft-only registration.");
