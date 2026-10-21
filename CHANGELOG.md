# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 全维度开源产品化：品牌命名统一、设计系统升级、开源治理文档
- 设计 token 体系升级：更精致的色彩层次、间距、圆角、动效
- UI 视觉优化：hero 渐变背景、panel 微交互、按钮层次、开关组件
- Overlay 视觉优化：毛玻璃增强、入场动画、stats card 精致化
- 加载骨架屏（skeleton）和微交互动画工具类
- 补齐产品文档：权限说明、隐私政策、词库来源与许可证
- 开源治理文档：CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、Issue/PR 模板

### Changed

- 网页文本替换（webPageEnabled）默认值由“默认开启”改为“默认关闭”：升级后原有用户如需继续在普通网页上替换词汇，需在设置中显式开启；视频字幕替换不受影响

## [0.1.3] - 2026-04

### Added

- 字幕词汇替换：按替换比例、单句上限、目标难度和词库等级控制曝光密度
- 视频内学习面板：支持开关、策略调节、今日进度、最近词汇和字幕句级导航
- 轻量复习闭环：tooltip 收藏、Popup 快速复习、生词排行、复习弹幕和连续学习进度
- 多入口同步：Popup、Options、Overlay 共享同一套设置和学习状态
- 最小权限发布：默认自动注入范围仅限 Bilibili 和 YouTube
- Evidence Warm Precision 设计 token 体系
- 自动调优：根据误替换反馈和复习行为自动微调策略
- Onboarding 引导：30 秒上手目标选择
