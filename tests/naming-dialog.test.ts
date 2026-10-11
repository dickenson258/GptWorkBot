import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renameConversation, savedConversationTitle } from '../src/extension/naming';
import { readPage } from '../src/extension/adapter';
import { project, obs } from './helpers';

const url = obs('member').url;
const name = '软件开发';
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype,'getClientRects').mockImplementation(function(this: Element) { return (this.closest('[hidden], [aria-hidden="true"]') ? [] : [{}]) as unknown as DOMRectList; });
  document.title = '旧标题';
  document.body.innerHTML = `<aside><div role="group"><a data-interactive-row-link="true" aria-current="page" href="${url}"><span data-thread-title>旧标题</span></a><div><button id="current-menu" aria-haspopup="menu" aria-label="聊天操作" aria-controls="rename-menu">菜单</button></div></div><div role="group"><a data-interactive-row-link="true" href="${obs('other').url}"><span data-thread-title>其他成员</span></a><button id="other-menu" aria-haspopup="menu" aria-label="聊天操作">其他菜单</button></div></aside><main><div><span role="img" aria-label="项目：测试项目"></span><span id="inline"><button>旧标题</button></span></div><textarea id="prompt-textarea" aria-label="使用 ChatGPT Work"></textarea></main>`;
});
afterEach(() => { vi.useRealTimers(); });
function dialogFlow(language: 'zh' | 'en' = 'zh', saveDelay = 350) {
  const submit = vi.fn();
  const inline = vi.fn(); document.querySelector<HTMLButtonElement>('#inline button')!.onclick = inline;
  const other = vi.fn(); document.querySelector<HTMLButtonElement>('#other-menu')!.onclick = other;
  const openDialog = vi.fn(() => {
    document.getElementById('rename-menu')!.remove();
    const dialog = document.createElement('div'); dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
    dialog.innerHTML = `<h2>${language === 'zh' ? '重命名聊天' : 'Rename chat'}</h2><form><input aria-label="${language === 'zh' ? '聊天标题' : 'Chat title'}" value="旧标题"><button type="button">${language === 'zh' ? '取消' : 'Cancel'}</button><button type="submit">${language === 'zh' ? '保存' : 'Save'}</button></form>`;
    const input = dialog.querySelector('input')!; let controlledName = '旧标题';
    input.oninput = () => { const value = input.value; setTimeout(() => { controlledName = value; },0); };
    dialog.querySelector('form')!.onsubmit = event => {
      event.preventDefault(); submit(controlledName);
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true;
      setTimeout(() => {
        document.querySelector('[aria-current="page"] [data-thread-title]')!.textContent = controlledName;
        document.querySelector('#inline button')!.textContent = controlledName;
        document.title = controlledName; dialog.remove();
      },saveDelay);
    };
    document.body.append(dialog);
  });
  const openMenu = vi.fn(() => {
    const menu = document.createElement('div'); menu.id = 'rename-menu'; menu.setAttribute('role','menu'); menu.setAttribute('aria-labelledby','current-menu');
    menu.innerHTML = `<div role="menuitem">${language === 'zh' ? '重命名' : 'Rename'}</div><div role="menuitem">${language === 'zh' ? '删除' : 'Delete'}</div>`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')!.onclick = openDialog; document.body.append(menu);
  });
  document.getElementById('current-menu')!.onclick = openMenu;
  return {openMenu,openDialog,submit,inline,other};
}
describe('native rename form and saved-title confirmation', () => {
  it.each(['zh','en'] as const)('uses the matching conversation menu and native Save form: %s', async language => {
    const actions = dialogFlow(language);
    const pending = renameConversation(document,url,'member',project.id,name);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({status:'synced',confirmation:{url,title:name}});
    expect(actions.openMenu).toHaveBeenCalledOnce(); expect(actions.openDialog).toHaveBeenCalledOnce(); expect(actions.submit).toHaveBeenCalledExactlyOnceWith(name);
    expect(actions.inline).not.toHaveBeenCalled(); expect(actions.other).not.toHaveBeenCalled();
    expect(savedConversationTitle(document,url)).toBe(name); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('does not report success while the native Save request is still pending', async () => {
    const actions = dialogFlow('zh',1000); const finished = vi.fn();
    const pending = renameConversation(document,url,'member',project.id,name); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(700); expect(finished).not.toHaveBeenCalled(); expect(savedConversationTitle(document,url)).toBe('旧标题');
    await vi.advanceTimersByTimeAsync(600); expect((await pending).status).toBe('synced'); expect(actions.submit).toHaveBeenCalledOnce();
  });
  it('opens a Radix conversation menu through its keyboard handler without relying on click', async () => {
    const actions = dialogFlow(); const trigger = document.getElementById('current-menu')!;
    trigger.id = 'radix-_r_hd_'; trigger.onclick = null;
    trigger.onkeydown = event => { if (event.key === 'ArrowDown') actions.openMenu(); };
    const pending = renameConversation(document,url,'member',project.id,name);
    await vi.runAllTimersAsync(); expect((await pending).status).toBe('synced');
    expect(actions.openMenu).toHaveBeenCalledOnce(); expect(actions.submit).toHaveBeenCalledExactlyOnceWith(name);
  });
  it('confirms a saved sidebar title even if a stale inline editor or page title remains', async () => {
    document.querySelector('#inline')!.innerHTML = '<input aria-label="聊天标题" value="用户正在编辑的标题">';
    document.querySelector('[aria-current="page"] [data-thread-title]')!.textContent = name;
    const menu = vi.fn(); document.getElementById('current-menu')!.onclick = menu;
    expect(await renameConversation(document,url,'member',project.id,name)).toEqual({status:'synced',confirmation:{url,title:name}});
    expect(readPage(document,url).title).toBe(name); expect(menu).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('#inline input')!.value).toBe('用户正在编辑的标题');
  });
  it('does not claim another conversation or a quoted address as the saved title', () => {
    document.querySelector('[aria-current="page"]')!.remove();
    document.querySelector('main')!.insertAdjacentHTML('beforeend',`<div data-message-author-role="assistant"><a data-interactive-row-link="true" aria-current="page" href="${url}"><span data-thread-title>${name}</span></a></div>`);
    expect(savedConversationTitle(document,url)).toBe('旧标题');
  });
  it('does not take over a native dialog already opened by the user', async () => {
    const actions = dialogFlow(); document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-modal="true"><h2>重命名聊天</h2><input aria-label="聊天标题" value="用户草稿"></div>');
    expect((await renameConversation(document,url,'member',project.id,name)).status).toBe('wait');
    expect(actions.openMenu).not.toHaveBeenCalled(); expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe('用户草稿');
  });
  it('waits at most 15 seconds and does not submit a slow Save request again', async () => {
    const actions = dialogFlow('zh',20000); const finished = vi.fn();
    const pending = renameConversation(document,url,'member',project.id,name); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(14900); expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100); expect((await pending).status).toBe('wait'); expect(actions.submit).toHaveBeenCalledOnce();
  });
  it('checks the form after controlled-state updates and preserves a user modification', async () => {
    const actions = dialogFlow(); const pending = renameConversation(document,url,'member',project.id,name);
    await vi.advanceTimersByTimeAsync(0);
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!; input.value = '用户修改';
    await vi.runAllTimersAsync(); expect((await pending).status).toBe('wait'); expect(actions.submit).not.toHaveBeenCalled(); expect(input.value).toBe('用户修改');
  });
});
