const test = require('node:test');
const assert = require('node:assert/strict');

const tooltip = require('../tooltip.js');

test('renderTooltipContent: should include context, learning status and quick actions', () => {
  const html = tooltip.renderTooltipContent({
    dataset: {
      word: 'retain',
      meaning: '记住',
      level: 'CET6',
      cefrLevel: 'B2',
      frequency: '12345',
      phonetic: '/rɪˈteɪn/',
      pos: 'v.',
      definition: 'keep in memory',
      originalSubtitle: '这能帮助你更好地记住知识。',
      learningStatus: 'unseen',
      coverageTier: 'core',
      phraseBacked: 'true',
      phraseCount: '3',
      sourceFlags: 'kylebing,ecdict',
    },
    textContent: 'retain',
  });

  assert.match(html, /这能帮助你更好地记住知识/);
  assert.match(html, /命中原因/);
  assert.match(html, /CET6 词库/);
  assert.match(html, /核心高频/);
  assert.match(html, /词组优先/);
  assert.match(html, /未巩固/);
  assert.match(html, /考试来源/);
  assert.match(html, /当前状态/);
  assert.match(html, /未巩固/);
  assert.match(html, /data-feedback="know"/);
  assert.match(html, /data-feedback="fuzzy"/);
  assert.match(html, /data-feedback="dontKnow"/);
  assert.match(html, /data-feedback="save"/);
  assert.match(html, /data-feedback="skip"/);
  assert.match(html, /data-feedback="misreplace"/);
});

test('buildWordSourceMetadata: should capture current page source and video time', (t) => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;

  globalThis.document = {
    title: '  Demo Subtitle Video  ',
    querySelector(selector) {
      assert.equal(selector, 'video');
      return {
        currentTime: 3723.9,
      };
    },
  };
  globalThis.location = {
    href: 'https://www.bilibili.com/video/BV1demo',
  };

  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  });

  assert.deepEqual(tooltip.buildWordSourceMetadata(), {
    title: 'Demo Subtitle Video',
    url: 'https://www.bilibili.com/video/BV1demo',
    timeSeconds: 3723,
    timeLabel: '1:02:03',
  });
});

test('reportContextMisreplaceFeedback: should forward word feedback to translator module', () => {
  const calls = [];
  globalThis.SubtitleTranslator = {
    reportContextMisreplace(word, options) {
      calls.push({ word, options });
      return { word, inCooldown: true };
    },
  };

  const result = tooltip.reportContextMisreplaceFeedback('optimize', {
    severity: 'high',
    now: 1700000000000,
  });
  assert.deepEqual(calls, [
    {
      word: 'optimize',
      options: { severity: 'high', now: 1700000000000 },
    },
  ]);
  assert.deepEqual(result, { word: 'optimize', inCooldown: true });

  delete globalThis.SubtitleTranslator;
});

test('reportContextMisreplaceFeedback: should refresh rendered translations after feedback', () => {
  let refreshCalls = 0;
  globalThis.SubtitleTranslator = {
    reportContextMisreplace() {
      return { word: 'optimize', inCooldown: true };
    },
  };
  globalThis.BiliVocabContentRuntime = {
    refreshTranslationsForSelectionStateChange() {
      refreshCalls += 1;
    },
  };

  tooltip.reportContextMisreplaceFeedback('optimize', {
    severity: 'high',
    now: 1700000000000,
  });

  assert.equal(refreshCalls, 1);

  delete globalThis.SubtitleTranslator;
  delete globalThis.BiliVocabContentRuntime;
});

test('destroy: should remove listeners so feedback stops after teardown', () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const registrations = [];

  const createTarget = (label) => ({
    addEventListener(type, listener) {
      registrations.push({ label, type, listener, removed: false });
    },
    removeEventListener(type, listener) {
      const entry = registrations.find(
        (item) => item.label === label && item.type === type && item.listener === listener
      );
      if (entry) {
        entry.removed = true;
      }
    },
  });

  const tooltipElement = {
    id: 'bsv-tooltip',
    classList: { remove() {}, add() {} },
    setAttribute() {},
    contains() {
      return false;
    },
    parentNode: {
      removeChild() {},
    },
  };

  global.document = {
    ...createTarget('document'),
    getElementById() {
      return tooltipElement;
    },
    createElement() {
      return tooltipElement;
    },
    body: { appendChild() {} },
  };
  global.window = createTarget('window');

  try {
    const isolatedTooltip = require('../tooltip.js');
    isolatedTooltip.init();
    assert.equal(registrations.filter((item) => item.label === 'document').length, 6);

    isolatedTooltip.destroy();

    const removed = registrations.filter((item) => item.removed);
    assert.equal(removed.length, 7);
    const reinitialized = registrations.length;
    isolatedTooltip.init();
    assert.equal(registrations.length, reinitialized + 7);
    isolatedTooltip.destroy();
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
});
