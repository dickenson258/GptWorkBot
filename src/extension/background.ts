import { applyCommand, ingestObservation, makeTask } from '../core/engine';
import { activeBootstrap, eligibleTasks } from '../core/state';
import { bootstrapPrompt, taskPrompt, creationPrompt } from '../core/protocol';
import { addLog, conversationId, conversationRouteId, emptyStore, projectIdFromUrl, uid, validCreationUrl, storageKey } from '../core/types';
import type { Agent, Observation, PanelCommand, Store, Task } from '../core/types';
import { waitForPageReady, PageLoadingTimeout, readTab, isConnectionError, pageConnectionMessage } from './connection';
import { dependencyState, freezeInputs } from '../core/dependencies';
import type { NameOutcome } from './naming';

const KEY = storageKey;
let state: Store;
let chain = Promise.resolve();
let pumping = false;
const active = new Set<string>();
const openingTabs = new Map<string, Promise<number>>();
const closedTabs = new Set<number>();
const attempting = new Set<string>();
const namingActive = new Set<string>();
const loaded = chrome.storage.local.get(KEY).then(async data => {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  state = data[KEY]?.version === 2 ? data[KEY] as Store : emptyStore();
  state.agents.forEach(a => { if (a.conversationNameStatus === 'renaming') a.conversationNameStatus = 'pending'; });
  state.agents.forEach(a => { if (a.observation) a.observation.connected = false; });
  state.tasks.filter(t => t.status === 'sending').forEach(t => { t.status = 'uncertain'; t.reason = '后台已恢复，请核对发送回执'; });
  await chrome.storage.local.set({ [KEY]: state });
});
function transaction<T>(fn: (store: Store) => T): Promise<T> {
  const next = chain.then(async () => {
    await loaded;
    const draft = structuredClone(state);
    const result = fn(draft);
    await chrome.storage.local.set({ [KEY]: draft });
    state = draft;
    return result;
  });
  chain = next.then(() => {}, () => {});
  return next;
}
async function snapshot() { await chain; await loaded; return structuredClone(state); }
function isChatUrl(url?: string) { try { return new URL(url || '').origin === 'https://chatgpt.com'; } catch { return false; } }
async function message<T>(tabId: number, data: unknown): Promise<T> { return chrome.tabs.sendMessage(tabId, data); }
function validObservation(value: unknown): value is Observation {
  const o = value as Observation;
  return Boolean(o && isChatUrl(o.url) && typeof o.title === 'string' && typeof o.ready === 'boolean' && typeof o.running === 'boolean' && typeof o.draft === 'boolean' && ['work', 'chat', 'unknown'].includes(o.workMode) && Array.isArray(o.messages) && o.messages.length <= 2000 && o.messages.every(m => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && m.text.length < 300000 && (m.turnId === undefined || typeof m.turnId === 'string') && (m.turnComplete === undefined || typeof m.turnComplete === 'boolean')));
}
function observe(s: Store, o: Observation, tabId: number) {
  if (!validObservation(o) || closedTabs.has(tabId)) return;
  o.observedAt = Date.now(); o.connected = true;
  const creation = s.tasks.find(t => t.kind === 'create' && ['sending', 'uncertain', 'waiting'].includes(t.status) && o.messages.some(m => m.role === 'user' && m.text.includes(`[WT-DELIVERY:${t.deliveryToken}]`)));
  const id = conversationId(o.url);
  if (creation && o.projectId === s.project?.id && !id) {
    creation.createdTabId = tabId; creation.deliveredAt ??= Date.now();
    creation.status = 'uncertain'; creation.reason = '已确认职责／初始化消息送达，等待 Work 正式会话地址；不会另开页面或重发';
  }
  if (creation && id && o.projectId === s.project?.id && o.workMode === 'work') {
    const supervisorRole = Boolean(creation.newAgentSupervisor);
    if (supervisorRole && s.agents.some(a => a.supervisor && a.id !== id)) { creation.status = 'waiting'; creation.reason = '当前项目已绑定另一位主管，请先核对主管会话'; return; }
    if (s.agents.some(a => a.id === id || a.name === creation.newAgentName)) { creation.status = 'waiting'; creation.reason = '此会话或角色名称已绑定，请核对原创建回执'; return; }
    const agent: Agent = { id, name: creation.newAgentName!, responsibilities: creation.newAgentInstructions, conversationNameStatus: 'pending', url: o.url, projectId: s.project!.id, supervisor: supervisorRole, userVerifiedWork: true, initialized: !supervisorRole, tabId, observation: { ...o, messages: [] } };
    s.agents.push(agent);
    creation.createdTabId = tabId;
    creation.kind = supervisorRole ? 'bootstrap' : 'dispatch'; creation.targetId = id; creation.status = 'running'; creation.deliveredAt = Date.now(); creation.reason = undefined;
    if (supervisorRole) creation.senderId = id;
    const supervisor = s.agents.find(a => a.supervisor);
    if (supervisor && !supervisorRole) s.tasks.push(makeTask({ projectId:s.project!.id, kind: 'bootstrap', senderId: supervisor.id, targetId: supervisor.id, title: '同步新成员路由', instructions: bootstrapPrompt(supervisor, s), approved: true, status: 'queued' }));
    addLog(s, `已在项目中创建${supervisorRole ? '主管' : '成员'}：${agent.name}`);
  }
  if (id) {
    ingestObservation(s, id, o, tabId);
    const agent = s.agents.find(a => a.id === id);
    if (agent && agent.projectId === o.projectId) {
      agent.url = o.url; agent.tabClosed = false; agent.tabOpening = false;
      if (agent.conversationNameStatus && o.title === agent.name) { agent.conversationNameStatus = 'synced'; agent.conversationNameReason = undefined; }
    }
    // Protocol results live on tasks. Keep only short receipt previews in the
    // observation cache, rather than storing the whole native conversation.
    if (agent?.observation) agent.observation.messages = o.messages.slice(-8).map(m => ({ ...m, text: m.role === 'user' ? m.text.slice(0, 500) : '' }));
  }
}
async function refresh(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'loading') {
      await transaction(s => { s.agents.filter(a => a.tabId === tabId).forEach(a => { if (a.observation) { a.observation.connected = false; a.observation.ready = false; } }); });
      return;
    }
    const o = await readTab<Observation>(tabId, 'snapshot'); if (validObservation(o)) await transaction(s => observe(s, o, tabId));
  }
  catch { await transaction(s => { s.agents.filter(a => a.tabId === tabId).forEach(a => { if (a.observation) a.observation.connected = false; }); }); }
}
function findTab(agent: Agent, tabs: chrome.tabs.Tab[]) {
  const matches = (tab: chrome.tabs.Tab) => conversationId(tab.pendingUrl || tab.url || '') === agent.id && (!projectIdFromUrl(tab.pendingUrl || tab.url || '') || projectIdFromUrl(tab.pendingUrl || tab.url || '') === agent.projectId);
  return tabs.find(t => t.id === agent.tabId && matches(t)) || tabs.find(matches);
}
async function reconnectOpenTabs() {
  // Tab IDs only identify this browser session. Recover bindings by conversation
  // URL and never open a missing page merely to reconcile or remove a role.
  const tabs = await chrome.tabs.query({});
  const ids = await transaction(s => {
    const ids = new Set<number>();
    s.agents.forEach(a => {
      const match = findTab(a, tabs);
      if (match?.id !== undefined) { a.tabId = match.id; ids.add(match.id); }
      else if (a.observation) a.observation.connected = false;
    });
    if (s.tasks.some(t => t.kind === 'create' && ['sending', 'uncertain', 'waiting'].includes(t.status))) {
      // A newly created role may not be bound yet when the browser exits.
      // Find its delivery receipt in restored tabs, whose IDs can change too.
      tabs.filter(tab => projectIdFromUrl(tab.pendingUrl || tab.url || '') === s.project?.id).forEach(tab => { if (tab.id !== undefined) ids.add(tab.id); });
    }
    return [...ids];
  });
  await Promise.allSettled(ids.map(refresh));
}
async function group(tabId: number) {
  try {
    const groups = await chrome.tabGroups.query({ title: 'GptWorkBot' });
    if (!groups.length) groups.push(...await chrome.tabGroups.query({ title: 'Work Team' }));
    const groupId = await chrome.tabs.group({ tabIds: [tabId], ...(groups[0] ? { groupId: groups[0].id } : {}) });
    await chrome.tabGroups.update(groupId, { title: 'GptWorkBot', color: 'green' });
  } catch { /* Grouping is cosmetic and must not block routing. */ }
}
async function ensureTab(agent: Agent): Promise<number> {
  const existing = openingTabs.get(agent.id); if (existing) return existing;
  const opening = resolveTab(agent);
  openingTabs.set(agent.id, opening);
  try { return await opening; } finally { if (openingTabs.get(agent.id) === opening) openingTabs.delete(agent.id); }
}
async function resolveTab(agent: Agent): Promise<number> {
  agent = (await snapshot()).agents.find(a => a.id === agent.id)!;
  if (!agent || !conversationId(agent.url) || conversationId(agent.url) !== agent.id) throw new Error('角色尚无正式会话地址，请打开原项目会话并重新核对；不会打开临时地址');
  // A newly created tab can have only pendingUrl. A committed-URL filter
  // misses it, so check the saved ID first, then match across the tab inventory.
  const cached = agent.tabId !== undefined ? await chrome.tabs.get(agent.tabId).catch(() => undefined) : undefined;
  const tab = cached && findTab(agent, [cached]) || findTab(agent, await chrome.tabs.query({}));
  if (tab?.id !== undefined) {
    await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a) { a.tabId = tab.id; a.tabOpening = false; } });
    return tab.id;
  }
  if (cached) throw new Error('原会话页面已跳转，请手动打开正确会话并重新核对；不会另开重复页面');
  if (agent.tabClosed || agent.tabOpening) throw new Error('会话页面已关闭或打开结果待核对；请打开原会话或点击任务的重试发送');
  await transaction(s => {
    const a = s.agents.find(a => a.id === agent.id);
    if (!a || s.paused || a.tabClosed || a.tabOpening) throw new Error('页面打开已中止，请重新核对');
    a.tabOpening = true;
  });
  const created = await chrome.tabs.create({ url: agent.url, active: false });
  if (created.id === undefined) throw new Error('无法打开目标会话');
  await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a) { a.tabId = created.id; a.tabOpening = false; a.tabClosed = closedTabs.has(created.id!); } });
  await group(created.id);
  return created.id;
}
async function syncNames(requestedId?: string) {
  const s = await snapshot(); if (s.paused && !requestedId) return;
  await Promise.allSettled(s.agents.filter(a => !namingActive.has(a.id) && (!requestedId || a.id === requestedId) && a.conversationNameStatus === 'pending' && a.tabId !== undefined && a.observation?.connected && !a.observation.running && !a.observation.draft && !a.observation.interaction && a.observation.workMode === 'work' && conversationId(a.url) === a.id).map(async agent => {
    namingActive.add(agent.id);
    await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a?.conversationNameStatus === 'pending') a.conversationNameStatus = 'renaming'; });
    try {
      const page = await readTab<Observation>(agent.tabId!, 'snapshot');
      const live = await snapshot(); const a = live.agents.find(a => a.id === agent.id);
      if (!a || live.paused && !requestedId || a.conversationNameStatus !== 'renaming') return;
      if (conversationId(page.url) !== a.id || page.projectId !== a.projectId) throw new Error('页面已切换，请打开原会话核对后同步名称');
      const result = await message<NameOutcome>(agent.tabId!, { type: 'rename', agentId: a.id, projectId: a.projectId, name: a.name });
      await refresh(agent.tabId!);
      await transaction(s => {
        const a = s.agents.find(a => a.id === agent.id); if (!a || a.conversationNameStatus === 'synced') return;
        const confirmation = result.confirmation;
        const confirmed = confirmation && conversationId(confirmation.url) === a.id && projectIdFromUrl(confirmation.url) === a.projectId && confirmation.title === a.name;
        a.conversationNameStatus = result.status === 'synced' && (confirmed || a.observation?.title === a.name) ? 'synced' : 'waiting';
        a.conversationNameReason = a.conversationNameStatus === 'synced' ? undefined : result.reason || '原生会话名称尚未确认，请打开会话核对后重试同步名称';
        addLog(s, a.conversationNameStatus === 'synced' ? `已同步 Work 会话名称：${a.name}` : `${a.name}：${a.conversationNameReason}`);
      });
    } catch (error) {
      await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a) { a.conversationNameStatus = 'waiting'; a.conversationNameReason = isConnectionError(error) ? pageConnectionMessage : (error as Error).message; } });
    } finally {
      namingActive.delete(agent.id);
      await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a?.conversationNameStatus === 'renaming') a.conversationNameStatus = 'pending'; });
    }
  }));
}
async function liveDispatch(id: string) {
  const s = await snapshot(); const task = s.tasks.find(t => t.id === id);
  if (!task || task.status !== 'sending') return;
  const firstSupervisor = task.kind === 'create' && task.newAgentSupervisor && task.sourceKey.startsWith('panel:create:');
  if (!firstSupervisor && !s.agents.some(a => a.id === task.senderId)) return;
  if (task.kind !== 'create' && !s.agents.some(a => a.id === task.targetId)) return;
  if (s.paused) { await transaction(s => { const t = s.tasks.find(t => t.id === id); if (t?.status === 'sending') t.status = 'queued'; }); return; }
  if (task.relatedTaskId && (s.tasks.find(t=>t.id===task.relatedTaskId)?.status !== 'waiting' || s.tasks.find(t=>t.id===task.relatedTaskId)?.attempt !== task.attempt)) {
    await transaction(s=>{const t=s.tasks.find(t=>t.id===id);if(t?.status==='sending'){t.status='cancelled';t.reason='原任务已不再等待处理，取消过期的继续消息';}});return;
  }
  if (!dependencyState(task,s).ready) { await transaction(s => { const t=s.tasks.find(t=>t.id===id);if(t?.status==='sending'){t.status='queued';t.reason=dependencyState(t,s).reason;} });return; }
  return { store: s, task };
}
async function dispatch(task: Task) {
  active.add(task.id);
  let attempted = false;
  try {
    if (!await liveDispatch(task.id)) return;
    if (task.kind === 'create') {
      let tabId = task.createdTabId;
      if (tabId !== undefined) {
        const tab = await chrome.tabs.get(tabId);
        await refresh(tabId);
        if (!await liveDispatch(task.id)) return;
        const url = tab.pendingUrl || tab.url || '';
        if (!validCreationUrl(url, (await snapshot()).project!.id)) throw new Error('新成员标签页已关闭或地址已变化，请打开原会话核对；不会另建重复会话');
      } else {
        const s = await snapshot();
        const tab = await chrome.tabs.create({ url: s.project!.url, active: false });
        tabId = tab.id;
        if (tabId === undefined) throw new Error('无法打开项目新会话');
        await transaction(s => { const t = s.tasks.find(t => t.id === task.id)!; t.createdTabId = tabId; t.pendingAgentId = uid(); if (closedTabs.has(tabId!)) { t.status = 'waiting'; t.reason = '创建页面已关闭，请打开原项目会话核对；不会另建重复会话'; } });
        await group(tabId);
      }
      await transaction(s => { const t = s.tasks.find(t => t.id === task.id); if (t?.status === 'sending') t.reason = '等待会话加载完成与输入区就绪'; });
      await waitForPageReady(tabId, `project:${(await snapshot()).project!.id}`, { requireComposer: false, shouldContinue: async () => Boolean(await liveDispatch(task.id)) });
      let prepared: { ready: boolean; reason?: string; observation?: Observation } | undefined;
      const prepareDeadline = Date.now() + 15_000;
      for (let i = 0; i < 60; i++) {
        if (!await liveDispatch(task.id)) return;
        try { await readTab(tabId, 'snapshot'); prepared = await message(tabId, { type: 'prepare_create' }); if (prepared?.ready) break; } catch { /* content script loading */ }
        if (Date.now() >= prepareDeadline) break;
        await new Promise(r => setTimeout(r, 250));
      }
      if (!prepared?.ready) throw new Error(prepared?.reason || '新会话尚未就绪，请打开标签页选择 Work 后重试发送');
      const live = await liveDispatch(task.id); if (!live) return;
      const s = live.store; const t = live.task;
      const text = creationPrompt(t, s);
      attempted = true;
      attempting.add(task.id);
      const outcome = await message<{ status: string; reason?: string }>(tabId, { type: 'send', agentId: `project:${s.project!.id}`, text, deliveryToken: t.deliveryToken });
      await transaction(s => { const t = s.tasks.find(t => t.id === task.id)!; if (t.status === 'sending') { t.status = outcome.status === 'wait' ? 'waiting' : 'uncertain'; t.reason = outcome.reason || '等待新会话地址与发送回执'; } });
      await refresh(tabId);
    } else {
      const s = await snapshot(); const agent = s.agents.find(a => a.id === task.targetId);
      if (!agent) return;
      const tabId = await ensureTab(agent);
      await transaction(s => { const t = s.tasks.find(t => t.id === task.id); if (t?.status === 'sending') t.reason = '等待会话加载完成与输入区就绪'; });
      const page = await waitForPageReady(tabId, agent.id, { shouldContinue: async () => Boolean(await liveDispatch(task.id)) });
      if (conversationId(page.url) !== agent.id) throw new Error('目标页面已切换，请重新核对会话');
      const live = await liveDispatch(task.id); if (!live) return;
      const current = live.task;
      attempted = true;
      attempting.add(task.id);
      const outcome = await message<{ status: string; reason?: string }>(tabId, { type: 'send', agentId: agent.id, text: taskPrompt(current,live.store), deliveryToken: current.deliveryToken });
      await transaction(s => {
        const t = s.tasks.find(t => t.id === task.id)!;
        if (t.status !== 'sending') return;
        t.status = outcome.status === 'sent' ? 'running' : outcome.status === 'wait' ? 'waiting' : 'uncertain';
        if (outcome.status === 'sent') t.deliveredAt = Date.now();
        t.reason = outcome.reason;
        addLog(s, outcome.status === 'sent' ? `已派发：${t.title}` : `${t.title}：${t.reason}`);
      });
      await refresh(tabId);
    }
  } catch (error) {
    // A transport exception may follow a successful click. Never assume it failed.
    await transaction(s => { const t = s.tasks.find(t => t.id === task.id); if (t?.status === 'sending') { t.status = attempted ? 'uncertain' : error instanceof PageLoadingTimeout ? 'queued' : 'waiting'; t.reason = error instanceof PageLoadingTimeout ? error.message : `需要核对：${isConnectionError(error) ? pageConnectionMessage : (error as Error).message}`; } });
  } finally { active.delete(task.id); attempting.delete(task.id); void pump(); }
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    if ((await snapshot()).paused) return;
    await syncNames();
    const s = await transaction(s => {
      s.tasks.filter(t => t.status === 'queued' && t.relatedTaskId && (s.tasks.find(parent => parent.id === t.relatedTaskId)?.status !== 'waiting' || s.tasks.find(parent => parent.id === t.relatedTaskId)?.attempt !== t.attempt)).forEach(t => { t.status = 'cancelled'; t.reason = '原任务已不再等待处理，取消过期的继续消息'; });
      return structuredClone(s);
    });
    const needsPage = s.agents.filter(a => s.tasks.some(t => t.targetId === a.id && t.status === 'queued' && t.approved && dependencyState(t,s).ready) && (!a.observation?.connected || Date.now() - a.observation.observedAt > 45000 || !a.observation.ready && !a.observation.interaction && !a.observation.running));
    // Open/load the first round together instead of awaiting each tab sequentially.
    await Promise.allSettled(needsPage.map(async agent => {
      const shouldContinue = async () => { const live = await snapshot(); return !live.paused && live.agents.some(a => a.id === agent.id && !a.tabClosed) && live.tasks.some(t => t.targetId === agent.id && t.status === 'queued' && t.approved && dependencyState(t,live).ready); };
      if (!await shouldContinue()) return;
      await transaction(s => { s.tasks.filter(t => t.targetId === agent.id && t.status === 'queued' && t.approved && dependencyState(t,s).ready).forEach(t => t.reason = '等待会话加载完成与输入区就绪'); });
      try {
        const tabId = await ensureTab(agent);
        const page = await waitForPageReady(tabId, agent.id, { shouldContinue });
        await transaction(s => {
          observe(s, page, tabId);
          s.tasks.filter(t => t.targetId === agent.id && t.status === 'queued' && t.approved && dependencyState(t,s).ready).forEach(t => t.reason = page.interaction || (page.running ? '会话仍在执行，等待完成' : undefined));
        });
      } catch (error) {
        await transaction(s => {
          if (s.paused || !s.agents.some(a => a.id === agent.id)) return;
          s.tasks.filter(t => t.targetId === agent.id && t.status === 'queued' && t.approved && dependencyState(t,s).ready).forEach(t => {
            t.reason = error instanceof PageLoadingTimeout ? error.message : `需要核对：${isConnectionError(error) ? pageConnectionMessage : (error as Error).message}`;
            if (!(error instanceof PageLoadingTimeout)) t.status = 'waiting';
          });
        });
      }
    }));
    const tasks = await transaction(s => {
      const eligible = eligibleTasks(s).filter(t => !active.has(t.id));
      eligible.forEach(t => { freezeInputs(t,s); t.status = 'sending'; t.reason = undefined; });
      const connecting = activeBootstrap(s);
      s.tasks.filter(t => t.kind === 'bootstrap' && t.status === 'queued').forEach(t => {
        if (connecting) t.reason = `逐个连接：等待${s.agents.find(a => a.id === connecting.targetId)?.name || '前一角色'}完成就绪确认`;
        else if (t.reason?.startsWith('逐个连接：')) t.reason = undefined;
      });
      return structuredClone(eligible);
    });
    tasks.forEach(t => { void dispatch(t); });
  } finally { pumping = false; }
}
async function overview() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*', currentWindow: true }).then(tabs => tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active }))).catch(() => []);
  return { store: await snapshot(), tabs };
}
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.type === 'observation' && sender.tab?.id !== undefined && isChatUrl(sender.url) && validObservation(request.observation) && conversationRouteId(sender.url!) === conversationRouteId(request.observation.url) && projectIdFromUrl(sender.url!) === projectIdFromUrl(request.observation.url)) {
    transaction(s => observe(s, request.observation, sender.tab!.id!)).then(() => { respond({ ok: true }); void pump(); }).catch(e => respond({ error: e.message })); return true;
  }
  const trusted = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html'));
  if (!trusted) return false;
  if (request?.type === 'overview') { overview().then(respond).catch(e => respond({ error: e.message })); return true; }
  if (request?.type === 'command') {
    (async () => {
      const command = request.command as PanelCommand;
      if (!command || typeof command.type !== 'string') throw new Error('无效操作');
      if (command.type === 'reconcile') {
        await reconnectOpenTabs();
        await transaction(s => { addLog(s, '已重新核对打开的会话；未确认的发送不会重发'); });
      } else if (command.type === 'sync_name') {
        await transaction(s => {
          const a = s.agents.find(a => a.id === command.agentId);
          if (!a || !conversationId(a.url)) throw new Error('请先打开原项目会话并恢复正式地址');
          a.conversationNameStatus = 'pending'; a.conversationNameReason = undefined;
        });
        await reconnectOpenTabs();
        await syncNames(command.agentId);
      } else if (command.type === 'stop') {
        const a = (await snapshot()).agents.find(a => a.id === command.agentId);
        if (!a) throw new Error('此成员已解绑');
        const tab = findTab(a, await chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
        if (tab?.id === undefined) throw new Error('请先打开成员会话');
        const page = await readTab<Observation>(tab.id, 'snapshot');
        if (conversationId(page.url) !== a.id) throw new Error('目标页面已切换，请重新核对会话');
        if (!(await snapshot()).agents.some(agent => agent.id === a.id)) throw new Error('此成员已解绑');
        const outcome = await message<{ stopped: boolean; reason?: string }>(tab.id, { type: 'stop', agentId: a.id });
        await transaction(s => {
          s.tasks.filter(t => t.targetId === a.id && t.status === 'running').forEach(t => { t.status = 'waiting'; t.reason = outcome.stopped ? '原生生成已停止，请检查任务成果后继续处理' : outcome.reason || '等待原生停止确认'; });
          addLog(s, `已请求停止：${a.name}`);
        }); await refresh(tab.id);
      } else if (command.type === 'resume_task') {
        const task = (await snapshot()).tasks.find(t => t.id === command.id);
        if (task && !dependencyState(task,await snapshot()).ready) {
          // Retrying an unsent task must not prepare its page before prerequisites.
          await transaction(s => {
            applyCommand(s,command);
            const t=s.tasks.find(t=>t.id===command.id)!;
            t.reason=dependencyState(t,s).reason;
            const a=s.agents.find(a=>a.id===t.targetId);
            if(a && !t.deliveredAt){a.tabClosed=false;a.tabOpening=false;}
          });
          void pump();return overview();
        }
        if (task?.kind === 'create' && ['waiting', 'uncertain'].includes(task.status)) {
          await reconnectOpenTabs();
          if (task.createdTabId !== undefined) await refresh(task.createdTabId);
          const current = (await snapshot()).tasks.find(t => t.id === command.id);
          if (current?.status !== 'waiting' || current.deliveredAt) { void pump(); return overview(); }
        }
        if (task?.status === 'waiting' && task.kind !== 'create') {
          const agent = (await snapshot()).agents.find(a => a.id === task.targetId);
          if (agent) {
            if (!task.deliveredAt) await transaction(s => { const a = s.agents.find(a => a.id === agent.id); if (a) { a.tabClosed = false; a.tabOpening = false; } });
            await refresh(await ensureTab(agent));
          }
          // A manual send/completion observed during the fresh read already resolved this retry.
          if ((await snapshot()).tasks.find(t => t.id === command.id)?.status !== 'waiting') { void pump(); return overview(); }
        }
        await transaction(s => applyCommand(s, command));
      } else await transaction(s => applyCommand(s, command));
      void pump(); return overview();
    })().then(respond).catch(e => respond({ error: isConnectionError(e) ? pageConnectionMessage : (e as Error).message })); return true;
  }
  return false;
});
chrome.action.onClicked.addListener(tab => { if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId }); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('work-team-heartbeat', { periodInMinutes: 0.5 }); });
chrome.alarms.onAlarm.addListener(() => { void reconnectOpenTabs().then(pump).catch(() => {}); });
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') void refresh(id).then(pump); });
chrome.tabs.onRemoved.addListener(id => {
  closedTabs.add(id);
  void transaction(s => {
    const affected = new Set(s.agents.filter(a => a.tabId === id).map(a => a.id));
    s.agents.filter(a => affected.has(a.id)).forEach(a => { a.tabId = undefined; a.tabClosed = true; a.tabOpening = false; if (a.observation) a.observation.connected = false; });
    s.tasks.filter(t => (affected.has(t.targetId) || t.kind === 'create' && t.createdTabId === id) && ['queued', 'sending'].includes(t.status)).forEach(t => {
      t.status = attempting.has(t.id) ? 'uncertain' : 'waiting';
      t.reason = attempting.has(t.id) ? '发送期间页面关闭，请核对原会话回执，不会重发' : '会话页面已关闭，自动派发已停止；请打开原会话或重试发送';
    });
  });
});
export const ready = loaded.then(async () => { await chrome.alarms.create('work-team-heartbeat', { periodInMinutes: 0.5 }); await reconnectOpenTabs(); await pump(); }).catch(() => {});
