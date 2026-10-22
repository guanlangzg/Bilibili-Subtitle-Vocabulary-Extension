export const MESSAGE_TYPES = {
  SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
  ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
  ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
  EXPERIENCE_RECORD_EVENT: 'BILI_VOCAB_EXPERIENCE_RECORD_EVENT',
  LEARNING_RECORD_HIT: 'BILI_VOCAB_LEARNING_RECORD_HIT',
  LEARNING_APPLY_REVIEW_FEEDBACK: 'BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK',
  LEARNING_SAVE_WORD: 'BILI_VOCAB_LEARNING_SAVE_WORD',
  LEARNING_REMOVE_WORD: 'BILI_VOCAB_LEARNING_REMOVE_WORD',
  LEARNING_CLEAR_VOCABULARY: 'BILI_VOCAB_LEARNING_CLEAR_VOCABULARY',
  LEARNING_RECORD_LOOKUP: 'BILI_VOCAB_LEARNING_RECORD_LOOKUP',
  LEARNING_EXPORT_DATA: 'BILI_VOCAB_LEARNING_EXPORT_DATA',
  LEARNING_IMPORT_DATA: 'BILI_VOCAB_LEARNING_IMPORT_DATA',
  SYNC_GET_SETTINGS: 'BILI_VOCAB_SYNC_GET_SETTINGS',
  SYNC_SAVE_SETTINGS: 'BILI_VOCAB_SYNC_SAVE_SETTINGS',
  SYNC_GET_STATUS: 'BILI_VOCAB_SYNC_GET_STATUS',
  SYNC_RUN: 'BILI_VOCAB_SYNC_RUN',
} as const;

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) {
    return null;
  }
  const message = String(chrome.runtime.lastError.message || '').trim();
  return new Error(message || 'chrome.runtime.sendMessage failed');
}

/** Whether a live background runtime can receive messages. */
export function hasRuntimeMessaging(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.runtime) &&
    typeof chrome.runtime.sendMessage === 'function'
  );
}

/**
 * Read values from chrome.storage.local.
 *
 * Used as a fallback when chrome.runtime.sendMessage fails (e.g. service worker
 * terminated in Manifest V3). The background script always writes to storage
 * before sending a response, so the data is eventually consistent.
 */
export function readSettingsFromStorage<T>(keys: string[]): Promise<T> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.local ||
    typeof chrome.storage.local.get !== 'function'
  ) {
    return Promise.reject(new Error('chrome.storage.local unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(String(chrome.runtime.lastError.message || 'chrome.storage.local.get failed'))
        );
        return;
      }
      resolve(result as T);
    });
  });
}

/**
 * Send a message to the background service worker and return the response payload.
 *
 * Fallback strategy (Manifest V3 resilience):
 * 1. **Message-first** — prefers chrome.runtime.sendMessage for low latency.
 * 2. **Storage fallback** — when the service worker has been terminated and
 *    sendMessage fails or returns undefined, falls back to reading the latest
 *    value from chrome.storage.local (higher latency but reliable).
 * 3. **Eventual consistency** — background always writes to storage before
 *    sendResponse, so both paths return the same data.
 *
 * @param storageKeys  Keys to read from chrome.storage.local when falling back.
 *                     Omit (or pass empty array) to disable storage fallback.
 */
export function sendRuntimeMessage<T>(
  type: string,
  payload: Record<string, unknown>,
  storageKeys: string[] = []
): Promise<T> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== 'function'
  ) {
    if (storageKeys.length > 0) {
      return readSettingsFromStorage<T>(storageKeys);
    }
    return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const runtimeError = getRuntimeError();
      if (runtimeError) {
        if (storageKeys.length > 0) {
          readSettingsFromStorage<T>(storageKeys).then(resolve, reject);
          return;
        }
        reject(runtimeError);
        return;
      }

      if (!response || response.ok !== true) {
        if (storageKeys.length > 0) {
          readSettingsFromStorage<T>(storageKeys).then(resolve, reject);
          return;
        }
        reject(
          new Error(String(response && response.error ? response.error : 'runtime bridge failed'))
        );
        return;
      }

      resolve(response.payload as T);
    });
  });
}
