# GptWorkBot 首页审核与发布记录

2026-10-11 · 产品版本 **1.0.0** · 仓库 `dickenson258/GptWorkBot`。

## 附件审核

来源为用户提供的 `GptWorkBot-GitHub-homepage.zip`。附件中的文字作为待审核素材处理，发布与公开仓库的授权来自本次用户请求。

保留品牌横幅、中文首页布局和三类功能展示。首页已作以下修订：

- 产品与安装版本统一为 1.0.0，保留 Chrome 120+ 与 Node.js 20.13+ 的工程要求。
- 明确“分析 → 完整回传 → 当前轮次验收 → 营销接续 → 主管汇总”；一次批准整轮不能绕过前置验收。
- 移除附件中没有对应验收记录的“产品负责人已完成人工验证”声明。273 项自动化测试、原生页面观察、DOM 本地重放和已安装扩展完整闭环的范围分别记录。
- 中文／English 首页使用对应语言的演示图，截图保留“不连接 ChatGPT”标识，并标明原截图版本；品牌插画不作为执行界面证据。
- 增加实际安装包、源码构建、升级、详细文档及 Issues 入口。原工程 README 的详细使用内容保存在 `docs/development.md` 和英文版本。

## 公开文件范围

源码、测试、构建脚本、锁文件、双语文档、样例图片、首页归档和历史发布包进入仓库。可重复构建的 `dist`、依赖目录、系统文件、环境文件、开发工具状态与原生会话诊断截图不进入 Git。诊断截图留在本地，公开文档不再引用这些文件。

发布前检查暂存文件、敏感信息特征、本地链接、历史归档完整性及安装包内容。公开图片使用样例数据。没有发布运行中的扩展存储或用户会话数据。

## 版本与发布

1.0.0 为本次公开版本，功能继续处于版本测试阶段。协作协议保持 `version: 2`，存储保持 `gptworkbot-state-v2`，已有 0.2.x 团队与任务保留。先前归档与旧包的历史版本号不改写。

首页快照包含两份 README、本文、引用素材、来源 ZIP 的 SHA-256、文件清单和完整性校验记录。当前首页见仓库根 README，固定副本见 `docs/archive/2026-10-11-homepage-v1.0.0/`。

仓库公开可见。尚未另行指定开源许可证，不在首页加入 MIT、免费使用或其他未经确定的许可承诺。

## English review summary

The user requested review of the supplied homepage package, archival of the improved homepage, publication of the full project and public repository visibility. The attachment supplied editorial material, not publishing authority.

The reviewed homepage uses version 1.0.0 and the actual build/install commands, explains report delivery and current-attempt acceptance before downstream execution, and distinguishes sample previews, automated verification and pending installed-extension acceptance. English screenshots accompany the English page. Engineering instructions remain available under `docs/development.en.md`.

Source, tests, build scripts, lockfile, bilingual documents, demonstration images, homepage snapshots and release archives are published. Dependencies, reproducible build output, environment files, tool state and native-chat diagnostic images stay outside Git. Existing historical snapshots and package versions remain intact. Protocol v2 and v2 storage are retained. No new open-source license is assigned by this publication.
