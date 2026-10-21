(function (globalScope) {
  const ENHANCED_CONTAINER_CLASS = 'bsv-enhanced-container';
  const LEGACY_CONTAINER_CLASS = 'subtitle-container';
  const YOUTUBE_WORD_CLASS = 'bsv-word-youtube';

  function isYouTubeHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  }

  function shouldUseEnhancedContainerStyle(hostname) {
    return !isYouTubeHost(hostname);
  }

  function hasClass(element, className) {
    return Boolean(
      element &&
      element.classList &&
      typeof element.classList.contains === 'function' &&
      element.classList.contains(className)
    );
  }

  function hasNestedCaptionSegment(element) {
    return Boolean(
      element &&
      typeof element.querySelector === 'function' &&
      element.querySelector('.ytp-caption-segment')
    );
  }

  function shouldSkipYouTubeElementRewrite(element, hostname) {
    if (!isYouTubeHost(hostname)) {
      return false;
    }

    if (!hasClass(element, 'ytp-caption-segment')) {
      return true;
    }

    return hasNestedCaptionSegment(element);
  }

  const escapeHtml =
    (globalThis.Utils && globalThis.Utils.escapeHtml) ||
    ((text) =>
      String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;'));

  function getWordDisplayText(token, bilingualMode = false) {
    if (!token || typeof token !== 'object') {
      return '';
    }

    const word = String(token.word || '').trim();
    if (!word) {
      return '';
    }

    const originalText = String(token.sourceText || token.meaning || '').trim();
    if (!originalText || bilingualMode === 'english-only') {
      return word;
    }

    if (bilingualMode === 'bilingual') {
      return `${word}`; // 双语模式下单词只显示英文，整句后面显示完整翻译
    }

    return `${word}（${originalText}）`;
  }

  function buildWordHtml(token, originalSubtitleText, bilingualMode = false) {
    const levelClass = globalScope.VocabularyModule
      ? globalScope.VocabularyModule.getLevelClass(token.level)
      : 'level-cet4';
    const hostname = globalScope.location && globalScope.location.hostname;
    const siteWordClass = isYouTubeHost(hostname) ? ` ${YOUTUBE_WORD_CLASS}` : '';

    const escapedWord = escapeHtml(token.word);
    const escapedMeaning = escapeHtml(token.meaning || '');
    const escapedLevel = escapeHtml(token.level || '');
    const escapedPos = escapeHtml(token.partOfSpeech || '');
    const escapedDefinition = escapeHtml(token.definition || '');
    const escapedPhonetic = escapeHtml(token.phonetic || '');
    const escapedCefrLevel = escapeHtml(token.cefrLevel || '');
    const escapedFrequency = escapeHtml(token.frequency || '');
    const escapedLearningStatus = escapeHtml(token.learningStatus || '');
    const escapedSourceText = escapeHtml(token.sourceText || '');
    const escapedOriginalSubtitle = escapeHtml(originalSubtitleText || '');
    const escapedDisplayText = escapeHtml(getWordDisplayText(token, bilingualMode) || token.word);
    const escapedCoverageTier = escapeHtml(token.coverageTier || '');
    const escapedSourceFlags = escapeHtml(
      Array.isArray(token.sourceFlags) ? token.sourceFlags.join(',') : token.sourceFlags || ''
    );
    const escapedPhraseBacked = token.isPhraseBacked === true ? 'true' : '';
    const escapedPhraseCount = escapeHtml(token.phraseCount || '');

    return `<span class="bsv-word ${levelClass}${siteWordClass}" tabindex="0" data-word="${escapedWord}" data-meaning="${escapedMeaning}" data-level="${escapedLevel}" data-cefr-level="${escapedCefrLevel}" data-frequency="${escapedFrequency}" data-pos="${escapedPos}" data-definition="${escapedDefinition}" data-phonetic="${escapedPhonetic}" data-learning-status="${escapedLearningStatus}" data-source-text="${escapedSourceText}" data-original-subtitle="${escapedOriginalSubtitle}" data-coverage-tier="${escapedCoverageTier}" data-source-flags="${escapedSourceFlags}" data-phrase-backed="${escapedPhraseBacked}" data-phrase-count="${escapedPhraseCount}">${escapedDisplayText}</span>`;
  }

  function renderTokensToHtml(tokens, originalSubtitleText, bilingualMode = false) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return '';
    }

    return tokens
      .map((token) => {
        if (!token || typeof token !== 'object') {
          return '';
        }
        if (token.type === 'word') {
          return buildWordHtml(token, originalSubtitleText, bilingualMode);
        }
        return escapeHtml(token.text || '');
      })
      .join('');
  }

  function buildBilingualHtml(renderedHtml, sourceText, wrapperTag = 'div') {
    const safeWrapperTag = wrapperTag === 'span' ? 'span' : 'div';
    const content = renderedHtml || escapeHtml(sourceText);
    const escapedSourceText = escapeHtml(sourceText);
    return `<${safeWrapperTag} class="bsv-bilingual-line">${content}</${safeWrapperTag}><${safeWrapperTag} class="bsv-bilingual-translation">${escapedSourceText}</${safeWrapperTag}>`;
  }

  function buildRenderedHtml(translationResult, sourceText, settings = {}, wrapperTag = 'div') {
    const normalizedSource = String(sourceText || '');
    const bilingualMode = settings.bilingualMode || 'default';
    const renderedHtml = renderTokensToHtml(
      translationResult && translationResult.tokens,
      normalizedSource,
      bilingualMode
    );
    const mixedText =
      translationResult && typeof translationResult.mixedText === 'string'
        ? translationResult.mixedText
        : normalizedSource;

    if (bilingualMode === 'bilingual' && normalizedSource && mixedText !== normalizedSource) {
      return {
        html: buildBilingualHtml(renderedHtml, normalizedSource, wrapperTag),
        mixedText,
        sourceText: normalizedSource,
      };
    }

    return {
      html: renderedHtml || escapeHtml(normalizedSource),
      mixedText,
      sourceText: normalizedSource,
    };
  }

  const normalizeText =
    (globalThis.Utils && globalThis.Utils.normalizeText) ||
    ((text) =>
      String(text || '')
        .replace(/\s+/g, ' ')
        .trim());

  function restoreSubtitleElement(element, fallbackText) {
    if (typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
      return false;
    }

    const hostname = globalScope.location && globalScope.location.hostname;
    if (shouldSkipYouTubeElementRewrite(element, hostname)) {
      return false;
    }

    const originalText = element.dataset.biliVocabOriginalText || fallbackText || '';
    element.textContent = originalText;
    element.classList.remove(ENHANCED_CONTAINER_CLASS);
    element.classList.remove(LEGACY_CONTAINER_CLASS);
    element.dataset.biliVocabRenderedText = normalizeText(element.textContent);
    return true;
  }

  function renderSubtitleElement(element, translationResult, sourceText, settings = {}) {
    if (typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
      return false;
    }

    const hostname = globalScope.location && globalScope.location.hostname;
    if (shouldSkipYouTubeElementRewrite(element, hostname)) {
      return false;
    }

    const rendered = buildRenderedHtml(translationResult, sourceText, settings, 'div');

    if (shouldUseEnhancedContainerStyle(hostname)) {
      element.classList.add(ENHANCED_CONTAINER_CLASS);
      element.classList.remove(LEGACY_CONTAINER_CLASS);
    } else {
      element.classList.remove(ENHANCED_CONTAINER_CLASS);
      element.classList.remove(LEGACY_CONTAINER_CLASS);
    }

    element.innerHTML = rendered.html;
    element.dataset.biliVocabOriginalText = rendered.sourceText;
    // Snapshot the DOM we produced so a later site rewrite of the same node can be detected.
    element.dataset.biliVocabRenderedText = normalizeText(element.textContent);
    return true;
  }

  function renderToHtml(translationResult, sourceText, settings = {}) {
    return buildRenderedHtml(translationResult, sourceText, settings, 'span').html;
  }

  const api = {
    ENHANCED_CONTAINER_CLASS,
    YOUTUBE_WORD_CLASS,
    isYouTubeHost,
    shouldUseEnhancedContainerStyle,
    shouldSkipYouTubeElementRewrite,
    escapeHtml,
    renderTokensToHtml,
    renderSubtitleElement,
    restoreSubtitleElement,
    renderToHtml,
  };

  globalScope.SubtitleRenderer = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
