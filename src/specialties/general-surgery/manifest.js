export default Object.freeze({
  id: "general-surgery",
  name: "General Surgery",
  sourceLabel: "General Surgery",
  // The platform already has a cloud-bridged HTML runtime at this route.
  // Keep the catalogue lifecycle in draft until clinical/content review is complete.
  lifecycle: "draft",
  runtimeStatus: "central-html-bridge-present",
  renderer: "HTML",
  htmlPath: "/logbooks/general-surgery/index.html",
  statePersistence: "get_my_logbook_html_state/save_my_logbook_html_state",
  supportsMentorReview: true,
  readOnlyMentorReview: true,
  templateStatus: "legacy-html-runtime-present",
  schemaStatus: "review-pending",
  sourceProject: "public/logbooks/general-surgery/index.html",
  sourceArchive: "mentoro-general-surgery-logbook-project-v3.zip",
  sourceArchiveStatus: "audited; standalone app lacks platform bridge; not copied wholesale",
});
