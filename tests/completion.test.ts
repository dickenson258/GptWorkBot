import { describe, expect, it } from 'vitest';
import { ingestObservation, makeTask } from '../src/core/engine';
import { stateFor } from '../src/core/state';
import { team, obs, fence, project } from './helpers';
import type { PageMessage } from '../src/core/types';

const ack = (token: string, id='receipt'): PageMessage => ({id,role:'user',text:`[WT-DELIVERY:${token}]`});
describe('结束确认与回复指令去重分离', () => {
  it.each(['bootstrap','report'] as const)('已处理的 %s 最终回复仍能结束消息任务并回到空闲', kind => {
    const s=team(); s.agents[0].initialized=false; const t=makeTask({kind,senderId:'lead',targetId:'lead',title:'项目经理路由',instructions:'同步',status:'running',deliveredAt:123}); s.tasks=[t];
    s.processed=['lead:done'];
    ingestObservation(s,'lead',obs('lead',{messages:[ack(t.deliveryToken),{id:'done',role:'assistant',text:'协作已就绪'}]}));
    expect(t.status).toBe('accepted'); expect(stateFor(s.agents[0],s).state).toBe('idle');
    expect(s.agents[0].initialized).toBe(kind === 'bootstrap');
  });
  it('只读取最新指令，之前完成的路由消息仍按自己的最终回复结束', () => {
    const s=team(); const old=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'路由',instructions:'同步',status:'running',deliveredAt:123});
    const report=makeTask({kind:'report',senderId:'member',targetId:'lead',title:'成员回报',instructions:'回报',status:'running',deliveredAt:456}); s.tasks=[old,report]; s.processed=['lead:old-final','lead:new-final'];
    ingestObservation(s,'lead',obs('lead',{messages:[ack(old.deliveryToken,'u1'),{id:'old-final',role:'assistant',text:'协作已就绪'},ack(report.deliveryToken,'u2'),{id:'new-final',role:'assistant',text:'验收完成'}]}));
    expect(old.status).toBe('accepted'); expect(report.status).toBe('accepted'); expect(stateFor(s.agents[0],s).state).toBe('idle');
  });
  it('最终回复先出现、回执后加载，后续核对可以结束而不重放派发指令', () => {
    const s=team(); const t=makeTask({kind:'report',senderId:'member',targetId:'lead',title:'回报',instructions:'回报',status:'running',deliveredAt:123}); s.tasks=[t];
    const final={id:'done',role:'assistant' as const,text:fence({version: 2,projectId:project.id,actions:[{kind:'dispatch',target:'member',title:'检查',instructions:'检查'}]})};
    ingestObservation(s,'lead',obs('lead',{messages:[final]})); expect(s.tasks).toHaveLength(2); expect(t.status).toBe('running');
    ingestObservation(s,'lead',obs('lead',{messages:[ack(t.deliveryToken),final]}));
    expect(t.status).toBe('accepted'); expect(s.tasks).toHaveLength(2);
    ingestObservation(s,'lead',obs('lead',{messages:[ack(t.deliveryToken),final]})); expect(s.tasks).toHaveLength(2);
  });
  it('初始化历史基线仍可核对已知送达的任务，但不执行历史主管指令', () => {
    const s=team(); s.agents[0].observation=undefined;
    const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'初始化',instructions:'初始化',status:'uncertain'}); s.tasks=[t];
    ingestObservation(s,'lead',obs('lead',{messages:[ack(t.deliveryToken),{id:'done',role:'assistant',text:fence({version: 2,projectId:project.id,actions:[{kind:'dispatch',target:'member',title:'历史',instructions:'历史'}]})}]}));
    expect(t.status).toBe('accepted'); expect(s.tasks).toHaveLength(1);
  });
  it('下一条用户消息的回复不能替代原任务缺失的最终回复', () => {
    const s=team(); const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'路由',instructions:'同步',status:'running',deliveredAt:123}); s.tasks=[t];
    ingestObservation(s,'lead',obs('lead',{messages:[ack(t.deliveryToken),{id:'other-user',role:'user',text:'另一个目标'},{id:'other-final',role:'assistant',text:'已完成'}]}));
    expect(t.status).toBe('running');
  });
  it('页面空闲但没有本任务的送达回执，不能擅自完成', () => {
    const s=team(); const t=makeTask({kind:'report',senderId:'member',targetId:'lead',title:'回报',instructions:'内容',status:'running',deliveredAt:123}); s.tasks=[t];
    ingestObservation(s,'lead',obs('lead',{messages:[{id:'done',role:'assistant',text:'已完成'}]})); expect(t.status).toBe('running');
  });
  it('原轮次完成时可结算，下一轮仍运行时角色继续显示执行中', () => {
    const s=team(); s.agents[0].initialized=false;
    const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'连接',instructions:'连接',status:'running',deliveredAt:123}); s.tasks=[t];
    ingestObservation(s,'lead',obs('lead',{running:true,messages:[{...ack(t.deliveryToken),turnId:'fallback-turn-1',turnComplete:true},{id:'done',role:'assistant',text:'协作已就绪',turnId:'fallback-turn-1',turnComplete:true},{id:'next',role:'user',text:'后续任务',turnId:'fallback-turn-2',turnComplete:false}]}));
    expect(t.status).toBe('accepted'); expect(s.agents[0].initialized).toBe(true); expect(stateFor(s.agents[0],s).state).toBe('running');
  });
  it('未完成轮次即使没有全局运行标志也保持执行中，完成后才连接', () => {
    const s=team(); s.agents[0].initialized=false;
    const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'连接',instructions:'连接',status:'running',deliveredAt:123}); s.tasks=[t];
    const messages: PageMessage[]=[{...ack(t.deliveryToken),turnId:'fallback-turn-1'},{id:'done',role:'assistant',text:'协作已就绪',turnId:'fallback-turn-1',turnComplete:false}];
    ingestObservation(s,'lead',obs('lead',{messages})); expect(t.status).toBe('running'); expect(s.agents[0].initialized).toBe(false);
    messages[1].turnComplete=true; ingestObservation(s,'lead',obs('lead',{messages})); expect(t.status).toBe('accepted'); expect(s.agents[0].initialized).toBe(true);
  });
  it('用户回执与最终回复属于不同轮次时不结算', () => {
    const s=team(); const t=makeTask({kind:'bootstrap',senderId:'lead',targetId:'lead',title:'连接',instructions:'连接',status:'running',deliveredAt:123}); s.tasks=[t];
    ingestObservation(s,'lead',obs('lead',{messages:[{...ack(t.deliveryToken),turnId:'fallback-turn-1'},{id:'done',role:'assistant',text:'协作已就绪',turnId:'fallback-turn-2',turnComplete:true}]})); expect(t.status).toBe('running');
  });
  it('未完成回复中的派发指令等轮次完成后才处理', () => {
    const s=team(); s.agents[0].observation=undefined;
    const reply: PageMessage={id:'done',role:'assistant',text:fence({version: 2,projectId:project.id,actions:[{kind:'dispatch',target:'member',title:'检查',instructions:'检查'}]}),turnComplete:false};
    ingestObservation(s,'lead',obs('lead',{messages:[reply]}));
    ingestObservation(s,'lead',obs('lead',{messages:[reply]})); expect(s.tasks).toHaveLength(0); expect(s.processed).not.toContain('lead:done');
    reply.turnComplete=true; ingestObservation(s,'lead',obs('lead',{messages:[reply]})); expect(s.tasks).toHaveLength(1);
    ingestObservation(s,'lead',obs('lead',{messages:[reply]})); expect(s.tasks).toHaveLength(1);
  });
  it('回执后加载时恢复本任务的成员成果，只回传一次', () => {
    const s=team(); const t=makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'检查',instructions:'检查',status:'uncertain'}); s.tasks=[t];
    const reply: PageMessage={id:'done',role:'assistant',text:fence({version: 2,projectId:project.id,taskId: t.id, attempt: 1, status:'completed',summary:'检查通过'})}; s.processed=['member:done'];
    const page=obs('member',{messages:[ack(t.deliveryToken),reply]});
    ingestObservation(s,'member',page); expect(t.status).toBe('reported'); expect(t.result).toBe('检查通过'); expect(s.tasks.filter(t=>t.kind==='report')).toHaveLength(1);
    ingestObservation(s,'member',page); expect(s.tasks.filter(t=>t.kind==='report')).toHaveLength(1); expect(stateFor(s.agents[1],s).state).toBe('idle');
  });
  it('普通任务没有对应成果回报时转为需要交互', () => {
    const s=team(); const t=makeTask({kind:'dispatch',senderId:'lead',targetId:'member',title:'检查',instructions:'检查',status:'running',deliveredAt:123}); s.tasks=[t]; s.processed=['member:done'];
    ingestObservation(s,'member',obs('member',{messages:[ack(t.deliveryToken),{id:'done',role:'assistant',text:'稍后处理'}]}));
    expect(t.status).toBe('waiting'); expect(stateFor(s.agents[1],s).state).toBe('needs_interaction'); expect(s.tasks).toHaveLength(1);
  });
});
