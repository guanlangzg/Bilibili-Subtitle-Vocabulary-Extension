#!/usr/bin/env node
/**
 * Manual browser verification for the learning-data sync feature.
 *
 * Loads the built extension into a real Chromium profile, drives the options page UI,
 * and asserts against the live sync server. Not part of the default test suite because
 * it needs a real browser, a deployed server, and an account token.
 *
 * Required env:
 *   SYNC_E2E_SERVER   e.g. https://sync.example.com
 *   SYNC_E2E_TOKEN    vsc_...
 * Optional:
 *   SYNC_E2E_OUT      artifact directory (screenshots, JSON dumps)
 *   BILI_VOCAB_EXTENSION_BROWSER  browser executable
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright-core');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.SYNC_E2E_OUT || path.join(PROJECT_ROOT, '.tmp-sync-e2e');
const SERVER = process.env.SYNC_E2E_SERVER;
const TOKEN = process.env.SYNC_E2E_TOKEN;
const CLIENT_ID = process.env.SYNC_E2E_CLIENT || 'browser-e2e';

const BROWSER_CANDIDATES = [
  process.env.BILI_VOCAB_EXTENSION_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

function resolveBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No browser executable found. Checked: ${BROWSER_CANDIDATES.join(', ')}`);
}

function readManifest(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')
  );
}

/**
 * Reuse the packaging entry collector: it walks importScripts and HTML assets, so the
 * test copy contains exactly the runtime files a real install has.
 */
function collectEntries(root) {
  const { collectManifestPackEntries } = require('../scripts/pack-extension.js');
  return collectManifestPackEntries(root);
}

/**
 * Playwright cannot answer the optional host-permission prompt, so the test copy grants
 * the sync origin up front. Everything else stays identical to the shipped extension.
 */
function createExtensionCopy(originPattern) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-sync-e2e-ext-'));
  for (const entry of collectEntries(PROJECT_ROOT)) {
    const source = path.join(PROJECT_ROOT, entry);
    const destination = path.join(target, entry);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  const manifest = readManifest(target);
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), originPattern])];
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

async function readStorage(worker) {
  return worker.evaluate(async () => {
    const payload = await chrome.storage.local.get(null);
    return payload;
  });
}

async function sendSyncMessage(page, type, payload) {
  return page.evaluate(
    async ({ type: messageType, payload: messagePayload }) => {
      const response = await chrome.runtime.sendMessage({
        type: messageType,
        payload: messagePayload,
      });
      return response;
    },
    { type, payload }
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  if (!SERVER || !TOKEN) {
    throw new Error('SYNC_E2E_SERVER and SYNC_E2E_TOKEN are required');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const originPattern = `${new URL(SERVER).protocol}//${new URL(SERVER).host}/*`;
  const extensionRoot = createExtensionCopy(originPattern);
  const userDataDir = fs.mkdtempSync(path.join(OUT_DIR, 'profile-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: resolveBrowser(),
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const report = { steps: [] };
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = new URL(worker.url()).host;
    report.extensionId = extensionId;
    report.steps.push({ step: 'extension-loaded' });

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') report.steps.push({ consoleError: message.text() });
    });
    await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
    await page.getByRole('tab', { name: /学习记录同步/ }).click();
    await page.waitForSelector('text=先拉取再上传');
    report.steps.push({ step: 'sync-panel-visible' });
    await page.screenshot({ path: path.join(OUT_DIR, '01-sync-panel.png') });

    // Fill the form through the UI, not by writing storage directly.
    await page.getByLabel('服务器地址').fill(SERVER);
    await page.getByLabel('访问令牌').fill(TOKEN);
    await page.getByLabel('设备标识（可选）').fill(CLIENT_ID);
    await page.getByRole('button', { name: '保存同步配置' }).click();
    try {
      await page.waitForSelector('text=同步配置已保存', { timeout: 15000 });
    } catch (error) {
      fs.writeFileSync(path.join(OUT_DIR, 'save-failure.html'), await page.content());
      await page.screenshot({ path: path.join(OUT_DIR, 'save-failure.png') });
      const bodyText = await page.locator('body').innerText();
      const storageDump = await readStorage(worker);
      console.error('SAVE FAILED. body:', bodyText.slice(0, 1500));
      console.error('storage keys:', Object.keys(storageDump));
      throw error;
    }
    report.steps.push({ step: 'settings-saved' });
    await page.screenshot({ path: path.join(OUT_DIR, '02-settings-saved.png') });

    const stored = await readStorage(worker);
    const syncSettings = stored.bili_vocab_sync_settings_v1;
    assert(syncSettings, 'sync settings should be persisted');
    assert(syncSettings.serverUrl === SERVER, 'server URL should round-trip');
    assert(syncSettings.token === TOKEN, 'token should round-trip');
    report.steps.push({ step: 'settings-persisted' });

    // Check server status through the UI button.
    await page.getByRole('button', { name: '检查服务器状态' }).click();
    await page.waitForSelector('text=服务器现有', { timeout: 15000 });
    report.statusText = await page.locator('text=服务器现有').first().textContent();
    report.steps.push({ step: 'status-checked' });

    // Seed one real learning event through the background message API, then sync.
    const seeded = await sendSyncMessage(page, 'BILI_VOCAB_LEARNING_RECORD_LOOKUP', {
      word: 'state',
      level: 'CET4',
      translation: '状态',
      now: Date.now(),
    });
    assert(seeded && seeded.ok === true, `seed lookup failed: ${JSON.stringify(seeded)}`);
    report.steps.push({ step: 'lookup-seeded' });

    await page.getByRole('button', { name: '立即同步' }).click();
    await page.waitForSelector('text=同步完成', { timeout: 60000 });
    report.syncText = await page.locator('text=同步完成').first().textContent();
    report.steps.push({ step: 'first-sync-done' });
    await page.screenshot({ path: path.join(OUT_DIR, '03-first-sync.png') });

    const afterFirst = await readStorage(worker);
    const settingsAfterFirst = afterFirst.bili_vocab_sync_settings_v1;
    assert(settingsAfterFirst.lastCursor > 0, 'cursor should advance after first sync');
    assert(settingsAfterFirst.lastError === null, 'no error after first sync');
    report.afterFirst = {
      cursor: settingsAfterFirst.lastCursor,
      lastResult: settingsAfterFirst.lastResult,
    };

    // Second sync must be idempotent: no new local or remote facts.
    await page.getByRole('button', { name: '立即同步' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('同步完成'), {
      timeout: 60000,
    });
    report.syncTextSecond = await page.locator('text=同步完成').first().textContent();
    report.steps.push({ step: 'second-sync-done' });

    const afterSecond = await readStorage(worker);
    const settingsAfterSecond = afterSecond.bili_vocab_sync_settings_v1;
    report.afterSecond = {
      cursor: settingsAfterSecond.lastCursor,
      lastResult: settingsAfterSecond.lastResult,
    };
    assert(
      settingsAfterSecond.lastCursor === settingsAfterFirst.lastCursor,
      'second sync must not advance the cursor when nothing changed'
    );
    report.steps.push({ step: 'idempotent-verified' });

    // A bad token must surface an error, not a silent success.
    await page.getByLabel('访问令牌').fill(`vsc_${'z'.repeat(32)}`);
    await page.getByRole('button', { name: '保存同步配置' }).click();
    await page.waitForSelector('text=同步配置已保存', { timeout: 15000 });
    await page.getByRole('button', { name: '立即同步' }).click();
    await page.waitForSelector('[role="alert"]', { timeout: 60000 });
    report.badTokenError = await page.locator('[role="alert"]').first().textContent();
    assert(/401|令牌|unauthorized/i.test(report.badTokenError), 'bad token should report 401');
    report.steps.push({ step: 'bad-token-rejected' });
    await page.screenshot({ path: path.join(OUT_DIR, '04-bad-token.png') });

    // Restore the good token, then verify that facts pushed by another device are pulled in.
    await page.getByLabel('访问令牌').fill(TOKEN);
    await page.getByRole('button', { name: '保存同步配置' }).click();
    await page.waitForSelector('text=同步配置已保存', { timeout: 15000 });

    const remoteEvent = {
      schemaVersion: 1,
      eventId: `e2e-remote-${Date.now()}`,
      deviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      source: 'android',
      wordId: 'word-9ed39e2e-a931-386b-aa98-5a6942ef573e',
      word: 'state',
      type: 'review',
      occurredAt: Date.now() - 60000,
      localDay: new Date(Date.now() - 60000).toISOString().slice(0, 10),
      zoneId: 'Asia/Shanghai',
      utcOffsetMinutes: 0,
      bookCodes: ['CET4'],
      rating: 'good',
      rawAction: 'good',
      durationMs: 3000,
      targetRetention: 0.9,
      algorithm: 'fsrs',
      algorithmVersion: '1.0.0',
      context: null,
      schedule: null,
    };
    const pushResponse = await fetch(`${SERVER}/v1/push`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        bundle: {
          format: 'vocab-learning-data',
          schemaVersion: 1,
          exportedAt: Date.now(),
          events: [remoteEvent],
          baselines: [],
        },
      }),
    });
    assert(pushResponse.ok, `remote push failed: ${pushResponse.status}`);
    report.steps.push({ step: 'remote-event-pushed' });

    const beforePull = await readStorage(worker);
    const localEventsBefore = (beforePull.bili_vocab_learning_data_v1 || {}).bundle.events.length;

    const beforeText = await page.locator('body').innerText();
    await page.getByRole('button', { name: '立即同步' }).click();
    // Wait until the result line changes; the previous one stays in the DOM.
    await page.waitForFunction(
      (previous) => {
        const body = document.body.innerText;
        const index = body.lastIndexOf('同步完成');
        return index >= 0 && body.slice(index) !== previous;
      },
      beforeText.slice(beforeText.lastIndexOf('同步完成')),
      { timeout: 60000 }
    );
    report.pullText = await page.locator('text=同步完成').last().textContent();
    report.steps.push({ step: 'remote-pull-done' });

    const afterPull = await readStorage(worker);
    const localEventsAfter = (afterPull.bili_vocab_learning_data_v1 || {}).bundle.events.length;
    assert(
      localEventsAfter > localEventsBefore,
      `expected imported events, before=${localEventsBefore} after=${localEventsAfter}`
    );
    const imported = (afterPull.bili_vocab_learning_data_v1.bundle.events || []).find(
      (event) => event.eventId === remoteEvent.eventId
    );
    assert(imported, 'remote event should be stored locally');
    assert(imported.source === 'android', 'imported event should keep its source');
    report.afterPull = { localEventsBefore, localEventsAfter };
    await page.screenshot({ path: path.join(OUT_DIR, '05-remote-pull.png') });

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
