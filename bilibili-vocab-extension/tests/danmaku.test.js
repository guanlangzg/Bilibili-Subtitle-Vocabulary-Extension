const test = require('node:test');
const assert = require('node:assert/strict');

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.parentElement = null;
    this.className = '';
    this.id = '';
    this._textContent = '';
    this._innerHTML = '';
    this.clientWidth = 0;
    this.offsetWidth = 0;
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  querySelector(selector) {
    if (!selector || selector[0] !== '#') {
      return null;
    }

    const id = selector.slice(1);
    return this.findById(id);
  }

  findById(id) {
    if (this.id === id) {
      return this;
    }

    for (const child of this.children) {
      if (typeof child.findById === 'function') {
        const match = child.findById(id);
        if (match) {
          return match;
        }
      }
    }

    return null;
  }

  addEventListener(type, handler, options = {}) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }

    this.listeners.get(type).push({ handler, once: Boolean(options.once) });
  }

  dispatchEvent(type) {
    const listeners = this.listeners.get(type) || [];
    const retained = [];

    listeners.forEach((listener) => {
      listener.handler();
      if (!listener.once) {
        retained.push(listener);
      }
    });

    this.listeners.set(type, retained);
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    if (this._innerHTML === '') {
      this.children.forEach((child) => {
        child.parentElement = null;
      });
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value || '');
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => String(child.textContent || '')).join('');
    }

    return this._textContent;
  }
}

global.HTMLElement = MockElement;
global.HTMLVideoElement = class MockVideoElement extends MockElement {};

const host = new MockElement('div');

global.document = {
  documentElement: new MockElement('html'),
  createElement(tagName) {
    return new MockElement(tagName);
  },
  querySelector(selector) {
    if (selector === '.bpx-player-video-wrap') {
      return host;
    }

    return null;
  },
};

global.MutationObserver = class MockMutationObserver {
  observe() {}

  disconnect() {}
};

global.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

global.getComputedStyle = () => ({ position: 'relative' });

const danmaku = require('../scripts/danmaku.js');

test('shootWordDanmaku: should drop the frame when all tracks are cooling down', () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  danmaku.clearDanmaku();

  try {
    for (let index = 0; index < danmaku.TRACK_COUNT; index += 1) {
      const result = danmaku.shootWordDanmaku({
        word: `word-${index}`,
        translation: '测试',
      });

      assert.equal(result, true);
    }

    const overflow = danmaku.shootWordDanmaku({
      word: 'overflow',
      translation: '测试',
    });

    assert.equal(overflow, false);
  } finally {
    Date.now = originalNow;
    danmaku.clearDanmaku();
  }
});

test('shootWordDanmaku: should reuse a track only after the previous danmaku leaves the screen', () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  danmaku.clearDanmaku();

  try {
    for (let index = 0; index < danmaku.TRACK_COUNT; index += 1) {
      assert.equal(
        danmaku.shootWordDanmaku({
          word: `word-${index}`,
          translation: 'test',
        }),
        true
      );
    }

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    const firstNode = container.children[0];
    assert.ok(firstNode);

    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'blocked',
        translation: 'test',
      }),
      false
    );

    firstNode.dispatchEvent('transitionend');

    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'reused',
        translation: 'test',
      }),
      true
    );
  } finally {
    Date.now = originalNow;
    danmaku.clearDanmaku();
  }
});

test('shootWordDanmaku: should apply inline layout styles required for visibility', () => {
  danmaku.clearDanmaku();

  try {
    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'visible-word',
        translation: 'test',
      }),
      true
    );

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    const node = container.children[container.children.length - 1];
    assert.equal(node.style.position, 'absolute');
    assert.equal(node.style.display, 'inline-flex');
    assert.equal(node.style.whiteSpace, 'nowrap');
    assert.equal(
      node.style.fontFamily,
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, Helvetica, sans-serif'
    );
    assert.equal(node.style.fontSize, '23px');
    assert.equal(node.style.fontWeight, '600');
    assert.equal(node.style.lineHeight, '1.12');
    assert.equal(node.style.color, '#eaf6ff');
    assert.equal(node.style.pointerEvents, 'none');
    assert.equal(node.style.transform, 'translateX(calc(-960px - 100% - 40px))');
  } finally {
    danmaku.clearDanmaku();
  }
});

test('setSpeedPreset: should apply dynamic duration to newly fired danmaku', () => {
  danmaku.clearDanmaku();

  try {
    host.clientWidth = 1280;
    danmaku.setSpeedPreset('fast');
    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'fast-word-with-longer-readable-text',
        translation: 'test',
      }),
      true
    );

    let container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    let node = container.children[container.children.length - 1];
    assert.equal(
      node.style.transition,
      `transform ${danmaku.getFlyDurationMs(node.textContent, container)}ms linear`
    );
    assert.equal(node.style.transform, 'translateX(calc(-1280px - 100% - 40px))');

    danmaku.clearDanmaku();
    host.clientWidth = 640;
    danmaku.setSpeedPreset('slow');
    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'slow-word',
        translation: 'test',
      }),
      true
    );

    container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    node = container.children[container.children.length - 1];
    assert.equal(
      node.style.transition,
      `transform ${danmaku.getFlyDurationMs(node.textContent, container)}ms linear`
    );
    assert.equal(node.style.transform, 'translateX(calc(-640px - 100% - 40px))');
  } finally {
    host.clientWidth = 0;
    danmaku.setSpeedPreset('normal');
    danmaku.clearDanmaku();
  }
});

test('getFlyDurationMs: should clamp readable duration by speed preset range', () => {
  const root = new MockElement('div');
  const parent = new MockElement('div');
  parent.clientWidth = 3840;
  parent.appendChild(root);

  try {
    danmaku.setSpeedPreset('fast');
    assert.equal(
      danmaku.getFlyDurationMs('a very long danmaku text used to test duration clamping', root),
      14000
    );

    parent.clientWidth = 320;
    assert.equal(danmaku.getFlyDurationMs('short', root), 9000);
  } finally {
    danmaku.setSpeedPreset('normal');
  }
});

test('shootWordDanmaku: should render associated words with weaker visual style', () => {
  danmaku.clearDanmaku();

  try {
    assert.equal(
      danmaku.shootWordDanmaku(
        {
          word: 'associated-word',
          translation: 'test',
        },
        true
      ),
      true
    );

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    const node = container.children[container.children.length - 1];
    assert.match(node.className, /bsv-danmaku-item-associated/);
    assert.equal(node.style.color, '#ffe8a8');
    assert.equal(node.style.fontSize, '23px');
    assert.equal(node.style.fontWeight, '600');
    assert.equal(node.style.opacity, '0.68');
    assert.equal(node.children.length, 3);
    assert.equal(node.children[0].className, 'bsv-danmaku-item__word');
    assert.equal(node.children[0].style.color, '#ffe8a8');
    assert.equal(node.children[1].className, 'bsv-danmaku-item__separator');
    assert.equal(node.children[1].style.color, 'rgba(255, 255, 255, 0.42)');
    assert.equal(node.children[2].className, 'bsv-danmaku-item__translation');
    assert.equal(node.children[2].style.color, 'rgba(255, 255, 255, 0.72)');
    assert.equal(node.textContent, 'associated-word · test');
  } finally {
    danmaku.clearDanmaku();
  }
});

test('shootWordDanmaku: should render primary words with distinct inline colors', () => {
  danmaku.clearDanmaku();

  try {
    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'primary-word',
        translation: 'meaning',
      }),
      true
    );

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    const node = container.children[container.children.length - 1];
    assert.equal(node.children.length, 3);
    assert.equal(node.children[0].style.color, '#eaf6ff');
    assert.equal(node.children[1].style.color, 'rgba(255, 255, 255, 0.52)');
    assert.equal(node.children[2].style.color, 'rgba(255, 255, 255, 0.88)');
    assert.equal(node.textContent, 'primary-word · meaning');
  } finally {
    danmaku.clearDanmaku();
  }
});

test('setDensityPreset: should adjust onscreen cap and available tracks', () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  danmaku.clearDanmaku();

  try {
    assert.equal(danmaku.setDensityPreset('sparse'), 'sparse');
    for (let index = 0; index < danmaku.DENSITY_PRESET_TO_LIMITS.sparse.maxOnscreen; index += 1) {
      assert.equal(
        danmaku.shootWordDanmaku({
          word: `sparse-${index}`,
          translation: 'test',
        }),
        true
      );
    }
    assert.equal(
      danmaku.shootWordDanmaku({
        word: 'sparse-overflow',
        translation: 'test',
      }),
      false
    );

    danmaku.clearDanmaku();
    assert.equal(danmaku.setDensityPreset('dense'), 'dense');
    for (let index = 0; index < danmaku.DENSITY_PRESET_TO_LIMITS.dense.maxOnscreen; index += 1) {
      assert.equal(
        danmaku.shootWordDanmaku({
          word: `dense-${index}`,
          translation: 'test',
        }),
        true
      );
    }
  } finally {
    Date.now = originalNow;
    danmaku.setDensityPreset('normal');
    danmaku.clearDanmaku();
  }
});

test('shootWordDanmaku: should keep tracks above the subtitle area', () => {
  danmaku.clearDanmaku();

  try {
    for (let index = 0; index < danmaku.TRACK_COUNT; index += 1) {
      assert.equal(
        danmaku.shootWordDanmaku({
          word: `track-${index}`,
          translation: 'test',
        }),
        true
      );
    }

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    container.children.forEach((node) => {
      const top = Number.parseFloat(node.style.top);
      assert.ok(top >= danmaku.TRACK_TOP_PERCENT_RANGE.min);
      assert.ok(top <= danmaku.TRACK_TOP_PERCENT_RANGE.max);
    });
  } finally {
    danmaku.clearDanmaku();
  }
});

test('destroy: should disconnect a host observer that is still waiting for the player', () => {
  const originalDocument = global.document;
  const originalMutationObserver = global.MutationObserver;
  const observerState = { observed: 0, disconnected: 0 };

  global.MutationObserver = class TrackingMutationObserver {
    observe() {
      observerState.observed += 1;
    }

    disconnect() {
      observerState.disconnected += 1;
    }
  };
  global.document = {
    documentElement: new MockElement('html'),
    createElement(tagName) {
      return new MockElement(tagName);
    },
    querySelector() {
      return null;
    },
  };

  try {
    assert.equal(danmaku.initDanmakuContainer(), null);
    assert.equal(observerState.observed, 1);
    assert.equal(observerState.disconnected, 0);

    danmaku.destroy();

    assert.equal(observerState.disconnected, 1);
  } finally {
    global.document = originalDocument;
    global.MutationObserver = originalMutationObserver;
  }
});

test('destroy: should remove the mounted container and allow a fresh mount', () => {
  danmaku.destroy();

  const container = danmaku.initDanmakuContainer();
  assert.ok(container instanceof MockElement);
  assert.equal(host.children.length, 1);

  danmaku.destroy();

  assert.equal(container.parentElement, null);
  assert.equal(host.children.length, 0);

  const remounted = danmaku.initDanmakuContainer();
  assert.ok(remounted instanceof MockElement);
  assert.notEqual(remounted, container);
  assert.equal(host.children.length, 1);
});

test('clearDanmaku: should clear pending fallback cleanup timers', () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const pending = new Set();

  global.setTimeout = (callback) => {
    const handle = { callback };
    pending.add(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    pending.delete(handle);
  };

  try {
    danmaku.destroy();
    assert.equal(danmaku.shootWordDanmaku({ word: 'timer', translation: '测试' }), true);
    assert.equal(pending.size, 1);

    danmaku.clearDanmaku();
    assert.equal(pending.size, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    danmaku.destroy();
  }
});
