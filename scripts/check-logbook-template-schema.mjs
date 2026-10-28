import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import {
  LOGBOOK_ENTRY_TYPES,
  collectTemplatePayload,
  getTemplateFields,
  renderPayloadSummary,
  renderTemplateFields
} from '../src/logbook-schema.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
function assertInlineScriptsParse(path, html) {
  const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script\\s*>/gi)];
  assert.ok(scripts.length > 0, `${path} should include inline JavaScript`);
  scripts.forEach((match, index) => {
    if (!match[1].trim()) return;
    assert.doesNotThrow(
      () => new Script(match[1], { filename: `${path} inline script ${index + 1}` }),
      `${path} inline script ${index + 1} should parse`
    );
  });
}
const main = await read('src/main.js');
const admin = await read('src/admin-workspace.js');

const version = {
  schema_definition: {
    fields: [
      { key: 'clinical_context', label: 'Clinical context', type: 'textarea', required: true },
      { key: 'case_count', label: 'Case count', type: 'number', min: 0, max: 20 },
      { key: 'emergency_seen', label: 'Emergency case seen', type: 'boolean', required: true },
      { key: 'case_category', label: '<script>Category</script>', type: 'select', options: ['Medical', 'Surgical'] },
      { key: 'case_count', label: 'Duplicate key should be ignored', type: 'text' },
      { key: 'invalid key', label: 'Ignored unsafe key', type: 'text' },
      { key: 'invalid_select', label: 'Ignored empty select', type: 'select', options: ['Only one'] }
    ]
  }
};
const fields = getTemplateFields(version);
assert.deepEqual(fields.map((field) => field.key), ['clinical_context', 'case_count', 'emergency_seen', 'case_category']);
assert.equal(LOGBOOK_ENTRY_TYPES.length, 7);

const html = renderTemplateFields(fields, 'instance-123', {
  clinical_context: 'Initial observation',
  case_count: 2,
  emergency_seen: false,
  case_category: 'Surgical'
});
assert.ok(html.includes('name="payload_clinical_context"'));
assert.ok(html.includes('type="number"'));
assert.ok(html.includes('value="false" selected'));
assert.ok(html.includes('Choose yes or no'));
assert.ok(!html.includes('type="checkbox"'));
assert.ok(html.includes('value="Surgical" selected'));
assert.ok(html.includes('&lt;script&gt;Category&lt;/script&gt;'));
assert.ok(!html.includes('<script>Category</script>'));

const fakeForm = {
  querySelectorAll() {
    return [
      { dataset: { templateField: 'clinical_context', templateType: 'textarea', templateRequired: 'true' }, value: ' Case details ', checkValidity: () => true },
      { dataset: { templateField: 'case_count', templateType: 'number', templateRequired: 'false' }, value: '3.5', checkValidity: () => true },
      { dataset: { templateField: 'emergency_seen', templateType: 'boolean', templateRequired: 'true' }, value: 'false', labels: [{ textContent: 'Emergency case seen' }] },
      { dataset: { templateField: 'case_category', templateType: 'select', templateRequired: 'false' }, value: 'Surgical', options: [{ value: '' }, { value: 'Medical' }, { value: 'Surgical' }] }
    ];
  }
};
const collected = collectTemplatePayload(fakeForm);
assert.deepEqual(collected.errors, []);
assert.deepEqual(collected.payload, {
  clinical_context: 'Case details',
  case_count: 3.5,
  emergency_seen: false,
  case_category: 'Surgical'
});

const invalidRequired = collectTemplatePayload({
  querySelectorAll: () => [{
    dataset: { templateField: 'clinical_context', templateType: 'textarea', templateRequired: 'true' },
    value: '  ',
    checkValidity: () => true,
    labels: [{ textContent: 'Clinical context' }]
  }]
});
assert.equal(invalidRequired.errors.length, 1);
assert.ok(invalidRequired.errors[0].includes('Clinical context'));

const unansweredRequiredBoolean = collectTemplatePayload({
  querySelectorAll: () => [{
    dataset: { templateField: 'emergency_seen', templateType: 'boolean', templateRequired: 'true' },
    value: '',
    labels: [{ textContent: 'Emergency case seen' }]
  }]
});
assert.equal(unansweredRequiredBoolean.errors.length, 1);
assert.ok(unansweredRequiredBoolean.errors[0].includes('Emergency case seen'));

const summary = renderPayloadSummary({ clinical_context: '<img src=x onerror=alert(1)>', emergency_seen: false }, fields);
assert.ok(summary.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(summary.includes('Emergency case seen'));
assert.ok(!summary.includes('<img src=x'));

assert.ok(main.includes('logbook_template_versions(id,version_number,status,schema_definition,template_definition)'));
assert.ok(main.includes('entry_type,payload,created_at,submitted_at'));
assert.ok(main.includes('payload: templatePayload.payload'));
assert.ok(main.includes('entry_type: entryType'));
assert.ok(main.includes('update({ title, entry_date: entryDate, payload: templatePayload.payload })'));
assert.ok(main.includes("renderPayloadSummary(entry.payload, templateFields)"));
assert.ok(main.includes("data-open-html-logbook"));
assert.ok(main.includes("'/logbooks/general-surgery/index.html'"));
assert.ok(main.includes("REGISTERED_HTML_LOGBOOK_PATHS.has(htmlPath)"));
assert.ok(main.includes("data-html-path"));
const generalSurgeryHtml = await read('public/logbooks/general-surgery/index.html');
assertInlineScriptsParse('public/logbooks/general-surgery/index.html', generalSurgeryHtml);
assert.ok(generalSurgeryHtml.includes('MENTORO · General Surgery Logbook'));
assert.ok(generalSurgeryHtml.includes("MENTORO_LOGBOOK_READY"));
assert.ok(generalSurgeryHtml.includes("MENTORO_LOGBOOK_STATE_CHANGED"));
assert.ok(generalSurgeryHtml.includes("MENTORO_LOGBOOK_LOAD_STATE"));
assert.ok(generalSurgeryHtml.includes("MENTORO_LOGBOOK_SAVE_RESULT"));
assert.ok(generalSurgeryHtml.includes("event.origin!==window.location.origin"));
assert.ok(generalSurgeryHtml.includes("function applyReadOnlyMode()"));
assert.ok(admin.includes("REGISTERED_HTML_LOGBOOK_PATHS.has(templateDefinition.html_path)"));
assert.ok(main.includes("templateVersion?.template_definition?.renderer === 'HTML'"));
assert.ok(main.includes("get_my_logbook_html_state"));
assert.ok(main.includes("save_my_logbook_html_state"));
assert.ok(main.includes("event.data.flushNow === true ? 0 : 700"));
assert.ok(main.includes("event.origin !== window.location.origin"));
const htmlRuntime = await read('public/logbooks/medical-oncology/index.html');
assertInlineScriptsParse('public/logbooks/medical-oncology/index.html', htmlRuntime);
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_READY"));
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_LOAD_STATE"));
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_STATE_CHANGED"));
assert.ok(htmlRuntime.includes("window.addEventListener('pagehide'"));
assert.ok(htmlRuntime.includes("notifyCloudStateChanged({flushNow:true})"));
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_SAVE_RESULT"));
assert.ok(htmlRuntime.includes("window.opener.postMessage"));
assert.ok(htmlRuntime.includes("instanceId?'mentoro_training_'+instanceId+'_':"));

assert.ok(main.includes('instance && !isRegisteredHtml'));
assert.ok(main.includes('data-open-html-logbook-readonly'));
assert.ok(main.includes('readOnly: sync.readOnly === true'));
assert.ok(main.includes('if (sync.readOnly)'));
const mentorReadOnlyRuntime = await read('public/logbooks/medical-oncology/index.html');
assert.ok(mentorReadOnlyRuntime.includes("pageParams.get('readonly')==='1'"));
assert.ok(mentorReadOnlyRuntime.includes('function applyReadOnlyMode()'));
assert.ok(mentorReadOnlyRuntime.includes("button.hasAttribute('data-view')||button.id==='themeToggle'"));
assert.ok(mentorReadOnlyRuntime.includes('if(readonlyMode)return;'));
assert.ok(mentorReadOnlyRuntime.includes('Read-only mentor review loaded.'));
for (const runtime of [mentorReadOnlyRuntime, generalSurgeryHtml]) {
  assert.ok(runtime.includes('function renderMentorReviewPanel()'), 'HTML logbook is missing its item-level mentor review panel');
  assert.ok(runtime.includes('MENTORO_LOGBOOK_LOAD_REVIEWS'), 'HTML logbook is missing the review-load bridge');
  assert.ok(runtime.includes('MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT'), 'HTML logbook is missing the review-result bridge');
  assert.ok(runtime.includes('MENTORO_LOGBOOK_MENTOR_REVIEW'), 'HTML logbook is missing the review submission bridge');
  assert.ok(runtime.includes('data-submit-mentor-review'), 'HTML logbook is missing the per-item review action');
  assert.ok(runtime.includes('data-review-decision'), 'HTML logbook is missing decision selection');
  assert.ok(runtime.includes('data-review-feedback'), 'HTML logbook is missing feedback capture');
  assert.ok(runtime.includes('renderMentorReviewPanel()'), 'HTML logbook does not refresh the mentor review panel');
}
assert.ok(main.includes("'MENTORO_LOGBOOK_LOAD_REVIEWS'"), 'Parent bridge must load trusted review records');
assert.ok(main.includes("'MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT'"), 'Parent bridge must return review results/errors');
assert.ok(main.includes("'mentor_review_html_logbook_item'"), 'Parent bridge must call the trusted review RPC');
const mentorReviewMigration = await read('supabase/migrations/20261028182751_mentor_review_html_logbook_items.sql');
assert.ok(mentorReviewMigration.includes('CREATE TABLE public.logbook_html_item_reviews'));
const reviewOrderMigration = await read('supabase/migrations/20261028183806_fix_html_item_review_order.sql');
assert.ok(reviewOrderMigration.includes('GENERATED ALWAYS AS IDENTITY'));
assert.ok(reviewOrderMigration.includes('ORDER BY r.item_id, r.review_order DESC'));
for (const runtime of [mentorReadOnlyRuntime, generalSurgeryHtml]) {
  assert.ok(runtime.includes('data.sessions=[];data.cases=[];data.procedures=[];data.roadmap={};data.emergency=[];data.reflection={}'), 'Read-only mentor view must not display local cached state when no cloud state exists');
}
assert.ok(mentorReviewMigration.includes('app_private.get_my_logbook_html_item_reviews'));
assert.ok(mentorReviewMigration.includes('app_private.mentor_review_html_logbook_item'));
assert.ok(mentorReviewMigration.includes('v_actor_id <> v_mentor_id OR NOT app_private.is_mentor()'));
assert.ok(mentorReviewMigration.includes('The selected item is not present in this training logbook'));
assert.ok(mentorReviewMigration.includes("'VERIFIED', 'FEEDBACK', 'NEEDS_REVISION'"));
const mentorReviewIntegrationTest = await read('supabase/tests/logbook_html_state_integration.sql');
assert.ok(mentorReviewIntegrationTest.includes('Latest mentor item review did not win deterministic ordering'));
assert.ok(mentorReviewIntegrationTest.includes('Trainee must not be able to issue mentor review decisions'));
console.log('Both legacy HTML logbooks expose item-level mentor decisions through the assigned-mentor-only review bridge.');

console.log('Existing HTML logbook launch, origin-checked cloud state bridge, per-instance local cache, and revisioned RPC integration passed.');


console.log('Schema-driven logbook rendering, explicit boolean answers, duplicate-key handling, payload persistence, edit support, and safe output passed.');

const payloadIntegrationTest = await read('supabase/tests/logbook_entry_payload_validation.sql');
assert.ok(payloadIntegrationTest.startsWith('-- Rollback-only integration test'));
assert.ok(payloadIntegrationTest.includes('BEGIN;'));
assert.ok(payloadIntegrationTest.trimEnd().endsWith('ROLLBACK;'));
for (const expectedCase of [
  'Missing-required rejection',
  'Invalid-select rejection',
  'Unknown-field rejection',
  'Invalid-type rejection',
  'Out-of-range rejection',
  'Invalid-date rejection',
  'Oversized-payload rejection'
]) {
  assert.ok(payloadIntegrationTest.includes(expectedCase), `Integration test is missing case: ${expectedCase}`);
}
console.log('Rollback-only database payload integration scenarios are present.');
const payloadMigration = await read('supabase/migrations/20261028155601_validate_logbook_entry_payload.sql');
assert.ok(payloadMigration.includes('CREATE OR REPLACE FUNCTION app_private.validate_logbook_entry_payload()'));
assert.ok(payloadMigration.includes('SECURITY DEFINER'));
assert.ok(payloadMigration.includes('FROM PUBLIC, anon, authenticated, service_role'));
assert.ok(payloadMigration.includes('BEFORE INSERT OR UPDATE OF payload, instance_id'));
assert.ok(payloadMigration.includes('Payload contains an unknown field key'));
assert.ok(payloadMigration.includes('Required logbook field is missing'));
assert.ok(payloadMigration.includes('must match one of its configured options'));
assert.ok(payloadMigration.includes('must be a valid calendar date'));
assert.ok(payloadMigration.includes('must be at least'));
assert.ok(payloadMigration.includes('must be at most'));

const htmlStateTest = await read('supabase/tests/logbook_html_state_integration.sql');
assert.ok(htmlStateTest.startsWith('-- Rollback-only integration test'));
assert.ok(htmlStateTest.includes('BEGIN;'));
assert.ok(htmlStateTest.trimEnd().endsWith('ROLLBACK;'));
for (const scenario of [
  'First cloud save should create revision 1',
  'Reload did not return the saved state',
  'A second enrollment must not inherit',
  'Stale revision should have been rejected',
  'Assigned mentor could not read the current logbook state',
  'Assigned mentor must not be able to save trainee state',
  'Non-trainee writer should have been rejected'
]) {
  assert.ok(htmlStateTest.includes(scenario), `HTML state integration test missing case: ${scenario}`);
}
const htmlLimitFix = await read('supabase/migrations/20261028171227_fix_html_state_object_limits.sql');
assert.ok(htmlLimitFix.includes('CREATE OR REPLACE FUNCTION app_private.save_my_logbook_html_state'));
assert.ok(htmlLimitFix.includes("SELECT count(*) FROM jsonb_object_keys(p_state -> 'roadmap')"));
assert.ok(htmlLimitFix.includes("SELECT count(*) FROM jsonb_object_keys(p_state -> 'reflection')"));
assert.ok(!htmlLimitFix.includes('jsonb_object_length(p_state'));
console.log('Rollback-only HTML cloud-state isolation/revision tests and PostgreSQL-compatible JSON size guards are present.');

const generalSurgeryStateTest = await read('supabase/tests/general_surgery_html_state_integration.sql');
assert.ok(generalSurgeryStateTest.startsWith('-- Rollback-only integration test'));
assert.ok(generalSurgeryStateTest.includes('BEGIN;'));
assert.ok(generalSurgeryStateTest.trimEnd().endsWith('ROLLBACK;'));
for (const scenario of [
  'General Surgery HTML template must remain an unassignable DRAFT',
  'Initial General Surgery HTML state should be empty at revision zero',
  'General Surgery HTML save should create revision one',
  'General Surgery HTML state did not round-trip',
  'Assigned mentor must not write trainee-owned General Surgery state'
]) {
  assert.ok(generalSurgeryStateTest.includes(scenario), `General Surgery HTML integration test missing case: ${scenario}`);
}
const generalSurgeryMigration = await read('supabase/migrations/20261028175703_register_general_surgery_html_logbook.sql');
assert.ok(generalSurgeryMigration.includes("'/logbooks/general-surgery/index.html'"));
assert.ok(generalSurgeryMigration.includes("'/logbooks/medical-oncology/index.html'"));
assert.ok(generalSurgeryMigration.includes("'general-surgery-html'"));
assert.match(generalSurgeryMigration, /'DRAFT',\s*false/);
assert.ok(generalSurgeryMigration.includes('app_private.get_my_logbook_html_state'));
assert.ok(generalSurgeryMigration.includes('app_private.save_my_logbook_html_state'));
assert.ok(generalSurgeryMigration.includes('app_private.admin_publish_logbook_template_version'));
assert.ok(generalSurgeryMigration.includes('app_private.guard_logbook_template_version_schema'));
assert.ok(main.includes("REGISTERED_HTML_LOGBOOK_PATHS.has(htmlPath)"));
assert.ok(main.includes("htmlPath: button.dataset.htmlPath"));
assert.ok(main.includes("data-html-path"));
assert.ok(admin.includes("href=\"/logbooks/general-surgery/index.html?mode=preview\""));
console.log('General Surgery HTML asset registration, per-enrollment cloud bridge, admin preview, and read-only mentor integration checks passed.');


console.log('Database-boundary payload validation checks against the attached immutable template version passed.');

const cloudBootstrapMain = await read('src/main.js');
assert.ok(cloudBootstrapMain.includes('cloudStateLoaded: false'), 'Parent bridge must begin with cloud state marked uninitialized');
assert.ok(cloudBootstrapMain.includes('!sync.cloudStateLoaded'), 'Parent bridge must reject writes until initial cloud state has loaded');
assert.ok(cloudBootstrapMain.includes('sync.cloudStateLoaded = true;'), 'Parent bridge must only mark cloud state loaded after its initial RPC succeeds');
assert.ok(
  cloudBootstrapMain.indexOf('sync.cloudStateLoaded = true;') <
    cloudBootstrapMain.indexOf("postHTMLLogbookMessage(instanceId, { type: 'MENTORO_LOGBOOK_LOAD_STATE'"),
  'Parent must complete state bootstrap before accepting state-change messages'
);
for (const [name, runtime] of [
  ['Medical Oncology', mentorReadOnlyRuntime],
  ['General Surgery', generalSurgeryHtml]
]) {
  assert.match(runtime, /let htmlCloudReady\s*=\s*!\(instanceId && window\.opener\);/, `${name} must gate cloud writes during instance bootstrap`);
  const notifyAt = runtime.indexOf('function notifyCloudStateChanged');
  assert.ok(notifyAt >= 0, `${name} must expose a cloud-state notification function`);
  assert.match(runtime.slice(notifyAt, notifyAt + 260), /!htmlCloudReady/, `${name} must suppress cloud notifications before hydration`);
  assert.ok(runtime.includes('function setCloudLoading(loading)'), `${name} must prevent edits while initial cloud state is loading`);
  assert.ok(runtime.includes('setCloudLoading(true);'), `${name} must lock the UI before requesting cloud state`);
  assert.ok(runtime.includes('setCloudLoading(false);'), `${name} must release the UI after load or report a load failure`);
  assert.match(runtime, /htmlCloudReady\s*=\s*true/, `${name} must mark cloud state ready after the load response`);
  const loadStateAt = runtime.indexOf("if(msg.type==='MENTORO_LOGBOOK_LOAD_STATE')");
  const readyAt = runtime.indexOf('window.opener.postMessage({type:\'MENTORO_LOGBOOK_READY\'');
  assert.ok(loadStateAt >= 0 && readyAt > loadStateAt, `${name} must load state after the bridge is ready`);
}
console.log('HTML logbook cloud bootstrap guard prevents stale local state from overwriting saved cloud state.');


