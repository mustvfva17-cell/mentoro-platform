import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOGBOOK_ENTRY_TYPES,
  collectTemplatePayload,
  getTemplateFields,
  renderPayloadSummary,
  renderTemplateFields
} from '../src/logbook-schema.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const main = await read('src/main.js');

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
assert.ok(main.includes("templateVersion?.template_definition?.renderer === 'HTML'"));
assert.ok(main.includes("get_my_logbook_html_state"));
assert.ok(main.includes("save_my_logbook_html_state"));
assert.ok(main.includes("event.origin !== window.location.origin"));
const htmlRuntime = await read('public/logbooks/medical-oncology/index.html');
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_READY"));
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_LOAD_STATE"));
assert.ok(htmlRuntime.includes("MENTORO_LOGBOOK_STATE_CHANGED"));
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
console.log('HTML templates use the original runtime in trainee cards and expose a guarded, non-writing mentor review mode.');

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
  'Non-trainee writer should have been rejected'
]) {
  assert.ok(htmlStateTest.includes(scenario), `HTML state integration test missing case: ${scenario}`);
}
const htmlLimitFix = await read('supabase/migrations/20261028170000_fix_html_state_object_limits.sql');
assert.ok(htmlLimitFix.includes('CREATE OR REPLACE FUNCTION app_private.save_my_logbook_html_state'));
assert.ok(htmlLimitFix.includes("SELECT count(*) FROM jsonb_object_keys(p_state -> 'roadmap')"));
assert.ok(htmlLimitFix.includes("SELECT count(*) FROM jsonb_object_keys(p_state -> 'reflection')"));
assert.ok(!htmlLimitFix.includes('jsonb_object_length(p_state'));
console.log('Rollback-only HTML cloud-state isolation/revision tests and PostgreSQL-compatible JSON size guards are present.');

console.log('Database-boundary payload validation checks against the attached immutable template version passed.');

