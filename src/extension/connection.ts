// Read-only recovery. A failed send can follow a successful native click, so
// mutations must never be retried through this helper.
import { conversationId, validCreationUrl } from '../core/types';
import type { Observation } from '../core/types';
const reconnecting = new Map<number, Promise<void>>();
export const backgroundConnectionMessage = '插件后台暂未连接，请关闭侧栏后重新打开；若仍未恢复，请在扩展管理页重新加载 GptWorkBot。团队记录会保留。';
export const pageConnectionMessage = '目标会话的连接已中断，请重新核对会话或打开原页面后刷新；角色仍可直接解绑。';
export function isConnectionError(error: unknown): boolean {
  return /receiving end does not exist|could not establish connection|message port closed|message channel closed|extension context invalidated/i.test(error instanceof Error ? error.message : String(error));
}
export async function chatTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || new URL(tab.url).origin !== 'https://chatgpt.com') throw new Error('目标 ChatGPT 标签页已关闭或已切换，请打开原会话后重新核对');
  return tab;
}
async function reconnect(tabId: number): Promise<void> {
  let pending = reconnecting.get(tabId);
  if (!pending) {
    pending = (async () => {
      await chatTab(tabId);
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    })();
    reconnecting.set(tabId, pending);
  }
  try { await pending; }
  finally { if (reconnecting.get(tabId) === pending) reconnecting.delete(tabId); }
}
export async function readTab<T>(tabId: number, type: 'snapshot' | 'discover'): Promise<T> {
  await chatTab(tabId);
  try { return await chrome.tabs.sendMessage(tabId, { type }); }
  catch (error) {
    if (!isConnectionError(error)) throw error;
    await reconnect(tabId);
    return chrome.tabs.sendMessage(tabId, { type });
  }
}
export class PageLoadingTimeout extends Error {
  constructor() { super('等待会话加载完成与输入区就绪；页面准备好后会继续派发'); }
}
export async function waitForPageReady(tabId: number, expectedId: string, options: { requireComposer?: boolean; shouldContinue?: () => Promise<boolean> } = {}): Promise<Observation> {
  const matches = (url: string) => expectedId.startsWith('project:')
    ? validCreationUrl(url, expectedId.slice(8))
    : conversationId(url) === expectedId;
  const deadline = Date.now() + 15_000;
  let restoredReceiver = false;
  do {
    if (options.shouldContinue && !await options.shouldContinue()) throw new Error('本次派发已暂停或取消');
    const tab = await chrome.tabs.get(tabId);
    // Newly opened tabs can expose only pendingUrl while their document is loading.
    if (!matches(tab.pendingUrl || tab.url || '')) throw new Error('目标标签页已关闭或地址已变化，请重新核对会话');
    if (tab.status !== 'loading' && matches(tab.url || '')) {
      try {
        // Let document_idle install the receiver naturally before attempting one recovery.
        const page = await chrome.tabs.sendMessage(tabId, { type: 'snapshot' }) as Observation | undefined;
        if (page && matches(page.url)) {
          if (options.requireComposer === false || page.ready || page.interaction || page.running) return page;
        } else if (page) throw new Error('目标页面已切换，请重新核对会话');
      } catch (error) {
        if (!isConnectionError(error)) throw error;
        if (!restoredReceiver) { restoredReceiver = true; await reconnect(tabId); }
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)));
  } while (Date.now() <= deadline);
  throw new PageLoadingTimeout();
}
