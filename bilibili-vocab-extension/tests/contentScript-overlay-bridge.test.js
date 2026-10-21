const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousSubtitleParser = global.SubtitleParser;
const previousReactOverlayModule = global.ReactOverlayModule;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadContentScript() {
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
      getURL() {
        return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
      },
      onConnect: {
        addListener() {},
      },
      onMessage: {
        addListener() {},
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

  global.location = { hostname: 'docs.example.com' };
  global.SubtitleParser = {
    isBilibiliHost(hostname) {
      return hostname === 'www.bilibili.com';
    },
    getCurrentSubtitleTimelineCacheKey() {
      return '';
    },
    loadSubtitleTimeline: async () => [],
  };

  const contentScriptPath = require.resolve('../contentScript/index.js');
  delete require.cache[contentScriptPath];
  return require('../contentScript/index.js');
}

test('contentScript overlay bridge: read should return cloned fallback payload', () => {
  loadContentScript();

  const firstPayload = global.BiliVocabOverlaySubtitleNavigationBridge.read();
  firstPayload.videoKey = 'mutated';
  firstPayload.state.progressLabel = 'mutated';

  const secondPayload = global.BiliVocabOverlaySubtitleNavigationBridge.read();

  assert.equal(secondPayload.videoKey, '');
  assert.equal(secondPayload.state.supported, false);
  assert.equal(secondPayload.state.progressLabel, '未支持');
  assert.equal(secondPayload.state.currentText, '切到支持的视频页后即可使用句级字幕导航。');
});

test('contentScript overlay bridge: subscribe should stop pushing updates after unsubscribe', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };
  const pushed = [];

  global.location = { hostname: 'www.bilibili.com' };
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

  const unsubscribe = contentScript.subscribeOverlaySubtitleNavigation((payload) => {
    pushed.push(cloneJson(payload));
  });

  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(pushed[0].state.supported, true);
  assert.equal(pushed[0].state.loading, true);
  assert.equal(pushed[0].state.progressLabel, '加载中');

  await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(pushed.length, 2);
  assert.equal(pushed[1].videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(pushed[1].state.supported, true);
  assert.equal(pushed[1].state.loading, false);
  assert.equal(pushed[1].state.progressLabel, '2 / 2');

  unsubscribe();
  video.currentTime = 0.4;

  await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(pushed.length, 2);
});

test('contentScript overlay bridge: refresh should replace cached payload when video key changes', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };

  global.location = { hostname: 'www.bilibili.com' };
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

  const firstPayload = await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(firstPayload.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(firstPayload.state.progressLabel, '2 / 2');

  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV9yy522y8yM:cid:99';
  global.SubtitleParser.loadSubtitleTimeline = async () => [];
  video.currentTime = 0.4;

  const secondPayload = await contentScript.refreshOverlaySubtitleNavigation();
  secondPayload.state.progressLabel = 'mutated';

  const latestPayload = contentScript.readOverlaySubtitleNavigationPayload();
  assert.equal(latestPayload.videoKey, 'BV9yy522y8yM:cid:99');
  assert.equal(latestPayload.state.supported, true);
  assert.equal(latestPayload.state.progressLabel, '0 / 0');
  assert.equal(latestPayload.state.currentText, '当前还不能按句跳转。');
});

test('contentScript overlay bridge: refresh should fallback to current pending payload when timeline read fails after video switch', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };

  global.location = { hostname: 'www.bilibili.com' };
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

  const firstPayload = await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(firstPayload.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(firstPayload.state.progressLabel, '2 / 2');

  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV9yy522y8yM:cid:99';
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    throw new Error('timeline exploded');
  };
  video.currentTime = 5.1;

  const originalConsoleError = console.error;
  let secondPayload = null;
  console.error = () => {};
  try {
    await assert.doesNotReject(async () => {
      secondPayload = await contentScript.refreshOverlaySubtitleNavigation();
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(secondPayload.videoKey, 'BV9yy522y8yM:cid:99');
  assert.equal(secondPayload.state.supported, true);
  assert.equal(secondPayload.state.loading, true);
  assert.equal(secondPayload.state.progressLabel, '加载中');
  assert.equal(secondPayload.state.currentText, 'Bilibili 字幕轨道正在准备中。');

  const latestPayload = contentScript.readOverlaySubtitleNavigationPayload();
  assert.equal(latestPayload.videoKey, 'BV9yy522y8yM:cid:99');
  assert.equal(latestPayload.state.progressLabel, '加载中');
});

test('contentScript overlay bridge: refresh should keep the latest video key when a stale timeline read rejects after switching videos', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };
  let currentVideoKey = 'BV1staleOld:cid:10';
  let rejectOldTimeline = null;

  global.location = { hostname: 'www.bilibili.com' };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };

  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => currentVideoKey;
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    const requestedVideoKey = currentVideoKey;
    if (requestedVideoKey === 'BV1staleOld:cid:10') {
      return new Promise((_resolve, reject) => {
        rejectOldTimeline = reject;
      });
    }
    return [];
  };

  const refreshPromise = contentScript.refreshOverlaySubtitleNavigation();
  await new Promise((resolve) => setTimeout(resolve, 0));

  currentVideoKey = 'BV1staleNew:cid:20';
  video.currentTime = 0.4;

  const originalConsoleError = console.error;
  let payload = null;
  console.error = () => {};
  try {
    rejectOldTimeline(new Error('timeline exploded'));
    payload = await refreshPromise;
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(payload.videoKey, 'BV1staleNew:cid:20');
  assert.equal(payload.state.supported, true);
  assert.equal(payload.state.loading, true);
  assert.equal(payload.state.progressLabel, '加载中');
  assert.equal(payload.state.currentText, 'Bilibili 字幕轨道正在准备中。');

  const latestPayload = contentScript.readOverlaySubtitleNavigationPayload();
  assert.equal(latestPayload.videoKey, 'BV1staleNew:cid:20');
  assert.equal(latestPayload.state.progressLabel, '加载中');
});

test('contentScript overlay bridge: refresh should not re-publish identical payloads', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };
  const pushed = [];

  global.location = { hostname: 'www.bilibili.com' };
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

  const unsubscribe = contentScript.subscribeOverlaySubtitleNavigation((payload) => {
    pushed.push(cloneJson(payload));
  });

  await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(pushed.length, 2);

  await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(pushed.length, 2);

  unsubscribe();
});

test('contentScript overlay bridge: refresh should not regress loaded state to stale loading payload for the same video', async () => {
  const contentScript = loadContentScript();
  const video = { currentTime: 2.5 };
  let shouldFailTimeline = false;

  global.location = { hostname: 'www.bilibili.com' };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV1sameVideo:cid:42';
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    if (shouldFailTimeline) {
      throw new Error('timeline temporarily unavailable');
    }
    return [
      { from: 0, to: 1.5, content: '第一句' },
      { from: 2.2, to: 3.7, content: '第二句' },
    ];
  };

  const loadedPayload = await contentScript.refreshOverlaySubtitleNavigation();
  assert.equal(loadedPayload.videoKey, 'BV1sameVideo:cid:42');
  assert.equal(loadedPayload.state.loading, false);
  assert.equal(loadedPayload.state.progressLabel, '2 / 2');

  shouldFailTimeline = true;

  const originalConsoleError = console.error;
  let nextPayload = null;
  console.error = () => {};
  try {
    nextPayload = await contentScript.refreshOverlaySubtitleNavigation();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(nextPayload.videoKey, 'BV1sameVideo:cid:42');
  assert.equal(nextPayload.state.loading, false);
  assert.equal(nextPayload.state.progressLabel, '2 / 2');

  const latestPayload = contentScript.readOverlaySubtitleNavigationPayload();
  assert.equal(latestPayload.state.loading, false);
  assert.equal(latestPayload.state.progressLabel, '2 / 2');
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.SubtitleParser = previousSubtitleParser;
  global.ReactOverlayModule = previousReactOverlayModule;
  delete require.cache[require.resolve('../contentScript/index.js')];
});
