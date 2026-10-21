const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  classifyTerm,
  getPrimaryPos,
  isReplaceableTerm,
  normalizeGlossText,
  splitPrimaryGloss,
} = require(path.join(__dirname, '..', 'scripts', 'lib', 'zh-lexicon.js'));

test('zh-lexicon: 首义项只取分号前的第一个说法', () => {
  // CEDICT separates senses with "/" and synonymous renderings with ";", so a
  // "movie; film" headword is one sense whose first rendering is movie.
  assert.equal(splitPrimaryGloss('movie; film'), 'movie');
  assert.equal(splitPrimaryGloss('  address  '), 'address');
  assert.equal(splitPrimaryGloss(''), '');
});

test('zh-lexicon: 含分号的首义项应能解析出英文词条', () => {
  // Dropping every gloss containing ";" lost 9948 entries outright, including
  // 电影 → movie and 家庭 → family.
  assert.equal(normalizeGlossText('movie; film'), 'movie');
  assert.equal(normalizeGlossText('family; household'), 'family');
  assert.equal(normalizeGlossText('speed; rate; velocity'), 'speed');
});

test('zh-lexicon: 短语、专有名词与括注解释不应成为词条', () => {
  assert.equal(normalizeGlossText('polite form of address'), '');
  assert.equal(normalizeGlossText('Dove'), '');
  assert.equal(normalizeGlossText('(coll.) A-list'), '');
  assert.equal(normalizeGlossText('CL:個|个[ge4]'), '');
});

test('zh-lexicon: 动词与副词不应被判为名词', () => {
  assert.equal(classifyTerm(['to complete; to accomplish']), 'verb');
  assert.equal(classifyTerm(['very; really']), '');
  assert.equal(classifyTerm(['quickly']), '');
  assert.equal(classifyTerm(['many']), '');
});

test('zh-lexicon: 以 -ly 结尾的名词应在已知词性时保留', () => {
  // A bare "ly$" check rejected family, bully, jelly, monthly and 49 other real
  // noun pairs.
  assert.equal(classifyTerm(['family'], 'noun'), 'noun');
  assert.equal(classifyTerm(['bully'], 'noun'), 'noun');
  assert.equal(classifyTerm(['monthly'], 'noun'), 'noun');
  // Without the hint the suffix still disqualifies, which is the safe default.
  assert.equal(classifyTerm(['family']), '');
});

test('zh-lexicon: 关系类释义不应生成名词配对', () => {
  // 原来 → original passed the noun gate (original is tagged "n / adj") yet 原来
  // is adverbial, so the swap produced "他放弃了original的计划".
  assert.equal(classifyTerm(['original; former'], 'noun'), '');
  assert.equal(classifyTerm(['other']), '');
});

test('zh-lexicon: 只接受 2-4 字且非虚词的中文词条', () => {
  assert.equal(isReplaceableTerm('电影院'), true);
  assert.equal(isReplaceableTerm('的'), false);
  assert.equal(isReplaceableTerm('一起'), false);
  assert.equal(isReplaceableTerm('一个'), false);
  assert.equal(isReplaceableTerm('ABCD'), false);
});

test('zh-lexicon: 英文词性应取斜杠列表的首项', () => {
  assert.equal(getPrimaryPos('n / vt / vi'), 'noun');
  assert.equal(getPrimaryPos('vt / n'), 'verb');
  assert.equal(getPrimaryPos('adj'), '');
  assert.equal(getPrimaryPos(''), '');
});
