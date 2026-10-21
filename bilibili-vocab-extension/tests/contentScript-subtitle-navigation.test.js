const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousSubtitleParser = global.SubtitleParser;
const previousReactOverlayModule = global.ReactOverlayModule;
const previousHTMLVideoElement = global.HTMLVideoElement;
let runtimeConnectListener = null;
const runtimeMessageListeners = [];

const subtitleNavigationControllerRuntime = require('../subtitleNavigationController.js');
const subtitleNavigationShared = require('../subtitleNavigation.js');
const overlayBridgeRuntime = require('../overlaySubtitleNavigationBridge.js');

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

global.document = {
  readyState: 'loading',
  addEventListener() {},
  querySelector() {
    return null;
  },
  body: {},
};

global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL() {
      return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
    },
    onConnect: {
      addListener(listener) {
        runtimeConnectListener = listener;
      },
    },
    onMessage: {
      addListener(listener) {
        runtimeMessageListeners.push(listener);
      },
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

global.SubtitleParser = {
  isBilibiliHost(hostname) {
    return hostname === 'www.bilibili.com';
  },
  getCurrentSubtitleTimelineCacheKey() {
    return '';
  },
};

const contentScriptPath = require.resolve('../contentScript/index.js');
delete require.cache[contentScriptPath];
const contentScript = require('../contentScript/index.js');

function dispatchRuntimeMessage(message) {
  return new Promise((resolve) => {
    let handled = false;
    for (const listener of runtimeMessageListeners) {
      // RuntimeMessaging.isTrustedExtensionSender is fail-closed, so the mock
      // sender must look like a same-extension message (sender.id === runtime.id).
      const keepChannelOpen = listener(message, { id: global.chrome.runtime.id }, (response) => {
        if (handled) {
          return;
        }
        handled = true;
        resolve({
          keepChannelOpen,
          response: cloneValue(response),
        });
      });
      if (keepChannelOpen === true) {
        return;
      }
    }
    resolve({
      keepChannelOpen: false,
      response: null,
    });
  });
}

test('contentScript subtitle navigation: should normalize only supported actions', () => {
  assert.equal(contentScript.normalizeSubtitleNavigationAction(' previous '), 'previous');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('REPLAY'), 'replay');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('next'), 'next');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('jump'), '');
});

test('contentScript subtitle navigation: should resolve indices for active subtitle and gaps', () => {
  const timeline = [
    { from: 0, to: 1, content: '第一句' },
    { from: 2, to: 3, content: '第二句' },
    { from: 4, to: 5, content: '第三句' },
  ];

  assert.deepEqual(contentScript.findSubtitleNavigationIndices(timeline, 2.4), {
    currentIndex: 1,
    previousIndex: 0,
    replayIndex: 1,
    nextIndex: 2,
  });
  assert.deepEqual(contentScript.findSubtitleNavigationIndices(timeline, 3.4), {
    currentIndex: -1,
    previousIndex: 1,
    replayIndex: 1,
    nextIndex: 2,
  });
});

test('contentScript subtitle navigation: should build popup-friendly snapshot', () => {
  const snapshot = contentScript.buildSubtitleNavigationSnapshot(
    [
      { from: 0, to: 1.5, content: '第一句' },
      { from: 2.2, to: 3.7, content: '第二句' },
    ],
    2.5
  );

  assert.equal(snapshot.supported, true);
  assert.equal(snapshot.progressLabel, '2 / 2');
  assert.equal(snapshot.headline, '当前字幕');
  assert.match(snapshot.description, /00:02\.2 - 00:03\.7/);
  assert.equal(snapshot.currentText, '第二句');
  assert.equal(snapshot.canGoPrevious, true);
  assert.equal(snapshot.canReplay, true);
  assert.equal(snapshot.canGoNext, false);
});

test('contentScript subtitle navigation: manifest should load shared runtime before contentScript', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const shippedEntry = contentScripts.find((entry) => Array.isArray(entry.js));
  assert.ok(shippedEntry, 'content_scripts entry should exist');

  const scriptList = shippedEntry.js;
  const runtimeIndex = scriptList.indexOf('subtitleNavigation.js');
  const bridgeRuntimeIndex = scriptList.indexOf('overlaySubtitleNavigationBridge.js');
  const controllerRuntimeIndex = scriptList.indexOf('subtitleNavigationController.js');
  const contentScriptIndex = scriptList.indexOf('contentScript/index.js');

  assert.notEqual(runtimeIndex, -1);
  assert.notEqual(bridgeRuntimeIndex, -1);
  assert.notEqual(controllerRuntimeIndex, -1);
  assert.notEqual(contentScriptIndex, -1);
  assert.ok(runtimeIndex < contentScriptIndex);
  assert.ok(runtimeIndex < bridgeRuntimeIndex);
  assert.ok(bridgeRuntimeIndex < contentScriptIndex);
  assert.ok(runtimeIndex < controllerRuntimeIndex);
  assert.ok(bridgeRuntimeIndex < controllerRuntimeIndex);
  assert.ok(controllerRuntimeIndex < contentScriptIndex);
});

test('subtitleNavigationController module: should build state through injected page adapters', async () => {
  const video = { currentTime: 2.5 };
  const timeline = [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];
  const controller = subtitleNavigationControllerRuntime.createSubtitleNavigationController({
    subtitleNavigation: subtitleNavigationShared,
    overlayBridgeRuntime,
    getHostname() {
      return 'www.bilibili.com';
    },
    getVideo() {
      return video;
    },
    getVideoKey() {
      return 'BVcontroller:cid:1';
    },
    loadTimeline() {
      return Promise.resolve(timeline);
    },
    isSupportedHostFallback() {
      return false;
    },
    logError() {},
  });

  const payload = await controller.refreshOverlaySubtitleNavigation();

  assert.equal(payload.videoKey, 'BVcontroller:cid:1');
  assert.equal(payload.state.supported, true);
  assert.equal(payload.state.progressLabel, '2 / 2');
  assert.equal(payload.state.currentIndex, 1);
  assert.equal(payload.state.nextIndex, null);
});

test('contentScript subtitle navigation: should stream initial snapshot over a connected port', async () => {
  const messages = [];
  let disconnectListener = null;
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener(listener) {
        disconnectListener = listener;
      },
    },
    postMessage(message) {
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
  assert.equal(messages[0].payload.supported, true);
  assert.equal(messages[0].payload.progressLabel, '2 / 2');
  assert.equal(messages[0].payload.currentText, '第二句');

  if (typeof disconnectListener === 'function') {
    disconnectListener();
  }
});

test('contentScript subtitle navigation: should fallback to pending snapshot when initial stream delivery fails', async () => {
  const messages = [];
  let disconnectListener = null;
  let postAttempts = 0;
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener(listener) {
        disconnectListener = listener;
      },
    },
    postMessage(message) {
      postAttempts += 1;
      if (postAttempts === 1) {
        throw new Error('stream delivery failed');
      }
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(postAttempts, 2);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
  assert.equal(messages[0].payload.supported, true);
  assert.equal(messages[0].payload.progressLabel, '加载中');
  assert.equal(messages[0].payload.headline, '正在加载字幕时间轴');
  assert.equal(messages[0].payload.currentText, 'Bilibili 字幕轨道正在准备中。');

  if (typeof disconnectListener === 'function') {
    disconnectListener();
  }
});

test('contentScript subtitle navigation: should ignore init resolution after subscribed port disconnects', async () => {
  let disconnectListener = null;
  let resolveTimeline = null;
  let disconnected = false;
  let postAttempts = 0;
  const messages = [];
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV1disconnect:cid:77';
  global.SubtitleParser.loadSubtitleTimeline = async () =>
    new Promise((resolve) => {
      resolveTimeline = resolve;
    });

  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener(listener) {
        disconnectListener = listener;
      },
    },
    postMessage(message) {
      postAttempts += 1;
      if (disconnected) {
        throw new Error('port disconnected');
      }
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 0);
  assert.equal(typeof disconnectListener, 'function');

  disconnected = true;
  disconnectListener();
  resolveTimeline([
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 0);
  assert.equal(postAttempts, 0);
});

test('contentScript subtitle navigation: should push pending snapshot to subscribed port immediately when video key changes', async () => {
  class MockVideoElement {
    constructor(currentTime) {
      this.currentTime = currentTime;
      this.paused = false;
      this.ended = false;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const next = this.listeners.get(type) || [];
      next.push(listener);
      this.listeners.set(type, next);
    }

    removeEventListener(type, listener) {
      const next = (this.listeners.get(type) || []).filter((item) => item !== listener);
      this.listeners.set(type, next);
    }

    emit(type) {
      for (const listener of this.listeners.get(type) || []) {
        listener();
      }
    }
  }

  global.HTMLVideoElement = MockVideoElement;

  const video = new MockVideoElement(2.5);
  let currentVideoKey = 'BV1old:cid:1';
  let resolvePendingTimeline = null;
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => currentVideoKey;
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    if (currentVideoKey === 'BV1old:cid:1') {
      return [
        { from: 0, to: 1.5, content: '第一句' },
        { from: 2.2, to: 3.7, content: '第二句' },
      ];
    }
    return new Promise((resolve) => {
      resolvePendingTimeline = resolve;
    });
  };

  contentScript.bindVideoPlaybackEvents();

  const messages = [];
  let disconnectListener = null;
  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener(listener) {
        disconnectListener = listener;
      },
    },
    postMessage(message) {
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.currentText, '第二句');

  currentVideoKey = 'BV1new:cid:2';
  video.emit('timeupdate');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 2);
  assert.equal(messages[1].payload.progressLabel, '加载中');
  assert.equal(messages[1].payload.headline, '正在加载字幕时间轴');
  assert.equal(messages[1].payload.currentText, 'Bilibili 字幕轨道正在准备中。');
  assert.equal(messages[1].payload.canGoPrevious, false);
  assert.equal(messages[1].payload.canReplay, false);
  assert.equal(messages[1].payload.canGoNext, false);

  if (typeof disconnectListener === 'function') {
    disconnectListener();
  }
  if (typeof resolvePendingTimeline === 'function') {
    resolvePendingTimeline([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  global.document.querySelector = () => null;
  contentScript.bindVideoPlaybackEvents();
});

test('contentScript subtitle navigation: should ignore stale pre-switch snapshot reads and only publish the new video result', async () => {
  class MockVideoElement {
    constructor(currentTime) {
      this.currentTime = currentTime;
      this.paused = false;
      this.ended = false;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const next = this.listeners.get(type) || [];
      next.push(listener);
      this.listeners.set(type, next);
    }

    removeEventListener(type, listener) {
      const next = (this.listeners.get(type) || []).filter((item) => item !== listener);
      this.listeners.set(type, next);
    }

    emit(type) {
      for (const listener of this.listeners.get(type) || []) {
        listener();
      }
    }
  }

  global.HTMLVideoElement = MockVideoElement;

  const video = new MockVideoElement(2.5);
  let currentVideoKey = 'BV1staleOld:cid:10';
  let resolveOldTimeline = null;
  let resolveNewTimeline = null;
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => currentVideoKey;
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    const requestedVideoKey = currentVideoKey;
    return new Promise((resolve) => {
      if (requestedVideoKey === 'BV1staleOld:cid:10') {
        resolveOldTimeline = resolve;
        return;
      }
      resolveNewTimeline = resolve;
    });
  };

  contentScript.bindVideoPlaybackEvents();

  const messages = [];
  let disconnectListener = null;
  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener(listener) {
        disconnectListener = listener;
      },
    },
    postMessage(message) {
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 0);

  currentVideoKey = 'BV1staleNew:cid:20';
  video.currentTime = 0.4;
  video.emit('timeupdate');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.progressLabel, '加载中');
  assert.equal(messages[0].payload.currentText, 'Bilibili 字幕轨道正在准备中。');

  resolveOldTimeline([
    { from: 0, to: 1.5, content: '旧第一句' },
    { from: 2.2, to: 3.7, content: '旧第二句' },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);

  resolveNewTimeline([
    { from: 0, to: 0.9, content: '新第一句' },
    { from: 1.2, to: 2.1, content: '新第二句' },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 2);
  assert.equal(messages[1].payload.progressLabel, '1 / 2');
  assert.equal(messages[1].payload.currentText, '新第一句');
  assert.equal(messages[1].payload.canGoPrevious, false);
  assert.equal(messages[1].payload.canReplay, true);
  assert.equal(messages[1].payload.canGoNext, true);

  if (typeof disconnectListener === 'function') {
    disconnectListener();
  }

  global.document.querySelector = () => null;
  contentScript.bindVideoPlaybackEvents();
});

test('contentScript subtitle navigation: should expose overlay bridge payload without polling', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV1xx411x7xN:cid:42';
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  assert.ok(global.BiliVocabOverlaySubtitleNavigationBridge);

  const payload = await global.BiliVocabOverlaySubtitleNavigationBridge.refresh();

  assert.equal(payload.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(payload.state.supported, true);
  assert.equal(payload.state.progressLabel, '2 / 2');
  assert.equal(payload.state.currentIndex, 1);

  let pushed = null;
  const unsubscribe = global.BiliVocabOverlaySubtitleNavigationBridge.subscribe((next) => {
    pushed = cloneValue(next);
  });
  unsubscribe();

  assert.equal(pushed.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(pushed.state.nextIndex, null);
});

test('contentScript subtitle navigation: should answer runtime read requests with current snapshot', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ',
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, true);
  assert.equal(result.response.payload.supported, true);
  assert.equal(result.response.payload.progressLabel, '2 / 2');
  assert.equal(result.response.payload.currentText, '第二句');
});

test('contentScript subtitle navigation: should return pending snapshot when runtime read hits a timeline error', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    throw new Error('timeline exploded');
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await dispatchRuntimeMessage({
      type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ',
    });

    assert.equal(result.keepChannelOpen, true);
    assert.equal(result.response.ok, true);
    assert.equal(result.response.payload.supported, true);
    assert.equal(result.response.payload.progressLabel, '加载中');
    assert.equal(result.response.payload.headline, '正在加载字幕时间轴');
    assert.equal(result.response.payload.currentText, 'Bilibili 字幕轨道正在准备中。');
    assert.equal(result.response.payload.canGoPrevious, false);
    assert.equal(result.response.payload.canReplay, false);
    assert.equal(result.response.payload.canGoNext, false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('contentScript subtitle navigation: should navigate to next subtitle via runtime message', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
    { from: 4, to: 5, content: '第三句' },
  ];

  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
    payload: {
      action: 'next',
    },
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, true);
  assert.equal(video.currentTime, 4.02);
  assert.equal(result.response.payload.progressLabel, '3 / 3');
  assert.equal(result.response.payload.currentText, '第三句');
  assert.equal(result.response.payload.canGoNext, false);
});

test('contentScript subtitle navigation: should not seek with a stale timeline after the page switches videos', async () => {
  const video = { currentTime: 2.5 };
  let currentVideoKey = 'BV1navigateOld:cid:30';
  let resolveOldTimeline = null;

  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => currentVideoKey;
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    const requestedVideoKey = currentVideoKey;
    if (requestedVideoKey === 'BV1navigateOld:cid:30') {
      return new Promise((resolve) => {
        resolveOldTimeline = resolve;
      });
    }
    return [];
  };

  const resultPromise = dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
    payload: {
      action: 'next',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  currentVideoKey = 'BV1navigateNew:cid:40';
  video.currentTime = 0.4;
  resolveOldTimeline([
    { from: 0, to: 1.5, content: '旧第一句' },
    { from: 2.2, to: 3.7, content: '旧第二句' },
    { from: 4, to: 5, content: '旧第三句' },
  ]);

  const result = await resultPromise;

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, true);
  assert.equal(video.currentTime, 0.4);
  assert.equal(result.response.payload.supported, true);
  assert.equal(result.response.payload.progressLabel, '加载中');
  assert.equal(result.response.payload.currentText, 'Bilibili 字幕轨道正在准备中。');
  assert.equal(result.response.payload.canGoPrevious, false);
  assert.equal(result.response.payload.canReplay, false);
  assert.equal(result.response.payload.canGoNext, false);
});

test('contentScript subtitle navigation: should return pending snapshot when navigate hits a timeline error', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    throw new Error('timeline exploded');
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await dispatchRuntimeMessage({
      type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
      payload: {
        action: 'next',
      },
    });

    assert.equal(result.keepChannelOpen, true);
    assert.equal(result.response.ok, true);
    assert.equal(video.currentTime, 2.5);
    assert.equal(result.response.payload.supported, true);
    assert.equal(result.response.payload.progressLabel, '加载中');
    assert.equal(result.response.payload.currentText, 'Bilibili 字幕轨道正在准备中。');
    assert.equal(result.response.payload.canGoPrevious, false);
    assert.equal(result.response.payload.canReplay, false);
    assert.equal(result.response.payload.canGoNext, false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('contentScript subtitle navigation: should reject invalid runtime navigate actions', async () => {
  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
    payload: {
      action: 'jump',
    },
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /Invalid subtitle navigation action/);
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.SubtitleParser = previousSubtitleParser;
  global.ReactOverlayModule = previousReactOverlayModule;
  global.HTMLVideoElement = previousHTMLVideoElement;
  delete require.cache[contentScriptPath];
});
