import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/logbooks/general-surgery/index.html', import.meta.url), 'utf8');

assert.match(html, /onclick="exportLogbook\(\)">Export backup/,
  'General Surgery must expose the JSON backup action.');
assert.match(html, /function exportLogbook\(\)/,
  'General Surgery must implement its JSON backup action.');
assert.match(html, /data:currentCloudState\(\)/,
  'Backups must reflect the current in-memory logbook state.');
assert.match(html, /if\(readonlyMode\)\{[\s\S]*?Backup export is unavailable in read-only review views\./,
  'Backup export must be blocked in read-only review views.');
assert.doesNotMatch(html, /logbookInstanceId/,
  'Portable backups must not expose internal logbook instance IDs.');

const readOnlyGuard = html.match(/function applyReadOnlyMode\(\)\{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(readOnlyGuard && !readOnlyGuard.includes('/export/i.test(inline)'),
  'Read-only mode must disable backup export controls.');

assert.match(html, /instanceId&&window\.opener&&!htmlCloudReady/,
  'A connected logbook must not export before cloud state finishes loading.');
assert.match(html, /MENTORO_LOGBOOK_READY/,
  'The runtime must retain the parent-window cloud handshake.');
assert.match(html, /MENTORO_LOGBOOK_STATE_CHANGED/,
  'The runtime must retain the cloud save bridge.');
assert.match(html, /MENTORO_LOGBOOK_LOAD_STATE/,
  'The runtime must retain cloud state loading.');
assert.match(html, /MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT/,
  'The runtime must retain mentor-review responses.');
assert.match(html, /if\(readonlyMode\)return;/,
  'Read-only mode must continue to block local save mutations.');

console.log('General Surgery runtime contract passed: backup export and cloud bridge are present.');


// The standalone Vercel deployment has its own HTML copy and inline scripts.
// Keep it in syntax validation; the public/ runtime check alone does not cover it.
const standaloneHtml = readFileSync(new URL('../vercel-logbooks/general-surgery/index.html', import.meta.url), 'utf8');
const standaloneScripts = [...standaloneHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(standaloneScripts.length, 2,
  'The standalone General Surgery page must keep its license runtime and app scripts.');
standaloneScripts.forEach((match, index) => {
  assert.ok(match[1].trim(), `Standalone script ${index + 1} must not be empty.`);
  new vm.Script(match[1], { filename: `general-surgery-inline-${index + 1}.js` });
});
assert.doesNotMatch(standaloneHtml, /onclick=&quot;openModal/,
  'Standalone Add buttons must use executable, unescaped inline handlers.');
assert.match(standaloneHtml, /id="moreSheet"[\\s\\S]*?data-view="roadmap"/,
  'The standalone mobile menu must provide a Roadmap shortcut.');

console.log('Standalone General Surgery scripts passed syntax validation.');
