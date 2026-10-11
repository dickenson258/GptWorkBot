import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composer, composerText, readPage, sendText, prepareWorkConversation } from '../src/extension/adapter';
import { parseEnvelope } from '../src/core/protocol';
import { draftFingerprint, normalizeDraft } from '../src/core/delivery';
import { project } from './helpers';
const url = `${project.url.replace('/project','')}/c/member`;
beforeEach(() => { document.body.innerHTML = ''; vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function(this: Element) { return (this.closest('[hidden],.hidden') ? [] : [{}]) as unknown as DOMRectList; }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const prompt = '[WT-DELIVERY:token]\n第一行\n\n第三行';
function receipt(text = prompt) { const m = document.createElement('div'); m.setAttribute('data-message-author-role', 'user'); m.textContent = text; document.body.append(m); }
async function timedSend(text = prompt) { const pending = sendText(document, url, 'member', text, 'token'); await vi.runAllTimersAsync(); return pending; }
describe('真实 Work DOM 适配', () => {
  it('项目新聊天按钮尚未响应时多次准备也只点击一次', async () => {
    document.body.innerHTML='<main><button>新聊天</button></main>'; const click=vi.fn(); document.querySelector('button')!.onclick=click;
    const actions=new Set<string>(); for(let i=0;i<60;i++) await prepareWorkConversation(document,project.url,actions);
    expect(click).toHaveBeenCalledOnce();
  });
  it('创建页进入本地 Work 地址后能发送首次职责，但不能把本地 ID 用于普通派发', async () => {
    vi.useFakeTimers(); document.body.innerHTML='<form><div contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div><button type="button" aria-label="发送"></button></form>';
    // Existing own draft exercises the send path without replacing the native editor.
    const editor=composer(document)!; editor.textContent=prompt; const click=vi.fn(()=>receipt()); document.querySelector('button')!.onclick=click;
    const local=`${project.url.replace('/project','')}/c/local-chatgpt%3Auuid`;
    expect((await sendText(document,local,'local-chatgpt',prompt,'token')).status).toBe('wait');
    const pending=sendText(document,local,`project:${project.id}`,prompt,'token'); await vi.runAllTimersAsync();
    expect((await pending).status).toBe('sent'); expect(click).toHaveBeenCalledOnce();
  });
  it('无 pre 代码组件恢复协议，排除思考内容', () => {
    document.body.innerHTML = `<div data-talvt-turn-state="complete" data-content-search-turn-key="fallback-turn-3"><div data-chatgpt-search-unit-key="fallback-turn-3:0:user" data-chatgpt-search-message-ids="u">请求</div><div data-chatgpt-search-unit-key="fallback-turn-3:1:assistant">思考内容</div><div data-local-conversation-final-assistant="true"><div data-chatgpt-search-unit-key="fallback-turn-3:2:assistant" data-chatgpt-search-message-ids="a a"><h4>ChatGPT 说：</h4><div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div>work-team</div><button>复制</button></div><div><code>{"version":2,"projectId":"${project.id}","taskId":"t","attempt":1,"status":"completed","summary":"通过"}</code></div></div></div></div></div><div contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div>`;
    const page = readPage(document, url); expect(page.messages).toHaveLength(2); expect(page.messages[1].text).toContain('```work-team'); expect(parseEnvelope(page.messages[1].text, false)).toHaveProperty('summary','通过'); expect(page.turnIndex).toBe(3); expect(page.workMode).toBe('work');
    expect(page.messages.map(m=>({turnId:m.turnId,turnComplete:m.turnComplete}))).toEqual([{turnId:'fallback-turn-3',turnComplete:true},{turnId:'fallback-turn-3',turnComplete:true}]); expect(page.running).toBe(false);
  });
  it('隐藏旧任务的运行标志不会让已完成会话显示执行中', () => {
    document.body.innerHTML='<div hidden><div data-work-status="running"></div><div data-testid="work-task-running"></div><div data-testid="agent-turn-in-progress"></div><div data-talvt-turn-state="running"></div></div><div data-talvt-turn-state="complete"></div><div contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div>';
    expect(readPage(document,url).running).toBe(false);
    document.querySelector('[data-testid="work-task-running"]')!.parentElement!.removeAttribute('hidden'); expect(readPage(document,url).running).toBe(true);
  });
  it('同页各轮次完成状态独立，流式回复不被当成已完成', () => {
    document.body.innerHTML='<div data-talvt-turn-state="complete"><div data-chatgpt-search-unit-key="fallback-turn-1:0:user">连接</div><div data-local-conversation-final-assistant="true"><div data-chatgpt-search-unit-key="fallback-turn-1:1:assistant">协作已就绪</div></div></div><div data-talvt-turn-state="streaming"><div data-chatgpt-search-unit-key="fallback-turn-2:0:user">任务</div><div data-local-conversation-final-assistant="true"><div data-chatgpt-search-unit-key="fallback-turn-2:1:assistant">正在生成</div></div></div>';
    const page=readPage(document,url); expect(page.running).toBe(true); expect(page.messages.map(m=>m.turnComplete)).toEqual([true,true,false,false]); expect(page.messages.map(m=>m.turnId)).toEqual(['fallback-turn-1','fallback-turn-1','fallback-turn-2','fallback-turn-2']);
  });
  it('跳过隐藏旧输入框及停止按钮', () => { document.body.innerHTML = '<div class="hidden"><div contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work">旧内容</div><button aria-label="停止"></button></div><div id="new" contenteditable="true" role="textbox"></div>'; expect(composer(document)?.id).toBe('new'); expect(readPage(document,url).running).toBe(false); });
  it('识别真实停止按钮', () => { document.body.innerHTML = '<button aria-label="停止"></button>'; expect(readPage(document,url).running).toBe(true); });
  it('软件开发原生答复连接中断时优先提示交互，已有回执仍可读取', () => {
    document.body.innerHTML='<main><div data-talvt-turn-state="complete"><div data-chatgpt-search-unit-key="fallback-turn-2:0:user">[WT-DELIVERY:token]</div></div><div role="status">连接已中断，正在等待完整答复</div><div contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div><button aria-label="停止"></button></main>';
    const page=readPage(document,url); expect(page.running).toBe(true); expect(page.interaction).toContain('连接已中断'); expect(page.messages[0].text).toContain('[WT-DELIVERY:token]'); expect(page.messages).toHaveLength(1);
  });
  it('忽略隐藏或侧边栏其他会话的连接中断提示，恢复后提示消失', () => {
    document.body.innerHTML='<aside><div role="status">连接已中断，正在等待完整答复</div></aside><main><div hidden role="status">连接已中断，正在等待完整答复</div><div role="status" id="live">连接已中断，正在等待完整答复</div><div contenteditable="true" role="textbox"></div></main>';
    expect(readPage(document,url).interaction).toContain('连接已中断'); document.getElementById('live')!.textContent='回答已完成'; expect(readPage(document,url).interaction).toBeUndefined();
  });
  it('普通消息引用连接中断不会被当成原生提示', () => {
    document.body.innerHTML='<main><div data-message-author-role="assistant">连接已中断，正在等待完整答复</div><div role="status">回答已完成</div></main>'; expect(readPage(document,url).interaction).toBeUndefined();
  });
  it('可见额度提示优先于隐藏旧错误', () => {
    document.body.innerHTML='<div hidden role="alert">旧错误</div><main><div role="alert">已达到额度上限</div></main>'; expect(readPage(document,url).interaction).toBe('已达到额度上限');
  });
  it('保护用户草稿', async () => { document.body.innerHTML = '<textarea placeholder="输入">我的草稿</textarea><button aria-label="发送"></button>'; const click = vi.fn(); document.querySelector('button')!.onclick = click; expect((await sendText(document,url,'member','测试','token')).status).toBe('wait'); expect(document.querySelector('textarea')!.value).toBe('我的草稿'); expect(click).not.toHaveBeenCalled(); });
  it('拒绝目标 URL 错配和非 Work 创建', async () => { document.body.innerHTML = '<button aria-pressed="true">聊天</button><textarea placeholder="输入"></textarea>'; expect((await sendText(document,url,'other','test','token')).status).toBe('wait'); expect((await sendText(document,project.url,`project:${project.id}`,'test','token')).status).toBe('wait'); });
  it('已有回执不重复发送', async () => { document.body.innerHTML = '<div data-message-author-role="user" data-message-id="u">[WT-DELIVERY:token]</div><textarea placeholder="输入"></textarea><button aria-label="发送"></button>'; const click = vi.fn(); document.querySelector('button')!.onclick = click; expect((await sendText(document,url,'member','test','token')).status).toBe('sent'); expect(click).not.toHaveBeenCalled(); });
  it('实际 DOM 填入、点击及回执核对', async () => { document.body.innerHTML = '<textarea placeholder="输入"></textarea><button aria-label="发送"></button>'; document.querySelector('button')!.onclick = () => { const m = document.createElement('div'); m.setAttribute('data-message-author-role','user'); m.textContent = document.querySelector('textarea')!.value; document.body.append(m); }; expect((await sendText(document,url,'member','[WT-DELIVERY:token]\n任务','token')).status).toBe('sent'); });
  it('点击无回执返回不确定，不重复点击', async () => { vi.useFakeTimers(); document.body.innerHTML = '<textarea placeholder="输入"></textarea><button aria-label="发送"></button>'; const click = vi.fn(); document.querySelector('button')!.onclick = click; const promise = sendText(document,url,'member','任务','token'); await vi.runAllTimersAsync(); expect((await promise).status).toBe('uncertain'); expect(click).toHaveBeenCalledTimes(1); });
  it('项目已有输入区时不点击全局新聊天', async () => { document.body.innerHTML = '<main><button id="wrong">新聊天</button><button aria-pressed="true">工作</button><div contenteditable="true" role="textbox"></div></main>'; const click = vi.fn(); document.querySelector<HTMLButtonElement>('#wrong')!.onclick = click; expect((await prepareWorkConversation(document,project.url)).ready).toBe(true); expect(click).not.toHaveBeenCalled(); });
  it('发送按钮超过 5 秒才启用时仍等待就绪，只点击一次', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><textarea placeholder="输入"></textarea></form>';
    const click = vi.fn(() => receipt());
    document.querySelector('textarea')!.oninput = () => { setTimeout(() => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', '发送'); button.disabled = true;
      button.onclick = click; document.querySelector('form')!.append(button); setTimeout(() => button.disabled = false, 10_700);
    }, 400); };
    expect((await timedSend()).status).toBe('sent'); expect(click).toHaveBeenCalledTimes(1);
  });
  it('按稳定属性找到本表单的发送按钮，忽略其他表单的发送', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><button id="wrong" aria-label="发送">分享</button></form><form><textarea placeholder="输入"></textarea><button type="button" data-testid="send-button" aria-label="提交给助手"></button></form>';
    const wrong = vi.fn(); const correct = vi.fn(() => receipt());
    document.querySelector<HTMLButtonElement>('#wrong')!.onclick = wrong; document.querySelector<HTMLButtonElement>('[data-testid]')!.onclick = correct;
    expect((await timedSend()).status).toBe('sent'); expect(wrong).not.toHaveBeenCalled(); expect(correct).toHaveBeenCalledTimes(1);
  });
  it.each(['aria-disabled', 'aria-busy'])('%s 控件仍不可点击，超时保留完整草稿', async attribute => {
    vi.useFakeTimers(); document.body.innerHTML = `<form><textarea placeholder="输入"></textarea><button ${attribute}="true" aria-label="发送"></button></form>`;
    const click = vi.fn(); document.querySelector('button')!.onclick = click;
    const finished = vi.fn();
    const pending = sendText(document, url, 'member', prompt, 'token'); void pending.then(finished);
    await vi.advanceTimersByTimeAsync(14_900); expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await pending; expect(outcome.status).toBe('wait'); expect(outcome.reason).toContain('重试发送');
    expect(click).not.toHaveBeenCalled(); expect(document.querySelector('textarea')!.value).toBe(prompt);
  });
  it('多段 ProseMirror 草稿保留空行，重试时不重新插入', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><div contenteditable="true" role="textbox"><p>[WT-DELIVERY:token]</p><p>第一行</p><p><br class="ProseMirror-trailingBreak"></p><p>第三行</p></div><button type="button" aria-label="发送"></button></form>';
    const editor = composer(document)!; const input = vi.fn(); editor.addEventListener('input', input);
    const click = vi.fn(() => receipt()); document.querySelector('button')!.onclick = click;
    expect(normalizeDraft(composerText(editor))).toBe(prompt); expect(readPage(document, url).draftFingerprint).toBe(draftFingerprint(prompt));
    expect((await timedSend()).status).toBe('sent'); expect(input).not.toHaveBeenCalled(); expect(click).toHaveBeenCalledTimes(1);
  });
  it('新填入的多段编辑器内容不会被 textContent 丢失换行而误判修改', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><div contenteditable="true" role="textbox"></div><button type="button" aria-label="发送"></button></form>';
    const editor = composer(document)!;
    const insert = vi.fn((_command: string, _ui: boolean, text: string) => { for (const line of text.split('\n')) { const p = document.createElement('p'); p.textContent = line; editor.append(p); } return true; });
    Object.defineProperty(document, 'execCommand', { value: insert, configurable: true });
    document.querySelector('button')!.onclick = () => receipt();
    try { expect((await timedSend()).status).toBe('sent'); expect(insert).toHaveBeenCalledOnce(); }
    finally { delete (document as unknown as { execCommand?: unknown }).execCommand; }
  });
  it('浏览器编辑产生的 div 与 br 换行也保留空段', () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox">[WT-DELIVERY:token]<div>第一行</div><div><br></div><div>第三行</div></div>';
    expect(normalizeDraft(composerText(composer(document)!))).toBe(prompt);
  });
  it('用户修改过同一标识的草稿仍受保护', async () => {
    document.body.innerHTML = '<textarea placeholder="输入"></textarea><button aria-label="发送"></button>';
    const box = document.querySelector('textarea')!; box.value = prompt + '用户补充'; const click = vi.fn(); document.querySelector('button')!.onclick = click;
    expect((await sendText(document, url, 'member', prompt, 'token')).status).toBe('wait'); expect(box.value).toBe(prompt + '用户补充'); expect(click).not.toHaveBeenCalled();
  });
  it.each(['edited', 'running', 'replaced', 'interaction'])('等待发送期间 %s 会中止，保留内容而不误发送', async change => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><textarea placeholder="输入"></textarea><button disabled aria-label="发送"></button></form>';
    const button = document.querySelector('button')!; const click = vi.fn(); button.onclick = click;
    setTimeout(() => {
      if (change === 'edited') document.querySelector('textarea')!.value += '修改';
      if (change === 'running') { const stop = document.createElement('button'); stop.setAttribute('aria-label', '停止'); document.body.append(stop); }
      if (change === 'replaced') document.querySelector('textarea')!.replaceWith(document.createElement('textarea'));
      if (change === 'interaction') { const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = '额度上限'; document.body.append(alert); }
      button.disabled = false;
    }, 400);
    expect((await timedSend()).status).toBe('wait'); expect(click).not.toHaveBeenCalled();
  });
  it('用户手动发送时读取回执，不再点击发送', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<textarea placeholder="输入"></textarea><button disabled aria-label="发送"></button>';
    const click = vi.fn(); document.querySelector('button')!.onclick = click; setTimeout(() => receipt(), 400);
    expect((await timedSend()).status).toBe('sent'); expect(click).not.toHaveBeenCalled();
  });
  it('发送按钮有歧义时等待，不点击无关操作', async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<form><textarea placeholder="输入"></textarea><button aria-label="发送"></button><button aria-label="发送消息"></button></form>';
    const click = vi.fn(); document.querySelectorAll('button').forEach(b => b.onclick = click);
    expect((await timedSend()).status).toBe('wait'); expect(click).not.toHaveBeenCalled();
  });
});
