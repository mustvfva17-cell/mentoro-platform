import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = Number(process.env.MENTORO_BROWSER_TEST_PORT || 4178);
const baseUrl = `http://127.0.0.1:${port}`;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const harnessSource = resolve(projectRoot, 'tests/browser/logbook-readonly-harness.html');
const harnessTarget = resolve(distRoot, 'tests/browser/logbook-readonly-harness.html');
const monitorSource = resolve(projectRoot, 'src/enrollment-lifecycle-monitor.js');
const monitorTarget = resolve(distRoot, 'tests/browser/enrollment-lifecycle-monitor.js');

// Vite's build does not copy test fixtures or the isolated lifecycle monitor
// into dist. Stage both so the popup test drives the production monitor helper
// against a deterministic mock status API and exercises the real logbook page.
await mkdir(dirname(harnessTarget), { recursive: true });
await copyFile(harnessSource, harnessTarget);
await copyFile(monitorSource, monitorTarget);

const server = spawn(process.execPath, [
  './node_modules/vite/bin/vite.js',
  'preview',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Vite did not become ready.\n${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });

  const cases = [
    { template: 'medical-oncology', path: '/logbooks/medical-oncology/index.html' },
    { template: 'general-surgery', path: '/logbooks/general-surgery/index.html' },
    { template: 'cardiology', path: '/logbooks/cardiology/index.html' },
    { template: 'neurology', path: '/logbooks/neurology/index.html' },
    { template: 'pediatrics', path: '/logbooks/pediatrics/index.html' },
    { template: 'ophthalmology', path: '/logbooks/ophthalmology/index.html' },
    { template: 'anesthesia-icu', path: '/logbooks/anesthesia-icu/index.html' }
  ];

  for (const testCase of cases) {
    const context = await browser.newContext();
    try {
      const parent = await context.newPage();
      const harnessUrl = `${baseUrl}/tests/browser/logbook-readonly-harness.html?template=${testCase.template}`;
      await parent.goto(harnessUrl, { waitUntil: 'load' });
      const popupPromise = parent.waitForEvent('popup');
      await parent.getByRole('button', { name: 'Open logbook' }).click();
      const logbook = await popupPromise;
      const pageErrors = [];
      logbook.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
      logbook.on('console', (entry) => {
        if (entry.type() === 'error') pageErrors.push('console: ' + entry.text());
      });
      await logbook.waitForLoadState('load');
      await parent.waitForFunction(() => window.mentoroTestCloudStateSent === true, null, { timeout: 3000 });
      // Allow the child window to consume the posted cloud state and render it
      // before the enrollment is closed. Legacy runtimes do not all expose
      // the same sync-status DOM element.
      await sleep(300);

      const closureStatus = testCase.template === 'general-surgery' ? 'CANCELLED' : 'COMPLETED';
      const lifecycleResult = await parent.evaluate(async (status) => {
        const monitor = window.mentoroLifecycleMonitor;
        if (!monitor) throw new Error('Lifecycle monitor was not started');
        const initial = await monitor.initialCheck;
        const transition = await window.mentoroTransitionEnrollment(status);
        return { initial, transition, stopped: monitor.stopped };
      }, closureStatus);
      if (lifecycleResult.initial.status !== 'open' ||
          lifecycleResult.transition.status !== 'closed' ||
          !lifecycleResult.stopped) {
        throw new Error(`Lifecycle monitor did not close enrollment on ${closureStatus}: ${JSON.stringify(lifecycleResult)}`);
      }
      await logbook.waitForFunction(() => {
        const banner = document.getElementById('readonlyBanner');
        const mentorPanel = document.getElementById('mentorReviewPanel') ||
          document.getElementById('mentor-html-mentor-reviews');
        const readOnly = document.body.classList.contains('html-logbook-readonly') ||
          Boolean(banner && !banner.hidden);
        return Boolean(readOnly && mentorPanel && !mentorPanel.hidden);
      }, null, { timeout: 3000 });
      const guardedButtonSelector = ['cardiology', 'neurology', 'ophthalmology'].includes(testCase.template)
        ? '[data-road-toggle], [data-edit], [data-remove], [data-emergency-template], [data-add]'
        : 'button[title="Read-only logbook"]';
      const result = await logbook.evaluate((selector) => {
        const controls = Array.from(document.querySelectorAll('input, textarea, select'))
          .filter((control) =>
            control.type !== 'search' &&
            !['roadSearch', 'roadGroupSelect', 'roadGroup', 'roadTier', 'roadStatus',
              'sessionSearch', 'caseSearch', 'procSearch', 'discussionSearch', 'emergencySearch'].includes(control.id) &&
            !control.hasAttribute('data-review-decision') &&
            !control.hasAttribute('data-review-feedback') &&
            !control.closest('[data-review-card], .mentor-review-item, #mentorReviewPanel, #mentor-html-mentor-reviews'));
        const guardedButtons = Array.from(document.querySelectorAll(selector));
        const readOnlyBanner = document.getElementById('readonlyBanner');
        const bannerVisible = Boolean(readOnlyBanner && !readOnlyBanner.hidden);
        const hasReadOnlyClass = document.body.classList.contains('html-logbook-readonly') || bannerVisible;
        const mentorPanel = document.getElementById('mentorReviewPanel') ||
          document.getElementById('mentor-html-mentor-reviews');
        const mentorReviewCards = Array.from(document.querySelectorAll('[data-review-card]'));
        const mentorReviewControls = Array.from(document.querySelectorAll('[data-review-decision], [data-review-feedback]'));
        return {
          hasReadOnlyClass,
          closedNoticeVisible: hasReadOnlyClass && /read-only/i.test(document.body.innerText),
          mentorReviewVisible: Boolean(mentorPanel && !mentorPanel.hidden) && mentorReviewCards.length > 0,
          mentorReviewCards: mentorReviewCards.length,
          mentorReviewControlCount: mentorReviewControls.length,
          enabledMentorReviewControls: mentorReviewControls.filter((control) => !control.disabled).length,
          controlCount: controls.length,
          enabledControls: controls.filter((control) => !control.disabled).length,
          guardedButtonCount: guardedButtons.length,
          enabledGuardedButtons: guardedButtons.filter((button) => !button.disabled).length
        };
      }, guardedButtonSelector);

      if (!result.hasReadOnlyClass || !result.closedNoticeVisible ||
          result.controlCount === 0 || result.enabledControls !== 0 ||
          result.guardedButtonCount === 0 || result.enabledGuardedButtons !== 0 ||
          !result.mentorReviewVisible || result.mentorReviewCards !== 1 ||
          result.mentorReviewControlCount < 2 ||
          result.enabledMentorReviewControls !== result.mentorReviewControlCount) {
        const diagnostics = await logbook.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          instanceId: new URLSearchParams(window.location.search).get('instance'),
          bodyText: document.body.innerText.slice(0, 1200)
        }));
        throw new Error(`${testCase.template} did not fully switch to read-only mode: ${JSON.stringify({ result, diagnostics, pageErrors })}`);
      }
      console.log(`PASS ${testCase.template}: trainee controls are read-only and Mentor Review stays available`);
    } finally {
      await context.close();
    }
  }
  console.log('HTML logbook lifecycle-to-read-only browser tests passed.');
} catch (error) {
  console.error(error);
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await rm(harnessTarget, { force: true });
  await rm(monitorTarget, { force: true });
  await rmdir(dirname(harnessTarget)).catch(() => {});
  await rmdir(resolve(distRoot, 'tests')).catch(() => {});
}
