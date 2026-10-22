import { MESSAGE_TYPES, sendRuntimeMessage } from './runtime-messaging';

export interface SyncSettings {
  enabled: boolean;
  serverUrl: string;
  token: string;
  clientId: string;
  lastCursor: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  lastResult: string | null;
}

export interface SyncStatus {
  format: 'vocab-learning-data';
  schemaVersion: 1;
  cursor: number;
  events: number;
  baselines: number;
  ackSeq: number | null;
}

export interface SyncStatusResult {
  configured: boolean;
  settings: SyncSettings;
  status?: SyncStatus;
}

export interface SyncRunResult {
  pulledEvents: number;
  pulledBaselines: number;
  imported: boolean;
  acceptedEvents: number;
  acceptedBaselines: number;
  duplicates: number;
  cursor: number;
  pages: number;
  syncedAt: number;
  deviceId?: string;
  settings: SyncSettings;
}

export function readSyncSettings(): Promise<SyncSettings> {
  return sendRuntimeMessage<SyncSettings>(MESSAGE_TYPES.SYNC_GET_SETTINGS, {});
}

export function saveSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  return sendRuntimeMessage<SyncSettings>(MESSAGE_TYPES.SYNC_SAVE_SETTINGS, { settings });
}

export function readSyncStatus(): Promise<SyncStatusResult> {
  return sendRuntimeMessage<SyncStatusResult>(MESSAGE_TYPES.SYNC_GET_STATUS, {});
}

export function runSync(): Promise<SyncRunResult> {
  return sendRuntimeMessage<SyncRunResult>(MESSAGE_TYPES.SYNC_RUN, {});
}
