import { MESSAGE_TYPES, sendRuntimeMessage } from './runtime-messaging';

export const LEARNING_DATA_STORAGE_KEY = 'bili_vocab_learning_data_v1';

export interface LearningDataSchedule {
  algorithm: string;
  algorithmVersion: string;
  state: 'new' | 'learning' | 'review' | 'relearning' | 'mastered';
  dueAt: number | null;
  lastReviewedAt: number | null;
  scheduledDays: number;
  reviewCount: number;
  lapseCount: number;
  difficulty: number | null;
  stability: number | null;
  retrievability: number | null;
  targetRetention: number | null;
  legacyEaseFactor: number | null;
  legacyMasteryScore: number | null;
}

export interface LearningDataContext {
  sentence: string | null;
  title: string | null;
  url: string | null;
  timeSeconds: number | null;
}

export interface LearningDataEvent {
  schemaVersion: 1;
  eventId: string;
  type: 'exposure' | 'lookup' | 'save' | 'unsave' | 'suspend' | 'resume' | 'review';
  word: string;
  wordId: string;
  source: 'extension' | 'android';
  deviceId: string;
  occurredAt: number;
  localDay: string;
  zoneId: string;
  utcOffsetMinutes: number;
  bookCodes: string[];
  rating: 'again' | 'hard' | 'good' | 'easy' | null;
  rawAction: string | null;
  durationMs: number | null;
  targetRetention: number | null;
  algorithm: string | null;
  algorithmVersion: string | null;
  context: LearningDataContext | null;
  schedule: LearningDataSchedule | null;
}

export interface LearningDataBaseline extends LearningDataCounters {
  schemaVersion: 1;
  baselineId: string;
  word: string;
  wordId: string;
  source: 'extension' | 'android';
  deviceId: string;
  capturedAt: number;
  bookCodes: string[];
  saved: boolean;
  suspended: boolean;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  lastReviewedAt: number | null;
  schedule: LearningDataSchedule | null;
}

export interface LearningDataBundle {
  format: 'vocab-learning-data';
  schemaVersion: 1;
  exportedAt: number;
  events: LearningDataEvent[];
  baselines: LearningDataBaseline[];
}

export interface LearningDataCounters {
  exposureCount: number;
  lookupCount: number;
  reviewCount: number;
  saveCount: number;
}

export interface LearningDataProgress extends LearningDataCounters {
  wordId: string;
  word: string;
  bookCodes: string[];
  saved: boolean;
  suspended: boolean;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  lastReviewedAt: number | null;
  schedule: LearningDataSchedule | null;
  contributions: Record<'extension' | 'android', LearningDataCounters>;
}

export interface LearningDataExportResult {
  deviceId: string;
  exportedAt: number;
  pendingEventCount: number;
  bundle: LearningDataBundle;
  progress: Record<string, LearningDataProgress>;
}

export interface LearningDataImportResult {
  imported: boolean;
  deviceId: string;
  bundle: LearningDataBundle;
  progress: Record<string, LearningDataProgress>;
}

/**
 * Ask the background single writer for a full bundle export. There is no
 * storage fallback: a failed message must surface as a failure, not as a
 * silently empty export.
 */
export function exportLearningData(): Promise<LearningDataExportResult> {
  return sendRuntimeMessage<LearningDataExportResult>(MESSAGE_TYPES.LEARNING_EXPORT_DATA, {});
}

/**
 * Import a bundle through the background queue. The whole bundle is validated
 * and merged atomically; any conflict or schema error rejects without writes.
 */
export function importLearningData(bundle: LearningDataBundle): Promise<LearningDataImportResult> {
  return sendRuntimeMessage<LearningDataImportResult>(MESSAGE_TYPES.LEARNING_IMPORT_DATA, {
    bundle,
  });
}

/** Shared progress map derived by the background from the merged bundle. */
export async function readLearningDataProgress(): Promise<Record<string, LearningDataProgress>> {
  const exported = await exportLearningData();
  return exported.progress;
}
