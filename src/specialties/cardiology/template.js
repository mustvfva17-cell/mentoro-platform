/**
 * Cardiology runtime is HTML-rendered. Its clinical roadmap/emergency catalogue
 * lives in public/logbooks/cardiology/content.json and is loaded by the runtime.
 * Keep this module draft until a cardiologist reviews tier/depth/frequency.
 */
export const template = Object.freeze({
  specialtyId: "cardiology",
  renderer: "HTML",
  htmlPath: "/logbooks/cardiology/index.html",
  status: "clinical-review-pending",
});
export default template;
