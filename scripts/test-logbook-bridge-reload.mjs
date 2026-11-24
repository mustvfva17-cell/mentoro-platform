import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Regression test for the logbook <-> workspace bridge when the workspace tab is reloaded while a
// logbook window stays open (docs/SYSTEM_REVIEW.md, finding 1). The workspace is simulated by
// tests/browser/logbook-bridge-parent-stub.html, which replicates the silent drop in src/main.js;
// the logbook is the real public/logbooks/cardiology page. Each scenario runs in its own browser
// context, so they cannot influence each other.
//
// Covered: no false "saved" status, a visible warning, the edit surviving the next open, the
// "cloud changed elsewhere" conflict (restore / keep), PostgreSQL jsonb key reordering, a save that
// landed without its acknowledgement, and a healthy workspace (no regression).

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');
const stubFile = resolve(projectRoot, 'tests/browser/logbook-bridge-parent-stub.html');
const port = Number(process.env.MENTORO_BRIDGE_TEST_PORT || 4179);
const baseUrl = `http://127.0.0.1:${port}`;

const INSTANCE = '11111111-2222-4333-8444-555555555555';
const CLOUD_KEY = `cloud_${INSTANCE}`;
const PREFIX = `mentoro_training_${INSTANCE}_cardiology_`;
const CACHE_KEY = `${PREFIX}state`;
const META_KEY = `${PREFIX}sync_meta`;
const BACKUP_KEY = `${PREFIX}unsynced_backups`;
const MARKER = 'ORPHANED-MARKER-123';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, baseUrl);
    let file;
    if (pathname === '/parent.html') {
      file = stubFile;
    } else {
      file = resolve(publicRoot, '.' + decodeURIComponent(pathname));
      if (file !== publicRoot && !file.startsWith(publicRoot + sep)) throw new Error('outside public/');
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MENTORO_CHROMIUM_PATH || undefined,
  args: process.env.MENTORO_CHROMIUM_NO_SANDBOX ? ['--no-sandbox'] : []
});

const waitFor = (page, predicate, argument, timeout = 15000) => page.waitForFunction(predicate, argument, { timeout });
const cloudOf = (parent) => parent.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), CLOUD_KEY);
const statusOf = (page) => page.textContent('#syncStatus');
const readJson = (page, key) => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || 'null'), key);

async function openLogbook(context, parent, buttonSelector) {
  const [child] = await Promise.all([context.waitForEvent('page'), parent.click(buttonSelector)]);
  await child.waitForLoadState('load');
  return child;
}
async function editReflection(child, field, text) {
  await child.click('[data-view="progress"]');
  await child.fill(`textarea[name="${field}"]`, text);
  await child.click('#reflectionForm button[type="submit"]');
}

// A fresh workspace + logbook with an acknowledged baseline edit; then the workspace tab is reloaded
// while the logbook window stays open, and an edit is entered that the workspace can no longer receive.
async function orphanScenario(context) {
  const parent = await context.newPage();
  await parent.goto(`${baseUrl}/parent.html`);
  const child = await openLogbook(context, parent, '#openBtn');
  await waitFor(child, () => document.getElementById('syncStatus')?.textContent.includes('Saved to secure cloud'));
  await editReflection(child, 'confident', 'BASELINE-EDIT acknowledged before reload');
  await waitFor(parent, (key) => (JSON.parse(localStorage.getItem(key) || '{}').revision || 0) >= 2, CLOUD_KEY);
  const revBefore = (await cloudOf(parent)).revision;
  await parent.reload();
  await parent.waitForLoadState('load');
  await editReflection(child, 'limited', `${MARKER} entered after parent reload`);
  return { parent, child, revBefore };
}
const waitForWarning = (child) => waitFor(child, () => {
  const node = document.getElementById('syncStatus');
  return node.classList.contains('error') && node.textContent.includes('Not saved to the cloud');
});
const cloudHasMarker = (parent, revisionAbove = 0) => waitFor(parent, (args) => {
  const cloud = JSON.parse(localStorage.getItem(args.key) || '{}');
  return cloud.revision > args.revision && JSON.stringify(cloud.state).includes(args.marker);
}, { key: CLOUD_KEY, revision: revisionAbove, marker: MARKER });

const scenarios = {
  // The workspace is reloaded; the logbook must say so and the edit must survive the next open.
  async A(check, context) {
    const { parent, child, revBefore } = await orphanScenario(context);
    await child.waitForTimeout(2500);
    const early = await statusOf(child);
    check('A1 an unacknowledged edit never claims a cloud save', !early.includes('Saved to secure cloud'), JSON.stringify(early));
    await waitForWarning(child);
    check('A2 a visible "not saved to the cloud" error appears', true, JSON.stringify(await statusOf(child)));
    const meta = await readJson(child, META_KEY);
    check('A3 the unsynced marker is persisted next to the local cache', Boolean(meta && meta.dirty === true), JSON.stringify(meta));
    const cloud = await cloudOf(parent);
    check('A4 the cloud does not have the edit yet', cloud.revision === revBefore && !JSON.stringify(cloud.state).includes(MARKER), `revision ${cloud.revision}`);

    const reopened = await openLogbook(context, parent, '#reopenBtn');
    await waitFor(reopened, () => Boolean(document.getElementById('recoveryNotice')));
    await reopened.click('[data-view="progress"]');
    const limited = await reopened.inputValue('textarea[name="limited"]');
    const confident = await reopened.inputValue('textarea[name="confident"]');
    check('A5 the reopened logbook restored the unsynced edit', limited.includes(MARKER), JSON.stringify(limited));
    check('A6 the reopened logbook kept the acknowledged edit', confident.includes('BASELINE-EDIT'), JSON.stringify(confident));
    await cloudHasMarker(parent, revBefore);
    check('A7 the restored edit reached the cloud', true, `revision ${(await cloudOf(parent)).revision}`);
    await waitFor(reopened, () => document.getElementById('syncStatus')?.textContent.includes('Saved to secure cloud') &&
      (document.getElementById('recoveryNotice')?.textContent || '').includes('restored and saved'));
    const after = await readJson(reopened, META_KEY);
    check('A8 after the acknowledgement the marker is clean and the notice confirms the save', Boolean(after && after.dirty === false), JSON.stringify(after));
  },

  // The cloud also changed elsewhere: keep both versions and let the trainee choose.
  async B(check, context) { await conflictScenario(check, context, 'restore'); },
  async C(check, context) { await conflictScenario(check, context, 'keep'); },

  // PostgreSQL jsonb returns object keys in a different order; recovery must still be recognised.
  async E(check, context) {
    const { parent, child, revBefore } = await orphanScenario(context);
    await waitForWarning(child);
    await child.close();
    await parent.evaluate((key) => {
      const reorder = (value) => {
        if (Array.isArray(value)) return value.map(reorder);
        if (value && typeof value === 'object') {
          const out = {};
          Object.keys(value).reverse().forEach((name) => { out[name] = reorder(value[name]); });
          return out;
        }
        return value;
      };
      const cloud = JSON.parse(localStorage.getItem(key));
      cloud.state = reorder(cloud.state);
      localStorage.setItem(key, JSON.stringify(cloud));
    }, CLOUD_KEY);
    const reopened = await openLogbook(context, parent, '#reopenBtn');
    await waitFor(reopened, () => Boolean(document.getElementById('recoveryNotice') || document.getElementById('conflictNotice')));
    const kind = await reopened.evaluate(() => (document.getElementById('recoveryNotice') ? 'recovery' : 'conflict'));
    check('E1 reordered cloud keys are still recognised as unchanged (no false conflict)', kind === 'recovery', kind);
    await cloudHasMarker(parent, revBefore);
    check('E2 the edit reached the cloud', true, `revision ${(await cloudOf(parent)).revision}`);
  },

  // The save landed but its acknowledgement was lost: nothing to recover, no noise.
  async F(check, context) {
    const { parent, child } = await orphanScenario(context);
    await waitForWarning(child);
    await child.close();
    await parent.evaluate(({ cloudKey, cacheKey }) => {
      const cloud = JSON.parse(localStorage.getItem(cloudKey));
      cloud.state = JSON.parse(localStorage.getItem(cacheKey));
      cloud.revision += 1;
      localStorage.setItem(cloudKey, JSON.stringify(cloud));
    }, { cloudKey: CLOUD_KEY, cacheKey: CACHE_KEY });
    const reopened = await openLogbook(context, parent, '#reopenBtn');
    await waitFor(reopened, () => /Secure cloud logbook connected|Saved to secure cloud/.test(document.getElementById('syncStatus')?.textContent || ''));
    await reopened.click('[data-view="progress"]');
    const kept = await reopened.inputValue('textarea[name="limited"]');
    const quiet = (await reopened.$('#recoveryNotice')) === null && (await reopened.$('#conflictNotice')) === null;
    const meta = await readJson(reopened, META_KEY);
    check('F1 identical local and cloud state: edit kept, no notices, marker clean', kept.includes(MARKER) && quiet && Boolean(meta && meta.dirty === false),
      JSON.stringify({ keptEdit: kept.includes(MARKER), quiet, dirty: meta && meta.dirty }));
  },

  // A healthy workspace still confirms saves, and no false warning appears later.
  async D(check, context) {
    const parent = await context.newPage();
    await parent.goto(`${baseUrl}/parent.html`);
    const child = await openLogbook(context, parent, '#openBtn');
    await waitFor(child, () => document.getElementById('syncStatus')?.textContent.includes('Saved to secure cloud'));
    await editReflection(child, 'confident', 'LIVE-PARENT-EDIT');
    await waitFor(parent, (key) => JSON.stringify(JSON.parse(localStorage.getItem(key) || '{}').state).includes('LIVE-PARENT-EDIT'), CLOUD_KEY);
    await waitFor(child, () => document.getElementById('syncStatus')?.textContent.includes('Saved to secure cloud') && !document.getElementById('syncStatus').classList.contains('error'));
    const meta = await readJson(child, META_KEY);
    check('D1 healthy workspace: edit acknowledged, status saved, marker clean', Boolean(meta && meta.dirty === false), JSON.stringify(await statusOf(child)));
    await child.waitForTimeout(9500);
    check('D2 no false "not saved" warning appears later', !(await statusOf(child)).includes('Not saved'), JSON.stringify(await statusOf(child)));
  }
};

async function conflictScenario(check, context, choice) {
  const tag = choice === 'restore' ? 'B' : 'C';
  const { parent, child } = await orphanScenario(context);
  await waitForWarning(child);
  await child.close();
  // Another device saved in the meantime.
  await parent.evaluate((key) => {
    const cloud = JSON.parse(localStorage.getItem(key));
    cloud.state.reflection = Object.assign({}, cloud.state.reflection, { confident: 'CLOUD-ELSEWHERE' });
    cloud.revision += 1;
    localStorage.setItem(key, JSON.stringify(cloud));
  }, CLOUD_KEY);
  const reopened = await openLogbook(context, parent, '#reopenBtn');
  await waitFor(reopened, () => Boolean(document.getElementById('conflictNotice')));
  await reopened.click('[data-view="progress"]');
  const shownConfident = await reopened.inputValue('textarea[name="confident"]');
  const shownLimited = await reopened.inputValue('textarea[name="limited"]');
  check(`${tag}1 the cloud version is shown while a conflict is pending`, shownConfident === 'CLOUD-ELSEWHERE' && shownLimited === '', JSON.stringify({ shownConfident, shownLimited }));
  const backups = await reopened.evaluate((key) => localStorage.getItem(key) || '', BACKUP_KEY);
  check(`${tag}2 the device edits are preserved in a backup`, backups.includes(MARKER), `backup contains the edit: ${backups.includes(MARKER)}`);

  if (choice === 'restore') {
    await reopened.click('#restoreDeviceEdits');
    await reopened.click('[data-view="progress"]');
    const restored = await reopened.inputValue('textarea[name="limited"]');
    check('B3 "Restore my device edits" brings the edit back', restored.includes(MARKER), JSON.stringify(restored));
    await cloudHasMarker(parent, 0);
    check('B4 the restored edit reached the cloud', true, `revision ${(await cloudOf(parent)).revision}`);
  } else {
    reopened.once('dialog', (dialog) => dialog.accept());
    await reopened.click('#keepCloudVersion');
    await reopened.click('[data-view="progress"]');
    const kept = await reopened.inputValue('textarea[name="limited"]');
    const cloud = await cloudOf(parent);
    check('C3 "Keep the cloud version" leaves the cloud and the form untouched', kept === '' && !JSON.stringify(cloud.state).includes(MARKER), `revision ${cloud.revision}`);
  }
  const left = JSON.parse(await reopened.evaluate((key) => localStorage.getItem(key) || '[]', BACKUP_KEY));
  check(`${tag}5 the resolved backup is removed and the notice is gone`, left.length === 0 && (await reopened.$('#conflictNotice')) === null, `backups left: ${left.length}`);
}

const outcomes = await Promise.all(Object.entries(scenarios).map(async ([name, run]) => {
  const results = [];
  const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail });
  const context = await browser.newContext();
  try {
    await run(check, context);
  } catch (error) {
    check(`${name} scenario completed`, false, error.message.split('\n')[0]);
  } finally {
    await context.close();
  }
  return results;
}));

await browser.close();
server.close();

const all = outcomes.flat().sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
for (const result of all) console.log(`${result.ok ? 'PASS' : 'FAIL'} | ${result.label} | ${result.detail}`);
const failed = all.filter((result) => !result.ok);
console.log(`\n${all.length - failed.length}/${all.length} bridge-reload checks passed.`);
if (failed.length) process.exitCode = 1;
