# Bilibili Subtitle Vocabulary

> 在 Bilibili / YouTube 字幕里低打扰插入英文词汇，把刷视频变成碎片时间英语输入。

[![License: MIT](https://img.shields.io/badge/License-MIT-terracotta.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.3-terracotta.svg)](CHANGELOG.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-terracotta.svg)](CONTRIBUTING.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-terracotta.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)

Bilibili Subtitle Vocabulary 是一个浏览器扩展，让字幕成为隐性英语输入通道。它会在你观看 Bilibili 或 YouTube 视频时，按你设定的难度和密度，把字幕中的部分中文词汇替换为对应难度的英文单词，并提供轻量复习闭环，让"刷视频"和"背单词"自然融合。

---

## 目录

- [为什么做这个](#为什么做这个)
- [功能特性](#功能特性)
- [截图与界面](#截图与界面)
- [快速安装](#快速安装)
- [使用指南](#使用指南)
- [支持站点](#支持站点)
- [隐私与权限](#隐私与权限)
- [数据与许可证](#数据与许可证)
- [本地开发](#本地开发)
- [测试](#测试)
- [项目结构](#项目结构)
- [设计系统](#设计系统)
- [贡献指南](#贡献指南)
- [更新日志](#更新日志)
- [路线图](#路线图)
- [许可证](#许可证)

---

## 为什么做这个

背单词 App 的核心痛点是**脱离语境**：单词进了短期记忆，但缺少真实使用场景，遗忘曲线陡峭。

Bilibili 和 YouTube 上有海量带中英字幕的视频，是天然的语境素材。本扩展做了一件简单的事：**在你已经观看的字幕里，按你设定的难度，把一部分中文替换成英文**。这样：

- **零额外时间成本**：不需要专门打开背单词 App，刷视频即学习。
- **真实语境曝光**：每个英文词都嵌在原字幕的句子里，附带原文对照。
- **低打扰**：替换比例、单句上限、词库等级都可调，不会破坏观看体验。
- **轻量复习闭环**：tooltip 收藏、Popup 快速复习、复习弹幕、连续学习进度，形成"曝光 → 收藏 → 复习 → 巩固"的最小循环。

---

## 功能特性

### 字幕词汇替换

- 按替换比例（0–100%）、单句上限、目标难度（CEFR A1–C2）、词库等级（CET4 / CET6 / TOEFL / IELTS / 考研）控制曝光密度。
- 自动跳过人名、地名、专有名词，避免破坏语义。
- 鼠标悬停替换词可查看原文与释义 tooltip，一键收藏到生词本。

### 视频内学习面板（Overlay）

- 浮动控制面板，支持开关、策略调节、今日进度、最近词汇、字幕句级导航。
- 毛玻璃质感、入场动画、可拖拽、可最小化为 FAB。
- 快捷键：`Ctrl+Shift+O` 开关面板，`Ctrl+Shift+E` 开关替换，`Ctrl+Shift+Up/Down` 调节比例。

### 轻量复习闭环

- **Tooltip 收藏**：悬停替换词 → 一键加入生词本。
- **Popup 快速复习**：浏览器工具栏图标 → 今日待复习卡片。
- **生词排行**：按曝光次数、收藏时间、难度排序。
- **复习弹幕**：在视频上方以弹幕形式循环播放生词，强化记忆。
- **连续学习进度**：streak 统计，激励每日曝光。

### 自动调优

- 根据误替换反馈（"这个词不该替换"）和复习行为（哪些词反复忘记）自动微调策略。
- 可在 Options 中关闭，纯手动控制。

### Onboarding 引导

- 首次安装后 30 秒上手：选择目标难度、词库、替换比例。
- 可随时在 Options 中重新触发。

### 多入口同步

- **Popup**：快速控制（开关、比例、今日进度）。
- **Options**：完整配置中心（词库、难度、复习、权限、数据导出）。
- **Overlay**：视频内浮动面板。
- 三入口共享同一套设置和学习状态，基于 `chrome.storage.local` 实时同步。

### 最小权限发布

- 默认自动注入范围仅限 Bilibili 和 YouTube。
- 非默认站点需要用户主动授权（`optional_host_permissions: *://*/*`）。
- 零遥测、零远程翻译服务，数据默认保存在本地；可自行配置服务器，手动同步学习记录。

---

## 截图与界面

- **Popup**：工具栏图标点击后弹出，展示当前页面状态、今日进度、快速开关。
- **Options**：完整配置中心，侧边栏导航，分模块设置。
- **Overlay**：视频内浮动面板，毛玻璃质感，可拖拽可最小化。

---

## 快速安装

### 方式一：商店安装（推荐普通用户，待上架）

<!-- TODO: replace with store links once published -->

- [Chrome Web Store]()
- [Microsoft Edge Add-ons]()

### 方式二：下载 Release（推荐普通用户）

1. 前往 [Releases](https://github.com/242282218/Bilibili-Subtitle-Vocabulary-Extension/releases) 下载最新版本附件 `bilibili-vocab-extension-v0.1.3.zip`。
2. 解压到任意目录。
3. 打开 Chrome / Edge 的扩展管理页（`chrome://extensions` 或 `edge://extensions`）。
4. 开启右上角"开发者模式"。
5. 点击"加载已解压的扩展程序"，选择解压后的 `bilibili-vocab-extension` 目录。
6. 打开带字幕的 Bilibili 或 YouTube 视频，点击扩展图标调整策略。

### 方式三：从源码构建（推荐开发者）

```bash
git clone https://github.com/242282218/Bilibili-Subtitle-Vocabulary-Extension.git
cd Bilibili-Subtitle-Vocabulary-Extension/bilibili-vocab-extension
pnpm install --frozen-lockfile
pnpm run build:extension
```

React 界面构建产物位于 `bilibili-vocab-extension/dist/`。按“方式二”步骤 3–6 加载包含 `manifest.json` 的 `bilibili-vocab-extension/` 目录即可。

---

## 使用指南

### 首次使用

1. 安装后打开任意 Bilibili 或 YouTube 视频。
2. 点击扩展图标，按 Onboarding 引导选择目标难度和词库。
3. 字幕中会出现少量英文替换词，悬停可查看原文与释义。
4. 觉得打扰？在 Popup 中调低替换比例。觉得太简单？调高比例或切换更高难度词库。

### 日常使用

- **刷视频时**：自然阅读字幕，遇到替换词悬停查看释义，想记下来就点收藏。
- **休息时**：点扩展图标 → Popup 快速复习今日生词。
- **想强化记忆**：在 Overlay 中开启"复习弹幕"，视频上方会循环播放生词。
- **想精细调整**：右键扩展图标 → 选项，进入 Options 完整配置中心。

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+E`（Mac: `Cmd+Shift+E`） | 开关字幕替换 |
| `Ctrl+Shift+O`（Mac: `Cmd+Shift+O`） | 开关悬浮控制面板 |
| `Ctrl+Shift+Up`（Mac: `Cmd+Shift+Up`） | 提高词汇替换比例 |
| `Ctrl+Shift+Down`（Mac: `Cmd+Shift+Down`） | 降低词汇替换比例 |

---

## 支持站点

| 站点 | 支持程度 | 说明 |
| --- | --- | --- |
| Bilibili 视频页 | 完整支持 | 通过 Bilibili 官方播放器 / 字幕 API 获取字幕 |
| YouTube 视频 / 直播 / Shorts | 完整支持 | 从页面 caption DOM 读取字幕 |
| 其他站点 | 需手动授权 | 在 Options 中开启"网页正文模式"并授权该站点 |

---

## 隐私与权限

本扩展遵循**本地优先、零遥测、最小权限**原则。

- **数据存储**：设置、生词本、复习队列、学习指标默认存储在 `chrome.storage.local`。
- **可选学习记录同步**：在 Options 中自行配置服务器地址和令牌、授权服务器主机后，可点击“立即同步”交换学习记录。同步数据范围见[隐私政策](docs/隐私政策.md)。
- **网络请求**：请求 Bilibili 官方字幕 API，以及用户主动配置的同步服务器；YouTube 字幕从页面 DOM 读取；无第三方分析、广告或远程翻译服务。
- **权限范围**：默认仅 Bilibili 和 YouTube；其他站点和同步服务器需用户主动授权。
- **数据导出**：可在 Options 中一键导出 / 导入全部学习数据（JSON）。

详细权限清单与数据流见：

- [权限说明](docs/权限说明.md)
- [隐私政策](docs/隐私政策.md)

---

## 数据与许可证

- **项目代码**：[MIT License](LICENSE)
- **词库数据**：由多个公开来源构建，发布包使用 publish-safe 数据集。各来源署名与再分发边界见 [词库来源与许可证](docs/词库来源与许可证.md)。

---

## 本地开发

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 9（推荐使用 [corepack](https://nodejs.org/api/corepack.html) 启用）
- Chrome / Edge ≥ 120

### 安装依赖

```bash
cd bilibili-vocab-extension
pnpm install --frozen-lockfile
```

### 常用脚本

```bash
pnpm run dev              # 启动 React UI 本地开发（Vite HMR）
pnpm run lint             # ESLint 检查（--max-warnings 0）
pnpm run typecheck        # TypeScript 类型检查
pnpm run test             # 运行单元测试（node --test）
pnpm run test:ui          # 运行 UI 契约测试
pnpm run build            # 构建 Options / Popup（含 typecheck）
pnpm run build:extension  # 构建完整扩展产物（含 overlay size 检查）
pnpm run pack             # 生成 bilibili-vocab-extension/extension.zip
pnpm run release:check    # 串行执行发布候选检查
```

### 开发工作流

1. `pnpm run dev` 启动 Vite，修改 `react-ui/src` 下代码即时热更新。
2. 修改 content script / background 后需 `pnpm run build:extension` 重新构建。
3. 在 `chrome://extensions` 点击扩展卡片"刷新"按钮重新加载。
4. 提交前运行 `pnpm run lint && pnpm run typecheck && pnpm run test`。

### 开发文档

- [`docs/architecture.md`](docs/architecture.md) — 模块职责、数据流与存储层说明。
- [`docs/release-checklist.md`](docs/release-checklist.md) — 发布前检查清单与版本/tag 流程。

---

## 测试

### 测试分层

| 层级 | 命令 | 用途 |
| --- | --- | --- |
| 单元测试 | `pnpm run test` | 纯逻辑模块（vocabulary、subtitleParser、translator 等） |
| UI 契约测试 | `pnpm run test:ui` | React UI 组件契约（popup、options、overlay） |
| 扩展冒烟 | `pnpm run test:extension-smoke` | 构建后加载到真实浏览器验证基础流程 |
| ZIP 冒烟 | `pnpm run test:zip-smoke` | 打包后解压验证 manifest 完整性 |
| 真实站点冒烟 | `pnpm run test:real-site-smoke` | 在测试机上对真实 Bilibili / YouTube 验证 |
| 覆盖率 | `pnpm run test:coverage` | 生成测试覆盖率报告 |

### CI

GitHub Actions 工作流见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)，包含 lint、test、test:ui、build:extension、pack、windows smoke。

### 远程测试机

需要真实浏览器环境的集成测试在测试机上执行，脚本位于 `bilibili-vocab-extension/scripts/test/`。详见 [CONTRIBUTING.md](CONTRIBUTING.md) 中的"测试机使用"章节。

---

## 项目结构

```
Bilibili-Subtitle-Vocabulary-Extension/
├── bilibili-vocab-extension/          # 扩展根目录（Manifest V3）
│   ├── manifest.json                  # 扩展清单
│   ├── background.js                  # Service worker 入口
│   ├── contentScript/                 # 内容脚本模块化重构
│   ├── react-ui/                      # React UI 源码（Popup / Options / Overlay）
│   │   └── src/
│   │       ├── components/            # UI 组件
│   │       ├── hooks/                 # 自定义 Hooks
│   │       ├── lib/                   # 业务逻辑库
│   │       ├── styles/                # 设计 token 与样式
│   │       └── types/                 # TypeScript 类型
│   ├── data/                          # 词库数据（构建产物）
│   ├── sources/                       # 词库原始来源
│   ├── scripts/                       # 构建 / 测试 / 打包脚本
│   ├── tests/                         # 测试文件
│   ├── *.js                           # 内容脚本与背景脚本
│   └── vite.config.mts                # Vite 构建配置
├── docs/                              # 产品文档
│   ├── 权限说明.md
│   ├── 隐私政策.md
│   └── 词库来源与许可证.md
├── .github/                           # GitHub 配置
│   ├── workflows/                     # CI 工作流
│   ├── ISSUE_TEMPLATE/                # Issue 模板
│   └── PULL_REQUEST_TEMPLATE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── LICENSE
└── README.md
```

---

## 设计系统

本扩展采用 **Evidence Warm Precision** 设计语言：

- **主色**：赤陶色（terracotta），温暖、克制、不喧宾夺主。
- **语义色**：success / warning / error / info，各有 soft 变体用于低打扰场景。
- **层次**：5 层阴影、7 层圆角、9 层间距、完整字体阶梯。
- **动效**：instant / fast / normal / slow / slower 五档 + spring easing。
- **暗色模式**：更暖的深色背景，更亮的强调色，全程适配。
- **设计 token**：基于 CSS 自定义属性，见 [`react-ui/src/styles/tokens.css`](bilibili-vocab-extension/react-ui/src/styles/tokens.css)。
- **完整规范**：设计 token、组件模式与使用指南见 [`docs/design-system.md`](docs/design-system.md)。

---

## 贡献指南

欢迎贡献！请先阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发流程、代码规范、提交格式、测试要求
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — 贡献者公约
- [SECURITY.md](SECURITY.md) — 漏洞报告政策
- [docs/architecture.md](docs/architecture.md) — 架构与模块数据流
- [docs/release-checklist.md](docs/release-checklist.md) — 发布前检查清单

### 快速贡献

1. Fork 仓库并克隆到本地。
2. 创建分支：`git checkout -b feat/your-feature`。
3. 提交前确保 `pnpm run lint && pnpm run typecheck && pnpm run test` 通过。
4. 提交 PR，描述动机、改动、测试方式。

### 贡献方向

- **新词库**：补充更多难度等级的词库（如 GRE、专四专八）。
- **新站点适配**：适配更多带字幕的视频站点。
- **复习算法**：优化间隔重复算法，提升记忆效率。
- **UI / UX**：视觉打磨、交互优化、可访问性提升。
- **文档**：补全使用教程、开发指南、设计说明。
- **国际化**：补充更多语言界面。

---

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

---

## 路线图

当前重点是将 Bilibili Subtitle Vocabulary 打磨为可长期维护的开源产品：设计系统文档化、可访问性补齐、发布流程标准化，并为 Chrome Web Store / Edge Add-ons 上架做好准备。

- **v0.2**
  - 间隔重复算法（SM-2）
  - Anki 导出
  - 生词本分组
  - 设计系统固化与文档化（token、组件、暗色/对比度验证）
  - 可访问性基础（键盘导航、语义化、focus visible）
- **v0.3**
  - 多站点适配（Netflix、Coursera）
  - 字幕翻译对照
  - 社区贡献流程（Issue/PR 模板、`good first issue` 标签、贡献者指南完善）
- **v0.4**
  - 语音朗读（Web Speech API）
  - 例句库
  - 自动化测试覆盖与发布流程强化
- **v1.0**
  - 稳定版
  - 完整文档（用户指南、开发指南、设计系统、架构、发布清单）
  - Chrome Web Store / Microsoft Edge Add-ons 上架
  - 商店就绪（截图、描述、隐私文案、最小权限说明）

---

## 许可证

[MIT License](LICENSE) © 2026 [242282218](https://github.com/242282218)

词库数据有独立许可，详见 [词库来源与许可证](docs/词库来源与许可证.md)。
