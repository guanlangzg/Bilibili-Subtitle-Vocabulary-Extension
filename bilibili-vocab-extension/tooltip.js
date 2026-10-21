(function (globalScope) {
  const TOOLTIP_ID = 'bsv-tooltip';
  const learningState =
    globalThis.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  let tooltipElement = null;
  let initialized = false;
  let activeWordElement = null;

  const escapeHtml =
    (globalThis.Utils && globalThis.Utils.escapeHtml) ||
    ((text) =>
      String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;'));

  function normalizeSourceText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeVideoTimeSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.floor(seconds);
  }

  function formatSourceTimeLabel(value) {
    const totalSeconds = normalizeVideoTimeSeconds(value);
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

  function readCurrentVideoTimeSeconds() {
    const doc = globalScope.document;
    if (!doc || typeof doc.querySelector !== 'function') {
      return null;
    }

    const video = doc.querySelector('video');
    if (!video || typeof video.currentTime !== 'number') {
      return null;
    }

    return normalizeVideoTimeSeconds(video.currentTime);
  }

  function buildWordSourceMetadata() {
    const doc = globalScope.document;
    const location = globalScope.location;
    const title = normalizeSourceText(doc && doc.title);
    const url = normalizeSourceText(location && location.href);
    const timeSeconds = readCurrentVideoTimeSeconds();
    const timeLabel = formatSourceTimeLabel(timeSeconds);

    if (!title && !url && timeSeconds == null && !timeLabel) {
      return null;
    }

    const source = {};
    if (title) {
      source.title = title;
    }
    if (url) {
      source.url = url;
    }
    if (timeSeconds != null) {
      source.timeSeconds = timeSeconds;
    }
    if (timeLabel) {
      source.timeLabel = timeLabel;
    }
    return source;
  }

  function ensureTooltipElement() {
    if (tooltipElement) {
      return tooltipElement;
    }

    tooltipElement = document.getElementById(TOOLTIP_ID);
    if (!tooltipElement) {
      tooltipElement = document.createElement('div');
      tooltipElement.id = TOOLTIP_ID;
      tooltipElement.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltipElement);
    }

    return tooltipElement;
  }

  function hideTooltip() {
    const tip = ensureTooltipElement();
    tip.classList.remove('visible');
    activeWordElement = null;
  }

  function getLearningStatusLabel(status) {
    if (learningState && typeof learningState.getStatusLabel === 'function') {
      return learningState.getStatusLabel(status);
    }

    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'saved') {
      return '已收藏';
    }
    if (normalized === 'mastered') {
      return '已掌握';
    }
    if (normalized === 'seen' || normalized === 'learning' || normalized === 'reviewing') {
      return '已遇见';
    }
    if (normalized === 'unseen' || normalized === 'new') {
      return '未巩固';
    }
    if (normalized === 'skipped') {
      return '已跳过';
    }
    return '待判断';
  }

  function parseDataList(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function buildHitReasonText(wordElement, learningStatus) {
    const level = wordElement.dataset.level || '';
    const coverageTier = String(wordElement.dataset.coverageTier || '').toLowerCase();
    const phraseCount = Number(wordElement.dataset.phraseCount);
    const sourceFlags = parseDataList(wordElement.dataset.sourceFlags);
    const reasons = [];

    if (level) {
      reasons.push(`${level} 词库`);
    }
    if (coverageTier === 'core') {
      reasons.push('核心高频');
    }
    if (wordElement.dataset.phraseBacked === 'true' || phraseCount > 0) {
      reasons.push('词组优先');
    }
    if (learningStatus === '未巩固') {
      reasons.push('未巩固');
    }
    if (sourceFlags.includes('kylebing') || sourceFlags.includes('netem')) {
      reasons.push('考试来源');
    }

    return reasons.length ? reasons.join(' · ') : '本地词库命中';
  }

  function renderTooltipContent(wordElement) {
    const word = wordElement.dataset.word || wordElement.textContent || '';
    const meaning = wordElement.dataset.meaning || '';
    const level = wordElement.dataset.level || '';
    const cefrLevel = wordElement.dataset.cefrLevel || '';
    const frequency = wordElement.dataset.frequency || '';
    const phonetic = wordElement.dataset.phonetic || '';
    const pos = wordElement.dataset.pos || '';
    const definition = wordElement.dataset.definition || '';
    const originalSubtitle = wordElement.dataset.originalSubtitle || '';
    const learningStatus = getLearningStatusLabel(wordElement.dataset.learningStatus || '');
    const hitReasonText = buildHitReasonText(wordElement, learningStatus);

    const detailLine = [pos, definition || meaning].filter(Boolean).join(' ');
    const tags = [level, cefrLevel ? `CEFR ${cefrLevel}` : ''].filter(Boolean).join(' · ');
    const frequencyLabel =
      Number.isFinite(Number(frequency)) && Number(frequency) > 0
        ? `语料频次: ${Number(frequency).toLocaleString()}`
        : '点击单词可重新查看释义';

    return `
      <div class="bsv-tooltip-card">
        <div class="bsv-tooltip-head">
          <div>
            <div class="bsv-tooltip-word">${escapeHtml(word)}</div>
            ${phonetic ? `<div class="bsv-tooltip-phonetic">${escapeHtml(phonetic)}</div>` : ''}
          </div>
          ${tags ? `<div class="bsv-tooltip-tags">${escapeHtml(tags)}</div>` : ''}
        </div>
        <div class="bsv-tooltip-meaning">${escapeHtml(detailLine || meaning)}</div>
        ${originalSubtitle ? `<div class="bsv-tooltip-context">原句：${escapeHtml(originalSubtitle)}</div>` : ''}
        <div class="bsv-tooltip-reason">命中原因：${escapeHtml(hitReasonText)}</div>
        <div class="bsv-tooltip-meta-row">
          <div class="bsv-tooltip-status">当前状态 · ${escapeHtml(learningStatus)}</div>
          <div class="bsv-tooltip-frequency">${escapeHtml(frequencyLabel)}</div>
        </div>
        <div class="bsv-tooltip-actions">
          <button type="button" class="bsv-tooltip-action-button" data-feedback="know">认识</button>
          <button type="button" class="bsv-tooltip-action-button" data-feedback="fuzzy">模糊</button>
          <button type="button" class="bsv-tooltip-action-button" data-feedback="dontKnow">不认识</button>
          ${
            learningStatus === '已收藏'
              ? '<button type="button" class="bsv-tooltip-action-button saved" data-feedback="removeSave">已收藏</button>'
              : '<button type="button" class="bsv-tooltip-action-button" data-feedback="save">收藏</button>'
          }
          <button type="button" class="bsv-tooltip-action-button" data-feedback="skip">跳过</button>
          <button type="button" class="bsv-tooltip-action-button" data-feedback="misreplace">替换不合理</button>
        </div>
      </div>
    `;
  }

  function reportContextMisreplaceFeedback(word, options = {}) {
    if (
      !globalThis.SubtitleTranslator ||
      typeof globalThis.SubtitleTranslator.reportContextMisreplace !== 'function'
    ) {
      return null;
    }

    const normalizedWord = String(word || '').trim();
    if (!normalizedWord) {
      return null;
    }

    try {
      const result = globalThis.SubtitleTranslator.reportContextMisreplace(normalizedWord, options);
      refreshTranslationsForContextFeedback();
      return result;
    } catch (_error) {
      return null;
    }
  }

  function refreshTranslationsForContextFeedback() {
    const runtime = globalThis.BiliVocabContentRuntime;
    if (!runtime || typeof runtime.refreshTranslationsForSelectionStateChange !== 'function') {
      return;
    }

    try {
      runtime.refreshTranslationsForSelectionStateChange();
    } catch (_error) {
      // Feedback should not fail just because the current page cannot be rescheduled.
    }
  }

  function positionTooltip(targetElement) {
    const tip = ensureTooltipElement();
    const targetRect = targetElement.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let left = window.scrollX + targetRect.left + targetRect.width / 2 - tipRect.width / 2;
    let top = window.scrollY + targetRect.top - tipRect.height - 10;

    if (left < 8) {
      left = 8;
    }

    const maxLeft = window.scrollX + window.innerWidth - tipRect.width - 8;
    if (left > maxLeft) {
      left = maxLeft;
    }

    if (top < window.scrollY + 8) {
      top = window.scrollY + targetRect.bottom + 10;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function showTooltip(wordElement) {
    if (!(wordElement instanceof HTMLElement)) {
      return;
    }

    const tip = ensureTooltipElement();
    activeWordElement = wordElement;
    tip.innerHTML = renderTooltipContent(wordElement);
    tip.classList.add('visible');
    positionTooltip(wordElement);
  }

  async function handleTooltipFeedback(feedback) {
    if (!(activeWordElement instanceof HTMLElement)) {
      return;
    }

    const word = activeWordElement.dataset.word || activeWordElement.textContent || '';
    const meaning = activeWordElement.dataset.meaning || '';
    const level = activeWordElement.dataset.level || '';
    const phonetic = activeWordElement.dataset.phonetic || '';
    const originalSubtitle = activeWordElement.dataset.originalSubtitle || '';
    if (!word) {
      return;
    }

    if (feedback === 'misreplace') {
      reportContextMisreplaceFeedback(word, {
        severity: 'high',
        now: Date.now(),
      });
      hideTooltip();
      return;
    }

    if (feedback === 'save') {
      // 收藏到生词本
      if (learningState && typeof learningState.saveWordToVocabularyBook === 'function') {
        const source = buildWordSourceMetadata();
        const success = await learningState.saveWordToVocabularyBook(word, {
          meaning,
          level,
          phonetic,
          context: originalSubtitle,
          ...(source ? { source } : {}),
        });
        if (success) {
          activeWordElement.dataset.learningStatus = 'saved';
          showTooltip(activeWordElement);
        }
      }
      return;
    }

    if (feedback === 'removeSave') {
      // 从生词本移除
      if (learningState && typeof learningState.removeWordFromVocabularyBook === 'function') {
        const success = await learningState.removeWordFromVocabularyBook(word);
        if (success) {
          activeWordElement.dataset.learningStatus = 'seen';
          showTooltip(activeWordElement);
        }
      }
      return;
    }

    if (!globalThis.VocabularyModule) {
      return;
    }

    const hasApplyLearningAction =
      typeof globalThis.VocabularyModule.applyLearningAction === 'function';
    const hasReviewWord = typeof globalThis.VocabularyModule.reviewWord === 'function';
    const nextRecord = hasApplyLearningAction
      ? await globalThis.VocabularyModule.applyLearningAction(word, feedback)
      : hasReviewWord
        ? await globalThis.VocabularyModule.reviewWord(word, feedback)
        : null;
    if (!nextRecord) {
      return;
    }

    activeWordElement.dataset.learningStatus = String(nextRecord.status || '')
      .trim()
      .toLowerCase();
    showTooltip(activeWordElement);
  }

  function getWordNode(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest('.bsv-word');
  }

  function handleMouseOver(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }
    showTooltip(wordNode);
  }

  function handleMouseOut(event) {
    const fromWord = getWordNode(event.target);
    if (!fromWord) {
      return;
    }

    const toWord = getWordNode(event.relatedTarget);
    if (toWord === fromWord) {
      return;
    }

    hideTooltip();
  }

  function handleFocusIn(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }

    showTooltip(wordNode);
  }

  function handleFocusOut(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }

    hideTooltip();
  }

  function handleDocumentClick(event) {
    const tip = ensureTooltipElement();
    if (tip.contains(event.target)) {
      const actionButton =
        event.target instanceof Element ? event.target.closest('[data-feedback]') : null;
      if (actionButton) {
        event.preventDefault();
        void handleTooltipFeedback(actionButton.dataset.feedback || '');
      }
      return;
    }

    const wordNode = getWordNode(event.target);
    if (wordNode) {
      showTooltip(wordNode);
      return;
    }

    hideTooltip();
  }

  function handleEscape(event) {
    if (event.key === 'Escape') {
      hideTooltip();
    }
  }

  function init() {
    if (initialized) {
      return;
    }

    ensureTooltipElement();
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', hideTooltip);
    initialized = true;
  }

  function destroy() {
    if (!initialized) {
      return;
    }

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('focusin', handleFocusIn, true);
    document.removeEventListener('focusout', handleFocusOut, true);
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('resize', hideTooltip);
    initialized = false;
    activeWordElement = null;
    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
    }
    tooltipElement = null;
  }

  const api = {
    init,
    destroy,
    hideTooltip,
    renderTooltipContent,
    getLearningStatusLabel,
    buildHitReasonText,
    formatSourceTimeLabel,
    buildWordSourceMetadata,
    reportContextMisreplaceFeedback,
    handleTooltipFeedback,
  };

  globalScope.TooltipModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
