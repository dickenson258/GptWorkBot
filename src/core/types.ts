export type AgentWorkState = 'idle' | 'running' | 'needs_interaction' | 'unknown';
export type TaskStatus = 'draft' | 'queued' | 'sending' | 'running' | 'waiting' | 'reported' | 'accepted' | 'cancelled' | 'uncertain';
export type TaskKind = 'dispatch' | 'create' | 'report' | 'bootstrap';
export interface Agent {
  id: string; name: string; url: string; projectId: string; supervisor: boolean;
  userVerifiedWork: boolean; initialized: boolean; tabId?: number;
  observation?: Observation; lastTurnIndex?: number;
  planDiagnostic?: PlanDiagnostic;
  tabClosed?: boolean; tabOpening?: boolean;
  responsibilities?: string;
  conversationNameStatus?: 'pending' | 'renaming' | 'synced' | 'waiting'; conversationNameReason?: string;
}
export interface PlanDiagnostic {
  messageId: string; status: 'baseline' | 'older_turn' | 'processed' | 'not_initialized' | 'registered' | 'invalid';
  reason: string; recoverable: boolean; titles: string[]; turnIndex?: number; previousTurnIndex?: number;
}
export interface Observation {
  url: string; title: string; projectId?: string; projectUrl?: string;
  connected: boolean; running: boolean; interaction?: string; draft: boolean; draftFingerprint?: string;
  ready: boolean; workMode: 'work' | 'chat' | 'unknown'; observedAt: number;
  messages: PageMessage[]; turnIndex?: number;
}
export interface PageMessage { id: string; role: 'assistant' | 'user'; text: string; turnId?: string; turnComplete?: boolean }
export interface TaskInput { name: string; fromTask: string; field: 'summary'; required: true }
export interface ResolvedInput extends TaskInput { attempt: number; summary: string; sourceName: string; sourceUrl: string }
export interface TaskResult { attempt: number; status: 'completed' | 'needs_interaction'; summary: string; request?: string; reportId: string; sourceName: string; sourceUrl: string; at: number }
export interface Task {
  id: string; roundId: string; kind: TaskKind; senderId: string; targetId: string;
  title: string; instructions: string; context: string; acceptance: string;
  status: TaskStatus; approved: boolean; sourceKey: string; createdAt: number;
  deliveredAt?: number; deliveryToken: string; result?: string; reason?: string;
  projectId?: string; taskKey?: string; dependsOn: string[]; inputs: TaskInput[]; resolvedInputs?: ResolvedInput[];
  attempt: number; acceptedAttempt?: number; resultReportId?: string; resultHistory: TaskResult[];
  newAgentName?: string; newAgentInstructions?: string; newAgentSupervisor?: boolean; createdTabId?: number; pendingAgentId?: string; relatedTaskId?: string;
}
export interface Project { id: string; name: string; url: string }
export interface Settings { mode: 'confirm' | 'auto'; concurrency: number; maxAutoRounds: number }
export interface LogEntry { id: string; at: number; text: string }
export interface Store {
  version: 2; project?: Project; agents: Agent[]; tasks: Task[];
  settings: Settings; paused: boolean; autoRounds: number; autoRoundIds: string[];
  processed: string[]; events: LogEntry[];
}
export type PanelCommand =
  | { type: 'recover_plan'; agentId: string; messageId: string }
  | { type: 'configure'; project: Project }
  | { type: 'bind'; agent: Agent }
  | { type: 'bind_many'; agents: Agent[] }
  | { type: 'unbind'; id: string }
  | { type: 'create_agent'; requestId: string; projectId: string; name: string; responsibilities: string; supervisor?: boolean; firstTask?: string; acceptance?: string }
  | { type: 'initialize' }
  | { type: 'approve'; ids: string[] }
  | { type: 'edit'; id: string; title: string; instructions: string; context: string; acceptance: string; newAgentInstructions?: string; dependsOn?: string[] }
  | { type: 'cancel'; id: string }
  | { type: 'accept'; id: string; attempt: number }
  | { type: 'resume_task'; id: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'pause'; paused: boolean }
  | { type: 'reconcile' }
  | { type: 'sync_name'; agentId: string }
  | { type: 'stop'; agentId: string };
export const storageKey = 'gptworkbot-state-v2';
export const emptyStore = (): Store => ({ version: 2, agents: [], tasks: [], settings: { mode: 'confirm', concurrency: 2, maxAutoRounds: 5 }, paused: false, autoRounds: 0, autoRoundIds: [], processed: [], events: [] });
export const uid = () => crypto.randomUUID();
export function addLog(store: Store, text: string) { store.events.unshift({ id: uid(), at: Date.now(), text }); store.events = store.events.slice(0, 100); }
export function conversationRouteId(url: string): string | undefined {
  try { const u = new URL(url); return u.origin === 'https://chatgpt.com' ? decodeURIComponent(u.pathname.match(/\/c\/([^/]+)\/?$/)?.[1] || '') || undefined : undefined; } catch { return undefined; }
}
export const conversationId = (url: string): string | undefined => {
  const id = conversationRouteId(url);
  // Work first uses local-chatgpt:<uuid>, then promotes it to a durable ID.
  // Never truncate an encoded path segment or bind an ephemeral local ID.
  return id && /^[a-zA-Z0-9-]+$/.test(id) && !/^local-chatgpt(?:$|[:-])/i.test(id) ? id : undefined;
};
export function validProjectUrl(url: string) {
  try { const u = new URL(url); return u.origin === 'https://chatgpt.com' && /^\/g\/g-p-[a-zA-Z0-9-]+(?:\/project)?\/?$/.test(u.pathname); } catch { return false; }
}
export function projectIdFromUrl(url: string) { try { return new URL(url).pathname.match(/\/g\/(g-p-[a-fA-F0-9]{32})(?:-|\/|$)/)?.[1] || new URL(url).pathname.match(/\/g\/(g-p-[a-zA-Z0-9]+)(?:\/|$)/)?.[1]; } catch { return undefined; } }
export function validCreationUrl(url: string, projectId: string) {
  return projectIdFromUrl(url) === projectId && (validProjectUrl(url) || /^local-chatgpt:[a-zA-Z0-9-]+$/.test(conversationRouteId(url) || ''));
}
