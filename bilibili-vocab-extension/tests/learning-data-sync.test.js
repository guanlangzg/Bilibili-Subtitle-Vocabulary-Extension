const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LearningData = require('../learningData.js');
const Sync = require('../learningDataSync.js');
const BackgroundSync = require('../background-learning-sync.js');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'learning-data-v1.json'), 'utf8')
);

function createChromeStub(initial) {
  const store = { ...initial };
  return {
    store,
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            if (keys == null) {
              callback({ ...store });
              return;
            }
            const list = Array.isArray(keys) ? keys : [keys];
            const result = {};
            list.forEach((key) => {
              if (key in store) result[key] = store[key];
            });
            callback(result);
          },
          set(payload, callback) {
            Object.assign(store, JSON.parse(JSON.stringify(payload)));
            callback();
          },
        },
      },
    },
  };
}

test('server URL normalization rejects unsafe or malformed values', () => {
  assert.equal(Sync.normalizeServerUrl('https://sync.example.com/'), 'https://sync.example.com');
  assert.equal(Sync.normalizeServerUrl('https://example.com/api/'), 'https://example.com/api');
  assert.throws(() => Sync.normalizeServerUrl('ftp://example.com'), /http/);
  assert.throws(() => Sync.normalizeServerUrl('https://user:pass@example.com'), /账号密码/);
  assert.throws(() => Sync.normalizeServerUrl(''), /请填写/);
  assert.throws(() => Sync.normalizeServerUrl('not a url'), /格式不正确/);
});

test('origin pattern covers the configured host only', () => {
  assert.equal(Sync.originPatternFor('https://sync.example.com/'), 'https://sync.example.com/*');
  assert.equal(Sync.originPatternFor('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/*');
});

test('token validation accepts service tokens and rejects others', () => {
  const token = `vsc_${'a'.repeat(32)}`;
  assert.equal(Sync.normalizeToken(token), token);
  assert.throws(() => Sync.normalizeToken('abc'), /格式不正确/);
  assert.throws(() => Sync.normalizeToken(`vsc_${'a'.repeat(8)}`), /格式不正确/);
  assert.throws(() => Sync.normalizeToken(`vsc_${'a'.repeat(32)} `), /格式不正确/);
});

test('settings normalization keeps defaults and drops invalid cursors', () => {
  const normalized = Sync.normalizeSyncSettings({
    enabled: 'yes',
    serverUrl: ' https://a.example.com ',
    token: ' vsc_x ',
    lastCursor: -3,
    lastSyncedAt: 'now',
  });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.serverUrl, 'https://a.example.com');
  assert.equal(normalized.token, 'vsc_x');
  assert.equal(normalized.lastCursor, 0);
  assert.equal(normalized.lastSyncedAt, null);
  assert.equal(Sync.isConfigured(normalized), true);
  assert.equal(Sync.isConfigured({}), false);
});

test('pull responses convert into an importable bundle', () => {
  const now = 1767225603000;
  const bundle = Sync.toBundle(
    {
      events: [{ seq: 1, body: FIXTURE.events[0] }],
      baselines: [{ seq: 2, body: FIXTURE.baselines[0] }],
    },
    now
  );
  assert.equal(bundle.format, LearningData.FORMAT);
  assert.equal(bundle.schemaVersion, LearningData.SCHEMA_VERSION);
  assert.equal(bundle.exportedAt, now);
  assert.equal(bundle.events.length, 1);
  assert.equal(bundle.baselines.length, 1);
  // Round-trip through the protocol keeps the derived progress identical.
  assert.deepEqual(
    LearningData.deriveProgress(bundle)['word-9ed39e2e-a931-386b-aa98-5a6942ef573e'].exposureCount,
    8
  );
});

test('failure descriptions surface HTTP status and timeout', () => {
  assert.equal(Sync.describeFailure({ status: 409, body: { message: 'x' } }), '服务器返回 409：x');
  assert.equal(Sync.describeFailure({ name: 'AbortError' }), '同步请求超时');
  assert.equal(Sync.describeFailure({ message: 'boom' }), 'boom');
  assert.equal(Sync.describeFailure(null), '同步失败');
});

function loadBackgroundModules(chromeStub) {
  global.chrome = chromeStub.chrome;
  delete require.cache[require.resolve('../background-storage.js')];
  delete require.cache[require.resolve('../learningData.js')];
  delete require.cache[require.resolve('../background-learning-data.js')];
  delete require.cache[require.resolve('../background-learning-state.js')];
  delete require.cache[require.resolve('../learningDataSync.js')];
  delete require.cache[require.resolve('../background-learning-sync.js')];
  const sync = require('../background-learning-sync.js');
  return sync;
}

test('saveSyncSettings validates before writing', async () => {
  const stub = createChromeStub({});
  const sync = loadBackgroundModules(stub);
  await assert.rejects(
    () => sync.saveSyncSettings({ settings: { serverUrl: 'ftp://x', token: '' } }),
    /http/
  );
  assert.equal(stub.store[Sync.SYNC_SETTINGS_KEY], undefined);
});

test('syncNow pulls first, imports, then pushes the merged bundle', async () => {
  const stub = createChromeStub({
    [Sync.SYNC_SETTINGS_KEY]: {
      enabled: true,
      serverUrl: 'https://sync.example.com',
      token: `vsc_${'b'.repeat(32)}`,
      clientId: 'ext-test',
    },
  });
  const sync = loadBackgroundModules(stub);

  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET' && url.includes('/v1/pull')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            cursor: 5,
            hasMore: false,
            events: FIXTURE.events.map((body, index) => ({ seq: index + 1, body })),
            baselines: [{ seq: 5, body: FIXTURE.baselines[0] }],
          }),
      };
    }
    if (init.method === 'POST' && url.includes('/v1/push')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            accepted: { events: 0, baselines: 0 },
            duplicates: 5,
            cursor: 5,
            ackSeq: 5,
          }),
      };
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };

  const result = await sync.syncNow({ now: 1767225603000 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /since=0/);
  assert.match(calls[0].url, /clientId=ext-test/);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].body.bundle.events.length, FIXTURE.events.length);
  assert.equal(calls[1].body.clientId, 'ext-test');
  assert.equal(result.pulledEvents, FIXTURE.events.length);
  assert.equal(result.pulledBaselines, 1);
  assert.equal(result.duplicates, 5);
  assert.equal(result.cursor, 5);
  assert.equal(stub.store[Sync.SYNC_SETTINGS_KEY].lastCursor, 5);
  assert.equal(stub.store[Sync.SYNC_SETTINGS_KEY].lastError, null);
  delete global.fetch;
});

test('syncNow surfaces a conflict and does not advance the cursor', async () => {
  const stub = createChromeStub({
    [Sync.SYNC_SETTINGS_KEY]: {
      enabled: true,
      serverUrl: 'https://sync.example.com',
      token: `vsc_${'c'.repeat(32)}`,
      lastCursor: 3,
    },
  });
  const sync = loadBackgroundModules(stub);
  global.fetch = async (url, init) => {
    if (init.method === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ cursor: 3, hasMore: false, events: [], baselines: [] }),
      };
    }
    return {
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({ error: 'conflict', message: 'Conflicting records', conflicts: [] }),
    };
  };

  await assert.rejects(() => sync.syncNow({ now: 1 }), /409/);
  assert.equal(stub.store[Sync.SYNC_SETTINGS_KEY].lastCursor, 3);
  delete global.fetch;
});

test('readStatus reports unconfigured settings without network access', async () => {
  const stub = createChromeStub({});
  const sync = loadBackgroundModules(stub);
  global.fetch = async () => {
    throw new Error('network must not be used');
  };
  const result = await sync.readStatus({});
  assert.equal(result.configured, false);
  delete global.fetch;
});

test.afterEach(() => {
  delete global.fetch;
  delete global.chrome;
});
