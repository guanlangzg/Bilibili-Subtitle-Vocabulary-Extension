# 考纲词表（syllabus-2016）

《全国大学英语四、六级考试大纲（2016年修订版）》的四级/六级词表，本项目判定「考纲内词目」的权威依据。

## 文件

| 文件 | 条数 | 说明 |
|---|---|---|
| `cet4.json` | 6127 | 四级词目与派生词，含 `according to`、`ice cream`、`middle class` 等 14 条多词短语 |
| `cet6.json` | 1715 | 六级词目与派生词（大纲中带 ★ 的词） |

格式为字符串数组，元素已按字母序排列：

```json
["abide", "abnormal", "abort", "abortion", "abreast"]
```

多词短语不被分词器支持，构建时跳过，因此实际进入词库的单词数为 6113（四级）与 1715（六级）。

## 来源与许可

- 上游：https://github.com/ismartcoding/endict （`vocabulary/` 目录）
- 原始出处：全国大学英语四、六级考试委员会《全国大学英语四、六级考试大纲（2016年修订版）》词表，官网入口 https://cet.neea.edu.cn/html1/folder/16113/1588-1.htm
- 许可证：MIT（Copyright (c) 2022 SmartCoding），许可证原文见 `../licenses/endict-MIT.txt`
- 可再分发：是，需保留署名与许可证说明

## 与官方词表规模口径的对应关系

官方说明：词表收录词目 5418 个（六级词目带 ★），派生词 2551 个，词目与派生词合计 7969 个；四级需掌握 6308 个，六级需掌握 1661 个。上游按四级/六级分列后为 6127 / 1715 条，与本目录一致；差异来自派生词与多词短语的拆分口径。

## 构建用法

`bilibili-vocab-extension/scripts/build-vocab-dataset.js` 按以下规则消费本目录：

1. 词表中的词条在对应等级标记 `sourceFlags: ["...", "syllabus"]`；
2. 词表内但 ECDICT 未打四六级标签的词（六级 674 条、四级 1844 条），用 ECDICT 的释义/音标/词性补齐为词条；
3. 多词短语不进入词库。

覆盖情况与标记正确性由 `bilibili-vocab-extension/tests/open-vocab-data.test.js` 的考纲覆盖率用例保证。
