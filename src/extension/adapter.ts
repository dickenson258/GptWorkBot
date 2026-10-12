import { conversationId, projectIdFromUrl, validProjectUrl, validCreationUrl } from '../core/types';
import type { Observation, PageMessage } from '../core/types';
import { draftFingerprint, normalizeDraft } from '../core/delivery';
import { savedConversationTitle } from './naming';
const visible = (e: Element) => e.getClientRects().length > 0 && !e.closest('[hidden],[aria-hidden="true"],[inert]') && e.ownerDocument.defaultView?.getComputedStyle(e).visibility !== 'hidden';
export function composer(doc: Document): HTMLTextAreaElement | HTMLElement | null {
  const candidates = [...doc.querySelectorAll<HTMLTextAreaElement | HTMLElement>('#prompt-textarea, #mobile-composer-prompt, [contenteditable="true"][role="textbox"], textarea[placeholder]')].filter(visible);
  return candidates.find(e => e === doc.activeElement) || candidates.at(-1) || null;
}
export function composerText(element: HTMLElement | HTMLTextAreaElement): string {
  if (element instanceof HTMLTextAreaElement) return element.value;
  const text = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || '';
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return node.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
    let value = '';
    for (const child of node.childNodes) {
      if (child instanceof Element && /^(P|DIV|LI|PRE)$/.test(child.tagName) && value && !value.endsWith('\n')) value += '\n';
      value += text(child);
    }
    return /^(P|DIV|LI|PRE)$/.test(node.tagName) && !value.endsWith('\n') ? `${value}\n` : value;
  };
  return text(element);
}
const buttonLabel = (e: Element) => (e.getAttribute('aria-label') || e.getAttribute('data-testid') || e.textContent || '').trim();
const buttonMatches = (e: Element, pattern: RegExp) => [e.getAttribute('data-testid'), e.getAttribute('aria-label'), e.getAttribute('title'), e.textContent].some(label => { pattern.lastIndex = 0; return Boolean(label && pattern.test(label.trim())); });
export function findButton(doc: Document, pattern: RegExp, scope: ParentNode = doc): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => visible(b) && buttonMatches(b, pattern));
}
function sendButton(box: HTMLElement): HTMLButtonElement | undefined {
  const scope = box.closest('form, [data-thread-find-composer], [data-testid="composer"], [data-composer-placement]') || box.parentElement;
  if (!scope) return undefined;
  const buttons = [...scope.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
  const stable = buttons.filter(b => /^(send-button|composer-submit-button)$/.test(b.getAttribute('data-testid') || '') || b.id === 'composer-submit-button');
  const candidates = stable.length ? stable : buttons.filter(b => buttonMatches(b, /^(send|send message|send prompt|submit prompt|发送|发送消息|发送提示|提交提示)(?:\s*[（(].*[)）])?$/i));
  return candidates.length === 1 ? candidates[0] : undefined;
}
const disabledButton = (button: HTMLButtonElement) => button.disabled || button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-busy') === 'true';
function hash(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
export function readPage(doc: Document, url: string): Observation {
  const box = composer(doc);
  const stop = findButton(doc, /stop-button|stop generating|stop response|停止生成|停止响应|停止回复|^停止$|^Stop$/i);
  const lastTurn = [...doc.querySelectorAll('[data-talvt-turn-state]')].filter(visible).at(-1);
  const runningIndicator = [...doc.querySelectorAll('[data-work-status="running"], [data-testid="work-task-running"], [data-testid="agent-turn-in-progress"]')].find(visible) || (lastTurn && /running|streaming|in.progress/.test(lastTurn.getAttribute('data-talvt-turn-state') || '') ? lastTurn : null);
  const pending = findButton(doc, /^(approve|allow once|continue task|resume task|批准|允许一次|继续任务|恢复任务)$/i);
  // Stream disconnections are native status rows rather than error alerts.
  // Read UI notices only; quoted conversation text and other chats are not state.
  const notices = [...doc.querySelectorAll('[role="alert"], [role="status"], [data-testid="error-message"]')].filter(e => visible(e) && !e.closest('aside, nav, [role="navigation"], [role="complementary"], [data-message-author-role], [data-chatgpt-search-unit-key]')).map(e => e.textContent?.trim() || '');
  const interrupted = notices.find(text => /连接(?:已)?(?:中断|断开)|网络(?:连接)?(?:中断|异常|错误)|等待完整(?:答复|回复)|connection (?:lost|interrupted)|network error|waiting for (?:the )?(?:full|complete) (?:response|reply)/i.test(text));
  const errorText = notices.find(text => /limit|sign in|log in|error|额度|上限|登录|失败|出错/i.test(text));
  const needs = pending ? `等待处理：${buttonLabel(pending)}` : interrupted ? `${interrupted.slice(0, 160)}；请打开原会话核对，已有消息不会自动重发` : errorText?.slice(0, 200);
  const login = findButton(doc, /^(log in|登录)$/i);
  const workChip = [...doc.querySelectorAll('[aria-pressed="true"], [data-mode]')].filter(visible).find(e => /^(work|工作)$|work-mode/i.test((buttonLabel(e) + ' ' + (e.getAttribute('data-mode') || '')).trim())) || (box && /ChatGPT Work/i.test(box.getAttribute('aria-label') || '') ? box : null);
  const chatChip = [...doc.querySelectorAll('[aria-pressed="true"], [data-mode="chat"]')].filter(visible).find(e => /^(chat|聊天)$/i.test(buttonLabel(e)) || e.getAttribute('data-mode') === 'chat');
  const projectLink = [...doc.querySelectorAll<HTMLAnchorElement>('main a[href], header a[href], [data-testid="conversation-header"] a[href]')].find(a => projectIdFromUrl(a.href));
  const projectId = projectIdFromUrl(url) || (projectLink && projectIdFromUrl(projectLink.href));
  const messages: PageMessage[] = [...doc.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"], [data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"]')].filter(element => {
    if (!visible(element)) return false;
    if (element.hasAttribute('data-message-author-role') || element.getAttribute('data-chatgpt-search-unit-key')?.endsWith(':user')) return true;
    const final = element.closest('[data-local-conversation-final-assistant]');
    if (final) return final.getAttribute('data-local-conversation-final-assistant') === 'true';
    // Some native conversation layouts omit the Work final wrapper. Require
    // both the assistant heading and final-answer body, never all assistant
    // search units: those can also contain reasoning or tool output.
    return Boolean(element.querySelector('[data-conversation-role="assistant"]') && element.querySelector('[data-markdown-text-style="assistant-message"]'));
  }).map((element, i) => {
    const content = element.querySelector<HTMLElement>('.markdown, [data-testid="message-content"]') || element;
    // DOM textContent drops fenced-code delimiters; reconstruct them for protocol parsing.
    const clone = content.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-markdown-copy="code-block"]').forEach(block => {
      const code = block.querySelector('code');
      const bar = block.querySelector('[data-markdown-copy="exclude"]');
      const language = [...(bar?.querySelectorAll('div') || [])].map(e => e.childElementCount === 0 ? e.textContent?.trim() : '').find(Boolean) || code?.className.match(/language-([\w-]+)/)?.[1] || '';
      if (code) block.replaceWith(doc.createTextNode(`\n\`\`\`${language}\n${code.textContent || ''}\n\`\`\`\n`));
    });
    clone.querySelectorAll('h4, [data-markdown-copy="exclude"]').forEach(e => e.remove());
    [...clone.querySelectorAll('pre')].forEach(pre => {
      const code = pre.querySelector('code');
      const language = code?.className.match(/language-([\w-]+)/)?.[1] || pre.getAttribute('data-language') || pre.querySelector('[data-language]')?.getAttribute('data-language') || pre.querySelector('div')?.textContent?.trim() || '';
      pre.replaceWith(doc.createTextNode(`\n\`\`\`${language}\n${code?.textContent || pre.textContent || ''}\n\`\`\`\n`));
    });
    const text = (clone.innerText || clone.textContent || '').trim();
    const role = (element.getAttribute('data-message-author-role') || (element.getAttribute('data-chatgpt-search-unit-key')?.endsWith(':user') ? 'user' : 'assistant')) as PageMessage['role'];
    const nativeId = element.getAttribute('data-message-id') || element.closest('[data-message-id]')?.getAttribute('data-message-id') || element.getAttribute('data-chatgpt-search-message-ids')?.split(' ')[0];
    const turnKey = element.getAttribute('data-chatgpt-search-unit-key') || element.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key');
    const turnId = turnKey?.match(/^(fallback-turn-\d+)(?=:|$)/)?.[1];
    const turnState = element.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state');
    return { id: nativeId || `${role}:${i}:${hash(text)}`, role, text, turnId, turnComplete: turnState ? /^(complete|completed)$/.test(turnState) : undefined };
  });
  const indices = [...doc.querySelectorAll('[data-content-search-turn-key], [data-chatgpt-search-unit-key]')].filter(visible).map(e => Number((e.getAttribute('data-content-search-turn-key') || e.getAttribute('data-chatgpt-search-unit-key'))?.match(/fallback-turn-(\d+)/)?.[1])).filter(n => Number.isFinite(n));
  const draft = box ? normalizeDraft(composerText(box)) : '';
  return { url, title: savedConversationTitle(doc,url) || doc.title.replace(/\s*[-|]\s*ChatGPT$/, ''), projectId, projectUrl: projectId ? `https://chatgpt.com/g/${projectId}/project` : undefined, connected: true, running: Boolean(stop || runningIndicator), interaction: needs || (login && !conversationId(url) ? '请先登录 ChatGPT' : undefined), draft: Boolean(draft), draftFingerprint: draft ? draftFingerprint(draft) : undefined, ready: Boolean(box && !box.hasAttribute('disabled') && !box.hasAttribute('readonly') && box.getAttribute('aria-disabled') !== 'true' && box.getAttribute('contenteditable') !== 'false'), workMode: workChip ? 'work' : chatChip ? 'chat' : 'unknown', observedAt: Date.now(), messages, turnIndex: indices.length ? Math.max(...indices) : undefined };
}
export interface SendOutcome { status: 'sent' | 'wait' | 'uncertain'; reason?: string }
export async function sendText(doc: Document, url: string, expectedId: string, text: string, deliveryToken: string): Promise<SendOutcome> {
  const creating = expectedId.startsWith('project:');
  if (creating ? !validCreationUrl(url, expectedId.slice(8)) : conversationId(url) !== expectedId) return { status: 'wait', reason: '当前页面不是目标会话' };
  const page = readPage(doc, url);
  if (page.workMode === 'chat' || (creating && page.workMode !== 'work')) return { status: 'wait', reason: '请先切换到 Work 模式' };
  if (page.messages.some(m => m.role === 'user' && m.text.includes(`[WT-DELIVERY:${deliveryToken}]`))) return { status: 'sent' };
  if (page.running || page.interaction) return { status: 'wait', reason: page.interaction || '会话仍在执行，等待完成' };
  const box = composer(doc);
  if (!box) return { status: 'wait', reason: '未找到可用输入区，请打开会话核对' };
  if (!page.ready) return { status: 'wait', reason: '输入区暂不可编辑，请在会话内处理后重试发送' };
  const expectedText = normalizeDraft(text);
  const marker = `[WT-DELIVERY:${deliveryToken}]`;
  const existingDraft = normalizeDraft(composerText(box));
  if (existingDraft && (existingDraft !== expectedText || !expectedText.startsWith(`${marker}\n`))) return { status: 'wait', reason: '输入框存在用户草稿或任务已被修改，请在会话内核对；不会覆盖内容' };
  const previousFocus = doc.activeElement as HTMLElement | null;
  // Only restore focus if the user has not moved it during the wait.
  const restoreFocus = () => { if (doc.activeElement === box && previousFocus?.isConnected && previousFocus !== box) previousFocus.focus?.({ preventScroll: true }); };
  try {
    if (!existingDraft && box instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (!existingDraft) {
      // Browser editing APIs update ProseMirror/React state, unlike assigning innerHTML.
      box.focus({ preventScroll: true });
      const selection = doc.getSelection();
      const range = doc.createRange(); range.selectNodeContents(box); range.collapse(false);
      selection?.removeAllRanges(); selection?.addRange(range);
      const inserted = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text);
      if (!inserted) return { status: 'wait', reason: '此版本输入区不支持安全填入，请使用复制任务后手动发送' };
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    // React/ProseMirror may render or enable the submit button after the input event.
    // Wait for readiness; never force-enable a native control or send via a blind Enter.
    const deadline = Date.now() + 15_000;
    let lastButton: HTMLButtonElement | undefined;
    let clicked = false;
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const liveUrl = doc.location?.origin === 'https://chatgpt.com' ? doc.location.href : url;
      if ((creating ? !validCreationUrl(liveUrl, expectedId.slice(8)) : conversationId(liveUrl) !== expectedId) || !box.isConnected || !visible(box) || composer(doc) !== box) return { status: 'wait', reason: '页面或输入区发生变化，请核对后重试发送' };
      const fresh = readPage(doc, liveUrl);
      if (fresh.messages.some(m => m.role === 'user' && m.text.includes(marker))) return { status: 'sent' };
      if (fresh.workMode === 'chat' || (creating && fresh.workMode !== 'work')) return { status: 'wait', reason: '会话模式已变化，请切换到 Work 后重试发送' };
      if (fresh.running || fresh.interaction) return { status: 'wait', reason: fresh.interaction || '会话已开始执行，保留草稿等待核对' };
      if (!fresh.ready) return { status: 'wait', reason: '输入区暂不可编辑，已保留草稿' };
      if (normalizeDraft(composerText(box)) !== expectedText) return { status: 'wait', reason: '输入内容发生变化，已保留草稿，请核对' };
      lastButton = sendButton(box);
      if (lastButton && !disabledButton(lastButton)) { lastButton.click(); clicked = true; break; }
      if (Date.now() >= deadline) break;
    }
    if (!clicked) return { status: 'wait', reason: lastButton ? '发送按钮仍被禁用；任务草稿已保留，处理页面提示后点击“重试发送”' : '未找到唯一的发送按钮；任务草稿已保留，可打开会话核对后“重试发送”或手动发送' };
    restoreFocus();
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (readPage(doc, url).messages.some(m => m.role === 'user' && m.text.includes(`[WT-DELIVERY:${deliveryToken}]`))) return { status: 'sent' };
    }
    return { status: 'uncertain', reason: '已点击发送，但尚未确认消息出现；将核对页面，不自动重发' };
  } finally { restoreFocus(); }
}
const preparationActions = new WeakMap<Document, Set<string>>();
export async function prepareWorkConversation(doc: Document, url: string, actions?: Set<string>): Promise<{ ready: boolean; reason?: string }> {
  if (!actions) { actions = preparationActions.get(doc) || new Set<string>(); preparationActions.set(doc, actions); }
  if (validProjectUrl(url) && !composer(doc)) {
    const main = doc.querySelector('main');
    const newChat = main && [...main.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button, a')].find(e => visible(e) && /^(new chat|new task|start a new chat|新聊天|新任务|开始新聊天)$/i.test(e.textContent?.trim() || e.getAttribute('aria-label') || ''));
    if (newChat) { if (!actions.has(`chat:${url}`)) { actions.add(`chat:${url}`); newChat.click(); } return { ready: false, reason: '正在打开项目新会话，请稍后继续核对' }; }
  }
  const page = readPage(doc, url);
  if (page.workMode !== 'work') {
    const work = findButton(doc, /^(work|工作)$/i);
    if (work) { if (!actions.has(`work:${url}`)) { actions.add(`work:${url}`); work.click(); } return { ready: false, reason: '已请求选择 Work，请核对后继续' }; }
    return { ready: false, reason: '请在新会话选择 Work 模式，然后点击“重试发送”' };
  }
  return { ready: Boolean(composer(doc)), reason: composer(doc) ? undefined : '等待新会话输入区就绪' };
}
