import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { uid } from '../core/types';
import type { PanelCommand, Project } from '../core/types';
import { systemText, translator } from './i18n';
import type { Locale } from './i18n';

export type CreateRoleCommand = Extract<PanelCommand, { type: 'create_agent' }>;
interface Props {
  locale: Locale;
  onLocaleChange: (locale: Locale) => Promise<void>;
  project: Project;
  supervisorName?: string;
  paused: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (command: CreateRoleCommand) => Promise<void>;
}
export function CreateRoleDialog({ locale, onLocaleChange, project, supervisorName, paused, busy, error, onClose, onSubmit }: Props) {
  const tr = translator(locale);
  const [requestId] = useState(uid);
  const [supervisor] = useState(!supervisorName);
  const [name, setName] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [firstTask, setFirstTask] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const handleKeys = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')];
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <div className="modal-backdrop"><form className="modal create-role" role="dialog" aria-modal="true" aria-labelledby="create-role-title" onKeyDown={handleKeys} onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    await onSubmit({ type: 'create_agent', requestId, projectId: project.id, name, responsibilities, supervisor, firstTask, acceptance });
  }}>
    <div className="section-title"><h2 id="create-role-title">{tr("新增 Work 角色")}</h2><div className="header-actions"><select className="language-select" aria-label={tr("界面语言")} value={locale} onChange={e => void onLocaleChange(e.target.value as Locale)}><option value="zh-CN">中文</option><option value="en">English</option></select><button type="button" className="icon" aria-label={tr("关闭新增角色")} disabled={busy} onClick={onClose}><X size={18}/></button></div></div>
    <div className="creation-project"><span>{tr("加入当前项目")}</span><strong>{project.name}</strong><small>{supervisor ? tr("Work 主管 · 负责派发与汇总") : tr("Work 成员 · 向{name}回报", {name: supervisorName || tr("主管")})}</small></div>
    {supervisor && <p className="muted">{tr("当前项目尚未绑定主管，本次将创建主管角色。创建完成后可继续新增成员。")}</p>}
    {error && <p className="reason" role="alert">{systemText(error, locale)}</p>}
    <label>{tr("角色名称")}<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={supervisor ? tr("例如：项目主管") : tr("例如：质量检查")} maxLength={100} required disabled={busy}/></label>
    <label>{tr("角色职责")}<textarea rows={3} value={responsibilities} onChange={event => setResponsibilities(event.target.value)} placeholder={tr("说明负责的工作和约束，沿用当前项目背景")} maxLength={20000} required disabled={busy}/></label>
    {!supervisor && <><label>{tr("首个任务（可选）")}<textarea rows={3} value={firstTask} onChange={event => setFirstTask(event.target.value)} placeholder={tr("留空时只初始化角色，等待主管派发")} maxLength={40000} disabled={busy}/></label><label>{tr("验收条件（可选）")}<textarea rows={2} value={acceptance} onChange={event => setAcceptance(event.target.value)} placeholder={tr("例如：列出问题位置与修复建议")} maxLength={4000} disabled={busy}/></label></>}
    <p className="muted">{supervisor ? tr("创建后会在此项目中打开 Work 主管会话，并初始化协作方式。就绪后在主管会话下达目标。") : tr("创建后会在此项目中打开 Work 会话。填写首个任务后会开始执行；留空则只确认职责与协作方式。")}</p>
    {paused && <p className="reason">{tr("协作已暂停，创建任务会排队，恢复后开始。")}</p>}
    <div className="creation-buttons"><button type="button" className="secondary" disabled={busy} onClick={onClose}>{tr("取消")}</button><button className="primary" disabled={busy || !name.trim() || !responsibilities.trim()}><Plus size={14}/>{busy ? tr("正在提交…") : paused ? tr("加入创建队列") : tr("创建 Work 角色")}</button></div>
  </form></div>;
}
