(function (globalScope) {
  function requireFunction(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
    return value;
  }

  function isValidOverlayModule(module) {
    return Boolean(module && typeof module.mountOverlayPanel === 'function');
  }

  function resolveGlobalOverlayModule() {
    const module = globalScope.ReactOverlayModule;
    return isValidOverlayModule(module) ? module : null;
  }

  function createOverlayLoader(options) {
    const config = options && typeof options === 'object' ? options : {};
    const shouldLoadForHost = requireFunction('shouldLoadForHost', config.shouldLoadForHost);
    const importOverlayModule = requireFunction('importOverlayModule', config.importOverlayModule);
    const getGlobalModule =
      typeof config.getGlobalModule === 'function'
        ? config.getGlobalModule
        : resolveGlobalOverlayModule;
    const getHostname =
      typeof config.getHostname === 'function'
        ? config.getHostname
        : () => globalScope.location && globalScope.location.hostname;
    const logError =
      typeof config.logError === 'function'
        ? config.logError
        : (scope, error) => console.error(`[BiliVocab] ${scope}:`, error);
    let moduleCache = null;
    let modulePromise = null;

    function readGlobalModule() {
      const module = getGlobalModule();
      return isValidOverlayModule(module) ? module : null;
    }

    function reset() {
      moduleCache = null;
      modulePromise = null;
    }

    async function load() {
      const existing = readGlobalModule();
      if (existing) {
        moduleCache = existing;
        return existing;
      }

      if (moduleCache) {
        return moduleCache;
      }

      if (modulePromise) {
        return modulePromise;
      }

      if (!shouldLoadForHost(getHostname())) {
        return null;
      }

      modulePromise = Promise.resolve()
        .then(() => importOverlayModule())
        .then((module) => {
          const globalModule = readGlobalModule();
          if (globalModule) {
            moduleCache = globalModule;
            return globalModule;
          }
          if (isValidOverlayModule(module)) {
            moduleCache = module;
            return module;
          }
          return null;
        })
        .catch((error) => {
          logError('Overlay module load failed', error);
          return null;
        })
        .finally(() => {
          modulePromise = null;
        });

      return modulePromise;
    }

    return {
      load,
      reset,
    };
  }

  const api = {
    createOverlayLoader,
    isValidOverlayModule,
  };

  globalScope.BiliVocabOverlayLoader = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
