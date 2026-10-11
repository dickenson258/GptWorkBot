import React from 'react';
import type { Agent } from '../core/types';
import { systemText, translator } from './i18n';
import type { Locale } from './i18n';

export function SupervisorPlanNotice({agent, locale, busy, onRecover}: {agent: Agent; locale: Locale; busy: boolean; onRecover: (messageId: string) => void}) {
  const plan = agent.planDiagnostic;
  if (!agent.supervisor || !plan || plan.status === 'registered') return null;
  const tr = translator(locale);
  const fresh = agent.observation?.connected && Date.now() - agent.observation.observedAt <= 45_000;
  return <div className="plan-diagnostic" role="status">
    <strong>{tr('主管计划尚未登记')}</strong>
    <p>{systemText(plan.reason, locale)}</p>
    {plan.titles.length > 0 && <ul>{plan.titles.map((title, index) => <li key={index}>{title}</li>)}</ul>}
    {plan.recoverable && <>
      <p className="muted">{tr('只登记当前可见主管计划为待确认，不自动发送。请核对会话最新回复。')}</p>
      <button className="secondary" disabled={busy || !fresh || agent.observation?.running || Boolean(agent.observation?.interaction)} onClick={() => onRecover(plan.messageId)}>{tr('重新读取当前计划')}</button>
    </>}
  </div>;
}
