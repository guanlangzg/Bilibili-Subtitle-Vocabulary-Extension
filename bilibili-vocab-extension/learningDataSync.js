(function (globalScope) {
  const learningDataApi =
    globalScope.LearningData ||
    (typeof require === 'function' ? require('./learningData.js') : null);

  const SYNC_SETTINGS_KEY = 'bili_vocab_sync_settings_v1';
  const DEFAULT_TIMEOUT_MS = 20000;
  const MAX_PULL_PAGES = 200;
  const TOKEN_PATTERN = /^vsc_[A-Za-z0-9_-]{32,64}$/;

  function requireProtocol() {
    if (!learningDataApi) throw new Error('LearningData unavailable');
  }

  function normalizeServerUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('请填写同步服务器地址');
    }
    let parsed;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new Error('同步服务器地址格式不正确');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('同步服务器必须使用 http 或 https');
    }
    if (parsed.username || parsed.password) {
      throw new Error('服务器地址不能包含账号密码');
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  }

  function originPatternFor(serverUrl) {
    const parsed = new URL(normalizeServerUrl(serverUrl));
    return `${parsed.protocol}//${parsed.host}/*`;
  }

  function normalizeToken(value) {
    // Tokens are opaque: trimming would silently accept a token the server rejects.
    if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
      throw new Error('同步令牌格式不正确');
    }
    return value;
  }

  function normalizeSyncSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const serverUrl = typeof source.serverUrl === 'string' ? source.serverUrl.trim() : '';
    const token = typeof source.token === 'string' ? source.token : '';
    return {
      enabled: source.enabled === true,
      serverUrl,
      token,
      clientId: typeof source.clientId === 'string' ? source.clientId.trim() : '',
      lastCursor:
        Number.isSafeInteger(source.lastCursor) && source.lastCursor > 0 ? source.lastCursor : 0,
      lastSyncedAt: Number.isSafeInteger(source.lastSyncedAt) ? source.lastSyncedAt : null,
      lastError: typeof source.lastError === 'string' ? source.lastError : null,
      lastResult: typeof source.lastResult === 'string' ? source.lastResult : null,
    };
  }

  function isConfigured(settings) {
    const value = normalizeSyncSettings(settings);
    return Boolean(value.serverUrl && value.token);
  }

  function toBundle(pullResponse, now) {
    requireProtocol();
    return {
      format: learningDataApi.FORMAT,
      schemaVersion: learningDataApi.SCHEMA_VERSION,
      exportedAt: now,
      events: pullResponse.events.map((row) => row.body),
      baselines: pullResponse.baselines.map((row) => row.body),
    };
  }

  function describeFailure(error) {
    if (!error) return '同步失败';
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return '同步请求超时';
    if (typeof error.status === 'number') {
      const detail =
        error.body && typeof error.body.message === 'string' ? `：${error.body.message}` : '';
      return `服务器返回 ${error.status}${detail}`;
    }
    const message = String(error.message || '').trim();
    return message || '同步失败';
  }

  const api = {
    SYNC_SETTINGS_KEY,
    DEFAULT_TIMEOUT_MS,
    MAX_PULL_PAGES,
    TOKEN_PATTERN,
    normalizeServerUrl,
    originPatternFor,
    normalizeToken,
    normalizeSyncSettings,
    isConfigured,
    toBundle,
    describeFailure,
  };

  globalScope.LearningDataSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
