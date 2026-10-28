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
      { key: 'emergency_seen', label: 'Emergency case seen', type: 'boolean' },
      { key: 'case_category', label: '<script>Category</script>', type: 'select', options: ['Medical', 'Surgical'] },
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
  emergency_seen: true,
  case_category: 'Surgical'
});
assert.ok(html.includes('name="payload_clinical_context"'));
assert.ok(html.includes('type="number"'));
assert.ok(html.includes('type="checkbox"'));
assert.ok(html.includes('value="Surgical" selected'));
assert.ok(html.includes('&lt;script&gt;Category&lt;/script&gt;'));
assert.ok(!html.includes('<script>Category</script>'));

const fakeForm = {
  querySelectorAll() {
    return [
      { dataset: { templateField: 'clinical_context', templateType: 'textarea', templateRequired: 'true' }, value: ' Case details ', checkValidity: () => true },
      { dataset: { templateField: 'case_count', templateType: 'number', templateRequired: 'false' }, value: '3.5', checkValidity: () => true },
      { dataset: { templateField: 'emergency_seen', templateType: 'boolean', templateRequired: 'false' }, checked: true },
      { dataset: { templateField: 'case_category', templateType: 'select', templateRequired: 'false' }, value: 'Surgical', options: [{ value: '' }, { value: 'Medical' }, { value: 'Surgical' }] }
    ];
  }
};
const collected = collectTemplatePayload(fakeForm);
assert.deepEqual(collected.errors, []);
assert.deepEqual(collected.payload, {
  clinical_context: 'Case details',
  case_count: 3.5,
  emergency_seen: true,
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

console.log('Schema-driven logbook field rendering, validation, payload persistence, edit support, and safe output passed.');
