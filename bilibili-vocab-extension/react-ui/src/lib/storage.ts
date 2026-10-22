import {
  SETTINGS_STORAGE_KEY_V3,
  SettingsV3,
  migrateToV3,
  normalizeSettingsV3,
} from './settings-bridge';
import type { ScenePresetKey } from './settings-bridge';
import {
  readStorage as readChromeStorage,
  writeStorage as writeChromeStorage,
} from './chrome-storage-adapter';
import {
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  QuickReviewAction,
  QuickReviewItem,
  normalizeEncounteredWord,
  sortEncounteredWords,
  sortQuickReviewItems,
} from './learning-dashboard';
import { MESSAGE_TYPES, hasRuntimeMessaging, sendRuntimeMessage } from './runtime-messaging';

// Legacy storage keys retained for backward compatibility with existing installs.
const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
// Both aliases point to the same v2 word stats storage entry.
// LEARNING_WORD_STATS_STORAGE_KEY is used for learning/review operations.
// VOCABULARY_BOOK_STORAGE_KEY is used for vocabulary book export/clear operations.
const LEARNING_WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const VOCABULARY_BOOK_STORAGE_KEY = LEARNING_WORD_STATS_STORAGE_KEY;
const REVIEW_QUEUE_STORAGE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const ONBOARDING_STORAGE_KEY = 'bili_vocab_onboarding_v1';
// Legacy message namespaces retained for backward compatibility across extension components.
const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ';
const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE =
  'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE';
const ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE =
  'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE';
export const CONTENT_RUNTIME_SCRIPT_FILES = [
  'config.js',
  'runtimeMessaging.js',
  'sharedSettings.js',
  'experienceMetrics.js',
  'adaptiveTuning.js',
  'learningState.js',
  'learningData.js',
  'utils.js',
  'vocabulary-pure.js',
  'vocabulary.js',
  'translator.js',
  'renderer.js',
  'subtitleParser.js',
  'scripts/danmaku.js',
  'scripts/scheduler.js',
  'tooltip.js',
  'subtitleNavigation.js',
  'overlaySubtitleNavigationBridge.js',
  'subtitleNavigationController.js',
  'runtimeSettingsSync.js',
  'webTextReplacement.js',
  'overlayLoader.js',
  'contentScript/constants.js',
  'contentScript/translation-pipeline.js',
  'contentScript/dom-observer.js',
  'contentScript/danmaku-engine.js',
  'contentScript/subtitle-navigation-bridge.js',
  'contentScript/index.js',
] as const;
export const CONTENT_RUNTIME_STYLE_FILES = ['styles.css'] as const;
const STORAGE_MUTATION_TIMEOUT_MS = 10000;
const METRIC_COUNTER_KEYS = [
  'contextMisreplaceReported',
  'contextMisreplaceHigh',
  'adaptiveDecisionApplied',
  'adaptiveDecisionEaseDown',
  'adaptiveDecisionRampUp',
  'adaptiveDecisionStabilize',
  'adaptiveManualOverride',
  'adaptiveToggleEnabled',
  'adaptiveToggleDisabled',
] as const;

export interface LearningSummary {
  todayCount: number;
  newCount: number;
  masteredCount: number;
  recentWords: Array<{ word: string; translation?: string; status?: string }>;
}

interface LearningRecord {
  word: string;
  translation?: string;
  level?: string;
  status?: string;
  hitCount?: number;
  exposureCount?: number;
  seenCount?: number;
  lastSeen?: number | null;
  lastSeenAt?: number | null;
  nextReviewBucket?: string;
  nextReviewAt?: number | null;
  intervalDays?: number | null;
  easeFactor?: number | null;
  savedAt?: number | null;
  exposures?: number;
  context?: string;
  source?: VocabularySource;
  details?: {
    meaning?: string;
    level?: string;
    phonetic?: string;
  };
}

interface ReviewQueueEntry {
  word: string;
  dueBucket?: string;
  nextReviewAt?: number | null;
  intervalDays?: number | null;
  easeFactor?: number | null;
  updatedAt?: number | null;
}

interface LearningStateApi {
  normalizeLearningRecord?: (record: unknown, fallback?: Record<string, unknown>) => LearningRecord;
  normalizeReviewQueue?: (queue: unknown) => Record<string, ReviewQueueEntry>;
  buildLearningSummary?: (
    records: Record<string, LearningRecord>,
    queue: Record<string, ReviewQueueEntry>
  ) => unknown;
  migrateLegacyStat?: (record: unknown) => LearningRecord;
  applyLearningAction?: (record: LearningRecord, action: string, now: number) => LearningRecord;
  applyReviewFeedback?: (record: LearningRecord, action: string, now: number) => LearningRecord;
  syncReviewQueue?: (
    queue: Record<string, ReviewQueueEntry>,
    record: LearningRecord,
    now: number
  ) => Record<string, ReviewQueueEntry>;
  updateLearningStreak?: (now?: number) => Promise<LearningStreak> | LearningStreak;
}

declare global {
  interface Window {
    LearningState?: LearningStateApi;
  }
}

export interface QuickReviewDashboard {
  summary: LearningSummary;
  items: QuickReviewItem[];
}

export interface QuickReviewCommitResult extends QuickReviewDashboard {
  word: string;
  adaptiveApplied: boolean;
}

export interface VocabularySource {
  title?: string;
  url?: string;
  timeSeconds?: number;
  timeLabel?: string;
}

export interface VocabularyWord {
  word: string;
  status: string;
  savedAt?: number;
  exposures?: number;
  context?: string;
  source?: VocabularySource;
  details?: {
    meaning?: string;
    level?: string;
    phonetic?: string;
  };
}

type VocabularyWordDetails = NonNullable<VocabularyWord['details']>;

export type VocabularyExportFormat = 'json' | 'csv' | 'anki';
export type ActiveTabSubtitleNavigationAction = 'previous' | 'replay' | 'next';
export type OnboardingGoal = ScenePresetKey;

export interface OnboardingState {
  completedAt: number | null;
  selectedGoal: OnboardingGoal | null;
  updatedAt: number | null;
}

export interface ActiveTabSubtitleNavigation {
  supported: boolean;
  progressLabel: string;
  headline: string;
  description: string;
  currentText: string;
  canGoPrevious: boolean;
  canReplay: boolean;
  canGoNext: boolean;
}

export interface ActiveTabSubtitleStatus {
  hostname: string;
  subtitleNavigation: ActiveTabSubtitleNavigation;
}

export interface ActiveTabSitePermissionState {
  hostname: string;
  originPattern: string;
  defaultSupported: boolean;
  authorized: boolean;
  canRequest: boolean;
  canRevoke: boolean;
  message: string;
}

function normalizeVocabularyWord(input: unknown): VocabularyWord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Record<string, unknown>;
  const detailsSource =
    source.details && typeof source.details === 'object'
      ? (source.details as Record<string, unknown>)
      : {};
  const word = String(source.word || '').trim();
  const status = String(source.status || '')
    .trim()
    .toLowerCase();
  if (!word || !status) {
    return null;
  }
  const exposures = Number(source.exposures ?? source.exposureCount ?? source.hitCount);
  const normalizedSource = normalizeVocabularySource(source, detailsSource);

  return {
    word,
    status,
    savedAt: normalizeTimestamp(source.savedAt) ?? undefined,
    exposures: Number.isFinite(exposures) && exposures > 0 ? Math.floor(exposures) : 0,
    context: normalizeVocabularyContext(source, detailsSource),
    source: normalizedSource,
    details: normalizeVocabularyDetails(Object.keys(detailsSource).length ? detailsSource : source),
  };
}

export interface LearningStreak {
  currentStreak: number;
  maxStreak: number;
  lastActiveDate: string;
  totalActiveDays: number;
  activeDays: string[];
}

export interface AdaptiveTuningState {
  enabled: boolean;
  manualOverrideUntil: number | null;
  manualOverrideRemainingMs: number;
  manualOverrideActive: boolean;
  feedbackWindowSize: number;
  lastAppliedAt: number | null;
  lastAppliedMode: string;
  hint: string;
}

type MetricCounterKey = (typeof METRIC_COUNTER_KEYS)[number];
type MetricCounterMap = Record<MetricCounterKey, number>;

interface ExperienceMetricsState {
  schemaVersion: number;
  updatedAt: number | null;
  counters: MetricCounterMap;
  daily: Record<string, MetricCounterMap>;
}

export interface ExperienceMetricsSnapshot {
  windowDays: number;
  updatedAt: number | null;
  contextMisreplaceReported: number;
  contextMisreplaceHigh: number;
  adaptiveDecisionApplied: number;
  adaptiveManualOverride: number;
  adaptiveToggleEnabled: number;
  adaptiveToggleDisabled: number;
  adaptiveToggleTotal: number;
  adaptiveToggleDisableRate: number;
}

function getChromeRuntimeError(fallbackMessage: string): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return null;
  }
  const runtimeError = chrome.runtime.lastError;
  if (!runtimeError) {
    return null;
  }
  const message =
    typeof runtimeError.message === 'string' && runtimeError.message.trim()
      ? runtimeError.message.trim()
      : fallbackMessage;
  return new Error(message);
}

let storageMutationQueue = Promise.resolve();

function createStorageMutationTimeoutError(): Error {
  return new Error(`Storage mutation timed out after ${STORAGE_MUTATION_TIMEOUT_MS}ms`);
}

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

function hasChromeTabs(): boolean {
  return (
    typeof chrome !== 'undefined' && Boolean(chrome.tabs) && typeof chrome.tabs.query === 'function'
  );
}

function hasChromeTabMessaging(): boolean {
  return hasChromeTabs() && typeof chrome.tabs.sendMessage === 'function';
}

function hasChromeTabConnections(): boolean {
  return hasChromeTabs() && typeof chrome.tabs.connect === 'function';
}

function hasChromePermissions(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.permissions) &&
    typeof chrome.permissions.contains === 'function' &&
    typeof chrome.permissions.request === 'function'
  );
}

function hasChromePermissionRemoval(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.permissions) &&
    typeof chrome.permissions.remove === 'function'
  );
}

function hasChromeScripting(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.scripting) &&
    typeof chrome.scripting.executeScript === 'function' &&
    typeof chrome.scripting.insertCSS === 'function'
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeSourceText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSourceTimeSeconds(value: unknown): number | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.floor(seconds);
}

function formatVocabularySourceTimeLabel(value: unknown): string {
  const totalSeconds = normalizeSourceTimeSeconds(value);
  if (totalSeconds == null) {
    return '';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
      .join(':');
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizeVocabularyDetails(input: unknown): VocabularyWordDetails {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    meaning: normalizeSourceText(source.meaning || source.translation || ''),
    level: normalizeSourceText(source.level || ''),
    phonetic: normalizeSourceText(source.phonetic || ''),
  };
}

function normalizeVocabularyContext(
  source: Record<string, unknown>,
  detailsSource: Record<string, unknown>
): string {
  return normalizeSourceText(
    source.context ||
      source.example ||
      source.originalSubtitle ||
      detailsSource.context ||
      detailsSource.example ||
      detailsSource.originalSubtitle ||
      ''
  );
}

function normalizeVocabularySource(
  input: unknown,
  detailsSourceOverride?: Record<string, unknown>
): VocabularySource | undefined {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const detailsSource =
    detailsSourceOverride ||
    (source.details && typeof source.details === 'object'
      ? (source.details as Record<string, unknown>)
      : {});
  const nestedSource =
    source.source && typeof source.source === 'object'
      ? (source.source as Record<string, unknown>)
      : detailsSource.source && typeof detailsSource.source === 'object'
        ? (detailsSource.source as Record<string, unknown>)
        : {};
  const title = normalizeSourceText(nestedSource.title || source.sourceTitle || '');
  const url = normalizeSourceText(nestedSource.url || source.sourceUrl || '');
  const timeSeconds = normalizeSourceTimeSeconds(
    nestedSource.timeSeconds != null
      ? nestedSource.timeSeconds
      : source.sourceTimeSeconds != null
        ? source.sourceTimeSeconds
        : source.sourceTime
  );
  const timeLabel =
    normalizeSourceText(nestedSource.timeLabel || source.sourceTimeLabel || '') ||
    formatVocabularySourceTimeLabel(timeSeconds);

  if (!title && !url && timeSeconds == null && !timeLabel) {
    return undefined;
  }

  const normalized: VocabularySource = {};
  if (title) {
    normalized.title = title;
  }
  if (url) {
    normalized.url = url;
  }
  if (timeSeconds != null) {
    normalized.timeSeconds = timeSeconds;
  }
  if (timeLabel) {
    normalized.timeLabel = timeLabel;
  }
  return normalized;
}

function buildLearningRecordExportMetadata(input: unknown): Partial<LearningRecord> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const source = input as Record<string, unknown>;
  const detailsSource =
    source.details && typeof source.details === 'object'
      ? (source.details as Record<string, unknown>)
      : {};
  const metadata: Partial<LearningRecord> = {};
  const savedAt = normalizeTimestamp(source.savedAt);
  const exposures = Number(source.exposures ?? source.exposureCount ?? source.hitCount);
  const context = normalizeVocabularyContext(source, detailsSource);
  const details = normalizeVocabularyDetails(
    Object.keys(detailsSource).length ? detailsSource : source
  );
  const vocabularySource = normalizeVocabularySource(source, detailsSource);

  if (savedAt != null) {
    metadata.savedAt = savedAt;
  }
  if (Number.isFinite(exposures) && exposures > 0) {
    metadata.exposures = Math.floor(exposures);
  }
  if (context) {
    metadata.context = context;
  }
  if (details.meaning || details.level || details.phonetic) {
    metadata.details = details;
  }
  if (vocabularySource) {
    metadata.source = vocabularySource;
  }
  return metadata;
}

function toDayKey(value: number): string {
  const timestamp = normalizeTimestamp(value) || Date.now();
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampWindowDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 7;
  }
  return Math.min(30, Math.max(1, Math.floor(parsed)));
}

function createEmptyMetricCounterMap(): MetricCounterMap {
  return METRIC_COUNTER_KEYS.reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {} as MetricCounterMap);
}

function normalizeMetricCounterMap(input: unknown): MetricCounterMap {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const output = createEmptyMetricCounterMap();
  METRIC_COUNTER_KEYS.forEach((key) => {
    const value = Number(source[key]);
    output[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  });
  return output;
}

function normalizeExperienceMetricsState(input: unknown): ExperienceMetricsState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const dailySource =
    source.daily && typeof source.daily === 'object'
      ? (source.daily as Record<string, unknown>)
      : {};
  const daily: Record<string, MetricCounterMap> = {};
  Object.keys(dailySource).forEach((dayKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      return;
    }
    daily[dayKey] = normalizeMetricCounterMap(dailySource[dayKey]);
  });
  return {
    schemaVersion: 1,
    updatedAt: normalizeTimestamp(source.updatedAt),
    counters: normalizeMetricCounterMap(source.counters),
    daily,
  };
}

function listWindowDayKeys(days: number, now = Date.now()): string[] {
  const normalizedDays = clampWindowDays(days);
  const timestamp = normalizeTimestamp(now) || Date.now();
  const dayKeys: string[] = [];
  for (let index = 0; index < normalizedDays; index += 1) {
    dayKeys.push(toDayKey(timestamp - index * 24 * 60 * 60 * 1000));
  }
  return dayKeys;
}

function sumMetricWindowCounter(
  state: ExperienceMetricsState,
  counterKey: MetricCounterKey,
  days: number,
  now = Date.now()
): number {
  return listWindowDayKeys(days, now).reduce((total, dayKey) => {
    const dailyCounters = state.daily[dayKey];
    const value = dailyCounters ? Number(dailyCounters[counterKey]) : 0;
    return total + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  }, 0);
}

function buildExperienceMetricsSnapshot(
  state: ExperienceMetricsState,
  days = 7,
  now = Date.now()
): ExperienceMetricsSnapshot {
  const windowDays = clampWindowDays(days);
  const contextMisreplaceReported = sumMetricWindowCounter(
    state,
    'contextMisreplaceReported',
    windowDays,
    now
  );
  const contextMisreplaceHigh = sumMetricWindowCounter(
    state,
    'contextMisreplaceHigh',
    windowDays,
    now
  );
  const adaptiveDecisionApplied = sumMetricWindowCounter(
    state,
    'adaptiveDecisionApplied',
    windowDays,
    now
  );
  const adaptiveManualOverride = sumMetricWindowCounter(
    state,
    'adaptiveManualOverride',
    windowDays,
    now
  );
  const adaptiveToggleEnabled = sumMetricWindowCounter(
    state,
    'adaptiveToggleEnabled',
    windowDays,
    now
  );
  const adaptiveToggleDisabled = sumMetricWindowCounter(
    state,
    'adaptiveToggleDisabled',
    windowDays,
    now
  );
  const adaptiveToggleTotal = adaptiveToggleEnabled + adaptiveToggleDisabled;
  const adaptiveToggleDisableRate =
    adaptiveToggleTotal > 0 ? Number((adaptiveToggleDisabled / adaptiveToggleTotal).toFixed(4)) : 0;

  return {
    windowDays,
    updatedAt: state.updatedAt,
    contextMisreplaceReported,
    contextMisreplaceHigh,
    adaptiveDecisionApplied,
    adaptiveManualOverride,
    adaptiveToggleEnabled,
    adaptiveToggleDisabled,
    adaptiveToggleTotal,
    adaptiveToggleDisableRate,
  };
}

function formatDurationLabel(durationMs: number): string {
  const minutes = Math.max(1, Math.ceil(durationMs / (60 * 1000)));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  const days = Math.ceil(hours / 24);
  return `${days} 天`;
}

function buildAdaptiveHint(
  enabled: boolean,
  manualOverrideActive: boolean,
  manualOverrideRemainingMs: number
): string {
  if (!enabled) {
    return '自动调优已关闭';
  }
  if (manualOverrideActive) {
    return `手动配置优先，约 ${formatDurationLabel(manualOverrideRemainingMs)} 后恢复自动调优`;
  }
  return '已启用自动调优';
}

function normalizeAdaptiveTuningState(input: unknown, now = Date.now()): AdaptiveTuningState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const manualOverrideUntil = normalizeTimestamp(source.manualOverrideUntil);
  const referenceNow = normalizeTimestamp(now) || Date.now();
  const manualOverrideRemainingMs =
    manualOverrideUntil != null ? Math.max(0, manualOverrideUntil - referenceNow) : 0;
  const manualOverrideActive = manualOverrideRemainingMs > 0;
  const enabled = source.enabled !== false;
  return {
    enabled,
    manualOverrideUntil,
    manualOverrideRemainingMs,
    manualOverrideActive,
    feedbackWindowSize: Array.isArray(source.feedbackWindow) ? source.feedbackWindow.length : 0,
    lastAppliedAt: normalizeTimestamp(source.lastAppliedAt),
    lastAppliedMode: String(source.lastAppliedMode || '')
      .trim()
      .toLowerCase(),
    hint: buildAdaptiveHint(enabled, manualOverrideActive, manualOverrideRemainingMs),
  };
}

function normalizeOnboardingGoal(value: unknown): OnboardingGoal | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'light' || normalized === 'balanced' || normalized === 'intensive') {
    return normalized;
  }
  return null;
}

function normalizeOnboardingState(input: unknown): OnboardingState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    completedAt: normalizeTimestamp(source.completedAt),
    selectedGoal: normalizeOnboardingGoal(source.selectedGoal),
    updatedAt: normalizeTimestamp(source.updatedAt),
  };
}

export function readStorage<T extends Record<string, unknown>>(keys?: string[] | null): Promise<T> {
  return readChromeStorage<T>(keys);
}

export function writeStorage(payload: Record<string, unknown>): Promise<void> {
  return writeChromeStorage(payload);
}

export async function loadSettingsV3(): Promise<SettingsV3> {
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

export async function saveSettingsV3(settings: SettingsV3): Promise<SettingsV3> {
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

export async function readAdaptiveTuningState(): Promise<AdaptiveTuningState> {
  const payload = await readStorage<Record<string, unknown>>([ADAPTIVE_TUNING_STORAGE_KEY]);
  return normalizeAdaptiveTuningState(payload[ADAPTIVE_TUNING_STORAGE_KEY], Date.now());
}

export async function setAdaptiveTuningEnabled(enabled: boolean): Promise<AdaptiveTuningState> {
  return enqueueStorageMutation(async () => {
    const nextRaw = await sendRuntimeMessage<Record<string, unknown>>(
      MESSAGE_TYPES.ADAPTIVE_SET_ENABLED,
      {
        enabled: enabled !== false,
        now: Date.now(),
      }
    );
    return normalizeAdaptiveTuningState(nextRaw, Date.now());
  });
}

export async function readExperienceMetricsSnapshot(days = 7): Promise<ExperienceMetricsSnapshot> {
  const now = Date.now();
  const payload = await readStorage<Record<string, unknown>>([EXPERIENCE_METRICS_STORAGE_KEY]);
  const state = normalizeExperienceMetricsState(payload[EXPERIENCE_METRICS_STORAGE_KEY]);
  return buildExperienceMetricsSnapshot(state, days, now);
}

export async function readOnboardingState(): Promise<OnboardingState> {
  const payload = await readStorage<Record<string, unknown>>([ONBOARDING_STORAGE_KEY]);
  return normalizeOnboardingState(payload[ONBOARDING_STORAGE_KEY]);
}

export async function completeOnboarding(
  selectedGoal: OnboardingGoal | null = null,
  now = Date.now()
): Promise<OnboardingState> {
  return enqueueStorageMutation(async () => {
    const timestamp = normalizeTimestamp(now) || Date.now();
    const nextState: OnboardingState = {
      completedAt: timestamp,
      selectedGoal: normalizeOnboardingGoal(selectedGoal),
      updatedAt: timestamp,
    };
    await writeStorage({
      [ONBOARDING_STORAGE_KEY]: nextState,
    });
    return nextState;
  });
}

function normalizeLearningSummary(input: unknown): LearningSummary {
  const source = input && typeof input === 'object' ? (input as Partial<LearningSummary>) : {};
  const words = Array.isArray(source.recentWords)
    ? source.recentWords
        .filter((item): item is { word: string; translation?: string; status?: string } =>
          Boolean(item && typeof item === 'object')
        )
        .map((item) => ({
          word: String(item.word || '').trim(),
          translation: String(item.translation || '').trim(),
          status: String(item.status || '').trim(),
        }))
        .filter((item) => Boolean(item.word))
    : [];
  return {
    todayCount: Math.max(0, Math.floor(Number(source.todayCount) || 0)),
    newCount: Math.max(0, Math.floor(Number(source.newCount) || 0)),
    masteredCount: Math.max(0, Math.floor(Number(source.masteredCount) || 0)),
    recentWords: words.slice(0, 5),
  };
}

function getLearningStateApi(): LearningStateApi | null {
  const scopedGlobal = globalThis as typeof globalThis & { LearningState?: LearningStateApi };
  return scopedGlobal.LearningState || null;
}

function buildEmptyLearningSummary(): LearningSummary {
  const learningState = getLearningStateApi();
  if (learningState && typeof learningState.buildLearningSummary === 'function') {
    return normalizeLearningSummary(learningState.buildLearningSummary({}, {}));
  }
  return {
    todayCount: 0,
    newCount: 0,
    masteredCount: 0,
    recentWords: [],
  };
}

function normalizeLearningStats(
  rawStats: unknown,
  learningState: LearningStateApi
): Record<string, LearningRecord> {
  if (!rawStats || typeof rawStats !== 'object' || !learningState.normalizeLearningRecord) {
    return {};
  }

  const normalized: Record<string, LearningRecord> = {};
  Object.keys(rawStats as Record<string, unknown>).forEach((key) => {
    const item = (rawStats as Record<string, unknown>)[key];
    if (!item || typeof item !== 'object') {
      return;
    }

    const normalizedItem = learningState.normalizeLearningRecord!(item, {
      word: (item as Record<string, unknown>).word || key,
      level: (item as Record<string, unknown>).level,
    });
    const normalizedWord = String(normalizedItem.word || '')
      .trim()
      .toLowerCase();
    if (!normalizedWord) {
      return;
    }
    normalized[normalizedWord] = {
      ...normalizedItem,
      ...buildLearningRecordExportMetadata(item),
    };
  });
  return normalized;
}

function migrateLegacyLearningStats(
  rawStats: unknown,
  learningState: LearningStateApi
): Record<string, LearningRecord> {
  if (!rawStats || typeof rawStats !== 'object' || !learningState.migrateLegacyStat) {
    return {};
  }

  const normalized: Record<string, LearningRecord> = {};
  Object.keys(rawStats as Record<string, unknown>).forEach((key) => {
    const migrated = learningState.migrateLegacyStat!((rawStats as Record<string, unknown>)[key]);
    const normalizedWord = String(migrated.word || '')
      .trim()
      .toLowerCase();
    if (!normalizedWord) {
      return;
    }
    normalized[normalizedWord] = migrated;
  });
  return normalized;
}

function normalizeReviewQueue(
  rawQueue: unknown,
  learningState: LearningStateApi
): Record<string, ReviewQueueEntry> {
  if (!learningState.normalizeReviewQueue) {
    return {};
  }
  return learningState.normalizeReviewQueue(rawQueue);
}

function buildLearningSummaryFromStorageState(
  rawStats: unknown,
  rawQueue: unknown,
  learningState: LearningStateApi | null
): LearningSummary | null {
  if (!learningState || typeof learningState.buildLearningSummary !== 'function') {
    return null;
  }

  return normalizeLearningSummary(
    learningState.buildLearningSummary(
      normalizeLearningStats(rawStats, learningState),
      normalizeReviewQueue(rawQueue, learningState)
    )
  );
}

function buildQuickReviewItems(
  stats: Record<string, LearningRecord>,
  queue: Record<string, ReviewQueueEntry>,
  limit = 5
): QuickReviewItem[] {
  const items = Object.values(queue)
    .map((item) => {
      const recordKey = String(item.word || '')
        .trim()
        .toLowerCase();
      const record = stats[recordKey];
      if (!record) {
        return null;
      }

      return {
        word: String(record.word || '').trim(),
        translation: String(record.translation || '').trim(),
        level: String(record.level || '')
          .trim()
          .toUpperCase(),
        status: String(record.status || '')
          .trim()
          .toLowerCase(),
        dueBucket: String(item.dueBucket || record.nextReviewBucket || 'today')
          .trim()
          .toLowerCase(),
        nextReviewAt: normalizeTimestamp(item.nextReviewAt ?? record.nextReviewAt),
        intervalDays: Number.isFinite(Number(item.intervalDays))
          ? Math.max(1, Math.floor(Number(item.intervalDays)))
          : null,
        easeFactor: Number.isFinite(Number(item.easeFactor)) ? Number(item.easeFactor) : null,
        updatedAt: normalizeTimestamp(item.updatedAt ?? record.lastSeenAt ?? record.lastSeen) || 0,
      } satisfies QuickReviewItem;
    })
    .filter((item): item is QuickReviewItem => Boolean(item && item.word));

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 5));
  return sortQuickReviewItems(items).slice(0, safeLimit);
}

async function readQuickReviewState(limit = 5): Promise<{
  summary: LearningSummary;
  items: QuickReviewItem[];
  stats: Record<string, LearningRecord>;
  queue: Record<string, ReviewQueueEntry>;
}> {
  const learningState = getLearningStateApi();
  if (!learningState) {
    return {
      summary: buildEmptyLearningSummary(),
      items: [],
      stats: {},
      queue: {},
    };
  }

  const payload = await readStorage<Record<string, unknown>>([
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
    REVIEW_QUEUE_STORAGE_KEY,
    LEARNING_SUMMARY_STORAGE_KEY,
  ]);
  let stats = normalizeLearningStats(payload[LEARNING_WORD_STATS_STORAGE_KEY], learningState);
  if (!Object.keys(stats).length) {
    stats = migrateLegacyLearningStats(payload[WORD_STATS_STORAGE_KEY], learningState);
  }
  const queue = normalizeReviewQueue(payload[REVIEW_QUEUE_STORAGE_KEY], learningState);
  const summary =
    payload[LEARNING_SUMMARY_STORAGE_KEY] &&
    typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === 'object'
      ? normalizeLearningSummary(payload[LEARNING_SUMMARY_STORAGE_KEY])
      : normalizeLearningSummary(
          learningState.buildLearningSummary ? learningState.buildLearningSummary(stats, queue) : {}
        );

  return {
    summary,
    items: buildQuickReviewItems(stats, queue, limit),
    stats,
    queue,
  };
}

export async function readQuickReviewDashboard(limit = 5): Promise<QuickReviewDashboard> {
  const state = await readQuickReviewState(limit);
  return {
    summary: state.summary,
    items: state.items,
  };
}

function normalizeQuickReviewAction(action: QuickReviewAction): string {
  const normalized = String(action || 'dontknow')
    .trim()
    .toLowerCase();
  if (normalized === 'know' || normalized === 'fuzzy') {
    return normalized;
  }
  return 'dontknow';
}

async function persistQuickReviewAdaptiveFeedback(action: string, now: number): Promise<boolean> {
  try {
    const outcome = await sendRuntimeMessage<Record<string, unknown>>(
      MESSAGE_TYPES.ADAPTIVE_PERSIST_FEEDBACK,
      {
        feedback: action,
        options: { now },
      }
    );
    return outcome.applied === true;
  } catch {
    return false;
  }
}

export async function submitQuickReviewFeedback(
  word: string,
  action: QuickReviewAction,
  limit = 5
): Promise<QuickReviewCommitResult> {
  const learningState = getLearningStateApi();
  if (!learningState) {
    throw new Error('LearningState unavailable');
  }

  return enqueueStorageMutation(async () => {
    const normalizedWord = String(word || '')
      .trim()
      .toLowerCase();
    const normalizedAction = normalizeQuickReviewAction(action);
    const now = Date.now();
    const committed = await sendRuntimeMessage<{
      word: string;
      stats: Record<string, LearningRecord>;
      queue: Record<string, ReviewQueueEntry>;
      summary: LearningSummary;
    }>(MESSAGE_TYPES.LEARNING_APPLY_REVIEW_FEEDBACK, {
      word: normalizedWord,
      action: normalizedAction,
      now,
    });

    // Streak bookkeeping should not block the main review commit path.
    void touchLearningStreak(now);
    const adaptiveApplied = await persistQuickReviewAdaptiveFeedback(normalizedAction, now);
    const nextStats = normalizeLearningStats(committed.stats, learningState);
    const nextQueue = normalizeReviewQueue(committed.queue, learningState);
    const nextSummary = normalizeLearningSummary(committed.summary);
    return {
      word: String(committed.word || normalizedWord).trim(),
      summary: nextSummary,
      items: buildQuickReviewItems(nextStats, nextQueue, limit),
      adaptiveApplied,
    };
  });
}

function buildEncounteredWordFallback(
  rawStats: unknown,
  learningState: LearningStateApi | null
): EncounteredWordRankingItem[] {
  if (!learningState) {
    return [];
  }
  return Object.values(normalizeLearningStats(rawStats, learningState))
    .map((record) => normalizeEncounteredWord(record))
    .filter((item): item is EncounteredWordRankingItem => Boolean(item && item.hitCount > 0));
}

export async function readEncounteredWordRanking(
  sortMode: EncounteredWordSortMode = 'asc',
  limit = 6
): Promise<EncounteredWordRankingItem[]> {
  const payload = await readStorage<Record<string, unknown>>([
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
  ]);
  let items = Object.values(
    payload[WORD_STATS_STORAGE_KEY] && typeof payload[WORD_STATS_STORAGE_KEY] === 'object'
      ? (payload[WORD_STATS_STORAGE_KEY] as Record<string, unknown>)
      : {}
  )
    .map((entry) => normalizeEncounteredWord(entry))
    .filter((item): item is EncounteredWordRankingItem => Boolean(item && item.hitCount > 0));

  if (!items.length) {
    items = buildEncounteredWordFallback(
      payload[LEARNING_WORD_STATS_STORAGE_KEY],
      getLearningStateApi()
    );
  }

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 6));
  return sortEncounteredWords(items, sortMode).slice(0, safeLimit);
}

function resolveActiveTabOriginPattern(rawUrl: unknown): {
  hostname: string;
  originPattern: string;
  defaultSupported: boolean;
  validOptionalOrigin: boolean;
} {
  try {
    const url = new URL(String(rawUrl || ''));
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();
    const originPattern = hostname && protocol === 'https:' ? `${protocol}//${hostname}/*` : '';
    return {
      hostname,
      originPattern,
      defaultSupported:
        protocol === 'https:' &&
        (hostname === 'www.bilibili.com' || hostname === 'www.youtube.com'),
      validOptionalOrigin: Boolean(originPattern),
    };
  } catch {
    return {
      hostname: '',
      originPattern: '',
      defaultSupported: false,
      validOptionalOrigin: false,
    };
  }
}

function createInactiveSitePermissionState(message: string): ActiveTabSitePermissionState {
  return {
    hostname: '',
    originPattern: '',
    defaultSupported: false,
    authorized: false,
    canRequest: false,
    canRevoke: false,
    message,
  };
}

function containsHostPermission(originPattern: string): Promise<boolean> {
  if (!hasChromePermissions() || !originPattern) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    chrome.permissions.contains({ origins: [originPattern] }, (result) => {
      const runtimeError = getChromeRuntimeError('chrome.permissions.contains failed');
      resolve(!runtimeError && result === true);
    });
  });
}

function requestHostPermission(originPattern: string): Promise<boolean> {
  if (!hasChromePermissions() || !originPattern) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins: [originPattern] }, (granted) => {
      const runtimeError = getChromeRuntimeError('chrome.permissions.request failed');
      resolve(!runtimeError && granted === true);
    });
  });
}

function removeHostPermission(originPattern: string): Promise<boolean> {
  if (!hasChromePermissionRemoval() || !originPattern) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    chrome.permissions.remove({ origins: [originPattern] }, (removed) => {
      const runtimeError = getChromeRuntimeError('chrome.permissions.remove failed');
      resolve(!runtimeError && removed === true);
    });
  });
}

function insertContentRuntimeCss(tabId: number): Promise<void> {
  if (!hasChromeScripting()) {
    return Promise.reject(new Error('chrome.scripting unavailable'));
  }

  return new Promise<void>((resolve, reject) => {
    chrome.scripting.insertCSS(
      {
        target: { tabId },
        files: CONTENT_RUNTIME_STYLE_FILES.slice(),
      },
      () => {
        const runtimeError = getChromeRuntimeError('chrome.scripting.insertCSS failed');
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve();
      }
    );
  });
}

function executeContentRuntimeScripts(tabId: number): Promise<void> {
  if (!hasChromeScripting()) {
    return Promise.reject(new Error('chrome.scripting unavailable'));
  }

  return new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: CONTENT_RUNTIME_SCRIPT_FILES.slice(),
      },
      () => {
        const runtimeError = getChromeRuntimeError('chrome.scripting.executeScript failed');
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve();
      }
    );
  });
}

async function injectContentRuntimeIntoActiveTab(): Promise<boolean> {
  const activeTab = await queryActiveTab().catch(() => null);
  if (!activeTab || typeof activeTab.id !== 'number' || !hasChromeScripting()) {
    return false;
  }

  try {
    await insertContentRuntimeCss(activeTab.id);
    await executeContentRuntimeScripts(activeTab.id);
    return true;
  } catch {
    return false;
  }
}

export async function readActiveTabSitePermissionState(): Promise<ActiveTabSitePermissionState> {
  const activeTab = await queryActiveTab().catch(() => null);
  const target = resolveActiveTabOriginPattern(activeTab && activeTab.url);

  if (!target.hostname) {
    return createInactiveSitePermissionState('当前页面无法识别域名，无法请求站点授权。');
  }

  if (target.defaultSupported) {
    return {
      hostname: target.hostname,
      originPattern: target.originPattern,
      defaultSupported: true,
      authorized: true,
      canRequest: false,
      canRevoke: false,
      message: '默认支持站点已随扩展安装授权。',
    };
  }

  if (!target.validOptionalOrigin) {
    return {
      hostname: target.hostname,
      originPattern: '',
      defaultSupported: false,
      authorized: false,
      canRequest: false,
      canRevoke: false,
      message: '当前页面不是可授权的 HTTPS 站点。',
    };
  }

  const authorized = await containsHostPermission(target.originPattern);
  return {
    hostname: target.hostname,
    originPattern: target.originPattern,
    defaultSupported: false,
    authorized,
    canRequest: !authorized && hasChromePermissions(),
    canRevoke: authorized && hasChromePermissionRemoval(),
    message: authorized
      ? '当前站点已获得 optional host permission。'
      : '当前站点尚未授权，网页正文模式不会在此站点运行。',
  };
}

export async function requestActiveTabSitePermission(): Promise<ActiveTabSitePermissionState> {
  const current = await readActiveTabSitePermissionState();
  if (!current.canRequest || !current.originPattern) {
    return current;
  }

  const granted = await requestHostPermission(current.originPattern);
  const injected = granted ? await injectContentRuntimeIntoActiveTab() : false;
  return {
    ...current,
    authorized: granted,
    canRequest: !granted && hasChromePermissions(),
    canRevoke: granted && hasChromePermissionRemoval(),
    message: granted
      ? injected
        ? '已获得当前站点授权，并已注入当前页面。'
        : '已获得当前站点授权；当前页面需要刷新或重新打开后再试。'
      : '用户未授予当前站点权限，站点规则保持不变。',
  };
}

export async function removeActiveTabSitePermission(): Promise<ActiveTabSitePermissionState> {
  const current = await readActiveTabSitePermissionState();
  if (!current.canRevoke || !current.originPattern) {
    return current;
  }

  const removed = await removeHostPermission(current.originPattern);
  if (!removed) {
    return {
      ...current,
      message: '当前站点授权撤销失败，请稍后重试。',
    };
  }

  const stopped = await teardownActiveTabContentRuntime();
  return {
    ...current,
    authorized: false,
    canRequest: hasChromePermissions(),
    canRevoke: false,
    message: stopped
      ? '已撤销当前站点授权，并已停止当前页面运行。'
      : '已撤销当前站点授权；当前页面刷新后会完全停止运行。',
  };
}

function createEmptyActiveTabSubtitleNavigation(
  description = '请先打开支持字幕的 Bilibili 视频页。'
): ActiveTabSubtitleNavigation {
  return {
    supported: false,
    progressLabel: '未连接',
    headline: '当前标签页暂无字幕导航',
    description,
    currentText: '还没有可直接跳转的字幕句段。',
    canGoPrevious: false,
    canReplay: false,
    canGoNext: false,
  };
}

function normalizeActiveTabSubtitleNavigation(value: unknown): ActiveTabSubtitleNavigation {
  const source = isObjectRecord(value) ? value : {};
  return {
    supported: source.supported === true,
    progressLabel: String(source.progressLabel || '未连接').trim() || '未连接',
    headline:
      String(source.headline || '当前标签页暂无字幕导航').trim() || '当前标签页暂无字幕导航',
    description:
      String(source.description || '请先打开支持字幕的 Bilibili 视频页。').trim() ||
      '请先打开支持字幕的 Bilibili 视频页。',
    currentText:
      String(source.currentText || '还没有可直接跳转的字幕句段。').trim() ||
      '还没有可直接跳转的字幕句段。',
    canGoPrevious: source.canGoPrevious === true,
    canReplay: source.canReplay === true,
    canGoNext: source.canGoNext === true,
  };
}

function resolveHostnameFromTabUrl(rawUrl: unknown): string {
  try {
    return rawUrl ? new URL(String(rawUrl)).hostname : '';
  } catch {
    return '';
  }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (!hasChromeTabs()) {
    return null;
  }
  return new Promise<chrome.tabs.Tab | null>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = getChromeRuntimeError('chrome.tabs.query failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve(Array.isArray(tabs) && tabs.length ? tabs[0] : null);
    });
  });
}

async function sendTabMessage<T>(
  activeTab: chrome.tabs.Tab | null,
  type: string,
  payload: Record<string, unknown>
): Promise<T> {
  if (!hasChromeTabMessaging()) {
    return Promise.reject(new Error('chrome.tabs.sendMessage unavailable'));
  }

  if (!activeTab || typeof activeTab.id !== 'number') {
    return Promise.reject(new Error('active tab unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(activeTab.id as number, { type, payload }, (response) => {
        const runtimeError = getChromeRuntimeError('chrome.tabs.sendMessage failed');
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        if (!response || response.ok !== true) {
          reject(
            new Error(String(response && response.error ? response.error : 'tab message failed'))
          );
          return;
        }
        resolve(response.payload as T);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function sendActiveTabMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  return sendTabMessage(await queryActiveTab(), type, payload);
}

async function teardownActiveTabContentRuntime(): Promise<boolean> {
  try {
    await sendActiveTabMessage('BILI_VOCAB_CONTENT_TEARDOWN', {});
    return true;
  } catch {
    return false;
  }
}

function connectTabPort(activeTab: chrome.tabs.Tab | null, name: string): chrome.runtime.Port {
  if (!hasChromeTabConnections()) {
    throw new Error('chrome.tabs.connect unavailable');
  }

  if (!activeTab || typeof activeTab.id !== 'number') {
    throw new Error('active tab unavailable');
  }

  return chrome.tabs.connect(activeTab.id, { name });
}

function buildEmptyActiveTabSubtitleStatus(hostname: string): ActiveTabSubtitleStatus {
  return {
    hostname,
    subtitleNavigation: createEmptyActiveTabSubtitleNavigation(
      hostname ? `${hostname} 当前还没有可用字幕导航。` : '当前标签页暂不支持字幕导航。'
    ),
  };
}

export async function readActiveTabSubtitleStatus(): Promise<ActiveTabSubtitleStatus> {
  const activeTab = await queryActiveTab().catch(() => null);
  const hostname = resolveHostnameFromTabUrl(activeTab && activeTab.url);

  try {
    const payload = await sendTabMessage<Record<string, unknown>>(
      activeTab,
      ACTIVE_TAB_SUBTITLE_NAVIGATION_READ,
      {}
    );
    return {
      hostname,
      subtitleNavigation: normalizeActiveTabSubtitleNavigation(payload),
    };
  } catch {
    return buildEmptyActiveTabSubtitleStatus(hostname);
  }
}

export async function navigateActiveTabSubtitle(
  action: ActiveTabSubtitleNavigationAction
): Promise<ActiveTabSubtitleNavigation> {
  const payload = await sendActiveTabMessage<Record<string, unknown>>(
    ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE,
    { action }
  );
  return normalizeActiveTabSubtitleNavigation(payload);
}

function subscribeChromeTabActivation(onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    !chrome.tabs.onActivated ||
    typeof chrome.tabs.onActivated.addListener !== 'function'
  ) {
    return () => {};
  }

  const listener = () => {
    onUpdate();
  };
  chrome.tabs.onActivated.addListener(listener);
  return () => {
    chrome.tabs.onActivated.removeListener(listener);
  };
}

function subscribeChromeTabUpdates(onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    !chrome.tabs.onUpdated ||
    typeof chrome.tabs.onUpdated.addListener !== 'function'
  ) {
    return () => {};
  }

  const listener = (
    _tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: chrome.tabs.Tab
  ) => {
    if (tab && tab.active === false) {
      return;
    }
    if (typeof changeInfo.url === 'string' || changeInfo.status === 'complete') {
      onUpdate();
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  return () => {
    chrome.tabs.onUpdated.removeListener(listener);
  };
}

export function subscribeActiveTabSubtitleStatus(
  onUpdate: (status: ActiveTabSubtitleStatus) => void
): () => void {
  if (!hasChromeTabs()) {
    return () => {};
  }

  let disposed = false;
  let currentPort: chrome.runtime.Port | null = null;
  let currentTabKey = '';
  let reconnectGeneration = 0;

  const disconnectCurrentPort = () => {
    const port = currentPort;
    currentPort = null;
    currentTabKey = '';
    if (!port) {
      return;
    }
    try {
      port.disconnect();
    } catch {
      // Ignore disconnect races when the tab navigates away mid-cleanup.
    }
  };

  const reconnect = async () => {
    const reconnectToken = ++reconnectGeneration;
    const activeTab = await queryActiveTab().catch(() => null);
    if (disposed || reconnectGeneration !== reconnectToken) {
      return;
    }

    const hostname = resolveHostnameFromTabUrl(activeTab && activeTab.url);
    const nextTabKey =
      activeTab && typeof activeTab.id === 'number'
        ? `${activeTab.id}:${String(activeTab.url || '')}`
        : '';

    if (!nextTabKey) {
      disconnectCurrentPort();
      onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      return;
    }

    if (currentPort && currentTabKey === nextTabKey) {
      return;
    }

    disconnectCurrentPort();
    currentTabKey = nextTabKey;

    let port: chrome.runtime.Port;
    try {
      port = connectTabPort(activeTab, ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE);
    } catch {
      currentTabKey = '';
      onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      return;
    }

    currentPort = port;
    port.onMessage.addListener((message: unknown) => {
      if (disposed || currentPort !== port) {
        return;
      }
      const payload =
        isObjectRecord(message) && Object.prototype.hasOwnProperty.call(message, 'payload')
          ? message.payload
          : message;
      onUpdate({
        hostname,
        subtitleNavigation: normalizeActiveTabSubtitleNavigation(payload),
      });
    });
    port.onDisconnect.addListener(() => {
      void getChromeRuntimeError('chrome.tabs.connect disconnected');
      if (currentPort !== port) {
        return;
      }
      currentPort = null;
      currentTabKey = '';
      if (!disposed) {
        onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      }
    });
  };

  const unsubscribeTabActivation = subscribeChromeTabActivation(() => {
    void reconnect();
  });
  const unsubscribeTabUpdates = subscribeChromeTabUpdates(() => {
    void reconnect();
  });

  void reconnect();

  return () => {
    disposed = true;
    unsubscribeTabActivation();
    unsubscribeTabUpdates();
    disconnectCurrentPort();
  };
}

function sanitizeAnkiField(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnkiTsv(savedWords: VocabularyWord[]): string {
  const headers = [
    'Front',
    'Back',
    'Example',
    'Level',
    'Phonetic',
    'SavedAt',
    'SourceTitle',
    'SourceUrl',
    'SourceTime',
  ];
  const rows = savedWords.map((word) => [
    sanitizeAnkiField(word.word),
    sanitizeAnkiField(word.details?.meaning || ''),
    sanitizeAnkiField(word.context || ''),
    sanitizeAnkiField(word.details?.level || ''),
    sanitizeAnkiField(word.details?.phonetic || ''),
    word.savedAt ? new Date(word.savedAt).toISOString() : '',
    sanitizeAnkiField(word.source?.title || ''),
    sanitizeAnkiField(word.source?.url || ''),
    sanitizeAnkiField(word.source?.timeLabel || ''),
  ]);
  return [headers.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');
}

// 生词本导出功能
export async function exportVocabularyBook(
  format: VocabularyExportFormat = 'json'
): Promise<string> {
  const payload = await readStorage<Record<string, unknown>>([VOCABULARY_BOOK_STORAGE_KEY]);
  const wordStats = (payload[VOCABULARY_BOOK_STORAGE_KEY] as Record<string, VocabularyWord>) || {};

  const savedWords = Object.values(wordStats)
    .map((entry) => normalizeVocabularyWord(entry))
    .filter((word): word is VocabularyWord => Boolean(word && word.status === 'saved'))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  if (format === 'csv') {
    const headers = [
      '单词',
      '释义',
      '难度等级',
      '音标',
      '原句上下文',
      '来源标题',
      '来源链接',
      '来源时间点',
      '收藏时间',
      '遇见次数',
    ];
    const rows = savedWords.map((word) => [
      word.word,
      word.details?.meaning || '',
      word.details?.level || '',
      word.details?.phonetic || '',
      word.context || '',
      word.source?.title || '',
      word.source?.url || '',
      word.source?.timeLabel || '',
      word.savedAt ? new Date(word.savedAt).toLocaleString() : '',
      word.exposures || 0,
    ]);
    return [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
  }

  if (format === 'anki') {
    return buildAnkiTsv(savedWords);
  }

  return JSON.stringify(savedWords, null, 2);
}

export async function clearVocabularyBook(): Promise<number> {
  // Single-writer path: the background queue owns the shared learning keys, so
  // route the clear through it to avoid racing concurrent hits/reviews.
  if (hasRuntimeMessaging()) {
    const payload = await sendRuntimeMessage<{ cleared?: number }>(
      MESSAGE_TYPES.LEARNING_CLEAR_VOCABULARY,
      {}
    );
    return Math.max(0, Math.floor(Number(payload && payload.cleared) || 0));
  }

  // Only contexts without a runtime bridge keep the legacy direct write; a
  // failed live runtime must surface instead of dropping unsave events.
  return enqueueStorageMutation(async () => {
    const learningState = getLearningStateApi();
    const payload = await readStorage<Record<string, unknown>>([
      VOCABULARY_BOOK_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
    ]);
    const sourceWordStats =
      payload[VOCABULARY_BOOK_STORAGE_KEY] &&
      typeof payload[VOCABULARY_BOOK_STORAGE_KEY] === 'object'
        ? (payload[VOCABULARY_BOOK_STORAGE_KEY] as Record<string, unknown>)
        : {};

    const nextWordStats = { ...sourceWordStats };
    let clearedCount = 0;

    Object.keys(nextWordStats).forEach((wordKey) => {
      const record = nextWordStats[wordKey];
      const status =
        record && typeof record === 'object'
          ? String((record as Record<string, unknown>).status || '')
              .trim()
              .toLowerCase()
          : '';
      if (!record || typeof record !== 'object' || status !== 'saved') {
        return;
      }

      const nextRecord: Record<string, unknown> = {
        ...(record as Record<string, unknown>),
        status: 'seen',
        // deriveStatus re-promotes any record with saveCount > 0, so reset it here as well.
        saveCount: 0,
      };
      delete nextRecord.savedAt;
      nextWordStats[wordKey] = nextRecord;
      clearedCount += 1;
    });

    if (clearedCount === 0) {
      return 0;
    }

    const nextSummary = buildLearningSummaryFromStorageState(
      nextWordStats,
      payload[REVIEW_QUEUE_STORAGE_KEY],
      learningState
    );
    const nextStoragePayload: Record<string, unknown> = {
      [VOCABULARY_BOOK_STORAGE_KEY]: nextWordStats,
    };
    if (nextSummary) {
      nextStoragePayload[LEARNING_SUMMARY_STORAGE_KEY] = nextSummary;
    }

    await writeStorage(nextStoragePayload);

    return clearedCount;
  });
}

function normalizeLearningStreak(input: unknown): LearningStreak {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const activeDays = Array.isArray(source.activeDays)
    ? source.activeDays.map((day) => String(day || '').trim()).filter((day) => Boolean(day))
    : [];
  return {
    currentStreak: Math.max(0, Math.floor(Number(source.currentStreak) || 0)),
    maxStreak: Math.max(0, Math.floor(Number(source.maxStreak) || 0)),
    lastActiveDate: String(source.lastActiveDate || ''),
    totalActiveDays: Math.max(0, Math.floor(Number(source.totalActiveDays) || 0)),
    activeDays,
  };
}

// 学习 streak 相关
export async function readLearningStreak(): Promise<LearningStreak> {
  const payload = await readStorage<Record<string, unknown>>([LEARNING_STREAK_STORAGE_KEY]);
  return normalizeLearningStreak(payload[LEARNING_STREAK_STORAGE_KEY]);
}

async function touchLearningStreak(now: number): Promise<void> {
  const learningState = getLearningStateApi();
  if (!learningState || typeof learningState.updateLearningStreak !== 'function') {
    return;
  }
  await learningState.updateLearningStreak(now);
}

export function subscribeSettingsChanges(onUpdate: (settings: SettingsV3) => void): () => void {
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
    const nextValue = changes[SETTINGS_STORAGE_KEY_V3].newValue;
    onUpdate(normalizeSettingsV3(nextValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeAdaptiveTuningState(
  onUpdate: (state: AdaptiveTuningState) => void
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
    if (areaName !== 'local' || !changes[ADAPTIVE_TUNING_STORAGE_KEY]) {
      return;
    }
    onUpdate(
      normalizeAdaptiveTuningState(changes[ADAPTIVE_TUNING_STORAGE_KEY].newValue, Date.now())
    );
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeExperienceMetricsSnapshot(
  onUpdate: (snapshot: ExperienceMetricsSnapshot) => void,
  days = 7
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
    if (areaName !== 'local' || !changes[EXPERIENCE_METRICS_STORAGE_KEY]) {
      return;
    }
    const snapshot = buildExperienceMetricsSnapshot(
      normalizeExperienceMetricsState(changes[EXPERIENCE_METRICS_STORAGE_KEY].newValue),
      days,
      Date.now()
    );
    onUpdate(snapshot);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeOnboardingState(onUpdate: (state: OnboardingState) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[ONBOARDING_STORAGE_KEY]) {
      return;
    }
    onUpdate(normalizeOnboardingState(changes[ONBOARDING_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeLearningStreak(onUpdate: (streak: LearningStreak) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[LEARNING_STREAK_STORAGE_KEY]) {
      return;
    }
    onUpdate(normalizeLearningStreak(changes[LEARNING_STREAK_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

function subscribeStorageKeys(keys: string[], onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }

  const watchedKeys = new Set(keys);
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') {
      return;
    }
    const changed = Object.keys(changes).some((key) => watchedKeys.has(key));
    if (changed) {
      onUpdate();
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeQuickReviewSource(onUpdate: () => void): () => void {
  return subscribeStorageKeys(
    [
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
    ],
    onUpdate
  );
}

export async function openOptionsPage(): Promise<void> {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.openOptionsPage === 'function'
  ) {
    await chrome.runtime.openOptionsPage();
  }
}
