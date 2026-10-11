import { emptyStore } from '../src/core/types';
import type { Agent, Observation, Store } from '../src/core/types';
export const project = { id: 'g-p-0123456789abcdef0123456789abcdef', name: '测试项目', url: 'https://chatgpt.com/g/g-p-0123456789abcdef0123456789abcdef/project' };
export const obs = (id = 'member', extra: Partial<Observation> = {}): Observation => ({ url: `${project.url.replace('/project', '')}/c/${id}`, title: id, projectId: project.id, connected: true, running: false, draft: false, ready: true, workMode: 'work', observedAt: Date.now(), messages: [], ...extra });
export const agent = (id = 'member', supervisor = false): Agent => ({ id, name: id, url: obs(id).url, projectId: project.id, supervisor, initialized: true, userVerifiedWork: true, observation: obs(id) });
export function team(): Store { return { ...emptyStore(), project, agents: [agent('lead', true), agent(), agent('other')] }; }
export const fence = (data: unknown) => `\`\`\`work-team\n${JSON.stringify(data)}\n\`\`\``;
