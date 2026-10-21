const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildVocabularyDataset,
  hasPublishBlockingFlag,
  listPublishedDataFileNames,
  parseCliArgs,
} = require('../scripts/build-vocab-dataset.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEVELS = ['cet4', 'cet6', 'kaoyan', 'ielts', 'toefl'];
const SNAPSHOT_FILES = listPublishedDataFileNames();
const MIN_ENTRIES_BY_LEVEL = {
  cet4: 500,
  cet6: 500,
  kaoyan: 500,
  ielts: 1000,
  toefl: 1000,
};
const EXAM_LEVELS = new Set(['cet4', 'cet6', 'kaoyan']);
const CEFR_LABELS = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
  6: 'C2',
};
const PART_OF_SPEECH_PATTERN =
  /^(?:abbr|adj|adv|art|aux|conj|int|n|num|pl|prep|pron|v|vi|vt)(?: \/ (?:abbr|adj|adv|art|aux|conj|int|n|num|pl|prep|pron|v|vi|vt))*$/;
const UTF8_BOM = '\uFEFF';
const SOURCE_LICENSE_STATUSES = new Set(['verified', 'needs-review', 'removed']);

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-dataset-'));
}

function readRawDataFile(fileName) {
  return fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8');
}

function readRawLevel(level) {
  return readRawDataFile(`${level}.json`);
}

function readJsonFile(fileName) {
  const raw = readRawDataFile(fileName);
  const cleaned = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
  return JSON.parse(cleaned);
}

function readLevel(level) {
  return readJsonFile(`${level}.json`);
}

function readSourceManifest() {
  return readJsonFile('sources.json');
}

const SYLLABUS_FILE_BY_LEVEL = {
  cet4: '../cet6-vocabulary/syllabus-2016/cet4.json',
  cet6: '../cet6-vocabulary/syllabus-2016/cet6.json',
};

function readSyllabusWords(level) {
  const filePath = path.resolve(__dirname, '..', SYLLABUS_FILE_BY_LEVEL[level]);
  const words = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Set(
    words.map((word) =>
      String(word || '')
        .trim()
        .toLowerCase()
    )
  );
}

function collectUncoveredSyllabusWords(entries, syllabusWords) {
  const known = new Set(entries.map((entry) => entry.word));
  return Array.from(syllabusWords).filter((word) => !known.has(word));
}

function assertSyllabusCoverage(entries, level, syllabusWords) {
  collectUncoveredSyllabusWords(entries, syllabusWords).forEach((word) => {
    // 分词器只匹配单词 token，考纲中的多词短语不进入单词级词库
    assert.ok(word.includes(' '), `${level} 考纲词未收录: ${word}`);
  });
}

function hasCuratedExamSignal(entry) {
  return entry.sourceFlags.includes('kylebing') || entry.sourceFlags.includes('netem');
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function expectedCoverageTier(level, entry) {
  if (!EXAM_LEVELS.has(level)) {
    return 'full';
  }

  return hasCuratedExamSignal(entry) ? 'core' : 'full';
}

function expectedExamPriorityScore(entry) {
  return (
    (entry.sourceFlags.includes('ecdict') ? 10 : 0) +
    (entry.sourceFlags.includes('kylebing') ? 35 : 0) +
    (entry.sourceFlags.includes('netem') ? 25 : 0) +
    Math.min(20, Math.max(0, Number(entry.phraseCount) || 0) * 2)
  );
}

function expectedCefrLevel(rank) {
  const numericRank = Number(rank);
  if (!Number.isFinite(numericRank) || numericRank < 1 || numericRank > 6) {
    return '';
  }

  return CEFR_LABELS[Math.max(1, Math.min(6, Math.round(numericRank)))] || '';
}

test('开源词库导入后，各等级数据量应达到可用规模', () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    assert.ok(
      entries.length >= MIN_ENTRIES_BY_LEVEL[level],
      `${level} 词条数量过少: ${entries.length}`
    );
  });
});

test('开源词库词条字段完整性', () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    entries.forEach((entry, index) => {
      assert.ok(entry.word && typeof entry.word === 'string', `${level}[${index}] 缺少 word`);
      assert.ok(
        entry.meaning && typeof entry.meaning === 'string',
        `${level}[${index}] 缺少 meaning`
      );
      assert.equal(entry.word, entry.word.toLowerCase(), `${level}[${index}] word 未归一化`);
      assert.equal(entry.level.toUpperCase(), level.toUpperCase(), `${level}[${index}] level 错误`);
      assert.ok(typeof entry.cefrLevel === 'string', `${level}[${index}] cefrLevel 类型错误`);
      assert.ok(Number.isFinite(entry.cefrRank), `${level}[${index}] cefrRank 类型错误`);
      assert.ok(entry.cefrRank >= 0 && entry.cefrRank <= 6, `${level}[${index}] cefrRank 超出范围`);
      assert.equal(
        entry.cefrLevel,
        expectedCefrLevel(entry.cefrRank),
        `${level}[${index}] cefrLevel 与 cefrRank 不一致`
      );
      assert.ok(typeof entry.frequency === 'number', `${level}[${index}] frequency 类型错误`);
      assert.ok(Array.isArray(entry.aliases), `${level}[${index}] aliases 类型错误`);
      assert.ok(
        ['core', 'full'].includes(entry.coverageTier),
        `${level}[${index}] coverageTier 非法`
      );
      assert.ok(Array.isArray(entry.sourceFlags), `${level}[${index}] sourceFlags 类型错误`);
      assert.ok(
        typeof entry.examPriorityScore === 'number',
        `${level}[${index}] examPriorityScore 类型错误`
      );
      assert.ok(
        typeof entry.examFrequencyScore === 'number',
        `${level}[${index}] examFrequencyScore 类型错误`
      );
      assert.ok(Array.isArray(entry.altMeanings), `${level}[${index}] altMeanings 类型错误`);
    });
  });
});

test('考试词库的 coverageTier 应只由等级和 curated source 决定', () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    entries.forEach((entry, index) => {
      assert.equal(
        entry.coverageTier,
        expectedCoverageTier(level, entry),
        `${level}[${index}] coverageTier 与 sourceFlags/level 不一致`
      );
    });
  });
});

test('考试词条优先级分数应与 sourceFlags 和 phraseCount 契约一致', () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    entries.forEach((entry, index) => {
      assert.equal(
        entry.examPriorityScore,
        expectedExamPriorityScore(entry),
        `${level}[${index}] examPriorityScore 计算错误`
      );
    });
  });
});

test('考试词库应包含可用规模的核心高频层', () => {
  ['cet4', 'cet6', 'kaoyan'].forEach((level) => {
    const entries = readLevel(level);
    const coreCount = entries.filter((entry) => entry.coverageTier === 'core').length;
    assert.ok(coreCount >= 1000, `${level} core 词条数量过少: ${coreCount}`);
  });
});

test('partOfSpeech 应保持高覆盖率且只输出受支持的规范标签', () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    const filledEntries = entries.filter(
      (entry) => typeof entry.partOfSpeech === 'string' && entry.partOfSpeech
    );

    assert.ok(
      filledEntries.length >= Math.floor(entries.length * 0.95),
      `${level} partOfSpeech 覆盖率过低: ${filledEntries.length}/${entries.length}`
    );

    filledEntries.forEach((entry, index) => {
      assert.match(
        entry.partOfSpeech,
        PART_OF_SPEECH_PATTERN,
        `${level}[${index}] partOfSpeech 包含非规范标签: ${entry.partOfSpeech}`
      );
    });
  });
});

test('sources.json 应列出真实输入文件并保持可追溯', () => {
  const manifest = readSourceManifest();

  assert.equal(manifest.generatedAt, '2026-10-18');
  assert.equal(Array.isArray(manifest.sources), true);
  assert.ok(manifest.sources.length >= 5);

  manifest.sources.forEach((source, index) => {
    assert.equal(typeof source.name, 'string', `sources[${index}] name 类型错误`);
    assert.equal(typeof source.url, 'string', `sources[${index}] url 类型错误`);
    assert.equal(typeof source.license, 'string', `sources[${index}] license 类型错误`);
    assert.equal(
      SOURCE_LICENSE_STATUSES.has(source.licenseStatus),
      true,
      `sources[${index}] licenseStatus 非法`
    );
    assert.equal(
      typeof source.redistributable,
      'boolean',
      `sources[${index}] redistributable 类型错误`
    );
    assert.equal(
      typeof source.attributionRequired,
      'boolean',
      `sources[${index}] attributionRequired 类型错误`
    );
    assert.equal(
      typeof source.shareAlikeRequired,
      'boolean',
      `sources[${index}] shareAlikeRequired 类型错误`
    );
    assert.equal(
      typeof source.publishBlocking,
      'boolean',
      `sources[${index}] publishBlocking 类型错误`
    );
    assert.equal(typeof source.reviewAction, 'string', `sources[${index}] reviewAction 类型错误`);
    assert.equal(Array.isArray(source.files), true, `sources[${index}] files 类型错误`);
    assert.ok(source.files.length > 0, `sources[${index}] files 为空`);
    source.files.forEach((file) => {
      assert.equal(typeof file, 'string');
      // 路径以插件项目目录为基准：sources/ 下为构建输入，../ 前缀指向仓库根目录的收集目录
      assert.equal(file.startsWith('sources/') || file.startsWith('../'), true);
      const sourcePath = path.resolve(__dirname, '..', file);
      assert.equal(fs.existsSync(sourcePath), true, `${file} 不存在`);
    });
  });
});

test('sources.json 应机器标记许可证发布阻断来源', () => {
  const manifest = readSourceManifest();
  const sources = manifest.sources;
  const blockingSources = sources.filter((source) => source.publishBlocking === true);

  assert.deepEqual(
    blockingSources.map((source) => source.name).sort(),
    ['KyleBing/english-vocabulary', 'exam-data/NETEMVocabulary'].sort()
  );

  sources.forEach((source) => {
    if (source.licenseStatus === 'verified') {
      assert.equal(source.redistributable, true, `${source.name} verified source 应可再分发`);
      assert.equal(source.publishBlocking, false, `${source.name} verified source 不应阻断发布`);
      return;
    }

    assert.equal(source.licenseStatus, 'needs-review', `${source.name} 应显式标为 needs-review`);
    assert.equal(source.redistributable, false, `${source.name} needs-review 不应标为可再分发`);
    assert.equal(source.publishBlocking, true, `${source.name} needs-review 应阻断发布`);
    assert.notEqual(source.reviewAction.trim(), '', `${source.name} 缺少审核动作`);
  });
});

test('CET 考纲词表来源应在 sources.json 中登记为可再分发', () => {
  const manifest = readSourceManifest();
  const syllabusSource = manifest.sources.find((source) =>
    source.name.includes('CET 考试大纲词表')
  );

  assert.ok(syllabusSource, 'sources.json 缺少考纲词表来源');
  assert.equal(syllabusSource.license, 'MIT');
  assert.equal(syllabusSource.licenseStatus, 'verified');
  assert.equal(syllabusSource.redistributable, true);
  assert.equal(syllabusSource.publishBlocking, false);
  assert.deepEqual(syllabusSource.files, [
    '../cet6-vocabulary/syllabus-2016/cet4.json',
    '../cet6-vocabulary/syllabus-2016/cet6.json',
  ]);
});

test('CET4/CET6 词库应完整覆盖考纲词表并标注 syllabus 来源', () => {
  Object.keys(SYLLABUS_FILE_BY_LEVEL).forEach((level) => {
    const entries = readLevel(level);
    const syllabusWords = readSyllabusWords(level);

    assertSyllabusCoverage(entries, level, syllabusWords);

    const entriesByWord = new Map(entries.map((entry) => [entry.word, entry]));
    syllabusWords.forEach((word) => {
      const entry = entriesByWord.get(word);
      if (!entry) {
        return;
      }
      assert.ok(
        entry.sourceFlags.includes('syllabus'),
        `${level} 考纲词 ${word} 缺少 syllabus 标记`
      );
    });
  });
});

test('syllabus 标记应只出现在考纲词目上', () => {
  Object.keys(SYLLABUS_FILE_BY_LEVEL).forEach((level) => {
    const entries = readLevel(level);
    const syllabusWords = readSyllabusWords(level);

    entries.forEach((entry, index) => {
      assert.equal(
        entry.sourceFlags.includes('syllabus'),
        syllabusWords.has(entry.word),
        `${level}[${index}] ${entry.word} 的 syllabus 标记与考纲词表不一致`
      );
    });
  });
});

test('考纲补齐词条应带有可用的中文释义与词性', () => {
  Object.keys(SYLLABUS_FILE_BY_LEVEL).forEach((level) => {
    const entries = readLevel(level);
    const syllabusEntries = entries.filter((entry) => entry.sourceFlags.includes('syllabus'));

    assert.ok(syllabusEntries.length > 0, `${level} 缺少已标记的考纲词条`);
    syllabusEntries.forEach((entry, index) => {
      assert.ok(entry.meaning && hasChinese(entry.meaning), `${level}[${index}] 缺少中文释义`);
      assert.ok(entry.definition, `${level}[${index}] 缺少 definition`);
    });
  });
});

test('词库生成器输出应与仓库快照一致', async () => {
  const workspace = createTempDir();

  try {
    await buildVocabularyDataset({
      dataDir: workspace,
      ensureSources: false,
    });

    SNAPSHOT_FILES.forEach((fileName) => {
      const generated = fs.readFileSync(path.join(workspace, fileName), 'utf8');
      const snapshot = readRawDataFile(fileName);
      assert.equal(generated, snapshot, `${fileName} 与生成器输出不一致`);
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('publish 词库构建不应携带 publishBlocking 来源派生数据', async () => {
  const workspace = createTempDir();

  try {
    const { grouped } = await buildVocabularyDataset({
      buildTarget: 'publish',
      dataDir: workspace,
      ensureSources: false,
    });

    Object.entries(grouped).forEach(([level, entries]) => {
      entries.forEach((entry, index) => {
        assert.equal(
          hasPublishBlockingFlag(entry.sourceFlags || []),
          false,
          `${level}[${index}] 不应包含 publishBlocking sourceFlags`
        );
      });
    });

    assert.ok(grouped.CET4.length >= 3000, `publish CET4 词条数量过少: ${grouped.CET4.length}`);
    assert.ok(grouped.CET6.length >= 5000, `publish CET6 词条数量过少: ${grouped.CET6.length}`);
    assert.ok(
      grouped.KAOYAN.length >= 4000,
      `publish KAOYAN 词条数量过少: ${grouped.KAOYAN.length}`
    );

    // 考纲来源为可再分发数据，发布数据集同样必须完整覆盖考纲词目
    assertSyllabusCoverage(grouped.CET4, 'cet4', readSyllabusWords('cet4'));
    assertSyllabusCoverage(grouped.CET6, 'cet6', readSyllabusWords('cet6'));

    assert.equal(grouped.IELTS.length, readLevel('ielts').length);
    assert.equal(grouped.TOEFL.length, readLevel('toefl').length);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('词库生成 CLI 参数应显式校验未知和缺值选项', () => {
  assert.deepEqual(parseCliArgs([]), {
    refresh: false,
    buildTarget: 'development',
    outputDir: DATA_DIR,
  });
  assert.deepEqual(parseCliArgs(['--publish-safe', '--output-dir', 'publish-data', '--refresh']), {
    refresh: true,
    buildTarget: 'publish',
    outputDir: 'publish-data',
  });
  assert.deepEqual(parseCliArgs(['--build-target=publish', '--output-dir=custom-data']), {
    refresh: false,
    buildTarget: 'publish',
    outputDir: 'custom-data',
  });

  assert.throws(() => parseCliArgs(['--unknown']), /Unknown vocabulary dataset option/);
  assert.throws(() => parseCliArgs(['--build-target']), /Missing value for --build-target/);
  assert.throws(
    () => parseCliArgs(['--build-target', '--refresh']),
    /Missing value for --build-target/
  );
  assert.throws(() => parseCliArgs(['--output-dir=']), /Missing value for --output-dir/);
});

test('词库数据文件应使用 UTF-8 无 BOM 编码，避免 JSON 解析兼容性问题', () => {
  SNAPSHOT_FILES.forEach((fileName) => {
    const raw = readRawDataFile(fileName);
    assert.equal(raw.startsWith(UTF8_BOM), false, `${fileName} 包含 BOM`);
  });
});
