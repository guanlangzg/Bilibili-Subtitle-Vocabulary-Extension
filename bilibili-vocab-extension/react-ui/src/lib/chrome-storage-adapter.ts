export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);
}

export function getChromeRuntimeError(fallbackMessage: string): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) {
    return null;
  }
  return new Error(String(chrome.runtime.lastError.message || fallbackMessage));
}

export function readStorage<T extends Record<string, unknown>>(keys?: string[] | null): Promise<T> {
  if (!hasChromeStorage()) {
    return Promise.reject(new Error('chrome.storage.local unavailable'));
  }
  return new Promise<T>((resolve, reject) => {
    chrome.storage.local.get(keys || null, (payload) => {
      const runtimeError = getChromeRuntimeError('chrome.storage.local.get failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve((payload || {}) as T);
    });
  });
}

export function writeStorage(payload: Record<string, unknown>): Promise<void> {
  if (!hasChromeStorage()) {
    return Promise.reject(new Error('chrome.storage.local unavailable'));
  }
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      const runtimeError = getChromeRuntimeError('chrome.storage.local.set failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve();
    });
  });
}
