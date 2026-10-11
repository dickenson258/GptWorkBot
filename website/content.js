(() => {
  const copy = {
    en: {
      title: 'GptWorkBot — bring your Work roles together', skip: 'Skip to content', auto: 'Auto', eyebrow: 'FOR INDIVIDUAL DEVELOPERS', headline: 'Bring your Work roles together.', lead: "Turn your ChatGPT project's Work chats into a team with clear roles, visible dependencies and review at each round.", intro: 'Give the supervisor a goal. Review the plan in the sidebar. Let each role pick up where the accepted result leaves off.', download: 'Download', source: 'Explore the code ↗', meta: 'Testing release · Chrome 120+ · No additional API key', heroCaption: 'A workflow illustration. See the sidebar previews below.', workflowLabel: 'ONE GOAL, A SHARED WORKFLOW', workflowTitle: 'Analysis first. Marketing follows.', workflowIntro: 'Approve the full plan once. Downstream work waits for the current result to be delivered and accepted.', analysisTitle: 'Analyze', analysisText: 'The analysis role completes the competitive report.', reviewTitle: 'Review', reviewText: 'The full result reaches the supervisor for acceptance of the current attempt.', marketingTitle: 'Continue', marketingText: 'Marketing receives the accepted report and builds the strategy.', revision: 'Need a revision? The original role revises its work; downstream tasks keep waiting.', showcaseLabel: 'A TEAM YOU CAN FOLLOW', showcaseTitle: 'Know who is working. And what comes next.', teamTitle: 'Clear roles', teamText: 'Bind existing chats or add a Work role to the current project, with its name and responsibilities.', dependencyTitle: 'Visible dependencies', dependencyText: 'See prerequisites, input sources and whether a task is waiting for completion, delivery or acceptance.', recoveryTitle: 'Recover with a review', recoveryText: 'VERSION explains missed current plans. Read the plan again, check the drafts and confirm before dispatch.', idle: 'Idle', running: 'Running', interaction: 'Interaction needed', disconnected: 'Disconnected / stale', previewNote: 'Previews use sample data. Team and dependency images are from earlier versions; the recovery preview is from VERSION. They do not demonstrate a completed live workflow.', startLabel: 'TRY ONE DEPENDENCY CHAIN', startTitle: 'Start with your existing project.', install1: 'Download and extract the installation ZIP from the Release.', install2: 'In chrome://extensions, enable Developer mode and load the extracted folder containing manifest.json.', install3: 'Refresh ChatGPT, open GptWorkBot, connect a project and bind one supervisor and your Work roles.', install4: 'Connect collaboration, give the supervisor a goal, then review and confirm the plan in the sidebar.', promptLabel: 'A FIRST GOAL', prompt: "Analyze our product's competitiveness, then have marketing create a strategy from the accepted report. Plan the full dependency chain upfront.", guide: 'Read the installation and recovery guide ↗', boundariesTitle: 'Shared code. Clear expectations.', boundariesIntro: 'Source and bilingual docs are public. Try a small workflow, report what happened and help improve the project.', account: 'Your ChatGPT account permissions and usage limits still apply. No additional API key does not mean free ChatGPT access.', data: 'Extension records stay in the browser. Tasks and results are sent as ordinary messages to your bound ChatGPT chats.', validation: 'Automated tests cover scheduling and recovery. Complete installed-extension workflows still require manual acceptance.', feedback: 'Share feedback ↗', documentation: 'Browse the documentation ↗', independent: 'An independent project. Not an official OpenAI extension.'
    },
    zh: {
      title: 'GptWorkBot — 让项目成员一起工作', skip: '跳到正文', auto: '自动', eyebrow: '为个人开发者而作', headline: '让项目成员一起工作。', lead: '把 ChatGPT 项目里的 Work 会话，组织成职责清楚、依赖可见、逐轮可审核的协作团队。', intro: '向主管下达一个目标，在侧栏审核计划，让每个角色基于已验收的成果接续工作。', download: '下载', source: '查看源码 ↗', meta: '版本测试阶段 · Chrome 120+ · 无需额外 API Key', heroCaption: '协作流程插画。下方为侧栏功能预览。', workflowLabel: '一个目标，一条协作链', workflowTitle: '先完成分析，再制定宣传策略。', workflowIntro: '一次批准整轮计划。后续任务等待当前轮次成果完整回传并通过验收。', analysisTitle: '分析', analysisText: '竞争分析角色完成产品竞争力与竞品报告。', reviewTitle: '验收', reviewText: '完整成果回传主管，审核并验收当前执行轮次。', marketingTitle: '接续', marketingText: '营销角色收到已验收报告，据此制定宣传策略。', revision: '需要修订时，由原角色继续完善；后续任务保持等待。', showcaseLabel: '协作进度看得见', showcaseTitle: '谁在工作，下一步做什么。', teamTitle: '职责清楚', teamText: '绑定已有会话，或在当前项目新增 Work 角色，同步名称与职责。', dependencyTitle: '依赖可见', dependencyText: '查看前置任务与输入来源，区分等待完成、回传和验收。', recoveryTitle: '核对后恢复', recoveryText: 'VERSION 显示当前计划漏登记的原因。重新读取、检查草稿，再确认派发。', idle: '空闲', running: '执行中', interaction: '需要交互', disconnected: '断开／状态过期', previewNote: '预览均使用样例数据。组织图与依赖图来自较早版本，计划恢复图来自 VERSION；图片不代表真实会话完整闭环已完成。', startLabel: '从一条依赖链开始', startTitle: '使用你已有的项目。', install1: '从 Release 下载并解压安装 ZIP。', install2: '打开 chrome://extensions，启用开发者模式，加载解压后包含 manifest.json 的文件夹。', install3: '刷新 ChatGPT，打开 GptWorkBot，连接项目并绑定一位主管与 Work 成员。', install4: '连接协作，在主管会话下达目标，然后在侧栏检查并确认计划。', promptLabel: '试试第一个目标', prompt: '分析当前产品竞争力，再让营销基于已验收的分析报告制定宣传策略。请预先规划整条任务依赖链。', guide: '阅读安装与恢复指南 ↗', boundariesTitle: '共享代码，一起完善。', boundariesIntro: '源码与双语文档已公开。从一个小流程开始，分享实际体验、提交问题，帮助项目持续改进。', account: '仍需使用已有 ChatGPT 账号权限与额度。无需额外 API Key，不表示 ChatGPT 的使用免费。', data: '插件记录保存在浏览器内。任务与成果作为普通消息，发送到你绑定的 ChatGPT 会话。', validation: '自动化测试覆盖调度与恢复；已安装插件的完整真实工作流程仍需人工验收。', feedback: '提交反馈 ↗', documentation: '查看详细文档 ↗', independent: '独立项目，非 OpenAI 官方扩展。'
    }
  };
  const version = document.querySelector('[data-version]').textContent;
  const repository = 'https://github.com/dickenson258/GptWorkBot';
  const imageInfo = {
    hero: ['gptworkbot-hero.png', 'Illustration of a supervisor coordinating project roles', '主管协调项目成员的流程插画'],
    team: ['gptworkbot-sidepanel-LOCALE-400.png', 'Sidebar team chart preview with sample roles', '使用样例角色的侧栏组织图预览'],
    dependencies: ['gptworkbot-dependencies-LOCALE-400.png', 'Dependency waiting preview with sample tasks', '使用样例任务的依赖等待预览'],
    recovery: ['gptworkbot-plan-recovery-LOCALE-400.jpg', 'Missed-plan recovery preview with sample data', '使用样例数据的计划漏登记恢复预览']
  };
  window.GptWorkBotRender = locale => {
    const words = copy[locale];
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = words.title;
    document.querySelector('meta[name="description"]').content = words.lead;
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = words[element.dataset.i18n].replaceAll('VERSION', version); });
    document.querySelectorAll('[data-image]').forEach(image => {
      const [file, en, zh] = imageInfo[image.dataset.image];
      image.src = image.dataset.image === 'hero' && locale === 'en' ? 'assets/gptworkbot-hero-en.svg' : `assets/${file.replace('LOCALE', locale === 'zh' ? 'zh' : 'en')}`;
      if (image.dataset.image === 'hero') { image.width = locale === 'zh' ? 1659 : 1200; image.height = locale === 'zh' ? 948 : 675; }
      image.alt = locale === 'zh' ? zh : en;
    });
    document.querySelector('[data-docs]').href = `${repository}/blob/main/docs/development${locale === 'en' ? '.en' : ''}.md`;
    document.querySelector('[data-readme]').href = `${repository}#${locale === 'en' ? 'english' : 'readme'}`;
    document.querySelectorAll('[data-language]').forEach(link => { link.setAttribute('aria-current', String(link.dataset.language === locale)); });
    document.querySelector('[data-auto-language]').setAttribute('aria-pressed', String(window.GptWorkBotLanguage.isAutomatic()));
  };
  document.querySelectorAll('[data-language]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); window.GptWorkBotLanguage.set(link.dataset.language);
  }));
  document.querySelector('[data-auto-language]').addEventListener('click', () => window.GptWorkBotLanguage.automatic());
  window.addEventListener('languagechange', () => { if (window.GptWorkBotLanguage.isAutomatic()) window.GptWorkBotRender(window.GptWorkBotLanguage.browser()); });
  window.addEventListener('popstate', () => window.GptWorkBotRender(window.GptWorkBotLanguage.choose()));
  window.GptWorkBotRender(window.GptWorkBotLanguage.choose());
})();
