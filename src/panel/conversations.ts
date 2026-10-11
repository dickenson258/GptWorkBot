import { conversationRouteId, projectIdFromUrl } from '../core/types';
import { mergeConversations } from '../core/conversations';
import type { ProjectDiscovery } from '../core/conversations';
import type { TabInfo } from './transport';

export function conversationOptions(tabs: TabInfo[], discovery: ProjectDiscovery | undefined, projectId?: string) {
  return mergeConversations([
    ...(discovery && discovery.projectId === projectId ? discovery.conversations.map(conversation => ({ ...conversation, source: 'native' as const })) : []),
    ...tabs.map(tab => ({ url: tab.url, name: tab.title, source: 'tab' as const })),
  ]);
}
export function currentProjectTab(tabs: TabInfo[], projectId?: string): TabInfo | undefined {
  const candidates = tabs.filter(tab => {
    try { return new URL(tab.url || '').origin === 'https://chatgpt.com' && (conversationRouteId(tab.url || '') || projectIdFromUrl(tab.url || '')); }
    catch { return false; }
  });
  return candidates.find(tab => tab.active)
    || (projectId ? candidates.find(tab => projectIdFromUrl(tab.url || '') === projectId) : undefined)
    || candidates.find(tab => projectIdFromUrl(tab.url || '')) || candidates[0];
}
