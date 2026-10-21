(function (globalScope) {
  const DEFAULT_WEB_TEXT_PROCESS_INTERVAL = 1000;
  const DEFAULT_BATCH_SIZE = 20;
  const DEFAULT_BATCH_DELAY_MS = 50;
  const SKIPPED_PARENT_TAG_PATTERN =
    /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL|NAV|HEADER|FOOTER|ASIDE|PRE|CODE)$/;
  const SAFE_HTML_ELEMENT_TAGS = new Set(['SPAN', 'DIV', '#text']);
  const SAFE_HTML_ATTRIBUTES = new Set([
    'class',
    'tabindex',
    'data-word',
    'data-meaning',
    'data-level',
    'data-cefr-level',
    'data-frequency',
    'data-pos',
    'data-definition',
    'data-phonetic',
    'data-learning-status',
    'data-source-text',
    'data-original-subtitle',
  ]);
  const URL_HTML_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
  const UNSAFE_URL_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:']);

  function requireFunction(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
    return value;
  }

  function getNodeFilter() {
    return (
      globalScope.NodeFilter || {
        SHOW_TEXT: 4,
        SHOW_ELEMENT: 1,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2,
      }
    );
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeHtmlEntities(value) {
    return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (_match, entity) => {
      const normalizedEntity = entity.toLowerCase();
      if (normalizedEntity[0] === '#') {
        const radix = normalizedEntity[1] === 'x' ? 16 : 10;
        const rawCodePoint =
          normalizedEntity[1] === 'x' ? normalizedEntity.slice(2) : normalizedEntity.slice(1);
        const codePoint = Number.parseInt(rawCodePoint, radix);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
      }
      const namedEntities = {
        colon: ':',
        tab: '\t',
        newline: '\n',
      };
      return namedEntities[normalizedEntity] || '';
    });
  }

  function hasUnsafeUrlProtocol(value) {
    const normalized = String(value || '')
      .replace(/[\u0000-\u001f\u007f\s]+/g, '')
      .toLowerCase();

    if (!normalized) {
      return false;
    }

    try {
      const decoded = decodeHtmlEntities(normalized);
      return UNSAFE_URL_PROTOCOLS.has(decoded.split(':', 1)[0] + ':');
    } catch (_error) {
      return true;
    }
  }

  function containsUnsafeContent(root, options = {}) {
    const doc = options.document || globalScope.document;
    const nodeFilter = options.NodeFilter || getNodeFilter();
    if (!doc || typeof doc.createTreeWalker !== 'function' || !nodeFilter) {
      return true;
    }

    const treeWalker = doc.createTreeWalker(root, nodeFilter.SHOW_ELEMENT);
    let node = treeWalker.currentNode;
    while (node) {
      if (!SAFE_HTML_ELEMENT_TAGS.has(node.tagName)) {
        return true;
      }
      const attributes = Array.from(node.attributes || []);
      for (const attr of attributes) {
        const attrName = String(attr.name || '').toLowerCase();
        if (
          attrName.startsWith('on') ||
          attrName === 'style' ||
          (URL_HTML_ATTRIBUTES.has(attrName) && hasUnsafeUrlProtocol(attr.value)) ||
          !SAFE_HTML_ATTRIBUTES.has(attrName)
        ) {
          return true;
        }
      }
      node = treeWalker.nextNode();
    }
    return false;
  }

  function shouldAcceptWebTextNode(node, nodeFilter = getNodeFilter()) {
    const parent = node && node.parentElement;
    if (!parent || SKIPPED_PARENT_TAG_PATTERN.test(String(parent.tagName || ''))) {
      return nodeFilter.FILTER_REJECT;
    }

    if (
      typeof parent.closest === 'function' &&
      parent.closest('.bsv-word, .bsv-tooltip, [data-bsv-web-wrap]')
    ) {
      return nodeFilter.FILTER_REJECT;
    }

    const text = String(node.textContent || '').trim();
    if (text.length < 2 || !/[\u4e00-\u9fff]/.test(text)) {
      return nodeFilter.FILTER_REJECT;
    }

    return nodeFilter.FILTER_ACCEPT;
  }

  function collectWebTextNodes(doc = globalScope.document) {
    const nodeFilter = getNodeFilter();
    if (!doc || !doc.body || typeof doc.createTreeWalker !== 'function') {
      return [];
    }

    const textNodes = [];
    const walker = doc.createTreeWalker(doc.body, nodeFilter.SHOW_TEXT, {
      acceptNode: (node) => shouldAcceptWebTextNode(node, nodeFilter),
    });

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }
    return textNodes;
  }

  function shouldReplaceWebTextNode(result, sourceText, normalizer = normalizeText) {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const normalize = typeof normalizer === 'function' ? normalizer : normalizeText;
    const normalizedSource = normalize(sourceText);
    const normalizedMixedText = normalize(result.mixedText);
    if (normalizedMixedText) {
      return normalizedMixedText !== normalizedSource;
    }

    if (!Array.isArray(result.tokens)) {
      return false;
    }

    return result.tokens.some((token) => token && token.type === 'word');
  }

  function renderWebTextReplacementHtml(result, sourceText, runtimeSettings, options = {}) {
    const renderToHtml =
      typeof options === 'function'
        ? options
        : options && typeof options.renderToHtml === 'function'
          ? options.renderToHtml
          : null;
    if (renderToHtml) {
      return renderToHtml(result, sourceText, runtimeSettings);
    }

    const renderer = options.renderer || globalScope.SubtitleRenderer;
    if (!renderer || typeof renderer.renderToHtml !== 'function') {
      return '';
    }

    return renderer.renderToHtml(result, sourceText, runtimeSettings);
  }

  function appendTextNode(parent, doc, value) {
    const text = String(value || '');
    if (!text) {
      return;
    }

    if (typeof doc.createTextNode === 'function') {
      parent.appendChild(doc.createTextNode(text));
      return;
    }

    const fallbackNode = doc.createElement('span');
    fallbackNode.textContent = text;
    parent.appendChild(fallbackNode);
  }

  function getWordDisplayText(token, bilingualMode = 'default') {
    const word = String((token && token.word) || '').trim();
    if (!word) {
      return '';
    }

    const originalText = String((token && (token.sourceText || token.meaning)) || '').trim();
    if (!originalText || bilingualMode === 'english-only') {
      return word;
    }
    if (bilingualMode === 'bilingual') {
      return word;
    }
    return `${word}（${originalText}）`;
  }

  function resolveLevelClass(token) {
    const vocabularyModule = globalScope.VocabularyModule;
    if (vocabularyModule && typeof vocabularyModule.getLevelClass === 'function') {
      return vocabularyModule.getLevelClass(token && token.level);
    }
    return 'level-cet4';
  }

  function setAttribute(element, name, value) {
    if (element && typeof element.setAttribute === 'function') {
      element.setAttribute(name, String(value || ''));
    }
  }

  function createWordElement(doc, token, sourceText, bilingualMode) {
    const wordElement = doc.createElement('span');
    setAttribute(wordElement, 'class', `bsv-word ${resolveLevelClass(token)}`.trim());
    setAttribute(wordElement, 'tabindex', '0');
    setAttribute(wordElement, 'data-word', token.word);
    setAttribute(wordElement, 'data-meaning', token.meaning);
    setAttribute(wordElement, 'data-level', token.level);
    setAttribute(wordElement, 'data-cefr-level', token.cefrLevel);
    setAttribute(wordElement, 'data-frequency', token.frequency);
    setAttribute(wordElement, 'data-pos', token.partOfSpeech);
    setAttribute(wordElement, 'data-definition', token.definition);
    setAttribute(wordElement, 'data-phonetic', token.phonetic);
    setAttribute(wordElement, 'data-learning-status', token.learningStatus);
    setAttribute(wordElement, 'data-source-text', token.sourceText);
    setAttribute(wordElement, 'data-original-subtitle', sourceText);
    appendTextNode(wordElement, doc, getWordDisplayText(token, bilingualMode) || token.word);
    return wordElement;
  }

  function appendRenderedTokens(parent, doc, result, sourceText, bilingualMode) {
    const tokens = result && Array.isArray(result.tokens) ? result.tokens : [];
    if (tokens.length === 0) {
      appendTextNode(parent, doc, sourceText);
      return;
    }

    for (const token of tokens) {
      if (!token || typeof token !== 'object') {
        continue;
      }
      if (token.type === 'word' && String(token.word || '').trim()) {
        parent.appendChild(createWordElement(doc, token, sourceText, bilingualMode));
      } else {
        appendTextNode(parent, doc, token.text);
      }
    }
  }

  function createWebTextReplacementNode(result, sourceText, runtimeSettings, options = {}) {
    const doc = options.document || globalScope.document;
    if (!doc || typeof doc.createElement !== 'function') {
      return null;
    }

    const source = String(sourceText || '');
    const bilingualMode = (runtimeSettings && runtimeSettings.bilingualMode) || 'default';
    const mixedText = result && typeof result.mixedText === 'string' ? result.mixedText : source;
    const wrapper = doc.createElement('span');
    // Mark our own output so the next tree walk does not re-wrap it (nested spans would grow forever).
    setAttribute(wrapper, 'data-bsv-web-wrap', '1');

    if (bilingualMode === 'bilingual' && source && mixedText !== source) {
      const line = doc.createElement('span');
      setAttribute(line, 'class', 'bsv-bilingual-line');
      appendRenderedTokens(line, doc, result, source, bilingualMode);
      wrapper.appendChild(line);

      const translation = doc.createElement('span');
      setAttribute(translation, 'class', 'bsv-bilingual-translation');
      appendTextNode(translation, doc, source);
      wrapper.appendChild(translation);
      return wrapper;
    }

    appendRenderedTokens(wrapper, doc, result, source, bilingualMode);
    return wrapper;
  }

  async function processWebTextNode(textNode, context) {
    const config = context && typeof context === 'object' ? context : {};
    const doc = config.document || globalScope.document;
    const nodeFilter = config.NodeFilter || getNodeFilter();
    const getSettings = requireFunction('getSettings', config.getSettings);
    const getRenderGeneration = requireFunction('getRenderGeneration', config.getRenderGeneration);
    const createCacheKey = requireFunction('createCacheKey', config.createCacheKey);
    const readCache = requireFunction('readCache', config.readCache);
    const writeCache = requireFunction('writeCache', config.writeCache);
    const translateText = requireFunction('translateText', config.translateText);
    const logError =
      typeof config.logError === 'function'
        ? config.logError
        : (scope, error) => console.error(`[BiliVocab] ${scope}:`, error);

    try {
      const generationAtStart = getRenderGeneration();
      const text = textNode && textNode.textContent;
      if (!text || text.length < 2) {
        return false;
      }

      const runtimeSettings = getSettings();
      const cacheKey = createCacheKey(`web:${text}`, runtimeSettings);
      let result = readCache(cacheKey);
      if (!result) {
        result = await translateText(text, runtimeSettings);
        writeCache(cacheKey, result);
      }

      if (generationAtStart !== getRenderGeneration()) {
        return false;
      }

      if (!shouldReplaceWebTextNode(result, text, config.normalizeText) || !textNode.parentNode) {
        return false;
      }

      if (!doc || typeof doc.createElement !== 'function') {
        return false;
      }

      const replacementNode = createWebTextReplacementNode(result, text, runtimeSettings, {
        document: doc,
      });
      if (!replacementNode) {
        return false;
      }
      if (containsUnsafeContent(replacementNode, { document: doc, NodeFilter: nodeFilter })) {
        replacementNode.textContent = text;
      }
      textNode.parentNode.replaceChild(replacementNode, textNode);
      return true;
    } catch (error) {
      logError('processTextNode', error);
      return false;
    }
  }

  function resolvePositiveInteger(value, fallback) {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
  }

  function createWebTextReplacementController(options) {
    const config = options && typeof options === 'object' ? options : {};
    const processIntervalMs = resolvePositiveInteger(
      config.processIntervalMs,
      DEFAULT_WEB_TEXT_PROCESS_INTERVAL
    );
    const batchSize = resolvePositiveInteger(config.batchSize, DEFAULT_BATCH_SIZE);
    const batchDelayMs = resolvePositiveInteger(config.batchDelayMs, DEFAULT_BATCH_DELAY_MS);
    const getSettings = requireFunction('getSettings', config.getSettings);
    const scheduleProcess = requireFunction('scheduleProcess', config.scheduleProcess);
    const isVideoSiteHost = requireFunction('isVideoSiteHost', config.isVideoSiteHost);
    const setTimer = config.setTimeout || globalScope.setTimeout;
    const clearTimer = config.clearTimeout || globalScope.clearTimeout;
    const getDocument =
      typeof config.getDocument === 'function' ? config.getDocument : () => globalScope.document;
    const getHostname =
      typeof config.getHostname === 'function'
        ? config.getHostname
        : () => globalScope.location && globalScope.location.hostname;
    let webTextProcessTimer = null;
    let webTextProcessing = false;
    let lastWebTextProcessAt = 0;

    function clearPendingTimer() {
      if (webTextProcessTimer && typeof clearTimer === 'function') {
        clearTimer(webTextProcessTimer);
      }
      webTextProcessTimer = null;
    }

    function waitForBatchDelay() {
      if (typeof setTimer !== 'function') {
        return Promise.resolve();
      }
      return new Promise((resolve) => setTimer(resolve, batchDelayMs));
    }

    async function processPageText() {
      const runtimeSettings = getSettings();
      if (!runtimeSettings.webPageEnabled || !runtimeSettings.enabled) {
        return;
      }

      const now = Date.now();
      if (webTextProcessing) {
        return;
      }

      const elapsed = now - lastWebTextProcessAt;
      if (elapsed < processIntervalMs) {
        if (!webTextProcessTimer && typeof setTimer === 'function') {
          webTextProcessTimer = setTimer(() => {
            webTextProcessTimer = null;
            scheduleProcess();
          }, processIntervalMs - elapsed);
        }
        return;
      }

      webTextProcessing = true;
      lastWebTextProcessAt = now;
      try {
        const hostname = String(getHostname() || '').toLowerCase();
        if (isVideoSiteHost(hostname)) {
          return;
        }

        const textNodes = collectWebTextNodes(getDocument());
        for (let i = 0; i < textNodes.length; i += batchSize) {
          const batch = textNodes.slice(i, i + batchSize);
          await Promise.all(batch.map((node) => processWebTextNode(node, config)));
          await waitForBatchDelay();
        }
      } finally {
        webTextProcessing = false;
      }
    }

    return {
      clearPendingTimer,
      processPageText,
    };
  }

  const api = {
    createWebTextReplacementController,
    collectWebTextNodes,
    shouldAcceptWebTextNode,
    processWebTextNode,
    shouldReplaceWebTextNode,
    createWebTextReplacementNode,
    renderWebTextReplacementHtml,
    containsUnsafeContent,
  };

  globalScope.BiliVocabWebTextReplacement = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
