import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapPrompt, parseEnvelope, taskPrompt } from '../src/core/protocol';
import { applyCommand, ingestObservation, makeTask } from '../src/core/engine';
import { dependencyState, freezeInputs } from '../src/core/dependencies';
import { readPage } from '../src/extension/adapter';
import { fence, obs, project, team } from './helpers';

const reference = ':chatgpt-content-reference{index="2"}';
const summary = `完整成果与证据，报告入口为 ${reference}[report.md](sandbox:/workspace/report.md)。`;
const member = (text = summary) => ({version:2,projectId:project.id,taskId:'analysis',attempt:1,status:'completed',summary:text});
// Reproduces the exact unescaped native file-reference attribute seen in Chrome.
const nativeFence = (data: unknown) => fence(data).replace(/:chatgpt-content-reference\{index=\\"(\d+)\\"\}/g, ':chatgpt-content-reference{index="$1"}');
const formatError = '协作指令格式不完整，请整理 JSON 后重发';

describe('原生文件引用与严格 JSON', () => {
  it('保留现场引用和完整成果，仅补齐属性引号的 JSON 转义', () => {
    expect(() => JSON.parse(nativeFence(member()).split('\n')[1])).toThrow();
    expect(parseEnvelope(nativeFence(member()),false)).toEqual(member());
  });
  it.each([0,2,12])('支持引用序号 %i 和多份文件', index => {
    const text = `${summary}\n:chatgpt-content-reference{index="${index}"}[evidence.md](sandbox:/evidence.md)`;
    expect(parseEnvelope(nativeFence(member(text)),false)).toEqual(member(text));
  });
  it('有效 JSON 的反斜线、嵌套代码及引用原样保留', () => {
    const text = `${summary}\n引号 "x"，路径 C:\\temp\\report\n\`\`\`js\nconsole.log("ok")\n\`\`\``;
    expect(parseEnvelope(fence(member(text)),false)).toEqual(member(text));
  });
  it('主管任务正文引用同样保留，依赖字段不变', () => {
    const data = {version:2,projectId:project.id,actions:[{kind:'dispatch',taskKey:'analysis',target:'member',title:'分析',instructions:summary,context:'',acceptance:'',dependsOn:[],inputs:[]}]};
    expect(parseEnvelope(nativeFence(data),true)).toEqual(data);
  });
  it.each([
    '{"version":2,"summary":"普通的未转义 "引号""}',
    '{"version":2,}',
    '{"version":2,// comment\n"actions":[]}',
    '{"version":2,"summary":"未转义\n换行"}',
    '{"version":2,"summary":' + reference + '}',
    '{"version":2,"summary":"' + reference + '","attempt":1,}',
  ])('引用修复不放宽其他 JSON 语法：%s', json => {
    expect(() => parseEnvelope(`\`\`\`work-team\n${json}\n\`\`\``,false)).toThrow(formatError);
  });
  it('补齐引用转义后仍拒绝未知字段及错误协议', () => {
    expect(() => parseEnvelope(nativeFence({...member(),actions:[]}),false)).toThrow('version 2');
    expect(() => parseEnvelope(nativeFence({...member(),version:1}),false)).toThrow('version 2');
  });
  it('引用只是资料，不能额外产生指令块', () => {
    expect(() => parseEnvelope(`${nativeFence(member())}\n${nativeFence(member())}`,false)).toThrow('只能有一个');
    expect(parseEnvelope(`普通资料 ${reference} ${JSON.stringify(member())}`,false)).toBeUndefined();
  });
  it('初始化及每次发送都提醒标准 JSON 和纯文本文件路径', () => {
    const s=team();
    expect(bootstrapPrompt(s.agents[1],s)).toContain('JSON 字符串');
    for (const kind of ['dispatch','report','bootstrap'] as const) {
      const task=makeTask({kind,senderId:'lead',targetId:'member',title:'测试',instructions:'执行'});
      expect(taskPrompt(task,s)).toContain('chatgpt-content-reference');
    }
  });
});

describe('已有解析失败回报恢复', () => {
  function recovery(status: 'waiting'|'cancelled'='waiting') {
    const s=team();
    const analysis=makeTask({id:'analysis',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'member',title:'分析',instructions:'执行',status,deliveredAt:1,reason:formatError});
    const marketing=makeTask({id:'marketing',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'other',title:'营销',instructions:'宣传',status:'queued',approved:true,dependsOn:[analysis.id],inputs:[{name:'完整报告',fromTask:analysis.id,field:'summary',required:true}]});
    s.tasks.push(analysis,marketing); s.processed.push('member:failed-result');
    const page=obs('member',{turnIndex:1,messages:[{id:'receipt',role:'user',text:`[WT-DELIVERY:${analysis.deliveryToken}]`,turnId:'fallback-turn-1',turnComplete:true},{id:'failed-result',role:'assistant',text:nativeFence(member()),turnId:'fallback-turn-1',turnComplete:true}]});
    return {s,analysis,marketing,page};
  }
  it('重新观察已处理的失败回复可恢复并回传，验收前下游继续等待', () => {
    const {s,analysis,marketing,page}=recovery(); s.paused=true;
    ingestObservation(s,'member',page);
    expect(analysis.status).toBe('reported'); expect(analysis.result).toBe(summary);
    expect(analysis.resultHistory).toHaveLength(1); expect(s.tasks).toHaveLength(3);
    expect(dependencyState(marketing,s).ready).toBe(false); expect(s.paused).toBe(true);
    ingestObservation(s,'member',page); expect(s.tasks).toHaveLength(3); expect(analysis.resultHistory).toHaveLength(1);
    applyCommand(s,{type:'accept',id:analysis.id,attempt:1});
    expect(dependencyState(marketing,s).ready).toBe(false);
    s.tasks[2].deliveredAt=2;
    expect(dependencyState(marketing,s).ready).toBe(true);
    freezeInputs(marketing,s); expect(marketing.resolvedInputs?.[0].summary).toBe(summary);
    expect(taskPrompt(marketing,s)).toContain(summary);
  });
  it('重启首次观察也能恢复已知投递的失败回报', () => {
    const {s,analysis,page}=recovery(); s.agents[1].observation=undefined;
    ingestObservation(s,'member',page); expect(analysis.status).toBe('reported'); expect(s.tasks).toHaveLength(3);
  });
  it.each(['cancelled','old_attempt','other_task','missing_receipt','different_turn','streaming','later_user','business_wait'] as const)('不借用无效或其他轮次的回复：%s', scenario => {
    const {s,analysis,page}=recovery(scenario==='cancelled'?'cancelled':'waiting');
    if(scenario==='old_attempt') analysis.attempt=2;
    if(scenario==='other_task') page.messages[1].text=nativeFence({...member(),taskId:'other-task'});
    if(scenario==='missing_receipt') page.messages.shift();
    if(scenario==='different_turn') page.messages[1].turnId='fallback-turn-2';
    if(scenario==='streaming') page.messages[1].turnComplete=false;
    if(scenario==='later_user') page.messages.splice(1,0,{id:'later-user',role:'user',text:'另一需求'});
    if(scenario==='business_wait') analysis.reason='需要主管补充市场范围';
    ingestObservation(s,'member',page); expect(s.tasks).toHaveLength(2); expect(analysis.resultHistory).toHaveLength(0);
  });
  it('主管已去重的历史派发不能借恢复机制重放', () => {
    const {s,page}=recovery(); const leadPage=obs('lead',{messages:[{id:'old-plan',role:'assistant',text:nativeFence({version:2,projectId:project.id,actions:[{kind:'dispatch',target:'other',title:'旧任务',instructions:summary}]})}]});
    s.processed.push('lead:old-plan'); ingestObservation(s,'lead',leadPage); ingestObservation(s,'member',page);
    expect(s.tasks.filter(t=>t.kind==='dispatch')).toHaveLength(2);
  });
  it('业务交互请求恰好使用解析错误文案时，不重复回传已登记的成果', () => {
    const {s,analysis,page}=recovery();
    analysis.result=summary;
    analysis.resultHistory.push({attempt:1,status:'needs_interaction',summary,request:formatError,reportId:'existing-report',sourceName:'member',sourceUrl:obs('member').url,at:1});
    page.messages[1].text=nativeFence({...member(),status:'needs_interaction',request:formatError});
    ingestObservation(s,'member',page); ingestObservation(s,'member',page);
    expect(s.tasks).toHaveLength(2); expect(analysis.resultHistory).toHaveLength(1); expect(analysis.status).toBe('waiting');
  });
});

describe('Work DOM 引用复现', () => {
  beforeEach(() => {vi.spyOn(Element.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);});
  it('真实无 pre 代码组件中读取引用，解析后保留报告入口', () => {
    document.body.innerHTML='<div data-talvt-turn-state="complete"><div data-local-conversation-final-assistant="true"><div data-chatgpt-search-unit-key="fallback-turn-1:1:assistant"><div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div>work-team</div><button>复制</button></div><code></code></div></div></div></div>';
    document.querySelector('code')!.textContent=nativeFence(member()).split('\n')[1];
    const page=readPage(document,obs('member').url);
    expect(page.messages).toHaveLength(1); expect(parseEnvelope(page.messages[0].text,false)).toEqual(member());
  });
});
