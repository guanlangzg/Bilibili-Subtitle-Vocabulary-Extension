# 释义词典（dictionary）

提供 CET-6 词库的词条内容：中文释义、音标、词性、中文别名与 CEFR 等级。原始文件体积较大或被多个等级共用，保留在 `bilibili-vocab-extension/sources/` 根目录，本目录仅作登记，构建脚本按路径引用。

## 来源

| 来源 | 文件 | 用途 | 许可证 | 可再分发 |
|---|---|---|---|---|
| [ECDICT](https://github.com/skywind3000/ECDICT) | `bilibili-vocab-extension/sources/ecdict.csv` | 释义、音标、词性、词频，含 cet4/cet6/ielts/toefl/ky 标签 | MIT | 是（需署名） |
| [Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) | `bilibili-vocab-extension/sources/words.csv`、`word_pos.csv` | CEFR 数值等级 (1-6) 与频率 | MIT | 是（需署名） |
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | `bilibili-vocab-extension/sources/cedict_ts.u8.gz` | 中文别名 `aliases` 补充 | CC BY-SA 3.0 | 是（需署名 + 相同方式共享） |

## 许可注意

- CC-CEDICT 为 **CC BY-SA 3.0**：发布包必须保留署名，并说明派生数据沿用相同协议。发布包内的 `bilibili-vocab-extension/data/ATTRIBUTION.md` 与 `data/sources.json` 承担该义务。
- ECDICT 与 Words-CEFR-Dataset 为 MIT：保留版权与许可声明即可。

## 构建用法

- `ecdict.csv` 逐行读取（仅第 8 列为 tag 且含 `cet4`/`cet6`/`ky`/`ielts`/`toefl` 的行参与等级构建），考纲词表中的词即使没有标签也会被收录；
- `words.csv` + `word_pos.csv` 生成 `cefrLevel` / `cefrRank` / `frequency`；
- `cedict_ts.u8.gz` 只在已选词条范围内匹配中文别名，每个词最多 5 条。
