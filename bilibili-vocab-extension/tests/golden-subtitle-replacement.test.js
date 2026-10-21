const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vocabularyPure = require('../vocabulary-pure.js');
const vocabulary = require('../vocabulary.js');

const ROOT = path.join(__dirname, '..');
const LEVEL_FILES = ['cet4.json', 'cet6.json', 'kaoyan.json', 'ielts.json', 'toefl.json'];

// Golden set of subtitle lines with the replacement that must be produced. Values
// are lists because several English words are equally correct for one Chinese
// term; the assertion is that the chosen word is among them.
// expected === null means the line must stay untouched: either nothing in it is a
// safe noun substitution, or the correct word is only reachable through a sense
// the lexicon cannot disambiguate, so skipping is better than guessing.
const GOLDEN_CASES = [
  { text: '我家的地址在城市的中心，旁边有一个很大的公园。', expected: { 地址: ['address'] } },
  { text: '这个问题的经济影响非常大，我们需要仔细分析。', expected: { 经济: ['economy'] } },
  { text: '他放弃了原来的计划，决定重新开始。', expected: { 计划: ['plan'] } },
  { text: '今天的天气很好，我们一起去公园散步吧。', expected: { 公园: ['park'] } },
  { text: '政府应该采取措施解决环境污染的问题。', expected: { 措施: ['measure'] } },
  { text: '我喜欢在周末的时候看书和听音乐。', expected: { 周末: ['weekend'] } },
  { text: '随着科技的发展，人们的生活方式发生了很大的变化。', expected: { 发展: ['development'] } },
  { text: '伯母今天来我家做客，带了很多水果。', expected: { 水果: ['fruit'] } },
  { text: '经济损失已经超过了预期，专家们正在讨论应对方案。', expected: { 损失: ['loss'] } },
  { text: '这个视频真的很有意思，希望大家喜欢。', expected: { 视频: ['video'] } },
  { text: '这家餐厅的服务态度特别好。', expected: { 态度: ['manner', 'attitude'] } },
  {
    text: '他用自己的经历告诉我们坚持的重要性。',
    expected: { 重要性: ['importance', 'significance'] },
  },
  { text: '我们需要更多的时间来完成这个项目。', expected: { 项目: ['item', 'project'] } },
  { text: '这部电影讲述了一个关于爱情和家庭的故事。', expected: { 电影: ['movie', 'film'] } },
  { text: '他说话的速度太快了，我完全听不懂。', expected: { 速度: ['speed', 'rate'] } },
  { text: '很多人认为读书可以改变命运。', expected: { 命运: ['fate', 'destiny'] } },
  // Function words and adverbials must never be swapped, even though CEDICT
  // glosses them with words that also happen to be nouns or adjectives.
  { text: '他一个人住在北京。', expected: null },
  { text: '我们下期再见，记得点赞投币收藏。', expected: null },
  { text: '说实话，我一开始也不太相信。', expected: null },
  { text: '其实我觉得这个事情没有那么简单。', expected: null },
];

// Pairs that used to be produced by matching any English word mentioned in a
// CEDICT definition, plus ones caught while reviewing the rewritten rules.
// Each entry is a regression guard for a specific rule.
const FORBIDDEN_PAIRS = [
  { text: '伯母今天来我家做客。', chinese: '伯母', word: 'address' },
  { text: '我们一起去公园吧。', chinese: '一起', word: 'case' },
  { text: '孩子们在公园里玩得很开心。', chinese: '孩子', word: 'child' },
  { text: '其实我觉得这个事情没有那么简单。', chinese: '其实', word: 'fact' },
  { text: '很多人认为读书可以改变命运。', chinese: '很多', word: 'enough' },
  { text: '他说话的速度太快了。', chinese: '速度', word: 'tempo' },
  // "原来" is adverbial here; mapping it to original (tagged n/adj) reads broken.
  { text: '他放弃了原来的计划。', chinese: '原来', word: 'original' },
  // CEDICT joins synonyms with ";" — splitting them must not resurrect the old
  // anywhere-in-the-definition behaviour.
  { text: '我们需要更多的时间来完成这个项目。', chinese: '项目', word: 'entry' },
];

const previousChrome = global.chrome;

let entries = [];

function loadEntries() {
  if (entries.length) {
    return entries;
  }
  const rows = LEVEL_FILES.flatMap((fileName) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data', fileName), 'utf8'))
  );
  entries = rows.map((entry) => vocabularyPure.normalizeEntry(entry, entry.level));
  return entries;
}

// Runs the real matcher over the shipped dataset with the extension defaults.
function match(text) {
  vocabulary.__setEntriesForTest(loadEntries());
  return vocabulary
    .findMatchesInText(text, vocabularyPure.DEFAULT_ACTIVE_LEVELS, { vocabularyMode: 'core' })
    .map((item) => ({ chinese: item.chinese, word: item.word }));
}

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

test('golden: 日常字幕的替换结果应与标注一致', () => {
  const failures = [];

  GOLDEN_CASES.forEach(({ text, expected }) => {
    const actual = match(text);
    const actualPairs = Object.fromEntries(actual.map((item) => [item.chinese, item.word]));

    if (expected === null) {
      if (actual.length > 0) {
        failures.push(`${text}\n  期望不替换，实际 ${JSON.stringify(actualPairs)}`);
      }
      return;
    }

    Object.entries(expected).forEach(([chinese, words]) => {
      const actualWord = actualPairs[chinese];
      if (!words.includes(actualWord)) {
        failures.push(
          `${text}\n  ${chinese} 期望 ${words.join('/')}，实际 ${actualWord || '未替换'}`
        );
      }
    });
  });

  assert.deepEqual(failures, [], `黄金集不通过:\n${failures.join('\n')}`);
});

test('golden: 词义不相关的历史错误配对不应再出现', () => {
  const failures = [];

  FORBIDDEN_PAIRS.forEach(({ text, chinese, word }) => {
    const hit = match(text).find((item) => item.chinese === chinese && item.word === word);
    if (hit) {
      failures.push(`${text}\n  不应再出现 ${chinese} → ${word}`);
    }
  });

  assert.deepEqual(failures, [], `历史错误配对回归:\n${failures.join('\n')}`);
});

test('golden: 替换片段不得跨词边界或切断复合词', () => {
  // 电影院 must be matched as a whole (cinema/pictures) or skipped, never as
  // 电影 + 院, which rendered "film院".
  const cinema = match('我们一起去电影院吧');
  assert.ok(
    cinema.every((item) => item.chinese !== '电影'),
    `电影院被拆成电影替换: ${JSON.stringify(cinema)}`
  );

  // 孩子们 must not become child + 们.
  const children = match('孩子们在公园里玩得很开心');
  assert.ok(
    children.every((item) => item.chinese !== '孩子'),
    `孩子们被当作孩子替换: ${JSON.stringify(children)}`
  );
});

test('golden: 匹配位置应准确覆盖原文片段', () => {
  vocabulary.__setEntriesForTest(loadEntries());
  const text = '我家的地址在城市的中心，旁边有一个很大的公园。';
  const matches = vocabulary.findMatchesInText(text, vocabularyPure.DEFAULT_ACTIVE_LEVELS, {
    vocabularyMode: 'core',
  });

  assert.ok(matches.length > 0, '该句应至少命中一个替换词');
  matches.forEach((item) => {
    assert.equal(
      text.slice(item.start, item.end),
      item.chinese,
      `匹配区间 [${item.start},${item.end}) 与原文不一致`
    );
  });
});
