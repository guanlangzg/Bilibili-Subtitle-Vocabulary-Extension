(function (globalScope) {
  function normalizeText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function debounce(fn, delay) {
    let timer = null;
    function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delay);
    }
    debounced.cancel = function cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }

  function logError(context, error) {
    console.error(`[BiliVocab] ${context}:`, error);
  }

  class LRUCache {
    constructor(maxSize) {
      this.cache = new Map();
      this.maxSize = maxSize;
    }

    get(key) {
      const value = this.cache.get(key);
      if (value) {
        this.cache.delete(key);
        this.cache.set(key, value);
      }
      return value;
    }

    set(key, value) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else if (this.cache.size >= this.maxSize) {
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(key, value);
    }

    has(key) {
      return this.cache.has(key);
    }

    clear() {
      this.cache.clear();
    }

    delete(key) {
      return this.cache.delete(key);
    }

    get size() {
      return this.cache.size;
    }

    forEach(callbackFn, thisArg) {
      this.cache.forEach(callbackFn, thisArg);
    }
  }

  const api = { normalizeText, escapeHtml, normalizeWordKey, debounce, logError, LRUCache };
  globalScope.Utils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
