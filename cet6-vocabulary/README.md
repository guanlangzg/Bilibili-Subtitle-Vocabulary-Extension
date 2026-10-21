# CET-6 考纲词汇收集

本目录汇总构建 CET-6（及 CET-4）词库所需的考纲词表与来源说明，按来源分类存放。目录位于**仓库根目录**，与插件项目 `bilibili-vocab-extension/` 平级；构建脚本 `bilibili-vocab-extension/scripts/build-vocab-dataset.js` 从这里读取考纲词表，构建产物写入 `bilibili-vocab-extension/data/`。

收集与核验日期：2026-10-18。

## 目录结构

| 分类 | 位置 | 内容 | 是否随包分发 |
|---|---|---|---|
| 考纲词表 | `syllabus-2016/` | 《全国大学英语四、六级考试大纲（2016年修订版）》四级/六级词表 | 是（publish-safe 数据集的输入） |
| 释义词典 | `dictionary/` | 释义、音标、词性、中文别名来源（文件在 `bilibili-vocab-extension/sources/`） | 是 |
| 考试词频 | `exam-ranking/` | 考试词频与排序来源（文件在 `bilibili-vocab-extension/sources/`） | 否，仅本地开发构建 |
| 许可证原文 | `licenses/` | 上游许可证文本，作为许可状态的核验证据 | 否 |

`sources.json` 为本目录的机器可读索引（含分类与许可字段）；构建产物内的 `bilibili-vocab-extension/data/sources.json` 是随包分发的来源清单。

## 来源与许可状态

| 分类 | 来源 | 用途 | 许可证 | 状态 | 可再分发 | 署名 |
|---|---|---|---|---|---|---|
| 考纲词表 | [ismartcoding/endict](https://github.com/ismartcoding/endict) （词表来自 NEEA 2016 版大纲） | 考纲词目判定、缺失词补齐 | MIT | 已核验 | 允许 | 必须 |
| 释义词典 | [ECDICT](https://github.com/skywind3000/ECDICT) | 释义、音标、词性、频率 | MIT | 已核验 | 允许 | 必须 |
| 释义词典 | [Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) | CEFR 等级标注 (1-6) | MIT | 已核验 | 允许 | 必须 |
| 释义词典 | [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | 中文别名补充 | CC BY-SA 3.0 | 已核验 | 允许（相同方式共享） | 必须 |
| 考试词频 | [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) | 中文释义、词组、考试词频排序 | BSD-3-Clause | 已核验（2026-10-18 复核，见下） | 允许 | 必须 |
| 考试词频 | [exam-data/NETEMVocabulary](https://github.com/exam-data/NETEMVocabulary) | 考研词频排序 | NOASSERTION | 待审查 | 不允许 | 必须 |

## 许可问题说明

以下问题直接影响发布包内容，构建脚本按 `data/sources.json` 的 `publishBlocking` 字段过滤。

### 1. KyleBing/english-vocabulary：许可证已从「无」变为 BSD-3-Clause

- 现状：仓库根目录存在 `LICENSE`，内容为 BSD 3-Clause License，`Copyright (c) 2022-2026, KyleBing`，许可证文本见 `licenses/kylebing-BSD-3-Clause.txt`。
- 问题：仓库 `data/sources.json` 与 `docs/词库来源与许可证.md` 仍将它标记为「无明确许可证元数据 / needs-review / 阻断发布」，`scripts/build-vocab-dataset.js` 的 `SOURCE_MANIFEST` 也按阻断处理，该记录已过时。
- 影响：若改为 verified + 不阻断，发布包将包含其释义与考试词频字段，`coverageTier` 的 `core` 高频层在以 publish-safe 构建时也会由空变为有值，属产品口径变更，需要单独决策，因此本次未改动发布策略。
- 结论：许可本身（BSD-3-Clause）允许带署名再分发；是否解除阻断待定。

### 2. exam-data/NETEMVocabulary：许可证无法断言（NOASSERTION）

- 现状：GitHub API 返回 `NOASSERTION`，仓库无明确许可证文本。
- 处理：仅用于本地开发构建，发布包移除其派生字段（`examFrequencyScore` / `examPriorityScore` 中的 netem 部分）。
- 结论：维持阻断，除非上游给出明确许可或替换数据源。

### 3. CC-CEDICT：CC BY-SA 3.0 的相同方式共享义务

- 现状：CC BY-SA 3.0，允许再分发，但要求署名并保持相同方式共享。
- 处理：`data/ATTRIBUTION.md` 与 `data/sources.json` 随发布包分发，保留署名与协议说明。

## 考纲词表分类说明

`syllabus-2016/` 下的词表是 2016 年版大纲词表（四级/六级分列），是本项目判定「考纲内词目」的依据：

- `cet4.json`：四级词目与派生词 6127 条（含 `according to`、`ice cream` 等 14 条多词短语）。
- `cet6.json`：六级词目与派生词 1715 条。

构建行为：

1. 词表中的词条在对应等级标记 `syllabus` 来源；
2. 词表内但 ECDICT 未打四六级标签的词，用 ECDICT 的释义/音标/词性补齐为词条，避免考纲词缺失；
3. 多词短语不进入单词级词库（分词器只匹配单词 token）。

大纲词表规模的官方口径：词目 5418 个（其中六级词目带 ★），派生词 2551 个，词目与派生词合计 7969 个；四级需掌握 6308 个，六级 1661 个。本项目使用上游整理好的分列结果，因此条数为 6127 / 1715。

## 复现方式

```bash
# 重新下载全部来源并重建数据（会覆盖 bilibili-vocab-extension/data/*.json）
node bilibili-vocab-extension/scripts/build-vocab-dataset.js --refresh

# 仅用已有来源重建
node bilibili-vocab-extension/scripts/build-vocab-dataset.js

# 构建发布用 publish-safe 数据集到指定目录
node bilibili-vocab-extension/scripts/build-vocab-dataset.js --publish-safe --output-dir <dir>
```

校验考纲覆盖：

```bash
node --test bilibili-vocab-extension/tests/open-vocab-data.test.js
```

其中 `CET4/CET6 词库应完整覆盖考纲词表并标注 syllabus 来源`、`syllabus 标记应只出现在考纲词目上` 两个用例保证考纲词表中的每个单词都进入对应词库且标记正确。

## 数据文件获取说明

`syllabus-2016/` 与 `licenses/` 中的文件为上游内容的本地副本，用于离线构建与许可核验。上游地址：

- 词表：`https://raw.githubusercontent.com/ismartcoding/endict/main/vocabulary/cet4.json`、`.../cet6.json`
- 许可证：`https://github.com/ismartcoding/endict/blob/main/LICENSE`、`https://github.com/KyleBing/english-vocabulary/blob/master/LICENSE`

`bilibili-vocab-extension/sources/` 下的 ECDICT、Words-CEFR、CC-CEDICT、KyleBing、NETEM 原始文件体积较大或已被多个等级共用，未复制到本目录，由 `bilibili-vocab-extension/scripts/build-vocab-dataset.js` 的 `SOURCE_FILES` 统一引用；构建清单中的考纲词表路径形如 `../cet6-vocabulary/syllabus-2016/cet6.json`（以插件项目目录为基准）。
