(() => {
"use strict";

const pageParams = new URLSearchParams(window.location.search);
const requestedInstance = pageParams.get("instance") || "";
const instanceId = /^[0-9a-f-]{36}$/i.test(requestedInstance) ? requestedInstance : "";
const previewMode = !instanceId || pageParams.get("mode") === "preview";
let readOnlyMode = pageParams.get("readonly") === "1";
let cloudReady = !(instanceId && window.opener);
let cloudDirty = false;
let lastQueuedSnapshot = "";
let saveTimer = null;
let roadmapItems = [];
let content = null;
let mentorReviews = [];
const reviewMessages = Object.create(null);
const reviewPending = new Set();

const storagePrefix = instanceId ? "mentoro_training_" + instanceId + "_ophthalmology_" : "mentoro_ophthalmology_preview_";
const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(storagePrefix + key);
      return value === null ? fallback : value;
    } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(storagePrefix + key, value); } catch (_) {}
  }
};

function emptyState() {
  return { sessions: [], cases: [], procedures: [], roadmap: {}, emergency: [], reflection: {} };
}
function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "ophth-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
}
function normalizeState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : emptyState();
  const normalized = {
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    cases: Array.isArray(state.cases) ? state.cases : [],
    procedures: Array.isArray(state.procedures) ? state.procedures : [],
    roadmap: state.roadmap && typeof state.roadmap === "object" && !Array.isArray(state.roadmap) ? state.roadmap : {},
    emergency: Array.isArray(state.emergency) ? state.emergency : [],
    reflection: state.reflection && typeof state.reflection === "object" && !Array.isArray(state.reflection) ? state.reflection : {}
  };
  let changed = false;
  ["sessions", "cases", "procedures", "emergency"].forEach((key) => {
    normalized[key] = normalized[key].map((item) => {
      const row = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      if (typeof row.id === "string" && row.id.trim()) return row;
      changed = true;
      return Object.assign({}, row, { id: newId() });
    });
  });
  return { state: normalized, changed };
}
let data;
try {
  data = normalizeState(JSON.parse(store.get("state", "null"))).state;
} catch (_) {
  data = emptyState();
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
}
function currentCloudState() {
  return {
    sessions: data.sessions,
    cases: data.cases,
    procedures: data.procedures,
    roadmap: data.roadmap,
    emergency: data.emergency,
    reflection: data.reflection
  };
}
function setStatus(text, isError) {
  const node = document.getElementById("syncStatus");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("error", Boolean(isError));
}
function setCloudLoading(loading) {
  const workspace = document.getElementById("workspace");
  if (workspace) {
    workspace.inert = Boolean(loading);
    if (loading) workspace.setAttribute("aria-busy", "true");
    else workspace.removeAttribute("aria-busy");
  }
}
function postCloudState(flushNow) {
  if (!instanceId || previewMode || !window.opener || !cloudReady || readOnlyMode) return;
  const snapshot = JSON.stringify(currentCloudState());
  lastQueuedSnapshot = snapshot;
  cloudDirty = true;
  try {
    window.opener.postMessage({
      type: "MENTORO_LOGBOOK_STATE_CHANGED",
      instanceId: instanceId,
      state: JSON.parse(snapshot),
      flushNow: flushNow === true
    }, window.location.origin);
  } catch (_) {
    setStatus("Cloud sync connection unavailable", true);
  }
}
function save(options) {
  if (readOnlyMode) return;
  store.set("state", JSON.stringify(currentCloudState()));
  if (instanceId && !previewMode && window.opener && cloudReady) {
    if (saveTimer) clearTimeout(saveTimer);
    if (options && options.flushNow) postCloudState(true);
    else saveTimer = setTimeout(function () { postCloudState(false); }, 500);
  } else {
    setStatus(previewMode ? "Saved in this browser only" : "Saved locally");
  }
}

let groupDefs = [];
let journeyItems = [];
let interpretationItems = [];
function buildRoadmap() {
  const items = [];
  groupDefs.forEach(function (group) {
    const start = Number.isInteger(group.startIndex) ? group.startIndex : content.roadmap.findIndex((row) => row[0] === group.start);
    const end = Number.isInteger(group.endIndex) ? group.endIndex : (group.end ? content.roadmap.findIndex((row) => row[0] === group.end) : content.roadmap.length);
    for (let index = start; index < (end < 0 ? content.roadmap.length : end); index++) {
      const row = content.roadmap[index];
      items.push({
        id: "r_" + index,
        item: row[0],
        tier: row[1],
        depth: row[2],
        frequency: row[3],
        group: group.id,
        groupLabel: group.label
      });
    }
  });
  return items;
}
function roadmapStatus(id) { return data.roadmap[id] === "done"; }
let activeView = "dashboard";
let activeGroup = "weeks1_3";

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "view-" + view));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "instant" });
  render();
}
function renderRoadmap() {
  const query = (document.getElementById("roadSearch").value || "").toLowerCase().trim();
  const tier = document.getElementById("roadTier").value;
  const status = document.getElementById("roadStatus").value;
  const group = document.getElementById("roadGroup").value || activeGroup;
  activeGroup = group;
  const examSafetyNote = document.getElementById("ophthalmology-exam-safety-note");
  if (examSafetyNote) examSafetyNote.hidden = group !== "checklist";
  const groupItems = roadmapItems.filter((item) => item.group === group);
  const visible = groupItems.filter((item) =>
    (!query || (item.item + " " + item.depth + " " + item.frequency).toLowerCase().includes(query)) &&
    (!tier || item.tier === tier) &&
    (!status || (status === "done" ? roadmapStatus(item.id) : !roadmapStatus(item.id)))
  );
  document.getElementById("roadCount").textContent = visible.length + " shown · " + groupItems.length + " in this group";
  document.getElementById("roadRows").innerHTML = visible.map((item) => {
    const done = roadmapStatus(item.id);
    const tone = item.tier === "Core" ? "core" : item.tier === "Expanded" ? "expanded" : item.tier === "Advanced" ? "advanced" : "";
    return "<tr><td><strong>" + esc(item.item) + "</strong></td><td><span class=\"tier " + tone + "\">" + esc(item.tier) + "</span></td><td>" + esc(item.depth) + "</td><td>" + esc(item.frequency) + "</td><td><button class=\"status-toggle " + (done ? "done" : "") + "\" data-road-toggle=\"" + esc(item.id) + "\" " + (readOnlyMode ? "disabled" : "") + ">" + (done ? "✓ Logged" : "○ Mark logged") + "</button></td></tr>";
  }).join("") || "<tr><td colspan=\"5\"><div class=\"empty-state\">No roadmap items match these filters.</div></td></tr>";
}
function fillRoadGroups() {
  const select = document.getElementById("roadGroup");
  const options = groupDefs.map((group) => ({ id: group.id, label: group.label }));
  select.innerHTML = options.map((group) => "<option value=\"" + esc(group.id) + "\">" + esc(group.label) + "</option>").join("");
  select.value = activeGroup;
}
function countEntries() {
  return {
    sessions: data.sessions.length,
    cases: data.cases.length,
    procedures: data.procedures.filter((item) => item.kind !== "discussion" && !Object.prototype.hasOwnProperty.call(item, "topic")).length,
    discussions: data.procedures.filter((item) => item.kind === "discussion" || Object.prototype.hasOwnProperty.call(item, "topic")).length,
    emergencies: data.emergency.length
  };
}
function allEntries() {
  const rows = [];
  data.sessions.forEach((item) => rows.push({ type: "session", item: item }));
  data.cases.forEach((item) => rows.push({ type: "case", item: item }));
  data.procedures.forEach((item) => rows.push({ type: item.kind === "discussion" || Object.prototype.hasOwnProperty.call(item, "topic") ? "discussion" : "procedure", item: item }));
  data.emergency.forEach((item) => rows.push({ type: "emergency", item: item }));
  return rows;
}
function formatRecordTitle(type, item) {
  return item.focus || item.presentation || item.dx || item.procedure || item.topic || item.template || item.complaint ||
    ({ session: "Clinical session", case: "Clinical case", procedure: "Procedure", discussion: "Teaching discussion", emergency: "Emergency exposure" }[type] || "Logbook entry");
}
function renderRecordList(containerId, type) {
  const records = type === "session" ? data.sessions : type === "case" ? data.cases :
    type === "procedure" ? data.procedures.filter((item) => item.kind !== "discussion" && !Object.prototype.hasOwnProperty.call(item, "topic")) :
    type === "discussion" ? data.procedures.filter((item) => item.kind === "discussion" || Object.prototype.hasOwnProperty.call(item, "topic")) :
    data.emergency;
  const container = document.getElementById(containerId);
  if (!records.length) {
    container.innerHTML = "<div class=\"empty-state\">No records yet. Use the add button to create your first entry.</div>";
    return;
  }
  container.innerHTML = records.slice().reverse().map((item) => {
    const title = formatRecordTitle(type, item);
    const detail = [item.date, item.setting, item.role, item.mentor].filter(Boolean).join(" · ");
    return "<article class=\"record-card\"><div class=\"record-main\"><strong>" + esc(title) + "</strong><div class=\"record-meta\"><small>" + esc(detail || item.template || "Saved activity") + "</small></div>" +
      (item.learning || item.reflection || item.takeaways ? "<small>" + esc(item.learning || item.reflection || item.takeaways).slice(0, 180) + "</small>" : "") +
      "</div><div class=\"record-actions\"><button class=\"mini-button\" data-edit=\"" + esc(item.id) + "\" data-type=\"" + type + "\" " + (readOnlyMode ? "disabled" : "") + ">Edit</button><button class=\"mini-button danger\" data-remove=\"" + esc(item.id) + "\" data-type=\"" + type + "\" " + (readOnlyMode ? "disabled" : "") + ">Remove</button></div></article>";
  }).join("");
}
function renderDashboard() {
  const counts = countEntries();
  document.getElementById("statSessions").textContent = String(counts.sessions);
  document.getElementById("statCases").textContent = String(counts.cases);
  document.getElementById("statProcedures").textContent = String(counts.procedures);
  const trackable = roadmapItems.filter((item) => item.tier !== "—");
  const logged = trackable.filter((item) => roadmapStatus(item.id)).length;
  const pct = trackable.length ? Math.round(logged / trackable.length * 100) : 0;
  document.getElementById("statCoverage").textContent = pct + "%";
  document.getElementById("coverageText").textContent = logged + " of " + trackable.length + " roadmap items logged";
  document.getElementById("latestSession").textContent = data.sessions.length ? "Latest: " + (data.sessions[data.sessions.length - 1].date || "—") : "No sessions yet";
  const activity = allEntries().map((row) => ({ type: row.type, item: row.item })).sort((a, b) => String(b.item.date || "").localeCompare(String(a.item.date || ""))).slice(0, 5);
  document.getElementById("recentActivity").innerHTML = activity.length ? activity.map((row) =>
    "<div class=\"activity-row\"><span class=\"activity-dot\"></span><div><strong>" + esc(formatRecordTitle(row.type, row.item)) + "</strong><small>" + esc(row.type) + " · " + esc(row.item.date || "—") + "</small></div></div>"
  ).join("") : "<p class=\"muted\">Nothing logged yet.</p>";
  const next = trackable.filter((item) => !roadmapStatus(item.id)).slice(0, 5);
  document.getElementById("nextFocus").innerHTML = next.length ? next.map((item) =>
    "<div class=\"focus-row\"><div><strong>" + esc(item.item) + "</strong><small>" + esc(item.groupLabel) + "</small></div><button class=\"button secondary\" data-go=\"roadmap\">Open</button></div>"
  ).join("") : "<p class=\"muted\">All course checklist items are logged in this roadmap set.</p>";
}
function renderCourseGuide() {
  const objectives = document.getElementById("courseObjectives");
  const schedule = document.getElementById("weeklySchedule");
  const assessment = document.getElementById("osceAssessment");
  if (objectives) {
    objectives.innerHTML = (content.courseObjectives || []).map((item) => "<li>" + esc(item) + "</li>").join("");
  }
  if (schedule) {
    schedule.innerHTML = (content.weeklySchedule || []).map((block) =>
      "<article class=\"course-week\"><h3>Weeks " + esc(block.weeks) + "</h3><ul>" +
      block.activities.map((activity) => "<li>" + esc(activity) + "</li>").join("") +
      "</ul></article>"
    ).join("");
  }
  const theoryTopics = Array.isArray(content.personalTheoryTopics) ? content.personalTheoryTopics : [];
  const theoryRoot = document.getElementById("personalTheoryRows");
  const theoryProgress = document.getElementById("personalTheoryProgress");
  if (theoryRoot && theoryProgress) {
    const completed = theoryTopics.filter((topic) => data.roadmap["theory:" + topic.id] === "done").length;
    theoryProgress.textContent = completed + " of " + theoryTopics.length + " topics completed";
    theoryRoot.innerHTML = theoryTopics.map((topic) => {
      const done = data.roadmap["theory:" + topic.id] === "done";
      return "<article class=\\\"record-card\\\"><div class=\\\"record-main\\\"><strong>" + esc(topic.title) + "</strong><small>" + esc(topic.id) + " · Personal study tracker</small></div><div class=\\\"record-actions\\\"><button class=\\\"status-toggle " + (done ? "done" : "") + "\\\" data-theory-toggle=\\\"" + esc(topic.id) + "\\\" " + (readOnlyMode ? "disabled" : "") + ">" + (done ? "✓ Completed" : "○ Mark completed") + "</button></div></article>";
    }).join("");
  }
  if (assessment) {
    const a = content.assessment || {};
    const cards = [
      [a.stations || "—", "OSCE stations"],
      [a.minutesPerStation || "—", "Minutes per station"],
      [a.marksPerStation || "—", "Marks per station"],
      [a.totalMarks || "—", "Total marks"]
    ];
    assessment.innerHTML = cards.map(([value, label]) =>
      "<div class=\"assessment-item\"><strong>" + esc(value) + "</strong><span>" + esc(label) + "</span></div>"
    ).join("");
  }
}
function renderEmergencyTemplates() {
  const root = document.getElementById("emergencyTemplates");
  const names = Object.keys(content.emergencyTemplates || {});
  root.innerHTML = names.length ? names.map((name) =>
    "<article class=\"template-card\"><h3>" + esc(name) + "</h3><p>" + content.emergencyTemplates[name].redFlags.slice(0, 2).map(esc).join(" · ") + "</p><button class=\"button secondary\" data-emergency-template=\"" + esc(name) + "\" " + (readOnlyMode ? "disabled" : "") + ">Log emergency</button></article>"
  ).join("") : "<div class=\"empty-state\">No ophthalmology emergency protocols are included in this draft. In real urgent cases, use the local emergency pathway and seek senior help; do not use this logbook as clinical decision support.</div>";
}
function renderEmergencyRows() {
  const root = document.getElementById("emergencyRows");
  root.innerHTML = data.emergency.length ? data.emergency.slice().reverse().map((item) =>
    "<article class=\"record-card\"><div class=\"record-main\"><strong>" + esc(item.template || "Emergency case") + "</strong><small>" + esc([item.date, item.complaint, item.decision].filter(Boolean).join(" · ")) + "</small></div><div class=\"record-actions\"><button class=\"mini-button\" data-edit=\"" + esc(item.id) + "\" data-type=\"emergency\" " + (readOnlyMode ? "disabled" : "") + ">Edit</button><button class=\"mini-button danger\" data-remove=\"" + esc(item.id) + "\" data-type=\"emergency\" " + (readOnlyMode ? "disabled" : "") + ">Remove</button></div></article>"
  ).join("") : "<div class=\"empty-state\">No emergency records yet.</div>";
}
function render() {
  renderDashboard();
  renderCourseGuide();
  renderRoadmap();
  renderRecordList("sessionRows", "session");
  renderRecordList("caseRows", "case");
  renderRecordList("procedureRows", "procedure");
  renderRecordList("discussionRows", "discussion");
  renderEmergencyTemplates();
  renderEmergencyRows();
  const counts = countEntries();
  document.getElementById("sessionCount").textContent = counts.sessions + " entries";
  document.getElementById("caseCount").textContent = counts.cases + " entries";
  document.getElementById("procedureCount").textContent = counts.procedures + " entries";
  document.getElementById("discussionCount").textContent = counts.discussions + " entries";
  document.getElementById("emergencyCount").textContent = counts.emergencies + " entries";
  renderReflection();
  renderMentorReviews();
}
function renderReflection() {
  const form = document.getElementById("reflectionForm");
  ["confident", "limited", "deeper", "next"].forEach((key) => {
    if (form.elements[key] && form.elements[key].value !== (data.reflection[key] || "")) form.elements[key].value = data.reflection[key] || "";
  });
}
function getCollectionsByType(type) {
  if (type === "session") return data.sessions;
  if (type === "case") return data.cases;
  if (type === "procedure" || type === "discussion") return data.procedures;
  return data.emergency;
}
function openEntryDialog(type, existing) {
  if (readOnlyMode) return;
  const dialog = document.getElementById("entryDialog");
  const fields = document.getElementById("dialogFields");
  document.getElementById("dialogTitle").textContent = existing ? "Edit " + type : "New " + type;
  const today = new Date().toISOString().slice(0, 10);
  function input(label, name, value, typeAttr, placeholder) {
    return "<label>" + esc(label) + "<input name=\"" + name + "\" type=\"" + (typeAttr || "text") + "\" value=\"" + esc(value || "") + "\" placeholder=\"" + esc(placeholder || "") + "\"></label>";
  }
  function textarea(label, name, value) {
    return "<label>" + esc(label) + "<textarea name=\"" + name + "\" rows=\"3\">" + esc(value || "") + "</textarea></label>";
  }
  function select(label, name, options, value) {
    return "<label>" + esc(label) + "<select name=\"" + name + "\">" + options.map((option) => "<option value=\"" + esc(option) + "\" " + (option === value ? "selected" : "") + ">" + esc(option) + "</option>").join("") + "</select></label>";
  }
  let html = '<div class="privacy-banner">Do not enter patient-identifying information.</div>';
  if (type === "session") {
    html += '<div class="field-grid">' + select("Course week", "courseWeek", ["Weeks 1–3", "Weeks 4–6", "Weeks 7–9", "Weeks 12–14", "Other / supplementary"], existing && existing.courseWeek || "Weeks 1–3") +
      input("Date", "date", existing && existing.date || today, "date") + input("Duration", "duration", existing && existing.duration || "") +
      input("Mentor / supervisor", "mentor", existing && existing.mentor || "") + select("Clinical setting", "setting", ["Ophthalmology OPD", "Eye ward", "Operating theatre", "Emergency department", "Laser / procedure room", "Teaching / simulation", "Community screening"], existing && existing.setting || "Ophthalmology OPD") + '</div>' +
      input("Main focus", "focus", existing && existing.focus || "") + textarea("Cases encountered (de-identified)", "cases", existing && existing.cases || "") +
      textarea("Procedures / exposure", "exposure", existing && existing.exposure || "") + textarea("Key teaching point", "teaching", existing && existing.teaching || "");
  } else if (type === "case") {
    html += '<div class="field-grid">' + input("Date", "date", existing && existing.date || today, "date") + input("Setting", "setting", existing && existing.setting || "Ophthalmology OPD") + '</div>' +
      input("Clinical presentation", "presentation", existing && existing.presentation || "") + input("Working diagnosis", "dx", existing && existing.dx || "") +
      textarea("Key clinical findings", "findings", existing && existing.findings || "") + textarea("Clinical reasoning / plan discussed", "decision", existing && existing.decision || "") +
      textarea("Learning points", "learning", existing && existing.learning || "") + input("Mentor", "mentor", existing && existing.mentor || "");
  } else if (type === "procedure") {
    html += '<div class="field-grid">' + input("Date", "date", existing && existing.date || today, "date") + input("Examination / test / procedure", "procedure", existing && existing.procedure || "") +
      input("Mentor", "mentor", existing && existing.mentor || "") + select("My role", "role", ["Observed", "Discussed", "Assisted", "Performed under supervision", "Simulation"], existing && existing.role || "Observed") + '</div>' +
      textarea("Purpose / steps observed (de-identified)", "indication", existing && existing.indication || "") + textarea("Learning / reflection", "learning", existing && existing.learning || "");
  } else if (type === "discussion") {
    html += '<div class="field-grid">' + input("Date", "date", existing && existing.date || today, "date") + input("Mentor", "mentor", existing && existing.mentor || "") + '</div>' +
      input("Topic", "topic", existing && existing.topic || "") + textarea("Why was it discussed?", "why", existing && existing.why || "") +
      textarea("Key points and takeaways", "takeaways", existing && existing.takeaways || "") + textarea("Reflection", "reflection", existing && existing.reflection || "");
  } else if (type === "emergency") {
    const templateName = existing && existing.template || document.getElementById("entryDialog").dataset.emergencyTemplate || Object.keys(content.emergencyTemplates)[0];
    const definition = content.emergencyTemplates[templateName] || content.emergencyTemplates[Object.keys(content.emergencyTemplates)[0]];
    html += '<div class="field-grid">' + input("Date", "date", existing && existing.date || today, "date") + input("Chief complaint", "complaint", existing && existing.complaint || "") + '</div>' +
      '<label>Emergency template<select name="template">' + Object.keys(content.emergencyTemplates).map((name) => '<option value="' + esc(name) + '" ' + (name === templateName ? "selected" : "") + ">" + esc(name) + "</option>").join("") + "</select></label>" +
      '<div class="field-grid"><div><strong>Red flags</strong><div class="check-grid">' + definition.redFlags.map((value) => '<label class="check-option"><input type="checkbox" name="redFlags" value="' + esc(value) + '" ' + ((existing && (existing.redFlags || []).includes(value)) ? "checked" : "") + ">" + esc(value) + "</label>").join("") + '</div></div>' +
      '<div><strong>Differential diagnosis</strong><div class="check-grid">' + definition.ddx.map((value) => '<label class="check-option"><input type="checkbox" name="ddx" value="' + esc(value) + '" ' + ((existing && (existing.ddx || []).includes(value)) ? "checked" : "") + ">" + esc(value) + "</label>").join("") + '</div></div></div>' +
      '<div><strong>Initial investigations</strong><div class="check-grid">' + definition.investigations.map((value) => '<label class="check-option"><input type="checkbox" name="investigations" value="' + esc(value) + '" ' + ((existing && (existing.investigations || []).includes(value)) ? "checked" : "") + ">" + esc(value) + "</label>").join("") + '</div></div>' +
      textarea("Key findings", "findings", existing && existing.findings || "") + select("Clinical decision", "decision", ["Observe", "Admit", "Urgent treatment / ICU", "Further evaluation", "Escalate"], existing && existing.decision || "") +
      textarea("Initial management / escalation discussed", "management", existing && existing.management || "") + textarea("Key learning point", "learning", existing && existing.learning || "") + input("Mentor", "mentor", existing && existing.mentor || "");
  }
  fields.innerHTML = html;
  const form = document.getElementById("entryForm");
  form.dataset.type = type;
  form.dataset.editId = existing ? existing.id : "";
  if (!dialog.open) dialog.showModal();
}
function closeEntryDialog() {
  const dialog = document.getElementById("entryDialog");
  if (dialog.open) dialog.close();
  document.getElementById("entryForm").reset();
  delete dialog.dataset.emergencyTemplate;
}
function saveDialogEntry(event) {
  event.preventDefault();
  if (readOnlyMode) return;
  const form = event.currentTarget;
  const type = form.dataset.type;
  const editId = form.dataset.editId || "";
  const fd = new FormData(form);
  const item = {};
  fd.forEach((value, key) => {
    if (["redFlags", "ddx", "investigations"].includes(key)) return;
    item[key] = String(value);
  });
  if (type === "emergency") {
    item.redFlags = fd.getAll("redFlags");
    item.ddx = fd.getAll("ddx");
    item.investigations = fd.getAll("investigations");
  }
  item.id = editId || newId();
  if (type === "procedure" || type === "discussion") item.kind = type;
  const collection = getCollectionsByType(type);
  const index = editId ? collection.findIndex((entry) => entry.id === editId) : -1;
  if (index >= 0) collection[index] = item;
  else collection.push(item);
  save();
  render();
  closeEntryDialog();
}
function removeEntry(type, id) {
  if (readOnlyMode || !window.confirm("Remove this logbook entry?")) return;
  const collection = getCollectionsByType(type);
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return;
  collection.splice(index, 1);
  save();
  render();
}
function exportBackup() {
  if (readOnlyMode) { setStatus("Backup export is disabled in read-only views", true); return; }
  if (instanceId && window.opener && !cloudReady) { setStatus("Wait for the cloud logbook to finish loading", true); return; }
  const blob = new Blob([JSON.stringify({ specialty: "ophthalmology", version: 1, exportedAt: new Date().toISOString(), data: currentCloudState() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mentoro-ophthalmology-logbook-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderMentorReviews() {
  const panel = document.getElementById("mentorReviewPanel");
  if (!readOnlyMode || !instanceId || !window.opener) { panel.hidden = true; panel.innerHTML = ""; return; }
  panel.hidden = false;
  const labels = { session: "Clinical session", case: "Clinical case", procedure: "Procedure", discussion: "Teaching discussion", emergency: "Emergency exposure" };
  const latest = new Map();
  mentorReviews.forEach((review) => latest.set(String(review.item_type) + "::" + String(review.item_id), review));
  const rows = allEntries();
  panel.innerHTML = '<div class="panel-heading"><div><h2>Mentor review</h2><p>Review saved entries. The trainee record remains read-only in this view.</p></div></div>' +
    (reviewMessages._global ? '<p class="review-note">' + esc(reviewMessages._global) + "</p>" : "") +
    (rows.length ? '<div class="review-grid">' + rows.map((row) => {
      const key = row.type + "::" + row.item.id;
      const previous = latest.get(key);
      const isCurrent = previous && previous.is_current === true;
      const pending = reviewPending.has(key);
      const title = formatRecordTitle(row.type, row.item);
      const prior = previous ? '<div class="review-prior"><strong>' + (isCurrent ? "Latest decision: " : "Previous decision — not current: ") + esc(previous.decision) + "</strong>" +
        (!isCurrent ? "<p>Review the current content before relying on this older decision.</p>" : "") +
        (previous.feedback ? "<p>" + esc(previous.feedback) + "</p>" : "") + "</div>" : '<p class="muted">No mentor decision recorded.</p>';
      return '<article class="review-card" data-review-card><h3>' + esc(title) + '</h3><small>' + esc(labels[row.type]) + " · " + esc(row.item.date || "—") + "</small>" + prior +
        '<div class="review-controls"><label>Decision<select data-review-decision><option value="">Choose decision</option><option value="VERIFIED">Verified</option><option value="FEEDBACK">Feedback</option><option value="NEEDS_REVISION">Needs revision</option></select></label>' +
        '<label>Feedback / next steps<textarea data-review-feedback maxlength="2000" placeholder="Required for feedback or revision (5–2,000 characters)."></textarea></label>' +
        '<button class="button primary" type="button" data-review-submit data-review-id="' + esc(row.item.id) + '" data-review-type="' + row.type + '" ' + (pending ? "disabled" : "") + ">" + (pending ? "Saving…" : "Record mentor review") + "</button>" +
        '<p class="review-status" data-review-status role="status">' + esc(reviewMessages[key] || "") + "</p></div></article>";
    }).join("") + "</div>" : '<div class="empty-state">No saved entries are available for review yet.</div>');
}
function applyReadOnly() {
  if (!readOnlyMode) return;
  document.getElementById("readonlyBanner").hidden = false;
  document.querySelectorAll("button").forEach((button) => {
    if (button.hasAttribute("data-view") || button.hasAttribute("data-go") || button.id === "themeButton" ||
        button.id === "dialogClose" || button.id === "dialogCancel" || button.hasAttribute("data-review-submit") ||
        button.hasAttribute("data-road-toggle") || button.id === "printButton") return;
    button.disabled = true;
  });
  document.querySelectorAll("input,textarea,select").forEach((control) => {
    if (control.type === "search" || control.id === "roadTier" || control.id === "roadStatus" || control.id === "roadGroup" ||
        control.hasAttribute("data-review-decision") || control.hasAttribute("data-review-feedback")) return;
    control.disabled = true;
  });
  document.querySelectorAll("form").forEach((form) => {
    if (form.id === "entryForm") form.addEventListener("submit", function (event) { event.preventDefault(); }, true);
    if (form.id === "reflectionForm") form.addEventListener("submit", function (event) { event.preventDefault(); }, true);
  });
}
function render() {
  renderDashboard();
  renderRoadmap();
  renderRecordList("sessionRows", "session");
  renderRecordList("caseRows", "case");
  renderRecordList("procedureRows", "procedure");
  renderRecordList("discussionRows", "discussion");
  renderEmergencyTemplates();
  renderEmergencyRows();
  const counts = countEntries();
  document.getElementById("sessionCount").textContent = counts.sessions + " entries";
  document.getElementById("caseCount").textContent = counts.cases + " entries";
  document.getElementById("procedureCount").textContent = counts.procedures + " entries";
  document.getElementById("discussionCount").textContent = counts.discussions + " entries";
  document.getElementById("emergencyCount").textContent = counts.emergencies + " entries";
  renderReflection();
  renderMentorReviews();
  applyReadOnly();
}
function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setView("roadmap")));
  document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => openEntryDialog(button.dataset.add)));
  document.getElementById("quickAddButton").addEventListener("click", () => openEntryDialog("session"));
  document.getElementById("quickAddHero").addEventListener("click", () => openEntryDialog("session"));
  document.getElementById("exportButton").addEventListener("click", exportBackup);
  document.getElementById("printButton").addEventListener("click", () => window.print());
  document.getElementById("themeButton").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("mentoro_theme", next); } catch (_) {}
    document.getElementById("themeButton").textContent = next === "dark" ? "Light mode" : "Dark mode";
  });
  document.getElementById("roadSearch").addEventListener("input", renderRoadmap);
  ["roadTier", "roadStatus", "roadGroup"].forEach((id) => document.getElementById(id).addEventListener("change", renderRoadmap));
  document.getElementById("personalTheoryRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-theory-toggle]");
    if (!button || readOnlyMode) return;
    const key = "theory:" + button.dataset.theoryToggle;
    if (data.roadmap[key] === "done") delete data.roadmap[key];
    else data.roadmap[key] = "done";
    save();
    renderCourseGuide();
  });
  document.getElementById("roadRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-road-toggle]");
    if (!button || readOnlyMode) return;
    const id = button.dataset.roadToggle;
    if (roadmapStatus(id)) delete data.roadmap[id];
    else data.roadmap[id] = "done";
    save();
    renderRoadmap();
    renderDashboard();
  });
  ["sessionRows", "caseRows", "procedureRows", "discussionRows", "emergencyRows"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit]");
      const remove = event.target.closest("[data-remove]");
      if (edit && !readOnlyMode) {
        const type = edit.dataset.type;
        const item = getCollectionsByType(type).find((row) => row.id === edit.dataset.edit);
        if (item) openEntryDialog(type, item);
      } else if (remove && !readOnlyMode) removeEntry(remove.dataset.type, remove.dataset.remove);
    });
  });
  document.getElementById("emergencyTemplates").addEventListener("click", (event) => {
    const button = event.target.closest("[data-emergency-template]");
    if (!button || readOnlyMode) return;
    document.getElementById("entryDialog").dataset.emergencyTemplate = button.dataset.emergencyTemplate;
    openEntryDialog("emergency");
  });
  document.getElementById("entryForm").addEventListener("submit", saveDialogEntry);
  document.getElementById("dialogClose").addEventListener("click", closeEntryDialog);
  document.getElementById("dialogCancel").addEventListener("click", closeEntryDialog);
  document.getElementById("reflectionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (readOnlyMode) return;
    const fd = new FormData(event.currentTarget);
    data.reflection = { confident: fd.get("confident") || "", limited: fd.get("limited") || "", deeper: fd.get("deeper") || "", next: fd.get("next") || "" };
    save();
    document.getElementById("reflectionStatus").textContent = "Saved";
  });
  document.getElementById("mentorReviewPanel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-submit]");
    if (!button || !readOnlyMode) return;
    const card = button.closest("[data-review-card]");
    const decision = card.querySelector("[data-review-decision]").value;
    const feedback = card.querySelector("[data-review-feedback]").value.trim();
    const id = button.dataset.reviewId;
    const type = button.dataset.reviewType;
    const key = type + "::" + id;
    const status = card.querySelector("[data-review-status]");
    if (!decision) { status.textContent = "Choose a decision first."; return; }
    if (decision !== "VERIFIED" && feedback.length < 5) { status.textContent = "Add at least 5 characters of feedback."; return; }
    if (feedback.length > 2000) { status.textContent = "Feedback must be 2,000 characters or fewer."; return; }
    if (reviewPending.has(key) || !window.opener) return;
    reviewPending.add(key);
    button.disabled = true;
    status.textContent = "Saving review securely…";
    window.opener.postMessage({
      type: "MENTORO_LOGBOOK_MENTOR_REVIEW",
      instanceId: instanceId,
      itemId: id,
      itemType: type,
      decision: decision,
      feedback: feedback
    }, window.location.origin);
  });
}
function receiveParentMessage(event) {
  if (event.origin !== window.location.origin || !window.opener || event.source !== window.opener || !event.data || event.data.instanceId !== instanceId) return;
  const message = event.data;
  if (message.type === "MENTORO_LOGBOOK_LOAD_REVIEWS") {
    mentorReviews = Array.isArray(message.reviews) ? message.reviews : [];
    if (message.error) reviewMessages._global = message.error;
    else delete reviewMessages._global;
    renderMentorReviews();
  } else if (message.type === "MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT") {
    const key = String(message.itemType || "") + "::" + String(message.itemId || "");
    reviewPending.delete(key);
    if (message.ok && message.review) {
      mentorReviews = mentorReviews.filter((review) => String(review.item_type) + "::" + String(review.item_id) !== key);
      mentorReviews.push(message.review);
      reviewMessages[key] = "Mentor review saved successfully.";
    } else {
      reviewMessages[key] = String(message.error || "Could not save this review.");
    }
    renderMentorReviews();
  } else if (message.type === "MENTORO_LOGBOOK_SET_READ_ONLY") {
    readOnlyMode = true;
    render();
    setStatus("Read-only review mode");
  } else if (message.type === "MENTORO_LOGBOOK_LOAD_STATE") {
    readOnlyMode = readOnlyMode || message.readOnly === true;
    let changed = false;
    if (message.hasCloudState && message.state && typeof message.state === "object") {
      const normalized = normalizeState(message.state);
      data = normalized.state;
      changed = normalized.changed;
    } else if (readOnlyMode) {
      // Never expose browser-local trainee data in a mentor review view.
      data = emptyState();
      changed = false;
    } else {
      // Preserve an instance-scoped local cache if an earlier first save was
      // interrupted. Cloud state remains authoritative whenever it exists.
      changed = true;
    }
    cloudReady = true;
    cloudDirty = false;
    lastQueuedSnapshot = JSON.stringify(currentCloudState());
    if (!readOnlyMode) store.set("state", lastQueuedSnapshot);
    setCloudLoading(false);
    render();
    setStatus(readOnlyMode ? "Read-only mentor review loaded" : "Secure cloud logbook connected");
    if (!readOnlyMode && (changed || !message.hasCloudState)) postCloudState(true);
  } else if (message.type === "MENTORO_LOGBOOK_LOAD_ERROR") {
    cloudReady = false;
    setCloudLoading(false);
    setStatus("Cloud connection failed — editing is disabled until reopened", true);
    document.getElementById("workspace").inert = true;
  } else if (message.type === "MENTORO_LOGBOOK_SAVE_RESULT") {
    if (message.ok) {
      if (JSON.stringify(currentCloudState()) === lastQueuedSnapshot) cloudDirty = false;
      setStatus("Saved to secure cloud logbook");
    } else {
      cloudDirty = true;
      setStatus(String(message.error || "Cloud save failed"), true);
    }
  }
}
function startCloudBridge() {
  if (previewMode || !instanceId || !window.opener) {
    setStatus("Standalone preview · browser storage only");
    return;
  }
  setCloudLoading(true);
  setStatus("Connecting to assigned Ophthalmology logbook…");
  window.opener.postMessage({ type: "MENTORO_LOGBOOK_READY", instanceId: instanceId }, window.location.origin);
  window.addEventListener("pagehide", function () {
    if (cloudDirty) postCloudState(true);
  });
}
async function initialize() {
  try {
    const response = await fetch("./content.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Ophthalmology clinical catalogue could not be loaded.");
    content = await response.json();
    if (!Array.isArray(content.roadmap) || content.roadmap.length !== 49) throw new Error("Ophthalmology roadmap catalogue is incomplete.");
    if (!Array.isArray(content.groups) || content.groups.length !== 5) throw new Error("Ophthalmology roadmap groups are incomplete.");
    groupDefs = content.groups;
    activeGroup = groupDefs[0]?.id || "weeks1_3";
    roadmapItems = buildRoadmap();
    fillRoadGroups();
    bindEvents();
    render();
    window.addEventListener("message", receiveParentMessage);
    startCloudBridge();
    if (readOnlyMode) setStatus("Read-only review mode");
    document.getElementById("themeButton").textContent = document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode";
  } catch (error) {
    setStatus(error.message || "Ophthalmology logbook could not start", true);
    document.getElementById("workspace").innerHTML = '<div class="empty-state" role="alert">' + esc(error.message || "Ophthalmology logbook could not start") + "</div>";
  }
}
initialize();
})();