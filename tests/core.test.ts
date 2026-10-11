import { describe, expect, it } from 'vitest';
import { applyCommand, ingestObservation, makeTask } from '../src/core/engine';
import { parseEnvelope, resolveTarget, taskPrompt } from '../src/core/protocol';
import { draftFingerprint } from '../src/core/delivery';
import { eligibleTasks, stateFor } from '../src/core/state';
import { projectIdFromUrl } from '../src/core/types';
import { team, obs, agent, project, fence } from './helpers';
const dispatch = (target = 'member') => ({ kind: 'dispatch', target, title: '检查功能', instructions: '完成检查' });
function proposal(s = team(), actions: unknown[] = [dispatch()], messageId = 'reply') {
  ingestObservation(s, 'lead', obs('lead', { turnIndex: 1, messages: [{ id: messageId, role: 'assistant', text: fence({ version: 2, projectId: project.id, actions }) }] })); return s;
}
describe('协议与权限边界', () => {
  it('成员不能输出主管操作', () => { expect(() => parseEnvelope(fence({ version: 2, projectId: project.id, actions: [dispatch()] }), false)).toThrow(); });
  it('普通引用和一般 JSON 不触发派发', () => { expect(parseEnvelope('引用：{"actions":[]}', true)).toBeUndefined(); });
  it('拒绝多指令块与未知字段', () => { const f = fence({ version: 2, projectId: project.id, actions: [dispatch()] }); expect(() => parseEnvelope(`${f}\n${f}`, true)).toThrow(); expect(() => parseEnvelope(fence({ version: 2, projectId: project.id, actions: [dispatch()], arbitrary: true }), true)).toThrow(); });
  it('slug 地址与项目首页得到相同项目标识', () => { expect(projectIdFromUrl(project.url)).toBe(project.id); expect(projectIdFromUrl(`${project.url.replace('/project','')}-test-project/c/lead`)).toBe(project.id); });
  it('目标成员必须唯一且不能指向主管', () => { expect(() => resolveTarget(team().agents, 'lead')).toThrow(); expect(() => resolveTarget([agent(), agent()], 'member')).toThrow(); });
  it('跨项目指令不会进入队列', () => { const s = team(); ingestObservation(s, 'lead', obs('lead', { messages: [{ id: 'x', role: 'assistant', text: fence({ version: 2, projectId: 'wrong', actions: [dispatch()] }) }] })); expect(s.tasks).toHaveLength(0); expect(s.agents[0].observation?.interaction).toContain('项目'); });
  it('整轮原子校验，无效目标不留下部分任务', () => { expect(proposal(team(), [dispatch(), dispatch('missing')]).tasks).toHaveLength(0); });
  it('初次绑定只建立历史基线', () => { const s = team(); s.agents[0].observation = undefined; expect(proposal(s).tasks).toHaveLength(0); });
  it('虚拟列表加载旧轮次不会重放指令', () => { const s = proposal(); ingestObservation(s, 'lead', obs('lead', { turnIndex: 0, messages: [{ id: 'old-unloaded', role: 'assistant', text: fence({ version: 2, projectId: project.id, actions: [dispatch()] }) }] })); expect(s.tasks).toHaveLength(1); });
  it('同一回复重连后不会重复派发', () => { const s = proposal(); proposal(s); expect(s.tasks).toHaveLength(1); });
});
describe('队列与交互状态', () => {
  it('连接协作主管优先，每次只启动一个初始化回合，回执不足以启动下一个', () => {
    const s=team(); s.agents.reverse(); s.agents.forEach(a=>a.initialized=false);
    applyCommand(s,{type:'initialize'}); const first=eligibleTasks(s); expect(first).toHaveLength(1); expect(first[0].targetId).toBe('lead');
    const t=first[0]; t.status='sending'; expect(eligibleTasks(s)).toHaveLength(0);
    ingestObservation(s,'lead',obs('lead',{running:true,messages:[{id:'u',role:'user',text:`[WT-DELIVERY:${t.deliveryToken}]`}]}));
    expect(t.status).toBe('running'); expect(eligibleTasks(s)).toHaveLength(0);
    ingestObservation(s,'lead',obs('lead',{messages:[{id:'u',role:'user',text:`[WT-DELIVERY:${t.deliveryToken}]`},{id:'a',role:'assistant',text:'协作已就绪'}]}));
    expect(t.status).toBe('accepted'); expect(eligibleTasks(s)).toHaveLength(1);
  });
  it('答复连接中断显示黄色，同角色不重发，其他角色可以继续初始化', () => {
    const s=team(); s.agents.forEach(a=>a.initialized=false); applyCommand(s,{type:'initialize'});
    const t=s.tasks[0]; t.status='running'; t.deliveredAt=123;
    s.agents[0].observation=obs('lead',{running:true,interaction:'连接已中断，正在等待完整答复'});
    expect(stateFor(s.agents[0],s).state).toBe('needs_interaction'); expect(eligibleTasks(s).map(t=>t.targetId)).toEqual(['member']);
    applyCommand(s,{type:'initialize'}); expect(s.tasks).toHaveLength(3); expect(t.deliveryToken).toBe(s.tasks[0].deliveryToken);
  });
  it('正常业务派发继续使用原成员并发设置', () => {
    const s=team(); s.settings.concurrency=2; s.tasks=['member','other'].map(targetId=>makeTask({kind:'dispatch',senderId:'lead',targetId,title:'业务',instructions:'执行',approved:true,status:'queued'}));
    expect(eligibleTasks(s)).toHaveLength(2);
  });
  it('断连角色可解绑，保留成果并停止相关消息，重复解绑无副作用', () => {
    const s = team(); s.agents[1].observation!.connected = false;
    const original = makeTask({ id: 'original', kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '旧任务', instructions: '执行', status: 'uncertain', result: '已有成果' });
    const report = makeTask({ kind: 'report', senderId: 'member', targetId: 'lead', title: '回报', instructions: '成果', status: 'queued' });
    const other = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'other', title: '其他任务', instructions: '执行', status: 'waiting' });
    s.tasks = [original, report, other];
    applyCommand(s, { type: 'unbind', id: 'member' });
    expect(s.agents.map(a => a.id)).toEqual(['lead', 'other']);
    expect(s.tasks.map(t => t.status)).toEqual(['cancelled', 'cancelled', 'waiting']);
    expect(original.result).toBe('已有成果'); expect(original.reason).toContain('原生任务');
    expect(s.agents[0].initialized).toBe(false);
    const after = structuredClone(s); applyCommand(s, { type: 'unbind', id: 'member' }); expect(s).toEqual(after);
  });
  it('解绑主管后暂停后续协作，已验收历史保持原样', () => {
    const s = team();
    s.tasks = ['queued', 'running', 'accepted'].map(status => makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '执行', status: status as 'queued' | 'running' | 'accepted' }));
    applyCommand(s, { type: 'unbind', id: 'lead' });
    expect(s.paused).toBe(true); expect(s.tasks.map(t => t.status)).toEqual(['cancelled', 'cancelled', 'accepted']);
  });
  it('默认须确认，确认后才可派发', () => { const s = proposal(); expect(eligibleTasks(s)).toHaveLength(0); applyCommand(s, { type: 'approve', ids: [s.tasks[0].id] }); expect(eligibleTasks(s)).toHaveLength(1); });
  it('自动模式不会追认已有草稿', () => { const s = proposal(); applyCommand(s, { type: 'settings', settings: { ...s.settings, mode: 'auto' } }); expect(s.tasks[0].status).toBe('draft'); });
  it('自动轮数上限产生待确认项并暂停', () => { const s = team(); s.settings.mode = 'auto'; s.settings.maxAutoRounds = 1; proposal(s); proposal(s, [dispatch('other')], 'reply-2'); expect(s.paused).toBe(true); expect(s.tasks.map(t => t.status)).toEqual(['queued','draft']); });
  it('一会话串行且成员并发不超过上限', () => { const s = team(); s.agents.push(agent('third')); s.tasks = ['member','member','other','third'].map(targetId => makeTask({ kind: 'dispatch', senderId: 'lead', targetId, title: 'test', instructions: 'test', approved: true, status: 'queued' })); expect(eligibleTasks(s).map(t => t.targetId)).toEqual(['member','other']); });
  it('原生运行也占用成员并发槽', () => { const s = proposal(); s.tasks[0].approved = true; s.tasks[0].status = 'queued'; s.settings.concurrency = 1; s.agents[2].observation!.running = true; expect(eligibleTasks(s)).toHaveLength(0); });
  it('有草稿时不覆盖，也不发送', () => { const s = proposal(); applyCommand(s, { type: 'approve', ids: [s.tasks[0].id] }); s.agents[1].observation!.draft = true; expect(eligibleTasks(s)).toHaveLength(0); expect(stateFor(s.agents[1], s).state).toBe('needs_interaction'); });
  it('明确未发送的自有草稿只有用户重试后才重新进入派发', () => {
    const s = team(); const t = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '任务', instructions: '检查\n\n代码', status: 'waiting', approved: true }); s.tasks = [t];
    Object.assign(s.agents[1].observation!, { draft: true, draftFingerprint: draftFingerprint(taskPrompt(t)) });
    expect(eligibleTasks(s)).toEqual([]); applyCommand(s, { type: 'resume_task', id: t.id }); expect(eligibleTasks(s)).toEqual([t]);
    s.agents[1].observation!.draftFingerprint = draftFingerprint(taskPrompt(t) + '用户修改'); expect(eligibleTasks(s)).toEqual([]);
    t.deliveredAt = Date.now(); s.agents[1].observation!.draftFingerprint = draftFingerprint(taskPrompt(t)); expect(eligibleTasks(s)).toEqual([]);
  });
  it('断连和过期状态显示未知', () => { const s = team(); s.agents[1].observation!.observedAt -= 46000; expect(stateFor(s.agents[1], s).state).toBe('unknown'); });
  it('等待原生权限的黄点优先于执行红点', () => { const s = team(); Object.assign(s.agents[1].observation!, { running: true, interaction: '等待授权' }); expect(stateFor(s.agents[1], s).state).toBe('needs_interaction'); });
  it('发送不确定不能一键重试', () => { const s = team(); s.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: 'test', instructions: 'test', status: 'uncertain' })]; expect(() => applyCommand(s, { type: 'resume_task', id: s.tasks[0].id })).toThrow('不会自动重发'); });
  it('已送达恢复时请求补充回报，不重放原任务', () => { const s = team(); s.tasks = [makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: 'test', instructions: 'test', status: 'waiting', deliveredAt: Date.now() })]; applyCommand(s, { type: 'resume_task', id: s.tasks[0].id }); expect(s.tasks[0].status).toBe('waiting'); expect(s.tasks[1].kind).toBe('report'); });
  it('保存编辑不会立即派发', () => { const s = proposal(); applyCommand(s, { type: 'edit', id: s.tasks[0].id, title: '新标题', instructions: '新内容', context: '', acceptance: '' }); expect(s.tasks[0].status).toBe('draft'); });
  it('拒绝绑定其他项目会话', () => { const s = team(); expect(() => applyCommand(s, { type: 'bind', agent: { ...agent('stranger'), url: 'https://chatgpt.com/g/g-p-other/c/stranger' } })).toThrow(); });
  it('批量绑定整组校验，无效成员不会留下部分导入', () => { const s = team(); const before = structuredClone(s); expect(() => applyCommand(s, { type: 'bind_many', agents: [agent('newlead',true), { ...agent('bad'), userVerifiedWork: false }] })).toThrow(); expect(s).toEqual(before); });
  it('换主管会重连双方角色的路由说明', () => { const s = team(); applyCommand(s, { type: 'bind', agent: { ...agent('member'), supervisor: true } }); expect(s.agents.find(a => a.id === 'lead')?.initialized).toBe(false); expect(s.agents.find(a => a.id === 'member')?.initialized).toBe(false); });
});
describe('成员回报及回执', () => {
  it('回报先进入主管队列，成果与验收分离', () => { const s = team(); const task = makeTask({ id: 'task', kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '检查', instructions: '检查', status: 'running', deliveredAt: Date.now() }); s.tasks.push(task); ingestObservation(s, 'member', obs('member', { messages: [{ id: 'result', role: 'assistant', text: fence({ version: 2, projectId: project.id, taskId: 'task', attempt: 1, status: 'completed', summary: '检查通过' }) }] })); expect(task.status).toBe('reported'); expect(s.tasks[1].targetId).toBe('lead'); expect(s.tasks[1].kind).toBe('report'); });
  it('拒绝冒领其他成员任务', () => { const s = team(); s.tasks.push(makeTask({ id: 'task', kind: 'dispatch', senderId: 'lead', targetId: 'other', title: '检查', instructions: '检查', status: 'running', deliveredAt: Date.now() })); ingestObservation(s, 'member', obs('member', { messages: [{ id: 'result', role: 'assistant', text: fence({ version: 2, projectId: project.id, taskId: 'task', attempt: 1, status: 'completed', summary: '冒领' }) }] })); expect(s.tasks).toHaveLength(1); expect(s.tasks[0].status).toBe('running'); });
  it('用页面回执恢复不确定发送', () => { const s = team(); const t = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '检查', instructions: '检查', status: 'uncertain' }); s.tasks.push(t); ingestObservation(s, 'member', obs('member', { running: true, messages: [{ id: 'receipt', role: 'user', text: `[WT-DELIVERY:${t.deliveryToken}]` }] })); expect(t.status).toBe('running'); expect(t.deliveredAt).toBeDefined(); });
  it('流式指令不解析', () => { const s = team(); ingestObservation(s, 'lead', obs('lead', { running: true, messages: [{ id: 'stream', role: 'assistant', text: fence({ version: 2, projectId: project.id, actions: [dispatch()] }) }] })); expect(s.tasks).toHaveLength(0); });
  it('用户手动发送已填入的草稿，也可用回执接续队列', () => { const s = team(); const t = makeTask({ kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '检查', instructions: '检查', status: 'waiting' }); s.tasks.push(t); ingestObservation(s, 'member', obs('member', { running: true, messages: [{ id: 'manual', role: 'user', text: `[WT-DELIVERY:${t.deliveryToken}]` }] })); expect(t.status).toBe('running'); });
  it('主管指导暂停任务，成员继续回报原任务并完成指导消息', () => { const s = team(); const original = makeTask({ id: 'original', kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '检查', instructions: '检查', status: 'waiting', deliveredAt: Date.now() }); s.tasks.push(original); proposal(s, [{ kind: 'resume', taskId: original.id, attempt: 1, instructions: '使用已经确定的字段继续检查' }]); const guidance = s.tasks[1]; expect(guidance.relatedTaskId).toBe(original.id); expect(guidance.status).toBe('draft'); applyCommand(s, { type: 'approve', ids: [guidance.id] }); expect(eligibleTasks(s)).toEqual([guidance]); guidance.status = 'running'; guidance.deliveredAt = Date.now(); ingestObservation(s, 'member', obs('member', { messages: [{ id: 'guidance-user', role: 'user', text: `[WT-DELIVERY:${guidance.deliveryToken}]` }, { id: 'guidance-result', role: 'assistant', text: fence({ version: 2, projectId: project.id, taskId: original.id, attempt: 2, status: 'completed', summary: '继续检查通过' }) }] })); expect(original.status).toBe('reported'); expect(guidance.status).toBe('accepted'); });
  it('主管不能通过指导操作重发未确认送达的任务', () => { const s = team(); s.tasks.push(makeTask({ id: 'uncertain', kind: 'dispatch', senderId: 'lead', targetId: 'member', title: '检查', instructions: '检查', status: 'uncertain' })); proposal(s, [{ kind: 'resume', taskId: 'uncertain', attempt: 1, instructions: '重做' }]); expect(s.tasks).toHaveLength(1); });
});
