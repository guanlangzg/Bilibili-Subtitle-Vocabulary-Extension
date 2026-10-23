(function (globalScope) {
  const DEFAULT_INTERVAL_MS = 3400;
  const MAX_ASSOCIATED_PER_CLUSTER = 1;
  const MAX_COOLDOWN_QUEUE_LENGTH = 60;
  const DEBUG_LOG_FLAG = '__BILI_VOCAB_DEBUG_LOGS__';
  const DENSITY_PRESET_TO_INTERVAL_MS = {
    sparse: 4200,
    normal: 3400,
    dense: 2600,
  };

  function logDebug(...args) {
    if (globalScope[DEBUG_LOG_FLAG] !== true) {
      return;
    }
    if (typeof console === 'undefined' || typeof console.debug !== 'function') {
      return;
    }
    console.debug(...args);
  }

  function normalizeDensityPreset(value) {
    const normalized = String(value || 'normal')
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(DENSITY_PRESET_TO_INTERVAL_MS, normalized)
      ? normalized
      : 'normal';
  }

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function computeWordWeight(wordObj) {
    const hitCount = Math.max(1, Number(wordObj && wordObj.hitCount) || 1);
    return 1 / Math.pow(hitCount, 1.5);
  }

  function sanitizeChineseText(text) {
    return String(text || '')
      .replace(/[\p{P}\p{S}\s]+/gu, '')
      .replace(/[a-zA-Z0-9]+/g, '')
      .trim();
  }

  function getChineseCharSet(text) {
    return new Set(sanitizeChineseText(text).split('').filter(Boolean));
  }

  function computeChineseJaccard(a, b) {
    const aSet = getChineseCharSet(a);
    const bSet = getChineseCharSet(b);

    if (aSet.size === 0 || bSet.size === 0) {
      return 0;
    }

    let intersection = 0;
    aSet.forEach((char) => {
      if (bSet.has(char)) {
        intersection += 1;
      }
    });

    const union = aSet.size + bSet.size - intersection;
    if (union <= 0) {
      return 0;
    }

    return intersection / union;
  }

  function levenshteinDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');

    if (!a) {
      return b.length;
    }
    if (!b) {
      return a.length;
    }

    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i += 1) {
      matrix[i][0] = i;
    }

    for (let j = 0; j < cols; j += 1) {
      matrix[0][j] = j;
    }

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }

  function isNearSpelling(seedWord, candidateWord) {
    const seed = String(seedWord || '')
      .trim()
      .toLowerCase();
    const candidate = String(candidateWord || '')
      .trim()
      .toLowerCase();

    if (!seed || !candidate || seed === candidate) {
      return false;
    }

    const distance = levenshteinDistance(seed, candidate);
    if (distance > 2) {
      return false;
    }

    const firstLetterNear = seed[0] === candidate[0];
    const similarLength = Math.abs(seed.length - candidate.length) <= 2;
    return firstLetterNear || similarLength;
  }

  function isTranslationSimilar(seedTranslation, candidateTranslation) {
    return computeChineseJaccard(seedTranslation, candidateTranslation) >= 0.4;
  }

  function createCooldownSet(queue, poolSize) {
    const seedSize = Math.max(0, Number(poolSize) || 0);
    const maxSize = Math.min(30, Math.floor(seedSize * 0.6));
    if (maxSize <= 0) {
      return new Set();
    }

    const source = Array.isArray(queue) ? queue : [];
    const sliced = source.slice(Math.max(0, source.length - maxSize));
    return new Set(sliced);
  }

  function filterActivePool(pool, cooldownSet) {
    const set = cooldownSet instanceof Set ? cooldownSet : new Set();
    const items = Array.isArray(pool) ? pool : [];

    return items.filter((item) => {
      if (!item || !item.word) {
        return false;
      }
      if ((Number(item.hitCount) || 0) <= 0) {
        return false;
      }

      const key = normalizeWordKey(item.word);
      return key && !set.has(key);
    });
  }

  function pickWeightedWord(pool, cooldownSet, randomFn) {
    const candidates = filterActivePool(pool, cooldownSet);
    if (candidates.length === 0) {
      return null;
    }

    const weighted = candidates.map((item) => {
      return {
        item,
        weight: computeWordWeight(item),
      };
    });

    const totalWeight = weighted.reduce((sum, pair) => sum + pair.weight, 0);
    if (totalWeight <= 0) {
      return weighted[0].item;
    }

    const random = typeof randomFn === 'function' ? randomFn : Math.random;
    let cursor = random() * totalWeight;

    for (let i = 0; i < weighted.length; i += 1) {
      cursor -= weighted[i].weight;
      if (cursor <= 0) {
        return weighted[i].item;
      }
    }

    return weighted[weighted.length - 1].item;
  }

  function buildAssociationCluster(seedWordObj, pool, cooldownSet) {
    if (!seedWordObj || !seedWordObj.word) {
      return [];
    }

    const seedWord = String(seedWordObj.word || '').trim();
    const seedTranslation = seedWordObj.translation || seedWordObj.meaning || '';
    const cooldown = cooldownSet instanceof Set ? cooldownSet : new Set();
    const candidates = Array.isArray(pool) ? pool : [];

    const typoLike = [];
    const synonymLike = [];

    candidates.forEach((candidate) => {
      if (!candidate || !candidate.word) {
        return;
      }

      const key = normalizeWordKey(candidate.word);
      if (!key || cooldown.has(key)) {
        return;
      }

      if (normalizeWordKey(candidate.word) === normalizeWordKey(seedWord)) {
        return;
      }

      const nearSpelling = isNearSpelling(seedWord, candidate.word);
      const translation = candidate.translation || candidate.meaning || '';
      const nearTranslation = isTranslationSimilar(seedTranslation, translation);

      if (nearSpelling) {
        typoLike.push(candidate);
        return;
      }

      if (nearTranslation) {
        synonymLike.push(candidate);
      }
    });

    const ordered = [...typoLike, ...synonymLike];
    const deduped = [];
    const seen = new Set();

    ordered.forEach((item) => {
      const key = normalizeWordKey(item.word);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push(item);
    });

    return deduped;
  }

  function createSchedulerEngine(options) {
    const config = options || {};

    const getVocabularyWords =
      typeof config.getVocabularyWords === 'function'
        ? config.getVocabularyWords
        : () => {
            if (
              globalScope.VocabularyModule &&
              typeof globalScope.VocabularyModule.getEncounteredWords === 'function'
            ) {
              return globalScope.VocabularyModule.getEncounteredWords();
            }
            return [];
          };

    const shootDanmaku =
      typeof config.shootDanmaku === 'function'
        ? config.shootDanmaku
        : (wordObj, isAssociated) => {
            if (
              globalScope.DanmakuModule &&
              typeof globalScope.DanmakuModule.shootWordDanmaku === 'function'
            ) {
              return globalScope.DanmakuModule.shootWordDanmaku(wordObj, isAssociated);
            }
            return false;
          };

    let densityPreset = normalizeDensityPreset(config.densityPreset);
    let intervalMs = Math.max(
      200,
      Number(config.intervalMs) || DENSITY_PRESET_TO_INTERVAL_MS[densityPreset]
    );
    let timer = null;
    const cooldownQueue = [];
    const associatedQueue = [];

    function enqueueAssociatedCluster(seedWordObj, pool, cooldownSet) {
      const cluster = buildAssociationCluster(seedWordObj, pool, cooldownSet).slice(
        0,
        MAX_ASSOCIATED_PER_CLUSTER
      );
      cluster.forEach((item) => associatedQueue.push(item));
    }

    function pushCooldown(word) {
      const key = normalizeWordKey(word);
      if (!key) {
        return;
      }

      cooldownQueue.push(key);
      if (cooldownQueue.length > MAX_COOLDOWN_QUEUE_LENGTH) {
        cooldownQueue.splice(0, cooldownQueue.length - MAX_COOLDOWN_QUEUE_LENGTH);
      }
    }

    function tick() {
      const pool = getVocabularyWords();
      const cooldownSet = createCooldownSet(cooldownQueue, Array.isArray(pool) ? pool.length : 0);

      let candidate = null;
      let isAssociated = false;
      let cameFromAssociatedQueue = false;

      if (associatedQueue.length > 0) {
        candidate = associatedQueue[0];
        isAssociated = true;
        cameFromAssociatedQueue = true;
      } else {
        candidate = pickWeightedWord(pool, cooldownSet);
      }

      if (!candidate) {
        logDebug(
          '[DanmakuReview] tick: no candidate. poolSize:',
          Array.isArray(pool) ? pool.length : 0,
          'cooldownSize:',
          cooldownSet.size,
          'assocQueueLen:',
          associatedQueue.length
        );
        return;
      }

      const fired = shootDanmaku(candidate, isAssociated);
      if (!fired) {
        logDebug(
          '[DanmakuReview] tick: shootDanmaku returned false for',
          candidate.word,
          'isAssociated:',
          isAssociated
        );
        return;
      }

      if (cameFromAssociatedQueue) {
        associatedQueue.shift();
      } else {
        enqueueAssociatedCluster(candidate, pool, cooldownSet);
      }

      pushCooldown(candidate.word);
    }

    function start() {
      if (timer) {
        return;
      }
      logDebug('[DanmakuReview] Engine started, interval:', intervalMs, 'ms');
      timer = setInterval(tick, intervalMs);
      tick();
    }

    function pause() {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    }

    function resume() {
      if (timer) {
        return;
      }
      start();
    }

    function stop() {
      pause();
      associatedQueue.length = 0;
      cooldownQueue.length = 0;
    }

    function setDensityPreset(nextDensityPreset) {
      densityPreset = normalizeDensityPreset(nextDensityPreset);
      intervalMs = DENSITY_PRESET_TO_INTERVAL_MS[densityPreset];
      if (timer) {
        pause();
        start();
      }
      return densityPreset;
    }

    return {
      start,
      pause,
      resume,
      stop,
      setDensityPreset,
      tick,
      isRunning() {
        return Boolean(timer);
      },
      getIntervalMs() {
        return intervalMs;
      },
    };
  }

  const defaultEngine = createSchedulerEngine();

  const api = {
    DEFAULT_INTERVAL_MS,
    DENSITY_PRESET_TO_INTERVAL_MS,
    normalizeDensityPreset,
    computeWordWeight,
    computeChineseJaccard,
    levenshteinDistance,
    isNearSpelling,
    isTranslationSimilar,
    createCooldownSet,
    pickWeightedWord,
    buildAssociationCluster,
    createSchedulerEngine,
    setDensityPreset: (nextDensityPreset) => defaultEngine.setDensityPreset(nextDensityPreset),
    startEngine: () => defaultEngine.start(),
    pauseEngine: () => defaultEngine.pause(),
    resumeEngine: () => defaultEngine.resume(),
    stopEngine: () => defaultEngine.stop(),
    isRunning: () => defaultEngine.isRunning(),
    __tick: () => defaultEngine.tick(),
  };

  globalScope.SchedulerModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
