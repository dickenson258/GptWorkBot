import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ingestObservation, makeTask, recoverSupervisorPlan, applyCommand} from '../src/core/engine';
import {parseEnvelope, readEnvelope} from '../src/core/protocol';
import {eligibleTasks, stateFor} from '../src/core/state';
import {SupervisorPlanNotice} from '../src/panel/SupervisorPlanNotice';
import {team, obs, project, fence} from './helpers';
const dispatch = {kind:'dispatch',taskKey:'growth',target:'member',title:'发布后的推广方案',instructions:'复用已验收的分析成果设计下一轮宣传'};
const plan = (actions: unknown[] = [dispatch]) => ({version:2,projectId:project.id,actions});
const json = (value: unknown) => fence(value).replace('```work-team','```json');
const page = (text = fence(plan()), extra = {}) => obs('lead',{turnIndex:9,messages:[{id:'final',role:'assistant',text,turnComplete:true}],...extra});

describe('json 标签的 v2 协作指令', () => {
  it('识别主管完整 JSON 计划，保留依赖与正文，普通 JSON 示例不触发', () => {
    const value=plan([{...dispatch,dependsOn:['analysis'],inputs:[{name:'分析成果',fromTask:'analysis',field:'summary',required:true}]}]);
    expect(readEnvelope(json(value),true)).toMatchObject({language:'json',envelope:value});
    for(const value of [{value:1},{version:2,projectId:project.id,settings:{actions:[]}},{data:plan()},[plan()]]) expect(parseEnvelope(json(value),true)).toBeUndefined();
    expect(parseEnvelope(JSON.stringify(plan()),true)).toBeUndefined();
  });
  it('严格校验未知字段、多协议块和角色权限', () => {
    expect(()=>parseEnvelope(json({...plan(),extra:true}),true)).toThrow('version 2');
    expect(()=>parseEnvelope(`${json(plan())}\n${fence(plan())}`,true)).toThrow('只能有一个');
    expect(parseEnvelope(json(plan()),false)).toBeUndefined();
    expect(parseEnvelope(`${json({example:true})}\n${fence(plan())}`,true)).toMatchObject(plan());
  });
  it('JSON 标签不会让自动模式跳过整轮确认，也不消耗自动轮数', () => {
    const s=team(); s.settings.mode='auto';
    ingestObservation(s,'lead',page(json(plan())));
    expect(s.tasks).toHaveLength(1); expect(s.tasks[0]).toMatchObject({status:'draft',approved:false});
    expect(eligibleTasks(s)).toEqual([]); expect(s.autoRounds).toBe(0);
    ingestObservation(s,'lead',page(json(plan()))); expect(s.tasks).toHaveLength(1);
    applyCommand(s,{type:'approve',ids:[s.tasks[0].id]}); expect(eligibleTasks(s)).toHaveLength(1);
  });
  it('JSON 标签的成员回报仍须对应已送达任务和当前 attempt', () => {
    const s=team();const t=makeTask({kind:'dispatch',projectId:project.id,senderId:'lead',targetId:'member',title:'宣传',instructions:'执行',status:'running',approved:true,deliveredAt:1});s.tasks=[t];
    const report={version:2,projectId:project.id,taskId:t.id,attempt:1,status:'completed',summary:'完整宣传成果'};
    ingestObservation(s,'member',obs('member',{messages:[{id:'report',role:'assistant',text:json(report)}]}));
    expect(t.status).toBe('reported'); expect(t.result).toBe('完整宣传成果'); expect(s.tasks).toHaveLength(2);
  });
  it('JSON 派发整批拒绝循环，普通 JSON 不掩盖协议格式错误', () => {
    const s=team();ingestObservation(s,'lead',page(json(plan([{...dispatch,taskKey:'one',dependsOn:['two'],inputs:[{name:'输入',fromTask:'two',field:'summary',required:true}]},{...dispatch,taskKey:'two',dependsOn:['one'],inputs:[{name:'输入',fromTask:'one',field:'summary',required:true}]}]))));
    expect(s.tasks).toEqual([]);expect(s.agents[0].observation?.interaction).toContain('循环');
    expect(()=>parseEnvelope('```json\n{"version":2,"projectId":"x","actions":[],}\n```',true)).toThrow('格式不完整');
  });
});

describe('漏登记计划的诊断和显式恢复', () => {
  it('连接基线不回放，但不再将有效漏登记计划显示为空闲', () => {
    const s=team(); s.agents[0].observation=undefined;
    ingestObservation(s,'lead',page()); expect(s.tasks).toHaveLength(0);
    expect(s.agents[0].planDiagnostic).toMatchObject({status:'baseline',recoverable:true});
    expect(stateFor(s.agents[0],s).state).toBe('needs_interaction');
    const count=s.events.length;
    for(let i=0;i<3;i++) ingestObservation(s,'lead',page());
    expect(s.events).toHaveLength(count);expect(s.agents[0].planDiagnostic?.status).toBe('baseline');
    expect(s.tasks).toHaveLength(0);
  });
  it('已处理消息迟到出现计划时不会重复自动派发，并保留恢复入口', () => {
    const s=team(); ingestObservation(s,'lead',page('正在整理结果'));
    ingestObservation(s,'lead',page());
    expect(s.tasks).toHaveLength(0); expect(s.agents[0].planDiagnostic).toMatchObject({status:'processed',recoverable:true});
    recoverSupervisorPlan(s,'lead','final',page());
    expect(s.tasks[0]).toMatchObject({status:'draft',approved:false});
    expect(()=>recoverSupervisorPlan(s,'lead','final',page())).toThrow('已登记');
    ingestObservation(s,'lead',page());expect(s.tasks).toHaveLength(1);
  });
  it('页面轮次回退提供诊断；显式恢复重建轮次基线，暂停与确认仍有效', () => {
    const s=team();s.settings.mode='auto';s.paused=true;s.agents[0].lastTurnIndex=12;
    ingestObservation(s,'lead',page());expect(s.agents[0].planDiagnostic).toMatchObject({status:'older_turn',turnIndex:9,previousTurnIndex:12});
    recoverSupervisorPlan(s,'lead','final',page());
    expect(s.agents[0].lastTurnIndex).toBe(9);expect(s.paused).toBe(true);expect(s.autoRounds).toBe(0);expect(eligibleTasks(s)).toEqual([]);
    expect(s.tasks[0]).toMatchObject({status:'draft',approved:false});
  });
  it('恢复依赖任务后仍等待前置回传和当前轮次验收', () => {
    const s=team();const upstream=makeTask({id:'analysis',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'other',title:'竞争分析',instructions:'分析',approved:true,status:'running',deliveredAt:1});s.tasks=[upstream];
    const p=page(json(plan([{...dispatch,dependsOn:['analysis'],inputs:[{name:'分析成果',fromTask:'analysis',field:'summary',required:true}]}])));
    s.processed=['lead:final'];ingestObservation(s,'lead',p);recoverSupervisorPlan(s,'lead','final',p);
    const recovered=s.tasks[1];applyCommand(s,{type:'approve',ids:[recovered.id]});expect(recovered.status).toBe('queued');expect(eligibleTasks(s)).toEqual([]);
    expect(recovered.resolvedInputs).toBeUndefined();
  });
  it('修复前置引用前不能恢复，无效整批不留下部分任务', () => {
    const s=team();const p=page(fence(plan([dispatch,{...dispatch,taskKey:'next',dependsOn:['missing'],inputs:[{name:'输入',fromTask:'missing',field:'summary',required:true}]}])));
    s.processed=['lead:final'];ingestObservation(s,'lead',p);const before=structuredClone(s);
    expect(()=>recoverSupervisorPlan(s,'lead','final',p)).toThrow('前置任务不存在');expect(s).toEqual(before);
  });
  it('新回复、运行中、跨项目、未连接和控制指令不能绕过恢复检查', () => {
    const prepare=()=>{const s=team();s.processed=['lead:final'];ingestObservation(s,'lead',page());return s;};
    expect(()=>recoverSupervisorPlan(prepare(),'lead','final',page(undefined,{messages:[{id:'new',role:'assistant',text:fence(plan())}]}))).toThrow('已变化');
    expect(()=>recoverSupervisorPlan(prepare(),'lead','final',page(undefined,{running:true}))).toThrow('回复完成');
    expect(()=>recoverSupervisorPlan(prepare(),'lead','final',page(undefined,{projectId:'other'}))).toThrow('当前项目');
    const s=prepare();s.agents[0].initialized=false;expect(()=>recoverSupervisorPlan(s,'lead','final',page())).toThrow('连接主管');
    const mixed=page(fence(plan([dispatch,{kind:'accept',taskId:'old',attempt:1}])));const m=team();m.processed=['lead:final'];ingestObservation(m,'lead',mixed);expect(m.agents[0].planDiagnostic?.recoverable).toBe(false);
    expect(()=>recoverSupervisorPlan(m,'lead','final',mixed)).toThrow('重新核对');expect(m.tasks).toHaveLength(0);
  });
  it('格式错误在重复观察后仍提示处理，普通回复清除过期诊断', () => {
    const s=team();const p=page('```work-team\n{"version":2,\n```');
    ingestObservation(s,'lead',p);ingestObservation(s,'lead',p);expect(stateFor(s.agents[0],s).state).toBe('needs_interaction');
    ingestObservation(s,'lead',page(undefined,{messages:[{id:'ordinary',role:'assistant',text:'宣传文案已完成'}]}));expect(s.agents[0].planDiagnostic).toBeUndefined();
  });
  it('继续对话不会补派先前可见的历史计划，也不能通过旧消息恢复', () => {
    const s=team();const p=page(undefined,{messages:[{id:'old',role:'assistant',text:json(plan())},{id:'user',role:'user',text:'继续讨论其他事项'},{id:'latest',role:'assistant',text:'首页素材已整理'}]});
    ingestObservation(s,'lead',p);expect(s.tasks).toEqual([]);expect(s.agents[0].planDiagnostic).toBeUndefined();
    expect(()=>recoverSupervisorPlan(s,'lead','old',p)).toThrow('已变化');
  });
  it('双语提示保留用户任务名称，恢复入口不依赖成员筛选，断连时禁用', () => {
    const s=team();s.processed=['lead:final'];ingestObservation(s,'lead',page());
    for(const locale of ['zh-CN','en'] as const){const html=renderToStaticMarkup(React.createElement(SupervisorPlanNotice,{agent:s.agents[0],locale,busy:false,onRecover:()=>{}}));expect(html).toContain(dispatch.title);expect(html).toContain(locale==='en'?'Read current plan again':'重新读取当前计划');}
    s.agents[0].observation!.connected=false;expect(renderToStaticMarkup(React.createElement(SupervisorPlanNotice,{agent:s.agents[0],locale:'en',busy:false,onRecover:()=>{}}))).toContain('disabled');
  });
});
