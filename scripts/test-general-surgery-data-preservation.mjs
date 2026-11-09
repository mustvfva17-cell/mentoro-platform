import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'vercel-logbooks/general-surgery/index.html'), 'utf8');
const port = Number(process.env.MENTORO_PRESERVATION_TEST_PORT || 4181);
const baseUrl = `http://127.0.0.1:${port}`;
const dbName = 'mentoro-local-logbooks';
const storeName = 'records';
const licenseId = '11111111-2222-4333-8444-555555555555';
const stateKey = `state:${licenseId}:general-surgery`;
const installationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const deviceId = '99999999-8888-4777-8666-555555555555';
const deviceToken = 'DEV-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const validUntil = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

const legacyState = {
  sessions: [{
    id: 'legacy-session-001', date: '2026-11-08', duration: '2 hours',
    mentor: 'Test Mentor', types: ['Ward'], focus: 'Legacy appendicitis ward round',
    cases: 'Old saved case notes', exposure: 'Observed suturing',
    confidenceAreas: ['History taking'], confidence: '4',
    teaching: 'Reassess the abdomen', initials: 'TM',
    legacyCustomField: 'must-survive-update'
  }],
  cases: [{
    id: 'legacy-case-001', date: '2026-11-07', setting: 'ER',
    presentation: 'Right iliac fossa pain', dx: 'Acute appendicitis',
    findings: 'Localized tenderness', diff: 'Mesenteric adenitis',
    investigations: 'CBC and ultrasound', decision: 'Admit',
    management: 'Surgical assessment', mentor: 'Test Mentor',
    reflection: 'Preserve this clinical reflection'
  }],
  procedures: [{
    id: 'legacy-procedure-001', kind: 'procedure', date: '2026-11-06',
    procedure: 'Basic suturing', condition: 'Wound closure',
    indication: 'Supervised teaching', role: 'Observed',
    before: 'Preparation', after: 'Wound care',
    reflection: 'Old procedure reflection'
  }],
  roadmap: { '0': 'done', r_5: 'done' },
  emergency: [{
    id: 'legacy-emergency-001', template: 'Acute Abdomen',
    date: '2026-11-05', complaint: 'Abdominal pain',
    learning: 'Old emergency learning point'
  }],
  reflection: {
    refAreas: 'Old reflection area', depthOverall: '4',
    refNext: 'Continue supervised exposure',
    customLegacyReflection: 'keep-this-too'
  }
};

const licenseRecord = {
  licenseId, deviceId, deviceToken, installationId,
  traineeLabel: 'Data Preservation Test', licenseHint: 'PRESERVE',
  validUntil, expiresAt: null, deviceLimit: 1, deviceCount: 1,
  offline: false, specialtySlug: 'general-surgery'
};

const server = createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(request.url === '/seed' ? '<!doctype html><title>seed</title>' : html);
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  // Seed a previous release's IndexedDB snapshot before loading the updated app.
  await page.goto(baseUrl + '/seed');
  await page.evaluate(async ({ dbName, storeName, stateKey, licenseRecord, installationId, legacyState }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const records = transaction.objectStore(storeName);
      records.put({ key: 'installation:general-surgery', value: installationId });
      records.put({ key: 'license:general-surgery', value: licenseRecord });
      records.put({ key: stateKey, value: legacyState });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { dbName, storeName, stateKey, licenseRecord, installationId, legacyState });

  await page.route('**/api/license/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        supabaseUrl: 'https://mentoro-preservation-test.supabase.co',
        publishableKey: 'sb_publishable_test_only',
        functionName: 'mentoro-license'
      })
    });
  });
  await page.route('https://mentoro-preservation-test.supabase.co/functions/v1/mentoro-license', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'apikey, content-type',
      'content-type': 'application/json'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }
    const body = request.postDataJSON();
    assert.equal(body.action, 'validate', 'The cached grant should be validated, not reissued.');
    assert.equal(body.installationId, installationId);
    assert.equal(body.deviceToken, deviceToken);
    await route.fulfill({
      status: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true, license_id: licenseId, device_id: deviceId,
        trainee_label: 'Data Preservation Test', license_hint: 'PRESERVE',
        expires_at: null, valid_until: validUntil
      })
    });
  });

  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  await page.waitForFunction(() =>
    Boolean(document.getElementById('mentoroLicenseWatermark')) &&
    Array.isArray(window.data?.sessions) &&
    window.data.sessions.some((entry) => entry.id === 'legacy-session-001') &&
    !document.querySelector('main.content')?.inert,
    null,
    { timeout: 8000 }
  );

  const loaded = await page.evaluate(() => ({
    sessions: window.data.sessions, cases: window.data.cases,
    procedures: window.data.procedures, roadmap: window.data.roadmap,
    emergency: window.data.emergency, reflection: window.data.reflection,
    stateKey: window.MentoroLicenseRuntime.stateKey
  }));
  assert.equal(loaded.stateKey, stateKey);
  assert.equal(loaded.sessions[0].legacyCustomField, 'must-survive-update');
  assert.equal(loaded.cases[0].id, 'legacy-case-001');
  assert.equal(loaded.procedures[0].id, 'legacy-procedure-001');
  assert.equal(loaded.emergency[0].id, 'legacy-emergency-001');
  assert.equal(loaded.roadmap.r_0, 'done');
  assert.equal(loaded.roadmap.r_5, 'done');
  assert.equal(loaded.reflection.customLegacyReflection, 'keep-this-too');

  // Exercise the real Session form and save path after the update.
  await page.evaluate(() => window.openModal('session'));
  await page.locator('#modalForm input[name="focus"]').fill('Session added after the update');
  await page.locator('#modalForm input[name="mentor"]').fill('New Test Mentor');
  await page.locator('#modalForm button.btn.primary').click();

  await page.waitForFunction(async (key) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mentoro-local-logbooks', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise((resolve, reject) => {
      const request = database.transaction('records', 'readonly').objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return Boolean(saved?.sessions?.some((entry) => entry.focus === 'Session added after the update'));
  }, stateKey, { timeout: 8000 });

  // Reload and prove both the old and newly added entries survive.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() =>
    Boolean(document.getElementById('mentoroLicenseWatermark')) &&
    window.data?.sessions?.some((entry) => entry.id === 'legacy-session-001') &&
    window.data?.sessions?.some((entry) => entry.focus === 'Session added after the update'),
    null,
    { timeout: 8000 }
  );

  const afterReload = await page.evaluate(() => ({
    sessions: window.data.sessions, cases: window.data.cases,
    procedures: window.data.procedures, roadmap: window.data.roadmap,
    emergency: window.data.emergency, reflection: window.data.reflection
  }));
  assert.ok(afterReload.sessions.some((entry) => entry.id === 'legacy-session-001'));
  assert.ok(afterReload.sessions.some((entry) => entry.focus === 'Session added after the update'));
  assert.equal(afterReload.sessions.find((entry) => entry.id === 'legacy-session-001').legacyCustomField, 'must-survive-update');
  assert.equal(afterReload.cases[0].id, 'legacy-case-001');
  assert.equal(afterReload.procedures[0].id, 'legacy-procedure-001');
  assert.equal(afterReload.emergency[0].id, 'legacy-emergency-001');
  assert.equal(afterReload.roadmap.r_0, 'done');
  assert.equal(afterReload.reflection.customLegacyReflection, 'keep-this-too');

  const storageInfo = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mentoro-local-logbooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = { version: database.version, stores: Array.from(database.objectStoreNames) };
    database.close();
    return result;
  });
  assert.equal(storageInfo.version, 1, 'The update must not silently bump or recreate the existing IndexedDB database.');
  assert.deepEqual(storageInfo.stores, ['records']);
  assert.deepEqual(pageErrors, [], 'The updated logbook should not produce browser JavaScript errors.');
  console.log('PASS General Surgery: previous IndexedDB progress survives app load, Session save, and page reload.');
  await context.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
