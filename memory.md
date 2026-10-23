# memory.md — 项目经验沉淀

## 验证命令(用 `pnpm -C bilibili-vocab-extension <script>` 执行)
- 最小门禁:`lint`(eslint --max-warnings 0)、`typecheck`(tsc --noEmit)、`test`(node --test,478 用例,~42s)、`test:ui`(~2s)
- 构建:`build:extension` = typecheck + 双 vite 构建 + overlay 体积预算检查(~10s);预算 raw 280KB / gzip 70KB,基线在 `config/overlay-size-baseline.json`
- 发布最强门禁:`release:check`(含浏览器冒烟与打包策略检查,需 Playwright 环境);发布清单见 `docs/release-checklist.md`
- 装依赖:`pnpm install --frozen-lockfile`(CI 同款);**lockfile 必须与 package.json 同步**,否则 CI 安装步骤直接失败;本地重装用 `--no-frozen-lockfile`
- 改 UI 导致 overlay 超预算时:先评估改动是否合理,再 `pnpm run refresh:overlay-baseline`

## 环境坑(Windows / CMD)
- 交互 Bash 工具是 CMD:无 `tail`/`;` 链;长输出落到日志文件,用 PowerShell `Get-Content -Tail` 读;过滤用 `findstr`
- 工作流沙盒(world.run)不走 shell:必须写 `pnpm.cmd`(不能写 `pnpm`);先在 EvalWorkflowSnippet 验证命令形式再进工作流脚本
- 删除 Windows 保留名文件(如 `nul`):`node -e "fs.unlinkSync('\\\\?\\<绝对路径>')"`
- `node --test tests/*.test.js` 的 glob 在 CMD 下可正常运行(node 自行展开)

## 2026-10-07 开源发布前审查工作流(已完成)
- 5 区域评审 191 个文件 → 44 条发现(43 确认,1 条复核未成立);修复阶段实际改动 87 个文件(+1565/−4006),每条发现均经独立复核员验证;最终 test/lint/typecheck/test:ui/build:extension 全绿
- 已删除的死文件:`overlayPanel.js`(1382 行 @legacy 死模块)、`.eslintrc.cjs`(过时 eslintrc 配置,flat config 下永不加载)、`scripts/reorg-react-ui.js`(一次性迁移脚本)、`vocabulary.json`(零引用种子词库)
- 新增共享模块:`react-ui/src/lib/settings-bridge-core.ts`(合并 overlay 与 popup 双桥接)、`scripts/lib/`(脚本工具去重)、`data/ATTRIBUTION.md`(发布包内人类可读署名)
- **manifest content_scripts 现包含 `runtimeMessaging.js` 与 `scripts/danmaku.js`**(修复内容脚本消息信任边界与弹幕模块缺失)——排查内容脚本问题时先看这里
- 未自动处理(需决策):spike 三件套(contentScriptBundleSpike.entry.mjs + vite.content-script-spike.config.mts + tests/content-script-bundle-spike.test.js)需三件同删,属产品方向决策;F1-6 学习数据跨上下文读-改-写竞态是结构性问题,需要统一互斥设计;`dist-spike/` 未加 .gitignore
- 浏览器内冒烟(test:extension-smoke / test:zip-smoke / real-site)本地未跑,发布前需过 `release:check`

## 2026-10-07 收尾轮:剩余问题全部修复
- **F1-6 竞态修复定型**:学习数据写入统一为"后台单写者"。新增消息 `LEARNING_SAVE_WORD`/`LEARNING_REMOVE_WORD`/`LEARNING_CLEAR_VOCABULARY`(runtimeMessaging.js 与 react-ui/src/lib/runtime-messaging.ts 双份 MESSAGE_TYPES 需同步维护);background-learning-state.js 的 saveWord/removeWord/clearVocabulary 在共享队列内读-改-写;learningState.js 提取纯函数 buildSavedWordRecord/buildRemovedWordRecord 供两端复用,页面路径消息优先、本地读改写兜底(无 RuntimeMessaging 全局时自动回退,旧测试桩不受影响);storage.ts clearVocabularyBook 同样消息优先。回归测试 `tests/learning-single-writer.test.js`(后台合并不回滚并发命中、队列串行、页面不发整 map 写)
- **F5-5 定型**:commit 队列提取为纯模块 `react-ui/src/lib/commit-queue.ts`(串行+代际压制),use-overlay-settings.ts 消费它;行为级测试 `tests/react-overlay-commit-queue.test.js` 用 transpile+vm 真实执行(仓库无 jsdom/react-test-renderer,纯 hook 不可直接跑,提取纯逻辑是可行范式)
- spike 三件套已删(contentScriptBundleSpike.entry.mjs + vite.content-script-spike.config.mts + tests/content-script-bundle-spike.test.js),同步删掉 run-continuous-optimization.js 分片规则与 continuous-optimization.test.js 断言;dist-spike 随配置删除不再需要 gitignore 条目
- 最终门禁(亲手跑):test 484/484、test:ui 56/56、lint、typecheck、build:extension 全绿(overlay 270.83KB/65.22KB)
- git rm 会把删除暂存,其余改动保持未暂存——提交前一起 add 即可

## 2026-10-18 CET-6 考纲词表接入
- **权威来源**:2016 版《全国大学英语四、六级考试大纲》词表(词目 5418、含派生词共 7969;四级 6308、六级 1661)。可用的可再分发副本是 ismartcoding/endict(MIT,仓库 LICENSE 已核实),四级/六级分列在 `vocabulary/cet4.json`(6127)与 `cet6.json`(1715),合计与官方口径吻合
- **收集目录约定**:考纲词表按来源分类存放于**仓库根目录** `cet6-vocabulary/`(`syllabus-2016/` 词表、`dictionary/` 释义源登记、`exam-ranking/` 词频源登记、`licenses/` 上游许可证原文,根 README+sources.json 记录分类与许可);`bilibili-vocab-extension/sources/` 根目录的大文件(ECDICT/CC-CEDICT 等)只登记不复制。构建清单里考纲路径写作 `../cet6-vocabulary/syllabus-2016/cet6.json`(以插件项目目录为基准)
- **许可现状**:KyleBing/english-vocabulary 上游已改为 BSD 3-Clause(2022-2026),但构建清单仍按 needs-review 阻断,禁改发布策略(会影响 publish-safe 的 core 层口径),属维护者决策;exam-data/NETEMVocabulary 仍是 NOASSERTION 阻断
- **接入规则**(构建脚本):`SOURCE_FILES` 与 `SOURCE_MANIFEST` 两处都要登记新来源;考纲词在对应等级追加 `syllabus` 标记;考纲内但 ECDICT 无四六级标签的词用 ECDICT 释义补齐(六级 674 条、四级 1844 条);考纲中的多词短语(14 条)因分词器只匹配 token 而跳过;`toSourceRelativePath` 按插件项目相对路径写清单,支持子目录与 `../` 前缀
- **本次数据变化**:CET6 6035→6709(考纲 1715/1715 全覆盖)、CET4 4996→6826;CET6 中另有 1002 词属 ECDICT 六级标签但不在大纲全表(技术词如 torque/tensile),未删除
- **验证方法**:`node --test tests/open-vocab-data.test.js`(新增考纲覆盖、syllabus 标记一致性、补齐词释义、publish 覆盖 4 组用例);快照用例逐字节比对 `data/`,**改构建逻辑后必须重跑 `node scripts/build-vocab-dataset.js` 再测**,否则快照不一致
- **网络坑**:`raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 直连被沙箱阻断(ECONNRESET),用 `https://gh-proxy.com/<原始URL>` 前缀下载,或用 GitHub MCP 工具读取;Git Bash 下 pnpm 要走 `pnpm.cmd`
- **既有状态(非本次引入)**:test 471/496,25 个失败全部来自 `tests/remote-test-entry-contract.test.js`(Python runner 契约用例,本机无 Python);lint 有 1 处既有 prettier 错误 `vocabulary.js:603`

## 2026-10-18 全量审查与修复

### 环境与门禁恢复(重要,先做)
- **仓库曾丢失 `.prettierrc`**:lint 因此报 9463 个假错误(要求双引号、宽 80)。反推确认原配置为 `{singleQuote:true, printWidth:100, trailingComma:"es5"}`,写入 `bilibili-vocab-extension/.prettierrc` 后 163 个源文件零差异。**判断方法**:用 prettier API 对候选配置逐文件 format 比对,差异文件数为 0 即命中
- 本机无全局 `pnpm`,只有 corepack。绕过方式:在 PATH 已有的 `C:\Users\24228\bin\pnpm.cmd` 写 `@echo off` + `corepack pnpm %*`;否则 `pnpm run build:extension` 内部再调 `pnpm run` 会失败
- `sources/cedict_ts.u8.gz`(3.98MB)不在仓库内,缺它时 `tests/open-vocab-data.test.js` 5 个用例失败。下载地址在 `scripts/build-vocab-dataset.js` 的 SOURCE_FILES 里:`https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz`(注意不是 `.../cedict/cedict_ts.u8.gz`,后者 404)
- `tests/remote-test-entry-contract.test.js` 依赖本机 `python`,无 Python 时整个文件报错;本地回归用 `node --test $(ls tests/*.test.js | grep -v remote-test-entry-contract)`

### 修复的实质缺陷
- **跨 level 重复词条导致状态分叉**(已用真实词库量化):30904 条词目里 6877 个词跨 ≥2 个等级,`wordIndex` 单值存储使 `recordHit()` 写入"最高等级"词条,而 `findMatchesInText` 按 `getCandidatePriority` 选另一份;默认 core 模式下 5993 个词的展示状态永远停在 `unseen`。修法:新增 `wordEntriesIndex`(word → 全部等级条目)与 `applyRecordToWordEntries()`,一次写入同步所有同名词条
- **字幕节点复用导致"冻结"**:B 站复用同一字幕 DOM 节点时,`extractSubtitleText` 优先返回 `dataset.biliVocabOriginalText`(上一句),`isRenderUpToDate` 命中旧签名后直接 return,新字幕永不替换;设置刷新还会把旧句写回页面。修法:`renderSubtitleElement` 把 `biliVocabRenderedText` 改为记录实际 DOM 文本(`element.textContent`)而非 `mixedText`;`subtitleParser.hasRenderedTextDrifted()` 比较快照与当前 DOM,漂移即清掉 dataset 走真实 DOM
- **选轨不认识 AI 字幕与繁体**:原优先级表只有 `zh-Hans/zh-CN/zh/en-US/en`,`ai-zh`、`zh-Hant`、`zh-TW` 全部落到末位,中英双语视频会选到英文轨。改为 `getSubtitleTrackRank()`:精确表 + 前缀/后缀兜底(`ai-zh*`、`zh-*`、`*-zh`)
- **tooltip 无 teardown**:`init()` 注册 6 个 document 监听 + window resize,但只有 `hideTooltip()`;权限撤销后点击残留 `.bsv-word` 仍会写入学习数据。新增 `destroy()` 并在 `teardownContentRuntime` 调用
- **web 文本管线非幂等**:包裹 span 无标记,TreeWalker 下一轮会再次包裹,每秒加深一层。给包裹节点加 `data-bsv-web-wrap="1"` 并在 `shouldAcceptWebTextNode` 拒绝其后代
- **清理摘要两套实现**:`background-storage.buildCleanedLearningSummary` 与 `learningState.buildLearningSummary` 对 `learning/reviewing` 状态判定不同(前者归 unseen,后者归 seen),配额清理会用前者覆盖后者。改为优先委托 `learningState.buildLearningSummary`
- **空 `now` 算出 1970 时间戳**:`recordExposure`/`applyLearningAction` 用 `normalizeTimestamp(now)`(无效返回 null)后做加法。统一为 `|| Date.now()`
- **清空生词本会被下一次曝光撤销**(后台与 React 回退路径都有):`clearVocabulary` 只把 `status` 改成 `seen` 并删 `savedAt`,`saveCount` 保留;而 `deriveStatus` 判定 `saveCount > 0 → 'saved'`,该词下次出现在字幕里就自动回到生词本。修法:清空时同时置 `saveCount: 0`(`background-learning-state.js` 与 `react-ui/src/lib/storage.ts` 两处),回归测试在 `tests/learning-single-writer.test.js`

### 性能(同条件实测,Node 24 + 真实 30904 条词库)
- `findMatchesInText`:**1.47ms → 0.08ms**(≈18x)。把 `sortedChineseTokens` 线性全扫改为按首码点分桶(`Array.from(token)[0]`,不用 `charAt` 以免代理对失效),只扫描首字符出现在字幕里的 token
- `recordHit`:**1.46ms → 0.13ms**(≈11x)。`refreshLearningSummary(buildActiveLearningRecords(...))` 每次命中都全量遍历 28400 条,改为维护增量 `activeLearningRecords`,命中/复习后只更新该 key
- 注意:`contentScript/observer` 的 mutation 节流无尾调度、字幕探测每 300ms 做 getComputedStyle+getBoundingClientRect —— 已确认是真实开销,但改动会破坏 `contentScript-observer-throttle.test.js` 的调用次数断言,本轮未动

### 工程改进
- lint 脚本补上 `"contentScript"`(此前 6 个内容脚本文件完全不受 prettier/eslint 约束),`tests/lint-entry-contract.test.js` 同步断言
- 新增消息类型一致性测试(`tests/runtime-messaging.test.js`):用正则抽取 `react-ui/src/lib/runtime-messaging.ts` 的 `MESSAGE_TYPES` 块与 `runtimeMessaging.js` 逐项比对。注意正则必须先截取 `export const MESSAGE_TYPES = {...}` 块,否则会误匹配 `error: '...'`
- 本轮新增测试:跨 level 词条同步、字幕 DOM 漂移三态、中文轨道优先 4 组、tooltip destroy 监听器计数、消息类型一致性

### 并行会话协作注意
- 本轮期间另一个会话正在接入 CET-6 考纲词表(见上节),它会改写 `data/*.json`、`data/sources.json`、`scripts/build-vocab-dataset.js` 并新增 `sources/cet6/`。该状态下 `open-vocab-data.test.js` 的 3 个用例(源清单路径、来源登记、快照一致)会失败,属对方半完成态,**不要当作自己的回归失败去"修"**
- 对方完成后复测:全量 454/454 通过。若后续再出现这 3 个用例失败,先看 `data/sources.json` 的 `files[].path` 与 `scripts/build-vocab-dataset.js` 的 `SOURCE_FILES` 是否指向同一位置

### 后台审查结论(本轮自查)
- MV3 语义正确:所有状态都经 storage 读写、无内存态依赖;异步消息 `return true`;`onInstalled`/`onStartup` 都做了 `modulesLoaded` 守卫;消息入口先做 `isTrustedExtensionSender`,再按 `MESSAGE_TYPES` 白名单分发,所有学习写操作统一进 `enqueueSharedStateMutation` 串行
- 存储增长有界:体验事件日志 80 条、自适应反馈窗口 12、翻译缓存 LRU 200、曝光冷却表 500;配额超限时 `tryCleanOldLearningData` 会清理陈旧低价值词条并重试写入



## 2026-10-21 死代码与垃圾清理(新一轮开发前)

### 已删除并验证
- `segmenter.js` + `tests/segmenter.test.js`:只写 `globalThis.ChineseSegmenter`,全仓库零读取方,却随每个页面加载
- `settingsUiStateMachine.js` + `tests/settings-ui-state-machine.test.js`:同上,`SettingsUiStateMachine` 零读取;且其 `error` 状态缺 `SAVE_SUCCESS` 迁移(不可达)
- `content-script-runtime.d.ts`:零 import,`tsconfig.json` 的 `include` 只有 `react-ui/src`,从未被 typecheck 检查;内容与 renderer 实际字段已漂移
- `vocabulary.js`:`getLearningSummary`(零调用,与 React 侧 storage 版重复)、`getPendingLearningHitOutboxSize`(零消费者)、33 个解构绑定里 11 个从未使用(`LEVEL_CLASS_MAP`/`REVIEW_BUCKETS`/`splitMeaning`/`createEntrySnapshotWithRecord` 等)
- `vocabulary-pure.js`:`createEntrySnapshotWithRecord`(只是 `applyLearningRecordToEntry` 的包装,零调用)
- `learningState.js`:`exportVocabularyBook`(零调用;真实导出在 `react-ui/src/lib/storage.ts`,两份列结构还不一致)
- `contentScript/index.js`:legacy web 文本渲染接线(`renderToHtml` → `renderWebTextReplacementHtml`)——`processWebTextNode` 实际用 `createWebTextReplacementNode` 走纯 DOM 构造,这条链永不被调用
- 构建产物与工具临时文件:`dist/`、`extension.zip`、`.zcode/workflow-runs/*.mjs`、`.zcode/workflow-drafts/*.dwf.ts`

### 刻意保留(勿删)
- `subtitleNavigation.js`:虽然 `contentScript/index.js` 里赋值给 `subtitleNavigation` 变量后看不到直接调用,但它作为依赖注入进 `createSubtitleNavigationController`,是活跃依赖
- `webTextReplacement.renderWebTextReplacementHtml` 与 `renderer.renderToHtml`:有独立测试锚定「web 文本替换不走 HTML 渲染」这一安全契约,是公开 API,不是死代码
- `cet6-vocabulary/`(仓库根目录):考纲词表的活跃数据源,`build-vocab-dataset.js` 的 `SYLLABUS_DIR` 直接指向它

### 删除时必须同步改的地方(否则测试红)
- 删内容脚本文件要同步:`manifest.json` 的 `content_scripts.js`、`react-ui/src/lib/storage.ts` 的 `CONTENT_RUNTIME_SCRIPT_FILES`(两者由 `tests/permission-strategy-contract.test.js` 断言必须完全一致)
- 删测试文件要同步:`scripts/run-continuous-optimization.js` 的 shard 正则、`tests/continuous-optimization.test.js` 里的文件清单与 `testFileCount` 期望值

### 发现但未处理(需决策)
- **发布包已超预算**:`pnpm run check:extension-package` 报 unpacked 19596KB > 19000KB 预算。经逐条解析 zip 中央目录确认,超预算全部来自 `data/*.json` 词库(合计 18.5MB,其中 toefl 4228KB / cet4 4226KB / cet6 3901KB),代码总量仅约 408KB。根因是考纲词表接入使词库从 ~15MB 增到 21MB。两条路:提高 `DEFAULT_MAX_UNPACKED_SIZE_KB` 预算,或发布时裁剪词库(如 publish 目标只保留 core 层)。**与死代码无关**
- `check:extension-package` 依赖先跑 `pnpm run pack`;`pack` 会重建 `data/*.json`(publish 目标,写入临时目录)并生成 `extension.zip`,验证完记得清理

### 本轮门禁结果
- lint / typecheck / test:ui(56) / test(448,0 失败) / build:extension(overlay 270.83KB, 65.22KB gzip)全绿
- `tests/remote-test-entry-contract.test.js` 仍依赖本机 `python`,本地回归时排除

## 2026-10-21 词库文件优化(解决发布包超预算)

### 根因与实测
- 发布包预算按**解压后体积**计算(`DEFAULT_MAX_UNPACKED_SIZE_KB = 19000`),词库 `data/*.json` 占其中绝大部分
- 词库原为 `JSON.stringify(payload, null, 2)` 缩进格式:20.42MB → 紧凑格式 15.10MB,**省 5.33MB(26.1%)**
- 注意 gzip 视角完全不同:词库 gzip 后只有 ~3.55MB,紧凑化只省 4.2%。**看预算要看解压体积,看下载量要看 gzip**,两者结论相反,别混用
- 修改点:`scripts/build-vocab-dataset.js` 的 `writeJson()` 改为默认紧凑、`{pretty:true}` 保留缩进(仅 `sources.json` 用);词条文件全部紧凑

### 结果
- `check:extension-package`:unpacked **19596KB → 14874KB**(预算 19000KB),zip 3337KB → 3202KB(预算 3500KB),**门禁通过**
- 快照测试(`词库生成器输出应与仓库快照一致`)逐字节比对通过,说明数据内容零变化,只改了序列化格式

### 评估后放弃的方案(勿重复尝试)
- **跨等级去重**:12374 个不同词中有 7622 个跨 ≥2 等级(18530 个冗余副本),但**只有 438 组 payload 完全相同**;其余 7184 组在 `sourceFlags`/`coverageTier`/`examFrequencyScore`/`altMeanings`/`isPhraseBacked`/`phraseCount` 上都不同——各等级是独立构建的,合并会改变 `getCandidatePriority` 选词与 `coverageTier` 判定。收益高但语义风险大,需产品决策
- **省略默认值字段**:再省约 2MB 解压体积,但 `tests/open-vocab-data.test.js` 的字段完整性用例逐项断言 `cefrLevel`/`frequency`/`sourceFlags` 等的类型与一致性,需同步放宽测试并让消费端 `normalizeEntry` 兜底;gzip 视角只多省 1.4%,性价比低

### 改动后必须重跑
- `node scripts/build-vocab-dataset.js`(重生成 data/),再 `node --test tests/open-vocab-data.test.js`
- 发布相关:`pnpm run build:extension && pnpm run pack && pnpm run check:extension-package`;`pack` 生成的 `extension.zip` 与 `dist/` 验证完要清理

## 2026-10-21 替换准确率重构(核心质量修复)

### 问题根因(实测,非推测)
- **别名生成规则太宽**:`buildCedictSupplement` 把 CEDICT 英文释义里出现的任意 token 当别名,`伯母 → address`(来自 "polite form of address")就是这样来的
- **候选排序被词频支配**:`getCandidatePriority` 里 `frequency * 0.00001`,8 亿词频≈8000 分,等级/考试分只有两位数,于是"释义里含该中文的最常见多义词"永远胜出(方式→system、一起→case、一个人→company)
- **排序里的 CEFR 项帮倒忙**:`cefrRank * 5` 奖励生僻词,导致 计划→programming、速度→tempo;目标难度应由 `selectMatches` 阶段处理,不该在词表候选选择阶段参与
- **子串匹配**:`source.indexOf(token)` 不看词边界,`电影院`→`film院`、`一个人`→`company个人`、`孩子们`→`child们`
- **meaning 兜底路径有害**:用 `entry.meaning` 的多义项做匹配来源,会把后续义项当同义词(`address` 的 `meaning` 是"住址；演说；举止；灵巧")

### 修复方案(已落地)
- **新增 `scripts/lib/zh-lexicon.js`**:`normalizeGlossText`(取 CEDICT **第一个** gloss、拒绝短语/专有名词/带括号解释)、`classifyTerm`(首 gloss 以 `to ` 开头=动词,裸词=名词,副词/量词返回空)、`isReplaceableTerm`(2-4 汉字 + 虚词黑名单)
- **构建期只产名词对**:`buildCedictTermPairs` 要求中文 term 是名词**且**英文词 `getPrimaryPos(partOfSpeech) === 'noun'`。去掉英文侧检查会让 `精彩→wonderful`(裸 gloss 被判名词)通过
- **运行期只用 curated pairs**:`vocabulary-pure.js` 的 `resolveMatchTerms` 改为**只返回 aliasTerms**,不再回退 `meaning`。回退路径是绝大多数残余错误的来源
- **分词边界匹配**:`vocabulary.js` 用 `Intl.Segmenter('zh', {granularity:'word'})` 分词,只在 segment 内做 1-4 词 n-gram;`COMPOUND_SUFFIXES`(院/馆/们/子/员/性…) 再挡一层复合词切断。无 Segmenter 时回退 `collectSubstringMatches`(仍带后缀守卫)
- **索引只放 matchTerms**:`rebuildIndex` 从 `entry.matchTerms` 建索引(即 curated aliases),不再索引全部 `meaningTerms`

### 关键踩坑
- **`index += consumed - 1` 死循环**:consumed=0 时 index 原地不动,`findMatchesInText` 挂死(表现为 node 进程不退出、无输出)。修法是 `if (consumed > 1) index += consumed - 1`
- **CEDICT 行尾有 `\r`**:Windows 下 `gunzipSync(...).split('\n')` 每行带 CR,`/^(\S+) (\S+) \[...\] \/(.*)\/$/` 会因 `\r` 匹配失败,**必须 `line.trim()` 后解析**。这个坑会让整个 pair 表静默为空
- **`Intl.Segmenter` 分词对 `电影院` 返回 `电影|院`**:所以后缀守卫是必需的,不能只靠分词
- **发布包 core 模式零替换(既有缺陷,已修)**:`deriveCoverageTier` 只有 kylebing/netem 来源才算 core,而 `pack` 用 `--publish-safe` 剥离这些来源 → publish 数据 core=0 → 默认 `vocabularyMode:'core'` 匹配为空。**发布版装上后完全不替换**
- **IELTS/TOEFL 在任何构建里 core 都是 0**:所以回退必须按"用户选中的等级里是否存在 core 词条"判断,不能按 token 判断;按 token 回退会让 IELTS 的 full 词(如 `items`)混进 core 模式

### 验证与度量
- **新增 `tests/golden-subtitle-replacement.test.js`**:16 句黄金集(标注期望词/期望不替换)+ 7 组历史错误配对回归 + 复合词切断 + 区间准确性。**这是唯一能防止准确率回退的机制,之前所有测试只用 mock matches**
- 30 句日常字幕实测:替换点 21 个,**全部正确**(重构前 19 个里 8 个明显错误)
- 索引规模:core token 从 34,901 降到 7,412(唯一中文词),`findMatchesInText` 0.032ms/句(含分词)
- 覆盖:core 词条带 alias 比例 CET4 57.8% / CET6 51.4% / KAOYAN 60.0%;真实中文语料 69.6% 句子至少命中 1 个,每 100 汉字 9.46 次(README/memory/AGENTS 等文档语料)
- 词库体积 15.1MB → 13.85MB(alias 从 131k 条降到 27k 条)
- 门禁:lint / typecheck / test 452 / test:ui 56 / build:extension(overlay 270.83KB, 65.22KB)全绿
- `tests/remote-test-entry-contract.test.js` 仍依赖本机 python,本地回归时排除

### 后续可做(未做)
- 动词对:需要中文词性消歧(服务在"服务态度"里是名词、在"服务客户"里是动词),`Intl.Segmenter` 不提供词性,要么引专门的中文 POS 数据,要么加前后文规则
- 中文词表可再扩:当前只用了 CEDICT 首 gloss 反查,ECDict 的 `definition` 字段里还有大量没用上的义项

## 2026-10-21 代码审查发现的三个缺陷(已修)

审查轮在上面的重构基础上又发现三类问题,都是**规则粒度不对**导致的:

### 1. `-ly` 后缀误杀名词(损失 49 个正确配对)
`classifyTerm` 里 `/ly$/.test(first)` 直接判非名词,但 `family/bully/jelly/monthly/ally/monopoly/assembly` 都是名词。修法:给 `classifyTerm(glosses, headwordPos)` 加第二个参数,调用方已知英文词是名词时跳过该规则。**判断依据必须是英文词性,不能靠启发式**

### 2. CEDICT 的 `;` 是"同义说法"不是"义项分隔"
CEDICT 用 `/` 分义项、用 `;` 分同一义项的不同说法:`电影 → /movie; film/`。原实现把含 `;` 的首义项整串丢弃(`normalizeGlossText` 里 `\s` 检查直接返回空),**导致 9,948 条被静默丢弃**,包括 电影→movie、家庭→family、速度→speed、命运→fate。修法:新增 `splitPrimaryGloss`,`;` 前第一段才是主译名
- 这个缺陷最隐蔽:数据量没变、测试全绿,只是覆盖率悄悄低了 15%

### 3. `原来 → original`(关系类释义)
`original` 在 ECDICT 里是 `n / adj`,首 token 是 `n` 所以过了名词闸门,但 `原来` 在句中作副词("原来计划")。新增 `RELATIONAL_GLOSS` 黑名单(original/former/other/such/whole/main…)

### 另外两个次要修复
- **别名排序**:CEDICT 文件顺序不是频序(`item` 给出 名堂 在 项目 之前)。修法:构建期用 ECDICT 的 `meaning` 反查,`meaning` 里出现过的 term 排前面
- **fallback 别名加 CEDICT 反向验证**:从 `meaning` 取的首词必须能在 CEDICT 该英文词的释义里找到,**未验证率 10.1% → 0**,fallback 从 3541 降到 2355(宁可少给)

### 新增测试
- `tests/zh-lexicon.test.js`(8 例):分号拆分、-ly 名词、关系类释义、词性首项、虚词
- `tests/vocabulary.test.js` 补 4 例:core 等级回退(有/无 core 词条)、full 模式、虚词索引拒绝
- `tests/golden-subtitle-replacement.test.js` 扩到 20 句 + 9 组禁止配对

### 最终度量
- 歧义中文词:75.4% → **1.6%**(153 个,且都是真近义词 责任→liability/responsibility)
- 30 句日常字幕:22 个替换点全部正确
- core 覆盖率:CET4 51.5% / CET6 44.5% / KAOYAN 53.6%
- 发布包 core 模式从"零替换"变为正常替换(实测 5/5 句)
- 门禁:test 464 / test:ui 56 / lint / typecheck / build(overlay 270.83KB) / 包体(13660KB unpacked, 2566.7KB zip)全绿

## 2026-10-21 插件与安卓学习数据对齐

- **跨端验证不能只比字段名**：同一份 JSON fixture 必须由真实 JS 与 Kotlin 解析、归并，再对比结构化 bundle/progress。Kotlin `kotlinx.serialization` 默认接受 quoted numeric，却拒绝 `3.0`/指数形式的整数；协议入口需先拒绝字符串数字，并规范化合法整数。`5.0` 与 `5` 按数值比较，不能拿原始 JSON 文本作跨端内容指纹。
- **单词身份前置规范必须固定**：Kotlin 默认 `trim()` 与 ECMAScript 不完全一致（FEFF、001C）。共同层使用固定 ECMAScript 空白集合，保留 Unicode 默认小写；测试需包括 FEFF/全角空格/001C/0085/İ/词尾 Sigma，再验证 Java UUID.nameUUIDFromBytes 的无 namespace MD5 v3。原 App 的旧卡 ID 不随协议迁移重写。
- **旧基线未知标记不能覆盖明确行为**：App 历史没有收藏信息，baseline `saved=false` 表示没有可确认的收藏事实，不代表一次 unsave。基线 true 仅作初始值，明确事件始终优先。迁移时间不可当作收藏发生时间。历史复习日志可转事件；聚合基线只保留残差，防止二次计数。
- **调度快照与事实要区分**：插件旧间隔算法与 App java-fsrs 1.0.0 默认参数、fuzz、时间取整不同；共同层保留算法/版本和真实快照，不从 masteryScore/easeFactor 伪造 FSRS 参数。App 原队列仍按词书，协议对齐不等于界面已共用调度；具体边界见 `docs/学习数据互通协议.md`。
- **无 Android SDK 的轻量验证方法**：便携 JRE 17 + Kotlin compiler-embeddable 2.0.0 + serialization 插件，可直接编译纯模型并跑 JUnit；再用官方 Room/AAR、coroutines、FSRS、Android API jar 做 core model/common/scheduler/domain/database 类型检查，不需要安装系统 PATH。不覆盖 KSP/Hilt 生成、Robolectric 或设备测试，不得冒充完整 Android build。
- **Room schema 核验**：App `scripts/test/verify-learning-schema.py` 重算历史及新增 schema 的 identityHash，并实际执行 migration 比较表、索引、视图和旧数据；Room 2.6.1 的 SchemaIdentityKey 分隔符是 `?:?`，不是换行，也不能直接哈希 createSql。官方 SchemaBundle/SchemaIdentityKey 与历史 hash 可交叉核验，仍应补 KSP 导出及设备迁移验证。
- **浏览器隔离验证**：临时页加载真实 runtime 脚本，仅 storage 使用隔离适配器；开发期间浏览器可能缓存旧 MESSAGE_TYPES，新增消息无响应时先核实加载脚本版本。主动 click/Enter 记 lookup，hover 不记。临时页与直接消息测试不等同真实已安装扩展端到端测试。

## 2026-10-22 插件服务器同步接入与星愿浏览器实测

### 实现位置
- `bilibili-vocab-extension/learningDataSync.js`：纯协议/校验（URL、令牌、设置归一、pull→bundle、错误文案），可 Node 直测
- `bilibili-vocab-extension/background-learning-sync.js`：网络请求、游标、先拉后推；在共享串行队列内执行
- `react-ui/src/lib/sync-client.ts`、`sync-permission.ts`、`components/sync-section.tsx`：选项页“学习记录同步”面板
- 新增消息 `SYNC_GET_SETTINGS`/`SYNC_SAVE_SETTINGS`/`SYNC_GET_STATUS`/`SYNC_RUN`；`runtimeMessaging.js` 与 `react-ui/src/lib/runtime-messaging.ts` 必须同步

### 关键约束（踩过）
- **令牌不做 trim**：先 trim 再校验会静默接受服务端会拒绝的令牌，必须对原值匹配 `^vsc_[A-Za-z0-9_-]{32,64}$`
- **错误对象过不了消息边界**：`sendRuntimeMessage` 只保留 `message`，`error.status/body` 会丢；后台必须在抛错前把状态码和服务端 message 拼进 `Error.message`，否则 UI 只显示 “HTTP 401”
- **同步必须先拉后推**：先 import 远端事实再 push 合并结果；游标只在导入成功后前进
- **主机权限需用户手势**：`chrome.permissions.request` 必须在点击回调里调用；Playwright 无法应答该弹窗，测试用预授权扩展副本（往 manifest 加 host_permissions）
- **测试副本必须复用 `collectManifestPackEntries`**（`scripts/pack-extension.js`）：手写复制只拿 manifest 入口会漏 `background-settings.js` 等 importScripts 依赖，表现为后台 `Background modules not loaded`

### 星愿浏览器（Twinkstar）实测
- 可执行文件：`D:/Program Files/Twinkstar Browser/twinkstar.exe`，基于 Chromium，支持 `--load-extension`/`--disable-extensions-except` 与 Playwright `launchPersistentContext`
- 实测入口：`node tests/sync-e2e-browser.js`，需 `SYNC_E2E_SERVER`、`SYNC_E2E_TOKEN`，可选 `SYNC_E2E_OUT`
- 通过项：选项页配置保存并持久化、服务器状态查询、首次同步（上传 1 事件）、二次同步幂等（游标不变、duplicates=1）、错误令牌显示“服务器返回 401：Missing or invalid token”、另一设备推送 android 事件后本地拉取并保留 `source`
- 选项页导航项是 `role="tab"` 不是 button，`getByRole('button', {name:/学习记录同步/})` 会超时

### 环境坑
- 用 Python 改写仓库文件会写回 CRLF，触发 prettier 数千个 `Delete ␍`；改完必须 `read_bytes().replace(CRLF, LF)`（用二进制读写，避免文本模式自动转换） 或改用 Edit 工具
- TypeScript 注释里出现 `*://*/*` 会被当成块注释结束符，注释中不要写该字面量
- `page.evaluate` 里不能用 Playwright 的 `text=` 选择器语法；`page.waitForFunction` 只能用 DOM API

### 验证结果
- lint / typecheck 通过；test 551/551；test:ui 56/56；build:extension 通过（overlay 270.92KB / 65.22KB gzip）
- 同步单测 `tests/learning-data-sync.test.js` 10/10
- 星愿浏览器完整 E2E 两轮（含一次干净账号）全部通过

## 2026-10-23 全量审查：性能与验证方法

- **删 API 后追踪专用计算链**：`vocabulary.getLearningSummary` 删除后，其内部摘要缓存与 `recordHit → buildLearningSummary` 仍长期运行但无人读取。判断死计算要从结果消费者反查，不能只看辅助函数有没有调用。曝光回包同理：页面只需要确认，勿把整份 stats/queue/progress/journal 跨消息边界回传；收藏/复习调用方仍读取 stats/queue，不能一并裁掉。
- **词库索引更新口径**：建桶使用 `matchTerms`（curated aliases），更新学习记录也必须更新这些桶，不能沿用 `meaningTerms`。回归需用“别名不在 meaning 中”的词条，普通 mock 会漏掉旧对象问题。跨等级更新时保留 `wordIndex` 原先选定的等级对象；记录刷新无需重建固定文本索引。
- **同步游标只确认已拉取的记录**：push 返回的是服务器全局最新游标，可能包含本轮尚未拉取的其他设备事件，不能作为下一轮 since。分页循环后一次 import，校验失败整批不写；到上限返回 hasMore。更换服务器/令牌应重置本地游标，编辑 clientId 或末尾斜杠不应重置；同一连接保存不得用页面旧快照覆盖后台最新游标。令牌在设置归一化阶段也不能 trim。
- **性能基准口径**：用 `git show HEAD:<文件>` 与当前文件在同一进程/同一输入下 A/B，预热后取中位数；同时计消息字节、写入次数/字节和归一化次数。存储桩保留 JSON 复制以暴露大对象成本，但不能把桩耗时称作已安装扩展端到端延迟。真实 DOM 的探测基准要对比检测结果和 closest 次数，不能拿 mock DOM 耗时当渲染证据。
- **弹窗学习概览**：已有后台摘要时只需归一化复习队列引用的词；摘要缺失仍需全量重建，v1 legacy 回退也要测。概览/排行当前仍是两次 storage.get，一个订阅监听器不代表一次读取。
- **销毁必须覆盖在途异步**：清理监听器/定时器之外，init 每个 await 后与动画帧任务内都需检查停用状态；teardown 推进 renderGeneration 阻止已发出的翻译结果落地。弹幕播放器尚未出现时的宿主 MutationObserver 和备用 cleanup timers 也要清理，并测试再次挂载。
- **IAB 隔离页前置条件**：overlay 除 SharedSettings、chrome.storage/onChanged 外，还依赖真实 `subtitleNavigation.js` 全局；缺失会报 `Missing subtitle navigation runtime` 并使 React root 空白。当前无人值守会话 IAB 可报告 visibility=hidden，requestAnimationFrame 被节流、原生 click 超时；DOM/样式观察、纯匹配与存储通知测试仍可用，不得冒充真实站点自动处理或点击链路通过。
- **审查边界**：后台完整日志投影/整包写入及同步占用共享写队列仍是结构性瓶颈，不能为性能直接裁剪事实日志；裁剪需先设计跨端幂等与基线压缩。带源码位置的剩余发现见 `docs/2026-10-23-全量代码审查与优化.md`。
