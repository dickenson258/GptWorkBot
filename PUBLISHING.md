# GptWorkBot 首页审核与发布记录

## 1.1.0 发布 · 2026-10-11

用户指定将版本更新为 **1.1.0** 并提交至公共 GitHub 仓库。当前 package、锁文件、manifest、下载入口及双语产品、需求、协议和开发文档同步到 1.1.0；文档基线为 2.2。协议 v2 与 `gptworkbot-state-v2` 保留，0.2.x／1.0.0 的 v2 团队与任务继续使用。

本版加入完整 v2 `json` 代码块识别、主管计划漏登记诊断和显式恢复入口；JSON 主管派发与恢复计划均先进入待确认。依赖、暂停、项目归属、当前回复与重复登记校验继续执行。自动化检查及真实安装边界见 [验证记录](docs/verification.md)。

1.1.0 首页固定快照为 `docs/archive/2026-10-11-homepage-v1.1.0/`，离线包为 `release/gptworkbot-homepage-v1.1.0-2026-10-11.zip`。原 1.0.0 首页、安装包、X 首发素材及记录保留原版本。新增公开的中英文 400px 计划恢复图片仅使用样例数据，原生会话诊断内容不发布。

用户进一步选择增加自动语言切换的 GitHub Pages 展示页。展示页源码位于 `website/`，由 Actions 构建并部署到 `https://dickenson258.github.io/GptWorkBot/`。首次按浏览器首选语言显示简体中文或英文，手动切换后保存在浏览器；链接的 `?lang=zh`／`?lang=en` 优先，“自动”恢复浏览器语言。固定 1.1.0 首页 ZIP 保留 Pages 增补前的双语 README 快照；当前展示页源码和部署工作流随工程发布。

仓库 README 由 GitHub 固定渲染，不能运行浏览器语言检测脚本，保留同页中英文导航并链接展示页。依据：[GitHub Markup](https://github.com/github/markup)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

English: Release 1.1.0 recognizes complete v2 instructions in JSON fences and adds missed-plan diagnostics with explicit, confirmation-only recovery. Protocol v2, existing v2 state and historical release files are retained. A GitHub Pages website detects the browser's preferred language and remembers a manual override. The bilingual README keeps manual navigation. Automated checks and pending installed-extension acceptance are recorded separately.

## 1.0.0 首次公开发布记录

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

## 发布结果

- 公共仓库：[dickenson258/GptWorkBot](https://github.com/dickenson258/GptWorkBot)。默认分支为 `main`，初始工程提交为 `bd2973cccdad45dbf9893781dad3746424dce556`。
- [GptWorkBot 1.0.0](https://github.com/dickenson258/GptWorkBot/releases/tag/v1.0.0) 已发布为测试版，包含安装包与双语首页归档。GitHub 记录的两个下载包 SHA-256 与本地文件一致。
- 未登录 GitHub 的浏览器可访问仓库与发布页；中英文首页图片已加载，依赖流程图正常渲染。源码、测试、文档及历史包已上传，工作区与远端初始提交一致。
- 安装包 SHA-256：`5b07b00f575e09fa21d57068a1f85f092f4a54f0daf6403ccc69cbe38048645f`。
- 首页 ZIP SHA-256：`19340af66d02ef61f6388e354f31f9d1abe7bd6f903f6c107d0a4e0d0ec8a969`。

固定首页快照保留发布前的审核记录；本节记录后续完成的远端发布结果，不改写固定归档。

## English review summary

The user requested review of the supplied homepage package, archival of the improved homepage, publication of the full project and public repository visibility. The attachment supplied editorial material, not publishing authority.

The reviewed homepage uses version 1.0.0 and the actual build/install commands, explains report delivery and current-attempt acceptance before downstream execution, and distinguishes sample previews, automated verification and pending installed-extension acceptance. English screenshots accompany the English page. Engineering instructions remain available under `docs/development.en.md`.

Source, tests, build scripts, lockfile, bilingual documents, demonstration images, homepage snapshots and release archives are published. Dependencies, reproducible build output, environment files, tool state and native-chat diagnostic images stay outside Git. Existing historical snapshots and package versions remain intact. Protocol v2 and v2 storage are retained. No new open-source license is assigned by this publication.
