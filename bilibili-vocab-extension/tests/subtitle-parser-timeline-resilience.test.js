const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParserPath = require.resolve('../subtitleParser.js');
const previousFetch = global.fetch;
const previousDocument = global.document;
const previousLocation = global.location;
const previousInitialState = global.__INITIAL_STATE__;

function loadSubtitleParser() {
  delete require.cache[subtitleParserPath];
  return require('../subtitleParser.js');
}

function createJsonResponse(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

function restoreGlobals() {
  global.fetch = previousFetch;
  global.document = previousDocument;
  global.location = previousLocation;
  global.__INITIAL_STATE__ = previousInitialState;
}

test('subtitleParser timeline: fetch failure should remain retryable for same cache key', async () => {
  global.location = { hostname: 'www.bilibili.com' };
  global.document = {
    querySelector() {
      return null;
    },
  };
  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1failRetry',
      cid: 901,
    },
  };

  let attempts = 0;
  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('cid=901')) {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network down');
      }
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [
              { lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/retry-fail.json' },
            ],
          },
        },
      });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/retry-fail.json') {
      return createJsonResponse({
        body: [{ from: 1, to: 2, content: '恢复后的字幕' }],
      });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const subtitleParser = loadSubtitleParser();
    assert.deepEqual(await subtitleParser.loadSubtitleTimeline(), []);
    const recovered = await subtitleParser.loadSubtitleTimeline();
    assert.deepEqual(recovered, [{ from: 1, to: 2, content: '恢复后的字幕' }]);
    assert.equal(attempts, 2);
  } finally {
    restoreGlobals();
    delete require.cache[subtitleParserPath];
  }
});

test('subtitleParser timeline: identifier cache should include page when resolving cid', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
    href: 'https://www.bilibili.com/video/BV1multiPage?p=1',
  };
  global.document = {
    querySelector() {
      return null;
    },
  };
  global.__INITIAL_STATE__ = {
    p: 1,
    videoData: {
      bvid: 'BV1multiPage',
      // force view API resolution path
      cid: 0,
    },
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    const requestUrl = String(url);
    fetchCalls.push(requestUrl);
    if (requestUrl.includes('/x/web-interface/view') && requestUrl.includes('BV1multiPage')) {
      return createJsonResponse({
        data: {
          aid: 1001,
          bvid: 'BV1multiPage',
          pages: [
            { page: 1, cid: 11 },
            { page: 2, cid: 22 },
          ],
        },
      });
    }
    if (requestUrl.includes('cid=11')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/p1.json' }],
          },
        },
      });
    }
    if (requestUrl.includes('cid=22')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/p2.json' }],
          },
        },
      });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/p1.json') {
      return createJsonResponse({ body: [{ from: 0, to: 1, content: '第一P' }] });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/p2.json') {
      return createJsonResponse({ body: [{ from: 0, to: 1, content: '第二P' }] });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const subtitleParser = loadSubtitleParser();
    const first = await subtitleParser.loadSubtitleTimeline();
    assert.deepEqual(first, [{ from: 0, to: 1, content: '第一P' }]);

    global.location = {
      hostname: 'www.bilibili.com',
      href: 'https://www.bilibili.com/video/BV1multiPage?p=2',
    };
    global.__INITIAL_STATE__ = {
      p: 2,
      videoData: {
        bvid: 'BV1multiPage',
        cid: 0,
      },
    };

    const second = await subtitleParser.loadSubtitleTimeline();
    assert.deepEqual(second, [{ from: 0, to: 1, content: '第二P' }]);
    assert.equal(fetchCalls.filter((item) => item.includes('/x/web-interface/view')).length, 2);
    assert.ok(fetchCalls.some((item) => item.includes('cid=22')));
  } finally {
    restoreGlobals();
    delete require.cache[subtitleParserPath];
  }
});
