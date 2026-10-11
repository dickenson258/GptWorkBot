import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand, makeTask } from '../src/core/engine';
import { emptyStore } from '../src/core/types';
import type { Store } from '../src/core/types';
import { project, obs, team } from './helpers';

const mocks = vi.hoisted(() => ({
  roots: [] as Root[], overview: vi.fn(), command: vi.fn(), discover: vi.fn(),
}));
vi.mock('../src/panel/transport', () => ({
  preview: false, overview: mocks.overview, command: mocks.command, discover: mocks.discover,
  openConversation: vi.fn(),
}));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    const root = actual.createRoot(...args); mocks.roots.push(root); return root;
  } };
});
let store: Store;
const conversations = [
  {url: obs('lead').url, name: '项目经理'},
  {url: obs('member').url, name: '软件开发'},
  {url: obs('other').url, name: '营销推广'},
];
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', undefined);
  localStorage.clear(); localStorage.setItem('gptworkbot-ui-language', 'zh-CN');
  document.body.innerHTML = '<div id="root"></div>';
  store = emptyStore();
  const snapshot = () => ({store: structuredClone(store), tabs: [{id: 1, url: obs('lead').url, title: '项目经理', active: true}]});
  mocks.overview.mockImplementation(async () => snapshot());
  mocks.command.mockImplementation(async command => { applyCommand(store, command); return snapshot(); });
  mocks.discover.mockResolvedValue({...project, projectId: project.id, projectUrl: project.url, conversations});
});
afterEach(async () => {
  await act(async () => { for (const root of mocks.roots.splice(0)) root.unmount(); });
  vi.unstubAllGlobals(); document.body.innerHTML = '';
});
async function mount() { await act(async () => { await import('../src/panel/main'); }); }
function button(name: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name);
  if (!result) throw Error(`Missing button: ${name}`);
  return result;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function selectLead() {
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>('.batch select')!;
    select.value = conversations[0].url; select.dispatchEvent(new Event('change', {bubbles: true}));
  });
}
function roleCheckbox(name: string) {
  return [...document.querySelectorAll('.batch-list label')].find(label => label.textContent === name)!.querySelector<HTMLInputElement>('input')!;
}
async function confirmWork() { await click(document.querySelector<HTMLInputElement>('.batch > label.check input')!); }
async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
}

describe('project setup through the rendered sidebar', () => {
  it('shows the batch immediately, keeps choices after first connection, and imports without reading again', async () => {
    await mount(); await click(button('读取当前项目'));
    expect(document.querySelector('.batch h2')?.textContent).toBe('批量加入已有团队');
    expect(document.querySelectorAll('.batch-list label')).toHaveLength(3);
    expect(store.project).toBeUndefined();
    await click(roleCheckbox('营销推广')); await selectLead(); await confirmWork();
    expect(button('加入 2 个会话').disabled).toBe(true);
    await click(button('连接项目'));
    expect(document.querySelector('.setup')).not.toBeNull();
    expect(document.querySelector<HTMLSelectElement>('.batch select')?.value).toBe(conversations[0].url);
    expect(roleCheckbox('营销推广').checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('.batch > label.check input')?.checked).toBe(true);
    expect(button('加入 2 个会话').disabled).toBe(false);
    expect(mocks.discover).toHaveBeenCalledOnce();
    await click(button('加入 2 个会话'));
    expect(store.agents.map(agent => [agent.name, agent.supervisor])).toEqual([['项目经理',true],['软件开发',false]]);
    expect(document.querySelector('.setup')).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toContain('已加入 2 个会话');
  });
  it('keeps a manually entered project open for binding after its first connection', async () => {
    await mount();
    const inputs = document.querySelectorAll<HTMLInputElement>('.setup > label input');
    await inputValue(inputs[0],project.name); await inputValue(inputs[1],project.url);
    await click(button('连接项目'));
    expect(store.project).toEqual(project);
    expect(document.querySelector('.setup')).not.toBeNull();
    expect(document.querySelector('.setup')?.textContent).toContain('选择已打开或项目中发现的会话');
  });
  it('preserves choices on connection failure and enables import after a successful retry', async () => {
    await mount(); await click(button('读取当前项目')); await selectLead(); await confirmWork();
    mocks.command.mockRejectedValueOnce(new Error('连接失败'));
    await click(button('连接项目'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('连接失败');
    expect(document.querySelector('.batch')).not.toBeNull();
    expect(button('加入 3 个会话').disabled).toBe(true);
    await click(button('连接项目'));
    expect(document.querySelector<HTMLSelectElement>('.batch select')?.value).toBe(conversations[0].url);
    expect(button('加入 3 个会话').disabled).toBe(false);
    expect(mocks.discover).toHaveBeenCalledOnce();
  });
  it('does not import a newly discovered project into an already connected different project', async () => {
    store.project = {id: 'g-p-other', name: '其他项目', url: 'https://chatgpt.com/g/g-p-other/project'};
    await mount();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="绑定会话"]')!);
    await click(button('读取当前项目')); await selectLead(); await confirmWork();
    expect(document.querySelector('.batch')).not.toBeNull();
    expect(button('加入 3 个会话').disabled).toBe(true);
    await click(button('连接项目'));
    expect(store.project?.id).toBe(project.id);
    expect(button('加入 3 个会话').disabled).toBe(false);
  });
});

function dependencyTeam(draft=false) {
  store=team();store.agents[1].name='竞争分析';store.agents[2].name='营销';
  const a=makeTask({id:'analysis-task',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'member',title:'分析产品竞争力',instructions:'完整分析',status:draft?'draft':'running',approved:!draft});
  const m=makeTask({id:'marketing-task',projectId:project.id,kind:'dispatch',senderId:'lead',targetId:'other',title:'制定宣传策略',instructions:'根据成果制定策略',status:draft?'draft':'queued',approved:!draft,dependsOn:[a.id],inputs:[{name:'竞争力分析报告',fromTask:a.id,field:'summary',required:true}]});
  store.tasks=[a,m];return {a,m};
}
function card(title: string) { return [...document.querySelectorAll<HTMLElement>('article.task')].find(a=>a.querySelector('h3')?.textContent===title)!; }
describe('dependencies in the rendered sidebar',()=>{
  it.each(['zh-CN','en'])('shows green waiting roles, input sources, and blocks manual copy in %s',async locale=>{
    dependencyTeam();localStorage.setItem('gptworkbot-ui-language',locale);await mount();
    const role=[...document.querySelectorAll('.agent')].find(a=>a.querySelector('.agent-name')?.textContent==='营销')!;
    expect(role.querySelector('.dot.idle')).not.toBeNull();expect(role.textContent).toContain(locale==='en'?'Waiting for prerequisite completion':'等待前置任务完成');
    const c=card('制定宣传策略');expect(c.querySelector('.dependencies')?.textContent).toContain('竞争力分析报告');expect(c.querySelector('.dependency-wait')).not.toBeNull();expect(c.querySelector('.badge')?.textContent).toBe(locale==='en'?'Waiting for prerequisites':'等待前置任务');
    expect([...c.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===(locale==='en'?'Copy':'复制'))?.disabled).toBe(true);
  });
  it('shows yellow for a cancelled prerequisite',async()=>{
    const {a}=dependencyTeam();a.status='cancelled';await mount();
    const role=[...document.querySelectorAll('.agent')].find(n=>n.querySelector('.agent-name')?.textContent==='营销')!;expect(role.querySelector('.dot.needs_interaction')).not.toBeNull();expect(card('制定宣传策略').textContent).toContain('前置任务已取消');
  });
  it('edits draft dependencies, maps inputs, and keeps confirmed relations fixed',async()=>{
    const {a,m}=dependencyTeam(true);await mount();await click([...card(m.title).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='编辑')!);
    await click(document.querySelector<HTMLInputElement>('.dependency-editor input')!);await click(button('保存，保持待确认'));expect(m.inputs).toEqual([]);
    await click([...card(m.title).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='编辑')!);await click(document.querySelector<HTMLInputElement>('.dependency-editor input')!);await click(button('保存，保持待确认'));
    expect(m.inputs[0].fromTask).toBe(a.id);expect(m.inputs[0].required).toBe(true);await click([...card(m.title).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认')!);expect(card(m.title).textContent).not.toContain('编辑');
  });
  it('shows the first result history while a revision is waiting for its new result',async()=>{
    const {a}=dependencyTeam();a.status='waiting';a.attempt=2;a.resultHistory=[{attempt:1,status:'completed',summary:'第一版分析内容',reportId:'old-report',sourceName:'竞争分析',sourceUrl:obs().url,at:Date.now()}];await mount();expect(card(a.title).querySelector('.result-history')?.textContent).toContain('第一版分析内容');
  });
});
