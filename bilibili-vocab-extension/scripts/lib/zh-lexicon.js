'use strict';

// Build-time rules for turning CC-CEDICT entries into high-confidence
// Chinese→English replacement pairs.
//
// The previous approach accepted any English token appearing anywhere in a
// definition, which produced pairs such as 伯母 → address (from "polite form of
// address") and 一起 → case. A term now qualifies only when its own *first*
// gloss is exactly the English headword and both sides are nouns. Verb pairs are
// deliberately excluded: Chinese verb/noun ambiguity (服务 in 服务态度) needs
// contextual tagging that this pipeline does not have yet.

const STOPWORDS = new Set(
  (
    '关于 对于 至于 由于 为了 通过 根据 按照 随着 除了 经过 作为 成为 因为 所以 但是 而且 如果 虽然 ' +
    '然后 这样 那样 这里 那里 哪里 自己 大家 我们 你们 他们 她们 它们 别人 有人 什么 为什么 怎么样 ' +
    '一直 一定 可能 应该 需要 觉得 认为 希望 知道 喜欢 开始 发生 决定 解决 影响 变化 方式 时候 东西 ' +
    '事情 问题 一个 这个 那个 这些 那些 很多 一些 怎么 非常 完全 特别 真的 其实 已经 一起 旁边 可以 ' +
    '还是 就是 没有 不是 早点 实话 人们 之后 之前 之间 以上 以下 以及 或者 不过 只是 而是 还有 一样 ' +
    '时间 方面 地方 情况 部分 接下来 这种 那种 其中 以后 以前 现在 今天 明天 昨天 大概 主要 重要 ' +
    '怎样 如何 是不是 有没有 能不能 会不会 要不要 对不对 好的 接着 于是 因此 上下 左右 前后'
  )
    .split(/\s+/)
    .filter(Boolean)
);

const ADVERB_GLOSS =
  /^(very|really|together|completely|especially|already|quite|rather|extremely|always|often|sometimes|usually|still|also|only|just|even|never|again|soon|now|then|there|concerning|regarding|here|where|when)\b/;
const QUANTIFIER_GLOSS =
  /^(many|much|a lot|several|some|all|both|each|every|more|most|few|little|any|none)\b/;
// Glosses describing a relation or a stance rather than a concrete thing.
// "原来 → original" passes the noun gate because original is tagged "n / adj",
// yet 原来 works adverbially and the swap reads as broken Chinese.
const RELATIONAL_GLOSS =
  /^(original|former|previously|originally|own|same|such|this|that|other|another|certain|various|whole|entire|main|chief|major|minor)\b/;
const CLASSIFIER_GLOSS = /(^|\s)CL:/;
const TRAILING_PARENTHETICAL = /(\s*\([^()]*\))+\s*$/;

function isChineseTerm(term) {
  return /^[\u4e00-\u9fff]{2,4}$/.test(String(term || '').trim());
}

function isReplaceableTerm(term) {
  const text = String(term || '').trim();
  return isChineseTerm(text) && !STOPWORDS.has(text);
}

// Returns the English headword a gloss stands for, or '' when the gloss is a
// phrase, a proper noun, or a parenthetical explanation instead of a term.
function normalizeGlossText(rawGloss) {
  let text = splitPrimaryGloss(rawGloss);
  if (!text || CLASSIFIER_GLOSS.test(text)) {
    return '';
  }
  text = text.replace(TRAILING_PARENTHETICAL, '');
  if (/[()[\]{}]/.test(text)) {
    return '';
  }
  // CEDICT capitalizes proper nouns; a capitalized gloss is not a safe
  // common-word translation (多芬 → "Dove" must not yield dove).
  if (/^[A-Z]/.test(text) && !/^[A-Z]{2,}$/.test(text)) {
    return '';
  }
  text = text
    .toLowerCase()
    .replace(/^(a|an|the)\s+/, '')
    .trim();
  if (!text || /\s/.test(text) || !/^[a-z][a-z'-]*$/.test(text)) {
    return '';
  }
  return text;
}

// CEDICT separates *senses* with "/" and *synonymous renderings of one sense* with
// ";". So "movie; film" is one sense with two spellings, while "story line/plot"
// is two senses. Only the leading rendering of the leading sense is a safe
// translation, which is what this returns.
function splitPrimaryGloss(rawGloss) {
  const text = String(rawGloss || '').trim();
  if (!text) {
    return '';
  }
  const [firstRendering = ''] = text.split(';');
  return firstRendering.trim();
}

// Infers the part of speech of a Chinese term from its first gloss: "to X" is a
// verb, a bare word is a noun. Adverbs and quantifiers return '' because
// replacing them yields fragments such as "very（完全）" or "enough（很多）".
//
// `headwordPos` resolves the -ly ambiguity. A gloss can end in -ly and still be a
// noun (家族 → family, 地痞 → bully, 月报 → monthly), so when the caller already
// knows the English word is a noun the suffix no longer disqualifies it.
function classifyTerm(glosses, headwordPos) {
  const first = splitPrimaryGloss(Array.isArray(glosses) ? glosses[0] : '');
  if (!first) {
    return '';
  }
  const lower = first.toLowerCase();
  if (/^to\s+/.test(lower)) {
    return 'verb';
  }
  if (ADVERB_GLOSS.test(lower)) {
    return '';
  }
  if (QUANTIFIER_GLOSS.test(lower)) {
    return '';
  }
  if (RELATIONAL_GLOSS.test(lower)) {
    return '';
  }
  if (/ly$/.test(lower) && headwordPos !== 'noun') {
    return '';
  }
  return 'noun';
}

// ECDICT stores part of speech as a "n / vt / vi" slash list; the first token is
// the dominant reading.
function getPrimaryPos(partOfSpeech) {
  const [primary = ''] = String(partOfSpeech || '')
    .toLowerCase()
    .split('/');
  const token = primary.trim();
  if (token === 'noun' || token === 'n') {
    return 'noun';
  }
  if (token === 'verb' || token === 'v' || token === 'vt' || token === 'vi') {
    return 'verb';
  }
  return '';
}

module.exports = {
  STOPWORDS,
  classifyTerm,
  getPrimaryPos,
  isChineseTerm,
  isReplaceableTerm,
  normalizeGlossText,
  splitPrimaryGloss,
};
