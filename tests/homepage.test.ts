import {readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

// Use the already-installed test runtime with a narrow DOM contract.
const {JSDOM}=createRequire(import.meta.url)('jsdom') as {JSDOM:new(html:string,options?:{url?:string;runScripts?:string})=>{window:Window & typeof globalThis}};

const html = readFileSync('website/index.html','utf8');
const language = readFileSync('website/language.js','utf8');
const content = readFileSync('website/content.js','utf8');
function page({languages=['en-US'], saved, url='https://example.com/GptWorkBot/', blocked=false}: {languages?:string[];saved?:string;url?:string;blocked?:boolean}={}) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only'});
  Object.defineProperty(dom.window.navigator,'languages',{value:languages,configurable:true});
  Object.defineProperty(dom.window.navigator,'language',{value:languages[0] || '',configurable:true});
  if(saved) dom.window.localStorage.setItem('gptworkbot-homepage-language',saved);
  if(blocked) Object.defineProperty(dom.window,'localStorage',{get(){throw new Error('Storage blocked');}});
  dom.window.eval(language); dom.window.eval(content);
  return dom;
}

describe('GitHub Pages language and publication',()=>{
  it.each([
    [['zh-CN'],'zh-CN'],[['zh-TW'],'zh-CN'],[['zh-HK'],'zh-CN'],[['en-US'],'en'],[['fr-FR'],'en'],[['en-US','zh-CN'],'en'],[[],'en']
  ])('uses the first browser preference with a safe fallback: %j',(languages,expected)=>{
    const dom=page({languages:languages as string[]});expect(dom.window.document.documentElement.lang).toBe(expected);dom.window.close();
  });
  it('prioritizes explicit language links over saved choice, then browser; ignores invalid choices',()=>{
    for(const [url,saved,languages,expected] of [
      ['https://example.com/GptWorkBot/?lang=zh','en',['en-US'],'zh-CN'],
      ['https://example.com/GptWorkBot/?lang=en','zh',['zh-CN'],'en'],
      ['https://example.com/GptWorkBot/?lang=unknown','en',['zh-CN'],'en'],
      ['https://example.com/GptWorkBot/','unknown',['zh-CN'],'zh-CN']
    ] as const){const dom=page({url,saved,languages:[...languages]});expect(dom.window.document.documentElement.lang).toBe(expected);dom.window.close();}
  });
  it('switches all text, images, alt text and documentation links, and remembers the manual choice on another visit',()=>{
    const dom=page({languages:['zh-CN']});const doc=dom.window.document;
    expect(doc.querySelector('h1')?.textContent).toBe('让项目成员一起工作。');
    (doc.querySelector('[data-language="en"]') as HTMLAnchorElement).click();
    expect(doc.documentElement.lang).toBe('en');expect(doc.title).toContain('bring your Work');
    expect(doc.querySelector('[data-image="dependencies"]')?.getAttribute('src')).toContain('-en-');
    expect(doc.querySelector('[data-image="recovery"]')?.getAttribute('alt')).toContain('sample data');
    expect(doc.querySelector('[data-docs]')?.getAttribute('href')).toContain('development.en.md');
    expect(doc.querySelector('[data-readme]')?.getAttribute('href')).toContain('#english');
    expect(doc.querySelector('[data-release]')?.getAttribute('href')).toContain(`/v${JSON.parse(readFileSync('package.json','utf8')).version}`);
    expect(dom.window.location.search).toBe('?lang=en');
    const next=page({languages:['zh-CN'],saved:dom.window.localStorage.getItem('gptworkbot-homepage-language')!});
    expect(next.window.document.documentElement.lang).toBe('en');dom.window.close();next.window.close();
  });
  it('switches with blocked storage and recovers automatic browser-language selection without changing the hash',()=>{
    const dom=page({languages:['zh-CN'],url:'https://example.com/GptWorkBot/#start',blocked:true});const doc=dom.window.document;
    (doc.querySelector('[data-language="en"]') as HTMLAnchorElement).click();expect(doc.documentElement.lang).toBe('en');
    (doc.querySelector('[data-auto-language]') as HTMLButtonElement).click();expect(doc.documentElement.lang).toBe('zh-CN');
    expect(dom.window.location.search).toBe('');expect(dom.window.location.hash).toBe('#start');
    expect(doc.querySelector('[data-auto-language]')?.getAttribute('aria-pressed')).toBe('true');dom.window.close();
  });
  it('responds to browser language changes only in automatic mode and clears the remembered override',()=>{
    const dom=page({languages:['en-US']});const doc=dom.window.document;
    Object.defineProperty(dom.window.navigator,'languages',{value:['zh-CN'],configurable:true});
    dom.window.dispatchEvent(new dom.window.Event('languagechange'));expect(doc.documentElement.lang).toBe('zh-CN');
    (doc.querySelector('[data-language="en"]') as HTMLAnchorElement).click();dom.window.dispatchEvent(new dom.window.Event('languagechange'));expect(doc.documentElement.lang).toBe('en');
    (doc.querySelector('[data-auto-language]') as HTMLButtonElement).click();expect(doc.documentElement.lang).toBe('zh-CN');
    expect(dom.window.localStorage.getItem('gptworkbot-homepage-language')).toBeNull();dom.window.close();
  });
  it('ships an English fallback and a Chinese documentation link when JavaScript is unavailable',()=>{
    const dom=new JSDOM(html);expect(dom.window.document.querySelector('h1')?.textContent).toContain('Work roles');
    expect(dom.window.document.querySelector('noscript')?.textContent).toContain('阅读中文文档');dom.window.close();
  });
  it('builds a self-contained allowlisted artifact, with package-version downloads and all localized assets',()=>{
    execFileSync(process.execPath,['scripts/build-pages.mjs']);
    const files=(directory:string):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
    const artifact=files('pages-dist');expect(artifact).toHaveLength(13);
    expect(artifact.some(path=>/background|content\.ts|verification|social\/|storage|\.zip$/.test(path))).toBe(false);
    const built=readFileSync('pages-dist/index.html','utf8');
    const {version}=JSON.parse(readFileSync('package.json','utf8'));
    expect(built).toContain(`/releases/tag/v${version}`);expect(built).toContain(`<span data-version>${version}</span>`);
    for(const locale of ['zh','en']){const dom=page({url:`https://example.com/GptWorkBot/?lang=${locale}`});for(const image of dom.window.document.querySelectorAll('img')) expect(()=>readFileSync(join('pages-dist',image.getAttribute('src')!))).not.toThrow();dom.window.close();}
  });
});
