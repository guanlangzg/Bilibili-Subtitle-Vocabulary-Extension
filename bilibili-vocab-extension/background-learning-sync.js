(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);
  const backgroundLearningState =
    globalScope.BackgroundLearningState ||
    (typeof require === 'function' ? require('./background-learning-state.js') : null);
  const learningDataSync =
    globalScope.LearningDataSync ||
    (typeof require === 'function' ? require('./learningDataSync.js') : null);

  const getStoragePayload = backgroundStorage && backgroundStorage.getStoragePayload;
  const writeStoragePayload = backgroundStorage && backgroundStorage.writeStoragePayload;
  const normalizeTimestamp = backgroundStorage && backgroundStorage.normalizeTimestamp;
  const logBackgroundError = backgroundStorage && backgroundStorage.logBackgroundError;

  function requireModules() {
    if (!learningDataSync) throw new Error('LearningDataSync unavailable');
    if (!backgroundLearningState) throw new Error('BackgroundLearningState unavailable');
    if (typeof getStoragePayload !== 'function' || typeof writeStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }
  }

  async function readSyncSettings() {
    requireModules();
    const payload = await getStoragePayload([learningDataSync.SYNC_SETTINGS_KEY]);
    return learningDataSync.normalizeSyncSettings(payload[learningDataSync.SYNC_SETTINGS_KEY]);
  }

  async function saveSyncSettings(messagePayload) {
    requireModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const next = learningDataSync.normalizeSyncSettings(payload.settings);
    // Validate before persisting so a bad URL or token never reaches storage.
    if (next.serverUrl) learningDataSync.normalizeServerUrl(next.serverUrl);
    if (next.token) learningDataSync.normalizeToken(next.token);
    await writeStoragePayload({ [learningDataSync.SYNC_SETTINGS_KEY]: next });
    return next;
  }

  function buildRequest(settings, method, path, body, timeoutMs) {
    const serverUrl = learningDataSync.normalizeServerUrl(settings.serverUrl);
    const token = learningDataSync.normalizeToken(settings.token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      url: `${serverUrl}${path}`,
      init: {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body == null ? {} : { 'content-type': 'application/json' }),
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      },
      done: () => clearTimeout(timer),
    };
  }

  async function requestJson(settings, method, path, body, timeoutMs) {
    const request = buildRequest(
      settings,
      method,
      path,
      body,
      timeoutMs || learningDataSync.DEFAULT_TIMEOUT_MS
    );
    try {
      const response = await fetch(request.url, request.init);
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (!response.ok) {
        // The message is what survives sendRuntimeMessage serialization, so it must
        // already carry the status and the server's explanation.
        const detail =
          parsed && typeof parsed.message === 'string' && parsed.message
            ? `：${parsed.message}`
            : '';
        const error = new Error(`服务器返回 ${response.status}${detail}`);
        error.status = response.status;
        error.body = parsed;
        throw error;
      }
      return parsed;
    } finally {
      request.done();
    }
  }

  function clientQuery(settings) {
    return settings.clientId ? `clientId=${encodeURIComponent(settings.clientId)}` : '';
  }

  async function readStatus(messagePayload) {
    requireModules();
    const settings = await readSyncSettings();
    if (!learningDataSync.isConfigured(settings)) {
      return { configured: false, settings };
    }
    const query = clientQuery(settings);
    const status = await requestJson(
      settings,
      'GET',
      `/v1/status${query ? `?${query}` : ''}`,
      null
    );
    return { configured: true, settings, status };
  }

  /**
   * Pull-then-push: import remote facts first so a push never overwrites what the
   * server already knows. Cursor only advances after the import succeeds.
   */
  async function syncNow(messagePayload) {
    requireModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const settings = await readSyncSettings();
    if (!learningDataSync.isConfigured(settings)) {
      throw new Error('尚未配置同步服务器或令牌');
    }
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const query = clientQuery(settings);

    const summary = {
      pulledEvents: 0,
      pulledBaselines: 0,
      imported: false,
      acceptedEvents: 0,
      acceptedBaselines: 0,
      duplicates: 0,
      cursor: settings.lastCursor,
      pages: 0,
      syncedAt: now,
    };

    let cursor = settings.lastCursor;
    let importedAny = false;
    for (let page = 0; page < learningDataSync.MAX_PULL_PAGES; page += 1) {
      const params = new URLSearchParams({ since: String(cursor), limit: '500' });
      if (settings.clientId) params.set('clientId', settings.clientId);
      const response = await requestJson(settings, 'GET', `/v1/pull?${params.toString()}`, null);
      summary.pages += 1;

      if (response.events.length > 0 || response.baselines.length > 0) {
        const bundle = learningDataSync.toBundle(response, now);
        await backgroundLearningState.importLearningData({ bundle, now });
        importedAny = true;
        summary.pulledEvents += response.events.length;
        summary.pulledBaselines += response.baselines.length;
      }

      cursor = Number.isSafeInteger(response.cursor) ? response.cursor : cursor;
      if (!response.hasMore) break;
    }
    summary.imported = importedAny;

    // Push the merged local bundle; duplicates are expected and counted, not an error.
    const exported = await backgroundLearningState.exportLearningData({ now });
    const pushBody = {
      bundle: exported.bundle,
      ...(settings.clientId ? { clientId: settings.clientId } : {}),
    };
    const pushed = await requestJson(settings, 'POST', '/v1/push', pushBody);
    summary.acceptedEvents = pushed.accepted.events;
    summary.acceptedBaselines = pushed.accepted.baselines;
    summary.duplicates = pushed.duplicates;
    summary.cursor = Number.isSafeInteger(pushed.cursor) ? pushed.cursor : cursor;
    summary.deviceId = exported.deviceId;

    const nextSettings = {
      ...settings,
      lastCursor: summary.cursor,
      lastSyncedAt: now,
      lastError: null,
      lastResult: `拉取 ${summary.pulledEvents} 条事件、${summary.pulledBaselines} 条基线；上传 ${summary.acceptedEvents} 条事件、${summary.acceptedBaselines} 条基线`,
    };
    await writeStoragePayload({ [learningDataSync.SYNC_SETTINGS_KEY]: nextSettings });
    return { ...summary, settings: nextSettings };
  }

  async function recordSyncFailure(error) {
    const settings = await readSyncSettings();
    const message = learningDataSync.describeFailure(error);
    const next = { ...settings, lastError: message };
    try {
      await writeStoragePayload({ [learningDataSync.SYNC_SETTINGS_KEY]: next });
    } catch (storageError) {
      if (typeof logBackgroundError === 'function') {
        logBackgroundError('Failed to persist sync error', storageError);
      }
    }
    return message;
  }

  const api = {
    readSyncSettings,
    saveSyncSettings,
    readStatus,
    syncNow,
    recordSyncFailure,
  };

  globalScope.BackgroundLearningSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
