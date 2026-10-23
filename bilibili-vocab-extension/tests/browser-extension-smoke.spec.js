const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { collectManifestPackEntries } = require('../scripts/pack-extension.js');
const {
  createTempRoot,
  ensureExtensionBuildExists,
  resolveBrowserExecutable,
} = require('./extension-smoke-helpers.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const SUPPORTED_FIXTURE_URL = 'https://www.bilibili.com/fixture.html';
const YOUTUBE_FIXTURE_URL = 'https://www.youtube.com/watch?v=bili-vocab-fixture';
const UNSUPPORTED_FIXTURE_URL = 'https://example.com/bili-vocab-fixture.html';
const AUTHORIZED_OPTIONAL_FIXTURE_URL = 'https://docs.example.com/bili-vocab-optional-fixture.html';
const AUTHORIZED_OPTIONAL_ORIGIN = 'https://docs.example.com/*';
const BILIBILI_SWITCH_FIXTURE_URL = 'https://www.bilibili.com/video/BV1switch111?p=1';
const BILIBILI_SWITCH_FIXTURE_URL_NEXT = 'https://www.bilibili.com/video/BV2switch222?p=1';

function readManifest(rootDir) {
  return JSON.parse(
    fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')
  );
}

function getManifestContentScriptEntry(rootDir) {
  const manifest = readManifest(rootDir);
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  return contentScripts.find((entry) => Array.isArray(entry.js)) || null;
}

function getContentRuntimeScriptFiles(rootDir) {
  const entry = getManifestContentScriptEntry(rootDir);
  return entry && Array.isArray(entry.js) ? entry.js.slice() : [];
}

function getContentRuntimeStyleFiles(rootDir) {
  const entry = getManifestContentScriptEntry(rootDir);
  return entry && Array.isArray(entry.css) ? entry.css.slice() : [];
}

function copyEntryToExtensionRoot(sourceRoot, targetRoot, entryPath) {
  const sourcePath = path.join(sourceRoot, entryPath);
  const targetPath = path.join(targetRoot, entryPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function createPreauthorizedExtensionCopy(originPattern) {
  // Why: browser-level optional permission prompts are not automatable in Playwright.
  const extensionRoot = createTempRoot('bili-vocab-authorized-extension-');
  const entries = collectManifestPackEntries(PROJECT_ROOT);
  entries.forEach((entryPath) => copyEntryToExtensionRoot(PROJECT_ROOT, extensionRoot, entryPath));

  const manifest = readManifest(extensionRoot);
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), originPattern])];
  manifest.web_accessible_resources = (manifest.web_accessible_resources || []).map((resource) => ({
    ...resource,
    matches: [...new Set([...(resource.matches || []), originPattern])],
  }));
  fs.writeFileSync(
    path.join(extensionRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return extensionRoot;
}

function createFixtureHtml(title) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <video controls preload="metadata"></video>
    </main>
  </body>
</html>`;
}

function createOptionalHostFixtureHtml(title) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p id="article">
        这是一个用于测试网页正文模式授权注入的中文段落，包含很多可以被替换的词汇内容。
      </p>
      <p>
        第二段中文内容也应该参与页面模式处理，以便更容易观察到词汇替换。
      </p>
    </main>
  </body>
</html>`;
}

function createBilibiliFixtureHtml(title, identifiers) {
  const cid = Number((identifiers && identifiers.cid) || 0);
  const bvid = String((identifiers && identifiers.bvid) || '').trim();
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <video controls preload="metadata"></video>
    </main>
    <script>
      window.__INITIAL_STATE__ = {
        p: 1,
        videoData: {
          bvid: ${JSON.stringify(bvid)},
          cid: ${JSON.stringify(cid)},
          pages: [{ page: 1, cid: ${JSON.stringify(cid)} }],
        },
      };
    </script>
  </body>
</html>`;
}

async function routeFixturePage(page, url, title) {
  await page.route(url, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: createFixtureHtml(title),
    });
  });
}

async function routeOptionalHostFixturePage(page, url, title) {
  await page.route(url, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: createOptionalHostFixtureHtml(title),
    });
  });
}

async function resolveExtensionId(context) {
  let worker = context.serviceWorkers()[0] || null;
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }

  const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
  assert.ok(match, `Expected extension service worker URL, got ${worker.url()}`);
  return match[1];
}

async function injectContentRuntimeIntoOptionalHost(helperPage) {
  return helperPage.evaluate(
    async ({ scriptFiles, styleFiles }) => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const targetTab = tabs.find((tab) => tab.id !== activeTab.id);
      if (!targetTab || typeof targetTab.id !== 'number') {
        throw new Error('Optional-host injection target tab could not be resolved.');
      }

      await new Promise((resolve, reject) => {
        chrome.scripting.insertCSS(
          {
            target: { tabId: targetTab.id },
            files: styleFiles,
          },
          () => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message || 'insertCSS failed'));
              return;
            }
            resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: targetTab.id },
            files: scriptFiles,
          },
          () => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message || 'executeScript failed'));
              return;
            }
            resolve();
          }
        );
      });

      return targetTab.id;
    },
    {
      scriptFiles: getContentRuntimeScriptFiles(PROJECT_ROOT),
      styleFiles: getContentRuntimeStyleFiles(PROJECT_ROOT),
    }
  );
}

async function readActiveTabSubtitleNavigation(helperPage, targetUrl) {
  return helperPage.evaluate(
    async ({ activeTabUrl, readType }) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const targetTab = tabs.find((tab) => tab.url === activeTabUrl);
      if (!targetTab || typeof targetTab.id !== 'number') {
        throw new Error(`Subtitle navigation target tab missing for ${activeTabUrl}`);
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(targetTab.id, { type: readType }, (response) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || 'tabs.sendMessage failed'));
            return;
          }
          if (!response || response.ok !== true) {
            reject(new Error((response && response.error) || 'subtitle navigation read failed'));
            return;
          }
          resolve(response.payload);
        });
      });
    },
    {
      activeTabUrl: targetUrl,
      readType: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ',
    }
  );
}

async function waitForSubtitleNavigationSnapshot(helperPage, targetUrl, predicate, message) {
  const deadline = Date.now() + 10000;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readActiveTabSubtitleNavigation(helperPage, targetUrl);
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await helperPage.waitForTimeout(150);
  }
  throw new Error(
    message || `Timed out waiting for subtitle navigation snapshot: ${JSON.stringify(lastSnapshot)}`
  );
}

async function setSubtitleNavigationFixture(helperPage, targetUrl, fixture) {
  return helperPage.evaluate(
    async ({ activeTabUrl, nextUrl, runtimeFixture }) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const targetTab = tabs.find((tab) => tab.url === activeTabUrl);
      if (!targetTab || typeof targetTab.id !== 'number') {
        throw new Error(`Subtitle navigation target tab missing for ${activeTabUrl}`);
      }

      await new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: targetTab.id },
            func: ({ updatedUrl, fixturePayload }) => {
              if (updatedUrl) {
                history.pushState({}, '', updatedUrl);
              }

              const video = document.querySelector('video');
              let currentTime = Number(fixturePayload.currentTime) || 0;
              if (video) {
                Object.defineProperty(video, 'currentTime', {
                  configurable: true,
                  get() {
                    return currentTime;
                  },
                  set(value) {
                    currentTime = Number(value) || 0;
                  },
                });
                video.currentTime = currentTime;
              }

              if (globalThis.SubtitleParser) {
                globalThis.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () =>
                  String(fixturePayload.videoKey || '');
                globalThis.SubtitleParser.loadSubtitleTimeline = async () =>
                  Array.isArray(fixturePayload.timeline)
                    ? fixturePayload.timeline.map((item) => ({ ...item }))
                    : [];
              }
            },
            args: [
              {
                updatedUrl: nextUrl,
                fixturePayload: runtimeFixture,
              },
            ],
          },
          () => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message || 'executeScript failed'));
              return;
            }
            resolve();
          }
        );
      });

      return nextUrl || activeTabUrl;
    },
    {
      activeTabUrl: targetUrl,
      nextUrl: fixture.nextUrl || '',
      runtimeFixture: fixture,
    }
  );
}

test('browser extension smoke: should load popup/options and inject overlay on a real page', async () => {
  ensureExtensionBuildExists(PROJECT_ROOT);

  const executablePath = resolveBrowserExecutable();
  const userDataDir = createTempRoot('bili-vocab-extension-smoke-');
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${PROJECT_ROOT}`, `--load-extension=${PROJECT_ROOT}`],
    });

    const extensionId = await resolveExtensionId(context);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
    await optionsPage.waitForSelector('text=字幕学习设置');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await popupPage.waitForSelector('text=字幕学习助手');
    await popupPage.waitForSelector('text=当前字幕导航');

    const contentPage = await context.newPage();
    await routeFixturePage(contentPage, SUPPORTED_FIXTURE_URL, 'Bili Vocab Smoke Fixture');
    await contentPage.goto(SUPPORTED_FIXTURE_URL);
    await contentPage.waitForSelector('#bsv-react-overlay-style', { state: 'attached' });
    await contentPage.waitForSelector('#bsv-react-overlay-root', { state: 'attached' });

    const overlaySnapshot = await contentPage.$eval('#bsv-react-overlay-root', (node) => ({
      childCount: node.childElementCount,
      text: node.textContent || '',
    }));
    assert.ok(overlaySnapshot.childCount > 0);
    assert.match(String(overlaySnapshot.text || ''), /隐藏面板|保存|字幕/);

    const youtubePage = await context.newPage();
    await routeFixturePage(youtubePage, YOUTUBE_FIXTURE_URL, 'YouTube Smoke Fixture');
    await youtubePage.goto(YOUTUBE_FIXTURE_URL);
    await youtubePage.waitForSelector('#bsv-react-overlay-style', { state: 'attached' });
    await youtubePage.waitForSelector('#bsv-react-overlay-root', { state: 'attached' });
    const youtubeOverlaySnapshot = await youtubePage.$eval('#bsv-react-overlay-root', (node) => ({
      childCount: node.childElementCount,
      text: node.textContent || '',
    }));
    assert.ok(youtubeOverlaySnapshot.childCount > 0);
    assert.match(String(youtubeOverlaySnapshot.text || ''), /隐藏面板|保存|字幕/);

    const unsupportedPage = await context.newPage();
    await routeFixturePage(unsupportedPage, UNSUPPORTED_FIXTURE_URL, 'Unsupported Smoke Fixture');
    await unsupportedPage.goto(UNSUPPORTED_FIXTURE_URL);
    await unsupportedPage.waitForLoadState('domcontentloaded');
    assert.equal(await unsupportedPage.locator('#bsv-react-overlay-root').count(), 0);
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('browser extension smoke: should inject shipped content runtime on an authorized optional host', async () => {
  const extensionRoot = createPreauthorizedExtensionCopy(AUTHORIZED_OPTIONAL_ORIGIN);
  const executablePath = resolveBrowserExecutable();
  const userDataDir = createTempRoot('bili-vocab-authorized-host-');
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
    });

    for (const existingPage of context.pages()) {
      if (existingPage.url() === 'about:blank') {
        await existingPage.close();
      }
    }

    const extensionId = await resolveExtensionId(context);

    const contentPage = await context.newPage();
    await routeOptionalHostFixturePage(
      contentPage,
      AUTHORIZED_OPTIONAL_FIXTURE_URL,
      'Authorized Optional Host Fixture'
    );
    await contentPage.goto(AUTHORIZED_OPTIONAL_FIXTURE_URL);
    await contentPage.waitForLoadState('domcontentloaded');
    assert.equal(await contentPage.locator('.bsv-word').count(), 0);
    assert.equal(await contentPage.locator('#bsv-react-overlay-root').count(), 0);

    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    await helperPage.evaluate(async () => {
      const settingsKey = 'bili_vocab_settings_v3';
      const stored = await chrome.storage.local.get(settingsKey);
      const settings = stored[settingsKey];
      if (!settings || !settings.globalControls) {
        throw new Error('Default extension settings have not initialized.');
      }
      await chrome.storage.local.set({
        [settingsKey]: {
          ...settings,
          globalControls: { ...settings.globalControls, webPageEnabled: true },
        },
      });
    });

    const injectedTabId = await injectContentRuntimeIntoOptionalHost(helperPage);
    assert.equal(typeof injectedTabId, 'number');

    await contentPage.waitForSelector('.bsv-word', { state: 'attached' });
    assert.ok((await contentPage.locator('.bsv-word').count()) > 0);
    assert.equal(await contentPage.locator('#bsv-react-overlay-root').count(), 0);
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(extensionRoot, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('browser extension smoke: should refresh subtitle navigation after bilibili video key switches', async () => {
  ensureExtensionBuildExists(PROJECT_ROOT);

  const executablePath = resolveBrowserExecutable();
  const userDataDir = createTempRoot('bili-vocab-switch-smoke-');
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${PROJECT_ROOT}`, `--load-extension=${PROJECT_ROOT}`],
    });

    const extensionId = await resolveExtensionId(context);

    const contentPage = await context.newPage();
    await contentPage.route(BILIBILI_SWITCH_FIXTURE_URL, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: createBilibiliFixtureHtml('Bilibili Switch Fixture One', {
          bvid: 'BV1switch111',
          cid: 11,
        }),
      });
    });
    await contentPage.goto(BILIBILI_SWITCH_FIXTURE_URL);
    await contentPage.waitForSelector('#bsv-react-overlay-root', { state: 'attached' });

    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    let activeTargetUrl = await setSubtitleNavigationFixture(
      helperPage,
      BILIBILI_SWITCH_FIXTURE_URL,
      {
        videoKey: 'BV1switch111:cid:11',
        currentTime: 2.5,
        timeline: [
          { from: 0, to: 1.4, content: '第一个视频第一句' },
          { from: 2.0, to: 4.0, content: '第一个视频第二句' },
        ],
      }
    );

    const firstSnapshot = await waitForSubtitleNavigationSnapshot(
      helperPage,
      activeTargetUrl,
      (snapshot) => snapshot && snapshot.currentText === '第一个视频第二句',
      'Timed out waiting for the first Bilibili subtitle snapshot.'
    );
    assert.equal(firstSnapshot.progressLabel, '2 / 2');

    activeTargetUrl = await setSubtitleNavigationFixture(helperPage, activeTargetUrl, {
      nextUrl: BILIBILI_SWITCH_FIXTURE_URL_NEXT,
      videoKey: 'BV2switch222:cid:22',
      currentTime: 0.8,
      timeline: [
        { from: 0, to: 1.5, content: '第二个视频第一句' },
        { from: 1.6, to: 3.8, content: '第二个视频第二句' },
      ],
    });

    const secondSnapshot = await waitForSubtitleNavigationSnapshot(
      helperPage,
      activeTargetUrl,
      (snapshot) => snapshot && snapshot.currentText === '第二个视频第一句',
      'Timed out waiting for the switched Bilibili subtitle snapshot.'
    );
    assert.equal(secondSnapshot.progressLabel, '1 / 2');
    assert.doesNotMatch(secondSnapshot.currentText, /第一个视频第二句/);
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
