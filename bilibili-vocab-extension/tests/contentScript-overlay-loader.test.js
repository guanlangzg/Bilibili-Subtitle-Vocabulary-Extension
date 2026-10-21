const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overlayLoader = require('../overlayLoader.js');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousReactOverlayModule = global.ReactOverlayModule;

global.document = {
  readyState: 'loading',
  addEventListener() {},
  querySelector() {
    return null;
  },
  body: {},
};

global.location = { hostname: 'www.bilibili.com' };

global.chrome = {
  runtime: {
    getURL() {
      return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
    },
  },
  storage: {
    local: {
      get(_defaults, callback) {
        callback({});
      },
    },
    onChanged: {
      addListener() {},
    },
  },
};

const contentScriptPath = require.resolve('../contentScript/index.js');
delete require.cache[contentScriptPath];
const contentScript = require('../contentScript/index.js');

test.beforeEach(() => {
  contentScript.__resetOverlayModuleStateForTest();
  delete global.ReactOverlayModule;
});

test('overlayLoader: should cache imports and reset state', async () => {
  let importCalls = 0;
  const firstModule = { mountOverlayPanel() {} };
  const secondModule = { mountOverlayPanel() {} };
  const controller = overlayLoader.createOverlayLoader({
    shouldLoadForHost() {
      return true;
    },
    importOverlayModule() {
      importCalls += 1;
      return Promise.resolve(importCalls === 1 ? firstModule : secondModule);
    },
    logError() {},
  });

  const firstLoaded = await controller.load();
  const secondLoaded = await controller.load();
  assert.equal(firstLoaded, firstModule);
  assert.equal(secondLoaded, firstModule);
  assert.equal(importCalls, 1);

  controller.reset();
  const thirdLoaded = await controller.load();
  assert.equal(thirdLoaded, secondModule);
  assert.equal(importCalls, 2);
});

test('overlayLoader contract: manifest should load module before contentScript', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const shippedEntry = contentScripts.find((entry) => Array.isArray(entry.js));
  assert.ok(shippedEntry, 'content_scripts entry should exist');

  const overlayLoaderIndex = shippedEntry.js.indexOf('overlayLoader.js');
  const contentScriptIndex = shippedEntry.js.indexOf('contentScript/index.js');
  assert.notEqual(overlayLoaderIndex, -1);
  assert.notEqual(contentScriptIndex, -1);
  assert.ok(overlayLoaderIndex < contentScriptIndex);
});

test('loadOverlayModule: should reuse global overlay module without runtime import', async () => {
  let getUrlCalls = 0;
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
  };
  const sharedModule = {
    mountOverlayPanel() {},
  };
  global.ReactOverlayModule = sharedModule;

  const loaded = await contentScript.loadOverlayModule();

  assert.equal(loaded, sharedModule);
  assert.equal(getUrlCalls, 0);
});

test('loadOverlayModule: should return null when runtime API is unavailable', async () => {
  const currentChrome = global.chrome;
  delete global.chrome;

  const loaded = await contentScript.loadOverlayModule();

  assert.equal(loaded, null);
  global.chrome = currentChrome;
});

test('loadOverlayModule: should skip overlay bundle on optional non-default hosts', async () => {
  let getUrlCalls = 0;
  global.location = { hostname: 'docs.example.com' };
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
  };

  const loaded = await contentScript.loadOverlayModule();

  assert.equal(loaded, null);
  assert.equal(getUrlCalls, 0);
});

test('loadOverlayModule: should cache imported module after first load', async () => {
  let getUrlCalls = 0;
  global.location = { hostname: 'www.bilibili.com' };
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
  };

  const firstLoaded = await contentScript.loadOverlayModule();
  const secondLoaded = await contentScript.loadOverlayModule();

  assert.equal(typeof firstLoaded.mountOverlayPanel, 'function');
  assert.equal(secondLoaded, firstLoaded);
  assert.equal(getUrlCalls, 1);
});

test('loadOverlayModule: should retry import when loaded module is invalid', async () => {
  let getUrlCalls = 0;
  global.location = { hostname: 'www.bilibili.com' };
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20const%20value=1;';
  };

  const firstLoaded = await contentScript.loadOverlayModule();
  const secondLoaded = await contentScript.loadOverlayModule();

  assert.equal(firstLoaded, null);
  assert.equal(secondLoaded, null);
  assert.equal(getUrlCalls, 2);
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.ReactOverlayModule = previousReactOverlayModule;
  delete require.cache[contentScriptPath];
});
