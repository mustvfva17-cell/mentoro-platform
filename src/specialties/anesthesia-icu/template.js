/**
 * Central HTML template descriptor. Clinical catalogue content is hosted in
 * public/logbooks/anesthesia-icu/index.html and its local runtime assets.
 * Keep this template non-publishable until specialist clinical review.
 */
export const template = Object.freeze({
  specialtyId: "anaesthesia-critical-care",
  renderer: "HTML",
  htmlPath: "/logbooks/anesthesia-icu/index.html",
  status: "clinical-review-pending",
  sourceArchive: "mentoro-anesthesia-critical-care-logbook-project-v1.zip",
});
export default template;
