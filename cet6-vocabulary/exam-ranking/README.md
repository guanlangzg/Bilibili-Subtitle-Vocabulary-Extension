# 考试词频（exam-ranking）

提供考试词频与优先级排序，用于构建考试词库的 `core` 高频层与 `examFrequencyScore` / `examPriorityScore`。原始文件保留在 `bilibili-vocab-extension/sources/` 根目录，本目录仅作登记。

## 来源

| 来源 | 文件 | 用途 | 许可证 | 发布包 |
|---|---|---|---|---|
| [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) | `bilibili-vocab-extension/sources/kylebing-cet4.json`、`kylebing-cet6.json`、`kylebing-kaoyan.json` | 中文释义、词组、考试词频排序；决定 `coverageTier: core` | BSD 3-Clause | 当前阻断，见下 |
| [exam-data/NETEMVocabulary](https://github.com/exam-data/NETEMVocabulary) | `bilibili-vocab-extension/sources/netem_full_list.json` | 考研词频排序 | NOASSERTION | 阻断 |

## 许可问题（重要）

### KyleBing/english-vocabulary：许可已明确为 BSD 3-Clause，但构建仍按阻断处理

- 上游仓库根目录存在 `LICENSE`：BSD 3-Clause License，`Copyright (c) 2022-2026, KyleBing`，文本见 `../licenses/kylebing-BSD-3-Clause.txt`。
- 该许可允许带署名再分发（需保留版权声明与免责声明，且不得使用作者名义背书）。
- 但项目的 `bilibili-vocab-extension/scripts/build-vocab-dataset.js`（`SOURCE_MANIFEST`）与 `docs/词库来源与许可证.md` 仍将其记为「无明确许可证元数据」的 `needs-review` 来源并阻断发布，该记录已过时。
- 影响面：解除阻断会使发布包包含其释义与考试词频字段，并使 publish-safe 构建的 `coverageTier: core` 由空变为有值（产品口径变更）。是否解除阻断属维护者决策，本次收集未改动发布策略。

### exam-data/NETEMVocabulary：许可证无法断言

- GitHub API 返回 `NOASSERTION`，仓库无许可证文本，无法确认再分发条件。
- 仅用于本地开发构建；`--publish-safe` 构建会移除其派生字段。
- 如需在发布包中使用考研词频排序，应替换为许可明确的数据源。

## 构建用法

- 开发构建（默认）：合并 KyleBing 词频排序与释义，词条标记 `sourceFlags: ["kylebing"]`，据此得到 `coverageTier: core`；考研等级额外合并 NETEM 排序。
- 发布构建（`--publish-safe`）：跳过以上两个来源，相关词条只保留 ECDICT / 考纲 / CEDICT 派生字段，`coverageTier` 全部为 `full`。
