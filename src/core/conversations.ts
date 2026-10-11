import { conversationId, projectIdFromUrl } from './types';

export interface ConversationOption { url: string; name: string }
export interface ConversationCandidate { url?: string; name?: string; source?: 'native' | 'tab' }
export interface ProjectDiscovery {
  projectId?: string; projectUrl?: string; name?: string; conversations: ConversationOption[];
}

export function conversationName(value?: string, native = false): string {
  const original = (value || '').trim();
  const name = native ? original : original.replace(/\s*[-|·–—]\s*ChatGPT\s*$/i, '').trim();
  // URL tooltips and generic page titles are not conversation names.
  if (!name || /^(?:https?:\/\/|chatgpt\.com\/|\/(?:g|c)\/)/i.test(name) || /^(?:未命名会话|已打开会话|Untitled conversation|Open conversation)$/i.test(name) || !native && /^ChatGPT(?: Work)?$/i.test(name)) return '';
  return name;
}

export function canonicalConversationUrl(url: string): string | undefined {
  const id = conversationId(url);
  if (!id) return;
  const projectId = projectIdFromUrl(url);
  return projectId ? `https://chatgpt.com/g/${projectId}/c/${id}` : `https://chatgpt.com/c/${id}`;
}

// One conversation can have a project slug, a bare /c/ route, query parameters,
// and links in several UI locations. Its durable ID identifies the same address.
export function mergeConversations(candidates: ConversationCandidate[]): ConversationOption[] {
  const entries = new Map<string, ConversationOption & { nameRank: number; urlRank: number }>();
  for (const candidate of candidates) {
    const url = candidate.url && canonicalConversationUrl(candidate.url);
    const id = url && conversationId(url);
    if (!url || !id) continue;
    const name = conversationName(candidate.name, candidate.source === 'native');
    const nameRank = name ? candidate.source === 'native' ? 2 : 1 : 0;
    const urlRank = projectIdFromUrl(url) ? candidate.source === 'native' ? 2 : 1 : 0;
    const previous = entries.get(id);
    if (!previous) entries.set(id, { url, name, nameRank, urlRank });
    else {
      if (nameRank > previous.nameRank) { previous.name = name; previous.nameRank = nameRank; }
      if (urlRank > previous.urlRank) { previous.url = url; previous.urlRank = urlRank; }
    }
  }
  return [...entries.values()].map(({ url, name }) => ({ url, name }));
}
