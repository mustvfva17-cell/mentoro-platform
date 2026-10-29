import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = Number(process.env.MENTORO_BROWSER_TEST_PORT || 4178);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  './node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
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
    { template: 'general-surgery', path: '/logbooks/general-surgery/index.html' }
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
      await logbook.waitForLoadState('load');

      await parent.evaluate(() => window.mentoroSendClosedMessage());
      await logbook.waitForFunction(() =>
        document.body.classList.contains('html-logbook-readonly') &&
        document.body.innerText.includes('This training is closed. The logbook is read-only.')
      );

      const result = await logbook.evaluate(() => {
        const controls = Array.from(document.querySelectorAll('input, textarea, select'))
          .filter((control) => control.type !== 'search' && control.id !== 'roadGroupSelect');
        const guardedButtons = Array.from(document.querySelectorAll('button[title="Read-only logbook"]'));
        return {
          hasReadOnlyClass: document.body.classList.contains('html-logbook-readonly'),
          closedNoticeVisible: document.body.innerText.includes('This training is closed. The logbook is read-only.'),
          controlCount: controls.length,
          enabledControls: controls.filter((control) => !control.disabled).length,
          guardedButtonCount: guardedButtons.length,
          enabledGuardedButtons: guardedButtons.filter((button) => !button.disabled).length
        };
      });

      if (!result.hasReadOnlyClass || !result.closedNoticeVisible ||
          result.controlCount === 0 || result.enabledControls !== 0 ||
          result.guardedButtonCount === 0 || result.enabledGuardedButtons !== 0) {
        throw new Error(`${testCase.template} did not fully switch to read-only mode: ${JSON.stringify(result)}`);
      }
      console.log(`PASS ${testCase.template}: message-triggered closure disables mutable controls and action buttons`);
    } finally {
      await context.close();
    }
  }
  console.log('HTML logbook read-only browser smoke tests passed.');
} catch (error) {
  console.error(error);
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
