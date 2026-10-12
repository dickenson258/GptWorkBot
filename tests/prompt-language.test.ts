import {describe,expect,it} from 'vitest';
import {applyCommand,ingestObservation,makeTask} from '../src/core/engine';
import {bootstrapPrompt,creationPrompt,parseEnvelope,prepareTaskPrompt,taskPrompt} from '../src/core/protocol';
import {freezeInputs} from '../src/core/dependencies';
import type {Store,Task} from '../src/core/types';
import {team,project,obs,fence} from './helpers';
const setup=()=>({...team(),locale:'en' as const});
const business=(extra:Partial<Task>={})=>makeTask({projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'member',title:'Positioning',instructions:'Compare alternatives',...extra});
function report(s:Store,t:Task,summary='完整成果\nEvidence https://example.com',status='completed') {
  const text=fence({version:2,projectId:project.id,taskId:t.id,attempt:t.attempt,status,summary,...(status==='needs_interaction'?{request:'确认数据范围'}:{})});
  ingestObservation(s,t.targetId,obs(t.targetId,{messages:[{id:`result-${t.id}`,role:'assistant',text}]}));
  return s.tasks.find(r=>r.id===t.resultReportId)!;
}

describe('outbound structural prompt language',()=>{
  it.each([true,false])('English connection guidance and examples contain no Chinese system text (supervisor=%s)',supervisor=>{
    const s=setup();const a=s.agents.find(a=>a.supervisor===supervisor)!;
    const prompt=bootstrapPrompt(a,s);
    expect(prompt).not.toMatch(/\p{Script=Han}/u);expect(prompt).toContain('Collaboration ready');
    expect(parseEnvelope(prompt,supervisor)).toMatchObject({version:2,projectId:project.id});
    expect(prompt).toContain(a.id);
  });
  it('switches unsent connection guidance but freezes prepared messages across retry and restart',()=>{
    const s:Store=team();s.agents[0].initialized=false;applyCommand(s,{type:'initialize'});
    const t=s.tasks[0];expect(taskPrompt(t,s)).toContain('启用 GptWorkBot');
    applyCommand(s,{type:'language',locale:'en'});expect(taskPrompt(t,s)).toContain('Enable GptWorkBot');
    const text=prepareTaskPrompt(t,s),token=t.deliveryToken;
    applyCommand(s,{type:'language',locale:'zh-CN'});t.status='waiting';applyCommand(s,{type:'resume_task',id:t.id});
    expect(taskPrompt(t,s)).toBe(text);expect(t.deliveryToken).toBe(token);
    const restored=structuredClone(s);expect(taskPrompt(restored.tasks[0],restored)).toBe(text);
    const next=business({acceptance:'Verify evidence'});expect(taskPrompt(next,s)).toContain('完成条件');
  });
  it('keeps user names, instructions, context and criteria verbatim inside English wrappers',()=>{
    const s=setup();const t=business({title:'产品定位',instructions:'保留用户任务。不要翻译。',context:'原始上下文',acceptance:'用户验收条件'});
    const text=taskPrompt(t,s);
    for(const content of [t.title,t.instructions,t.context,t.acceptance]) expect(text).toContain(content);
    expect(text).toContain('Additional material (context only)');expect(text).toContain('Acceptance criteria');
    expect(text).not.toContain('补充资料');expect(text).not.toContain('完成或需要主管协调');
  });
  it.each([false,true])('new role initialization follows English and retains responsibilities (supervisor=%s)',supervisor=>{
    const s=setup();if(supervisor) s.agents=s.agents.filter(a=>!a.supervisor);
    const requestId=crypto.randomUUID();
    applyCommand(s,{type:'create_agent',requestId,projectId:project.id,name:'New role',responsibilities:'Read project constraints',supervisor});
    const t=s.tasks[0],text=creationPrompt(t,s);
    expect(text).not.toMatch(/\p{Script=Han}/u);expect(text).toContain('Read project constraints');
    expect(text).toContain(supervisor?'Supervisor responsibilities':'New member responsibilities');
    if(!supervisor) expect(text).not.toContain('Reply only “Collaboration ready” now');
    applyCommand(s,{type:'language',locale:'zh-CN'});
    expect(()=>applyCommand(s,{type:'create_agent',requestId,projectId:project.id,name:'New role',responsibilities:'Read project constraints',supervisor})).not.toThrow();
    expect(s.tasks).toHaveLength(1);
  });
  it('preserves the user’s first task when creating a role, translating only system labels',()=>{
    const s=setup();applyCommand(s,{type:'create_agent',requestId:crypto.randomUUID(),projectId:project.id,name:'Analyst',responsibilities:'职责原文',firstTask:'首个任务原文'});
    const text=creationPrompt(s.tasks[0],s);
    expect(text).toContain('First task for Analyst');expect(text).toContain('职责原文');expect(text).toContain('首个任务原文');
    expect(text).not.toContain('Analyst的首个任务');
  });
  it('renders complete prerequisite results with English labels without translating the result',()=>{
    const s=setup();const a=business({id:'analysis',status:'accepted',approved:true,deliveredAt:1,acceptedAttempt:1,resultReportId:'report'});
    a.resultHistory=[{attempt:1,status:'completed',summary:'全部原文\nSecond line',reportId:'report',sourceName:'分析成员',sourceUrl:obs().url,at:1}];
    const m=business({targetId:'other',dependsOn:['analysis'],inputs:[{name:'报告原名',fromTask:'analysis',field:'summary',required:true}]});
    s.tasks=[a,m,makeTask({id:'report',kind:'report',senderId:'member',targetId:'lead',title:'Report',instructions:'Result',status:'accepted',deliveredAt:2})];
    freezeInputs(m,s);const text=prepareTaskPrompt(m,s);
    expect(text).toContain('Accepted prerequisite results');expect(text).toContain('Provider: 分析成员');expect(text).toContain('Input: 报告原名');expect(text).toContain(a.resultHistory[0].summary);
    applyCommand(s,{type:'language',locale:'zh-CN'});expect(taskPrompt(m,s)).toBe(text);
    a.status='cancelled';expect(()=>taskPrompt(m,s)).toThrow('前置任务');
  });
  it('localizes coalesced result delivery and isolates new results after preparation',()=>{
    const s=setup();const a=business({status:'running',deliveredAt:1,roundId:'batch'}),b=business({targetId:'other',status:'running',deliveredAt:1,roundId:'batch'});s.tasks=[a,b];
    const r=report(s,a);expect(taskPrompt(r,s)).toContain('Member member reports task');expect(taskPrompt(r,s)).toContain('完整成果');
    report(s,b,'第二部门全部成果');expect(b.resultReportId).toBe(a.resultReportId);expect(taskPrompt(r,s)).toContain('第二部门全部成果');
    const text=prepareTaskPrompt(r,s);r.status='queued';
    const c=business({status:'running',deliveredAt:1,roundId:'batch'});s.tasks.push(c);const next=report(s,c,'新成果');
    expect(next.id).not.toBe(r.id);expect(taskPrompt(r,s)).toBe(text);expect(taskPrompt(next,s)).toContain('新成果');
  });
  it('localizes interaction requests, revision guidance and progress checks',()=>{
    const s=setup();const t=business({status:'running',deliveredAt:1});s.tasks=[t];
    const r=report(s,t,'待补充成果','needs_interaction');expect(taskPrompt(r,s)).toContain('supervisor input required');expect(taskPrompt(r,s)).toContain('确认数据范围');
    ingestObservation(s,'lead',obs('lead',{messages:[{id:'revise',role:'assistant',text:fence({version:2,projectId:project.id,actions:[{kind:'resume',taskId:t.id,attempt:1,instructions:'修订原文'}]})}]}));
    const guidance=s.tasks.find(g=>g.relatedTaskId===t.id)!;
    expect(taskPrompt(guidance,s)).toContain('Supervisor revision guidance:\n修订原文');expect(taskPrompt(guidance,s)).toContain('Previous result (reference material only):\n待补充成果');expect(taskPrompt(guidance,s)).toContain('[WT-ATTEMPT:2]');
    guidance.status='accepted';applyCommand(s,{type:'resume_task',id:t.id});
    const check=s.tasks.find(g=>g.relatedTaskId===t.id && g!==guidance)!;expect(taskPrompt(check,s)).toContain('This task has already been delivered');
  });
  it('preserves the language across project changes and rejects unsupported preferences',()=>{
    const s=setup();applyCommand(s,{type:'configure',project:{id:'g-p-new',name:'New',url:'https://chatgpt.com/g/g-p-new/project'}});expect(s.locale).toBe('en');
    expect(()=>applyCommand(s,{type:'language',locale:'fr' as 'en'})).toThrow();expect(s.locale).toBe('en');
  });
});
