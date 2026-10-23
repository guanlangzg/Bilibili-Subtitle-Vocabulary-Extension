import { SETTINGS_STORAGE_KEY_V3, migrateToV3, normalizeSettingsV3 } from './overlay-settings';
import type { SettingsV3 } from './overlay-settings';
import { MESSAGE_TYPES, sendRuntimeMessage } from './runtime-messaging';
import { readStorage, writeStorage } from './chrome-storage-adapter';

// Shared facade with the popup/options storage module.
export { readStorage, writeStorage };

const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
const STORAGE_MUTATION_TIMEOUT_MS = 10000;

export interface LearningSummary {
  todayCount: number;
  newCount: number;
  masteredCount: number;
  recentWords: Array<{ word: string; status?: string }>;
}

function createStorageMutationTimeoutError(): Error {
  return new Error(`Storage mutation timed out after ${STORAGE_MUTATION_TIMEOUT_MS}ms`);
}

// Matches the popup/options storage queue semantics so both entries share the
// same timeout protection against hung chrome.storage mutations.
function runStorageMutationWithTimeout<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(createStorageMutationTimeoutError());
    }, STORAGE_MUTATION_TIMEOUT_MS);

    Promise.resolve()
      .then(task)
      .then(
        (result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      );
  });
}

let storageMutationQueue = Promise.resolve();

function enqueueStorageMutation<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = storageMutationQueue.then(
    () => runStorageMutationWithTimeout(task),
    () => runStorageMutationWithTimeout(task)
  );
  storageMutationQueue = nextTask.then(
    () => undefined,
    () => undefined
  );
  return nextTask;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeLearningSummary(value: unknown): LearningSummary {
  const source = isRecord(value) ? value : {};
  const recentWords = Array.isArray(source.recentWords)
    ? source.recentWords
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          word: String(item.word || '').trim(),
          status: String(item.status || '').trim(),
        }))
        .filter((item) => Boolean(item.word))
    : [];
  return {
    todayCount: toPositiveInt(source.todayCount),
    newCount: toPositiveInt(source.newCount),
    masteredCount: toPositiveInt(source.masteredCount),
    recentWords: recentWords.slice(0, 5),
  };
}

export async function loadOverlaySettingsV3(): Promise<SettingsV3> {
  return enqueueStorageMutation(async () => {
    const allPayload = await readStorage<Record<string, unknown>>(null);
    const migratedSettings = normalizeSettingsV3(migrateToV3(allPayload));
    const currentPayload = await readStorage<Record<string, unknown>>([SETTINGS_STORAGE_KEY_V3]);
    const currentStoredSettings = currentPayload[SETTINGS_STORAGE_KEY_V3];

    if (currentStoredSettings != null) {
      return normalizeSettingsV3(currentStoredSettings);
    }

    await writeStorage({
      [SETTINGS_STORAGE_KEY_V3]: migratedSettings,
    });
    return migratedSettings;
  });
}

export async function saveOverlaySettingsV3(settings: SettingsV3): Promise<SettingsV3> {
  const normalized = normalizeSettingsV3(settings);
  return enqueueStorageMutation(async () => {
    const persisted = await sendRuntimeMessage<SettingsV3>(MESSAGE_TYPES.SETTINGS_COMMIT, {
      settings: normalized,
      markManualOverride: true,
      now: Date.now(),
    });
    return normalizeSettingsV3(persisted);
  });
}

export async function readLearningSummary(): Promise<LearningSummary> {
  const payload = await readStorage<Record<string, unknown>>([LEARNING_SUMMARY_STORAGE_KEY]);
  return normalizeLearningSummary(payload[LEARNING_SUMMARY_STORAGE_KEY]);
}

export function subscribeLearningSummary(onUpdate: (summary: LearningSummary) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[LEARNING_SUMMARY_STORAGE_KEY]) {
      return;
    }
    onUpdate(normalizeLearningSummary(changes[LEARNING_SUMMARY_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeOverlaySettingsChanges(
  onUpdate: (settings: SettingsV3) => void
): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY_V3]) {
      return;
    }
    onUpdate(normalizeSettingsV3(changes[SETTINGS_STORAGE_KEY_V3].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
