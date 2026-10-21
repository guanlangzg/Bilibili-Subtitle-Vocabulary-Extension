(function (globalScope) {
  const runtimeMessaging =
    globalScope.RuntimeMessaging ||
    (typeof require === 'function' ? require('./runtimeMessaging.js') : null);
  const STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
  const DEFAULT_WINDOW_DAYS = 7;
  const MAX_EVENT_LOG = 80;
  const KEEP_DAILY_DAYS = 35;
  const COUNTER_KEYS = [
    'contextMisreplaceReported',
    'contextMisreplaceHigh',
    'adaptiveDecisionApplied',
    'adaptiveDecisionEaseDown',
    'adaptiveDecisionRampUp',
    'adaptiveDecisionStabilize',
    'adaptiveManualOverride',
    'adaptiveToggleEnabled',
    'adaptiveToggleDisabled',
  ];
  const DEFAULT_COUNTERS = COUNTER_KEYS.reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});
  const DEFAULT_STATE = {
    schemaVersion: 1,
    updatedAt: null,
    counters: { ...DEFAULT_COUNTERS },
    daily: {},
    events: [],
  };

  let memoryState = normalizeState(DEFAULT_STATE);
  let writeQueue = Promise.resolve();

  function normalizeTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return Math.floor(numeric);
  }

  function clampDays(value, fallback = DEFAULT_WINDOW_DAYS) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(30, Math.max(1, Math.floor(numeric)));
  }

  function toDayKey(timestamp) {
    const validTimestamp = normalizeTimestamp(timestamp) || Date.now();
    return new Date(validTimestamp).toISOString().slice(0, 10);
  }

  function isValidDayKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function normalizeCounterMap(rawMap) {
    const source = rawMap && typeof rawMap === 'object' ? rawMap : {};
    const output = { ...DEFAULT_COUNTERS };
    COUNTER_KEYS.forEach((key) => {
      const value = Number(source[key]);
      output[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    });
    return output;
  }

  function normalizeDailyMap(rawDaily) {
    if (!rawDaily || typeof rawDaily !== 'object') {
      return {};
    }

    const output = {};
    Object.keys(rawDaily).forEach((dayKey) => {
      if (!isValidDayKey(dayKey)) {
        return;
      }
      output[dayKey] = normalizeCounterMap(rawDaily[dayKey]);
    });
    return output;
  }

  function normalizeEventLog(rawEvents) {
    if (!Array.isArray(rawEvents)) {
      return [];
    }

    return rawEvents
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const type = String(item.type || '')
          .trim()
          .toLowerCase();
        const at = normalizeTimestamp(item.at);
        if (!type || at == null) {
          return null;
        }

        const normalized = { type, at };
        if (item.mode) {
          normalized.mode = String(item.mode || '')
            .trim()
            .toLowerCase();
        }
        if (item.severity) {
          normalized.severity = String(item.severity || '')
            .trim()
            .toLowerCase();
        }
        if (typeof item.enabled === 'boolean') {
          normalized.enabled = item.enabled;
        }
        return normalized;
      })
      .filter(Boolean)
      .slice(-MAX_EVENT_LOG);
  }

  function normalizeState(rawState) {
    const source = rawState && typeof rawState === 'object' ? rawState : {};
    return {
      schemaVersion: 1,
      updatedAt: normalizeTimestamp(source.updatedAt),
      counters: normalizeCounterMap(source.counters),
      daily: normalizeDailyMap(source.daily),
      events: normalizeEventLog(source.events),
    };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(normalizeState(state)));
  }

  function hasChromeStorage() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function'
    );
  }

  function readStorageState() {
    if (!hasChromeStorage()) {
      return Promise.resolve(cloneState(memoryState));
    }

    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (payload) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          // Keep the current in-memory state instead of silently resetting counters.
          logStorageError('read', chrome.runtime.lastError);
          resolve(cloneState(memoryState));
          return;
        }
        resolve(normalizeState(payload && payload[STORAGE_KEY]));
      });
    });
  }

  function writeStorageState(state) {
    const normalized = normalizeState(state);
    if (!hasChromeStorage()) {
      memoryState = normalized;
      return Promise.resolve(normalized);
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(
        {
          [STORAGE_KEY]: normalized,
        },
        () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            logStorageError('write', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(normalized);
        }
      );
    });
  }

  function logStorageError(action, runtimeError) {
    console.error(`[BiliVocab] Experience metrics storage ${action} failed:`, runtimeError);
  }

  function resolveCounterKeysByEvent(type, options = {}) {
    const eventType = String(type || '')
      .trim()
      .toLowerCase();
    const keys = [];
    if (eventType === 'context-misreplace') {
      keys.push('contextMisreplaceReported');
      const severity = String(options.severity || '')
        .trim()
        .toLowerCase();
      if (severity === 'high') {
        keys.push('contextMisreplaceHigh');
      }
    } else if (eventType === 'adaptive-decision-applied') {
      keys.push('adaptiveDecisionApplied');
      const mode = String(options.mode || '')
        .trim()
        .toLowerCase();
      if (mode === 'ease-down') {
        keys.push('adaptiveDecisionEaseDown');
      } else if (mode === 'ramp-up') {
        keys.push('adaptiveDecisionRampUp');
      } else if (mode === 'stabilize') {
        keys.push('adaptiveDecisionStabilize');
      }
    } else if (eventType === 'adaptive-manual-override') {
      keys.push('adaptiveManualOverride');
    } else if (eventType === 'adaptive-toggle') {
      keys.push(options.enabled === false ? 'adaptiveToggleDisabled' : 'adaptiveToggleEnabled');
    }
    return keys;
  }

  function pruneDailyMap(daily, now = Date.now(), keepDays = KEEP_DAILY_DAYS) {
    const timestamp = normalizeTimestamp(now) || Date.now();
    const minimumTimestamp = timestamp - keepDays * 24 * 60 * 60 * 1000;
    const output = {};
    Object.keys(daily).forEach((dayKey) => {
      const dayTimestamp = Date.parse(`${dayKey}T00:00:00.000Z`);
      if (Number.isFinite(dayTimestamp) && dayTimestamp >= minimumTimestamp) {
        output[dayKey] = daily[dayKey];
      }
    });
    return output;
  }

  function applyEventToState(state, type, options = {}) {
    const baseState = normalizeState(state);
    const timestamp = normalizeTimestamp(options.now) || Date.now();
    const counterKeys = resolveCounterKeysByEvent(type, options);
    if (counterKeys.length === 0) {
      return baseState;
    }

    const nextCounters = {
      ...baseState.counters,
    };
    const dayKey = toDayKey(timestamp);
    const currentDay = normalizeCounterMap(baseState.daily[dayKey]);
    counterKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(nextCounters, key)) {
        nextCounters[key] = 0;
      }
      nextCounters[key] += 1;
      currentDay[key] += 1;
    });

    const nextDaily = pruneDailyMap(
      {
        ...baseState.daily,
        [dayKey]: currentDay,
      },
      timestamp
    );

    const nextEvent = {
      type: String(type || '')
        .trim()
        .toLowerCase(),
      at: timestamp,
    };
    if (options.mode) {
      nextEvent.mode = String(options.mode).trim().toLowerCase();
    }
    if (options.severity) {
      nextEvent.severity = String(options.severity).trim().toLowerCase();
    }
    if (typeof options.enabled === 'boolean') {
      nextEvent.enabled = options.enabled;
    }

    return normalizeState({
      ...baseState,
      updatedAt: timestamp,
      counters: nextCounters,
      daily: nextDaily,
      events: baseState.events.concat(nextEvent).slice(-MAX_EVENT_LOG),
    });
  }

  function queueWrite(update) {
    writeQueue = writeQueue
      .then(async () => {
        const current = await readStorageState();
        const next = normalizeState(update(current));
        return writeStorageState(next);
      })
      .catch(() => readStorageState());
    return writeQueue;
  }

  function listWindowDayKeys(days, now = Date.now()) {
    const normalizedDays = clampDays(days);
    const timestamp = normalizeTimestamp(now) || Date.now();
    const keys = [];
    for (let index = 0; index < normalizedDays; index += 1) {
      const target = timestamp - index * 24 * 60 * 60 * 1000;
      keys.push(toDayKey(target));
    }
    return keys;
  }

  function sumWindowCounter(state, counterKey, options = {}) {
    const normalizedState = normalizeState(state);
    if (!COUNTER_KEYS.includes(counterKey)) {
      return 0;
    }

    const days = clampDays(options.days);
    const now = normalizeTimestamp(options.now) || Date.now();
    const dayKeys = listWindowDayKeys(days, now);
    return dayKeys.reduce((total, dayKey) => {
      const dayCounter = normalizedState.daily[dayKey];
      const value = dayCounter && Number(dayCounter[counterKey]);
      return total + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    }, 0);
  }

  function buildSnapshot(state, options = {}) {
    const normalizedState = normalizeState(state);
    const days = clampDays(options.days);
    const now = normalizeTimestamp(options.now) || Date.now();

    const totalsWindow = COUNTER_KEYS.reduce((accumulator, key) => {
      accumulator[key] = sumWindowCounter(normalizedState, key, {
        days,
        now,
      });
      return accumulator;
    }, {});

    const adaptiveToggleTotal =
      totalsWindow.adaptiveToggleEnabled + totalsWindow.adaptiveToggleDisabled;
    const adaptiveToggleDisableRate =
      adaptiveToggleTotal > 0
        ? Number((totalsWindow.adaptiveToggleDisabled / adaptiveToggleTotal).toFixed(4))
        : 0;

    return {
      windowDays: days,
      updatedAt: normalizedState.updatedAt,
      totalsAllTime: normalizeCounterMap(normalizedState.counters),
      totalsWindow,
      adaptiveToggleTotal,
      adaptiveToggleDisableRate,
      recentEvents: normalizedState.events.slice(-10).reverse(),
    };
  }

  async function recordEvent(type, options = {}) {
    const eventType = String(type || '')
      .trim()
      .toLowerCase();
    if (!eventType) {
      return null;
    }

    if (
      runtimeMessaging &&
      typeof runtimeMessaging.sendRuntimeMessage === 'function' &&
      typeof runtimeMessaging.hasRuntimeMessaging === 'function' &&
      runtimeMessaging.hasRuntimeMessaging()
    ) {
      return runtimeMessaging.sendRuntimeMessage(
        runtimeMessaging.MESSAGE_TYPES.EXPERIENCE_RECORD_EVENT,
        {
          type: eventType,
          options: { ...(options || {}) },
        }
      );
    }

    const counterKeys = resolveCounterKeysByEvent(eventType, options);
    if (!counterKeys.length) {
      return normalizeState(await readStorageState());
    }

    return queueWrite((state) => applyEventToState(state, eventType, options));
  }

  async function readSnapshot(options = {}) {
    const state = await readStorageState();
    return buildSnapshot(state, options);
  }

  function resetState() {
    memoryState = normalizeState(DEFAULT_STATE);
    writeQueue = Promise.resolve();
  }

  const api = {
    STORAGE_KEY,
    COUNTER_KEYS: COUNTER_KEYS.slice(),
    DEFAULT_STATE: cloneState(DEFAULT_STATE),
    normalizeState,
    applyEventToState,
    sumWindowCounter,
    buildSnapshot,
    recordEvent,
    readSnapshot,
    resetState,
    __resetForTest: resetState,
  };

  globalScope.ExperienceMetrics = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
