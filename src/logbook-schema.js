export const LOGBOOK_ENTRY_TYPES = Object.freeze([
  { value: 'SESSION', label: 'Clinical session' },
  { value: 'CASE', label: 'Case log' },
  { value: 'PROCEDURE', label: 'Procedure' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'REFLECTION', label: 'Reflection' },
  { value: 'ROADMAP', label: 'Learning roadmap' },
  { value: 'LEARNING_ACTIVITY', label: 'Learning activity' }
]);

const SUPPORTED_TYPES = new Set(['text', 'textarea', 'date', 'number', 'boolean', 'select']);
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function getTemplateFields(templateVersion) {
  const fields = templateVersion?.schema_definition?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field) =>
    field && typeof field === 'object' && !Array.isArray(field) &&
    KEY_PATTERN.test(String(field.key || '')) &&
    typeof field.label === 'string' && field.label.trim().length > 0 &&
    field.label.length <= 160 && SUPPORTED_TYPES.has(field.type) &&
    (field.type !== 'select' || Array.isArray(field.options))
  ).map((field) => ({
    ...field,
    key: String(field.key),
    label: field.label.trim(),
    required: field.required === true,
    options: field.type === 'select'
      ? [...new Set(field.options.filter((option) => typeof option === 'string').map((option) => option.trim()).filter(Boolean))]
      : []
  })).filter((field) => field.type !== 'select' || (field.options.length >= 2 && field.options.length <= 50));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function renderTemplateFields(fields, scopeId, values = {}) {
  if (!fields.length) {
    return '<p class="empty-inline">This logbook version has no supported structured fields yet. Title and activity date are still available.</p>';
  }

  return '<div class="template-field-grid">' + fields.map((field) => {
    const id = 'template-' + String(scopeId).replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + field.key;
    const name = 'payload_' + field.key;
    const value = values && Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : '';
    const required = field.required ? ' required' : '';
    const common = ' id="' + escapeHtml(id) + '" name="' + escapeHtml(name) +
      '" data-template-field="' + escapeHtml(field.key) + '" data-template-type="' + escapeHtml(field.type) +
      '" data-template-required="' + String(field.required) + '"';

    if (field.type === 'boolean') {
      return '<div class="template-field template-field--boolean"><label for="' + escapeHtml(id) + '">' +
        '<input type="checkbox"' + common + (value === true ? ' checked' : '') + '> ' +
        escapeHtml(field.label) + '</label></div>';
    }
    if (field.type === 'select') {
      const options = field.options.map((option) => '<option value="' + escapeHtml(option) + '"' +
        (String(value) === option ? ' selected' : '') + '>' + escapeHtml(option) + '</option>').join('');
      return '<div class="template-field"><label for="' + escapeHtml(id) + '">' + escapeHtml(field.label) +
        (field.required ? ' <span aria-hidden="true">*</span>' : '') + '</label><select' + common + required +
        '><option value="">Choose an option</option>' + options + '</select></div>';
    }
    if (field.type === 'textarea') {
      const rows = clampInteger(field.rows, 3, 2, 10);
      return '<div class="template-field' + (field.wide ? ' template-field--wide' : '') + '"><label for="' +
        escapeHtml(id) + '">' + escapeHtml(field.label) + (field.required ? ' <span aria-hidden="true">*</span>' : '') +
        '</label><textarea' + common + required + ' rows="' + rows + '" maxlength="' +
        clampInteger(field.maxLength, 4000, 1, 10000) + '" placeholder="' +
        escapeHtml(field.placeholder || '') + '">' + escapeHtml(value ?? '') + '</textarea></div>';
    }

    const inputType = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
    const min = field.type === 'number' && Number.isFinite(Number(field.min)) ? ' min="' + escapeHtml(field.min) + '"' : '';
    const max = field.type === 'number' && Number.isFinite(Number(field.max)) ? ' max="' + escapeHtml(field.max) + '"' : '';
    const maxLength = field.type === 'text' ? ' maxlength="' + clampInteger(field.maxLength, 500, 1, 2000) + '"' : '';
    return '<div class="template-field"><label for="' + escapeHtml(id) + '">' + escapeHtml(field.label) +
      (field.required ? ' <span aria-hidden="true">*</span>' : '') + '</label><input type="' + inputType + '"' +
      common + required + min + max + maxLength + ' placeholder="' + escapeHtml(field.placeholder || '') +
      '" value="' + escapeHtml(value ?? '') + '"></div>';
  }).join('') + '</div>';
}

export function collectTemplatePayload(form) {
  const payload = {};
  const errors = [];
  const inputs = form.querySelectorAll('[data-template-field]');

  inputs.forEach((input) => {
    const key = input.dataset.templateField;
    const type = input.dataset.templateType;
    const required = input.dataset.templateRequired === 'true';
    if (!KEY_PATTERN.test(key || '') || !SUPPORTED_TYPES.has(type)) {
      errors.push('A template field is not supported. Reload the page and try again.');
      return;
    }

    if (type === 'boolean') {
      if (required && !input.checked) errors.push('Please confirm: ' + (input.labels?.[0]?.textContent?.trim() || key));
      payload[key] = input.checked;
      return;
    }

    const raw = String(input.value ?? '');
    if (required && !raw.trim()) {
      errors.push('Complete the required field: ' + (input.labels?.[0]?.textContent?.trim() || key));
      return;
    }
    if (!raw.trim()) return;

    if (type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number) || !input.checkValidity()) {
        errors.push('Enter a valid number for: ' + (input.labels?.[0]?.textContent?.trim() || key));
        return;
      }
      payload[key] = number;
      return;
    }
    if (type === 'select' && ![...input.options].some((option) => option.value === raw)) {
      errors.push('Choose a listed option for: ' + (input.labels?.[0]?.textContent?.trim() || key));
      return;
    }
    payload[key] = type === 'textarea' ? raw.trim() : raw.trim();
  });

  return { payload, errors };
}

export function renderPayloadSummary(payload, fields, maxFields = 3) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const labelMap = new Map(fields.map((field) => [field.key, field.label]));
  const items = Object.entries(payload).filter(([key, value]) =>
    KEY_PATTERN.test(key) && value !== null && value !== undefined && value !== '' &&
    (typeof value !== 'object' || Array.isArray(value) === false)
  ).slice(0, maxFields);
  if (!items.length) return '';
  return '<div class="entry-payload-summary">' + items.map(([key, value]) =>
    '<small><strong>' + escapeHtml(labelMap.get(key) || key.replaceAll('_', ' ')) + ':</strong> ' +
    escapeHtml(typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value) + '</small>'
  ).join('') + '</div>';
}
