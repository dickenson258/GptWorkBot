import { readPage, sendText, findButton, prepareWorkConversation } from './adapter';
import { conversationId } from '../core/types';
import { renameConversation } from './naming';
import { discoverProject } from './discovery';
type ContentSession = { dispose: () => void; sendLock: { busy: boolean }; prepareActions: Set<string> };
const host = globalThis as typeof globalThis & { __workTeamContent?: ContentSession };
const previous = host.__workTeamContent;
previous?.dispose();
const sendLock = previous?.sendLock || { busy: false };
const prepareActions = previous?.prepareActions || new Set<string>();
let disposed = false;
let lastSignature = '';
let timer: ReturnType<typeof setTimeout> | undefined;
function publish(force = false) {
  if (disposed) return;
  const observation = readPage(document, location.href);
  const signature = JSON.stringify({ ...observation, observedAt: 0 });
  if (!force && signature === lastSignature) return;
  lastSignature = signature;
  try { chrome.runtime.sendMessage({ type: 'observation', observation }).catch(() => {}); } catch { /* Previous extension context was invalidated by a reload. */ }
}
const observer = new MutationObserver(() => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => publish(), 350);
});
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
const onInput = () => publish();
const onNavigation = () => publish(true);
document.addEventListener('input', onInput);
window.addEventListener('popstate', onNavigation);
const heartbeat = setInterval(() => publish(true), 10_000);
const onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, _sender, respond) => {
  if (disposed) return false;
  if (message.type === 'discover') {
    respond(discoverProject(document, location.href)); return false;
  }
  if (message.type === 'snapshot') { respond(readPage(document, location.href)); return false; }
  if (message.type === 'send') {
    if (sendLock.busy) { respond({ status: 'wait', reason: '另一条消息正在发送' }); return false; }
    sendLock.busy = true;
    sendText(document, location.href, message.agentId, message.text, message.deliveryToken).then(respond).catch(error => respond({ status: 'uncertain', reason: String(error) })).finally(() => { sendLock.busy = false; publish(true); });
    return true;
  }
  if (message.type === 'prepare_create') {
    if (sendLock.busy) { respond({ ready: false, reason: '页面操作尚未完成' }); return false; }
    sendLock.busy = true;
    prepareWorkConversation(document, location.href, prepareActions).then(result => respond({ ...result, observation: readPage(document, location.href) })).catch(error => respond({ ready: false, reason: String(error) })).finally(() => { sendLock.busy = false; }); return true;
  }
  if (message.type === 'rename') {
    if (sendLock.busy) { respond({ status: 'wait', reason: '另一条页面操作正在执行，请稍后重试同步名称' }); return false; }
    const page = readPage(document, location.href);
    if (page.workMode !== 'work' || page.running || page.draft || page.interaction) { respond({ status: 'wait', reason: '请等待 Work 任务完成并处理草稿或页面提示后，再同步名称' }); return false; }
    sendLock.busy = true;
    renameConversation(document, location.href, message.agentId, message.projectId, message.name).then(respond).catch(error => respond({ status: 'wait', reason: String(error) })).finally(() => { sendLock.busy = false; publish(true); }); return true;
  }
  if (message.type === 'stop') {
    if (conversationId(location.href) !== message.agentId) { respond({ stopped: false, reason: '当前页面不是目标会话，请重新核对' }); return false; }
    const stop = findButton(document, /stop-button|stop generating|stop response|停止生成|停止响应|停止回复|^停止$|^Stop$/i);
    if (!stop) respond({ stopped: false, reason: '未找到原生停止按钮，请在会话里处理' });
    else { stop.click(); setTimeout(() => { const page = readPage(document, location.href); respond({ stopped: !page.running, reason: page.running ? '已请求停止，等待原生任务确认' : undefined }); publish(true); }, 500); }
    return Boolean(stop);
  }
  return false;
};
chrome.runtime.onMessage.addListener(onMessage);
host.__workTeamContent = { sendLock, prepareActions, dispose: () => {
  disposed = true;
  observer.disconnect();
  if (timer) clearTimeout(timer);
  clearInterval(heartbeat);
  document.removeEventListener('input', onInput);
  window.removeEventListener('popstate', onNavigation);
  try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* Old context may be invalid. */ }
} };
publish(true);
