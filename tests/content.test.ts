import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPage, sendText, findButton } from '../src/extension/adapter';
import { obs } from './helpers';
vi.mock('../src/extension/adapter', () => ({ readPage: vi.fn(), sendText: vi.fn(), findButton: vi.fn(), prepareWorkConversation: vi.fn() }));
type Handler = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const handlers = new Set<Handler>();
const observers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
type Host = typeof globalThis & { __workTeamContent?: { dispose: () => void } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); vi.useFakeTimers(); handlers.clear(); observers.length = 0;
  vi.mocked(readPage).mockReturnValue(obs());
  vi.stubGlobal('location', { href: obs().url });
  vi.stubGlobal('MutationObserver', class {
    disconnect = vi.fn(); observe = vi.fn();
    constructor() { observers.push(this); }
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({})), onMessage: { addListener: (handler: Handler) => handlers.add(handler), removeListener: (handler: Handler) => handlers.delete(handler) } } });
});
afterEach(() => { (globalThis as Host).__workTeamContent?.dispose(); delete (globalThis as Host).__workTeamContent; vi.useRealTimers(); vi.unstubAllGlobals(); });
function receive(message: unknown) { const respond = vi.fn(); [...handlers][0](message, {}, respond); return respond; }
describe('重复注入内容脚本', () => {
  it('读取项目返回所属项目名称，并按正式会话地址合并侧栏与重复引用', async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const projectId=obs().projectId;
    document.title='软件开发';
    document.body.innerHTML=`<aside><a href="${obs().url}" aria-label="软件开发"><span data-thread-title="true">软件开发</span></a></aside><main><div><span role="img" aria-label="项目：个人开发项目"></span><button>软件开发</button></div><div data-message-author-role="user"><a href="https://chatgpt.com/g/${projectId}-named/c/member">同一会话地址</a></div></main>`;
    await import('../src/extension/content');
    expect(receive({type:'discover'})).toHaveBeenCalledExactlyOnceWith({projectId,projectUrl:`https://chatgpt.com/g/${projectId}/project`,name:'个人开发项目',conversations:[{url:obs().url,name:'软件开发'}]});
  });
  it('命名不与消息发送同时执行，用户草稿期间也不操作标题', async () => {
    let finish!: (value:{status:'sent'})=>void;
    vi.mocked(sendText).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    await import('../src/extension/content'); receive({type:'send',agentId:'member',text:'test',deliveryToken:'token'});
    expect(receive({type:'rename',agentId:'member',name:'角色'})).toHaveBeenCalledWith(expect.objectContaining({status:'wait'}));
    finish({status:'sent'}); await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    vi.mocked(readPage).mockReturnValue(obs('member',{draft:true}));
    expect(receive({type:'rename',agentId:'member',name:'角色'})).toHaveBeenCalledWith(expect.objectContaining({status:'wait'}));
  });
  it('释放旧监听器、观察器及心跳，仅保留一个接收端', async () => {
    await import('../src/extension/content');
    vi.resetModules(); await import('../src/extension/content');
    expect(handlers.size).toBe(1); expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(receive({ type: 'snapshot' })).toHaveBeenCalledExactlyOnceWith(obs());
  });
  it('重新注入时沿用正在发送的锁，避免两个处理器重复发送', async () => {
    let finish!: (value: { status: 'sent' }) => void;
    vi.mocked(sendText).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import('../src/extension/content');
    receive({ type: 'send', agentId: 'member', text: 'test', deliveryToken: 'token' });
    vi.resetModules(); await import('../src/extension/content');
    const respond = receive({ type: 'send', agentId: 'member', text: 'test', deliveryToken: 'token' });
    expect(respond).toHaveBeenCalledWith({ status: 'wait', reason: '另一条消息正在发送' });
    expect(sendText).toHaveBeenCalledTimes(1); finish({ status: 'sent' }); await Promise.resolve();
  });
  it('原生停止前校验目标会话，不能停止已切换到的其他角色', async () => {
    await import('../src/extension/content');
    const respond = receive({ type: 'stop', agentId: 'other' });
    expect(respond).toHaveBeenCalledWith({ stopped: false, reason: '当前页面不是目标会话，请重新核对' });
    expect(findButton).not.toHaveBeenCalled();
  });
});
