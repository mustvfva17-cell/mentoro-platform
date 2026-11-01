import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/logbooks/general-surgery/index.html', import.meta.url), 'utf8');

assert.match(html, /onclick="exportLogbook\\(\\)">Export backup/,
  'General Surgery must expose the JSON backup action.');
assert.match(html, /function exportLogbook\\(\\)/,
  'General Surgery must implement its JSON backup action.');
assert.match(html, /data:currentCloudState\\(\\)/,
  'Backups must reflect the current in-memory logbook state.');
assert.match(html, /if\\(readonlyMode\\)\\{[\\s\\S]*?Backup export is unavailable in read-only review views\\./,
  'Backup export must be blocked in read-only review views.');
assert.doesNotMatch(html, /logbookInstanceId/,
  'Portable backups must not expose internal logbook instance IDs.');

const readOnlyGuard = html.match(/function applyReadOnlyMode\\(\\)\\{([\\s\\S]*?)\\n\\}/)?.[1] || '';
assert.ok(readOnlyGuard && !readOnlyGuard.includes('/export/i.test(inline)'),
  'Read-only mode must disable backup export controls.');

assert.match(html, /instanceId&&window\\.opener&&!htmlCloudReady/,
  'A connected logbook must not export before cloud state finishes loading.');
assert.match(html, /MENTORO_LOGBOOK_READY/,
  'The runtime must retain the parent-window cloud handshake.');
assert.match(html, /MENTORO_LOGBOOK_STATE_CHANGED/,
  'The runtime must retain the cloud save bridge.');
assert.match(html, /MENTORO_LOGBOOK_LOAD_STATE/,
  'The runtime must retain cloud state loading.');
assert.match(html, /MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT/,
  'The runtime must retain mentor-review responses.');
assert.match(html, /if\\(readonlyMode\\)return;/,
  'Read-only mode must continue to block local save mutations.');

console.log('General Surgery runtime contract passed: backup export and cloud bridge are present.');
