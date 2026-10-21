#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const zlib = require('node:zlib');
const readline = require('node:readline');
const {
  classifyTerm,
  getPrimaryPos,
  isReplaceableTerm,
  normalizeGlossText,
} = require('./lib/zh-lexicon.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT_DIR = path.resolve(ROOT_DIR, '..');
const SOURCES_DIR = path.join(ROOT_DIR, 'sources');
const DATA_DIR = path.join(ROOT_DIR, 'data');
// Syllabus word lists are collected outside the extension project so the raw
// collection can be reviewed and licensed independently of the build inputs.
const SYLLABUS_DIR = path.join(REPO_ROOT_DIR, 'cet6-vocabulary', 'syllabus-2016');

const SOURCE_FILES = {
  ecdict: {
    file: path.join(SOURCES_DIR, 'ecdict.csv'),
    url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  },
  words: {
    file: path.join(SOURCES_DIR, 'words.csv'),
    url: 'https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv',
  },
  wordPos: {
    file: path.join(SOURCES_DIR, 'word_pos.csv'),
    url: 'https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv',
  },
  cedict: {
    file: path.join(SOURCES_DIR, 'cedict_ts.u8.gz'),
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  },
  kylebingCet4: {
    file: path.join(SOURCES_DIR, 'kylebing-cet4.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/3-CET4-%E9%A1%BA%E5%BA%8F.json',
  },
  kylebingCet6: {
    file: path.join(SOURCES_DIR, 'kylebing-cet6.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/4-CET6-%E9%A1%BA%E5%BA%8F.json',
  },
  kylebingKaoyan: {
    file: path.join(SOURCES_DIR, 'kylebing-kaoyan.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/5-%E8%80%83%E7%A0%94-%E9%A1%BA%E5%BA%8F.json',
  },
  netem: {
    file: path.join(SOURCES_DIR, 'netem_full_list.json'),
    url: 'https://raw.githubusercontent.com/exam-data/NETEMVocabulary/master/netem_full_list.json',
  },
  endictCet4: {
    file: path.join(SYLLABUS_DIR, 'cet4.json'),
    url: 'https://raw.githubusercontent.com/ismartcoding/endict/main/vocabulary/cet4.json',
  },
  endictCet6: {
    file: path.join(SYLLABUS_DIR, 'cet6.json'),
    url: 'https://raw.githubusercontent.com/ismartcoding/endict/main/vocabulary/cet6.json',
  },
};
const SOURCE_MANIFEST_DATE = '2026-10-18';
const SOURCE_MANIFEST = [
  {
    name: 'ECDICT',
    url: 'https://github.com/skywind3000/ECDICT',
    license: 'MIT',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: false,
    reviewAction: '',
    sourceIds: ['ecdict'],
    notes: '英汉词典，含 cet4/cet6/ielts/toefl/ky 标签。',
  },
  {
    name: 'Words-CEFR-Dataset',
    url: 'https://github.com/Maximax67/Words-CEFR-Dataset',
    license: 'MIT',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: false,
    reviewAction: '',
    sourceIds: ['words', 'wordPos'],
    notes: '按词与词性提供 CEFR 数值等级 (1-6)。',
  },
  {
    name: 'KyleBing/english-vocabulary',
    url: 'https://github.com/KyleBing/english-vocabulary',
    license: 'No explicit GitHub license metadata detected',
    licenseStatus: 'needs-review',
    redistributable: false,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: true,
    reviewAction:
      'Obtain explicit redistribution permission or remove derived entries before publishing.',
    sourceIds: ['kylebingCet4', 'kylebingCet6', 'kylebingKaoyan'],
    notes: '提供 CET4 / CET6 / 考研词表、中文释义与短语，用于构建 core 高频层。',
  },
  {
    name: 'exam-data/NETEMVocabulary',
    url: 'https://github.com/exam-data/NETEMVocabulary',
    license: 'NOASSERTION (GitHub API)',
    licenseStatus: 'needs-review',
    redistributable: false,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: true,
    reviewAction:
      'Verify upstream redistribution terms or remove NETEM-derived ranking fields before publishing.',
    sourceIds: ['netem'],
    notes: '提供考研词频排序，用于构建 KAOYAN 的 examFrequencyScore 与 examPriorityScore。',
  },
  {
    name: 'CET 考试大纲词表 via ismartcoding/endict',
    url: 'https://github.com/ismartcoding/endict',
    license: 'MIT',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: false,
    reviewAction: '',
    sourceIds: ['endictCet4', 'endictCet6'],
    notes:
      '《全国大学英语四、六级考试大纲（2016年修订版）》词表（四级 / 六级分列），用于考纲词目判定与考纲缺失词补齐。',
  },
  {
    name: 'CC-CEDICT',
    url: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    license: 'CC BY-SA 3.0 (MDBG 发布版本)',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: true,
    publishBlocking: false,
    reviewAction:
      'Preserve attribution and share-alike obligations when redistributing derived data.',
    sourceIds: ['cedict'],
    notes: '用于中文释义补充，需保留署名与同协议要求。',
  },
];
const POS_TOKEN_MAP = Object.freeze({
  a: 'adj',
  adjective: 'adj',
  adj: 'adj',
  ad: 'adv',
  adverb: 'adv',
  adv: 'adv',
  article: 'art',
  art: 'art',
  auxiliary: 'aux',
  aux: 'aux',
  abbreviation: 'abbr',
  abbr: 'abbr',
  conjunction: 'conj',
  conj: 'conj',
  interjection: 'int',
  int: 'int',
  noun: 'n',
  n: 'n',
  numeral: 'num',
  num: 'num',
  plural: 'pl',
  pl: 'pl',
  preposition: 'prep',
  prep: 'prep',
  pronoun: 'pron',
  pron: 'pron',
  verb: 'v',
  v: 'v',
  vi: 'vi',
  vt: 'vt',
});
const POS_OUTPUT_ORDER = [
  'n',
  'v',
  'vt',
  'vi',
  'adj',
  'adv',
  'prep',
  'pron',
  'num',
  'conj',
  'int',
  'aux',
  'abbr',
  'art',
  'pl',
];
const MANIFEST_FILE_NAME = 'sources.json';
// Human-readable attribution shipped inside the published package so the
// CC BY-SA / MIT attribution requirements travel with the data itself.
const ATTRIBUTION_FILE_NAME = 'ATTRIBUTION.md';

const LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
const EXAM_LEVELS = new Set(['CET4', 'CET6', 'KAOYAN']);
const BUILD_TARGETS = new Set(['development', 'publish']);
const LEVEL_FILE_MAP = {
  CET4: 'cet4.json',
  CET6: 'cet6.json',
  KAOYAN: 'kaoyan.json',
  IELTS: 'ielts.json',
  TOEFL: 'toefl.json',
};
const CEFR_LABEL_MAP = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
  6: 'C2',
};

const PUBLISH_BLOCKING_SOURCE_FLAGS = ['kylebing', 'netem'];

const DIRTY_DATA_PATTERNS = [/^FIXME$/i, /^\s*$/];

function isDirtyEntry(entry) {
  const word = String(entry.word || '');
  if (!word || /^\s*$/.test(word)) {
    return true;
  }
  for (let index = 0; index < DIRTY_DATA_PATTERNS.length; index += 1) {
    if (DIRTY_DATA_PATTERNS[index].test(word)) {
      return true;
    }
  }
  const meaning = String(entry.meaning || '');
  if (/FIXME/i.test(meaning)) {
    return true;
  }
  return false;
}

function filterDirtyEntries(grouped) {
  let filteredCount = 0;
  const cleaned = {};

  LEVELS.forEach((level) => {
    const entries = grouped[level] || [];
    const kept = [];
    entries.forEach((entry) => {
      if (isDirtyEntry(entry)) {
        filteredCount += 1;
      } else {
        kept.push(entry);
      }
    });
    cleaned[level] = kept;
  });

  if (filteredCount > 0) {
    console.log(`[filter] removed ${filteredCount} dirty entries`);
  }

  return cleaned;
}

function normalizeBuildTarget(rawValue = 'development') {
  const normalized = String(rawValue || 'development')
    .trim()
    .toLowerCase();
  if (!BUILD_TARGETS.has(normalized)) {
    throw new Error(`Unsupported build target: ${rawValue}`);
  }
  return normalized;
}

function readRequiredCliValue(optionName, value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return normalized;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    refresh: false,
    buildTarget: 'development',
    outputDir: DATA_DIR,
  };
  let rawBuildTarget = '';
  let publishSafe = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--refresh') {
      parsed.refresh = true;
      continue;
    }

    if (arg === '--publish-safe') {
      publishSafe = true;
      continue;
    }

    if (arg === '--build-target') {
      rawBuildTarget = readRequiredCliValue('--build-target', argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--build-target=')) {
      rawBuildTarget = readRequiredCliValue('--build-target', arg.slice('--build-target='.length));
      continue;
    }

    if (arg === '--output-dir') {
      parsed.outputDir = readRequiredCliValue('--output-dir', argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      parsed.outputDir = readRequiredCliValue('--output-dir', arg.slice('--output-dir='.length));
      continue;
    }

    throw new Error(`Unknown vocabulary dataset option: ${arg}`);
  }

  parsed.buildTarget = normalizeBuildTarget(
    publishSafe ? 'publish' : rawBuildTarget || 'development'
  );
  return parsed;
}

function shouldIncludePublishBlockingSources(buildTarget = 'development') {
  return normalizeBuildTarget(buildTarget) !== 'publish';
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function normalizeWord(rawWord) {
  const normalized = String(rawWord || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return '';
  }

  if (!/^[a-z][a-z0-9'_-]*$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ',') {
      fields.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  fields.push(current);
  return fields;
}

function splitMeaningParts(meaning) {
  return String(meaning || '')
    .split(/[;；,，、/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanMeaningPart(rawPart) {
  return String(rawPart || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[a-zA-Z][a-zA-Z.\s]{0,20}/, '')
    .replace(/^[^\u4e00-\u9fffA-Za-z]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractChineseMeaning(translation) {
  const source = String(translation || '')
    .replace(/\\n/g, '；')
    .replace(/\n/g, '；')
    .trim();
  if (!source || !hasChinese(source)) {
    return '';
  }

  const unique = [];
  splitMeaningParts(source).forEach((part) => {
    const cleaned = cleanMeaningPart(part);
    if (!cleaned || !hasChinese(cleaned) || unique.includes(cleaned)) {
      return;
    }
    unique.push(cleaned);
  });

  if (unique.length === 0) {
    return '';
  }

  return unique.slice(0, 4).join('；');
}

function extractLevelsByTag(rawTag) {
  const tagText = String(rawTag || '').toLowerCase();
  const tokens = tagText.split(/[|,;\s]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const levels = [];

  if (tokenSet.has('cet4')) {
    levels.push('CET4');
  }
  if (tokenSet.has('cet6')) {
    levels.push('CET6');
  }
  if (tokenSet.has('ky')) {
    levels.push('KAOYAN');
  }
  if (tokenSet.has('ielts')) {
    levels.push('IELTS');
  }
  if (tokenSet.has('toefl')) {
    levels.push('TOEFL');
  }

  return levels;
}

function rankToCefrLabel(rankValue) {
  const numericRank = Number(rankValue);
  if (!Number.isFinite(numericRank) || numericRank < 1 || numericRank > 6) {
    return '';
  }

  const normalizedRank = Math.max(1, Math.min(6, Math.round(numericRank)));
  return CEFR_LABEL_MAP[normalizedRank] || '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function splitDefinitionParts(value) {
  return String(value || '')
    .split(/[;；/]/)
    .map((part) => cleanMeaningPart(part))
    .filter((part) => Boolean(part));
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function hasPublishBlockingFlag(sourceFlags) {
  return uniq(sourceFlags).some((flag) => PUBLISH_BLOCKING_SOURCE_FLAGS.includes(flag));
}

function normalizePosToken(rawToken) {
  const normalized = String(rawToken || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '');
  return POS_TOKEN_MAP[normalized] || '';
}

function normalizePosTokens(tokens) {
  const normalized = uniq(tokens.map((token) => normalizePosToken(token)));
  if (normalized.includes('v') && (normalized.includes('vt') || normalized.includes('vi'))) {
    return normalized.filter((token) => token !== 'v');
  }
  return normalized.sort((left, right) => {
    const leftIndex = POS_OUTPUT_ORDER.indexOf(left);
    const rightIndex = POS_OUTPUT_ORDER.indexOf(right);
    if (leftIndex === -1 || rightIndex === -1) {
      return left.localeCompare(right);
    }
    return leftIndex - rightIndex;
  });
}

function formatPartOfSpeech(tokens) {
  return normalizePosTokens(tokens).join(' / ');
}

function trimLeadingLexicalNotes(value) {
  let nextValue = String(value || '').trim();
  let previousValue = '';
  while (nextValue && nextValue !== previousValue) {
    previousValue = nextValue;
    nextValue = nextValue
      .replace(/^\[[^\]]+\]\s*/u, '')
      .replace(/^\([^)]*\)\s*/u, '')
      .replace(/^（[^）]*）\s*/u, '');
  }
  return nextValue;
}

function parsePosTagString(rawValue) {
  const cleaned = trimLeadingLexicalNotes(rawValue).replace(/[+]/g, '&');
  if (!cleaned) {
    return [];
  }
  const rawTokens = cleaned.match(/[A-Za-z]{1,16}/g) || [];
  return normalizePosTokens(rawTokens);
}

function extractLeadingPosTokens(rawSection) {
  let remaining = trimLeadingLexicalNotes(rawSection);
  const tokens = [];

  while (remaining) {
    const tokenMatch = remaining.match(/^([A-Za-z]{1,16})/);
    if (!tokenMatch) {
      break;
    }

    const token = normalizePosToken(tokenMatch[1]);
    if (!token) {
      break;
    }

    const suffix = remaining[tokenMatch[1].length] || '';
    if (
      suffix &&
      suffix !== '.' &&
      suffix !== '&' &&
      suffix !== '/' &&
      suffix !== ',' &&
      !/\s/.test(suffix)
    ) {
      break;
    }

    tokens.push(token);
    remaining = remaining.slice(tokenMatch[1].length).replace(/^\./, '').trimStart();
    if (!remaining) {
      break;
    }

    const nextValue = remaining.replace(/^[&/,;；]+/, '').trimStart();
    if (nextValue === remaining && !/^[A-Za-z]/.test(nextValue)) {
      break;
    }
    remaining = nextValue;
  }

  return normalizePosTokens(tokens);
}

function extractDefinitionPosTokens(rawValue) {
  const sections = String(rawValue || '')
    .replace(/\\n/g, '\n')
    .split(/[\n;；]+/);
  const tokens = [];

  sections.forEach((section) => {
    tokens.push(...extractLeadingPosTokens(section));
  });

  return normalizePosTokens(tokens);
}

function mergePartOfSpeechValues(...values) {
  const tokens = [];
  values.forEach((value) => {
    if (!value) {
      return;
    }
    tokens.push(...parsePosTagString(String(value).replace(/\s*\/\s*/g, '&')));
  });
  return formatPartOfSpeech(tokens);
}

function getEntryPartOfSpeech(rawPosField, rawDefinition) {
  const tokens = [...parsePosTagString(rawPosField), ...extractDefinitionPosTokens(rawDefinition)];
  return formatPartOfSpeech(tokens);
}

function toSourceRelativePath(filePath) {
  // Sources may live in nested folders or outside the extension project (the CET
  // syllabus collection sits in cet6-vocabulary/ at the repo root), so record the
  // path relative to the extension project instead of flattening to the file name.
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function createSourceManifest(sourceFiles = SOURCE_FILES) {
  return {
    generatedAt: SOURCE_MANIFEST_DATE,
    sources: SOURCE_MANIFEST.map((source) => ({
      name: source.name,
      url: source.url,
      license: source.license,
      licenseStatus: source.licenseStatus,
      redistributable: source.redistributable,
      attributionRequired: source.attributionRequired,
      shareAlikeRequired: source.shareAlikeRequired,
      publishBlocking: source.publishBlocking,
      reviewAction: source.reviewAction,
      files: source.sourceIds.map((sourceId) => toSourceRelativePath(sourceFiles[sourceId].file)),
      notes: source.notes,
    })),
  };
}

function deriveCoverageTier(level, sourceFlags) {
  if (!EXAM_LEVELS.has(level)) {
    return 'full';
  }

  return hasPublishBlockingFlag(sourceFlags) ? 'core' : 'full';
}

function deriveExamPriorityScore(sourceFlags, phraseCount) {
  const normalizedFlags = uniq(sourceFlags);
  const normalizedPhraseCount = Math.max(0, Number(phraseCount) || 0);

  return (
    (normalizedFlags.includes('ecdict') ? 10 : 0) +
    (normalizedFlags.includes('kylebing') ? 35 : 0) +
    (normalizedFlags.includes('netem') ? 25 : 0) +
    Math.min(20, normalizedPhraseCount * 2)
  );
}

function readLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    reader.on('line', onLine);
    reader.on('close', resolve);
    reader.on('error', reject);
    stream.on('error', reject);
  });
}

function readGzipLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const unzip = zlib.createGunzip();
    const reader = readline.createInterface({
      input: fileStream.pipe(unzip),
      crlfDelay: Infinity,
    });

    reader.on('line', onLine);
    reader.on('close', resolve);
    reader.on('error', reject);
    fileStream.on('error', reject);
    unzip.on('error', reject);
  });
}

function requestToFile(url, destination, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Bilibili-Vocab-Builder/1.0',
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          requestToFile(res.headers.location, destination, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${url} status=${res.statusCode}`));
          res.resume();
          return;
        }

        const output = fs.createWriteStream(destination);
        res.pipe(output);
        output.on('finish', () => {
          output.close(resolve);
        });
        output.on('error', reject);
      }
    );

    req.on('error', reject);
  });
}

async function ensureSources(sourceFiles = SOURCE_FILES, options = {}) {
  ensureDirectory(SOURCES_DIR);
  const names = Object.keys(sourceFiles);
  for (let index = 0; index < names.length; index += 1) {
    const sourceName = names[index];
    const source = sourceFiles[sourceName];
    const shouldDownload = options.refresh === true || !fs.existsSync(source.file);
    if (!shouldDownload) {
      continue;
    }

    console.log(`[fetch] ${sourceName} <- ${source.url}`);
    await requestToFile(source.url, source.file);
  }
}

async function buildCefrMap(sourceFiles = SOURCE_FILES) {
  const wordIdToWord = new Map();
  let isFirstLine = true;

  await readLines(sourceFiles.words.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[0] || '').trim();
    const word = normalizeWord(columns[1]);
    if (!wordId || !word) {
      return;
    }
    wordIdToWord.set(wordId, word);
  });

  const cefrMap = new Map();
  isFirstLine = true;
  await readLines(sourceFiles.wordPos.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[1] || '').trim();
    const levelNumber = Number(columns[5] || 0);
    const frequency = Number(columns[4] || 0);
    if (!wordId || !Number.isFinite(levelNumber) || levelNumber < 1 || levelNumber > 6) {
      return;
    }

    const word = wordIdToWord.get(wordId);
    if (!word) {
      return;
    }

    const existing = cefrMap.get(word);
    if (!existing) {
      cefrMap.set(word, {
        cefrRank: levelNumber,
        cefrLevel: rankToCefrLabel(levelNumber),
        frequency: Number.isFinite(frequency) ? frequency : 0,
      });
      return;
    }

    const nextRank = Math.min(existing.cefrRank, levelNumber);
    const nextFrequency = Math.max(existing.frequency, Number.isFinite(frequency) ? frequency : 0);
    cefrMap.set(word, {
      cefrRank: nextRank,
      cefrLevel: rankToCefrLabel(nextRank),
      frequency: nextFrequency,
    });
  });

  return cefrMap;
}

function mapKyleBingLevelFile(level, filePath) {
  const raw = readJson(filePath);
  const records = Array.isArray(raw) ? raw : [];
  const mapped = new Map();
  const total = records.length || 1;

  records.forEach((item, index) => {
    const word = normalizeWord(item.word);
    if (!word) {
      return;
    }

    const translations = Array.isArray(item.translations) ? item.translations : [];
    const translationTexts = uniq(
      translations
        .map((translation) => extractChineseMeaning(translation.translation))
        .filter(Boolean)
    );
    const phraseItems = Array.isArray(item.phrases) ? item.phrases : [];
    const phraseTexts = uniq(
      phraseItems
        .map((phrase) => extractChineseMeaning(phrase.translation))
        .flatMap((meaning) => splitDefinitionParts(meaning))
    );
    const partOfSpeech = formatPartOfSpeech(
      translations.flatMap((translation) => parsePosTagString(translation.type))
    );
    const allMeanings = uniq([...translationTexts, ...phraseTexts]);
    const primaryMeaning = allMeanings[0] || '';

    mapped.set(word, {
      level,
      word,
      meaning: primaryMeaning,
      partOfSpeech,
      altMeanings: allMeanings.slice(1, 6),
      phraseCount: phraseItems.length,
      isPhraseBacked: phraseItems.length > 0,
      examFrequencyScore: Math.max(0, total - index),
      sourceFlags: ['kylebing'],
    });
  });

  return mapped;
}

function buildKyleBingMaps(sourceFiles = SOURCE_FILES) {
  return {
    CET4: mapKyleBingLevelFile('CET4', sourceFiles.kylebingCet4.file),
    CET6: mapKyleBingLevelFile('CET6', sourceFiles.kylebingCet6.file),
    KAOYAN: mapKyleBingLevelFile('KAOYAN', sourceFiles.kylebingKaoyan.file),
  };
}

function buildNetemMap(sourceFiles = SOURCE_FILES) {
  const payload = readJson(sourceFiles.netem.file);
  const rows = Array.isArray(payload['5530考研词汇词频排序表'])
    ? payload['5530考研词汇词频排序表']
    : [];
  const mapped = new Map();
  const total = rows.length || 1;

  rows.forEach((row, index) => {
    const word = normalizeWord(row['单词']);
    if (!word) {
      return;
    }

    const meaning = extractChineseMeaning(row['释义']);
    const aliases = uniq(
      splitDefinitionParts(row['其他拼写']).filter((item) => /[\u4e00-\u9fff]/.test(item))
    );
    mapped.set(word, {
      word,
      meaning,
      aliases,
      rank: Number(row['序号']) || index + 1,
      rawFrequency: Number(row['词频']) || 0,
      examFrequencyScore: Math.max(0, total - index),
      sourceFlags: ['netem'],
    });
  });

  return mapped;
}

// The syllabus files are the authoritative level membership for CET4/CET6: a word
// listed there belongs to that exam level even when ECDICT carries no matching tag.
function collectSyllabusLevels(level, filePath, syllabusMap) {
  const records = readJson(filePath);
  if (!Array.isArray(records)) {
    return syllabusMap;
  }

  records.forEach((item) => {
    const word = normalizeWord(item);
    if (!word) {
      return;
    }

    const levels = syllabusMap.get(word) || new Set();
    levels.add(level);
    syllabusMap.set(word, levels);
  });

  return syllabusMap;
}

function buildSyllabusMap(sourceFiles = SOURCE_FILES) {
  const syllabusMap = new Map();
  collectSyllabusLevels('CET4', sourceFiles.endictCet4.file, syllabusMap);
  collectSyllabusLevels('CET6', sourceFiles.endictCet6.file, syllabusMap);
  return syllabusMap;
}

function shouldReplaceEntry(existing, candidate) {
  if (!existing) {
    return true;
  }

  if ((candidate.frequency || 0) !== (existing.frequency || 0)) {
    return (candidate.frequency || 0) > (existing.frequency || 0);
  }

  return String(candidate.meaning || '').length > String(existing.meaning || '').length;
}

async function buildExamEntries(cefrMap, syllabusMap = new Map(), sourceFiles = SOURCE_FILES) {
  const entriesByKey = new Map();
  let isFirstLine = true;

  await readLines(sourceFiles.ecdict.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const word = normalizeWord(columns[0]);
    const taggedLevels = extractLevelsByTag(columns[7]);
    const syllabusLevels = syllabusMap.get(word);
    const levels = uniq([...taggedLevels, ...(syllabusLevels ? [...syllabusLevels] : [])]);
    if (!word || levels.length === 0) {
      return;
    }

    const meaning = extractChineseMeaning(columns[3]);
    if (!meaning) {
      return;
    }

    const cefrInfo = cefrMap.get(word) || {
      cefrRank: 0,
      cefrLevel: '',
      frequency: 0,
    };

    levels.forEach((level) => {
      const sourceFlags = ['ecdict'];
      if (syllabusLevels && syllabusLevels.has(level)) {
        sourceFlags.push('syllabus');
      }

      const candidate = {
        word,
        meaning,
        level,
        phonetic: String(columns[1] || '').trim(),
        partOfSpeech: getEntryPartOfSpeech(columns[4], columns[3]),
        definition: String(columns[3] || '').trim(),
        cefrLevel: cefrInfo.cefrLevel,
        cefrRank: cefrInfo.cefrRank || 0,
        frequency: Math.max(Number(columns[9] || 0), cefrInfo.frequency || 0),
        aliases: [],
        altMeanings: [],
        coverageTier: deriveCoverageTier(level, sourceFlags),
        sourceFlags,
        examFrequencyScore: 0,
        examPriorityScore: deriveExamPriorityScore(sourceFlags, 0),
        isPhraseBacked: false,
        phraseCount: 0,
      };

      const key = `${level}|${word}`;
      const existing = entriesByKey.get(key);
      if (shouldReplaceEntry(existing, candidate)) {
        entriesByKey.set(key, candidate);
      }
    });
  });

  return entriesByKey;
}

// Produces word → Chinese terms where the term is the English word's actual
// translation AND the term can be substituted in place. A term qualifies only
// when its own first gloss is exactly the headword and it is a noun phrase:
// replacing a verb or adverb Chinese term yields sentence fragments
// (放弃 → abandonment, 更多 → more). Incidental mentions such as
// 伯母 → address ("polite form of address") are rejected by the first-gloss rule.
async function buildCedictTermPairs(selectedWords, entriesByWord, sourceFiles = SOURCE_FILES) {
  const pairMap = new Map();
  // Chinese term → noun/verb/'' classification, reused to vet fallback terms.
  const termPos = new Map();
  // English word → every Chinese term that appears anywhere in its CEDICT glosses.
  // Used to verify fallback aliases taken from ECDICT's meaning text.
  const reverseGlossIndex = new Map();

  await readGzipLines(sourceFiles.cedict.file, (rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const match = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+\]\s+\/(.+)\/$/);
    if (!match) {
      return;
    }

    const simplified = String(match[2] || '').trim();
    if (!isReplaceableTerm(simplified)) {
      return;
    }

    const glosses = String(match[3] || '')
      .split('/')
      .filter(Boolean);
    if (glosses.length === 0) {
      return;
    }

    glosses.forEach((gloss) => {
      const tokens =
        String(gloss)
          .toLowerCase()
          .match(/[a-z][a-z'-]{2,}/g) || [];
      tokens.forEach((token) => {
        if (!selectedWords.has(token)) {
          return;
        }
        if (!reverseGlossIndex.has(token)) {
          reverseGlossIndex.set(token, new Set());
        }
        reverseGlossIndex.get(token).add(simplified);
      });
    });

    const headword = normalizeGlossText(glosses[0]);
    if (!headword || !selectedWords.has(headword)) {
      return;
    }

    // The English side must be a noun. Bare glosses classify as nouns, so
    // 精彩 → wonderful would otherwise pass and produce "非常wonderful".
    const entry = entriesByWord.get(headword);
    const headwordPos = entry ? getPrimaryPos(entry.partOfSpeech) : '';
    if (headwordPos !== 'noun') {
      return;
    }

    // Noun-only: a swapped noun still leaves a readable sentence, whereas verb
    // and adverb swaps need agreement Chinese does not have. The headword's part
    // of speech settles the -ly case (家族 → family, 月报 → monthly).
    const pos = classifyTerm(glosses, headwordPos);
    if (pos) {
      termPos.set(simplified, pos);
    }
    if (pos !== 'noun') {
      return;
    }

    if (!pairMap.has(headword)) {
      pairMap.set(headword, new Set());
    }
    const bucket = pairMap.get(headword);
    // Terms arrive in CEDICT file order, which is roughly by frequency, so the
    // first entries are the common renderings (项目 stays ahead of 名堂).
    if (bucket.size >= 5) {
      return;
    }
    bucket.add(simplified);
  });

  return { pairMap, termPos, reverseGlossIndex };
}

function mergeCedictAliases(entriesByKey, cedictPairs, termPos, reverseGlossIndex) {
  // Every level that carries the word gets the same terms, because the pair was
  // derived from the word rather than from a single level entry.
  entriesByKey.forEach((entry, key) => {
    const terms = cedictPairs.get(entry.word);
    if (terms && terms.size > 0) {
      // CEDICT order is file order, not frequency (item gives 名堂 before 项目).
      // ECDICT's `meaning` is ordered by how common the sense is, so terms it
      // mentions are promoted ahead of the rest.
      const meaning = String(entry.meaning || '');
      const ordered = Array.from(terms).sort((left, right) => {
        const leftRank = meaning.includes(left) ? 0 : 1;
        const rightRank = meaning.includes(right) ? 0 : 1;
        return leftRank - rightRank;
      });

      entriesByKey.set(key, {
        ...entry,
        aliases: ordered.slice(0, 5),
        sourceFlags: entry.sourceFlags.includes('cedict')
          ? entry.sourceFlags
          : [...entry.sourceFlags, 'cedict'],
      });
      return;
    }

    // No curated pair survived: fall back to the head of `meaning`. Both sides
    // must be nouns, and CEDICT must independently translate the English word
    // back to this term — without that check ~10% of fallbacks are wrong
    // (充足 → enough where enough is a determiner, 衣服 → clothes where the
    // Chinese term is a mass noun and the English one is plural).
    if (getPrimaryPos(entry.partOfSpeech) !== 'noun') {
      return;
    }
    const head = String(entry.meaning || '')
      .split(/[;；,，、/]/)
      .map((part) => part.trim())
      .find((part) => isReplaceableTerm(part));
    if (!head || termPos.get(head) !== 'noun') {
      return;
    }
    const glossTerms = reverseGlossIndex.get(entry.word);
    if (!glossTerms || !glossTerms.has(head)) {
      return;
    }

    entriesByKey.set(key, { ...entry, aliases: [head] });
  });
}

function mergeExamSourceFields(entry, supplement, level) {
  if (!supplement) {
    return entry;
  }

  const sourceFlags = uniq([...(entry.sourceFlags || []), ...(supplement.sourceFlags || [])]);
  const combinedMeanings = uniq([
    entry.meaning,
    ...(entry.altMeanings || []),
    supplement.meaning,
    ...(supplement.altMeanings || []),
  ]);
  const primaryMeaning = combinedMeanings[0] || entry.meaning;
  const altMeanings = combinedMeanings.slice(1, 6);
  const nextAliases = uniq([...(entry.aliases || []), ...(supplement.aliases || [])]).slice(0, 5);
  const nextPhraseCount = Math.max(entry.phraseCount || 0, supplement.phraseCount || 0);
  const nextExamFrequency = Math.max(
    entry.examFrequencyScore || 0,
    supplement.examFrequencyScore || 0
  );
  const nextPartOfSpeech = mergePartOfSpeechValues(entry.partOfSpeech, supplement.partOfSpeech);

  return {
    ...entry,
    meaning: primaryMeaning,
    translation: primaryMeaning,
    partOfSpeech: nextPartOfSpeech,
    altMeanings,
    aliases: nextAliases,
    sourceFlags,
    phraseCount: nextPhraseCount,
    isPhraseBacked: entry.isPhraseBacked === true || supplement.isPhraseBacked === true,
    examFrequencyScore: nextExamFrequency,
    examPriorityScore: deriveExamPriorityScore(sourceFlags, nextPhraseCount),
    coverageTier: deriveCoverageTier(level, sourceFlags),
  };
}

function mergeExamSources(entriesByKey, kylebingMaps, netemMap, cefrMap, options = {}) {
  const includePublishBlockingSources = options.includePublishBlockingSources !== false;

  entriesByKey.forEach((entry, key) => {
    let nextEntry = { ...entry };
    const kylebingEntry =
      includePublishBlockingSources && ['CET4', 'CET6', 'KAOYAN'].includes(entry.level)
        ? kylebingMaps[entry.level].get(entry.word)
        : null;
    nextEntry = mergeExamSourceFields(nextEntry, kylebingEntry, entry.level);

    if (includePublishBlockingSources && entry.level === 'KAOYAN') {
      const netemEntry = netemMap.get(entry.word);
      nextEntry = mergeExamSourceFields(nextEntry, netemEntry, entry.level);
    }

    entriesByKey.set(key, nextEntry);
  });

  ['CET4', 'CET6', 'KAOYAN'].forEach((level) => {
    if (!includePublishBlockingSources) {
      return;
    }

    kylebingMaps[level].forEach((supplement, word) => {
      const key = `${level}|${word}`;
      if (entriesByKey.has(key)) {
        return;
      }

      const cefrInfo = cefrMap.get(word) || {
        cefrRank: 0,
        cefrLevel: '',
        frequency: 0,
      };
      const sourceFlags = supplement.sourceFlags.slice();
      entriesByKey.set(key, {
        word,
        meaning: supplement.meaning,
        level,
        phonetic: '',
        partOfSpeech: supplement.partOfSpeech || '',
        definition: supplement.meaning,
        cefrLevel: cefrInfo.cefrLevel,
        cefrRank: cefrInfo.cefrRank || 0,
        frequency: cefrInfo.frequency || 0,
        aliases: [],
        altMeanings: supplement.altMeanings || [],
        coverageTier: deriveCoverageTier(level, sourceFlags),
        sourceFlags,
        examFrequencyScore: supplement.examFrequencyScore || 0,
        examPriorityScore: deriveExamPriorityScore(sourceFlags, supplement.phraseCount || 0),
        isPhraseBacked: supplement.isPhraseBacked === true,
        phraseCount: supplement.phraseCount || 0,
      });
    });
  });
}

function propagateSharedPartOfSpeech(entriesByKey) {
  const partOfSpeechByWord = new Map();

  entriesByKey.forEach((entry) => {
    if (!entry.partOfSpeech) {
      return;
    }
    partOfSpeechByWord.set(
      entry.word,
      mergePartOfSpeechValues(partOfSpeechByWord.get(entry.word), entry.partOfSpeech)
    );
  });

  entriesByKey.forEach((entry, key) => {
    if (entry.partOfSpeech) {
      return;
    }

    const inheritedPartOfSpeech = partOfSpeechByWord.get(entry.word);
    if (!inheritedPartOfSpeech) {
      return;
    }

    entriesByKey.set(key, {
      ...entry,
      partOfSpeech: inheritedPartOfSpeech,
    });
  });
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    if ((left.coverageTier || 'full') !== (right.coverageTier || 'full')) {
      return (left.coverageTier || 'full') === 'core' ? -1 : 1;
    }
    if ((right.examPriorityScore || 0) !== (left.examPriorityScore || 0)) {
      return (right.examPriorityScore || 0) - (left.examPriorityScore || 0);
    }
    if ((right.examFrequencyScore || 0) !== (left.examFrequencyScore || 0)) {
      return (right.examFrequencyScore || 0) - (left.examFrequencyScore || 0);
    }
    if ((right.frequency || 0) !== (left.frequency || 0)) {
      return (right.frequency || 0) - (left.frequency || 0);
    }
    if ((left.cefrRank || 0) !== (right.cefrRank || 0)) {
      const leftRank = left.cefrRank || 99;
      const rightRank = right.cefrRank || 99;
      return leftRank - rightRank;
    }
    return left.word.localeCompare(right.word);
  });
}

// Word lists ship inside the extension package, where the release gate measures raw
// (unpacked) size, so indentation costs budget without helping any consumer.
function writeJson(filePath, payload, options = {}) {
  const indent = options.pretty === true ? 2 : undefined;
  const json = `${JSON.stringify(payload, null, indent)}\n`;
  fs.writeFileSync(filePath, json, { encoding: 'utf8' });
}

function groupEntries(entriesByKey) {
  const grouped = {
    CET4: [],
    CET6: [],
    KAOYAN: [],
    IELTS: [],
    TOEFL: [],
  };

  entriesByKey.forEach((entry) => {
    grouped[entry.level].push({
      word: entry.word,
      meaning: entry.meaning,
      level: entry.level,
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      definition: entry.definition,
      cefrLevel: entry.cefrLevel,
      cefrRank: entry.cefrRank,
      frequency: entry.frequency,
      aliases: entry.aliases,
      coverageTier: entry.coverageTier,
      sourceFlags: entry.sourceFlags,
      altMeanings: entry.altMeanings,
      examFrequencyScore: entry.examFrequencyScore,
      examPriorityScore: entry.examPriorityScore,
      isPhraseBacked: entry.isPhraseBacked,
      phraseCount: entry.phraseCount,
    });
  });

  LEVELS.forEach((level) => {
    grouped[level] = sortEntries(grouped[level]);
  });

  return grouped;
}

function printSummary(grouped) {
  console.log('[summary] Generated entries:');
  LEVELS.forEach((level) => {
    const coreCount = grouped[level].filter((entry) => entry.coverageTier === 'core').length;
    console.log(`  - ${level}: ${grouped[level].length} (core=${coreCount})`);
  });
}

function writeDatasetFiles(dataDir, grouped, manifest) {
  ensureDirectory(dataDir);
  LEVELS.forEach((level) => {
    const fileName = LEVEL_FILE_MAP[level];
    writeJson(path.join(dataDir, fileName), grouped[level]);
  });
  writeJson(path.join(dataDir, MANIFEST_FILE_NAME), manifest, { pretty: true });
  writeAttributionFile(dataDir);
}

const ATTRIBUTION_TEXT = `# 词库数据来源与许可证

本扩展随附的词库数据（data/ 目录）由以下公开数据源构建。机器可读的来源清单见同目录的 sources.json，完整说明见仓库 docs/词库来源与许可证.md。

- ECDICT — https://github.com/skywind3000/ECDICT （MIT 许可证）：英汉词典，含 CET4/CET6/IELTS/TOEFL/考研标签。
- Words-CEFR-Dataset — https://github.com/Maximax67/Words-CEFR-Dataset （MIT 许可证）：按词与词性提供 CEFR 等级标注（1-6）。
- CET 考试大纲词表（2016 年修订版，经 ismartcoding/endict 整理） — https://github.com/ismartcoding/endict （MIT 许可证）：四/六级考纲词目与派生词清单，标记 syllabus 来源并补齐考纲缺失词。
- CC-CEDICT — https://www.mdbg.net/chinese/dictionary?page=cc-cedict （CC BY-SA 3.0，MDBG 发布版本）：中文释义补充，按许可要求保留署名与相同方式共享。

发布包中的 data/ 目录为 publish-safe 数据集，不包含 KyleBing/english-vocabulary、exam-data/NETEMVocabulary 等未确认许可来源的派生数据。
`;

function writeAttributionFile(dataDir) {
  ensureDirectory(dataDir);
  fs.writeFileSync(path.join(dataDir, ATTRIBUTION_FILE_NAME), ATTRIBUTION_TEXT, 'utf8');
}

function listPublishedDataFileNames() {
  return [
    ...LEVELS.map((level) => LEVEL_FILE_MAP[level]),
    MANIFEST_FILE_NAME,
    ATTRIBUTION_FILE_NAME,
  ];
}

async function buildVocabularyDataset(options = {}) {
  const sourceFiles = options.sourceFiles || SOURCE_FILES;
  const dataDir = options.dataDir || DATA_DIR;
  const shouldEnsureSources = options.ensureSources !== false;
  const buildTarget = normalizeBuildTarget(options.buildTarget || 'development');
  const refresh = options.refresh === true;
  const includePublishBlockingSources = shouldIncludePublishBlockingSources(buildTarget);

  if (shouldEnsureSources) {
    await ensureSources(sourceFiles, { refresh });
  }

  const cefrMap = await buildCefrMap(sourceFiles);
  const syllabusMap = buildSyllabusMap(sourceFiles);
  const entriesByKey = await buildExamEntries(cefrMap, syllabusMap, sourceFiles);
  const kylebingMaps = buildKyleBingMaps(sourceFiles);
  const netemMap = buildNetemMap(sourceFiles);
  mergeExamSources(entriesByKey, kylebingMaps, netemMap, cefrMap, {
    includePublishBlockingSources,
  });

  // Part of speech drives the CEDICT pairing rules, so it must be resolved
  // across every level before pairs are derived.
  propagateSharedPartOfSpeech(entriesByKey);

  const selectedWords = new Set(Array.from(entriesByKey.values()).map((entry) => entry.word));
  const entriesByWord = new Map();
  entriesByKey.forEach((entry) => {
    const existing = entriesByWord.get(entry.word);
    if (!existing || (existing.coverageTier !== 'core' && entry.coverageTier === 'core')) {
      entriesByWord.set(entry.word, entry);
    }
  });
  const {
    pairMap: cedictPairs,
    termPos,
    reverseGlossIndex,
  } = await buildCedictTermPairs(selectedWords, entriesByWord, sourceFiles);
  mergeCedictAliases(entriesByKey, cedictPairs, termPos, reverseGlossIndex);

  const grouped = groupEntries(entriesByKey);
  const filteredGrouped = filterDirtyEntries(grouped);
  const manifest = createSourceManifest(sourceFiles);

  if (options.writeFiles !== false) {
    writeDatasetFiles(dataDir, filteredGrouped, manifest);
  }

  return {
    buildTarget,
    grouped: filteredGrouped,
    manifest,
  };
}

async function main() {
  const { buildTarget, outputDir, refresh } = parseCliArgs();
  console.log('[build] loading vocabulary sources...');
  const { grouped } = await buildVocabularyDataset({
    buildTarget,
    dataDir: outputDir,
    refresh,
  });
  printSummary(grouped);
  console.log(`[done] data files updated in ${outputDir} (target=${buildTarget})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[error]', error);
    process.exitCode = 1;
  });
}

module.exports = {
  ATTRIBUTION_FILE_NAME,
  buildVocabularyDataset,
  createSourceManifest,
  hasPublishBlockingFlag,
  listPublishedDataFileNames,
  normalizeBuildTarget,
  parseCliArgs,
  shouldIncludePublishBlockingSources,
  writeAttributionFile,
};
