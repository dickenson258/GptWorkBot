import { addLog, emptyStore, uid, conversationId, validProjectUrl, projectIdFromUrl } from './types';
import type { Agent, Observation, PageMessage, PanelCommand, PlanDiagnostic, Store, Task, GeneratedMessage, ResultNotice } from './types';
import { bootstrapPrompt, parseEnvelope, readEnvelope, protocolFormatError, resolveTarget, type MemberEnvelope, type SupervisorEnvelope } from './protocol';
import { createAgentSchema, ensureNewAgentName } from './creation';
import { businessTask, inputsForDependencies, resolveDependencies, validateDependencies } from './dependencies';
import { normalizeLocale } from './language';
import { generatedInstructions, promptTaskTitle } from './message-text';
export function makeTask(input: Partial<Task> & Pick<Task, 'kind' | 'senderId' | 'targetId' | 'title' | 'instructions'>): Task {
  return { id: uid(), roundId: uid(), context: '', acceptance: '', status: 'draft', approved: false, sourceKey: '', createdAt: Date.now(), deliveryToken: uid(), attempt:1, dependsOn:[], inputs:[], resultHistory:[], ...input };
}
export function applyCommand(store: Store, command: PanelCommand): Store {
  if (command.type === 'language') {
    const locale=normalizeLocale(command.locale);
    if(!locale) throw new Error('语言设置保存失败，请重试');
    store.locale=locale;
  } else if (command.type === 'recover_plan') {
    const observation = store.agents.find(a => a.id === command.agentId)?.observation;
    if (!observation) throw new Error('请先打开主管会话并重新核对');
    recoverSupervisorPlan(store, command.agentId, command.messageId, observation);
  } else if (command.type === 'bind_many') {
    if (!command.agents.length || command.agents.length > 50 || command.agents.filter(a => a.supervisor).length !== 1) throw new Error('请选择 1 位主管及需要加入的成员');
    const draft = structuredClone(store);
    command.agents.forEach(agent => applyCommand(draft, { type: 'bind', agent }));
    Object.assign(store, draft);
  } else if (command.type === 'configure') {
    if (!validProjectUrl(command.project.url) || projectIdFromUrl(command.project.url) !== command.project.id) throw new Error('请填写 ChatGPT 项目首页地址');
    if (store.project && store.project.id !== command.project.id && store.tasks.some(t => !['accepted', 'cancelled'].includes(t.status))) throw new Error('请先处理当前项目任务，再切换项目');
    if (store.project?.id !== command.project.id) Object.assign(store, emptyStore(), {locale:store.locale});
    store.project = command.project; addLog(store, `已连接项目：${command.project.name}`);
  } else if (command.type === 'bind') {
    const a = command.agent;
    if (!store.project || a.projectId !== store.project.id || (projectIdFromUrl(a.url) && projectIdFromUrl(a.url) !== store.project.id) || !conversationId(a.url) || conversationId(a.url) !== a.id || !a.userVerifiedWork || !a.name.trim()) throw new Error('请确认会话属于当前项目并已选择 Work 模式');
    if (store.agents.some(item => item.id !== a.id && item.name === a.name)) throw new Error('成员名称重复，请使用不同的显示名称');
    if (a.supervisor && store.tasks.some(t => t.kind === 'create' && t.newAgentSupervisor && !['accepted', 'cancelled'].includes(t.status))) throw new Error('当前项目的主管正在创建，请等待创建完成');
    const prev = store.agents.find(item => item.id === a.id);
    const previousRole = prev?.supervisor;
    if (prev && prev.supervisor !== a.supervisor && store.tasks.some(t => !['accepted', 'cancelled'].includes(t.status))) throw new Error('存在未结束任务，暂时不能更换主管');
    if (a.supervisor && store.agents.some(item => item.supervisor && item.id !== a.id) && store.tasks.some(t => !['accepted', 'cancelled'].includes(t.status))) throw new Error('存在未结束任务，暂时不能更换主管');
    if (a.supervisor) store.agents.forEach(item => { if (item.supervisor && item.id !== a.id) item.initialized = false; item.supervisor = false; });
    const next = { ...a, initialized: previousRole === a.supervisor ? prev!.initialized : false, observation: prev?.observation, lastTurnIndex: prev?.lastTurnIndex };
    store.agents = [...store.agents.filter(item => item.id !== a.id), next];
    const supervisor = store.agents.find(item => item.supervisor);
    if (supervisor && supervisor.id !== a.id) supervisor.initialized = false;
    addLog(store, `已绑定${a.supervisor ? '主管' : '成员'}：${a.name}`);
  } else if (command.type === 'unbind') {
    const agent = store.agents.find(a => a.id === command.id);
    if (!agent) return store; // Safe to retry after a lost background response.
    const cancelled = new Set<string>();
    for (const task of store.tasks) {
      if (!['accepted', 'cancelled'].includes(task.status) && (task.targetId === agent.id || task.senderId === agent.id || task.kind === 'bootstrap' && store.agents.some(a => a.supervisor && a.id === task.targetId))) {
        task.status = 'cancelled';
        task.reason = `${agent.name}已解绑，插件停止跟踪及后续消息；已启动的原生任务请在 ChatGPT 会话内处理`;
        cancelled.add(task.id);
      }
    }
    store.tasks.filter(t => t.relatedTaskId && cancelled.has(t.relatedTaskId) && !['accepted', 'cancelled'].includes(t.status)).forEach(t => { t.status = 'cancelled'; t.reason = '原任务已解绑，停止后续指导消息'; });
    store.agents = store.agents.filter(a => a.id !== command.id);
    store.agents.forEach(a => { if (a.supervisor) a.initialized = false; });
    if (agent.supervisor) store.paused = true;
    addLog(store, `已解绑${agent.supervisor ? '主管' : '成员'}：${agent.name}；原会话与任务历史保留${agent.supervisor ? '，后续协作已暂停' : ''}`);
  } else if (command.type === 'create_agent') {
    const parsed = createAgentSchema.safeParse(command);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const input = parsed.data;
    if (!store.project || !validProjectUrl(store.project.url) || projectIdFromUrl(store.project.url) !== store.project.id) throw new Error('请先连接当前 ChatGPT 项目');
    if (input.projectId !== store.project.id) throw new Error('当前项目已切换，请重新打开新增角色窗口');
    const title = input.firstTask ? `${input.name}的首个任务` : `初始化${input.name}`;
    const generatedMessage:GeneratedMessage | undefined=input.firstTask ? undefined : {type:'initialization',supervisor:input.supervisor};
    const instructions = input.firstTask || generatedInstructions(generatedMessage!,store.locale || 'zh-CN');
    const sourceKey = `panel:create:${input.requestId}`;
    const existing = store.tasks.find(t => t.sourceKey === sourceKey);
    // A lost response or double click must not create a second native chat.
    if (existing) {
      if (existing.newAgentName !== input.name || existing.newAgentInstructions !== input.responsibilities || Boolean(existing.newAgentSupervisor) !== input.supervisor || existing.title !== title || (input.firstTask ? existing.instructions !== instructions : existing.generatedMessage?.type !== 'initialization') || existing.acceptance !== input.acceptance) throw new Error('此创建请求已提交，请关闭窗口并查看协作任务');
      return store;
    }
    const supervisor = store.agents.find(a => a.supervisor);
    if (input.supervisor) {
      if (supervisor || store.tasks.some(t => t.kind === 'create' && t.newAgentSupervisor && !['accepted', 'cancelled'].includes(t.status))) throw new Error('当前项目已有主管或主管正在创建，请新增成员角色');
      if (input.firstTask || input.acceptance) throw new Error('主管创建时只初始化职责，创建完成后请在主管会话下达目标');
    } else if (!supervisor) throw new Error('请先创建或绑定当前项目的主管会话');
    ensureNewAgentName(store, input.name);
    store.tasks.push(makeTask({ projectId:store.project?.id, kind: 'create', senderId: supervisor?.id || `panel:${input.requestId}`, targetId: `new:${uid()}`, title, instructions, generatedMessage, acceptance: input.acceptance, newAgentName: input.name, newAgentInstructions: input.responsibilities, newAgentSupervisor: input.supervisor, sourceKey, status: 'queued', approved: true }));
    addLog(store, `已排队创建 Work 角色：${input.name}，加入项目 ${store.project.name}${store.paused ? '；恢复协作后开始' : ''}`);
  } else if (command.type === 'initialize') {
    const supervisor = store.agents.find(a => a.supervisor);
    if (!supervisor || !store.project) throw new Error('请先绑定主管会话');
    const roundId = uid();
    store.agents.filter(a => !a.initialized).sort((a,b) => Number(b.supervisor) - Number(a.supervisor)).forEach(a => {
      if (!store.tasks.some(t => t.targetId === a.id && t.kind === 'bootstrap' && !['accepted', 'cancelled'].includes(t.status))) store.tasks.push(makeTask({ projectId:store.project?.id, kind: 'bootstrap', senderId: supervisor.id, targetId: a.id, title: `连接${a.name}`, instructions: bootstrapPrompt(a, store), generatedMessage:{type:'bootstrap'}, roundId, approved: true, status: 'queued' }));
    });
    addLog(store, '已排队发送消息路由说明，项目分工保持原样');
  } else if (command.type === 'approve') {
    store.tasks.filter(t => command.ids.includes(t.id) && t.status === 'draft').forEach(t => { t.approved = true; t.status = 'queued'; });
    addLog(store, '本轮任务已确认');
  } else if (command.type === 'edit') {
    const task = store.tasks.find(t => t.id === command.id);
    if (!task || task.status !== 'draft') throw new Error('只可编辑尚未确认的任务');
    if (!command.title.trim() || !command.instructions.trim()) throw new Error('标题和任务内容不能为空');
    const edited = {...task,title:command.title.trim(),instructions:command.instructions,context:command.context,acceptance:command.acceptance};
    if (command.dependsOn !== undefined) {
      if (!businessTask(task)) throw new Error('只有成员业务任务可设置依赖');
      edited.dependsOn = [...command.dependsOn]; edited.inputs = inputsForDependencies(edited.dependsOn,store);
    }
    if (task.kind === 'create' && command.newAgentInstructions !== undefined) { if (!command.newAgentInstructions.trim()) throw new Error('新成员职责不能为空'); edited.newAgentInstructions = command.newAgentInstructions; }
    validateDependencies(store,[edited]); Object.assign(task,edited);
  } else if (command.type === 'cancel') {
    const t = store.tasks.find(t => t.id === command.id);
    if (t && ['draft', 'queued'].includes(t.status)) t.status = 'cancelled';
    else throw new Error('已启动的任务请打开会话或使用停止按钮处理');
  } else if (command.type === 'accept') {
    const t = store.tasks.find(t => t.id === command.id);
    ensureAcceptance(t,command.attempt);
    t!.status = 'accepted'; t!.acceptedAttempt = command.attempt; addLog(store, `用户确认验收：${t!.title}`);
  } else if (command.type === 'settings') {
    if (!['confirm', 'auto'].includes(command.settings.mode) || !Number.isInteger(command.settings.concurrency) || command.settings.concurrency < 1 || command.settings.concurrency > 4 || !Number.isInteger(command.settings.maxAutoRounds) || command.settings.maxAutoRounds < 1 || command.settings.maxAutoRounds > 20) throw new Error('请使用有效的模式、并发数和自动轮数');
    store.settings = command.settings;
    addLog(store, command.settings.mode === 'auto' ? '已开启自动模式；已有待确认任务仍需确认' : '已切换为每轮确认');
  } else if (command.type === 'pause') {
    store.paused = command.paused;
    if (!command.paused) { store.autoRounds = 0; store.autoRoundIds = []; }
    addLog(store, command.paused ? '已暂停后续派发与回传；Work 中的任务继续按原生状态运行' : '已恢复协作');
  } else if (command.type === 'resume_task') {
    const task = store.tasks.find(t => t.id === command.id);
    if (!task || !['waiting', 'uncertain'].includes(task.status)) throw new Error('该任务无需恢复');
    if (task.status === 'uncertain') throw new Error('发送状态不确定，请先重新核对页面；不会自动重发');
    if (task.kind === 'create' && task.createdTabId) { task.status = 'queued'; task.reason = undefined; }
    else if (!task.deliveredAt) { task.status = 'queued'; task.reason = undefined; }
    else {
      if (!store.tasks.some(t => t.relatedTaskId === task.id && !['accepted', 'cancelled'].includes(t.status))) {
        const generatedMessage:GeneratedMessage={type:'progress',taskId:task.id,attempt:task.attempt};
        store.tasks.push(makeTask({ projectId:store.project?.id, kind: 'report', senderId: task.senderId, targetId: task.targetId, title: `继续处理：${task.title}`, instructions:generatedInstructions(generatedMessage,store.locale || 'zh-CN'), generatedMessage, attempt:task.attempt, status: 'queued', approved: true, sourceKey: `repair:${task.id}`, relatedTaskId: task.id }));
      }
      task.reason = '已请求成员核对进展并补充回报';
    }
  }
  return store;
}
function ensureAcceptance(task: Task | undefined, attempt: number) {
  if (!task || task.status !== 'reported') throw new Error('此任务尚未提交结果');
  const latest = task.resultHistory.at(-1);
  if (attempt !== task.attempt || latest?.attempt !== attempt || latest.status !== 'completed') throw new Error('任务轮次已变化，请重新核对当前成果');
}
function proposal(store: Store, agent: Agent, envelope: SupervisorEnvelope, sourceKey: string, requireConfirmation = false) {
  const roundId = uid(), drafts: Task[] = [], accepts: Task[] = [];
  const revisions: Array<{original:Task; nextAttempt:number}> = [];
  const controls = new Set<string>();
  for (const action of envelope.actions) {
    if (action.kind === 'accept' || action.kind === 'resume') {
      if (controls.has(action.taskId)) throw new Error('同一批指令不能重复验收或修订同一个任务');
      controls.add(action.taskId);
    }
    if (action.kind === 'accept') {
      const task = store.tasks.find(t => t.id === action.taskId);
      ensureAcceptance(task,action.attempt);
      const report = store.tasks.find(t => t.id === task!.resultReportId && t.targetId === agent.id);
      if (!report?.deliveredAt) throw new Error('成果尚未确认回传主管，请先核对回执');
      accepts.push(task!); continue;
    }
    if (action.kind === 'resume') {
      const original = store.tasks.find(t => t.id === action.taskId && ['reported','waiting'].includes(t.status) && t.deliveredAt && t.kind === 'dispatch');
      if (!original || !store.agents.some(a => a.id === original.targetId && !a.supervisor)) throw new Error('只能指导已有成员已提交或等待处理的任务');
      if (original.attempt !== action.attempt) throw new Error('任务轮次已变化，请重新核对当前成果');
      if (store.tasks.some(t => t.relatedTaskId === original.id && !['accepted','cancelled'].includes(t.status))) throw new Error('该任务已有继续处理的消息，请等待成员回报');
      const nextAttempt = original.attempt + 1;
      revisions.push({original,nextAttempt});
      const generatedMessage:GeneratedMessage={type:'revision',taskId:original.id,attempt:nextAttempt,guidance:action.instructions,previousResult:original.result};
      drafts.push(makeTask({projectId:store.project!.id,kind:'report',senderId:agent.id,targetId:original.targetId,title:`主管指导：${original.title}`,instructions:generatedInstructions(generatedMessage,store.locale || 'zh-CN'),generatedMessage,attempt:nextAttempt,relatedTaskId:original.id,roundId,sourceKey}));
      continue;
    }
    if (action.kind === 'dispatch') {
      const target = resolveTarget(store.agents, action.target);
      drafts.push(makeTask({projectId:store.project!.id,kind:'dispatch',senderId:agent.id,targetId:target.id,title:action.title,instructions:action.instructions,context:action.context,acceptance:action.acceptance,taskKey:action.taskKey,dependsOn:action.dependsOn,inputs:action.inputs,roundId,sourceKey}));
    } else {
      const name = action.name.trim();
      if (!name) throw new Error('请填写角色名称');
      ensureNewAgentName(store,name,drafts.map(t => t.newAgentName).filter((name): name is string => Boolean(name)));
      drafts.push(makeTask({projectId:store.project!.id,kind:'create',senderId:agent.id,targetId:`new:${uid()}`,title:action.title,instructions:action.task,acceptance:action.acceptance,newAgentName:name,newAgentInstructions:action.instructions,taskKey:action.taskKey,dependsOn:action.dependsOn,inputs:action.inputs,roundId,sourceKey}));
    }
  }
  // No task, acceptance or revision is committed until the whole batch is valid.
  resolveDependencies(store,drafts);
  accepts.forEach(t => {t.status='accepted';t.acceptedAttempt=t.attempt;addLog(store,`主管已验收：${t.title}`);});
  revisions.forEach(({original,nextAttempt}) => {
    original.attempt=nextAttempt;original.status='waiting';original.result=undefined;original.resultReportId=undefined;original.acceptedAttempt=undefined;
    original.reason='等待主管指导送达并提交新版成果';
    addLog(store,`已安排修订：${original.title}，第 ${nextAttempt} 轮`);
  });
  if (drafts.length && store.settings.mode === 'auto' && !requireConfirmation) {
    if (store.autoRounds >= store.settings.maxAutoRounds) {store.paused=true;addLog(store,'自动轮数已达上限，请检查后恢复协作');}
    else {store.autoRounds++;store.autoRoundIds.push(roundId);drafts.forEach(t => {t.approved=true;t.status='queued';});}
  }
  store.tasks.push(...drafts);
  if (drafts.length) addLog(store,`主管提出 ${drafts.length} 项任务${requireConfirmation || store.settings.mode === 'confirm' || store.paused ? '，等待确认' : ''}`);
}

function diagnosePlan(store: Store, agent: Agent, observation: Observation, status: PlanDiagnostic['status'], reason: string) {
  if (!agent.supervisor) return;
  const message = observation.messages.filter(m => m.role === 'assistant').at(-1);
  if (!message || message.turnComplete === false || observation.running || observation.interaction) { agent.planDiagnostic = undefined; return; }
  let envelope: SupervisorEnvelope | undefined;
  try { envelope = parseEnvelope(message.text, true) as SupervisorEnvelope | undefined; }
  catch (error) {
    agent.planDiagnostic = {messageId:message.id,status:'invalid',reason:(error as Error).message,recoverable:false,titles:[]};
    return;
  }
  if (!envelope?.actions.some(a => a.kind === 'dispatch' || a.kind === 'create')) { agent.planDiagnostic = undefined; return; }
  if (envelope.projectId !== store.project?.id) { agent.planDiagnostic = undefined; return; }
  const registered = store.tasks.some(t => t.sourceKey === `${agent.id}:${message.id}`);
  const diagnostic: PlanDiagnostic = {
    messageId: message.id, status: registered ? 'registered' : status,
    reason: registered ? '当前主管计划已登记' : reason,
    recoverable: !registered && agent.initialized && envelope.actions.every(a => a.kind === 'dispatch' || a.kind === 'create'),
    titles: envelope.actions.flatMap(a => a.kind === 'dispatch' || a.kind === 'create' ? [a.title] : []),
    turnIndex: observation.turnIndex, previousTurnIndex: agent.lastTurnIndex
  };
  const previous = agent.planDiagnostic;
  // Heartbeats must preserve the first explanation, rather than replacing a
  // known baseline/turn-filter failure with the generic deduplication reason.
  if (!registered && status === 'processed' && previous?.messageId === message.id && previous.status !== 'registered') {
    diagnostic.status = previous.status; diagnostic.reason = previous.reason;
    diagnostic.previousTurnIndex = previous.previousTurnIndex;
  }
  agent.planDiagnostic = diagnostic;
  if (!registered && (previous?.messageId !== diagnostic.messageId || previous.status !== diagnostic.status)) addLog(store, `${agent.name}：${diagnostic.reason}`);
}

// Recovery is an explicit reread of one visible supervisor reply, never a replay
// of conversation history. Even in auto mode, the recovered batch stays unapproved.
export function recoverSupervisorPlan(store: Store, agentId: string, messageId: string, observation: Observation): void {
  const agent = store.agents.find(a => a.id === agentId && a.supervisor);
  if (!agent || !agent.initialized) throw new Error('请先连接主管协作协议');
  if (!store.project || !observation.connected || conversationId(observation.url) !== agent.id || observation.projectId !== store.project.id || agent.projectId !== store.project.id) throw new Error('请先打开当前项目的主管会话并重新核对');
  if (observation.running || observation.interaction) throw new Error('请等待主管回复完成并处理原生交互');
  const message = observation.messages.filter(m => m.role === 'assistant').at(-1);
  if (!message || message.id !== messageId || message.turnComplete === false) throw new Error('主管最新回复已变化，请重新核对当前计划');
  const sourceKey = `${agent.id}:${message.id}`;
  if (store.tasks.some(t => t.sourceKey === sourceKey)) throw new Error('此主管计划已登记，不会重复导入');
  if (!agent.planDiagnostic?.recoverable || agent.planDiagnostic.messageId !== messageId) throw new Error('请先重新核对当前主管计划');
  const envelope = parseEnvelope(message.text, true) as SupervisorEnvelope | undefined;
  if (!envelope || envelope.projectId !== store.project?.id) throw new Error('协作指令的项目标识不匹配');
  if (!envelope.actions.every(a => a.kind === 'dispatch' || a.kind === 'create')) throw new Error('重新读取只支持派发计划；验收或修订请由主管重新确认');
  proposal(store, agent, envelope, sourceKey, true);
  agent.observation = observation;
  agent.lastTurnIndex = observation.turnIndex;
  store.processed = [...new Set([...store.processed, sourceKey])];
  diagnosePlan(store, agent, observation, 'registered', '当前主管计划已登记');
  addLog(store, '已重新读取主管计划，等待用户确认；尚未派发');
}
function result(store: Store, agent: Agent, envelope: MemberEnvelope, sourceKey: string) {
  const task = store.tasks.find(t => t.id === envelope.taskId && t.targetId === agent.id && t.deliveredAt && t.kind === 'dispatch');
  if (!task) throw new Error('回报未对应此成员已收到的任务');
  if (envelope.attempt < task.attempt) {addLog(store,`忽略旧轮次成果：${task.title}`);return;}
  if (envelope.attempt !== task.attempt) throw new Error('任务轮次已变化，请重新核对当前成果');
  if (['reported','accepted','cancelled'].includes(task.status)) return;
  if (!['running','waiting','uncertain'].includes(task.status)) throw new Error('当前任务尚未开始执行');
  if (task.attempt > 1 && !store.tasks.some(t => t.relatedTaskId === task.id && t.attempt === task.attempt && t.deliveredAt)) throw new Error('当前修订轮次尚未确认送达');
  const supervisor = store.agents.find(a => a.supervisor);
  if (!supervisor) throw new Error('主管会话未绑定');
  task.status=envelope.status==='completed'?'reported':'waiting';task.result=envelope.summary;
  task.reason=envelope.status==='needs_interaction'?envelope.request || envelope.summary:undefined;
  let reportTask = store.tasks.find(t => t.kind==='report' && t.roundId===task.roundId && t.status==='queued' && !t.preparedPrompt && t.targetId===supervisor.id && !t.relatedTaskId);
  const downstream = store.tasks.filter(t => t.dependsOn.includes(task.id) && ['draft','queued'].includes(t.status));
  const entry:ResultNotice={taskId:task.id,title:promptTaskTitle(task,store.locale || 'zh-CN'),attempt:task.attempt,status:envelope.status,sourceName:agent.name,sourceUrl:agent.url,summary:envelope.summary,request:envelope.request,downstream:downstream.map(t=>({id:t.id,title:promptTaskTitle(t,store.locale || 'zh-CN')}))};
  if (reportTask?.generatedMessage?.type==='results') {
    reportTask.generatedMessage.entries.push(entry);
    reportTask.instructions=generatedInstructions(reportTask.generatedMessage,store.locale || 'zh-CN');
  } else {
    const generatedMessage:GeneratedMessage={type:'results',entries:[entry]};
    reportTask=makeTask({projectId:store.project!.id,kind:'report',senderId:agent.id,targetId:supervisor.id,roundId:task.roundId,title:'本轮成员回报',instructions:generatedInstructions(generatedMessage,store.locale || 'zh-CN'),generatedMessage,status:'queued',approved:true,sourceKey});store.tasks.push(reportTask);
  }
  task.resultReportId=reportTask.id;
  task.resultHistory.push({attempt:task.attempt,status:envelope.status,summary:envelope.summary,request:envelope.request,reportId:reportTask.id,sourceName:agent.name,sourceUrl:agent.url,at:Date.now()});
  addLog(store,`${agent.name}${envelope.status==='completed'?'已提交成果':'需要进一步交互'}`);
}
function completedReply(task: Task, observation: Observation): PageMessage | undefined {
  const index = observation.messages.findIndex(m => m.role === 'user' && m.text.includes(`[WT-DELIVERY:${task.deliveryToken}]`));
  if (index < 0) return;
  const receipt = observation.messages[index];
  for (const message of observation.messages.slice(index + 1)) {
    // Work can virtualize the original reply. Never borrow a later user's reply.
    if (message.role === 'user') return;
    if (receipt.turnId && message.turnId !== receipt.turnId) continue;
    if (message.turnComplete === false || observation.running && message.turnComplete !== true) continue;
    return message;
  }
}
function settleCompletedDeliveries(store: Store, agent: Agent, observation: Observation) {
  // Re-read known delivered member replies that previously failed JSON parsing.
  // This also recovers a deduplicated reply after upgrading or restarting.
  // Historical supervisor proposals and ordinary business waits are excluded.
  for (const t of store.tasks.filter(t => t.targetId === agent.id && t.deliveredAt && (t.status === 'running' || t.status === 'waiting' && t.reason === protocolFormatError && !t.resultHistory.some(r => r.attempt === t.attempt) && (t.kind === 'dispatch' || t.kind === 'report' && t.relatedTaskId)))) {
    const reply = completedReply(t, observation);
    if (!reply) continue;
    if (t.kind === 'bootstrap') { t.status = 'accepted'; t.reason = undefined; agent.initialized = true; addLog(store, `${agent.name}已连接协作协议`); }
    else if (t.kind === 'report' && !t.relatedTaskId) { t.status = 'accepted'; t.reason = undefined; }
    else if (t.kind === 'dispatch' || t.kind === 'report' && t.relatedTaskId) {
      // A receipt can become visible after its final reply was deduplicated.
      // Recover only this task's member result; never replay supervisor actions.
      try {
        const envelope = parseEnvelope(reply.text, false) as MemberEnvelope | undefined;
        if (envelope && envelope.projectId === store.project?.id && envelope.taskId === (t.relatedTaskId || t.id) && envelope.attempt === t.attempt) {
          result(store, agent, envelope, `${agent.id}:${reply.id}`);
          if (t.relatedTaskId) { t.status = 'accepted'; t.reason = undefined; }
        } else { t.status = 'waiting'; t.reason = '本次回复已结束，但未包含对应任务回报，请核对进展或请求补充回报'; }
      } catch (error) { t.status = 'waiting'; t.reason = (error as Error).message; }
    }
  }
}
export function ingestObservation(store: Store, agentId: string, observation: Observation, tabId?: number): void {
  const agent = store.agents.find(a => a.id === agentId);
  if (!agent || conversationId(observation.url) !== agent.id) return;
  const previous = agent.observation;
  agent.observation = observation; if (tabId !== undefined) agent.tabId = tabId;
  if (observation.projectId && observation.projectId !== agent.projectId) { agent.observation.interaction = '会话所属项目与团队不符，请核对'; return; }
  for (const task of store.tasks.filter(t => t.targetId === agent.id && (['sending', 'uncertain'].includes(t.status) || t.status === 'waiting' && !t.deliveredAt))) {
    if (observation.messages.some(m => m.role === 'user' && m.text.includes(`[WT-DELIVERY:${task.deliveryToken}]`))) {
      task.status = 'running'; task.deliveredAt ??= Date.now(); task.reason = undefined;
    }
  }
  // Completion bookkeeping is independent of whether a final's instructions
  // have been processed already. Known delivery tokens can settle on reconnect.
  settleCompletedDeliveries(store, agent, observation);
  // First connection establishes a baseline: historical proposals never trigger sends.
  if (!previous) {
    diagnosePlan(store, agent, observation, 'baseline', '当前主管计划被视为连接前的历史回复，尚未登记');
    agent.lastTurnIndex = observation.turnIndex;
    observation.messages.filter(m => m.role === 'assistant' && m.turnComplete !== false).forEach(m => store.processed.push(`${agent.id}:${m.id}`));
    return;
  }
  if (observation.running || observation.interaction) { agent.planDiagnostic = undefined; return; }
  // Work virtualizes old turns. Only the newest visible final is actionable, and
  // loading older turns never moves the observed turn watermark backwards.
  if (observation.turnIndex !== undefined && agent.lastTurnIndex !== undefined && observation.turnIndex < agent.lastTurnIndex) {
    diagnosePlan(store, agent, observation, 'older_turn', '当前主管计划的页面轮次低于已记录轮次，尚未登记');
    return;
  }
  if (observation.turnIndex !== undefined) agent.lastTurnIndex = observation.turnIndex;
  const newest = observation.messages.filter(m => m.role === 'assistant').at(-1);
  if (newest?.turnComplete === false) { agent.planDiagnostic = undefined; return; }
  if (!newest || store.processed.includes(`${agent.id}:${newest.id}`)) {
    diagnosePlan(store, agent, observation, 'processed', '当前主管回复已标记为处理过，但派发计划尚未登记');
  }
  const newMessages = newest && !store.processed.includes(`${agent.id}:${newest.id}`) ? [newest] : [];
  observation.messages.filter(m => m.role === 'assistant' && m !== newest).forEach(m => store.processed.push(`${agent.id}:${m.id}`));
  for (const message of newMessages) {
    const sourceKey = `${agent.id}:${message.id}`;
    try {
      const parsed = readEnvelope(message.text, agent.supervisor);
      const envelope = parsed?.envelope;
      if (envelope && (agent.initialized || store.tasks.some(t => t.targetId === agent.id && t.kind === 'bootstrap' && t.deliveredAt))) {
        if (envelope.projectId !== store.project?.id) throw new Error('协作指令的项目标识不匹配');
        if (agent.supervisor) {
          proposal(store, agent, envelope as SupervisorEnvelope, sourceKey, parsed?.language === 'json');
          if (parsed?.language === 'json' && (envelope as SupervisorEnvelope).actions.some(a => a.kind === 'dispatch' || a.kind === 'create')) addLog(store, '主管使用 json 代码块，计划已登记为待确认');
          diagnosePlan(store, agent, observation, 'registered', '当前主管计划已登记');
        }
        else result(store, agent, envelope as MemberEnvelope, sourceKey);
      } else {
        diagnosePlan(store, agent, observation, 'not_initialized', '主管协作路由尚未连接，当前计划未登记');
      }
    } catch (error) {
      agent.observation.interaction = (error as Error).message;
      addLog(store, `${agent.name}：${(error as Error).message}`);
      if (agent.supervisor) {
        // Record valid plans whose batch validation failed, so a fixed local
        // prerequisite can be checked again without repeating the ChatGPT turn.
        diagnosePlan(store, agent, { ...observation, interaction: undefined }, 'invalid', (error as Error).message);
      }
    }
    store.processed.push(sourceKey);
  }
  settleCompletedDeliveries(store, agent, observation);
  // Retain replay receipts for the whole local project session.
  store.processed = [...new Set(store.processed)];
}
