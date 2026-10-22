(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.

  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const runtimeMessaging =
    globalScope.RuntimeMessaging ||
    (typeof require === 'function' ? require('./runtimeMessaging.js') : null);
  const adaptiveTuning =
    globalScope.AdaptiveTuning ||
    (typeof require === 'function' ? require('./adaptiveTuning.js') : null);
  const experienceMetrics =
    globalScope.ExperienceMetrics ||
    (typeof require === 'function' ? require('./experienceMetrics.js') : null);
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);
  const backgroundLearningState =
    globalScope.BackgroundLearningState ||
    (typeof require === 'function' ? require('./background-learning-state.js') : null);
  const backgroundLearningSync =
    globalScope.BackgroundLearningSync ||
    (typeof require === 'function' ? require('./background-learning-sync.js') : null);

  const SETTINGS_STORAGE_KEY_V3 =
    backgroundStorage && backgroundStorage.SETTINGS_STORAGE_KEY_V3
      ? backgroundStorage.SETTINGS_STORAGE_KEY_V3
      : sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
        ? sharedSettings.SETTINGS_STORAGE_KEY_V3
        : 'bili_vocab_settings_v3';

  const setStoragePayload = backgroundStorage && backgroundStorage.setStoragePayload;
  const getStoragePayload = backgroundStorage && backgroundStorage.getStoragePayload;
  const normalizeTimestamp = backgroundStorage && backgroundStorage.normalizeTimestamp;
  const logBackgroundError = backgroundStorage && backgroundStorage.logBackgroundError;

  let sharedStateMutationQueue = Promise.resolve();

  function enqueueSharedStateMutation(task) {
    const nextTask = sharedStateMutationQueue.then(task, task);
    sharedStateMutationQueue = nextTask.then(
      () => undefined,
      () => undefined
    );
    return nextTask;
  }

  function toMessageError(error, fallbackMessage) {
    const message = String((error && error.message) || error || '').trim();
    return message || fallbackMessage;
  }

  async function commitSettingsPayload(messagePayload) {
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const normalizedSettings =
      sharedSettings && typeof sharedSettings.normalizeSettingsV3 === 'function'
        ? sharedSettings.normalizeSettingsV3(payload.settings)
        : payload.settings;
    const shouldMarkManualOverride = payload.markManualOverride !== false;

    if (!shouldMarkManualOverride || !adaptiveTuning || !experienceMetrics) {
      await setStoragePayload({
        [SETTINGS_STORAGE_KEY_V3]: normalizedSettings,
      });
      return normalizedSettings;
    }

    const now = normalizeTimestamp(payload.now) || Date.now();
    const currentPayload = await getStoragePayload([
      adaptiveTuning.STORAGE_KEYS.STATE,
      experienceMetrics.STORAGE_KEY,
    ]);
    const nextAdaptiveState = adaptiveTuning.markManualOverride(
      currentPayload[adaptiveTuning.STORAGE_KEYS.STATE],
      now,
      payload.durationMs
    );
    const nextMetricsState = experienceMetrics.applyEventToState(
      currentPayload[experienceMetrics.STORAGE_KEY],
      'adaptive-manual-override',
      { now }
    );

    await setStoragePayload({
      [SETTINGS_STORAGE_KEY_V3]: normalizedSettings,
      [adaptiveTuning.STORAGE_KEYS.STATE]: nextAdaptiveState,
      [experienceMetrics.STORAGE_KEY]: nextMetricsState,
    });
    return normalizedSettings;
  }

  async function persistAdaptiveFeedback(messagePayload) {
    if (!adaptiveTuning || !experienceMetrics) {
      throw new Error('Adaptive modules unavailable');
    }

    const feedback = messagePayload ? messagePayload.feedback : '';
    const options =
      messagePayload && typeof messagePayload.options === 'object' ? messagePayload.options : {};
    const now = normalizeTimestamp(options.now) || Date.now();
    const currentPayload = await getStoragePayload([
      SETTINGS_STORAGE_KEY_V3,
      adaptiveTuning.STORAGE_KEYS.STATE,
      experienceMetrics.STORAGE_KEY,
    ]);
    const result = adaptiveTuning.applyFeedbackToPayload(currentPayload, feedback, now);
    const patch = {
      [adaptiveTuning.STORAGE_KEYS.STATE]: result.nextState,
    };

    if (result.applied && result.nextSettingsV3) {
      patch[SETTINGS_STORAGE_KEY_V3] = result.nextSettingsV3;
      patch[experienceMetrics.STORAGE_KEY] = experienceMetrics.applyEventToState(
        currentPayload[experienceMetrics.STORAGE_KEY],
        'adaptive-decision-applied',
        {
          now,
          mode: result.decision && result.decision.mode,
        }
      );
    }

    await setStoragePayload(patch);
    return result;
  }

  async function setAdaptiveEnabled(messagePayload) {
    if (!adaptiveTuning || !experienceMetrics) {
      throw new Error('Adaptive modules unavailable');
    }

    const enabled = !messagePayload || messagePayload.enabled !== false;
    const now = normalizeTimestamp(messagePayload && messagePayload.now) || Date.now();
    const currentPayload = await getStoragePayload([
      adaptiveTuning.STORAGE_KEYS.STATE,
      experienceMetrics.STORAGE_KEY,
    ]);
    const nextAdaptiveState = adaptiveTuning.normalizeState({
      ...(currentPayload[adaptiveTuning.STORAGE_KEYS.STATE] || {}),
      enabled,
    });
    const nextMetricsState = experienceMetrics.applyEventToState(
      currentPayload[experienceMetrics.STORAGE_KEY],
      'adaptive-toggle',
      {
        now,
        enabled,
      }
    );

    await setStoragePayload({
      [adaptiveTuning.STORAGE_KEYS.STATE]: nextAdaptiveState,
      [experienceMetrics.STORAGE_KEY]: nextMetricsState,
    });
    return nextAdaptiveState;
  }

  async function recordExperienceEvent(messagePayload) {
    if (!experienceMetrics) {
      throw new Error('Experience metrics unavailable');
    }

    const eventType = String(messagePayload && messagePayload.type ? messagePayload.type : '')
      .trim()
      .toLowerCase();
    if (!eventType) {
      return null;
    }

    const options =
      messagePayload && typeof messagePayload.options === 'object' ? messagePayload.options : {};
    const currentPayload = await getStoragePayload([experienceMetrics.STORAGE_KEY]);
    const nextMetricsState = experienceMetrics.applyEventToState(
      currentPayload[experienceMetrics.STORAGE_KEY],
      eventType,
      options
    );

    await setStoragePayload({
      [experienceMetrics.STORAGE_KEY]: nextMetricsState,
    });
    return nextMetricsState;
  }

  function handleBackgroundMessage(message, sender, sendResponse) {
    const respond =
      typeof sendResponse === 'function'
        ? sendResponse
        : typeof sender === 'function'
          ? sender
          : null;
    const messageSender = typeof sender === 'function' ? null : sender;

    if (
      runtimeMessaging &&
      typeof runtimeMessaging.isTrustedExtensionSender === 'function' &&
      !runtimeMessaging.isTrustedExtensionSender(messageSender)
    ) {
      if (typeof respond === 'function') {
        respond({ ok: false, error: 'Untrusted extension sender' });
      }
      return false;
    }

    const messageType = String(message && message.type ? message.type : '').trim();
    let task = null;

    if (runtimeMessaging && messageType === runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT) {
      task = () => commitSettingsPayload(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.ADAPTIVE_PERSIST_FEEDBACK
    ) {
      task = () => persistAdaptiveFeedback(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.ADAPTIVE_SET_ENABLED
    ) {
      task = () => setAdaptiveEnabled(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.EXPERIENCE_RECORD_EVENT
    ) {
      task = () => recordExperienceEvent(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_HIT
    ) {
      task = () => backgroundLearningState.recordLearningHit(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_APPLY_REVIEW_FEEDBACK
    ) {
      task = () => backgroundLearningState.applyReviewFeedback(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_SAVE_WORD
    ) {
      task = () => backgroundLearningState.saveWord(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_REMOVE_WORD
    ) {
      task = () => backgroundLearningState.removeWord(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_CLEAR_VOCABULARY
    ) {
      task = () => backgroundLearningState.clearVocabulary(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_LOOKUP
    ) {
      task = () => backgroundLearningState.recordLearningLookup(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_EXPORT_DATA
    ) {
      task = () => backgroundLearningState.exportLearningData(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.LEARNING_IMPORT_DATA
    ) {
      task = () => backgroundLearningState.importLearningData(message.payload || {});
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.SYNC_GET_SETTINGS
    ) {
      task = () => backgroundLearningSync.readSyncSettings();
    } else if (
      runtimeMessaging &&
      messageType === runtimeMessaging.MESSAGE_TYPES.SYNC_SAVE_SETTINGS
    ) {
      task = () => backgroundLearningSync.saveSyncSettings(message.payload || {});
    } else if (runtimeMessaging && messageType === runtimeMessaging.MESSAGE_TYPES.SYNC_GET_STATUS) {
      task = () => backgroundLearningSync.readStatus(message.payload || {});
    } else if (runtimeMessaging && messageType === runtimeMessaging.MESSAGE_TYPES.SYNC_RUN) {
      // Network sync runs inside the shared queue so pull-import and the follow-up
      // push observe one consistent local snapshot.
      task = () => backgroundLearningSync.syncNow(message.payload || {});
    }

    if (!task) {
      return false;
    }

    if (typeof respond !== 'function') {
      return false;
    }

    enqueueSharedStateMutation(task).then(
      (payload) => {
        respond({ ok: true, payload });
      },
      (error) => {
        logBackgroundError(`Failed to process ${messageType}`, error);
        respond({
          ok: false,
          error: toMessageError(error, `Failed to process ${messageType}`),
        });
      }
    );
    return true;
  }

  const api = {
    enqueueSharedStateMutation,
    commitSettingsPayload,
    persistAdaptiveFeedback,
    setAdaptiveEnabled,
    recordExperienceEvent,
    initializeLearningData: () =>
      backgroundLearningState
        ? enqueueSharedStateMutation(() => backgroundLearningState.initializeLearningData())
        : Promise.resolve({ initialized: false }),
    handleBackgroundMessage,
  };

  globalScope.BackgroundMessageHandler = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
