const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousRequestAnimationFrame = global.requestAnimationFrame;
const previousMutationObserver = global.MutationObserver;
const previousHTMLVideoElement = global.HTMLVideoElement;
const previousSubtitleParser = global.SubtitleParser;
const previousSubtitleRenderer = global.SubtitleRenderer;
const previousSubtitleTranslator = global.SubtitleTranslator;
const previousVocabularyModule = global.VocabularyModule;
const previousTooltipModule = global.TooltipModule;
const previousSchedulerModule = global.SchedulerModule;
const previousDanmakuModule = global.DanmakuModule;

const contentScriptPath = require.resolve('../contentScript/index.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(options = {}) {
  const state = {
    getCurrentSubtitleItemsCalls: 0,
    processSubtitleCalls: 0,
    primaryElementCalls: 0,
    observeTargets: [],
  };
  const subtitleItems = options.subtitleItems || [
    {
      element: { dataset: { originalText: '原句' } },
      mode: 'subtitle',
      text: '原句',
    },
  ];
  let currentSubtitleContainer = options.subtitleContainer || null;
  let domContentLoadedListener = null;
  const observers = [];
  let observerReadyResolve;
  const observerReady = new Promise((resolve) => {
    observerReadyResolve = resolve;
  });

  class HarnessMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnectCalls = 0;
      observers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      state.observeTargets.push(target);
      if (observerReadyResolve) {
        observerReadyResolve();
        observerReadyResolve = null;
      }
    }

    disconnect() {
      this.disconnectCalls += 1;
    }
  }

  global.document = {
    readyState: 'loading',
    addEventListener(event, listener) {
      if (event === 'DOMContentLoaded') {
        domContentLoadedListener = listener;
      }
    },
    querySelector(selector) {
      if (selector === '.bpx-player-subtitle-wrap') {
        return currentSubtitleContainer;
      }
      if (selector === 'video') {
        return null;
      }
      return null;
    },
    body: { nodeName: 'BODY' },
  };

  global.chrome = {
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
  };

  global.location = { hostname: 'www.bilibili.com' };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.MutationObserver = HarnessMutationObserver;
  global.HTMLVideoElement = class FakeHTMLVideoElement {};
  global.SubtitleParser = {
    getCurrentSubtitleItems() {
      state.getCurrentSubtitleItemsCalls += 1;
      return subtitleItems;
    },
    async loadSubtitleTimeline() {
      return [];
    },
    getSubtitleFromTimelineAtCurrentTime() {
      return options.fallbackText || '';
    },
    getPrimarySubtitleElement() {
      state.primaryElementCalls += 1;
      return null;
    },
    extractSubtitleText(element) {
      return element && element.dataset && element.dataset.originalText
        ? element.dataset.originalText
        : '原句';
    },
    getCurrentSubtitleTimelineCacheKey() {
      return '';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle(text) {
      state.processSubtitleCalls += 1;
      return {
        mixedText: `translated ${text}`,
        tokens: [{ type: 'word', word: 'translated' }],
      };
    },
    normalizeTargetCefr(value) {
      return value || 'B2';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement(element, _result, sourceText) {
      if (element && element.dataset) {
        element.dataset.biliVocabOriginalText = sourceText;
      }
      return true;
    },
    restoreSubtitleElement() {},
  };
  global.VocabularyModule = {
    async loadVocabulary() {},
    recordHit() {},
    refreshLearningStateFromStorage() {
      return Promise.resolve();
    },
  };
  global.TooltipModule = {
    init() {},
  };
  global.SchedulerModule = {
    startEngine() {},
    stopEngine() {},
    pauseEngine() {},
  };
  global.DanmakuModule = {
    clearDanmaku() {},
    setSpeedPreset() {},
    initDanmakuContainer() {},
  };

  delete require.cache[contentScriptPath];
  require('../contentScript/index.js');

  async function boot() {
    assert.equal(typeof domContentLoadedListener, 'function');
    domContentLoadedListener();
    await observerReady;
    await wait(220);
    state.getCurrentSubtitleItemsCalls = 0;
    state.processSubtitleCalls = 0;
    state.primaryElementCalls = 0;
  }

  function triggerMutation(times = 1) {
    for (let i = 0; i < times; i += 1) {
      const observer = observers[observers.length - 1];
      assert.ok(observer, 'expected mutation observer to exist');
      observer.callback();
    }
  }

  function setSubtitleContainer(nextContainer) {
    currentSubtitleContainer = nextContainer;
  }

  return {
    boot,
    state,
    observers,
    triggerMutation,
    setSubtitleContainer,
    getObservedTargets() {
      return state.observeTargets.slice();
    },
  };
}

test('contentScript observer throttle: should collapse a burst of mutations into one process run', async () => {
  const harness = createHarness();
  await harness.boot();

  harness.triggerMutation(10);
  await wait(50);

  assert.equal(harness.state.getCurrentSubtitleItemsCalls, 1);
});

test('contentScript observer throttle: should allow a new mutation after the throttle window', async () => {
  const harness = createHarness();
  await harness.boot();

  harness.triggerMutation(1);
  await wait(50);
  assert.equal(harness.state.getCurrentSubtitleItemsCalls, 1);

  await wait(520);
  harness.triggerMutation(1);
  await wait(50);

  assert.equal(harness.state.getCurrentSubtitleItemsCalls, 2);
});

test('contentScript observer throttle: should rebind when the subtitle container appears', async () => {
  const subtitleContainer = { nodeName: 'DIV', id: 'subtitle-container' };
  const harness = createHarness();
  await harness.boot();

  assert.equal(harness.getObservedTargets()[0], harness.observers[0].target);
  assert.equal(harness.getObservedTargets()[0], global.document.body);

  harness.setSubtitleContainer(subtitleContainer);
  harness.triggerMutation(1);
  await wait(20);

  const observedTargets = harness.getObservedTargets();
  assert.equal(observedTargets.length >= 2, true);
  assert.equal(observedTargets[observedTargets.length - 1], subtitleContainer);
});

test('contentScript observer throttle: should stay quiet on pages without subtitles', async () => {
  const harness = createHarness({ subtitleItems: [] });
  await harness.boot();

  harness.triggerMutation(10);
  await wait(50);

  assert.equal(harness.state.getCurrentSubtitleItemsCalls, 1);
  assert.equal(harness.state.processSubtitleCalls, 0);
});

test('contentScript observer throttle: should skip the primary element probe when the timeline has no text', async () => {
  const harness = createHarness({ subtitleItems: [] });
  await harness.boot();

  harness.triggerMutation(1);
  await wait(50);

  assert.equal(harness.state.getCurrentSubtitleItemsCalls, 1);
  assert.equal(harness.state.primaryElementCalls, 0);
});

test('contentScript observer throttle: should still probe the primary element when the timeline has text', async () => {
  const harness = createHarness({ subtitleItems: [], fallbackText: '时间轴字幕' });
  await harness.boot();

  harness.triggerMutation(1);
  await wait(50);

  assert.equal(harness.state.primaryElementCalls, 1);
});

test('contentScript lifecycle: a destroyed frame batch must not restore page elements', async () => {
  const { createDomObserver } = require('../contentScript/dom-observer.js');
  const frameCallbacks = [];
  const restore = global.SubtitleRenderer;
  const parser = global.SubtitleParser;
  const frame = global.requestAnimationFrame;
  let restores = 0;
  global.SubtitleParser = {
    getCurrentSubtitleItems: () => [{ element: {}, text: '原文', mode: 'page' }],
  };
  global.SubtitleRenderer = { restoreSubtitleElement: () => restores++ };
  global.requestAnimationFrame = (callback) => frameCallbacks.push(callback);
  const observer = createDomObserver({
    getSettings: () => ({ webPageEnabled: false }),
    isCurrentSiteEnabled: () => true,
  });
  try {
    const pending = observer.processSubtitles();
    assert.equal(frameCallbacks.length, 1);
    observer.destroy();
    frameCallbacks[0]();
    await pending;
    assert.equal(restores, 0);
  } finally {
    observer.destroy();
    global.SubtitleRenderer = restore;
    global.SubtitleParser = parser;
    global.requestAnimationFrame = frame;
  }
});

test.after(() => {
  delete require.cache[contentScriptPath];
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.requestAnimationFrame = previousRequestAnimationFrame;
  global.MutationObserver = previousMutationObserver;
  global.HTMLVideoElement = previousHTMLVideoElement;
  global.SubtitleParser = previousSubtitleParser;
  global.SubtitleRenderer = previousSubtitleRenderer;
  global.SubtitleTranslator = previousSubtitleTranslator;
  global.VocabularyModule = previousVocabularyModule;
  global.TooltipModule = previousTooltipModule;
  global.SchedulerModule = previousSchedulerModule;
  global.DanmakuModule = previousDanmakuModule;
});
