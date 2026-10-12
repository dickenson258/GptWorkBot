import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, ChevronDown, Copy, GitBranch, Pause, Play, Plus, RefreshCw, Settings2, Square, Users, X } from 'lucide-react';
import { command, discover, openConversation, overview, preview } from './transport';
import { backgroundConnectionMessage } from '../extension/connection';
import type { Discovery, TabInfo } from './transport';
import { conversationId, emptyStore, projectIdFromUrl } from '../core/types';
import type { Agent, PanelCommand, Project, Store, Task } from '../core/types';
import { CreateRoleDialog } from './CreateRoleDialog';
import { SupervisorPlanNotice } from './SupervisorPlanNotice';
import type { CreateRoleCommand } from './CreateRoleDialog';
import { labels, stateFor, taskLabels } from '../core/state';
import { taskPrompt, creationPrompt } from '../core/protocol';
import { initialLocale, readLocale, saveLocale, systemText, translator } from './i18n';
import type { Locale } from './i18n';
import { conversationOptions, currentProjectTab } from './conversations';
import { businessTask, dependencyState } from '../core/dependencies';
import './style.css';

function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const languageChanged = useRef(false);
  const tr = translator(locale);
  const localize = (text: string | undefined) => systemText(text, locale);
  useEffect(() => {
    void readLocale().then(saved => { if (!languageChanged.current) setLocale(saved); }).catch(() => {});
  }, []);
  useEffect(() => { document.documentElement.lang = locale; document.title = `GptWorkBot · ${tr('团队组织')}`; }, [locale]);
  const changeLocale = async (next: Locale) => {
    languageChanged.current = true;
    try { await saveLocale(next); setLocale(next); setStore(current=>({...current,locale:next})); setNotice(''); setError(''); }
    catch { setError('语言设置保存失败，请重试'); }
  };
  const [store, setStore] = useState<Store>(emptyStore);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [setup, setSetup] = useState(false);
  const [settings, setSettings] = useState(false);
  const [edit, setEdit] = useState<Task>();
  const [createProject, setCreateProject] = useState<Project>();
  const createButton = useRef<HTMLButtonElement>(null);
  const [projectUrl, setProjectUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [bindingName, setBindingName] = useState('');
  const [bindingUrl, setBindingUrl] = useState('');
  const [supervisor, setSupervisor] = useState(false);
  const [verified, setVerified] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery>();
  const [batchUrls, setBatchUrls] = useState<string[]>([]);
  const [batchLead, setBatchLead] = useState('');
  const [batchVerified, setBatchVerified] = useState(false);
  const refresh = async () => { try { const data = await overview(); setStore(data.store); setTabs(data.tabs); setError(previous => previous === backgroundConnectionMessage ? '' : previous); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 2500); return () => clearInterval(timer); }, []);
  const run = async (action: PanelCommand) => {
    setBusy(true); setError(''); setNotice('');
    try { const data = await command(action); setStore(data.store); setTabs(data.tabs); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const closeCreation = () => { setCreateProject(undefined); createButton.current?.focus(); };
  const createRole = async (action: CreateRoleCommand) => {
    if (await run(action)) {
      closeCreation(); setSelected(undefined);
      setNotice(tr('已提交创建“{name}”，将加入项目“{project}”。', {name: action.name.trim(), project: createProject!.name}) + tr(store.paused ? '恢复协作后开始创建。' : '会话准备完成后显示在组织图中。'));
      window.scrollTo({ top: 0 });
    }
  };
  const unbind = async (agent: Agent) => {
    if (await run({ type: 'unbind', id: agent.id })) {
      setSelected(undefined);
      setNotice(tr('已解绑{name}。原会话和任务历史保留，已启动的 Work 任务请在 ChatGPT 内处理。', {name: agent.name}) + (agent.supervisor ? tr('后续协作已暂停。') : ''));
      window.scrollTo({ top: 0 });
    }
  };
  const scout = async () => {
    if (busy) return;
    setSetup(true); setBusy(true); setReading(true); setError('');
    try {
      // Re-read the active tab at click time, rather than using a 2.5s-old poll.
      const current = await overview(); setTabs(current.tabs);
      const tab = currentProjectTab(current.tabs, store.project?.id);
      if (tab?.id === undefined) { setError('请先在浏览器打开要协作的 ChatGPT 项目'); return; }
      const data = await discover(tab.id);
      setDiscovery(data); setBatchUrls(data.conversations.map(c => c.url)); setBatchLead(''); setBatchVerified(false);
      setProjectUrl(data.projectUrl || ''); setProjectName(data.name || '');
      if (!data.projectId) setError('未找到当前会话所属项目，请打开项目首页后重新读取');
      else if (!data.name) setError('未读取到项目名称，请填写或打开项目首页后重新读取');
    }
    catch (error) { setError((error as Error).message === backgroundConnectionMessage ? backgroundConnectionMessage : '请刷新 ChatGPT 页面，让插件连接后再读取'); }
    finally { setBusy(false); setReading(false); }
  };
  const saveProject = async () => {
    const id = projectIdFromUrl(projectUrl);
    if (!id || !projectName.trim()) { setError('请填写项目名称和项目首页地址'); return; }
    // Keep the onboarding panel open while configure replaces the empty store.
    setSetup(true);
    await run({ type: 'configure', project: { id, name: projectName.trim(), url: projectUrl.trim() } });
  };
  const bind = async () => {
    const id = conversationId(bindingUrl);
    if (!store.project || !id) { setError('请先连接项目，并选择已有的 Work 会话'); return; }
    const tab = tabs.find(t => conversationId(t.url || '') === id);
    if (await run({ type: 'bind', agent: { id, name: bindingName.trim(), url: bindingUrl.trim(), projectId: store.project.id, supervisor, userVerifiedWork: verified, initialized: false, tabId: tab?.id } })) { setBindingName(''); setBindingUrl(''); setVerified(false); setSupervisor(false); }
  };
  const importTeam = async () => {
    if (!store.project || discovery?.projectId !== store.project.id || projectIdFromUrl(projectUrl) !== store.project.id || !batchVerified || !batchUrls.includes(batchLead)) { setError('请连接此项目，选择主管，并确认所选会话使用 Work 模式'); return; }
    const imported = discovery.conversations.filter(c => batchUrls.includes(c.url)).map(c => ({ id: conversationId(c.url)!, url: c.url, name: c.name, projectId: store.project!.id, supervisor: c.url === batchLead, userVerifiedWork: true, initialized: false, tabId: tabs.find(t => conversationId(t.url || '') === conversationId(c.url))?.id }));
    if (await run({ type: 'bind_many', agents: imported })) { setSetup(false); setNotice(tr('已加入 {count} 个会话，点击“连接协作”即可开始', {count: imported.length})); }
  };
  const agents = store.agents;
  const lead = agents.find(a => a.supervisor);
  const members = agents.filter(a => !a.supervisor);
  const drafts = store.tasks.filter(t => t.status === 'draft');
  const draftRounds = [...new Set(drafts.map(t => t.roundId))].map(id => drafts.filter(t => t.roundId === id));
  const activeTasks = store.tasks.filter(t => !['accepted', 'cancelled'].includes(t.status));
  const canInitialize = agents.some(a => !a.initialized && !activeTasks.some(t => t.targetId === a.id && t.kind === 'bootstrap'));
  const taskDependency = (t: Task) => ['draft','queued'].includes(t.status) ? dependencyState(t,store) : undefined;
  const taskInteraction = (t: Task) => (['sending','running','uncertain'].includes(t.status) ? agents.find(a => a.id === t.targetId)?.observation?.interaction : undefined) || (taskDependency(t)?.needsInteraction ? taskDependency(t)?.reason : undefined);
  const priorResults = (t: Task) => t.resultHistory.filter((result,index) => index < t.resultHistory.length - 1 || result.attempt !== t.attempt || !t.result);
  const taskReason = (t: Task) => taskInteraction(t) || taskDependency(t)?.reason || t.reason || (t.kind === 'bootstrap' && t.status === 'running' ? '初始化消息已送达，等待 Work 返回就绪确认' : undefined);
  const chosen = agents.find(a => a.id === selected);
  const discoveredProjectMatches = Boolean(discovery?.projectId && discovery.projectId === projectIdFromUrl(projectUrl));
  const batchProjectConnected = discoveredProjectMatches && store.project?.id === discovery?.projectId;
  const bindingOptions = conversationOptions(tabs, discovery, store.project?.id);
  const bindingSelection = bindingOptions.find(option => conversationId(option.url) === conversationId(bindingUrl))?.url || bindingUrl;
  const taskTitle = (task: Task) => task.kind === 'bootstrap' && task.title === `连接${agents.find(a => a.id === task.targetId)?.name}`
    ? tr('连接{name}', {name: agents.find(a => a.id === task.targetId)!.name})
    : task.newAgentName && task.title === `初始化${task.newAgentName}` ? tr('初始化{name}', {name: task.newAgentName})
    : task.kind === 'report' ? localize(task.title) : task.title;
  const node = (agent: Agent) => {
    const { state, reason } = stateFor(agent, store);
    const task = activeTasks.find(t => t.targetId === agent.id && ['sending','running','waiting','uncertain'].includes(t.status)) || activeTasks.find(t => t.targetId === agent.id);
    return <button key={agent.id} className={`agent ${agent.supervisor ? 'lead' : ''} ${selected === agent.id ? 'selected' : ''}`} title={localize(reason)} onClick={() => setSelected(selected === agent.id ? undefined : agent.id)} aria-pressed={selected === agent.id}>
      <span className="node-kind">{agent.supervisor ? tr("主管") : tr("成员")}<ArrowUpRight size={13}/></span>
      <span className="agent-name"><i className={`dot ${state}`}/>{agent.name}</span>
      <span className="agent-state">{tr(labels[state])}</span>
      <span className="node-caption">{agent.observation?.interaction ? tr("请打开会话核对") : agent.supervisor && agent.planDiagnostic && agent.planDiagnostic.status !== 'registered' ? localize(agent.planDiagnostic.reason) : task?.kind === 'bootstrap' ? task.status === 'running' ? tr("已送达，等待就绪回复") : localize(task.reason) || taskTitle(task) : task && (taskReason(task) ? localize(taskReason(task)) : taskTitle(task)) || (!agent.initialized ? tr("等待连接协作协议") : tr("沿用项目既有分工"))}</span>
    </button>;
  };
  return <div className="app">
    {preview && <div className="preview">{tr("演示预览 · 不连接 ChatGPT")}</div>}
    <header><div className="brand"><span className="brand-icon"><GitBranch size={20}/></span><div><strong>GptWorkBot</strong><small>{tr("让项目成员一起工作")}</small></div></div><div className="header-actions"><select className="language-select" aria-label={tr("界面语言")} value={locale} onChange={e => void changeLocale(e.target.value as Locale)}><option value="zh-CN">中文</option><option value="en">English</option></select><button className="icon" title={tr("团队设置")} aria-label={tr("团队设置")} onClick={() => setSettings(!settings)}><Settings2 size={18}/></button></div></header>
    {error && <div className="alert" role="alert"><span>{localize(error)}{error === backgroundConnectionMessage && <button className="text" onClick={() => location.reload()}>{tr("重连插件")}</button>}</span><button className="icon" aria-label={tr("关闭提示")} onClick={() => setError('')}><X size={14}/></button></div>}
    {notice && <div className="toast" role="status">{localize(notice)}<button className="icon" aria-label={tr("关闭提示")} onClick={() => setNotice('')}><X size={14}/></button></div>}
    <section className="project"><div><span className="eyebrow">{tr("当前项目")}</span><h1>{store.project?.name || tr("连接你的 Work 项目")}</h1></div><button className="icon" title={tr("绑定会话")} aria-label={tr("绑定会话")} onClick={() => { setSetup(!setup); setProjectUrl(store.project?.url || ''); setProjectName(store.project?.name || ''); }}><Plus size={19}/></button></section>
    {(setup || !store.project) && <section className="card setup"><div className="section-title"><h2>{tr("项目与会话")}</h2><button className="text" onClick={scout} disabled={preview || busy}>{reading ? tr("读取中…") : tr("读取当前项目")}</button></div><p className="muted">{tr("选择同一项目已有的 Work 会话。成员职责继续沿用项目设置。")}</p>
      <label>{tr("项目名称")}<input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder={tr("你的项目")}/></label><label>{tr("项目首页地址")}<input value={projectUrl} onChange={e => setProjectUrl(e.target.value)} placeholder="https://chatgpt.com/g/g-p-…/project"/></label><button className="secondary" disabled={busy} onClick={saveProject}>{tr("连接项目")}</button>
      {discoveredProjectMatches && discovery && discovery.conversations.length > 0 && <div className="batch">
        <hr/><h2>{tr("批量加入已有团队")}</h2>
        <p className="muted">{tr("发现 {count} 个会话，请选择本次参与协作的成员。", {count: discovery.conversations.length})}</p>
        {!batchProjectConnected && <p className="muted">{tr("先连接项目，再加入所选角色；当前选择会保留。")}</p>}
        <div className="batch-list">{discovery.conversations.map(c => <label className="check" key={c.url}><input type="checkbox" checked={batchUrls.includes(c.url)} onChange={e => setBatchUrls(e.target.checked ? [...batchUrls, c.url] : batchUrls.filter(url => url !== c.url))}/>{c.name || c.url}</label>)}</div>
        <label>{tr("选择主管")}<select value={batchLead} onChange={e => setBatchLead(e.target.value)}><option value="">{tr("请选择主管会话")}</option>{discovery.conversations.filter(c => batchUrls.includes(c.url)).map(c => <option key={c.url} value={c.url}>{c.name || c.url}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={batchVerified} onChange={e => setBatchVerified(e.target.checked)}/>{tr("已确认所选会话均使用 Work 模式")}</label>
        <button className="primary full" onClick={importTeam} disabled={busy || !batchProjectConnected || !batchVerified || !batchUrls.includes(batchLead)}>{tr("加入 {count} 个会话", {count: batchUrls.length})}</button>
      </div>}
      {store.project && <><hr/><label>{tr("选择已打开或项目中发现的会话")}<select value={bindingSelection} onChange={e => { setBindingUrl(e.target.value); setBindingName(bindingOptions.find(option => option.url === e.target.value)?.name || ''); }}><option value="">{tr("选择会话，也可在下方粘贴地址")}</option>{bindingOptions.map(option => <option value={option.url} key={option.url}>{option.name || option.url}</option>)}</select></label>
        <label>{tr("Work 会话地址")}<input value={bindingUrl} onChange={e => setBindingUrl(e.target.value)} placeholder="https://chatgpt.com/…/c/…"/></label><label>{tr("显示名称")}<input value={bindingName} onChange={e => setBindingName(e.target.value)} placeholder={tr("例如：前端开发")} maxLength={100}/></label>
        <label className="check"><input type="checkbox" checked={supervisor} onChange={e => setSupervisor(e.target.checked)}/>{tr("设为主管会话")}</label><label className="check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/>{tr("已确认属于此项目，且使用 Work 模式")}</label><button className="primary full" disabled={busy || !verified} onClick={bind}>{tr("加入团队")}</button></>}
    </section>}
    {settings && <section className="card settings"><h2>{tr("运行设置")}</h2><label>{tr("同时执行的成员数")}<select value={store.settings.concurrency} onChange={e => run({ type: 'settings', settings: { ...store.settings, concurrency: Number(e.target.value) } })}>{[1,2,3,4].map(n => <option key={n}>{n}</option>)}</select></label><label>{tr("自动模式最多连续轮数")}<select value={store.settings.maxAutoRounds} onChange={e => run({ type: 'settings', settings: { ...store.settings, maxAutoRounds: Number(e.target.value) } })}>{[1,3,5,10,20].map(n => <option key={n}>{n}</option>)}</select></label><p className="muted">{tr("每个会话一次处理一项任务。达到轮数上限后暂停，待你检查后继续。")}</p><button className="secondary" onClick={() => run({ type: 'reconcile' })} disabled={busy}><RefreshCw size={14}/>{tr("重新核对会话")}</button></section>}
    <section className="controls"><div className="segmented" aria-label={tr("派发模式")}>{(['confirm','auto'] as const).map(mode => <button key={mode} className={store.settings.mode === mode ? 'active' : ''} onClick={() => run({ type: 'settings', settings: { ...store.settings, mode } })} disabled={busy}>{mode === 'confirm' ? tr("每轮确认") : tr("自动协作")}</button>)}</div><button className="pause" onClick={() => run({ type: 'pause', paused: !store.paused })} disabled={busy}>{store.paused ? <Play size={14}/> : <Pause size={14}/>} {store.paused ? tr("继续") : tr("暂停")}</button></section>
    {store.paused && <div className="paused">{tr("后续消息已暂停。原生 Work 任务按当前状态运行。")}</div>}
    <section className="organization"><div className="section-title"><h2>{tr("团队组织")}</h2><div className="organization-actions"><span className="count">{tr("{count} 个会话", {count: agents.length})}</span><button ref={createButton} className="secondary" disabled={busy || !store.project} title={!store.project ? tr("请先连接项目") : lead ? tr("在当前项目创建 Work 成员") : tr("在当前项目创建 Work 主管")} onClick={() => { setError(''); setNotice(''); setCreateProject(store.project); }}><Plus size={14}/>{tr("新增角色")}</button></div></div><div className="legend"><span><i className="dot idle"/>{tr("空闲")}</span><span><i className="dot running"/>{tr("执行中")}</span><span><i className="dot needs_interaction"/>{tr("需要交互")}</span></div>
      {lead ? <div className="tree"><div className="root-node">{node(lead)}</div>{members.length > 0 && <div className="members"><svg className="branches" aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 100 ${Math.ceil(members.length / 2) * 132}`}><path d={`M50 0 V${Math.ceil(members.length / 2) * 132 - 100}`}/>{members.map((a, i) => <path key={a.id} d={`M50 ${Math.floor(i / 2) * 132 + 20} H${i % 2 ? 75 : 25} V${Math.floor(i / 2) * 132 + 35}`}/>)}</svg>{members.map(node)}</div>}</div> : <div className="empty"><Users size={30}/><strong>{tr("从主管会话开始")}</strong><p>{tr("绑定主管与成员，再连接协作。")}<br/>{tr("之后在原 ChatGPT 会话向主管下达命令。")}</p><button className="secondary" onClick={() => setSetup(true)}>{tr("绑定会话")}</button></div>}
      {agents.some(a => !a.initialized) && lead && <button className="primary full connect" disabled={busy || !canInitialize} onClick={() => run({ type: 'initialize' })}><GitBranch size={15}/>{canInitialize ? tr("连接协作 · 同步消息路由") : tr("正在逐个连接 · 可重新核对会话")}</button>}
      {lead && <SupervisorPlanNotice agent={lead} locale={locale} busy={busy} onRecover={messageId => { void run({type:'recover_plan',agentId:lead.id,messageId}); }}/>}
    </section>
    {chosen && <section className="card member-details"><div className="section-title"><h2>{chosen.name}</h2><button className="icon" aria-label={tr("关闭成员详情")} onClick={() => setSelected(undefined)}><X size={16}/></button></div><p className="reason">{localize(stateFor(chosen, store).reason)}</p><div className="row"><button className="secondary" disabled={busy} onClick={() => openConversation(conversationId(chosen.url) ? chosen.url : store.project!.url).catch(e => setError((e as Error).message))}><ArrowUpRight size={14}/>{conversationId(chosen.url) ? tr("打开会话") : tr("打开项目核对")}</button><button className="secondary" disabled={busy} onClick={() => run({ type: 'stop', agentId: chosen.id })}><Square size={12}/>{tr("请求停止")}</button><button className="text danger" disabled={busy} onClick={() => unbind(chosen)}>{tr("解绑")}</button></div><p className="muted">{chosen.observation?.connected ? tr("最近核对 {time}", {time: new Date(chosen.observation.observedAt).toLocaleTimeString(locale)}) : tr("会话未连接，可重新核对或直接解绑")}</p><p className="muted">{tr("解绑会停止此角色的后续消息，保留原 ChatGPT 会话及任务历史。")}</p>{chosen.responsibilities && <p className="instructions">{tr("角色职责：")}{chosen.responsibilities}</p>}{chosen.conversationNameStatus && <div><p className="muted">{chosen.conversationNameStatus === 'synced' ? tr("Work 会话名称已与角色名称同步") : localize(chosen.conversationNameReason) || tr("任务完成后同步 Work 会话名称")}</p>{chosen.conversationNameStatus !== 'synced' && <button className="secondary" disabled={busy || !conversationId(chosen.url)} onClick={() => run({ type: 'sync_name', agentId: chosen.id })}><RefreshCw size={14}/>{tr("同步会话名称")}</button>}</div>}</section>}
    <section className="tasks"><div className="section-title"><h2>{tr("协作任务")}</h2><span className="count">{tr("{count} 项处理中", {count: activeTasks.length})}</span></div>
      {draftRounds.map((round, index) => <div className="confirmation" key={round[0].roundId}><div><strong>{tr("待确认第 {round} 轮 · {count} 项任务", {round: index + 1, count: round.length})}</strong><small>{round.map(t => t.title).join('、')}</small></div><button className="primary" disabled={busy} onClick={() => run({ type: 'approve', ids: round.map(t => t.id) })}><Check size={14}/>{tr("确认本轮")}</button></div>)}
      {!activeTasks.length && <div className="empty compact"><p>{tr("在主管会话下达目标后，任务会出现在这里。")}</p></div>}
      {activeTasks.filter(t => !chosen || t.targetId === chosen.id || t.senderId === chosen.id).slice().reverse().map(t => <article className={`task ${taskInteraction(t) ? 'waiting' : t.status}`} key={t.id}><div className="task-head"><span>{t.kind === 'create' ? tr("新建 · {name}", {name: t.newAgentName || ""}) : agents.find(a => a.id === t.targetId)?.name || tr("成员")}{t.kind === 'report' ? tr(" · 收取回报") : ''}</span><span className="badge">{taskInteraction(t) ? tr("需要交互") : t.status === 'queued' && !taskDependency(t)?.ready ? tr("等待前置任务") : tr(taskLabels[t.status])}</span></div><h3>{taskTitle(t)}</h3>{businessTask(t) && <p className="task-attempt">{tr("执行轮次：{attempt}",{attempt:t.attempt})}</p>}{t.inputs.length > 0 && <div className="dependencies"><strong>{tr("前置任务与输入")}</strong>{t.inputs.map(input => {const parent=store.tasks.find(p=>p.id===input.fromTask);return <div key={input.name}><span>{parent?.title || input.fromTask}</span><small>{parent ? `${agents.find(a=>a.id===parent.targetId)?.name || parent.resultHistory.at(-1)?.sourceName || tr("成员")} · ${tr(taskLabels[parent.status])}` : tr("任务不存在")} · {input.name}</small></div>;})}</div>}{taskReason(t) && <p className={`reason ${taskDependency(t) && !taskDependency(t)?.ready && !taskDependency(t)?.needsInteraction ? "dependency-wait" : ""}`}>{localize(taskReason(t))}</p>}<details><summary>{tr("任务内容")}<ChevronDown size={13}/></summary><p className="instructions">{t.instructions}</p>{t.newAgentInstructions && <p className="instructions">{tr("新成员职责：")}{t.newAgentInstructions}</p>}{t.context && <p className="instructions">{tr("上下文：")}{t.context}</p>}{t.acceptance && <p className="instructions">{tr("完成条件：")}{t.acceptance}</p>}{t.result && <p className="instructions result">{tr("成员成果：")}{t.result}</p>}{t.resolvedInputs?.map(input => <p className="instructions" key={input.name}>{tr("已传入成果：")}{input.name}{"\n"}{input.summary}</p>)}{priorResults(t).length > 0 && <div className="result-history"><strong>{tr("历史成果")}</strong>{priorResults(t).map((result,index)=><p className="instructions" key={index}>{tr("执行轮次：{attempt}",{attempt:result.attempt})}{"\n"}{result.summary}</p>)}</div>}</details><div className="task-actions">
        {taskInteraction(t) && <button className="text" disabled={busy} onClick={() => run({ type: 'reconcile' })}>{tr("重新核对会话")}</button>}
        {t.status === 'draft' && <><button className="text" onClick={() => setEdit(structuredClone(t))}>{tr("编辑")}</button><button className="text" disabled={busy} onClick={() => run({ type: 'approve', ids: [t.id] })}>{tr("确认")}</button></>}
        {['draft','queued'].includes(t.status) && <button className="text subtle" onClick={() => run({ type: 'cancel', id: t.id })}>{tr("取消")}</button>}
        {t.status === 'waiting' && <button className="text" disabled={busy} onClick={() => run({ type: 'resume_task', id: t.id })}>{t.deliveredAt ? tr("继续核对") : tr("重试发送")}</button>}
        {t.status === 'uncertain' && <button className="text" onClick={() => run({ type: 'reconcile' })}>{tr("核对发送回执")}</button>}
        {t.status === 'reported' && <button className="text" onClick={() => run({ type: 'accept', id: t.id, attempt:t.attempt })}>{tr("用户验收")}</button>}
        {t.createdTabId && t.kind === 'create' && !preview && <button className="text" onClick={() => chrome.tabs.update(t.createdTabId!, { active: true })}>{tr("打开新会话")}</button>}
        <button className="text subtle" disabled={busy || !dependencyState(t,store).ready} title={tr("复制后可在目标会话手动发送；同一标识不要重复执行")} onClick={async () => { try { await navigator.clipboard.writeText(t.kind === 'create' ? creationPrompt(t, store) : taskPrompt(t,store)); setNotice(tr("已复制任务，发送前请核对目标会话与现有回执")); } catch { setError(tr("复制失败，请展开任务内容后复制")); } }}><Copy size={12}/>{tr("复制")}</button>
      </div></article>)}
    </section>
    <section className="events"><div className="section-title"><h2>{tr("协作动态")}</h2><button className="icon" aria-label={tr("刷新状态")} onClick={() => run({ type: 'reconcile' })}><RefreshCw size={14}/></button></div>{store.events.slice(0,5).map(e => <div className="event" key={e.id}><i/><p>{localize(e.text)}</p><time>{new Date(e.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time></div>)}</section>
    <footer>{tr("会话与记录保存在本机 · 使用现有 ChatGPT 账号")}</footer>
    {createProject && <CreateRoleDialog locale={locale} onLocaleChange={changeLocale} project={createProject} supervisorName={lead?.name} paused={store.paused} busy={busy} error={error} onClose={closeCreation} onSubmit={createRole}/>}
    {edit && <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" onSubmit={async e => { e.preventDefault(); if (await run({ type: 'edit', id: edit.id, title: edit.title, instructions: edit.instructions, context: edit.context, acceptance: edit.acceptance, newAgentInstructions: edit.newAgentInstructions, dependsOn:businessTask(edit) ? edit.dependsOn : undefined })) setEdit(undefined); }}><div className="section-title"><h2 id="edit-title">{tr("核对任务")}</h2><button type="button" className="icon" aria-label={tr("关闭编辑")} onClick={() => setEdit(undefined)}><X size={18}/></button></div>{error && <p className="reason" role="alert">{localize(error)}</p>}<label>{tr("标题")}<input autoFocus value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} required/></label>{edit.kind === 'create' && <label>{tr("新成员职责")}<textarea rows={3} value={edit.newAgentInstructions} onChange={e => setEdit({ ...edit, newAgentInstructions: e.target.value })} required/></label>}<label>{tr("具体任务")}<textarea rows={6} value={edit.instructions} onChange={e => setEdit({ ...edit, instructions: e.target.value })} required/></label>{businessTask(edit) && <fieldset className="dependency-editor"><legend>{tr("前置任务")}</legend><p className="muted">{tr("选择后自动映射完整成果；前置任务回传并验收后才启动。")}</p>{store.tasks.filter(t=>t.id!==edit.id && businessTask(t) && t.projectId===store.project?.id && t.status!=='cancelled').map(parent=><label className="check" key={parent.id}><input type="checkbox" checked={edit.dependsOn.includes(parent.id)} onChange={e=>setEdit({...edit,dependsOn:e.target.checked?[...edit.dependsOn,parent.id]:edit.dependsOn.filter(id=>id!==parent.id)})}/>{parent.title}</label>)}</fieldset>}<label>{tr("上下文")}<textarea rows={3} value={edit.context} onChange={e => setEdit({ ...edit, context: e.target.value })}/></label><label>{tr("完成条件")}<textarea rows={2} value={edit.acceptance} onChange={e => setEdit({ ...edit, acceptance: e.target.value })}/></label><button className="primary full" disabled={busy}>{tr("保存，保持待确认")}</button></form></div>}
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App/></React.StrictMode>);
// Dispose the entry root before Vite evaluates the next development module.
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
