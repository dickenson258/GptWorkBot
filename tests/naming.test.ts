import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeConversationTitle, renameConversation } from '../src/extension/naming';
import { project, obs } from './helpers';
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function(this: Element) { return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList; });
  document.body.innerHTML = '<aside><button>旧名称</button></aside><main><div id="header"><span role="img" aria-label="项目：测试项目"></span><span id="title"><button>旧名称</button></span></div><button>旧名称</button><textarea placeholder="输入">用户草稿</textarea></main>';
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const url = obs('member').url;
function editor(save = true) {
  const open = vi.fn(() => {
    const input = document.createElement('input'); input.setAttribute('aria-label', '聊天标题'); input.value = '旧名称';
    input.onkeydown = e => { if (e.key === 'Enter' && save) { const button = document.createElement('button'); button.textContent = input.value; input.replaceWith(button); } };
    document.querySelector('#title button')!.replaceWith(input);
  });
  document.querySelector<HTMLButtonElement>('#title button')!.onclick = open; return open;
}
function blurEditor(enterBlurs: boolean, saveDelay = 250) {
  const submitted = vi.fn();
  const open = vi.fn(() => {
    const input = document.createElement('input'); input.setAttribute('aria-label', '聊天标题'); input.value = '旧名称';
    input.onkeydown = e => { if (e.key === 'Enter') { submitted(document.activeElement === input); if (enterBlurs) input.blur(); } };
    input.onblur = () => {
      const name = input.value;
      const button = document.createElement('button'); button.textContent = '旧名称'; input.replaceWith(button);
      setTimeout(() => { button.textContent = name; document.title = name; }, saveDelay);
    };
    document.querySelector('#title button')!.replaceWith(input);
  });
  document.querySelector<HTMLButtonElement>('#title button')!.onclick = open;
  return {open, submitted};
}
async function rename(name = '软件开发') { const pending = renameConversation(document, url, 'member', project.id, name); await vi.runAllTimersAsync(); return pending; }
describe('原生 Work 会话名称', () => {
  it('只编辑当前会话原生标题，保存角色名称，不修改消息或草稿', async () => {
    const open = editor(); expect((await rename()).status).toBe('synced'); expect(open).toHaveBeenCalledOnce();
    expect(nativeConversationTitle(document)).toBe('软件开发'); expect(document.querySelector('aside button')!.textContent).toBe('旧名称'); expect(document.querySelector('textarea')!.value).toBe('用户草稿');
  });
  it('已同步的标题不再点击或编辑', async () => {
    document.querySelector('#title button')!.textContent = '软件开发'; const open = editor();
    expect((await rename()).status).toBe('synced'); expect(open).not.toHaveBeenCalled();
  });
  it.each(['conversation', 'project', 'local'])('拒绝 %s 地址错误，不触碰任何标题', async variant => {
    const open = editor(); const result = await renameConversation(document, variant === 'local' ? obs('local-chatgpt%3Auuid').url : url, variant === 'conversation' ? 'other' : 'member', variant === 'project' ? 'g-p-other' : project.id, '软件开发');
    expect(result.status).toBe('wait'); expect(open).not.toHaveBeenCalled();
  });
  it.each(['用户编辑的名称','软件开发'])('用户正在编辑标题时不覆盖或提交：%s', async value => {
    document.querySelector('#title')!.innerHTML = `<input aria-label="聊天标题" value="${value}">`;
    const input = document.querySelector<HTMLInputElement>('input')!; input.focus();
    const key = vi.fn(); const blur = vi.fn(); input.onkeydown = key; input.onblur = blur;
    const result = await rename();
    expect(result).toMatchObject({status:'wait',reason:'原生标题正在编辑，请先在会话中保存或取消，再重试同步名称'});
    expect(input.value).toBe(value); expect(document.activeElement).toBe(input); expect(key).not.toHaveBeenCalled(); expect(blur).not.toHaveBeenCalled();
  });
  it.each([true,false])('聚焦后提交，等待失焦保存的原生标题，Enter 失焦处理：%s', async enterBlurs => {
    const {open,submitted} = blurEditor(enterBlurs);
    const finished = vi.fn(); const pending = renameConversation(document,url,'member',project.id,'软件开发'); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(200); expect(finished).not.toHaveBeenCalled(); expect(nativeConversationTitle(document)).toBe('旧名称');
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe('synced'); expect(submitted).toHaveBeenCalledExactlyOnceWith(true); expect(open).toHaveBeenCalledOnce();
    expect(nativeConversationTitle(document)).toBe('软件开发'); expect(document.querySelector('input[aria-label="聊天标题"]')).toBeNull();
  });
  it('忽略隐藏标题编辑框与回复中的仿造项目图标及编辑框', async () => {
    document.querySelector('main')!.insertAdjacentHTML('beforeend','<div hidden><input aria-label="聊天标题" value="隐藏的旧编辑框"></div><div data-chatgpt-search-unit-key="fallback-turn-1:assistant"><span role="img" aria-label="项目：伪造项目"></span><button>错误入口</button><input aria-label="聊天标题" value="引用文本"></div>');
    const open = editor(); expect((await rename()).status).toBe('synced'); expect(open).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>('[hidden] input')!.value).toBe('隐藏的旧编辑框');
    expect(document.querySelector<HTMLInputElement>('[data-chatgpt-search-unit-key] input')!.value).toBe('引用文本');
  });
  it('等待新建 Work 标题区域加载后再同步，编辑只打开一次', async () => {
    const header = document.querySelector('#header')!; header.remove();
    let open: ReturnType<typeof editor>;
    setTimeout(() => { document.querySelector('main')!.prepend(header); open = editor(); },1200);
    const pending = renameConversation(document,url,'member',project.id,'软件开发');
    await vi.advanceTimersByTimeAsync(1100); expect(document.querySelector('#header')).toBeNull();
    await vi.advanceTimersByTimeAsync(200); expect((await pending).status).toBe('synced'); expect(open!).toHaveBeenCalledOnce();
  });
  it('入口等待和保存确认共用最长 15 秒，不能分阶段延长', async () => {
    const header = document.querySelector('#header')!; header.remove();
    setTimeout(() => { document.querySelector('main')!.prepend(header); blurEditor(true,3000); },14000);
    const finished = vi.fn(); const pending = renameConversation(document,url,'member',project.id,'软件开发'); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(14900); expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100); expect((await pending).status).toBe('wait'); expect(finished).toHaveBeenCalledOnce();
  });
  it('入口不唯一时不点击其他按钮或打开多个编辑框', async () => {
    const open = editor(); const unrelated = document.createElement('button'); unrelated.textContent = '其他按钮'; const click = vi.fn(); unrelated.onclick = click;
    document.querySelector('#header')!.append(unrelated);
    const result = await rename(); expect(result).toMatchObject({status:'wait',reason:'未找到唯一且可用的原生标题入口，请打开会话核对后重试同步名称'});
    expect(open).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });
  it('标题框不能获得焦点时不写入或提交名称', async () => {
    const open = editor(); vi.spyOn(HTMLInputElement.prototype,'focus').mockImplementation(() => {});
    const result = await rename(); expect(result.status).toBe('wait'); expect(result.reason).toContain('未获得焦点');
    expect(open).toHaveBeenCalledOnce(); expect(document.querySelector<HTMLInputElement>('#title input')!.value).toBe('旧名称');
  });
  it('保存未确认时最多等待 15 秒，只提交一次，不把尝试当成功', async () => {
    const open = editor(false); const inputEvent = vi.fn(); document.addEventListener('keydown', inputEvent);
    const finished = vi.fn(); const pending = renameConversation(document, url, 'member', project.id, '软件开发'); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(14_900); expect(finished).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe('wait'); expect(open).toHaveBeenCalledOnce(); expect(inputEvent).toHaveBeenCalledOnce(); document.removeEventListener('keydown', inputEvent);
  });
});
