import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalConversationUrl, mergeConversations } from '../src/core/conversations';
import { discoverProject } from '../src/extension/discovery';
import { conversationOptions, currentProjectTab } from '../src/panel/conversations';
import { project, obs } from './helpers';

const base = project.url.replace('/project', '');
const slug = `${base}-sample-project`;
const link = (id: string, name: string, route = base) => `<a href="${route}/c/${id}" aria-label="${name}"><span data-thread-title="true">${name}</span></a>`;
beforeEach(() => {
  document.title = '项目经理'; document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function(this: Element) {
    return (this.closest('[hidden], [aria-hidden="true"]') ? [] : [{}]) as unknown as DOMRectList;
  });
});

describe('project discovery from native pages', () => {
  it('reads the Work project marker rather than the editable conversation title or a reply heading', () => {
    document.body.innerHTML = `<main><div><span role="img" aria-label="项目：${project.name}"></span><button>项目经理</button></div><div data-chatgpt-search-unit-key="fallback-turn-1:assistant"><h1>错误项目名</h1><span role="img" aria-label="项目：错误项目"></span></div></main>`;
    const data = discoverProject(document, `${slug}/c/lead`);
    expect(data.name).toBe(project.name); expect(data.projectUrl).toBe(project.url);
    expect(data.conversations).toEqual([{url:obs('lead').url,name:'项目经理'}]);
  });
  it('supports English markers and ignores hidden stale project icons', () => {
    document.body.innerHTML = '<main><span hidden role="img" aria-label="Project: Old project"></span><div><span role="img" aria-label="Project: Developer team"></span><button>Manager</button></div></main>';
    expect(discoverProject(document, obs().url).name).toBe('Developer team');
  });
  it('reads the actual project home heading while ignoring quoted headings', () => {
    document.body.innerHTML = `<main><div class="markdown"><h1>Quoted title</h1></div><h1>${project.name}</h1></main>`;
    expect(discoverProject(document, project.url).name).toBe(project.name);
  });
  it('does not turn a Work title or unrelated sidebar project into a missing project name', () => {
    document.body.innerHTML = '<aside><div role="list" aria-label="Other project 中的聊天"><a href="https://chatgpt.com/g/g-p-other/c/other">Other role</a></div></aside><main><h1>项目经理</h1><button>项目经理</button></main>';
    expect(discoverProject(document, obs('lead').url).name).toBeUndefined();
    expect(discoverProject(document, obs('lead').url).conversations).toEqual([{url:obs('lead').url,name:'项目经理'}]);
  });
  it('resolves a bare conversation URL through its matching native sidebar link and project group', () => {
    document.body.innerHTML = `<aside><div role="list" aria-label="${project.name} 中的聊天">${link('lead','项目经理')}${link('member','软件开发')}</div></aside><main><h1>项目经理</h1></main>`;
    const data = discoverProject(document, 'https://chatgpt.com/c/lead');
    expect(data.projectId).toBe(project.id); expect(data.name).toBe(project.name); expect(data.conversations).toHaveLength(2);
  });
  it('resolves native project breadcrumbs without using a quoted project URL', () => {
    document.body.innerHTML = `<main><header><a href="${project.url}">${project.name}</a></header><div data-message-author-role="assistant"><a href="https://chatgpt.com/g/g-p-other/project">Wrong project</a></div></main>`;
    expect(discoverProject(document,'https://chatgpt.com/c/lead').name).toBe(project.name);
    expect(discoverProject(document,'https://chatgpt.com/c/lead').projectId).toBe(project.id);
  });
  it('merges repeated native addresses and excludes reply citations, hidden links and other projects', () => {
    document.title = 'ChatGPT';
    document.body.innerHTML = `<aside>${link('member','软件开发')}${link('member','https://chatgpt.com/c/member',slug)}<a href="${base}/c/member?view=work#reply">${obs().url}</a>${link('other','营销推广')}<div hidden>${link('hidden','Hidden')}</div>${link('unrelated','Other role','https://chatgpt.com/g/g-p-other')}</aside><main><h1>${project.name}</h1><div data-message-author-role="user"><a href="${slug}/c/quoted">Quoted address</a></div><div data-chatgpt-search-unit-key="fallback-turn-1:user"><a href="${slug}/c/member">${slug}/c/member</a></div></main>`;
    expect(discoverProject(document,project.url).conversations).toEqual([{url:obs().url,name:'软件开发'},{url:obs('other').url,name:'营销推广'}]);
  });
  it('prefers semantic thread names over URL tooltips and retains actual native names', () => {
    document.body.innerHTML = `<main><h1>${project.name}</h1><a title="${obs().url}" href="${obs().url}"><span data-thread-title="true">Review · ChatGPT</span></a><a href="${obs('other').url}" aria-label="营销推广"></a></main>`;
    expect(discoverProject(document,project.url).conversations.map(conversation=>conversation.name)).toEqual(['Review · ChatGPT','营销推广']);
  });
  it('returns no cross-project discovery when membership cannot be established', () => {
    document.body.innerHTML = `<aside>${link('other','Other role')}</aside><main><div data-message-author-role="assistant"><a href="${project.url}">${project.name}</a></div></main>`;
    expect(discoverProject(document,'https://chatgpt.com/c/unknown')).toEqual({conversations:[]});
    expect(discoverProject(document,'https://example.com/g/g-p-project/c/lead')).toEqual({conversations:[]});
  });
});

describe('shared conversation address merging', () => {
  it('treats slug, project, bare, query, hash, encoded-ID and trailing-slash aliases as one conversation', () => {
    const urls=[obs().url,`${slug}/c/member?source=sidebar#reply`,'https://chatgpt.com/c/member/',`${base}/c/%6dember`];
    expect(urls.map(canonicalConversationUrl)).toEqual([obs().url,obs().url,'https://chatgpt.com/c/member',obs().url]);
    expect(mergeConversations(urls.map(url=>({url,name:url})))).toEqual([{url:obs().url,name:''}]);
  });
  it('selects the native name even when a duplicate tab or URL occurs later', () => {
    expect(mergeConversations([{url:obs().url,name:'软件开发',source:'native'},{url:`${slug}/c/member`,name:'Old title - ChatGPT',source:'tab'},{url:obs().url,name:obs().url,source:'native'}])).toEqual([{url:obs().url,name:'软件开发'}]);
  });
  it('uses a useful tab name if discovery supplies only an address, but keeps equally named distinct addresses', () => {
    expect(mergeConversations([{url:obs().url,name:obs().url,source:'native'},{url:`${slug}/c/member`,name:'Review – ChatGPT',source:'tab'},{url:obs('other').url,name:'Review',source:'native'}])).toEqual([{url:obs().url,name:'Review'},{url:obs('other').url,name:'Review'}]);
  });
  it('rejects temporary Work IDs and non-ChatGPT destinations', () => {
    expect(mergeConversations([{url:`${base}/c/local-chatgpt%3Auuid`,name:'Temporary'},{url:'https://example.com/c/member',name:'External'},{url:project.url,name:'Project'}])).toEqual([]);
  });
  it('merges discovered and open conversations for both option labels and selected display names', () => {
    const discovery={projectId:project.id,conversations:[{url:obs().url,name:'软件开发'},{url:`${slug}/c/member`,name:`${slug}/c/member`}]};
    const options=conversationOptions([{url:`${slug}/c/member?view=work`,title:'ChatGPT'},{url:obs('other').url,title:'营销推广 - ChatGPT'}],discovery,project.id);
    expect(options).toEqual([{url:obs().url,name:'软件开发'},{url:obs('other').url,name:'营销推广'}]);
    expect(options.find(option=>option.url===obs().url)?.name).toBe('软件开发');
    expect(conversationOptions([],discovery,'g-p-other')).toEqual([]);
  });
  it('supports an initial panel before any project has been discovered', () => {
    expect(conversationOptions([],undefined)).toEqual([]);
    expect(conversationOptions([{url:obs().url,title:'软件开发 - ChatGPT'}],undefined)).toEqual([{url:obs().url,name:'软件开发'}]);
  });
  it('reads the active bare Work conversation before an inactive project tab', () => {
    const active={id:2,url:'https://chatgpt.com/c/lead',active:true};
    expect(currentProjectTab([{id:1,url:project.url},active],project.id)).toBe(active);
    expect(currentProjectTab([{id:1,url:project.url}, {id:2,url:'https://example.com/c/lead',active:true}],project.id)?.id).toBe(1);
    expect(currentProjectTab([{id:0,url:'https://chatgpt.com/',active:true},{id:1,url:project.url}],project.id)?.id).toBe(1);
  });
});
