import { conversationId, conversationRouteId, projectIdFromUrl, validProjectUrl } from '../core/types';
import { conversationName, mergeConversations } from '../core/conversations';
import type { ConversationCandidate, ProjectDiscovery } from '../core/conversations';
import { nativeConversationTitle } from './naming';

const messageContent = '[data-message-author-role], [data-chatgpt-search-unit-key], [data-talvt-turn-state], [data-local-conversation-final-assistant], .markdown, pre, code';
const nativeElement = (element: Element) => element.getClientRects().length > 0
  && !element.closest(`[hidden], [aria-hidden="true"], [inert], [role="dialog"], [role="menu"], ${messageContent}`)
  && element.ownerDocument.defaultView?.getComputedStyle(element).visibility !== 'hidden';
const text = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';
const projectName = (value?: string | null) => {
  const name = text(value);
  return /^(https?:\/\/|\/(g|c)\/|back to project$|open project$|返回项目$|打开项目$)/i.test(name) ? '' : name;
};
function href(link: HTMLAnchorElement, pageUrl: string): string {
  try { return new URL(link.getAttribute('href') || '', pageUrl).href; } catch { return ''; }
}
function linkName(link: HTMLAnchorElement): string {
  const titles = [
    link.querySelector('[data-thread-title], [data-testid="conversation-title"], h3, .font-medium')?.textContent,
    link.getAttribute('aria-label'), link.getAttribute('title'), link.textContent,
  ];
  return titles.map(value => conversationName(text(value), true)).find(Boolean) || '';
}
function groupProjectName(link: HTMLAnchorElement): string | undefined {
  const label = link.closest('[role="list"][aria-label]')?.getAttribute('aria-label') || '';
  const match = label.match(/^(.+?)\s*中的聊天$/) || label.match(/^(?:chats|conversations) in (.+)$/i) || label.match(/^(.+?) chats$/i);
  return match && projectName(match[1]) || undefined;
}

export function discoverProject(doc: Document, url: string): ProjectDiscovery {
  try { if (new URL(url).origin !== 'https://chatgpt.com') return { conversations: [] }; }
  catch { return { conversations: [] }; }
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(nativeElement);
  const currentId = conversationId(url);
  const currentLinks = currentId ? links.filter(link => conversationId(href(link, url)) === currentId) : [];
  const projectLinks = links.filter(link => validProjectUrl(href(link, url)) && link.closest('main, header, [data-testid="conversation-header"]'));
  const headerProjectIds = [...new Set(projectLinks.map(link => projectIdFromUrl(href(link, url))).filter(Boolean))];
  const projectId = projectIdFromUrl(url)
    || currentLinks.map(link => projectIdFromUrl(href(link, url))).find(Boolean)
    || (headerProjectIds.length === 1 ? headerProjectIds[0] : undefined);
  if (!projectId) return { conversations: [] };

  // A Work header's editable title names the conversation. The neighboring
  // native project icon identifies its project; never fall back to doc.title.
  const markerNames = [...new Set([...doc.querySelectorAll('main [role="img"][aria-label], header [role="img"][aria-label], [data-testid="conversation-header"] [role="img"][aria-label]')]
    .filter(nativeElement).map(element => element.getAttribute('aria-label')?.match(/^(?:项目\s*[：:]|Project\s*:)\s*(.+)$/i)?.[1])
    .map(projectName).filter(Boolean))];
  const homeHeading = !conversationRouteId(url) && validProjectUrl(url)
    ? [...doc.querySelectorAll('main h1')].filter(nativeElement).map(element => projectName(element.textContent)).find(Boolean) : undefined;
  const name = (markerNames.length === 1 ? markerNames[0] : undefined) || homeHeading
    || projectLinks.filter(link => projectIdFromUrl(href(link, url)) === projectId).map(link => projectName(link.textContent)).find(Boolean)
    || links.filter(link => projectIdFromUrl(href(link, url)) === projectId).map(groupProjectName).find(Boolean);

  const candidates: ConversationCandidate[] = links.filter(link => projectIdFromUrl(href(link, url)) === projectId && conversationId(href(link, url)))
    .map(link => ({ url: href(link, url), name: linkName(link), source: 'native' }));
  if (currentId) {
    const nativeTitle = nativeConversationTitle(doc);
    candidates.unshift({ url: `https://chatgpt.com/g/${projectId}/c/${currentId}`, name: nativeTitle || conversationName(doc.title), source: nativeTitle ? 'native' : 'tab' });
  }
  return { projectId, projectUrl: `https://chatgpt.com/g/${projectId}/project`, name, conversations: mergeConversations(candidates) };
}
