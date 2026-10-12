import {describe,expect,it} from 'vitest';
import {applyCommand,makeTask} from '../src/core/engine';
import {bootstrapPrompt,taskPrompt,prepareTaskPrompt} from '../src/core/protocol';
import type {Store} from '../src/core/types';
import {team,project} from './helpers';

function registry(s:Store) {
  const prompt=bootstrapPrompt(s.agents[0],s);
  return JSON.parse(prompt.split('[WT-TASK-REGISTRY]')[1].split('\n').find(line=>line.startsWith('{'))!);
}
const business=(extra={})=>makeTask({kind:'dispatch',projectId:project.id,senderId:'lead',targetId:'member',title:'定位分析',instructions:'完整任务正文',...extra});

describe('主管连接时的插件任务登记快照',()=>{
  it('空队列明确没有登记业务任务，连接和回传消息不充当业务计划',()=>{
    const s=team();s.tasks=[business({kind:'bootstrap'}),business({kind:'report'}),business({projectId:'different-project'})];
    expect(registry(s)).toMatchObject({projectId:project.id,total:0,active:0,omitted:0,tasks:[]});
    expect(bootstrapPrompt(s.agents[0],s)).toContain('本快照中没有已登记的成员业务任务');
    expect(bootstrapPrompt(s.agents[1],s)).not.toContain('[WT-TASK-REGISTRY]');
  });
  it('区分待确认、已批准、已送达与验收轮次，保留真实依赖标识',()=>{
    const s=team();
    const analysis=business({id:'real-analysis',taskKey:'analysis',status:'accepted',approved:true,deliveredAt:1,attempt:2,acceptedAttempt:2});
    const marketing=business({id:'real-marketing',taskKey:'marketing',targetId:'other',status:'draft',dependsOn:[analysis.id]});
    s.tasks=[analysis,marketing,business({id:'cancelled',status:'cancelled'})];
    const snapshot=registry(s);
    expect(snapshot).toMatchObject({total:3,active:1});
    expect(snapshot.tasks.find((t:{taskId:string})=>t.taskId===analysis.id)).toMatchObject({taskKey:'analysis',status:'accepted',approved:true,delivered:true,attempt:2,acceptedAttempt:2});
    expect(snapshot.tasks.find((t:{taskId:string})=>t.taskId===marketing.id)).toMatchObject({status:'draft',approved:false,delivered:false,dependsOn:[analysis.id],target:'other',targetName:s.agents[2].name});
  });
  it('限制快照长度并声明省略，且不携带成果或任务正文',()=>{
    const s=team();s.tasks=Array.from({length:45},(_,i)=>business({id:`task-${i}`,createdAt:i,result:'私有成果',context:'私有上下文'}));
    const snapshot=registry(s);expect(snapshot).toMatchObject({total:45,active:45,omitted:5});
    expect(snapshot.tasks).toHaveLength(40);expect(snapshot.tasks[0].taskId).toBe('task-44');
    const prompt=bootstrapPrompt(s.agents[0],s);
    for(const value of ['完整任务正文','私有成果','私有上下文']) expect(prompt).not.toContain(value);
    expect(prompt).toContain('未列出不代表任务不存在');
  });
  it('重试复用已保存的连接说明，不把新的队列状态替换进同一发送标识',()=>{
    const s=team();s.agents[0].initialized=false;
    applyCommand(s,{type:'initialize'});
    const bootstrap=s.tasks.find(t=>t.kind==='bootstrap')!;
    const original=prepareTaskPrompt(bootstrap,s);
    s.tasks.push(business());bootstrap.status='waiting';
    applyCommand(s,{type:'resume_task',id:bootstrap.id});
    expect(taskPrompt(bootstrap,s)).toBe(original);
    const restarted=structuredClone(s);
    expect(taskPrompt(restarted.tasks[0],restarted)).toBe(original);
    expect(registry(s).active).toBe(1);
  });
});
