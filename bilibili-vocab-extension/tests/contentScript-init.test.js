const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const contentScriptPath = require.resolve('../contentScript/index.js');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousRequestAnimationFrame = global.requestAnimationFrame;
const previousHTMLVideoElement = global.HTMLVideoElement;
const previousHTMLElement = global.HTMLElement;
const previousMutationObserver = global.MutationObserver;
const previousSubtitleParser = global.SubtitleParser;
const previousSubtitleTranslator = global.SubtitleTranslator;
const previousSubtitleRenderer = global.SubtitleRenderer;
const previousVocabularyModule = global.VocabularyModule;
const previousTooltipModule = global.TooltipModule;
const previousSchedulerModule = global.SchedulerModule;
const previousDanmakuModule = global.DanmakuModule;
const previousReactOverlayModule = global.ReactOverlayModule;
const previousBiliVocabContentRuntime = global.BiliVocabContentRuntime;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HarnessElement {
  constructor(text = '') {
    this.dataset = { originalText: text };
    this.textContent = text;
    this.classList = {
      add() {},
      remove() {},
    };
  }
}

function installRuntime(options = {}) {
  const state = {
    domContentLoadedListener: null,
    observerObserveCalls: 0,
    storageListeners: 0,
    runtimeMessageListeners: 0,
    runtimeConnectListeners: 0,
    loadVocabularyCalls: 0,
    timelineLoadCalls: 0,
    tooltipInitCalls: 0,
    tooltipDestroyCalls: 0,
    overlayMountCalls: 0,
    translatedElements: [],
    storageGetCallbacks: [],
    resolveTranslation: null,
    renderCalls: 0,
  };
  const subtitleElement = new HarnessElement('系统学习');

  global.HTMLElement = HarnessElement;
  global.HTMLVideoElement = class FakeHTMLVideoElement {};
  global.document = {
    readyState: 'loading',
    body: new HarnessElement('body'),
    addEventListener(event, listener) {
      if (event === 'DOMContentLoaded') {
        state.domContentLoadedListener = listener;
      }
    },
    querySelector() {
      return null;
    },
  };
  global.location = { hostname: 'www.bilibili.com' };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.MutationObserver = class MutationObserver {
    disconnect() {}

    observe() {
      state.observerObserveCalls += 1;
    }
  };
  global.chrome = {
    runtime: {
      lastError: options.storageReadLastError || null,
      getURL() {
        return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
      },
      onMessage: {
        addListener() {
          state.runtimeMessageListeners += 1;
        },
      },
      onConnect: {
        addListener() {
          state.runtimeConnectListeners += 1;
        },
      },
    },
    storage: {
      local: {
        get(_defaults, callback) {
          if (options.storageThrows) {
            throw new Error('storage unavailable');
          }
          if (options.deferStorageRead) {
            state.storageGetCallbacks.push(callback);
            return;
          }
          callback(options.storedSettings || {});
        },
        set() {},
      },
      onChanged: {
        addListener() {
          state.storageListeners += 1;
        },
      },
    },
  };
  global.SubtitleParser = {
    getCurrentSubtitleItems() {
      return [
        {
          element: subtitleElement,
          mode: 'subtitle',
          text: '系统学习',
        },
      ];
    },
    async loadSubtitleTimeline() {
      state.timelineLoadCalls += 1;
      return [];
    },
    getSubtitleFromTimelineAtCurrentTime() {
      return '';
    },
    getPrimarySubtitleElement() {
      return null;
    },
    extractSubtitleText(element) {
      return element.dataset.originalText;
    },
    getCurrentSubtitleTimelineCacheKey() {
      return '';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle(text) {
      if (options.deferTranslation) {
        return new Promise((resolve) => {
          state.resolveTranslation = () =>
            resolve({
              mixedText: `translated:${text}`,
              tokens: [{ type: 'word', word: 'system' }],
            });
        });
      }
      return {
        mixedText: `translated:${text}`,
        tokens: [{ type: 'word', word: 'system' }],
      };
    },
    normalizeTargetCefr(value) {
      return value || 'B2';
    },
    createSettingsFingerprint(settings) {
      return JSON.stringify(settings);
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement(element, result) {
      state.renderCalls += 1;
      element.dataset.renderedMixedText = result.mixedText;
      state.translatedElements.push(element);
      return true;
    },
    restoreSubtitleElement() {},
  };
  global.VocabularyModule = {
    async loadVocabulary() {
      state.loadVocabularyCalls += 1;
    },
    recordHit() {},
    refreshLearningStateFromStorage() {
      return Promise.resolve();
    },
  };
  global.TooltipModule = {
    init() {
      state.tooltipInitCalls += 1;
    },
    destroy() {
      state.tooltipDestroyCalls += 1;
    },
  };
  global.SchedulerModule = {
    startEngine() {},
    stopEngine() {},
    pauseEngine() {},
  };
  global.DanmakuModule = {
    clearDanmaku() {},
    destroy() {},
    setSpeedPreset() {},
    initDanmakuContainer() {},
  };
  global.ReactOverlayModule = options.overlayModule || null;

  return { state, subtitleElement };
}

function loadContentScript(options = {}) {
  delete require.cache[contentScriptPath];
  const harness = installRuntime(options);
  const contentScript = require('../contentScript/index.js');
  return { ...harness, contentScript };
}

async function boot(harness) {
  assert.equal(typeof harness.state.domContentLoadedListener, 'function');
  harness.state.domContentLoadedListener();
  await wait(180);
}

test('contentScript init: normal boot should register observer and listeners once', async () => {
  const harness = loadContentScript();
  await boot(harness);

  assert.equal(harness.state.storageListeners, 1);
  assert.equal(harness.state.runtimeMessageListeners, 2);
  assert.equal(
    typeof global.BiliVocabContentRuntime.refreshTranslationsForSelectionStateChange,
    'function'
  );
  assert.equal(harness.state.runtimeConnectListeners, 1);
  assert.equal(harness.state.observerObserveCalls, 1);
  assert.equal(harness.state.loadVocabularyCalls, 1);
  assert.equal(harness.state.timelineLoadCalls, 1);
  assert.equal(harness.state.tooltipInitCalls, 1);
});

test('contentScript lifecycle: teardown before DOMContentLoaded must not re-register runtime', async () => {
  const harness = loadContentScript();

  harness.contentScript.teardownContentRuntime();
  assert.equal(typeof harness.state.domContentLoadedListener, 'function');

  harness.state.domContentLoadedListener();
  await wait(50);

  assert.equal(harness.state.tooltipInitCalls, 0);
  assert.equal(harness.state.observerObserveCalls, 0);
  assert.equal(harness.state.storageListeners, 0);
  assert.equal(harness.state.tooltipDestroyCalls, 1);
});

test('contentScript lifecycle: teardown during an in-flight init must abort remaining boot steps', async () => {
  const harness = loadContentScript({ deferStorageRead: true });

  assert.equal(typeof harness.state.domContentLoadedListener, 'function');
  harness.state.domContentLoadedListener();
  await wait(50);

  assert.equal(harness.state.storageGetCallbacks.length, 1);
  harness.contentScript.teardownContentRuntime();

  harness.state.storageGetCallbacks[0]({});
  await wait(50);

  assert.equal(harness.state.tooltipInitCalls, 0);
  assert.equal(harness.state.observerObserveCalls, 0);
  assert.equal(harness.state.storageListeners, 0);
});

test('contentScript lifecycle: teardown invalidates an in-flight translation render', async () => {
  const harness = loadContentScript({ deferTranslation: true });
  const element = new HarnessElement('系统学习');

  const pending = harness.contentScript.applyTranslation(element, '系统学习');
  await wait(20);

  harness.contentScript.teardownContentRuntime();
  harness.state.resolveTranslation();
  await pending;

  assert.equal(harness.state.renderCalls, 0);
  assert.equal('biliVocabOriginalText' in element.dataset, false);
  assert.equal('biliVocabRenderSignature' in element.dataset, false);
});

test('contentScript init: overlay load failure should keep subtitle processing usable', async () => {
  const harness = loadContentScript({
    overlayModule: {
      mountOverlayPanel() {
        throw new Error('overlay should not be mounted from invalid module');
      },
    },
  });
  await boot(harness);

  assert.equal(harness.subtitleElement.dataset.renderedMixedText, 'translated:系统学习');
  assert.equal(harness.state.translatedElements.length, 1);
});

test('contentScript init: storage read failure should use default settings', async () => {
  const harness = loadContentScript({
    storageReadLastError: { message: 'read failed' },
  });
  await boot(harness);

  assert.equal(harness.subtitleElement.dataset.renderedMixedText, 'translated:系统学习');
});

test('contentScript init: repeated CommonJS init calls should not duplicate storage listeners', async () => {
  const harness = loadContentScript();
  await boot(harness);

  await harness.contentScript.init();

  assert.equal(harness.state.storageListeners, 1);
  assert.equal(harness.state.runtimeMessageListeners, 2);
  assert.equal(harness.state.runtimeConnectListeners, 1);
});

test('contentScript init: duplicate browser injection should short-circuit runtime registration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'contentScript', 'index.js'), 'utf8');
  const runtime = {
    console,
    globalThis: null,
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector() {
        return null;
      },
      body: {},
    },
    chrome: {
      runtime: {
        onMessage: {
          calls: 0,
          addListener() {
            this.calls += 1;
          },
        },
        onConnect: {
          calls: 0,
          addListener() {
            this.calls += 1;
          },
        },
      },
      storage: {
        local: {
          get(_defaults, callback) {
            callback({});
          },
          set() {},
        },
        onChanged: {
          addListener() {},
        },
      },
    },
    location: { hostname: 'www.bilibili.com' },
    MutationObserver: class MutationObserver {
      disconnect() {}

      observe() {}
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    HTMLVideoElement: class HTMLVideoElement {},
    SubtitleParser: {
      getCurrentSubtitleItems() {
        return [];
      },
      async loadSubtitleTimeline() {
        return [];
      },
      getSubtitleFromTimelineAtCurrentTime() {
        return '';
      },
      getPrimarySubtitleElement() {
        return null;
      },
      extractSubtitleText() {
        return '';
      },
      getCurrentSubtitleTimelineCacheKey() {
        return '';
      },
    },
    SubtitleTranslator: {
      async processSubtitle() {
        return { mixedText: '', tokens: [] };
      },
      normalizeTargetCefr(value) {
        return value || 'B2';
      },
    },
    SubtitleRenderer: {
      renderSubtitleElement() {
        return true;
      },
      restoreSubtitleElement() {},
    },
    VocabularyModule: {
      async loadVocabulary() {},
      recordHit() {},
      refreshLearningStateFromStorage() {
        return Promise.resolve();
      },
    },
    TooltipModule: { init() {} },
    SchedulerModule: {
      startEngine() {},
      stopEngine() {},
      pauseEngine() {},
    },
    DanmakuModule: {
      clearDanmaku() {},
      setSpeedPreset() {},
      initDanmakuContainer() {},
    },
    BiliVocabOverlaySubtitleNavigationBridgeRuntime: require('../overlaySubtitleNavigationBridge.js'),
    BiliVocabSubtitleNavigationControllerRuntime: require('../subtitleNavigationController.js'),
    BiliVocabRuntimeSettingsSync: require('../runtimeSettingsSync.js'),
    BiliVocabWebTextReplacement: require('../webTextReplacement.js'),
    BiliVocabOverlayLoader: require('../overlayLoader.js'),
    BiliVocabDanmakuEngine: require('../contentScript/danmaku-engine.js'),
    BiliVocabSubtitleNavigationBridge: require('../contentScript/subtitle-navigation-bridge.js'),
    BiliVocabContentConstants: require('../contentScript/constants.js'),
    BiliVocabTranslationPipeline: require('../contentScript/translation-pipeline.js'),
    BiliVocabDomObserver: require('../contentScript/dom-observer.js'),
  };
  runtime.globalThis = runtime;
  vm.createContext(runtime);

  vm.runInContext(source, runtime);
  vm.runInContext(source, runtime);

  assert.equal(runtime.chrome.runtime.onMessage.calls, 2);
  assert.equal(typeof runtime.BiliVocabContentRuntime.teardownContentRuntime, 'function');
  assert.equal(runtime.chrome.runtime.onConnect.calls, 1);
});

test.after(() => {
  delete require.cache[contentScriptPath];
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.requestAnimationFrame = previousRequestAnimationFrame;
  global.HTMLVideoElement = previousHTMLVideoElement;
  global.HTMLElement = previousHTMLElement;
  global.MutationObserver = previousMutationObserver;
  global.SubtitleParser = previousSubtitleParser;
  global.SubtitleTranslator = previousSubtitleTranslator;
  global.SubtitleRenderer = previousSubtitleRenderer;
  global.VocabularyModule = previousVocabularyModule;
  global.TooltipModule = previousTooltipModule;
  global.SchedulerModule = previousSchedulerModule;
  global.DanmakuModule = previousDanmakuModule;
  global.ReactOverlayModule = previousReactOverlayModule;
  global.BiliVocabContentRuntime = previousBiliVocabContentRuntime;
});
