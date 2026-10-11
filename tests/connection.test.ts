import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { obs, team } from './helpers';
import { uid } from '../src/core/types';
const disconnected = () => new Error('Could not establish connection. Receiving end does not exist.');
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', sendMessage: vi.fn() },
    tabs: { get: vi.fn(async () => ({ id: 10, url: obs().url })), sendMessage: vi.fn() },
    scripting: { executeScript: vi.fn(async () => []) }
  });
});
afterEach(() => { vi.useRealTimers(); });
describe('等待标签页与输入区就绪', () => {
  it('仅有 pendingUrl 时等待加载完成，输入区稍晚就绪后才返回', async () => {
    vi.useFakeTimers();
    const tab = { id: 10, url: '', pendingUrl: obs().url, status: 'loading' } as chrome.tabs.Tab;
    vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ ...tab }));
    let ready = false;
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => obs('member', { ready }));
    const { waitForPageReady } = await import('../src/extension/connection');
    const finished = vi.fn(); const pending = waitForPageReady(10, 'member'); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(5000); expect(chrome.tabs.sendMessage).not.toHaveBeenCalled(); expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    tab.url = obs().url; tab.pendingUrl = undefined; tab.status = 'complete';
    await vi.advanceTimersByTimeAsync(500); expect(finished).not.toHaveBeenCalled();
    ready = true; await vi.advanceTimersByTimeAsync(250); expect((await pending).ready).toBe(true);
  });
  it('完整加载且就绪的页面立即返回，不增加固定等待', async () => {
    vi.useFakeTimers(); vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(obs());
    const { waitForPageReady } = await import('../src/extension/connection');
    const start = Date.now(); expect(await waitForPageReady(10, 'member')).toEqual(obs()); expect(Date.now()).toBe(start);
  });
  it('加载超过 15 秒不读取或发送，返回仍需等待的原因', async () => {
    vi.useFakeTimers(); vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 10, url: obs().url, status: 'loading' } as chrome.tabs.Tab);
    const { waitForPageReady, PageLoadingTimeout } = await import('../src/extension/connection');
    const pending = waitForPageReady(10, 'member').catch(error => error);
    await vi.advanceTimersByTimeAsync(15_000); expect(await pending).toBeInstanceOf(PageLoadingTimeout); expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('加载期间取消或页面跳到其他会话时中止等待', async () => {
    const { waitForPageReady } = await import('../src/extension/connection');
    await expect(waitForPageReady(10, 'member', { shouldContinue: async () => false })).rejects.toThrow('暂停或取消');
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 10, url: obs('other').url } as chrome.tabs.Tab);
    await expect(waitForPageReady(10, 'member')).rejects.toThrow('地址已变化'); expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
describe('恢复页面连接', () => {
  it('缺少接收端时自动注入，后续读取复用连接', async () => {
    const page = obs();
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(disconnected()).mockResolvedValue(page);
    const { readTab } = await import('../src/extension/connection');
    expect(await readTab(10, 'snapshot')).toEqual(page);
    await readTab(10, 'discover');
    expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 10 }, files: ['content.js'] });
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.map(([, m]) => (m as { type: string }).type)).toEqual(['snapshot', 'snapshot', 'discover']);
  });
  it('同时恢复同一标签页只注入一次', async () => {
    let connected = false;
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => { if (!connected) throw disconnected(); return obs(); });
    vi.mocked(chrome.scripting.executeScript).mockImplementation(async () => { await Promise.resolve(); connected = true; return []; });
    const { readTab } = await import('../src/extension/connection');
    await Promise.all([readTab(10, 'snapshot'), readTab(10, 'discover')]);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
  it('外站、关闭页及非连接错误不注入内容脚本', async () => {
    const { readTab } = await import('../src/extension/connection');
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 10, url: 'https://example.com' } as chrome.tabs.Tab);
    await expect(readTab(10, 'snapshot')).rejects.toThrow('已切换');
    vi.mocked(chrome.tabs.get).mockRejectedValueOnce(new Error('No tab with id'));
    await expect(readTab(10, 'snapshot')).rejects.toThrow('No tab');
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error('其他错误'));
    await expect(readTab(10, 'snapshot')).rejects.toThrow('其他错误');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
describe('侧栏后台恢复', () => {
  it('创建角色的响应丢失可用同一请求标识重试，不重新生成创建命令', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(disconnected()).mockResolvedValue({ store: team(), tabs: [] });
    const { command } = await import('../src/panel/transport');
    const input = { type: 'create_agent' as const, requestId: uid(), projectId: team().project!.id, name: '检查员', responsibilities: '检查' };
    await command(input);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls).toEqual([[{ type: 'command', command: input }], [{ type: 'command', command: input }]]);
  });
  it('后台短暂断连可自动恢复解绑', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(disconnected()).mockResolvedValue({ store: team(), tabs: [] });
    const { command } = await import('../src/panel/transport');
    await command({ type: 'unbind', id: 'member' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('后台持续断连给出可操作中文提示，解绑重试次数有上限', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(disconnected());
    const { command } = await import('../src/panel/transport');
    await expect(command({ type: 'unbind', id: 'member' })).rejects.toThrow('重新加载 GptWorkBot');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
  });
  it('其他写操作发送失败不重试，业务错误保持原文', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(disconnected()).mockResolvedValueOnce({ error: '请先绑定主管会话' });
    const { command } = await import('../src/panel/transport');
    await expect(command({ type: 'initialize' })).rejects.toThrow('插件后台');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    await expect(command({ type: 'initialize' })).rejects.toThrow('请先绑定主管会话');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});
