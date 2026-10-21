(function (globalScope) {
  // Legacy message namespaces retained for backward compatibility across extension components.
  const MESSAGE_TYPES = {
    SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
    ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
    ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
    EXPERIENCE_RECORD_EVENT: 'BILI_VOCAB_EXPERIENCE_RECORD_EVENT',
    LEARNING_RECORD_HIT: 'BILI_VOCAB_LEARNING_RECORD_HIT',
    LEARNING_APPLY_REVIEW_FEEDBACK: 'BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK',
    LEARNING_SAVE_WORD: 'BILI_VOCAB_LEARNING_SAVE_WORD',
    LEARNING_REMOVE_WORD: 'BILI_VOCAB_LEARNING_REMOVE_WORD',
    LEARNING_CLEAR_VOCABULARY: 'BILI_VOCAB_LEARNING_CLEAR_VOCABULARY',
  };

  function hasRuntimeMessaging() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function'
    );
  }

  function isTrustedExtensionSender(sender) {
    if (!sender || typeof sender !== 'object') {
      return false;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      return false;
    }
    return sender.id === chrome.runtime.id;
  }

  function toErrorMessage(error, fallbackMessage) {
    if (!error) {
      return fallbackMessage;
    }
    const message = String(error.message || error).trim();
    return message || fallbackMessage;
  }

  function sendRuntimeMessage(type, payload) {
    if (!hasRuntimeMessaging()) {
      return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const runtimeError =
          chrome.runtime && chrome.runtime.lastError
            ? new Error(
                toErrorMessage(chrome.runtime.lastError, 'chrome.runtime.sendMessage failed')
              )
            : null;
        if (runtimeError) {
          reject(runtimeError);
          return;
        }

        if (!response || response.ok !== true) {
          reject(
            new Error(
              toErrorMessage(
                response && response.error,
                `Runtime message failed: ${String(type || '').trim() || 'unknown'}`
              )
            )
          );
          return;
        }

        resolve(response.payload);
      });
    });
  }

  const api = {
    MESSAGE_TYPES,
    hasRuntimeMessaging,
    isTrustedExtensionSender,
    sendRuntimeMessage,
  };

  globalScope.RuntimeMessaging = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
