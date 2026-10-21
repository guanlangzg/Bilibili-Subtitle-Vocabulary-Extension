# 词库数据来源与许可证

本扩展随附的词库数据（data/ 目录）由以下公开数据源构建。机器可读的来源清单见同目录的 sources.json，完整说明见仓库 docs/词库来源与许可证.md。

- ECDICT — https://github.com/skywind3000/ECDICT （MIT 许可证）：英汉词典，含 CET4/CET6/IELTS/TOEFL/考研标签。
- Words-CEFR-Dataset — https://github.com/Maximax67/Words-CEFR-Dataset （MIT 许可证）：按词与词性提供 CEFR 等级标注（1-6）。
- CET 考试大纲词表（2016 年修订版，经 ismartcoding/endict 整理） — https://github.com/ismartcoding/endict （MIT 许可证）：四/六级考纲词目与派生词清单，标记 syllabus 来源并补齐考纲缺失词。
- CC-CEDICT — https://www.mdbg.net/chinese/dictionary?page=cc-cedict （CC BY-SA 3.0，MDBG 发布版本）：中文释义补充，按许可要求保留署名与相同方式共享。

发布包中的 data/ 目录为 publish-safe 数据集，不包含 KyleBing/english-vocabulary、exam-data/NETEMVocabulary 等未确认许可来源的派生数据。
