(function () {
  const isCommonJsRuntime = typeof module !== 'undefined' && module.exports;

  function createDanmakuEngine(deps) {
    const {
      getSettings,
      getBoundVideo,
      setBoundVideo,
      scheduleProcess,
      invalidateRenderedSubtitles,
      logError,
      sharedSettings,
      normalizeReviewDanmakuSpeed,
      normalizeReviewDanmakuDensity,
    } = deps;

    const DEBUG_LOG_FLAG = '__BILI_VOCAB_DEBUG_LOGS__';

    function shouldLogDebug() {
      return globalThis[DEBUG_LOG_FLAG] === true;
    }

    function logDebug(...args) {
      if (shouldLogDebug()) {
        console.debug(...args);
      }
    }

    function hasMethod(obj, method) {
      return obj && typeof obj[method] === 'function';
    }

    function startReviewEngine() {
      if (hasMethod(globalThis.SchedulerModule, 'startEngine')) {
        globalThis.SchedulerModule.startEngine();
      }
    }

    function stopReviewEngine(clearExistingDanmaku) {
      if (globalThis.SchedulerModule) {
        if (hasMethod(globalThis.SchedulerModule, 'stopEngine')) {
          globalThis.SchedulerModule.stopEngine();
        } else if (hasMethod(globalThis.SchedulerModule, 'pauseEngine')) {
          globalThis.SchedulerModule.pauseEngine();
        }
      }

      if (clearExistingDanmaku && hasMethod(globalThis.DanmakuModule, 'clearDanmaku')) {
        globalThis.DanmakuModule.clearDanmaku();
      }
    }

    function pauseReviewEngine() {
      if (hasMethod(globalThis.SchedulerModule, 'pauseEngine')) {
        globalThis.SchedulerModule.pauseEngine();
      }
    }

    function syncDanmakuSettings() {
      const settings = getSettings();
      if (hasMethod(globalThis.DanmakuModule, 'setSpeedPreset')) {
        globalThis.DanmakuModule.setSpeedPreset(settings.reviewDanmakuSpeed);
      }
      if (hasMethod(globalThis.DanmakuModule, 'setDensityPreset')) {
        globalThis.DanmakuModule.setDensityPreset(settings.reviewDanmakuDensity);
      }
      if (hasMethod(globalThis.SchedulerModule, 'setDensityPreset')) {
        globalThis.SchedulerModule.setDensityPreset(settings.reviewDanmakuDensity);
      }
    }

    function shouldRunReviewDanmaku(runtimeSettings = {}, playbackState = {}) {
      return (
        runtimeSettings.reviewDanmakuEnabled === true &&
        playbackState.hasVideo === true &&
        playbackState.paused !== true &&
        playbackState.ended !== true
      );
    }

    function getPlaybackState() {
      const boundVideo = getBoundVideo();
      if (!(boundVideo instanceof HTMLVideoElement)) {
        return {
          hasVideo: false,
          paused: true,
          ended: true,
        };
      }

      return {
        hasVideo: true,
        paused: Boolean(boundVideo.paused),
        ended: Boolean(boundVideo.ended),
      };
    }

    function onVideoPlay() {
      if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
        deps.queueSubtitleNavigationBroadcast();
      }
      syncEngineWithPlayback();
    }

    function onVideoPauseOrEnd() {
      if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
        deps.queueSubtitleNavigationBroadcast();
      }
      syncEngineWithPlayback();
    }

    function onVideoTimeUpdate() {
      if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
        deps.queueSubtitleNavigationBroadcast();
      }
    }

    function onVideoSeeked() {
      if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
        deps.queueSubtitleNavigationBroadcast();
      }
      syncEngineWithPlayback();
    }

    function unbindVideoPlaybackEvents(video) {
      if (!(video instanceof HTMLVideoElement)) {
        return;
      }
      video.removeEventListener('play', onVideoPlay);
      video.removeEventListener('pause', onVideoPauseOrEnd);
      video.removeEventListener('ended', onVideoPauseOrEnd);
      video.removeEventListener('timeupdate', onVideoTimeUpdate);
      video.removeEventListener('seeked', onVideoSeeked);
      video.removeEventListener('loadedmetadata', onVideoSeeked);
    }

    function bindVideoPlaybackEvents() {
      const video = document.querySelector('video');
      const boundVideo = getBoundVideo();
      if (!(video instanceof HTMLVideoElement)) {
        unbindVideoPlaybackEvents(boundVideo);
        setBoundVideo(null);
        if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
          deps.queueSubtitleNavigationBroadcast();
        }
        return;
      }

      if (boundVideo === video) {
        return;
      }

      unbindVideoPlaybackEvents(boundVideo);

      setBoundVideo(video);
      video.addEventListener('play', onVideoPlay);
      video.addEventListener('pause', onVideoPauseOrEnd);
      video.addEventListener('ended', onVideoPauseOrEnd);
      video.addEventListener('timeupdate', onVideoTimeUpdate);
      video.addEventListener('seeked', onVideoSeeked);
      video.addEventListener('loadedmetadata', onVideoSeeked);
      if (typeof deps.queueSubtitleNavigationBroadcast === 'function') {
        deps.queueSubtitleNavigationBroadcast();
      }
    }

    function syncEngineWithPlayback() {
      const settings = getSettings();
      const playbackState = getPlaybackState();
      if (!settings.reviewDanmakuEnabled) {
        stopReviewEngine(true);
        return;
      }

      if (!playbackState.hasVideo || playbackState.ended) {
        logDebug(
          '[DanmakuReview] syncEngine: no video or ended, stopping. hasVideo:',
          playbackState.hasVideo,
          'ended:',
          playbackState.ended
        );
        stopReviewEngine(!playbackState.hasVideo);
        return;
      }

      if (!shouldRunReviewDanmaku(settings, playbackState)) {
        logDebug(
          '[DanmakuReview] syncEngine: paused. reviewDanmakuEnabled:',
          settings.reviewDanmakuEnabled,
          'hasVideo:',
          playbackState.hasVideo,
          'paused:',
          playbackState.paused,
          'ended:',
          playbackState.ended
        );
        pauseReviewEngine();
        return;
      }

      logDebug('[DanmakuReview] syncEngine: starting engine');
      startReviewEngine();
    }

    function destroy() {
      stopReviewEngine(true);
      unbindVideoPlaybackEvents(getBoundVideo());
      setBoundVideo(null);
    }

    return {
      syncDanmakuSettings,
      shouldRunReviewDanmaku,
      getPlaybackState,
      unbindVideoPlaybackEvents,
      bindVideoPlaybackEvents,
      syncEngineWithPlayback,
      destroy,
    };
  }

  globalThis.BiliVocabDanmakuEngine = { createDanmakuEngine };

  if (isCommonJsRuntime) {
    module.exports = { createDanmakuEngine };
  }
})();
