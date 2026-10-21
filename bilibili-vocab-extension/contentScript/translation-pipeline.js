(function () {
  const isCommonJsRuntime = typeof module !== 'undefined' && module.exports;

  function createTranslationPipeline(deps) {
    const {
      getSettings,
      getRenderGeneration,
      translationCache,
      normalizeSettings,
      normalizeText,
      logError,
      hasMethod,
      isCurrentSiteEnabled,
      renderSignatureDataKey,
      hitSignatureDataKey,
    } = deps;

    function createCacheKey(text, runtimeSettings) {
      const normalizedText = normalizeText(text);
      if (!normalizedText) {
        return '';
      }
      const selectionStateVersion = getSelectionStateVersion();
      if (hasMethod(globalThis.SubtitleTranslator, 'createSettingsFingerprint')) {
        const fingerprint =
          globalThis.SubtitleTranslator.createSettingsFingerprint(runtimeSettings);
        return `${normalizedText}::${fingerprint}::selection:${selectionStateVersion}`;
      }
      const normalized = normalizeSettings(runtimeSettings);
      const sortedLevels = normalized.activeLevels.slice().sort().join(',');
      return `${normalizedText}::${normalized.replaceRatio.toFixed(2)}|${normalized.maxReplaceCount}|${sortedLevels}::selection:${selectionStateVersion}`;
    }

    function getSelectionStateVersion() {
      if (hasMethod(globalThis.SubtitleTranslator, 'getSelectionStateVersion')) {
        return Number(globalThis.SubtitleTranslator.getSelectionStateVersion()) || 0;
      }
      return 0;
    }

    function getContextFeedbackVersion() {
      if (hasMethod(globalThis.SubtitleTranslator, 'getContextFeedbackVersion')) {
        return Number(globalThis.SubtitleTranslator.getContextFeedbackVersion()) || 0;
      }
      return 0;
    }

    function createTranslationRuntimeFingerprint(runtimeSettings) {
      const normalized = normalizeSettings(runtimeSettings);
      const translationFingerprint = hasMethod(
        globalThis.SubtitleTranslator,
        'createSettingsFingerprint'
      )
        ? globalThis.SubtitleTranslator.createSettingsFingerprint(normalized)
        : [
            normalized.replaceRatio.toFixed(2),
            normalized.maxReplaceCount,
            normalized.targetCefr,
            normalized.vocabularyMode,
            normalized.examPreference,
            normalized.activeLevels.slice().sort().join(','),
          ].join('|');
      const mode = normalized.enabled ? 'enabled' : 'disabled';
      const pageMode = normalized.webPageEnabled ? 'page-on' : 'page-off';
      const siteMode = isCurrentSiteEnabled(normalized) ? 'site-on' : 'site-off';
      return `${mode}::${pageMode}::${siteMode}::${normalized.bilingualMode}::${translationFingerprint}::context:${getContextFeedbackVersion()}`;
    }

    function createRenderSignature(text, runtimeSettings) {
      const normalizedText = normalizeText(text);
      if (!normalizedText) {
        return '';
      }
      return `${createTranslationRuntimeFingerprint(runtimeSettings)}::${normalizedText}`;
    }

    function readFromCache(cacheKey) {
      if (!cacheKey || !translationCache.has(cacheKey)) {
        return null;
      }
      return translationCache.get(cacheKey);
    }

    function writeToCache(cacheKey, result) {
      if (!cacheKey || !result) {
        return;
      }
      translationCache.set(cacheKey, result);
    }

    function clearTranslationCache() {
      translationCache.clear();
    }

    function isRenderUpToDate(element, sourceText, runtimeSettings) {
      if (!element || !element.dataset) {
        return false;
      }
      const nextSignature = createRenderSignature(sourceText, runtimeSettings);
      if (!nextSignature) {
        return false;
      }
      return element.dataset[renderSignatureDataKey] === nextSignature;
    }

    async function applyTranslation(element, sourceTextOverride) {
      const currentText = normalizeText(
        sourceTextOverride || globalThis.SubtitleParser.extractSubtitleText(element)
      );
      if (!currentText) {
        return;
      }
      const generationAtStart = getRenderGeneration();
      const settings = getSettings();
      resetHitTrackingIfSourceChanged(element, currentText);
      const renderSignature = createRenderSignature(currentText, settings);
      if (isRenderUpToDate(element, currentText, settings)) {
        return;
      }
      if (!settings.enabled) {
        if (generationAtStart !== getRenderGeneration()) {
          return;
        }
        globalThis.SubtitleRenderer.restoreSubtitleElement(element, currentText);
        if (element && element.dataset) {
          element.dataset[renderSignatureDataKey] = renderSignature;
        }
        return;
      }
      const cacheKey = createCacheKey(currentText, settings);
      let result = readFromCache(cacheKey);
      if (!result) {
        result = await globalThis.SubtitleTranslator.processSubtitle(currentText, settings);
        writeToCache(cacheKey, result);
      }
      if (generationAtStart !== getRenderGeneration()) {
        return;
      }
      const rendered = globalThis.SubtitleRenderer.renderSubtitleElement(
        element,
        result,
        currentText,
        settings
      );
      if (rendered) {
        if (element && element.dataset) {
          element.dataset[renderSignatureDataKey] = renderSignature;
        }
        recordRenderedHits(element, result, currentText);
      }
    }

    function createHitTrackingSignature(result, sourceText) {
      if (!result || !Array.isArray(result.tokens)) {
        return '';
      }
      const words = result.tokens
        .filter((token) => token && token.type === 'word')
        .map((token) =>
          String(token.word || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean);
      if (words.length === 0) {
        return '';
      }
      return `${normalizeText(sourceText)}::${words.join('|')}`;
    }

    function resetHitTrackingIfSourceChanged(element, sourceText) {
      if (!element || !element.dataset) {
        return;
      }
      const previousOriginalText = normalizeText(element.dataset.biliVocabOriginalText || '');
      const nextOriginalText = normalizeText(sourceText);
      if (!previousOriginalText || !nextOriginalText || previousOriginalText === nextOriginalText) {
        return;
      }
      delete element.dataset[hitSignatureDataKey];
    }

    function recordRenderedHits(element, result, sourceText) {
      if (
        !result ||
        !Array.isArray(result.tokens) ||
        !hasMethod(globalThis.VocabularyModule, 'recordHit')
      ) {
        return;
      }
      const hitSignature = createHitTrackingSignature(result, sourceText);
      if (!hitSignature) {
        return;
      }
      if (element && element.dataset && element.dataset[hitSignatureDataKey] === hitSignature) {
        return;
      }
      const renderedWordKeys = new Set();
      result.tokens.forEach((token) => {
        if (!token || token.type !== 'word') {
          return;
        }
        const word = String(token.word || '').trim();
        const wordKey = word.toLowerCase();
        if (!word || renderedWordKeys.has(wordKey)) {
          return;
        }
        renderedWordKeys.add(wordKey);
        globalThis.VocabularyModule.recordHit(word);
        if (hasMethod(globalThis.SubtitleTranslator, 'reportRenderedExposure')) {
          globalThis.SubtitleTranslator.reportRenderedExposure(word);
        }
      });
      if (element && element.dataset) {
        element.dataset[hitSignatureDataKey] = hitSignature;
      }
    }

    function invalidateRenderedSubtitles() {
      const subtitleItems = globalThis.SubtitleParser.getCurrentSubtitleItems();
      subtitleItems.forEach((item) => {
        if (!(item.element instanceof HTMLElement)) {
          return;
        }
        delete item.element.dataset.biliVocabRenderedText;
        delete item.element.dataset[renderSignatureDataKey];
      });
    }

    return {
      createCacheKey,
      createTranslationRuntimeFingerprint,
      createRenderSignature,
      readFromCache,
      writeToCache,
      clearTranslationCache,
      isRenderUpToDate,
      applyTranslation,
      createHitTrackingSignature,
      resetHitTrackingIfSourceChanged,
      recordRenderedHits,
      invalidateRenderedSubtitles,
    };
  }

  const api = { createTranslationPipeline };

  globalThis.BiliVocabTranslationPipeline = api;

  if (isCommonJsRuntime) {
    module.exports = api;
  }
})();
