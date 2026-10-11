import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { team, obs, project, fence } from './helpers';
import { makeTask } from '../src/core/engine';
import { stateFor } from '../src/core/state';
import { uid } from '../src/core/types';
import { taskPrompt } from '../src/core/protocol';
import { draftFingerprint } from '../src/core/delivery';
import type { Observation, Store } from '../src/core/types';
let persisted: Store;
let listeners: Array<(request: unknown, sender: unknown, respond: (v: unknown) => void) => unknown>;
type Send = (tabId: number, data: { type: string; text: string; name?: string }) => Promise<unknown>;
let send: ReturnType<typeof vi.fn<Send>>;
let tabData: Map<number, { id: number; url: string; windowId: number; pendingUrl?: string; status?: 'loading' | 'complete' }>;
let pages: Map<number, Observation>;
const event = () => ({ addListener: vi.fn() });
beforeEach(() => {
  vi.resetModules(); persisted = team(); listeners = [];
  persisted.agents.forEach((a,i) => a.tabId = i + 1);
  tabData = new Map(persisted.agents.map((a,i) => [i+1, { id: i+1, url: a.url, windowId: 1 }]));
  pages = new Map(persisted.agents.map((a,i) => [i+1, obs(a.id)]));
  send = vi.fn(async (tabId: number, data: { type: string; text: string; name?: string }) => {
    if (data.type === 'snapshot') return structuredClone(pages.get(tabId));
    if (data.type === 'rename') { pages.get(tabId)!.title = data.name!; return { status: 'synced' }; }
    if (data.type === 'prepare_create') return { ready: true, observation: obs('new') };
    if (data.type === 'send') {
      expect(persisted.tasks.some(t => t.status === 'sending')).toBe(true);
      const t = persisted.tasks.find(t => data.text.includes(`[WT-DELIVERY:${t.deliveryToken}]`))!;
      if (t.kind === 'create') {
        const id = t.newAgentSupervisor ? 'created-supervisor' : 'created';
        tabData.get(tabId)!.url = obs(id).url;
        pages.set(tabId, obs(id, { messages: [{ id: 'u-new', role: 'user', text: data.text }, { id: 'a-new', role: 'assistant', text: t.newAgentSupervisor ? '协作已就绪' : fence({ version: 2, projectId: project.id, taskId: t.id, attempt: 1, status: 'completed', summary: '新成员成果' }) }] }));
      } else pages.set(tabId, { ...pages.get(tabId)!, running: true, messages: [{ id: 'receipt', role: 'user', text: data.text }] });
      return { status: 'sent' };
    }
    return { stopped: true };
  });
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ 'gptworkbot-state-v2': structuredClone(persisted) })), set: vi.fn(async (data: Record<string, Store>) => { persisted = structuredClone(data['gptworkbot-state-v2']); }) } },
    runtime: { id: 'extension', getURL: (p: string) => `chrome-extension://extension/${p}`, onMessage: { addListener: (fn: typeof listeners[number]) => listeners.push(fn) }, onInstalled: event() },
    tabs: { query: vi.fn(async (query: { url?: string } = {}) => [...tabData.values()].filter(t => !query.url || t.url.startsWith('https://chatgpt.com/'))), get: vi.fn(async (id: number) => { const tab = tabData.get(id); if (!tab) throw new Error('No tab with id'); return tab; }), create: vi.fn(async ({ url }: { url: string }) => { const id = Math.max(0, ...tabData.keys()) + 1; tabData.set(id, { id, url, windowId: 1, status: 'complete' }); pages.set(id, obs('new', { url })); return tabData.get(id); }), group: vi.fn(async () => 1), sendMessage: send, onUpdated: event(), onRemoved: event() },
    scripting: { executeScript: vi.fn(async () => []) },
    tabGroups: { query: vi.fn(async () => []), update: vi.fn(async () => {}) }, sidePanel: { open: vi.fn() }, action: { onClicked: event() }, alarms: { create: vi.fn(async () => {}), onAlarm: event() }
  });
});
afterEach(() => { vi.useRealTimers(); });
async function boot() { const background = await import('../src/extension/background'); await background.ready; }
function panel(request: unknown): Promise<{ store: Store; error?: string }> { return new Promise(resolve => { listeners[0](request, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' }, resolve as (v: unknown) => void); }); }
describe('持久后台调度集成', () => {
  it('重启后核对已去重的初始化回复，解除执行中并连接协议，不重发消息', async () => {
    persisted.paused=true; persisted.agents[0].initialized=false;
    const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'连接项目经理',instructions:'连接',status:'running',deliveredAt:123}); persisted.tasks=[t]; persisted.processed=['lead:done'];
    pages.set(1,obs('lead',{messages:[{id:'u',role:'user',text:`[WT-DELIVERY:${t.deliveryToken}]`,turnId:'fallback-turn-1',turnComplete:true},{id:'done',role:'assistant',text:'协作已就绪',turnId:'fallback-turn-1',turnComplete:true}]}));
    await boot(); expect(persisted.tasks[0].status).toBe('accepted'); expect(persisted.agents[0].initialized).toBe(true); expect(stateFor(persisted.agents[0],persisted).state).toBe('idle');
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(persisted.tasks).toHaveLength(1); expect(persisted.paused).toBe(true); expect(chrome.tabs.create).not.toHaveBeenCalled(); expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(0);
  });
  it('临时地址不绑定或补开，正式地址出现后命名并保留送达职责', async () => {
    const task=makeTask({kind:'create',senderId:'lead',targetId:'new:pending',title:'初始化软件开发',instructions:'只初始化',newAgentName:'软件开发',newAgentInstructions:'负责软件开发与测试\n遵守项目规范',status:'queued',approved:true}); persisted.tasks=[task];
    const original=send.getMockImplementation()!;
    send.mockImplementation(async(id,data)=>{
      if(data.type==='send' && data.text.startsWith(`[WT-DELIVERY:${task.deliveryToken}]`)) {
        tabData.get(id)!.url=obs('local-chatgpt%3Atemp-uuid').url;
        pages.set(id,obs('local-chatgpt%3Atemp-uuid',{running:true,messages:[{id:'u',role:'user',text:data.text}]})); return {status:'sent'};
      } return original(id,data);
    });
    await boot(); await vi.waitFor(()=>expect(persisted.tasks[0].status).toBe('uncertain'));
    expect(persisted.agents.some(a=>a.name==='软件开发')).toBe(false);
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    const id=persisted.tasks[0].createdTabId!; const text=send.mock.calls.find(([,m])=>m.type==='send')![1].text;
    expect(text).toContain('你的角色名称：软件开发'); expect(text).toContain('负责软件开发与测试\n遵守项目规范');
    tabData.get(id)!.url=obs('durable-member').url;
    pages.set(id,obs('durable-member',{messages:[{id:'u',role:'user',text},{id:'a',role:'assistant',text:fence({version: 2,projectId:project.id,taskId: task.id, attempt: 1, status:'completed',summary:'就绪'})}]}));
    await panel({type:'command',command:{type:'reconcile'}});
    await vi.waitFor(()=>expect(persisted.agents.find(a=>a.id==='durable-member')?.conversationNameStatus).toBe('synced'));
    expect(persisted.agents.find(a=>a.id==='durable-member')).toMatchObject({name:'软件开发',responsibilities:task.newAgentInstructions});
    expect(send.mock.calls.filter(([,m])=>m.type==='send' && m.text.startsWith(`[WT-DELIVERY:${task.deliveryToken}]`))).toHaveLength(1);
    expect(send.mock.calls.filter(([,m])=>m.type==='rename')).toHaveLength(1); expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('恢复只有 pendingUrl 的加载页，不受 URL 查询过滤影响', async () => {
    vi.useFakeTimers(); persisted.tasks=[makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'测试',instructions:'执行',status:'queued',approved:true})];
    tabData.set(2,{id:2,url:'about:blank',pendingUrl:obs().url,status:'loading',windowId:1}); pages.get(2)!.ready=false;
    const starting=boot(); await vi.waitFor(()=>expect(persisted.tasks[0].reason).toContain('等待会话加载'));
    await vi.advanceTimersByTimeAsync(15_000); await starting;
    await panel({type:'command',command:{type:'reconcile'}}); await vi.advanceTimersByTimeAsync(15_000);
    expect(chrome.tabs.create).not.toHaveBeenCalled(); expect(persisted.agents[1].tabId).toBe(2);
  });
  it('关闭加载中的页面停止自动重开，显式重试只打开并发送一次', async () => {
    vi.useFakeTimers(); const task=makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'测试',instructions:'执行',status:'queued',approved:true}); persisted.tasks=[task];
    tabData.get(2)!.status='loading'; pages.get(2)!.ready=false;
    const starting=boot(); await vi.waitFor(()=>expect(persisted.tasks[0].reason).toContain('等待会话加载'));
    tabData.delete(2); pages.delete(2); vi.mocked(chrome.tabs.onRemoved.addListener).mock.calls[0][0](2,{windowId:1,isWindowClosing:false});
    await vi.advanceTimersByTimeAsync(500); await starting;
    expect(persisted.tasks[0].status).toBe('waiting'); expect(persisted.agents[1].tabClosed).toBe(true);
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    vi.mocked(chrome.tabs.create).mockImplementation(async input=>{const id=4; tabData.set(id,{id,url:input.url!,windowId:1,status:'complete'}); pages.set(id,obs()); return tabData.get(id) as chrome.tabs.Tab;});
    await panel({type:'command',command:{type:'resume_task',id:task.id}});
    await vi.advanceTimersByTimeAsync(500); await vi.waitFor(()=>expect(persisted.tasks[0].status).toBe('running'));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1); expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(1);
  });
  it('首次打开被重定向首页后停止，后续核对不产生新页', async () => {
    tabData.delete(2); pages.delete(2); persisted.agents[1].tabId=undefined;
    persisted.tasks=[makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'检查',instructions:'执行',status:'queued',approved:true})];
    vi.mocked(chrome.tabs.create).mockImplementation(async()=>{tabData.set(4,{id:4,url:'https://chatgpt.com/',windowId:1,status:'complete'}); pages.set(4,obs('root',{url:'https://chatgpt.com/'}));return tabData.get(4) as chrome.tabs.Tab;});
    await boot(); expect(persisted.tasks[0].status).toBe('waiting');
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1); expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(0);
  });
  it('命名失败只等待单独重试，不重复初始化或创建', async () => {
    persisted.agents[1].conversationNameStatus='pending';
    persisted.tasks=[makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'初始化',instructions:'就绪',newAgentName:'member',newAgentInstructions:'软件开发与测试',status:'reported',deliveredAt:123})];
    pages.get(2)!.title='自动生成的标题'; const original=send.getMockImplementation()!; let fail=true;
    send.mockImplementation(async(id,data)=>data.type==='rename' && fail ? {status:'wait',reason:'标题入口未就绪'} : original(id,data));
    await boot(); expect(persisted.agents[1].conversationNameStatus).toBe('waiting');
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(send.mock.calls.filter(([,m])=>m.type==='rename')).toHaveLength(1);
    fail=false; await panel({type:'command',command:{type:'pause',paused:true}});
    await panel({type:'command',command:{type:'sync_name',agentId:'member'}});
    expect(persisted.agents[1].conversationNameStatus).toBe('synced'); expect(persisted.tasks[0]).toMatchObject({status:'reported',deliveredAt:123});
    expect(chrome.tabs.create).not.toHaveBeenCalled(); expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(0);
  });
  it('原生保存已确认时不因随后快照的旧标题退回待命名', async () => {
    persisted.paused=true; persisted.agents[1].conversationNameStatus='waiting'; pages.get(2)!.title='旧标题';
    const original=send.getMockImplementation()!;
    send.mockImplementation(async(id,data)=>data.type==='rename' ? {status:'synced',confirmation:{url:obs().url,title:'member'}} : original(id,data));
    await boot(); await panel({type:'command',command:{type:'sync_name',agentId:'member'}});
    expect(persisted.agents[1].conversationNameStatus).toBe('synced'); expect(persisted.agents[1].conversationNameReason).toBeUndefined();
    expect(persisted.agents[1].observation?.title).toBe('旧标题');
    expect(send.mock.calls.filter(([,m])=>m.type==='rename')).toHaveLength(1);
    expect(chrome.tabs.create).not.toHaveBeenCalled(); expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(0);
  });
  it('其他会话的名称确认不能结算目标角色', async () => {
    persisted.paused=true; persisted.agents[1].conversationNameStatus='waiting'; pages.get(2)!.title='旧标题';
    const original=send.getMockImplementation()!;
    send.mockImplementation(async(id,data)=>data.type==='rename' ? {status:'synced',confirmation:{url:obs('other').url,title:'member'}} : original(id,data));
    await boot(); await panel({type:'command',command:{type:'sync_name',agentId:'member'}});
    expect(persisted.agents[1].conversationNameStatus).toBe('waiting');
  });
  it('已保存角色名称的确认不等待正在执行的 Work 任务结束', async () => {
    persisted.paused=true; persisted.agents[1].conversationNameStatus='waiting'; persisted.agents[1].conversationNameReason='尚未确认保存';
    pages.set(2,obs('member',{title:'member',running:true}));
    await boot(); expect(persisted.agents[1].conversationNameStatus).toBe('synced'); expect(persisted.agents[1].conversationNameReason).toBeUndefined();
    expect(stateFor(persisted.agents[1],persisted).state).toBe('running'); expect(send.mock.calls.filter(([,m])=>m.type==='rename')).toHaveLength(0);
  });
  it('首轮先加载所有会话，主管先连接，收到最终回复后逐个连接成员', async () => {
    vi.useFakeTimers(); persisted.agents.forEach(a => { a.initialized = false; });
    persisted.tasks = persisted.agents.map(a => makeTask({ kind: 'bootstrap', senderId: 'lead', targetId: a.id, title: `连接${a.name}`, instructions: '同步消息路由', status: 'queued', approved: true }));
    tabData.clear(); pages.clear();
    vi.mocked(chrome.tabs.create).mockImplementation(async ({ url }) => {
      const id = Math.max(0, ...tabData.keys()) + 1;
      tabData.set(id, { id, url: '', pendingUrl: url, status: 'loading', windowId: 1 });
      pages.set(id, obs(url!.match(/\/c\/([^/]+)/)![1], { ready: false }));
      return tabData.get(id) as chrome.tabs.Tab;
    });
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (id, data) => { if (data.type === 'send') { expect(tabData.get(id)!.status).toBe('complete'); expect(pages.get(id)!.ready).toBe(true); } return original(id, data); });
    const starting = boot();
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledTimes(3));
    expect(persisted.tasks.every(t => t.status === 'queued' && t.reason?.includes('等待会话加载'))).toBe(true);
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0); expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    for (const tab of tabData.values()) { tab.url = tab.pendingUrl!; tab.pendingUrl = undefined; tab.status = 'complete'; }
    await vi.advanceTimersByTimeAsync(500); expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
    for (const page of pages.values()) page.ready = true;
    await vi.advanceTimersByTimeAsync(500); await starting;
    await vi.waitFor(() => expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(1));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('running'));
    expect(persisted.tasks.slice(1).every(t=>t.status==='queued' && t.reason?.includes('逐个连接'))).toBe(true);
    for(let i=0;i<3;i++) {
      const t=persisted.tasks.find(t=>t.status==='running')!; expect(t).toBeDefined();
      const tab=[...tabData.values()].find(tab=>tab.url===obs(t.targetId).url)!;
      pages.set(tab.id,obs(t.targetId,{messages:[{id:'u-'+i,role:'user',text:`[WT-DELIVERY:${t.deliveryToken}]`},{id:'a-'+i,role:'assistant',text:'协作已就绪'}]}));
      await panel({type:'command',command:{type:'reconcile'}});
      await vi.waitFor(()=>expect(persisted.tasks.filter(t=>t.status==='accepted')).toHaveLength(i+1));
      await vi.waitFor(()=>expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(Math.min(i+2,3)));
      expect(persisted.tasks.filter(t=>t.status==='running').length).toBeLessThanOrEqual(1);
    }
    expect(persisted.tasks.every(t=>t.status==='accepted')).toBe(true); expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.filter(([,m])=>m.type==='send').map(([id])=>tabData.get(id)!.url)).toEqual(persisted.agents.map(a=>a.url));
  });
  it('软件开发原生连接中断时隔离等待，其他角色初始化继续，回执不重发', async () => {
    persisted.agents[1].initialized=false; persisted.agents[2].initialized=false;
    const slow=makeTask({kind:'bootstrap',senderId:'lead',targetId:'member',title:'连接软件开发',instructions:'连接',status:'running',deliveredAt:123,approved:true});
    const next=makeTask({kind:'bootstrap',senderId:'lead',targetId:'other',title:'连接营销推广',instructions:'连接',status:'queued',approved:true}); persisted.tasks=[slow,next];
    pages.set(2,obs('member',{running:true,interaction:'连接已中断，正在等待完整答复',messages:[{id:'slow-u',role:'user',text:`[WT-DELIVERY:${slow.deliveryToken}]`}]}));
    await boot(); await vi.waitFor(()=>expect(persisted.tasks[1].status).toBe('running'));
    expect(stateFor(persisted.agents[1],persisted).state).toBe('needs_interaction');
    for(let i=0;i<3;i++) await panel({type:'command',command:{type:'reconcile'}});
    expect(persisted.tasks[0]).toMatchObject({status:'running',deliveredAt:123,deliveryToken:slow.deliveryToken}); expect(persisted.tasks).toHaveLength(2);
    expect(send.mock.calls.filter(([,m])=>m.type==='send').map(([id])=>id)).toEqual([3]); expect(chrome.tabs.create).not.toHaveBeenCalled();
    pages.set(2,obs('member',{messages:[{id:'slow-u',role:'user',text:`[WT-DELIVERY:${slow.deliveryToken}]`},{id:'slow-a',role:'assistant',text:'协作已就绪'}]}));
    await panel({type:'command',command:{type:'reconcile'}});
    expect(persisted.tasks[0].status).toBe('accepted'); expect(persisted.agents[1].initialized).toBe(true); expect(stateFor(persisted.agents[1],persisted).state).toBe('idle');
    expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(1);
  });
  it.each(['pause', 'unbind'])('会话加载中 %s 会中止首轮等待，不发送初始化命令', async action => {
    vi.useFakeTimers(); persisted.agents[1].initialized = false;
    persisted.tasks = [makeTask({ kind: 'bootstrap', senderId: 'lead', targetId: 'member', title: '连接成员', instructions: '初始化', status: 'queued', approved: true })];
    tabData.get(2)!.status = 'loading'; pages.get(2)!.ready = false;
    const starting = boot(); await vi.waitFor(() => expect(persisted.tasks[0].reason).toContain('等待会话加载'));
    const response = await panel({ type: 'command', command: action === 'pause' ? { type: 'pause', paused: true } : { type: 'unbind', id: 'member' } });
    expect(response.error).toBeUndefined(); tabData.get(2)!.status = 'complete'; pages.get(2)!.ready = true;
    await vi.advanceTimersByTimeAsync(500); await starting;
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
    expect(persisted.tasks[0].status).toBe(action === 'pause' ? 'queued' : 'cancelled');
  });
  it('首轮加载超过 15 秒仍保留队列，加载完成事件自动接续且不另开页面', async () => {
    vi.useFakeTimers(); persisted.agents[1].initialized = false;
    persisted.tasks = [makeTask({ kind: 'bootstrap', senderId: 'lead', targetId: 'member', title: '连接成员', instructions: '初始化', status: 'queued', approved: true })];
    tabData.get(2)!.status = 'loading'; pages.get(2)!.ready = false;
    const starting = boot(); await vi.waitFor(() => expect(persisted.tasks[0].reason).toContain('等待会话加载'));
    await vi.advanceTimersByTimeAsync(15_000); await starting;
    expect(persisted.tasks[0].status).toBe('queued'); expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
    tabData.get(2)!.status = 'complete'; pages.get(2)!.ready = true;
    const onUpdated = vi.mocked(chrome.tabs.onUpdated.addListener).mock.calls[0][0];
    onUpdated(2, { status: 'complete' }, tabData.get(2) as chrome.tabs.Tab);
    await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('running'));
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(1); expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it('等待按钮失败后重试先读取自有草稿，并沿用相同任务和发送标识', async () => {
    const task = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行\n\n检查', status: 'queued', approved: true }); persisted.tasks = [task];
    const original = send.getMockImplementation()!; let attempts = 0;
    send.mockImplementation(async (id, data) => {
      if (data.type === 'send' && ++attempts === 1) {
        pages.set(id, obs('member', { draft: true, draftFingerprint: draftFingerprint(data.text) }));
        return { status: 'wait', reason: '发送按钮仍被禁用' };
      }
      return original(id, data);
    });
    await boot(); await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('waiting'));
    await panel({ type: 'command', command: { type: 'resume_task', id: task.id } });
    await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('running'));
    expect(persisted.tasks).toHaveLength(1);
    const messages = send.mock.calls.filter(([,m]) => m.type === 'send'); expect(messages).toHaveLength(2);
    expect(messages.map(([,m]) => m.text)).toEqual([taskPrompt(task), taskPrompt(task)]);
  });
  it('点击重试时刷新最新草稿，用户修改的任务不发送', async () => {
    const task = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'waiting', approved: true }); persisted.tasks = [task];
    pages.set(2, obs('member', { draft: true, draftFingerprint: draftFingerprint(taskPrompt(task)) }));
    await boot(); send.mockClear();
    pages.set(2, obs('member', { draft: true, draftFingerprint: draftFingerprint(taskPrompt(task) + '修改') }));
    const response = await panel({ type: 'command', command: { type: 'resume_task', id: task.id } });
    expect(response.error).toBeUndefined(); expect(persisted.tasks[0].status).toBe('queued');
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
  });
  it('手动发送后再点重试只核对回执，不发业务任务或额外继续消息', async () => {
    const task = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'waiting', approved: true }); persisted.tasks = [task];
    await boot(); send.mockClear();
    pages.set(2, obs('member', { running: true, messages: [{ id: 'manual', role: 'user', text: taskPrompt(task) }] }));
    const response = await panel({ type: 'command', command: { type: 'resume_task', id: task.id } });
    expect(response.error).toBeUndefined(); expect(persisted.tasks[0].status).toBe('running'); expect(persisted.tasks).toHaveLength(1);
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
  });
  it('创建角色的发送按钮不可用后复用原项目页和草稿，不再创建页面', async () => {
    const task = makeTask({ kind: 'create', senderId: 'lead', targetId: 'new:pending', title: '初始化检查员', instructions: '初始化', newAgentName: '检查员', newAgentInstructions: '检查实现', status: 'queued', approved: true }); persisted.tasks = [task];
    const original = send.getMockImplementation()!; let waited = false;
    send.mockImplementation(async (id, data) => {
      if (data.type === 'send' && data.text.startsWith(`[WT-DELIVERY:${task.deliveryToken}]`) && !waited) {
        waited = true; pages.set(id, obs('new', { url: project.url, draft: true, draftFingerprint: draftFingerprint(data.text) }));
        return { status: 'wait', reason: '发送按钮仍被禁用' };
      }
      return original(id, data);
    });
    await boot(); await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('waiting'));
    await panel({ type: 'command', command: { type: 'resume_task', id: task.id } });
    await vi.waitFor(() => expect(persisted.agents.some(a => a.name === '检查员')).toBe(true));
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: project.url, active: false });
    const sends = send.mock.calls.filter(([,m]) => m.type === 'send' && m.text.startsWith(`[WT-DELIVERY:${task.deliveryToken}]`));
    expect(sends).toHaveLength(2); expect(sends[0][1].text).toBe(sends[1][1].text); expect(sends[0][0]).toBe(sends[1][0]);
    await vi.waitFor(() => expect(persisted.tasks.some(t => t.title === '同步新成员路由' && t.status === 'running')).toBe(true));
  });
  it('创建主管后异常重启，按当前项目的回执找回新编号并入组，不重建或重发', async () => {
    persisted.agents = [];
    const requestId = uid();
    const task = makeTask({ kind: 'create', senderId: `panel:${requestId}`, targetId: 'new:pending', title: '初始化主管', instructions: '初始化', newAgentName: '主管', newAgentInstructions: '项目协调', newAgentSupervisor: true, sourceKey: `panel:create:${requestId}`, status: 'sending', approved: true, createdTabId: 4 });
    persisted.tasks = [task];
    tabData = new Map([[88, { id: 88, url: obs('restored-lead').url, windowId: 1 }]]);
    pages = new Map([[88, obs('restored-lead', { messages: [{ id: 'receipt', role: 'user', text: `[WT-DELIVERY:${task.deliveryToken}]` }, { id: 'final', role: 'assistant', text: '协作已就绪' }] })]]);
    await boot();
    expect(persisted.agents[0]).toMatchObject({ id: 'restored-lead', projectId: project.id, supervisor: true, initialized: true, tabId: 88 });
    expect(persisted.tasks[0]).toMatchObject({ kind: 'bootstrap', status: 'accepted', createdTabId: 88 });
    expect(chrome.tabs.create).not.toHaveBeenCalled(); expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
  });
  it('空团队先创建 Work 主管再创建成员，两者都自动加入当前项目', async () => {
    persisted.agents = []; tabData.clear(); pages.clear(); await boot();
    const leadRequest = { type: 'command', command: { type: 'create_agent', requestId: uid(), projectId: project.id, supervisor: true, name: '新主管', responsibilities: '协调当前项目的任务与成员' } };
    const response = await panel(leadRequest); expect(response.error).toBeUndefined();
    await vi.waitFor(() => expect(persisted.agents.some(a => a.supervisor && a.initialized)).toBe(true));
    expect(persisted.agents[0]).toMatchObject({ id: 'created-supervisor', projectId: project.id, supervisor: true, name: '新主管' });
    expect(persisted.tasks[0]).toMatchObject({ kind: 'bootstrap', targetId: 'created-supervisor', senderId: 'created-supervisor', status: 'accepted' });
    await panel(leadRequest); expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    const data = await panel({ type: 'command', command: { type: 'create_agent', requestId: uid(), projectId: project.id, name: '新成员', responsibilities: '审查当前项目' } });
    expect(data.error).toBeUndefined();
    await vi.waitFor(() => expect(persisted.agents.some(a => a.id === 'created')).toBe(true));
    expect(persisted.agents.every(a => a.projectId === project.id)).toBe(true);
    expect(vi.mocked(chrome.tabs.create).mock.calls.map(([input]) => input)).toEqual([{ url: project.url, active: false }, { url: project.url, active: false }]);
    await vi.waitFor(() => expect(persisted.tasks.some(t => t.title === '同步新成员路由' && t.status === 'running')).toBe(true));
  });
  it('侧栏创建在当前项目打开一次 Work 会话，回执后自动入组并同步主管', async () => {
    await boot();
    const data = await panel({ type: 'command', command: { type: 'create_agent', requestId: uid(), projectId: project.id, name: '手动检查员', responsibilities: '检查当前项目', firstTask: '检查实现', acceptance: '报告问题' } });
    expect(data.error).toBeUndefined();
    await vi.waitFor(() => expect(persisted.agents.some(a => a.name === '手动检查员')).toBe(true));
    const created = persisted.agents.find(a => a.name === '手动检查员')!;
    expect(created).toMatchObject({ id: 'created', projectId: project.id, initialized: true, supervisor: false });
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: project.url, active: false });
    expect(send.mock.calls.some(([,m]) => m.type === 'prepare_create')).toBe(true);
    expect(persisted.tasks.find(t => t.newAgentName === '手动检查员')).toMatchObject({ targetId: 'created', status: 'reported', result: '新成员成果' });
    await vi.waitFor(() => expect(persisted.tasks.some(t => t.title === '同步新成员路由' && t.status === 'running')).toBe(true));
  });
  it('暂停中双击创建只有一项任务，恢复后也只打开一个当前项目页', async () => {
    persisted.paused = true; await boot();
    const request = { type: 'command', command: { type: 'create_agent', requestId: uid(), projectId: project.id, name: '新成员', responsibilities: '项目检查' } };
    await Promise.all([panel(request), panel(request)]);
    expect(persisted.tasks).toHaveLength(1); expect(chrome.tabs.create).not.toHaveBeenCalled();
    await panel({ type: 'command', command: { type: 'pause', paused: false } });
    await vi.waitFor(() => expect(persisted.agents.some(a => a.name === '新成员')).toBe(true));
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: project.url, active: false });
    await vi.waitFor(() => expect(persisted.tasks.some(t => t.title === '同步新成员路由' && t.status === 'running')).toBe(true));
  });
  it('提交旧项目的创建表单不打开页面，也不污染当前组织', async () => {
    await boot();
    const data = await panel({ type: 'command', command: { type: 'create_agent', requestId: uid(), projectId: 'g-p-other', name: '新成员', responsibilities: '检查' } });
    expect(data.error).toContain('当前项目已切换'); expect(persisted.tasks).toHaveLength(0); expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it('重启后目标页面已关闭，仍能本地解绑并保存取消记录', async () => {
    tabData.clear(); pages.clear();
    persisted.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '旧任务', instructions: '执行', status: 'running', deliveredAt: Date.now() })];
    await boot(); send.mockClear();
    const data = await panel({ type: 'command', command: { type: 'unbind', id: 'member' } });
    expect(data.error).toBeUndefined(); expect(data.store.agents.some(a => a.id === 'member')).toBe(false);
    expect(persisted.tasks[0].status).toBe('cancelled'); expect(persisted.tasks[0].deliveredAt).toBeDefined();
    expect(send).not.toHaveBeenCalled(); expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it('标签页列表暂不可用也不影响本地解绑的成功响应', async () => {
    await boot(); vi.mocked(chrome.tabs.query).mockRejectedValue(new Error('浏览器窗口正在恢复'));
    const data = await panel({ type: 'command', command: { type: 'unbind', id: 'member' } });
    expect(data.error).toBeUndefined(); expect(data.store.agents.some(a => a.id === 'member')).toBe(false);
  });
  it('重启后的编号按会话地址恢复，停止请求不会发到被复用的旧编号', async () => {
    tabData = new Map(persisted.agents.map((a,i) => [(i+1)*10, { id: (i+1)*10, url: a.url, windowId: 1 }]));
    pages = new Map(persisted.agents.map((a,i) => [(i+1)*10, obs(a.id)]));
    tabData.set(2, { id: 2, url: obs('unrelated').url, windowId: 1 }); pages.set(2, obs('unrelated', { running: true }));
    await boot();
    expect(persisted.agents.find(a => a.id === 'member')?.tabId).toBe(20);
    send.mockClear();
    const data = await panel({ type: 'command', command: { type: 'stop', agentId: 'member' } });
    expect(data.error).toBeUndefined();
    expect(send.mock.calls.filter(([,m]) => m.type === 'stop').map(([id]) => id)).toEqual([20]);
    expect(send.mock.calls.some(([id]) => id === 2)).toBe(false);
  });
  it('没有目标会话时停止操作不碰旧编号，也不创建新页面', async () => {
    tabData.delete(2); pages.delete(2);
    tabData.set(2, { id: 2, url: 'https://example.com', windowId: 1 });
    await boot(); send.mockClear();
    const data = await panel({ type: 'command', command: { type: 'stop', agentId: 'member' } });
    expect(data.error).toBe('请先打开成员会话'); expect(send).not.toHaveBeenCalled(); expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it('重启后内容脚本缺失会自动恢复，无需手动刷新页面', async () => {
    const original = send.getMockImplementation()!; let missing = true;
    send.mockImplementation(async (id, data) => { if (id === 2 && missing) throw new Error('Could not establish connection. Receiving end does not exist.'); return original(id, data); });
    vi.mocked(chrome.scripting.executeScript).mockImplementation(async () => { missing = false; return []; });
    await boot();
    expect(persisted.agents.find(a => a.id === 'member')?.observation?.connected).toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 2 }, files: ['content.js'] });
  });
  it('派发等待页面响应时解绑，不继续发送旧任务', async () => {
    persisted.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'queued', approved: true })];
    const original = send.getMockImplementation()!;
    let release!: (page: Observation) => void;
    send.mockImplementation(async (id, data) => {
      if (id === 2 && data.type === 'snapshot' && persisted.tasks[0].status === 'sending') return new Promise<Observation>(resolve => { release = resolve; });
      return original(id, data);
    });
    await boot(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await panel({ type: 'command', command: { type: 'unbind', id: 'member' } });
    release(obs()); await new Promise(resolve => setTimeout(resolve, 50));
    expect(persisted.tasks[0].status).toBe('cancelled');
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
  });
  it('发送响应丢失只标记待核对，核对回执后恢复且不重发', async () => {
    persisted.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'queued', approved: true })];
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (id, data) => { const result = await original(id, data); if (data.type === 'send') throw new Error('The message port closed before a response was received.'); return result; });
    await boot(); await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('uncertain'));
    await panel({ type: 'command', command: { type: 'reconcile' } });
    expect(persisted.tasks[0].status).toBe('running');
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(1);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('先持久化发送状态，再向后台会话派发', async () => {
    persisted.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'queued', approved: true })];
    await boot(); await vi.waitFor(() => expect(persisted.tasks[0].status).toBe('running'));
    expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(1);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it('服务重启后把进行中的发送设为待核对，绝不重发', async () => {
    persisted.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: 'sending', approved: true })];
    await boot(); const data = await panel({ type: 'overview' }); expect(data.store.tasks[0].status).toBe('uncertain'); expect(send.mock.calls.filter(([,m]) => m.type === 'send')).toHaveLength(0);
  });
  it('网页内容脚本不能伪装成侧栏提交用户确认', async () => {
    await boot(); const callback = vi.fn(); const result = listeners[0]({ type: 'command', command: { type: 'pause', paused: true } }, { id: 'extension', url: obs().url, tab: { id: 2 } }, callback); expect(result).toBe(false); expect(callback).not.toHaveBeenCalled();
  });
  it('创建只开一次项目页，确认回执后绑定真实会话并收取首个成果', async () => {
    persisted.tasks = [makeTask({ kind: 'create', senderId: 'lead', targetId: 'new:pending', title: '首个任务', instructions: '检查实现', newAgentName: '新检查员', newAgentInstructions: '沿用项目约束', status: 'queued', approved: true })];
    await boot(); await vi.waitFor(() => expect(persisted.agents.some(a => a.id === 'created')).toBe(true));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: project.url, active: false });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(persisted.tasks[0].status).toBe('reported'); expect(persisted.tasks[0].targetId).toBe('created');
    await vi.waitFor(() => expect(persisted.tasks.some(t => t.title === '同步新成员路由' && t.status === 'running')).toBe(true));
  });
});

function dependentTasks(ready=false) {
  const a=makeTask({id:'analysis-task',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'member',title:'竞争力分析',instructions:'提供完整报告',status:ready?'accepted':'queued',approved:true});
  const m=makeTask({id:'marketing-task',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'other',title:'宣传策略',instructions:'基于成果制定策略',status:'queued',approved:true,dependsOn:[a.id],inputs:[{name:'分析报告',fromTask:a.id,field:'summary',required:true}]});
  persisted.tasks=[a,m];
  if(ready){a.acceptedAttempt=1;a.deliveredAt=123;a.result='完整报告\n优势、证据与限制';a.resultReportId='analysis-report';a.resultHistory=[{attempt:1,status:'completed',summary:a.result,reportId:a.resultReportId,sourceName:'竞争分析',sourceUrl:obs().url,at:123}];persisted.tasks.push(makeTask({id:'analysis-report',projectId:project.id,kind:'report',senderId:'member',targetId:'lead',title:'本轮回报',instructions:a.result,status:'accepted',deliveredAt:124}));}
  return {a,m};
}
describe('persistent dependency scheduling',()=>{
  it('uses only the v2 key and leaves old storage untouched',async()=>{
    const legacy={...team(),version:1};Object.assign(chrome.storage.local,{get:vi.fn(async()=>({'work-team-state-v1':legacy}))});await boot();
    expect(chrome.storage.local.get).toHaveBeenCalledWith('gptworkbot-state-v2');expect(persisted.version).toBe(2);expect(persisted.agents).toEqual([]);expect(chrome.tabs.create).not.toHaveBeenCalled();expect(send.mock.calls.filter(([,m])=>m.type==='send')).toHaveLength(0);
    for(const [write] of vi.mocked(chrome.storage.local.set).mock.calls) expect(Object.keys(write)).toEqual(['gptworkbot-state-v2']);
  });
  it('does not open marketing until analysis is reported and accepted, and sends the complete input',async()=>{
    const {a,m}=dependentTasks();tabData.delete(3);pages.delete(3);persisted.agents[2].tabId=undefined;
    await boot();await vi.waitFor(()=>expect(persisted.tasks[0].status).toBe('running'));expect(chrome.tabs.create).not.toHaveBeenCalled();expect(persisted.tasks[1].resolvedInputs).toBeUndefined();
    const summary='完整竞争分析\n优势 A：证据 https://example.com/evidence\n限制 B：不宜夸大';
    pages.set(2,obs('member',{messages:[{id:'analysis-u',role:'user',text:taskPrompt(a)},{id:'analysis-a',role:'assistant',text:fence({version:2,projectId:project.id,taskId:a.id,attempt:1,status:'completed',summary})}]}));
    await panel({type:'command',command:{type:'reconcile'}});await vi.waitFor(()=>expect(persisted.tasks.find(t=>t.id===persisted.tasks[0].resultReportId)?.status).toBe('running'));
    expect(chrome.tabs.create).not.toHaveBeenCalled();expect(persisted.tasks[1].status).toBe('queued');const report=persisted.tasks.find(t=>t.id===persisted.tasks[0].resultReportId)!;
    pages.set(1,obs('lead',{messages:[{id:'report-u',role:'user',text:taskPrompt(report)},{id:'accept-a',role:'assistant',text:fence({version:2,projectId:project.id,actions:[{kind:'accept',taskId:a.id,attempt:1}]})}]}));
    await panel({type:'command',command:{type:'reconcile'}});await vi.waitFor(()=>expect(persisted.tasks[1].status).toBe('running'));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);const payload=send.mock.calls.find(([,data])=>data.type==='send' && data.text.includes('[WT-DELIVERY:'+m.deliveryToken+']'))![1].text;
    expect(payload).toContain(summary);expect(payload).toContain(obs().url);expect(persisted.tasks[1].resolvedInputs?.[0].summary).toBe(summary);
    const marketingTab=persisted.agents[2].tabId!;pages.set(marketingTab,obs('other',{messages:[{id:'m-u',role:'user',text:payload},{id:'m-a',role:'assistant',text:fence({version:2,projectId:project.id,taskId:m.id,attempt:1,status:'completed',summary:'基于优势 A 的宣传策略'})}]}));
    await panel({type:'command',command:{type:'reconcile'}});await vi.waitFor(()=>expect(persisted.tasks.find(t=>t.id===persisted.tasks[1].resultReportId)?.status).toBe('running'));
    const finalReport=persisted.tasks.find(t=>t.id===persisted.tasks[1].resultReportId)!;pages.set(1,obs('lead',{messages:[{id:'final-u',role:'user',text:taskPrompt(finalReport)},{id:'final-a',role:'assistant',text:fence({version:2,projectId:project.id,actions:[{kind:'accept',taskId:m.id,attempt:1}]})}]}));await panel({type:'command',command:{type:'reconcile'}});
    expect(persisted.tasks.slice(0,2).map(t=>t.status)).toEqual(['accepted','accepted']);expect(persisted.tasks.filter(t=>t.kind==='dispatch')).toHaveLength(2);
  });
  it('a page failure for independent work does not change a blocked task in the same conversation',async()=>{
    const {a,m}=dependentTasks();a.status='draft';m.targetId='member';persisted.tasks.push(makeTask({projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'member',title:'独立工作',instructions:'执行',approved:true,status:'queued'}));pages.set(2,obs('wrong'));
    await boot();expect(persisted.tasks[1].status).toBe('queued');expect(persisted.tasks[1].reason).toBeUndefined();expect(persisted.tasks[2].status).toBe('waiting');expect(send.mock.calls.filter(([,data])=>data.type==='send')).toHaveLength(0);
  });
  it('persists a frozen input before the first send and reuses it and its token on retry',async()=>{
    const {m}=dependentTasks(true);const original=send.getMockImplementation()!;let first=true;
    send.mockImplementation(async(id,data)=>{if(data.type==='send' && data.text.includes('[WT-DELIVERY:'+m.deliveryToken+']')){expect(persisted.tasks[1].resolvedInputs?.[0].summary).toBe('完整报告\n优势、证据与限制');if(first){first=false;return {status:'wait',reason:'发送按钮尚未就绪'};}}return original(id,data);});
    await boot();await vi.waitFor(()=>expect(persisted.tasks[1].status).toBe('waiting'));await panel({type:'command',command:{type:'resume_task',id:m.id}});await vi.waitFor(()=>expect(persisted.tasks[1].status).toBe('running'));
    const attempts=send.mock.calls.filter(([,data])=>data.type==='send' && data.text.includes('[WT-DELIVERY:'+m.deliveryToken+']'));expect(attempts).toHaveLength(2);expect(attempts[0][1].text).toBe(attempts[1][1].text);
  });
  it('recovers a delivered dependent result after restart without resending its frozen payload',async()=>{
    const {a,m}=dependentTasks(true);m.resolvedInputs=[{...m.inputs[0],attempt:1,summary:a.result!,sourceName:'竞争分析',sourceUrl:obs().url}];m.status='sending';persisted.paused=true;
    const payload=taskPrompt(m,persisted);pages.set(3,obs('other',{messages:[{id:'restart-u',role:'user',text:payload},{id:'restart-a',role:'assistant',text:fence({version:2,projectId:project.id,taskId:m.id,attempt:1,status:'completed',summary:'营销成果'})}]}));
    await boot();expect(persisted.tasks[1].status).toBe('reported');expect(persisted.tasks[1].resolvedInputs).toEqual(m.resolvedInputs);expect(persisted.tasks[1].deliveryToken).toBe(m.deliveryToken);expect(send.mock.calls.filter(([,data])=>data.type==='send')).toHaveLength(0);
    for(let i=0;i<3;i++)await panel({type:'command',command:{type:'reconcile'}});expect(persisted.tasks.filter(t=>t.kind==='report' && t.status==='queued')).toHaveLength(1);
  });
});

describe('dependent creation and revision recovery',()=>{
  it('creates a dependent role only after acceptance and includes the frozen report and responsibilities',async()=>{
    const {m}=dependentTasks();m.kind='create';m.targetId='new:marketing';m.newAgentName='新营销';m.newAgentInstructions='负责基于事实的宣传';persisted.paused=true;
    await boot();await panel({type:'command',command:{type:'pause',paused:false}});await vi.waitFor(()=>expect(persisted.tasks[0].status).toBe('running'));expect(chrome.tabs.create).not.toHaveBeenCalled();
    const a=persisted.tasks[0];pages.set(2,obs('member',{messages:[{id:'create-u',role:'user',text:taskPrompt(a)},{id:'create-a',role:'assistant',text:fence({version:2,projectId:project.id,taskId:a.id,attempt:1,status:'completed',summary:'完整分析材料'})}]}));await panel({type:'command',command:{type:'reconcile'}});await vi.waitFor(()=>expect(persisted.tasks.find(t=>t.id===persisted.tasks[0].resultReportId)?.status).toBe('running'));
    expect(chrome.tabs.create).not.toHaveBeenCalled();await panel({type:'command',command:{type:'accept',id:a.id,attempt:1}});await vi.waitFor(()=>expect(persisted.agents.some(a=>a.name==='新营销')).toBe(true));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);const text=send.mock.calls.find(([,data])=>data.type==='send' && data.text.includes('[WT-DELIVERY:'+m.deliveryToken+']'))![1].text;expect(text).toContain('完整分析材料');expect(text).toContain(m.newAgentInstructions);expect(persisted.tasks[1].resolvedInputs?.[0].summary).toBe('完整分析材料');
  });
  it('recovers a revised result at first observation and waits for its new report and acceptance',async()=>{
    const {a,m}=dependentTasks(true);a.status='waiting';a.attempt=2;a.result=undefined;a.acceptedAttempt=undefined;a.resultReportId=undefined;persisted.paused=true;
    const guidance=makeTask({projectId:project.id,kind:'report',senderId:'lead',targetId:'member',title:'主管指导',instructions:'补充证据',attempt:2,relatedTaskId:a.id,status:'running',deliveredAt:200});persisted.tasks.push(guidance);
    persisted.agents[1].observation=undefined;pages.set(2,obs('member',{messages:[{id:'revision-u',role:'user',text:taskPrompt(guidance)},{id:'revision-a',role:'assistant',text:fence({version:2,projectId:project.id,taskId:a.id,attempt:2,status:'completed',summary:'第二版完整成果'})}]}));
    await boot();expect(persisted.tasks[0]).toMatchObject({attempt:2,status:'reported',result:'第二版完整成果'});expect(persisted.tasks[0].resultHistory.map(r=>r.attempt)).toEqual([1,2]);expect(persisted.tasks.find(t=>t.id===guidance.id)?.status).toBe('accepted');expect(persisted.tasks[1].status).toBe('queued');expect(persisted.tasks[1].resolvedInputs).toBeUndefined();
    await panel({type:'command',command:{type:'accept',id:a.id,attempt:2}});await panel({type:'command',command:{type:'pause',paused:false}});await vi.waitFor(()=>expect(persisted.tasks.find(t=>t.id===persisted.tasks[0].resultReportId)?.status).toBe('running'));await vi.waitFor(()=>expect(persisted.tasks[1].status).toBe('running'));expect(persisted.tasks[1].resolvedInputs?.[0]).toMatchObject({attempt:2,summary:'第二版完整成果'});expect(send.mock.calls.some(([,data])=>data.type==='send' && data.text.includes('[WT-DELIVERY:'+m.deliveryToken+']'))).toBe(true);
  });
});

describe('checks immediately before preparing and sending dependent messages',()=>{
  it('explicit retry returns to dependency waiting without opening the downstream page',async()=>{
    const {a,m}=dependentTasks();a.status='draft';m.status='waiting';persisted.agents[2].tabClosed=true;tabData.delete(3);pages.delete(3);
    await boot();await panel({type:'command',command:{type:'resume_task',id:m.id}});expect(persisted.tasks[1].status).toBe('queued');expect(persisted.tasks[1].reason).toContain('等待前置');expect(chrome.tabs.create).not.toHaveBeenCalled();expect(send.mock.calls.filter(([,data])=>data.type==='send')).toHaveLength(0);
  });
  it('cancels obsolete guidance if the original result completes while its page is being checked',async()=>{
    const {a}=dependentTasks();a.status='waiting';a.deliveredAt=123;
    const guide=makeTask({projectId:project.id,kind:'report',senderId:'lead',targetId:'member',title:'核对进展',instructions:'补充回报',attempt:1,relatedTaskId:a.id,status:'queued',approved:true});persisted.tasks.push(guide);
    const original=send.getMockImplementation()!;let release!: (page:Observation)=>void;
    send.mockImplementation(async(id,data)=>id===2 && data.type==='snapshot' && persisted.tasks.find(t=>t.id===guide.id)?.status==='sending'?new Promise<Observation>(resolve=>{release=resolve;}):original(id,data));
    await boot();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const completed=obs('member',{messages:[{id:'late-completed',role:'assistant',text:fence({version:2,projectId:project.id,taskId:a.id,attempt:1,status:'completed',summary:'无需再核对的完整成果'})}]});
    await new Promise(resolve=>listeners[0]({type:'observation',observation:completed},{tab:{id:2},url:completed.url},resolve));release(completed);
    await vi.waitFor(()=>expect(persisted.tasks.find(t=>t.id===guide.id)?.status).toBe('cancelled'));expect(send.mock.calls.some(([,data])=>data.type==='send' && data.text.includes('[WT-DELIVERY:'+guide.deliveryToken+']'))).toBe(false);
  });
});
