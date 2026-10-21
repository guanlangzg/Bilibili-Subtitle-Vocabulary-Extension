(function (globalScope) {
  const DANMAKU_CONTAINER_ID = 'bsv-danmaku-layer';
  const DANMAKU_ITEM_CLASS = 'bsv-danmaku-item';
  const DANMAKU_ITEM_ASSOCIATED_CLASS = 'bsv-danmaku-item-associated';
  const DANMAKU_WORD_CLASS = 'bsv-danmaku-item__word';
  const DANMAKU_SEPARATOR_CLASS = 'bsv-danmaku-item__separator';
  const DANMAKU_TRANSLATION_CLASS = 'bsv-danmaku-item__translation';
  // Why: keep review danmaku visually close to Bilibili's standard scroll danmaku.
  const PRIMARY_HOST_SELECTOR = '.bpx-player-video-wrap';
  const DENSITY_PRESET_TO_LIMITS = {
    sparse: { maxOnscreen: 2, tracks: 2 },
    normal: { maxOnscreen: 3, tracks: 3 },
    dense: { maxOnscreen: 4, tracks: 4 },
  };
  const MAX_ONSCREEN_COUNT = DENSITY_PRESET_TO_LIMITS.normal.maxOnscreen;
  const TRACK_COUNT = DENSITY_PRESET_TO_LIMITS.normal.tracks;
  const MAX_TRACK_COUNT = DENSITY_PRESET_TO_LIMITS.dense.tracks;
  const TRACK_TOP_PERCENT_RANGE = {
    min: 8,
    max: 52,
  };
  const DEFAULT_PLAYER_WIDTH = 960;
  const STANDARD_DANMAKU_FONT_SIZE_PX = 23;
  const DANMAKU_HORIZONTAL_PADDING_PX = 40;
  const DANMAKU_FONT_FAMILY =
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, Helvetica, sans-serif';
  const DANMAKU_COLORS = {
    primaryWord: '#eaf6ff',
    primarySeparator: 'rgba(255, 255, 255, 0.52)',
    primaryTranslation: 'rgba(255, 255, 255, 0.88)',
    associatedWord: '#ffe8a8',
    associatedSeparator: 'rgba(255, 255, 255, 0.42)',
    associatedTranslation: 'rgba(255, 255, 255, 0.72)',
  };
  const PRIMARY_DANMAKU_TEXT_SHADOW =
    '0 0 2px rgba(0, 0, 0, 0.98), 1px 0 2px rgba(0, 0, 0, 0.98), 0 1px 2px rgba(0, 0, 0, 0.98), -1px 0 2px rgba(0, 0, 0, 0.98), 0 -1px 2px rgba(0, 0, 0, 0.98)';
  const ASSOCIATED_DANMAKU_TEXT_SHADOW =
    '0 0 2px rgba(0, 0, 0, 0.92), 1px 0 2px rgba(0, 0, 0, 0.92), 0 1px 2px rgba(0, 0, 0, 0.92), -1px 0 2px rgba(0, 0, 0, 0.92), 0 -1px 2px rgba(0, 0, 0, 0.92)';
  const SPEED_PRESET_TO_DURATION = {
    slow: 15000,
    normal: 12000,
    fast: 9500,
  };
  const SPEED_PRESET_TO_DURATION_RANGE = {
    slow: { min: 14000, max: 22000 },
    normal: { min: 10500, max: 18000 },
    fast: { min: 9000, max: 14000 },
  };
  const SPEED_PRESET_TO_PIXELS_PER_SECOND = {
    slow: 92,
    normal: 105,
    fast: 125,
  };

  let container = null;
  let hostObserver = null;
  let activeCount = 0;
  let speedPreset = 'normal';
  let densityPreset = 'normal';
  const trackUsage = new Array(MAX_TRACK_COUNT).fill(null);
  const DEBUG_PREFIX = '[DanmakuReview][Danmaku]';

  function debugDanmakuState(message, payload) {
    if (typeof console === 'undefined' || typeof console.debug !== 'function') {
      return;
    }

    console.debug(DEBUG_PREFIX, message, payload);
  }

  function createContainerNode() {
    const node = document.createElement('div');
    node.id = DANMAKU_CONTAINER_ID;
    node.style.pointerEvents = 'none';
    node.style.zIndex = '999';
    node.style.overflow = 'hidden';
    node.style.position = 'absolute';
    node.style.top = '0';
    node.style.left = '0';
    node.style.width = '100%';
    node.style.height = '100%';
    return node;
  }

  function getHostContainer() {
    const primary = document.querySelector(PRIMARY_HOST_SELECTOR);
    if (primary instanceof HTMLElement) {
      return primary;
    }

    const video = document.querySelector('video');
    if (video instanceof HTMLVideoElement && video.parentElement instanceof HTMLElement) {
      return video.parentElement;
    }

    return null;
  }

  function ensureHostLayout(host) {
    const style = globalScope.getComputedStyle(host);
    if (style.position === 'static') {
      host.style.position = 'relative';
    }
  }

  function mountContainer(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }

    ensureHostLayout(host);

    const existing = host.querySelector(`#${DANMAKU_CONTAINER_ID}`);
    if (existing instanceof HTMLElement) {
      container = existing;
      return container;
    }

    container = createContainerNode();
    host.appendChild(container);
    return container;
  }

  function stopHostObserver() {
    if (!hostObserver) {
      return;
    }

    hostObserver.disconnect();
    hostObserver = null;
  }

  function initDanmakuContainer() {
    const host = getHostContainer();
    if (host) {
      stopHostObserver();
      return mountContainer(host);
    }

    if (hostObserver) {
      return null;
    }

    hostObserver = new MutationObserver(() => {
      const latestHost = getHostContainer();
      if (!latestHost) {
        return;
      }

      mountContainer(latestHost);
      stopHostObserver();
    });

    hostObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    return null;
  }

  function pickTrackIndex() {
    const available = [];

    const activeTrackCount = getActiveTrackCount();
    for (let index = 0; index < activeTrackCount; index += 1) {
      if (trackUsage[index] === null) {
        available.push(index);
      }
    }

    if (available.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }

  function normalizeSpeedPreset(value) {
    const normalized = String(value || 'normal')
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(SPEED_PRESET_TO_DURATION, normalized)
      ? normalized
      : 'normal';
  }

  function normalizeDensityPreset(value) {
    const normalized = String(value || 'normal')
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(DENSITY_PRESET_TO_LIMITS, normalized)
      ? normalized
      : 'normal';
  }

  function getDensityLimits() {
    return DENSITY_PRESET_TO_LIMITS[densityPreset] || DENSITY_PRESET_TO_LIMITS.normal;
  }

  function getActiveTrackCount() {
    return getDensityLimits().tracks;
  }

  function getMaxOnscreenCount() {
    return getDensityLimits().maxOnscreen;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, number));
  }

  function getPlayerWidth(root) {
    if (root instanceof HTMLElement && root.parentElement instanceof HTMLElement) {
      const parentWidth = Number(root.parentElement.clientWidth || root.parentElement.offsetWidth);
      if (parentWidth > 0) {
        return parentWidth;
      }
    }

    if (root instanceof HTMLElement) {
      const rootWidth = Number(root.clientWidth || root.offsetWidth);
      if (rootWidth > 0) {
        return rootWidth;
      }
    }

    return DEFAULT_PLAYER_WIDTH;
  }

  function estimateTextWidthPx(text) {
    const safeText = String(text || '').trim();
    if (!safeText) {
      return STANDARD_DANMAKU_FONT_SIZE_PX * 2;
    }

    return Math.round(safeText.length * STANDARD_DANMAKU_FONT_SIZE_PX * 0.72);
  }

  function getTextWidthPx(text, renderedNode) {
    if (renderedNode instanceof HTMLElement) {
      const nodeWidth = Number(renderedNode.offsetWidth || renderedNode.clientWidth);
      if (nodeWidth > 0) {
        return nodeWidth;
      }
    }

    return estimateTextWidthPx(text);
  }

  function getTravelDistancePx(text, root, renderedNode) {
    const playerWidth = getPlayerWidth(root);
    const textWidth = getTextWidthPx(text, renderedNode);
    return playerWidth + textWidth + DANMAKU_HORIZONTAL_PADDING_PX * 2;
  }

  function getFlyDurationMs(text, root, renderedNode) {
    const pxPerSecond = SPEED_PRESET_TO_PIXELS_PER_SECOND[speedPreset];
    const range = SPEED_PRESET_TO_DURATION_RANGE[speedPreset];
    const travelDistancePx = getTravelDistancePx(text, root, renderedNode);

    return Math.round(clampNumber((travelDistancePx / pxPerSecond) * 1000, range.min, range.max));
  }

  function setSpeedPreset(nextSpeedPreset) {
    const previousSpeedPreset = speedPreset;
    speedPreset = normalizeSpeedPreset(nextSpeedPreset);
    debugDanmakuState('speed preset updated', {
      previousSpeedPreset,
      nextSpeedPreset: speedPreset,
    });
    return speedPreset;
  }

  function setDensityPreset(nextDensityPreset) {
    const previousDensityPreset = densityPreset;
    densityPreset = normalizeDensityPreset(nextDensityPreset);
    debugDanmakuState('density preset updated', {
      previousDensityPreset,
      nextDensityPreset: densityPreset,
      limits: getDensityLimits(),
    });
    return densityPreset;
  }

  function formatDanmakuText(wordObj) {
    const word = String(wordObj && wordObj.word ? wordObj.word : '').trim();
    const translation = String((wordObj && (wordObj.translation || wordObj.meaning)) || '').trim();

    if (!word && !translation) {
      return '';
    }

    if (word && translation) {
      return `${word} · ${translation}`;
    }

    return word || translation;
  }

  function createDanmakuTextSpan(className, text, color) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    span.style.color = color;
    return span;
  }

  function renderDanmakuContent(node, wordObj, isAssociated) {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    const word = String(wordObj && wordObj.word ? wordObj.word : '').trim();
    const translation = String((wordObj && (wordObj.translation || wordObj.meaning)) || '').trim();
    const colors = isAssociated
      ? {
          word: DANMAKU_COLORS.associatedWord,
          separator: DANMAKU_COLORS.associatedSeparator,
          translation: DANMAKU_COLORS.associatedTranslation,
        }
      : {
          word: DANMAKU_COLORS.primaryWord,
          separator: DANMAKU_COLORS.primarySeparator,
          translation: DANMAKU_COLORS.primaryTranslation,
        };

    if (word) {
      node.appendChild(createDanmakuTextSpan(DANMAKU_WORD_CLASS, word, colors.word));
    }

    if (!translation) {
      return;
    }

    if (word) {
      node.appendChild(createDanmakuTextSpan(DANMAKU_SEPARATOR_CLASS, ' · ', colors.separator));
    }
    node.appendChild(
      createDanmakuTextSpan(DANMAKU_TRANSLATION_CLASS, translation, colors.translation)
    );
  }

  function applyDanmakuVisualStyle(node, isAssociated) {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    const isPrimary = !isAssociated;
    node.style.color = isPrimary ? DANMAKU_COLORS.primaryWord : DANMAKU_COLORS.associatedWord;
    node.style.fontFamily = DANMAKU_FONT_FAMILY;
    node.style.fontSize = `${STANDARD_DANMAKU_FONT_SIZE_PX}px`;
    node.style.fontWeight = '600';
    node.style.lineHeight = '1.12';
    node.style.letterSpacing = '0.01em';
    node.style.opacity = isPrimary ? '0.96' : '0.68';
    node.style.textShadow = isPrimary
      ? PRIMARY_DANMAKU_TEXT_SHADOW
      : ASSOCIATED_DANMAKU_TEXT_SHADOW;
  }

  function cleanupNode(node, fallbackTimer, trackIndex) {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
    }

    if (typeof trackIndex === 'number' && trackUsage[trackIndex] === node) {
      trackUsage[trackIndex] = null;
    }

    if (node && node.parentElement) {
      node.parentElement.removeChild(node);
    }

    activeCount = Math.max(0, activeCount - 1);
  }

  function shootWordDanmaku(wordObj, isAssociated) {
    const root = initDanmakuContainer();
    if (!(root instanceof HTMLElement)) {
      debugDanmakuState('drop: no danmaku root', {
        densityPreset,
        speedPreset,
      });
      return false;
    }

    const maxOnscreen = getMaxOnscreenCount();
    if (activeCount >= maxOnscreen) {
      debugDanmakuState('drop: onscreen cap reached', {
        activeCount,
        maxOnscreen,
        densityPreset,
        trackCount: getActiveTrackCount(),
      });
      return false;
    }

    const text = formatDanmakuText(wordObj);
    if (!text) {
      debugDanmakuState('drop: empty text', {
        word: wordObj && wordObj.word,
      });
      return false;
    }

    const node = document.createElement('div');
    node.className = `${DANMAKU_ITEM_CLASS}${isAssociated ? ` ${DANMAKU_ITEM_ASSOCIATED_CLASS}` : ''}`;
    renderDanmakuContent(node, wordObj, Boolean(isAssociated));
    node.style.position = 'absolute';
    node.style.display = 'inline-flex';
    node.style.alignItems = 'baseline';
    node.style.whiteSpace = 'nowrap';
    node.style.willChange = 'transform';
    node.style.pointerEvents = 'none';
    applyDanmakuVisualStyle(node, isAssociated);

    const trackIndex = pickTrackIndex();
    if (trackIndex === null) {
      debugDanmakuState('drop: no available track', {
        activeCount,
        densityPreset,
        trackCount: getActiveTrackCount(),
      });
      return false;
    }

    trackUsage[trackIndex] = node;

    const trackSpan = TRACK_TOP_PERCENT_RANGE.max - TRACK_TOP_PERCENT_RANGE.min;
    const trackTop =
      TRACK_TOP_PERCENT_RANGE.min + ((trackIndex + 0.5) / getActiveTrackCount()) * trackSpan;
    node.style.top = `${trackTop}%`;
    node.style.left = '100%';
    node.style.transform = 'translateX(40px)';

    root.appendChild(node);
    activeCount += 1;

    void node.offsetHeight;

    const flyDurationMs = getFlyDurationMs(text, root, node);
    node.style.transition = `transform ${flyDurationMs}ms linear`;
    debugDanmakuState('shoot', {
      word: wordObj && wordObj.word,
      isAssociated: Boolean(isAssociated),
      activeCount,
      maxOnscreen,
      densityPreset,
      speedPreset,
      trackIndex,
      trackCount: getActiveTrackCount(),
      top: node.style.top,
      flyDurationMs,
      fontFamily: node.style.fontFamily,
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight,
      wordColor:
        node.children && node.children[0] ? node.children[0].style.color : node.style.color,
      translationColor: node.children && node.children[2] ? node.children[2].style.color : '',
    });

    const fallbackTimer = setTimeout(() => {
      cleanupNode(node, null, trackIndex);
    }, flyDurationMs + 500);

    node.addEventListener(
      'transitionend',
      () => {
        cleanupNode(node, fallbackTimer, trackIndex);
      },
      { once: true }
    );

    requestAnimationFrame(() => {
      const playerWidth = getPlayerWidth(root);
      node.style.transform = `translateX(calc(-${playerWidth}px - 100% - ${DANMAKU_HORIZONTAL_PADDING_PX}px))`;
    });

    return true;
  }

  function clearDanmaku() {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.innerHTML = '';
    activeCount = 0;
    trackUsage.fill(null);
  }

  const api = {
    DANMAKU_CONTAINER_ID,
    MAX_ONSCREEN_COUNT,
    TRACK_COUNT,
    MAX_TRACK_COUNT,
    TRACK_TOP_PERCENT_RANGE,
    SPEED_PRESET_TO_DURATION,
    SPEED_PRESET_TO_DURATION_RANGE,
    SPEED_PRESET_TO_PIXELS_PER_SECOND,
    DENSITY_PRESET_TO_LIMITS,
    initDanmakuContainer,
    normalizeSpeedPreset,
    normalizeDensityPreset,
    getFlyDurationMs,
    setSpeedPreset,
    setDensityPreset,
    shootWordDanmaku,
    clearDanmaku,
  };

  globalScope.DanmakuModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
