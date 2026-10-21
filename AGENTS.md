# AGENTS.md

Bilibili 字幕词汇学习浏览器扩展。主代码在 `bilibili-vocab-extension/`:原生 JS 内容脚本 + 后台 service worker + React UI(`react-ui/src`),数据词库在 `data/`。

## 任务完成后

- 提取关键经验(可复用的测试方法、运行命令、前置条件、已知限制、排障结论)保存到根目录 `memory.md`;动手前先读取并复用其中已有内容。不记录普通测试通过结果、临时日志或敏感信息。

## 验证

- 最小充分验证:`pnpm -C bilibili-vocab-extension run lint && pnpm -C bilibili-vocab-extension run typecheck && pnpm -C bilibili-vocab-extension run test`
- 涉及 UI/构建/发布:`pnpm -C bilibili-vocab-extension run test:ui`、`pnpm -C bilibili-vocab-extension run build:extension`、发布前 `pnpm -C bilibili-vocab-extension run release:check`
- 详细命令、耗时与环境坑见 `memory.md`。

## 约定

- 代码注释用英文,只说明代码无法表达的约束。
- 默认不执行 git 提交;确需提交时使用新分支,不直推 main。
- lockfile(`pnpm-lock.yaml`)必须与 `package.json` 同步提交。
