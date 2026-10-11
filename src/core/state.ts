import type { Agent, AgentWorkState, Store, Task } from './types';
import { conversationId } from './types';
import { taskPrompt } from './protocol';
import { draftFingerprint } from './delivery';
import { dependencyState } from './dependencies';
export const labels: Record<AgentWorkState, string> = { idle: '空闲', running: '执行中', needs_interaction: '需要交互', unknown: '状态未知' };
export function stateFor(agent: Agent, store: Store, now = Date.now()): { state: AgentWorkState; reason: string } {
  if (conversationId(agent.url) !== agent.id) return { state: 'needs_interaction', reason: '会话地址无效，请重新绑定当前项目角色' };
  if (agent.tabClosed) return { state: 'needs_interaction', reason: '会话页面已关闭，请打开原会话或点击任务的重试发送' };
  const observation = agent.observation;
  const dependencies = store.tasks.filter(t => t.targetId === agent.id && ['draft','queued'].includes(t.status)).map(t => dependencyState(t,store));
  const blocked = dependencies.find(d => d.needsInteraction);
  const pending = dependencies.find(d => !d.ready);
  if (!observation?.connected || now - observation.observedAt > 45_000) {
    // Prerequisite waits are local queue state and need no page preparation.
    if (!store.tasks.some(t=>t.targetId===agent.id && ['sending','running','waiting','uncertain'].includes(t.status))) {
      if (blocked) return {state:'needs_interaction',reason:blocked.reason!};
      if (pending) return {state:'idle',reason:pending.reason!};
    }
    return { state: 'unknown', reason: '等待会话连接或重新核对状态' };
  }
  const waiting = store.tasks.find(t => t.targetId === agent.id && ['waiting', 'uncertain'].includes(t.status));
  if (observation.interaction || waiting) return { state: 'needs_interaction', reason: observation.interaction || waiting?.reason || '需要继续处理' };
  if (agent.supervisor && store.tasks.some(t => t.status === 'draft')) return { state: 'needs_interaction', reason: '有一轮任务等待用户确认' };
  if (observation.running || store.tasks.some(t => t.targetId === agent.id && ['sending', 'running'].includes(t.status))) return { state: 'running', reason: store.tasks.some(t => t.targetId === agent.id && t.kind === 'bootstrap' && t.status === 'running' && t.deliveredAt) ? '初始化消息已送达，等待 Work 返回就绪确认' : '正在处理当前任务' };
  if (agent.conversationNameStatus === 'waiting') return { state: 'needs_interaction', reason: agent.conversationNameReason || '会话名称待同步' };
  if (!observation.ready) return { state: 'unknown', reason: '未找到可用输入区' };
  if (observation.draft) return { state: 'needs_interaction', reason: '输入框存在草稿，队列等待发送' };
  if (blocked) return {state:'needs_interaction',reason:blocked.reason!};
  if (pending) return {state:'idle',reason:pending.reason!};
  return { state: 'idle', reason: '当前可以接收任务' };
}
export const taskLabels: Record<Task['status'], string> = { draft: '待确认', queued: '排队中', sending: '正在发送', running: '执行中', waiting: '需要交互', reported: '待主管验收', accepted: '已验收', cancelled: '已取消', uncertain: '需要核对' };
export function activeBootstrap(store: Store): Task | undefined {
  return store.tasks.find(t => t.kind === 'bootstrap' && (t.status === 'sending' || t.status === 'running' && !store.agents.find(a => a.id === t.targetId)?.observation?.interaction));
}
export function eligibleTasks(store: Store): Task[] {
  if (store.paused) return [];
  const busy = new Set(store.tasks.filter(t => ['sending', 'running'].includes(t.status)).map(t => t.targetId));
  store.agents.filter(a => a.observation?.running).forEach(a => busy.add(a.id));
  const runningMembers = [...busy].filter(id => !store.agents.find(a => a.id === id)?.supervisor).length;
  let slots = Math.max(0, store.settings.concurrency - runningMembers);
  // Connecting conversations starts real Work turns. Keep initialization at
  // one healthy turn at a time; business concurrency remains a separate setting.
  let connecting = Boolean(activeBootstrap(store));
  return store.tasks.filter(t => {
    if (t.status !== 'queued' || !t.approved || busy.has(t.targetId) || !dependencyState(t,store).ready) return false;
    if (t.kind === 'create') { if (slots <= 0) return false; slots--; busy.add(t.targetId); return true; }
    const agent = store.agents.find(a => a.id === t.targetId);
    if (t.kind !== 'report' && store.tasks.some(other => other.targetId === t.targetId && ['waiting', 'uncertain'].includes(other.status))) return false;
    if (!agent || agent.tabClosed || !agent.observation?.connected || Date.now() - agent.observation.observedAt > 45_000 || !agent.observation.ready || agent.observation.running || agent.observation.interaction) return false;
    // A waiting task is queued only by an explicit retry. Reuse its own complete draft;
    // the page adapter still compares the full text immediately before clicking.
    if (agent.observation.draft && (t.deliveredAt || agent.observation.draftFingerprint !== draftFingerprint(taskPrompt(t,store)))) return false;
    if (!agent.initialized && t.kind !== 'bootstrap') return false;
    if (t.kind === 'bootstrap' && connecting) return false;
    if (!agent.supervisor) { if (slots <= 0) return false; slots--; }
    if (t.kind === 'bootstrap') connecting = true;
    busy.add(agent.id); return true;
  });
}
