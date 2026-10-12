import { describe, expect, it } from 'vitest';
import { applyCommand, ingestObservation, makeTask } from '../src/core/engine';
import { dependencyContext, dependencyState, freezeInputs } from '../src/core/dependencies';
import { bootstrapPrompt, parseEnvelope, taskPrompt } from '../src/core/protocol';
import { eligibleTasks, stateFor } from '../src/core/state';
import type { Store, Task } from '../src/core/types';
import { team, obs, project, fence, agent } from './helpers';

let serial=0;
const input = (fromTask='analysis') => ({name:'竞争力分析报告',fromTask,field:'summary',required:true});
const analysis = () => ({kind:'dispatch',taskKey:'analysis',target:'member',title:'竞争力分析',instructions:'对比竞品优劣势',acceptance:'提供证据'});
const marketing = () => ({kind:'dispatch',taskKey:'marketing',target:'other',title:'宣传策略',dependsOn:['analysis'],inputs:[input()],instructions:'基于分析成果制定宣传策略'});
function propose(s:Store,actions:unknown[],replyId=`proposal-${++serial}`) {
  ingestObservation(s,'lead',obs('lead',{messages:[{id:replyId,role:'assistant',text:fence({version:2,projectId:project.id,actions})}]}));
}
function plan() {const s=team();s.agents[1].name='竞争分析';s.agents[2].name='营销';propose(s,[marketing(),analysis()]);applyCommand(s,{type:'approve',ids:s.tasks.map(t=>t.id)});return s;}
function finish(s:Store,t:Task,summary='完整分析：\n产品优势有证据，竞品功能更广。\n证据：https://example.com/research',status:'completed'|'needs_interaction'='completed') {
  const guidance=s.tasks.find(g=>g.relatedTaskId===t.id && g.attempt===t.attempt && g.status==='queued');
  const delivery=guidance || t;delivery.status='running';delivery.deliveredAt=Date.now();
  if(!guidance){t.status='running';t.deliveredAt=Date.now();}
  ingestObservation(s,t.targetId,obs(t.targetId,{messages:[{id:`user-${++serial}`,role:'user',text:`[WT-DELIVERY:${delivery.deliveryToken}]`},{id:`result-${++serial}`,role:'assistant',text:fence({version:2,projectId:project.id,taskId:t.id,attempt:t.attempt,status,summary,request:status==='needs_interaction'?'需要主管确认数据':undefined})}]}));
}
function review(s:Store,t:Task,actions?:unknown[]) {
  const report=s.tasks.find(r=>r.id===t.resultReportId)!;report.status='running';report.deliveredAt=Date.now();
  ingestObservation(s,'lead',obs('lead',{messages:[{id:`report-user-${++serial}`,role:'user',text:`[WT-DELIVERY:${report.deliveryToken}]`},{id:`review-${++serial}`,role:'assistant',text:actions?fence({version:2,projectId:project.id,actions}):'已收到分析，继续审查。'}]}));
}
function accept(s:Store,t:Task) {review(s,t,[{kind:'accept',taskId:t.id,attempt:t.attempt}]);}

describe('version 2 dependent department workflow',()=>{
  it('approves a whole plan but starts analysis first regardless of action order',()=>{
    const s=plan();const upstream=s.tasks.find(t=>t.taskKey==='analysis')!,downstream=s.tasks.find(t=>t.taskKey==='marketing')!;
    expect(downstream.dependsOn).toEqual([upstream.id]);expect(downstream.inputs[0].fromTask).toBe(upstream.id);
    expect(eligibleTasks(s)).toEqual([upstream]);expect(stateFor(s.agents[2],s)).toMatchObject({state:'idle',reason:'等待前置任务完成：竞争力分析'});
    expect(()=>taskPrompt(downstream,s)).toThrow('前置任务');
  });
  it('delivers to the supervisor, waits for acceptance, then passes the complete result to marketing',()=>{
    const s=plan();const a=s.tasks.find(t=>t.taskKey==='analysis')!,m=s.tasks[0];finish(s,a);
    expect(a.status).toBe('reported');expect(eligibleTasks(s).some(t=>t.id===m.id)).toBe(false);
    expect(dependencyState(m,s).reason).toContain('回传主管');
    const report=s.tasks.find(t=>t.id===a.resultReportId)!;expect(report.instructions).toContain(a.id);expect(report.instructions).toContain('attempt 1');expect(report.instructions).toContain('不要重复派发');
    review(s,a);expect(dependencyState(m,s).reason).toContain('验收');
    propose(s,[{kind:'accept',taskId:a.id,attempt:1}]);expect(eligibleTasks(s)).toEqual([m]);
    freezeInputs(m,s);const prompt=taskPrompt(m,s);expect(prompt).toContain(a.result!);expect(prompt).toContain(s.agents[1].url);expect(prompt).toContain('提供者：竞争分析');
    expect(m.resolvedInputs?.[0]).toMatchObject({fromTask:a.id,attempt:1,summary:a.result});expect(s.tasks.filter(t=>t.taskKey==='marketing')).toHaveLength(1);
  });
  it('manual acceptance cannot bypass report delivery',()=>{
    const s=plan();const a=s.tasks[1],m=s.tasks[0];finish(s,a);applyCommand(s,{type:'accept',id:a.id,attempt:1});
    expect(dependencyState(m,s).reason).toContain('回传');expect(eligibleTasks(s).some(t=>t.id===m.id)).toBe(false);
    review(s,a);expect(eligibleTasks(s)).toEqual([m]);
  });
  it('waits for all prerequisite results and leaves independent work parallel',()=>{
    const s=team();s.agents.push(agent('third'));propose(s,[analysis(),{...analysis(),taskKey:'research',target:'other',title:'市场调研'},{...marketing(),target:'third',dependsOn:['analysis','research'],inputs:[input(),{...input('research'),name:'市场报告'}]}]);
    applyCommand(s,{type:'approve',ids:s.tasks.map(t=>t.id)});expect(eligibleTasks(s).map(t=>t.taskKey)).toEqual(['analysis','research']);
    const [a,r,m]=s.tasks;finish(s,a);accept(s,a);expect(eligibleTasks(s).map(t=>t.id)).toEqual([r.id]);finish(s,r);accept(s,r);expect(eligibleTasks(s)).toEqual([m]);
    expect(dependencyContext(m,s)).toContain(a.result!);expect(dependencyContext(m,s)).toContain(r.result!);
  });
  it('shares one coalesced report receipt across several prerequisite results',()=>{
    const s=team();s.agents.push(agent('third'));propose(s,[analysis(),{...analysis(),taskKey:'research',target:'other'},{...marketing(),target:'third',dependsOn:['analysis','research'],inputs:[input(),{...input('research'),name:'市场报告'}]}]);applyCommand(s,{type:'approve',ids:s.tasks.map(t=>t.id)});
    const [a,r,m]=s.tasks;finish(s,a);finish(s,r);expect(a.resultReportId).toBe(r.resultReportId);
    review(s,a,[{kind:'accept',taskId:a.id,attempt:1},{kind:'accept',taskId:r.id,attempt:1}]);expect(eligibleTasks(s)).toEqual([m]);
  });
  it('freezes result inputs for retries and preserves them across restart',()=>{
    const s=plan();const a=s.tasks[1],m=s.tasks[0];finish(s,a);accept(s,a);freezeInputs(m,s);const original=taskPrompt(m,s);
    a.resultHistory.at(-1)!.summary='被改变的缓存';m.status='waiting';m.reason='按钮未就绪';applyCommand(s,{type:'resume_task',id:m.id});
    expect(taskPrompt(m,s)).toBe(original);const restored=structuredClone(s);expect(taskPrompt(restored.tasks[0],restored)).toBe(original);
    expect(restored.tasks[0].deliveryToken).toBe(m.deliveryToken);expect(eligibleTasks(restored)[0].id).toBe(m.id);
  });
  it('requires a new result and acceptance after revision and ignores old results',()=>{
    const s=plan();const a=s.tasks[1],m=s.tasks[0];finish(s,a,'第一版分析');review(s,a,[{kind:'resume',taskId:a.id,attempt:1,instructions:'补充竞品证据'}]);
    const guidance=s.tasks.find(t=>t.relatedTaskId===a.id)!;expect(a.attempt).toBe(2);expect(a.status).toBe('waiting');expect(a.resultHistory[0].summary).toBe('第一版分析');expect(guidance.instructions).toContain('[WT-ATTEMPT:2]');
    expect(dependencyState(m,s).ready).toBe(false);applyCommand(s,{type:'approve',ids:[guidance.id]});
    ingestObservation(s,'member',obs('member',{messages:[{id:'late-old',role:'assistant',text:fence({version:2,projectId:project.id,taskId:a.id,attempt:1,status:'completed',summary:'迟到的旧成果'})}]}));expect(a.result).toBeUndefined();
    finish(s,a,'第二版含证据分析');expect(a.status).toBe('reported');expect(guidance.status).toBe('accepted');expect(a.resultHistory.map(r=>r.attempt)).toEqual([1,2]);
    review(s,a);propose(s,[{kind:'accept',taskId:a.id,attempt:1}]);expect(a.status).toBe('reported');expect(eligibleTasks(s).some(t=>t.id===m.id)).toBe(false);
    propose(s,[{kind:'accept',taskId:a.id,attempt:2}]);expect(eligibleTasks(s)).toEqual([m]);expect(taskPrompt(m,s)).toContain('第二版含证据分析');expect(taskPrompt(m,s)).not.toContain('第一版分析');
  });
  it('cannot accept an obsolete result through the sidebar',()=>{
    const s=plan();const a=s.tasks[1];finish(s,a);review(s,a,[{kind:'resume',taskId:a.id,attempt:1,instructions:'补充'}]);const g=s.tasks.find(t=>t.relatedTaskId===a.id)!;applyCommand(s,{type:'approve',ids:[g.id]});finish(s,a);
    expect(()=>applyCommand(s,{type:'accept',id:a.id,attempt:1})).toThrow('轮次');expect(a.status).toBe('reported');
  });
  it('needs-interaction results cannot unblock marketing',()=>{
    const s=plan();const a=s.tasks[1];finish(s,a,'数据不完整','needs_interaction');review(s,a);expect(a.status).toBe('waiting');expect(stateFor(s.agents[2],s).state).toBe('needs_interaction');
    expect(()=>applyCommand(s,{type:'accept',id:a.id,attempt:1})).toThrow();expect(eligibleTasks(s)).toEqual([]);
  });
  it('cancellation blocks downstream work and preserves unrelated work',()=>{
    const s=plan();applyCommand(s,{type:'cancel',id:s.tasks[1].id});expect(dependencyState(s.tasks[0],s)).toMatchObject({ready:false,needsInteraction:true});expect(stateFor(s.agents[2],s).state).toBe('needs_interaction');
    propose(s,[{...analysis(),taskKey:'independent'}]);applyCommand(s,{type:'approve',ids:[s.tasks.at(-1)!.id]});expect(eligibleTasks(s).map(t=>t.taskKey)).toEqual(['independent']);
  });
  it('pause blocks unlocked work and dependency release does not spend an automatic round',()=>{
    const s=team();s.settings.mode='auto';propose(s,[analysis(),marketing()]);const [a,m]=s.tasks;finish(s,a);accept(s,a);expect(s.autoRounds).toBe(1);s.paused=true;expect(eligibleTasks(s)).toEqual([]);s.paused=false;expect(eligibleTasks(s)).toEqual([m]);expect(s.autoRounds).toBe(1);
  });
  it('duplicate observations do not duplicate reports or task-chain nodes',()=>{
    const s=plan();const a=s.tasks[1];finish(s,a);const before=structuredClone(s.tasks);ingestObservation(s,'member',s.agents[1].observation!);expect(s.tasks).toEqual(before);expect(s.tasks.filter(t=>t.kind==='report')).toHaveLength(1);
  });
  it('maps draft edits and rejects a cycle without changing the task',()=>{
    const s=team();propose(s,[analysis(),marketing()]);const [a,m]=s.tasks;const original=structuredClone(a);
    expect(()=>applyCommand(s,{type:'edit',id:a.id,title:a.title,instructions:a.instructions,context:'',acceptance:'',dependsOn:[m.id]})).toThrow('循环');expect(a).toEqual(original);
    applyCommand(s,{type:'edit',id:m.id,title:m.title,instructions:m.instructions,context:'',acceptance:'',dependsOn:[]});expect(m.inputs).toEqual([]);
    applyCommand(s,{type:'edit',id:m.id,title:m.title,instructions:m.instructions,context:'',acceptance:'',dependsOn:[a.id]});expect(m.inputs[0]).toMatchObject({fromTask:a.id,field:'summary',required:true});
    applyCommand(s,{type:'approve',ids:[m.id]});expect(()=>applyCommand(s,{type:'edit',id:m.id,title:m.title,instructions:m.instructions,context:'',acceptance:'',dependsOn:[]})).toThrow('尚未确认');
  });
  it('supports a later phase referencing an existing real task ID',()=>{
    const s=team();propose(s,[analysis()]);const a=s.tasks[0];applyCommand(s,{type:'approve',ids:[a.id]});finish(s,a);accept(s,a);propose(s,[{...marketing(),dependsOn:[a.id],inputs:[input(a.id)]}]);const m=s.tasks.find(t=>t.taskKey==='marketing')!;applyCommand(s,{type:'approve',ids:[m.id]});expect(eligibleTasks(s)).toEqual([m]);
  });
  it('the supervisor receives version 2 guidance using real project and department routes',()=>{
    const s=plan();const prompt=bootstrapPrompt(s.agents[0],s);expect(prompt).toContain('"version":2');expect(prompt).toContain('"inputs"');expect(prompt).toContain('"projectId":"'+project.id+'"');expect(prompt).toContain('"target":"other"');
  });
  it.each([
    ['Marketing','Analysis','other'],
    ['MARKETING','Market Research','other'],
    ['宣传推广','竞争分析','other'],
    ['Marketing','Product team','other'],
    ['Product team','Analysis','other'],
    ['Analysis','Marketing','member'],
    ['Development','Operations','member']
  ])('routes the dependency example by role rather than member order: %s, %s',(first,second,analysisId)=>{
    const s=team();s.agents[1].name=first;s.agents[2].name=second;
    const prompt=bootstrapPrompt(s.agents[0],s);
    const envelope=parseEnvelope(prompt,true)!;
    if(!('actions' in envelope)) throw new Error('Expected a supervisor example');
    expect(envelope.actions[0]).toMatchObject({kind:'dispatch',taskKey:'analysis',target:analysisId});
    expect(envelope.actions[1]).toMatchObject({kind:'dispatch',taskKey:'marketing',target:analysisId==='other'?'member':'other',dependsOn:['analysis']});
    propose(s,envelope.actions);applyCommand(s,{type:'approve',ids:s.tasks.map(t=>t.id)});
    expect(eligibleTasks(s).map(t=>t.targetId)).toEqual([analysisId]);
  });
  it('does not assign both example departments to the only bound member',()=>{
    const s=team();s.agents.splice(2);s.agents[1].name='Marketing';
    const envelope=parseEnvelope(bootstrapPrompt(s.agents[0],s),true)!;
    if(!('actions' in envelope)) throw new Error('Expected a supervisor example');
    expect(envelope.actions[0]).toMatchObject({target:'竞争分析成员标识'});
    expect(envelope.actions[1]).toMatchObject({target:'member'});
  });
});

describe('atomic validation and missing-input protection',()=>{
  it.each([
    [analysis(),{...marketing(),taskKey:'analysis'}],
    [{...analysis(),dependsOn:['analysis'],inputs:[input()]}],
    [{...analysis(),dependsOn:['marketing'],inputs:[input('marketing')]},marketing()],
    [analysis(),{...marketing(),dependsOn:['unknown'],inputs:[input('unknown')]}],
    [analysis(),{...marketing(),inputs:[]}],
    [analysis(),{...marketing(),inputs:[input('unknown')]}],
    [analysis(),{...marketing(),inputs:[input(),input()]}]
  ].map(actions=>({actions})))('rejects the entire malformed task chain %#',({actions})=>{
    const s=team();s.settings.mode='auto';propose(s,actions);expect(s.tasks).toEqual([]);expect(s.autoRounds).toBe(0);expect(s.agents[0].observation?.interaction).toBeTruthy();
  });
  it('rejects cross-project prerequisites',()=>{
    const s=team();const other=makeTask({projectId:'g-p-other',kind:'dispatch',senderId:'lead',targetId:'member',title:'其他项目任务',instructions:'检查'});s.tasks.push(other);
    propose(s,[{...marketing(),dependsOn:[other.id],inputs:[input(other.id)]}]);expect(s.tasks).toHaveLength(1);expect(s.agents[0].observation?.interaction).toContain('跨项目');
  });
  it('a bad new task does not partially commit acceptance of an existing result',()=>{
    const s=plan();const a=s.tasks[1];finish(s,a);review(s,a);const before=structuredClone(s.tasks);
    propose(s,[{kind:'accept',taskId:a.id,attempt:1},{...marketing(),dependsOn:['missing'],inputs:[input('missing')]}]);expect(s.tasks).toEqual(before);expect(a.status).toBe('reported');
  });
  it('missing result content prevents downstream execution and shows yellow',()=>{
    const s=plan();const a=s.tasks[1],m=s.tasks[0];finish(s,a);accept(s,a);a.resultHistory.at(-1)!.summary='';expect(dependencyState(m,s)).toMatchObject({ready:false,needsInteraction:true});expect(stateFor(s.agents[2],s).state).toBe('needs_interaction');
  });
  it('shows a failed second prerequisite even while the first prerequisite is unfinished',()=>{
    const s=team();s.agents.push(agent('third'));propose(s,[analysis(),{...analysis(),taskKey:'research',target:'other'},{...marketing(),target:'third',dependsOn:['analysis','research'],inputs:[input(),{...input('research'),name:'市场报告'}]}]);applyCommand(s,{type:'approve',ids:s.tasks.map(t=>t.id)});
    applyCommand(s,{type:'cancel',id:s.tasks[1].id});expect(dependencyState(s.tasks[2],s)).toMatchObject({ready:false,needsInteraction:true});expect(dependencyState(s.tasks[2],s).reason).toContain('已取消');
  });
  it('blocks missing or corrupt frozen inputs rather than sending an incomplete payload',()=>{
    const s=plan();const a=s.tasks[1],m=s.tasks[0];finish(s,a);accept(s,a);freezeInputs(m,s);
    const valid=structuredClone(m.resolvedInputs!);
    for (const invalid of [[],[{...valid[0],summary:''}],[{...valid[0],fromTask:'wrong'}]]) {
      m.resolvedInputs=invalid;expect(dependencyState(m,s)).toMatchObject({ready:false,needsInteraction:true});expect(()=>taskPrompt(m)).toThrow('快照');expect(eligibleTasks(s)).toEqual([]);
    }
  });
  it('keeps a normally waiting department green without opening or connecting its page',()=>{
    const s=plan();s.agents[2].observation=undefined;expect(stateFor(s.agents[2],s)).toMatchObject({state:'idle',reason:'等待前置任务完成：竞争力分析'});
    applyCommand(s,{type:'cancel',id:s.tasks[1].id});expect(stateFor(s.agents[2],s).state).toBe('needs_interaction');
  });
  it('rejects version 1, missing attempts, optional inputs, and unsupported input fields',()=>{
    expect(()=>parseEnvelope(fence({version:1,projectId:project.id,actions:[analysis()]}),true)).toThrow('version 2');
    expect(()=>parseEnvelope(fence({version:2,projectId:project.id,taskId:'task',status:'completed',summary:'结果'}),false)).toThrow();
    for(const invalid of [{...input(),required:false},{...input(),field:'artifacts'}]) expect(()=>parseEnvelope(fence({version:2,projectId:project.id,actions:[{...marketing(),inputs:[invalid]}]}),true)).toThrow();
  });
});
