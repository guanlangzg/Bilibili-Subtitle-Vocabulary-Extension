const test = require('node:test');
const assert = require('node:assert/strict');

const vocabularyPure = require('../vocabulary-pure.js');
const vocabulary = require('../vocabulary.js');

const previousChrome = global.chrome;

test.before(() => {
  global.chrome = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: true, payload: {} });
      },
    },
  };
});

test.after(() => {
  global.chrome = previousChrome;
});

test('findMatchesInText: should match alias terms', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'optimize',
      meaning: '\u4f18\u5316',
      aliases: ['\u6539\u8fdb'],
      level: 'CET4',
    },
  ]);

  const matches = vocabulary.findMatchesInText(
    '\u6211\u4eec\u9700\u8981\u6539\u8fdb\u5b57\u5e55\u7cfb\u7edf',
    ['CET4']
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].chinese, '\u6539\u8fdb');
  assert.equal(matches[0].word, 'optimize');
});

test('findMatchesInText: should deduplicate repeated meaning terms', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'strategy',
      meaning: '\u7b56\u7565;\u65b9\u6cd5',
      aliases: ['\u7b56\u7565', '\u65b9\u6848'],
      level: 'CET6',
    },
  ]);

  const matches = vocabulary.findMatchesInText(
    '\u8fd9\u4e2a\u7b56\u7565\u65b9\u6848\u5f88\u6709\u6548',
    ['CET6']
  );
  const chineseTokens = matches.map((item) => item.chinese);
  assert.deepEqual(chineseTokens, ['\u7b56\u7565', '\u65b9\u6848']);
});

test('recordHit: should increment hitCount and update lastSeen', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'optimize',
      meaning: '\u4f18\u5316',
      aliases: ['\u6539\u8fdb'],
      level: 'CET4',
    },
  ]);

  const before = Date.now();
  const result = vocabulary.recordHit('optimize');

  assert.equal(result, true);

  const encountered = vocabulary.getEncounteredWords();
  assert.equal(encountered.length, 1);
  assert.equal(encountered[0].word, 'optimize');
  assert.equal(encountered[0].hitCount, 1);
  assert.ok(Number(encountered[0].lastSeen) >= before);
});

test('getEncounteredWords: should return only words with hitCount > 0', () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  vocabulary.recordHit('beta');

  const encountered = vocabulary.getEncounteredWords();
  assert.deepEqual(
    encountered.map((item) => item.word),
    ['beta']
  );
});

test('getReviewQueue: should prioritize earlier nextReviewAt within same bucket', () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  const originalNow = Date.now;
  let now = 1700000000000;
  Date.now = () => now;
  try {
    vocabulary.recordHit('alpha');
    now += 1000;
    vocabulary.recordHit('beta');
  } finally {
    Date.now = originalNow;
  }

  const queue = vocabulary.getReviewQueue(2);
  assert.deepEqual(
    queue.map((item) => item.word),
    ['alpha', 'beta']
  );
  assert.equal(typeof queue[0].nextReviewAt, 'number');
  assert.equal(typeof queue[0].intervalDays, 'number');
  assert.equal(typeof queue[0].easeFactor, 'number');
});

test('getReviewQueue: should prioritize today bucket before soon bucket', async () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  const originalNow = Date.now;
  const now = 1700000000000;
  Date.now = () => now;
  try {
    vocabulary.recordHit('alpha');
    await vocabulary.applyLearningAction('alpha', 'dontKnow');

    vocabulary.recordHit('beta');
    await vocabulary.applyLearningAction('beta', 'know');
  } finally {
    Date.now = originalNow;
  }

  const queue = vocabulary.getReviewQueue(2);
  assert.equal(queue[0].word, 'alpha');
  assert.equal(queue[0].dueBucket, 'today');
  assert.equal(queue[1].word, 'beta');
  assert.equal(queue[1].dueBucket, 'soon');
});

test('recordHit: should apply learning state to every level entry sharing the same word', () => {
  // Only entries carrying a curated match term are indexed, so both levels need
  // aliases; the assertion is about the shared learning record, not matching.
  vocabulary.__setEntriesForTest([
    {
      word: 'identification',
      meaning: '识别',
      aliases: ['识别'],
      level: 'CET4',
      coverageTier: 'core',
    },
    {
      word: 'identification',
      meaning: '鉴定；认同',
      aliases: ['识别'],
      level: 'TOEFL',
      coverageTier: 'full',
    },
  ]);

  assert.equal(vocabulary.recordHit('identification'), true);
  assert.equal(vocabulary.recordHit('identification'), true);

  const matches = vocabulary.findMatchesInText('需要识别这段文本', ['CET4', 'TOEFL'], {
    vocabularyMode: 'core',
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].level, 'CET4');
  assert.equal(matches[0].learningStatus, 'seen');

  const encountered = vocabulary.getEncounteredWords();
  assert.deepEqual(encountered.map((item) => item.level).sort(), ['CET4', 'TOEFL']);
  encountered.forEach((item) => {
    assert.equal(item.hitCount, 2);
  });
});

test('findMatchesInText: core 模式下没有 core 词条的等级应回退到 full', () => {
  // A publish build has no core rows at any level, and IELTS/TOEFL never carry
  // any. Without the fallback the shipped extension replaces nothing at all under
  // its default vocabularyMode.
  vocabulary.__setEntriesForTest([
    {
      word: 'movie',
      meaning: '电影',
      aliases: ['电影'],
      level: 'IELTS',
      coverageTier: 'full',
    },
  ]);

  const matches = vocabulary.findMatchesInText('我们去看电影吧', ['IELTS'], {
    vocabularyMode: 'core',
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].word, 'movie');
});

test('findMatchesInText: 只要选中的等级存在 core 词条就不回退到 full', () => {
  vocabulary.__setEntriesForTest([
    { word: 'movie', meaning: '电影', aliases: ['电影'], level: 'CET4', coverageTier: 'core' },
    { word: 'film', meaning: '电影', aliases: ['电影'], level: 'TOEFL', coverageTier: 'full' },
  ]);

  // CET4 carries a core row, so core mode stays strict even though TOEFL is
  // also selected.
  const matches = vocabulary.findMatchesInText('我们去看电影吧', ['CET4', 'TOEFL'], {
    vocabularyMode: 'core',
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].level, 'CET4');
});

test('findMatchesInText: 全量模式不受 core 过滤影响', () => {
  vocabulary.__setEntriesForTest([
    { word: 'movie', meaning: '电影', aliases: ['电影'], level: 'CET4', coverageTier: 'core' },
    { word: 'film', meaning: '电影', aliases: ['电影'], level: 'IELTS', coverageTier: 'full' },
  ]);

  const matches = vocabulary.findMatchesInText('我们去看电影吧', ['CET4', 'IELTS'], {
    vocabularyMode: 'full',
  });
  assert.equal(matches.length, 1);
  assert.ok(['movie', 'film'].includes(matches[0].word));
});

test('findMatchesInText: 不在匹配词表中的虚词不应被替换', () => {
  vocabulary.__setEntriesForTest([
    { word: 'one', meaning: '一个', aliases: ['一个'], level: 'CET4', coverageTier: 'core' },
    { word: 'together', meaning: '一起', aliases: ['一起'], level: 'CET4', coverageTier: 'core' },
    { word: 'fact', meaning: '其实', aliases: ['其实'], level: 'CET4', coverageTier: 'core' },
  ]);

  // isMatchableTerm rejects these before the index is built, so a stale or
  // hand-edited alias cannot reintroduce function-word swaps.
  const matches = vocabulary.findMatchesInText('其实我们一起去买一个吧', ['CET4'], {
    vocabularyMode: 'core',
  });
  assert.deepEqual(matches, []);
});
