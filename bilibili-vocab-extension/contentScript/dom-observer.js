(function () {
  'use strict';

  function createDomObserver(deps) {
    const {
      getSettings,
      MUTATION_OBSERVER_THROTTLE_MS,
      TIMELINE_POLL_MS,
      PROCESS_DELAY_MS,
      LEGACY_WEB_TEXT_PIPELINE_FLAG,
      normalizeText,
      logError,
      hasMethod,
      isVideoSiteHost,
      shouldEnableTimelinePolling,
      applyTranslation,
      invalidateRenderedSubtitles,
      clearTranslationCache,
      getWebTextReplacementController,
      ensureRuntimeBindings,
      queueSubtitleNavigationBroadcast,
      isCurrentSiteEnabled,
      sharedSettings,
    } = deps;

    let observer = null;
    let observerTarget = null;
    let processTimer = null;
    let timelinePollTimer = null;
    let processing = false;
    let pendingProcess = false;
    let lastMutationObserverRefreshAt = 0;

    function normalizeSettingsFallback(rawSettings) {
      const source = rawSettings || {};
      return {
        // Keep the degraded default aligned with the flipped product default
        // (web page replacement is off unless explicitly enabled).
        webPageEnabled: source.webPageEnabled === true,
      };
    }

    function shouldObserveDomMutations(runtimeSettings, hostname) {
      const currentHost =
        typeof hostname === 'string'
          ? hostname
          : globalThis.location && globalThis.location.hostname;
      if (isVideoSiteHost(currentHost) || shouldEnableTimelinePolling()) {
        return true;
      }
      return shouldRestoreWebItems(runtimeSettings) === false;
    }

    function shouldRetargetSubtitleObserver(currentTarget, subtitleContainer) {
      const doc = globalThis.document;
      if (!doc || currentTarget !== doc.body) {
        return false;
      }
      return Boolean(subtitleContainer && subtitleContainer !== doc.body);
    }

    function resolveSubtitleObserverTarget(runtimeSettings) {
      const subtitleContainer = document.querySelector('.bpx-player-subtitle-wrap');
      if (subtitleContainer) {
        return subtitleContainer;
      }
      return shouldObserveDomMutations(runtimeSettings) ? document.body : null;
    }

    function shouldRefreshSubtitleObserver(currentTarget, nextTarget) {
      return currentTarget !== nextTarget;
    }

    function shouldRunMutationObserverRefresh(now) {
      if (now === undefined) {
        now = Date.now();
      }
      if (now - lastMutationObserverRefreshAt < MUTATION_OBSERVER_THROTTLE_MS) {
        return false;
      }
      lastMutationObserverRefreshAt = now;
      return true;
    }

    function runInAnimationFrame(task) {
      const scheduleFrame =
        typeof globalThis.requestAnimationFrame === 'function'
          ? globalThis.requestAnimationFrame.bind(globalThis)
          : function (callback) {
              setTimeout(callback, 0);
            };
      return new Promise(function (resolve) {
        scheduleFrame(function () {
          Promise.resolve()
            .then(function () {
              return task();
            })
            .catch(function (error) {
              logError('Animation frame batch failed', error);
            })
            .finally(function () {
              resolve();
            });
        });
      });
    }

    function shouldRestoreWebItems(runtimeSettings) {
      const normalized = normalizeSettingsFallback(runtimeSettings);
      return normalized.webPageEnabled === false;
    }

    function shouldRunLegacyWebTextPipeline() {
      return globalThis[LEGACY_WEB_TEXT_PIPELINE_FLAG] === true;
    }

    function restoreItemsToSourceText(items) {
      if (!Array.isArray(items)) {
        return;
      }
      items.forEach(function (item) {
        if (!item || !(item.element instanceof HTMLElement)) {
          return;
        }
        var sourceText = normalizeText(
          item.text || globalThis.SubtitleParser.extractSubtitleText(item.element)
        );
        globalThis.SubtitleRenderer.restoreSubtitleElement(item.element, sourceText);
      });
    }

    var destroyed = false;
    var scheduleProcess = (function () {
      var debouncedProcess =
        globalThis.Utils && globalThis.Utils.debounce
          ? globalThis.Utils.debounce(function () {
              if (destroyed) {
                return;
              }
              processAll().catch(function (error) {
                logError('Process failed', error);
              });
            }, PROCESS_DELAY_MS)
          : (function () {
              function fallbackSchedule() {
                if (destroyed) {
                  return;
                }
                if (processTimer) {
                  clearTimeout(processTimer);
                }
                processTimer = setTimeout(function () {
                  processTimer = null;
                  if (destroyed) {
                    return;
                  }
                  processAll().catch(function (error) {
                    logError('Process failed', error);
                  });
                }, PROCESS_DELAY_MS);
              }
              fallbackSchedule.cancel = function cancel() {
                if (processTimer) {
                  clearTimeout(processTimer);
                  processTimer = null;
                }
              };
              return fallbackSchedule;
            })();
      return debouncedProcess;
    })();

    async function processSubtitles() {
      if (destroyed) {
        return;
      }
      var subtitleItems = globalThis.SubtitleParser.getCurrentSubtitleItems();
      if (subtitleItems.length === 0) {
        if (hasMethod(globalThis.SubtitleParser, 'loadSubtitleTimeline')) {
          await globalThis.SubtitleParser.loadSubtitleTimeline().catch(function (error) {
            logError('Subtitle timeline refresh failed', error);
            return [];
          });
        }
        if (destroyed) {
          return;
        }
        var fallbackText = normalizeText(
          globalThis.SubtitleParser.getSubtitleFromTimelineAtCurrentTime()
        );
        if (!fallbackText) {
          return;
        }
        var fallbackElement = globalThis.SubtitleParser.getPrimarySubtitleElement();
        if (fallbackElement) {
          await applyTranslation(fallbackElement, fallbackText);
        }
        return;
      }
      var settings = getSettings();
      if (!isCurrentSiteEnabled(settings)) {
        restoreItemsToSourceText(subtitleItems);
        return;
      }
      var webItems = subtitleItems.filter(function (item) {
        return item && item.mode === 'page';
      });
      var subtitleModeItems = subtitleItems.filter(function (item) {
        return !item || item.mode !== 'page';
      });
      await runInAnimationFrame(async function () {
        if (destroyed) {
          return;
        }
        for (var i = 0; i < subtitleModeItems.length; i += 1) {
          if (destroyed) {
            return;
          }
          await applyTranslation(subtitleModeItems[i].element);
        }
        if (destroyed) {
          return;
        }
        if (shouldRestoreWebItems(settings)) {
          restoreItemsToSourceText(webItems);
          return;
        }
        for (var j = 0; j < webItems.length; j += 1) {
          if (destroyed) {
            return;
          }
          await applyTranslation(webItems[j].element, webItems[j].text);
        }
      });
    }

    async function processAll() {
      if (destroyed) {
        return;
      }
      if (processing) {
        pendingProcess = true;
        return;
      }
      processing = true;
      pendingProcess = false;
      try {
        await processSubtitles();
        if (destroyed) {
          return;
        }
        if (shouldRunLegacyWebTextPipeline()) {
          await processWebPageText();
        }
      } finally {
        processing = false;
        if (pendingProcess && !destroyed) {
          pendingProcess = false;
          scheduleProcess();
        }
      }
    }

    async function processWebPageText() {
      await getWebTextReplacementController().processPageText();
    }

    function observeSubtitleChanges() {
      if (destroyed) {
        return;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      observerTarget = null;
      lastMutationObserverRefreshAt = 0;
      var settings = getSettings();
      var observeTarget = resolveSubtitleObserverTarget(settings);
      if (!observeTarget) {
        return;
      }
      observerTarget = observeTarget;
      observer = new MutationObserver(function () {
        var latestTarget = resolveSubtitleObserverTarget(settings);
        if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
          observeSubtitleChanges();
        }
        if (!shouldRunMutationObserverRefresh()) {
          return;
        }
        ensureRuntimeBindings();
        startTimelinePolling();
        queueSubtitleNavigationBroadcast();
        processAll().catch(function (error) {
          logError('Process failed', error);
        });
      });
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    function startTimelinePolling() {
      if (destroyed) {
        return;
      }
      var shouldPoll = shouldEnableTimelinePolling();
      if (!shouldPoll) {
        if (timelinePollTimer) {
          clearInterval(timelinePollTimer);
          timelinePollTimer = null;
        }
        return;
      }
      if (timelinePollTimer) {
        return;
      }
      timelinePollTimer = setInterval(function () {
        if (destroyed) {
          return;
        }
        var settings = getSettings();
        var latestTarget = resolveSubtitleObserverTarget(settings);
        if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
          observeSubtitleChanges();
        }
        ensureRuntimeBindings();
        queueSubtitleNavigationBroadcast();
        scheduleProcess();
      }, TIMELINE_POLL_MS);
    }

    function destroy() {
      destroyed = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      observerTarget = null;
      if (typeof scheduleProcess.cancel === 'function') {
        scheduleProcess.cancel();
      }
      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }
      if (timelinePollTimer) {
        clearInterval(timelinePollTimer);
        timelinePollTimer = null;
      }
      processing = false;
      pendingProcess = false;
    }

    return {
      scheduleProcess: scheduleProcess,
      observeSubtitleChanges: observeSubtitleChanges,
      startTimelinePolling: startTimelinePolling,
      processSubtitles: processSubtitles,
      processAll: processAll,
      shouldObserveDomMutations: shouldObserveDomMutations,
      shouldRetargetSubtitleObserver: shouldRetargetSubtitleObserver,
      shouldRefreshSubtitleObserver: shouldRefreshSubtitleObserver,
      shouldRestoreWebItems: shouldRestoreWebItems,
      shouldRunLegacyWebTextPipeline: shouldRunLegacyWebTextPipeline,
      runInAnimationFrame: runInAnimationFrame,
      destroy,
    };
  }

  var api = { createDomObserver: createDomObserver };

  globalThis.BiliVocabDomObserver = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
