/**
 * Host permission for the user's own sync server.
 *
 * The manifest declares an optional all-origin permission, so the sync server origin
 * must be granted before the service worker may call it. Requests must run from a user
 * gesture inside an extension page, which is why this lives in the options UI.
 */

function hasChromePermissions(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.permissions) &&
    typeof chrome.permissions.request === 'function' &&
    typeof chrome.permissions.contains === 'function'
  );
}

export function syncOriginPattern(serverUrl: string): string {
  const parsed = new URL(serverUrl);
  return `${parsed.protocol}//${parsed.host}/*`;
}

export function requestSyncOriginPermission(serverUrl: string): Promise<boolean> {
  if (!hasChromePermissions()) return Promise.resolve(false);
  let pattern: string;
  try {
    pattern = syncOriginPattern(serverUrl);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(granted === true);
    });
  });
}
