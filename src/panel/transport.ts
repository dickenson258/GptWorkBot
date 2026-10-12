import { applyCommand, makeTask } from '../core/engine';
import { emptyStore, conversationId } from '../core/types';
import type { PanelCommand, Store, Agent } from '../core/types';
import { readTab, isConnectionError, backgroundConnectionMessage } from '../extension/connection';
import { mergeConversations } from '../core/conversations';
import type { ProjectDiscovery } from '../core/conversations';
import { normalizeLocale, browserLocale, languageStorageKey } from '../core/language';
export const preview = typeof chrome === 'undefined' || !chrome.runtime?.id;
export interface TabInfo { id?: number; url?: string; title?: string; active?: boolean }
export interface Overview { store: Store; tabs: TabInfo[] }
export type Discovery = ProjectDiscovery;
const demo = emptyStore();
if (preview) {
  demo.project = { id: 'g-p-demo', name: '产品竞争力与宣传', url: 'https://chatgpt.com/g/g-p-demo/project' };
  const member = (id: string, name: string, supervisor = false): Agent => ({ id, name, supervisor, projectId: 'g-p-demo', url: `https://chatgpt.com/g/g-p-demo/c/${id}`, initialized: true, userVerifiedWork: true, observation: { url: `https://chatgpt.com/g/g-p-demo/c/${id}`, title: name, projectId: 'g-p-demo', connected: true, ready: true, running: id === 'analysis', interaction: id === 'reviewer' ? '请确认数据范围' : undefined, draft: false, workMode: 'work', observedAt: Date.now(), messages: [] } });
  demo.agents = [member('lead', '项目主管', true), member('analysis', '竞争分析'), member('marketing', '营销推广'), member('reviewer', '质量检查')];
  demo.tasks = [
    makeTask({ projectId:'g-p-demo', id:'analysis-task', taskKey:'analysis', kind:'dispatch', senderId:'lead', targetId:'analysis', title:'分析产品竞争力', instructions:'对比竞品优劣势，给出证据、产品优势与限制。', acceptance:'完整报告包含事实依据及宣传限制。', status:'running', approved:true, deliveredAt:Date.now(), roundId:'plan-1' }),
    makeTask({ projectId:'g-p-demo', id:'marketing-task', taskKey:'marketing', kind:'dispatch', senderId:'lead', targetId:'marketing', title:'制定宣传策略', instructions:'根据已验收的竞争力分析报告制定宣传策略。', dependsOn:['analysis-task'], inputs:[{name:'竞争力分析报告',fromTask:'analysis-task',field:'summary',required:true}], status:'queued', approved:true, roundId:'plan-1' }),
    makeTask({ projectId:'g-p-demo', id:'review-task', kind:'dispatch', senderId:'lead', targetId:'reviewer', title:'核对市场数据', instructions:'检查数据范围和证据质量。', status:'waiting', approved:true, deliveredAt:Date.now(), reason:'需要主管确认数据范围', roundId:'plan-1' })
  ];
  demo.events = [{id:'e1',at:Date.now(),text:'本轮任务已确认'}, {id:'e2',at:Date.now()-20000,text:'已派发：分析产品竞争力'}];
}

async function request(data: unknown, retrySafe = false): Promise<Overview> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(data);
      if (!response) throw new Error('Could not establish connection. Receiving end does not exist.');
      if (response.error) throw new Error(response.error);
      return response;
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      if (!retrySafe || attempt >= 2) throw new Error(backgroundConnectionMessage);
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
export async function overview(): Promise<Overview> {
  if (preview) {
    try { demo.locale=normalizeLocale(localStorage.getItem(languageStorageKey)) || browserLocale(); } catch { demo.locale=browserLocale(); }
    demo.agents.forEach(a => { if (a.observation) a.observation.observedAt = Date.now(); }); return { store: structuredClone(demo), tabs: [] };
  }
  return request({ type: 'overview' }, true);
}
export async function command(command: PanelCommand): Promise<Overview> {
  if (preview) {
    if (command.type === 'stop') { const a = demo.agents.find(a => a.id === command.agentId); if (a?.observation) a.observation.running = false; }
    else applyCommand(demo, command);
    return overview();
  }
  return request({ type: 'command', command }, command.type === 'unbind' || command.type === 'create_agent');
}
export async function discover(tabId: number): Promise<Discovery> {
  const data = await readTab<Discovery>(tabId, 'discover');
  return { ...data, conversations: mergeConversations(data.conversations.map(conversation => ({ ...conversation, source: 'native' }))) };
}
export async function openConversation(url: string) {
  if (preview) return;
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  const id = conversationId(url);
  const tab = tabs.find(t => id ? conversationId(t.url || '') === id : t.url === url);
  if (tab?.id !== undefined) { await chrome.tabs.update(tab.id, { active: true }); if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }); }
  else await chrome.tabs.create({ url, active: true });
}
