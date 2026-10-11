import { describe, expect, it } from 'vitest';
import { applyCommand, ingestObservation } from '../src/core/engine';
import { emptyStore, uid } from '../src/core/types';
import type { PanelCommand } from '../src/core/types';
import { team, project, obs, fence, agent } from './helpers';
const request = (extra: Partial<Extract<PanelCommand, { type: 'create_agent' }>> = {}): Extract<PanelCommand, { type: 'create_agent' }> => ({ type: 'create_agent', requestId: uid(), projectId: project.id, name: '质量检查', responsibilities: '负责代码审查', ...extra });
describe('侧栏创建 Work 角色', () => {
  it('空团队可以直接创建当前项目的第一个主管', () => {
    const s = team(); s.agents = [];
    applyCommand(s, request({ supervisor: true, name: '项目主管' }));
    expect(s.tasks[0]).toMatchObject({ kind: 'create', newAgentSupervisor: true, newAgentName: '项目主管', status: 'queued', approved: true });
    expect(s.project?.id).toBe(project.id);
  });
  it('不能创建第二位主管或用绑定替换正在创建的主管', () => {
    const s = team(); expect(() => applyCommand(s, request({ supervisor: true }))).toThrow('已有主管');
    s.agents = []; applyCommand(s, request({ supervisor: true }));
    expect(() => applyCommand(s, request({ supervisor: true, name: '另一主管' }))).toThrow('主管正在创建');
    expect(() => applyCommand(s, { type: 'bind', agent: agent('new-lead', true) })).toThrow('主管正在创建');
    expect(s.tasks).toHaveLength(1);
  });
  it('新主管只初始化职责，不把首个业务任务误当作成员回报', () => {
    const s = team(); s.agents = [];
    expect(() => applyCommand(s, request({ supervisor: true, firstTask: '执行业务任务' }))).toThrow('主管创建时只初始化职责');
    expect(s.tasks).toHaveLength(0);
  });
  it('只填名称及职责即可初始化，手动创建已确认并沿用当前主管', () => {
    const s = team(); applyCommand(s, request({ name: '  质量检查  ' }));
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ kind: 'create', newAgentName: '质量检查', newAgentInstructions: '负责代码审查', senderId: 'lead', status: 'queued', approved: true });
    expect(s.tasks[0].instructions).toContain('此次只完成初始化'); expect(s.agents).toHaveLength(3);
    expect(s.project).toEqual(project); expect(s.autoRounds).toBe(0);
  });
  it('首个任务与验收条件会写入实际派发内容', () => {
    const s = team(); applyCommand(s, request({ firstTask: ' 检查当前实现 ', acceptance: ' 列出问题位置 ' }));
    expect(s.tasks[0]).toMatchObject({ instructions: '检查当前实现', acceptance: '列出问题位置', title: '质量检查的首个任务' });
  });
  it('未连接项目或未绑定主管时不创建半成品记录', () => {
    const s = emptyStore(); expect(() => applyCommand(s, request())).toThrow('请先连接'); expect(s.tasks).toHaveLength(0);
    const t = team(); t.agents = t.agents.filter(a => !a.supervisor);
    expect(() => applyCommand(t, request())).toThrow('请先创建或绑定'); expect(t.tasks).toHaveLength(0);
  });
  it('填写期间切换项目后拒绝原表单，不会加入其他项目', () => {
    const s = team(); const original = structuredClone(s);
    expect(() => applyCommand(s, request({ projectId: 'g-p-other' }))).toThrow('当前项目已切换'); expect(s).toEqual(original);
  });
  it('重复提交或响应丢失后重试只保留一个创建任务及动态', () => {
    const s = team(); const input = request(); applyCommand(s, input);
    const original = structuredClone(s); applyCommand(s, input); expect(s).toEqual(original);
    s.tasks[0].kind = 'dispatch'; s.tasks[0].targetId = 'created'; s.tasks[0].status = 'reported';
    applyCommand(s, input); expect(s.tasks).toHaveLength(1);
  });
  it('同一请求标识不能改成另一项创建，避免重试创建错角色', () => {
    const s = team(); const input = request(); applyCommand(s, input);
    expect(() => applyCommand(s, { ...input, firstTask: '另一项任务' })).toThrow('此创建请求已提交'); expect(s.tasks).toHaveLength(1);
  });
  it('已绑定或正在创建的同名角色都不能重复提交', () => {
    const s = team(); expect(() => applyCommand(s, request({ name: ' member ' }))).toThrow('名称已存在');
    applyCommand(s, request()); expect(() => applyCommand(s, request())).toThrow('同名角色正在创建'); expect(s.tasks).toHaveLength(1);
  });
  it('主管提议也不能重复创建侧栏已经提交的角色', () => {
    const s = team(); applyCommand(s, request());
    ingestObservation(s, 'lead', obs('lead', { turnIndex: 1, messages: [{ id: 'duplicate', role: 'assistant', text: fence({ version: 2, projectId: project.id, actions: [{ kind: 'create', name: '质量检查', instructions: '审查', title: '检查', task: '执行' }] }) }] }));
    expect(s.tasks).toHaveLength(1); expect(s.agents[0].observation?.interaction).toContain('同名角色');
  });
  it('暂停时保留已确认创建任务，恢复前不派发', () => {
    const s = team(); s.paused = true; s.settings.mode = 'auto'; s.autoRounds = 3;
    applyCommand(s, request()); expect(s.paused).toBe(true); expect(s.tasks[0].status).toBe('queued'); expect(s.autoRounds).toBe(3);
  });
  it.each([
    { name: '   ' }, { responsibilities: '   ' }, { name: 'a'.repeat(101) }, { responsibilities: 'a'.repeat(20001) }, { firstTask: 'a'.repeat(40001) }, { acceptance: 'a'.repeat(4001) }, { requestId: 'invalid-id' }
  ])('无效字段拒绝提交且不改变队列 %#', extra => {
    const s = team(); expect(() => applyCommand(s, request(extra))).toThrow(); expect(s.tasks).toHaveLength(0);
  });
});
