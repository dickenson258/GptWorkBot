import { conversationId, projectIdFromUrl } from '../core/types';
import { conversationName } from '../core/conversations';

const messageContent = '[data-message-author-role], [data-chatgpt-search-unit-key], [data-talvt-turn-state], .markdown, pre, code';
const nativeVisible = (e: Element) => e.getClientRects().length > 0 && !e.closest(`[hidden], [aria-hidden="true"], [inert], ${messageContent}`) && e.ownerDocument.defaultView?.getComputedStyle(e).visibility !== 'hidden';
const visible = (e: Element) => nativeVisible(e) && !e.closest('[role="dialog"], [role="menu"], aside, nav');
const titleInputSelector = 'input[aria-label="聊天标题"], input[aria-label="Chat title"], input[aria-label="Conversation title"]';
function titleHeader(doc: Document): HTMLElement | undefined {
  const icons = [...doc.querySelectorAll('main [role="img"][aria-label], header [role="img"][aria-label], [data-testid="conversation-header"] [role="img"][aria-label]')]
    .filter(e => visible(e) && /^(?:项目\s*[：:]|Project\s*:)\s*\S/i.test(e.getAttribute('aria-label') || ''));
  return icons.length === 1 ? icons[0].parentElement || undefined : undefined;
}
function titleControl(doc: Document): HTMLButtonElement | undefined {
  // Only the editable title next to the native project icon; never messages,
  // project names or sidebar conversations, even if they contain the same name.
  const buttons = [...(titleHeader(doc)?.querySelectorAll<HTMLButtonElement>('button') || [])].filter(b => visible(b) && b.textContent?.trim() && !b.hasAttribute('aria-haspopup'));
  return buttons.length === 1 ? buttons[0] : undefined;
}
function titleInputs(doc: Document): HTMLInputElement[] {
  return [...(titleHeader(doc)?.querySelectorAll<HTMLInputElement>(titleInputSelector) || [])].filter(visible);
}
export function nativeConversationTitle(doc: Document): string | undefined { return titleControl(doc)?.textContent?.trim(); }
function sidebarLinks(doc: Document, url: string): HTMLAnchorElement[] {
  const id = conversationId(url);
  if (!id) return [];
  return [...doc.querySelectorAll<HTMLAnchorElement>('a[data-interactive-row-link], a[aria-current="page"], aside a[href], nav a[href], [role="navigation"] a[href]')].filter(link => {
    if (!nativeVisible(link) || link.closest('[role="dialog"], [role="menu"]')) return false;
    try {
      const address = new URL(link.getAttribute('href') || '', url).href;
      const linkedProject = projectIdFromUrl(address);
      return conversationId(address) === id && (!linkedProject || linkedProject === projectIdFromUrl(url));
    } catch { return false; }
  });
}
export function savedConversationTitle(doc: Document, url: string): string | undefined {
  const links = sidebarLinks(doc,url);
  const current = links.filter(link => link.getAttribute('aria-current') === 'page');
  const names = [...new Set((current.length ? current : links).map(link => conversationName(link.querySelector('[data-thread-title]')?.textContent?.trim() || link.getAttribute('aria-label') || link.textContent?.trim(),true)).filter(Boolean))];
  return names.length === 1 ? names[0] : nativeConversationTitle(doc);
}
function sidebarMenu(doc: Document, url: string): HTMLButtonElement | undefined {
  const links = sidebarLinks(doc,url);
  const current = links.filter(link => link.getAttribute('aria-current') === 'page');
  const candidates = new Set<HTMLButtonElement>();
  for (const link of current.length ? current : links) {
    let row = link.parentElement;
    for (let level = 0; row && level < 7; level++, row = row.parentElement) {
      // Never climb into a project list and operate on another conversation.
      const rowLinks = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => {
        try { return Boolean(conversationId(new URL(a.getAttribute('href') || '', url).href)); } catch { return false; }
      });
      if (rowLinks.length > 1) break;
      const buttons = [...row.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].filter(b => nativeVisible(b) && /^(聊天操作|Chat actions|Chat options|Conversation actions|Conversation options)$/i.test(b.getAttribute('aria-label') || ''));
      if (buttons.length) { buttons.forEach(b => candidates.add(b)); break; }
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}
function renameDialogs(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(dialog => nativeVisible(dialog) && /^(重命名聊天|重命名会话|Rename chat|Rename conversation)$/i.test(dialog.querySelector('h1, h2, [role="heading"]')?.textContent?.trim() || dialog.getAttribute('aria-label') || ''));
}
export interface NameOutcome { status: 'synced' | 'wait'; reason?: string; confirmation?: {url: string; title: string} }
export async function renameConversation(doc: Document, url: string, expectedId: string, projectId: string, name: string): Promise<NameOutcome> {
  const liveUrl = () => doc.location?.origin === 'https://chatgpt.com' ? doc.location.href : url;
  const matches = () => conversationId(liveUrl()) === expectedId && projectIdFromUrl(liveUrl()) === projectId;
  if (!name.trim() || name.length > 100 || !matches()) return { status: 'wait', reason: '会话地址或角色名称不匹配，请重新核对' };
  const deadline = Date.now() + 15_000;
  const waitForUpdate = () => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(100, deadline - Date.now()))));
  const synced = (): NameOutcome => ({status:'synced',confirmation:{url:liveUrl(),title:name}});
  if (savedConversationTitle(doc,liveUrl()) === name) return synced();
  if ([...doc.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]')].some(nativeVisible)) return {status:'wait',reason:'页面已有打开的菜单或对话框，请关闭后重试同步名称'};
  if (titleInputs(doc).length) return {status:'wait',reason:'原生标题正在编辑，请先在会话中保存或取消，再重试同步名称'};
  const menuButton = sidebarMenu(doc,liveUrl());
  if (menuButton) {
    if (menuButton.disabled || menuButton.getAttribute('aria-disabled') === 'true') return {status:'wait',reason:'原生重命名入口暂不可用，请稍后重试同步名称'};
    // Radix triggers open on pointerdown/keydown, not HTMLElement.click().
    // ArrowDown opens rather than toggles, preventing accidental double opens.
    if (menuButton.id.startsWith('radix-')) {
      menuButton.focus({preventScroll:true});
      menuButton.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40}));
      menuButton.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40}));
    } else menuButton.click();
    let renameItem: HTMLElement | undefined;
    for (let i = 0; i < 150 && Date.now() < deadline; i++) {
      if (!matches()) return {status:'wait',reason:'页面已切换，停止同步会话名称'};
      const menus = [...doc.querySelectorAll<HTMLElement>('[role="menu"]')].filter(nativeVisible);
      const owned = menus.filter(menu => menu.getAttribute('aria-labelledby')?.split(/\s+/).includes(menuButton.id) || menu.id === menuButton.getAttribute('aria-controls'));
      const menu = owned.length === 1 ? owned[0] : menus.length === 1 ? menus[0] : undefined;
      const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])].filter(item => nativeVisible(item) && /^(重命名|Rename)$/i.test(item.textContent?.trim() || ''));
      if (items.length === 1) { renameItem = items[0]; break; }
      await waitForUpdate();
    }
    if (!renameItem || renameItem.getAttribute('aria-disabled') === 'true') return {status:'wait',reason:'未找到唯一的原生重命名操作，请打开会话核对后重试同步名称'};
    renameItem.click();
    let dialog: HTMLElement | undefined;
    for (let i = 0; i < 150 && Date.now() < deadline; i++) {
      if (!matches()) return {status:'wait',reason:'页面已切换，停止同步会话名称'};
      const dialogs = renameDialogs(doc); if (dialogs.length === 1) { dialog = dialogs[0]; break; }
      await waitForUpdate();
    }
    const inputs = [...(dialog?.querySelectorAll<HTMLInputElement>(titleInputSelector) || [])].filter(nativeVisible);
    const input = inputs.length === 1 ? inputs[0] : undefined;
    const saves = [...(dialog?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') || [])].filter(b => nativeVisible(b) && /^(保存|Save)$/i.test(b.textContent?.trim() || ''));
    const save = saves.length === 1 ? saves[0] : undefined;
    if (!dialog || !input || input.disabled || input.readOnly || !save || !input.closest('form')?.contains(save) || !matches()) return {status:'wait',reason:'原生重命名表单未就绪，请打开会话核对后重试同步名称'};
    input.focus({preventScroll:true});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set?.call(input,name);
    input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    // Let the controlled editor apply its state before native form submission.
    await waitForUpdate();
    if (!matches() || !input.isConnected || input.value !== name || !save.isConnected || save.disabled || save.getAttribute('aria-disabled') === 'true' || Date.now() >= deadline) return {status:'wait',reason:'原生重命名表单已变化或不可提交，请核对后重试同步名称'};
    save.click();
    for (let i = 0; i < 150 && Date.now() < deadline; i++) {
      if (!matches()) return {status:'wait',reason:'页面已切换，请核对会话名称是否保存'};
      if ((!dialog.isConnected || !nativeVisible(dialog)) && savedConversationTitle(doc,liveUrl()) === name) return synced();
      await waitForUpdate();
    }
    return {status:'wait',reason:'尚未确认原生会话名称保存；请打开会话核对后重试同步名称，不会重新创建或发送任务'};
  }
  let button: HTMLButtonElement | undefined;
  // Newly created Work headers can mount after the final reply. Share one
  // 15-second deadline across finding the control, editing and confirmation.
  for (let i = 0; i < 150 && Date.now() < deadline; i++) {
    if (!matches()) return { status: 'wait', reason: '页面已切换，停止同步会话名称' };
    if (titleInputs(doc).length) return { status: 'wait', reason: '原生标题正在编辑，请先在会话中保存或取消，再重试同步名称' };
    button = titleControl(doc);
    if (button) break;
    await waitForUpdate();
  }
  if (button?.textContent?.trim() === name) return synced();
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || !matches()) return { status: 'wait', reason: '未找到唯一且可用的原生标题入口，请打开会话核对后重试同步名称' };
  button.click();
  let input: HTMLInputElement | undefined;
  for (let i = 0; i < 150 && Date.now() < deadline; i++) {
    if (!matches()) return { status: 'wait', reason: '页面已切换，停止同步会话名称' };
    const candidates = titleInputs(doc);
    if (candidates.length === 1) { input = candidates[0]; break; }
    await waitForUpdate();
  }
  if (!input || input.disabled || input.readOnly || !matches()) return { status: 'wait', reason: '原生标题编辑框未就绪，请打开会话核对后重试同步名称' };
  const originalValue = input.value;
  input.focus({ preventScroll: true });
  if (doc.activeElement !== input || !matches() || !input.isConnected || input.value !== originalValue) return { status: 'wait', reason: '原生标题编辑框未获得焦点或已被修改，请打开会话核对后重试同步名称' };
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, name);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUpdate();
  if (!matches() || !input.isConnected || input.value !== name || doc.activeElement !== input) return { status: 'wait', reason: '标题编辑状态发生变化，请核对会话名称' };
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
  // Native Enter handlers commit on blur. Without focus, input.blur() does
  // nothing and leaves the filled title open while the saved title stays old.
  if (matches() && input.isConnected && input.value === name && doc.activeElement === input) {
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    if (matches() && input.isConnected && input.value === name && doc.activeElement === input) input.blur();
  }
  for (let i = 0; i < 150 && Date.now() < deadline; i++) {
    if (!matches()) return { status: 'wait', reason: '页面已切换，请核对会话名称是否保存' };
    if (!input.isConnected && savedConversationTitle(doc,liveUrl()) === name) return synced();
    await waitForUpdate();
  }
  return { status: 'wait', reason: '尚未确认原生会话名称保存；请打开会话核对后重试同步名称，不会重新创建或发送任务' };
}
