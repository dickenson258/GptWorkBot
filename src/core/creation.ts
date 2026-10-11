import { z } from 'zod';
import type { Store } from './types';

export const createAgentSchema = z.object({
  type: z.literal('create_agent'),
  requestId: z.string().uuid('创建请求无效，请重新打开新增角色窗口'),
  projectId: z.string().min(1, '请先连接项目'),
  supervisor: z.boolean().default(false),
  name: z.string().trim().min(1, '请填写角色名称').max(100, '角色名称最多 100 个字符'),
  responsibilities: z.string().trim().min(1, '请填写角色职责').max(20000, '角色职责最多 20000 个字符'),
  firstTask: z.string().trim().max(40000, '首个任务最多 40000 个字符').default(''),
  acceptance: z.string().trim().max(4000, '验收条件最多 4000 个字符').default('')
}).strict();

export function ensureNewAgentName(store: Store, name: string, proposedNames: string[] = []) {
  if (store.agents.some(a => a.name.trim() === name) || proposedNames.includes(name)) throw new Error('角色名称已存在，请使用不同的名称');
  if (store.tasks.some(t => t.kind === 'create' && t.newAgentName?.trim() === name && !['accepted', 'cancelled'].includes(t.status))) throw new Error('已有同名角色正在创建，请先查看协作任务');
}
