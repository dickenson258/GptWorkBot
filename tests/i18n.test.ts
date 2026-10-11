import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { browserLocale, initialLocale, languageStorageKey, normalizeLocale, readLocale, saveLocale, systemText, translator } from '../src/panel/i18n';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('chrome', undefined); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('interface language preferences', () => {
  it('uses Chinese browser variants and falls back to English for other languages', () => {
    expect(browserLocale('zh-TW')).toBe('zh-CN');
    expect(browserLocale('zh-CN')).toBe('zh-CN');
    expect(browserLocale('fr-FR')).toBe('en');
    expect(normalizeLocale('auto')).toBeUndefined();
  });
  it('restores the preview preference after reload', async () => {
    await saveLocale('zh-CN'); expect(initialLocale()).toBe('zh-CN');
    await saveLocale('en'); expect(await readLocale()).toBe('en');
  });
  it('saves only the separate language key, preserving the team store', async () => {
    const set = vi.fn(async () => {});
    vi.stubGlobal('chrome', { runtime: {id: 'extension'}, storage: { local: {set, get: vi.fn(async () => ({[languageStorageKey]: 'en'}))} } });
    await saveLocale('zh-CN');
    expect(set).toHaveBeenCalledExactlyOnceWith({[languageStorageKey]: 'zh-CN'});
    expect(await readLocale()).toBe('en');
  });
  it('ignores invalid saved values and reports write failures', async () => {
    vi.stubGlobal('chrome', { runtime: {id: 'extension'}, storage: {local: {get: vi.fn(async () => ({[languageStorageKey]: 'fr'})), set: vi.fn(async () => {throw new Error('storage failed');})}} });
    expect(await readLocale()).toBe(browserLocale());
    await expect(saveLocale('en')).rejects.toThrow('storage failed');
  });
});
describe('localized display without rewriting user content', () => {
  it('interpolates user names literally, including braces and replacement tokens', () => {
    const name = '空闲 {count} $& <script>';
    expect(translator('en')('Work 成员 · 向{name}回报', {name})).toBe(`Work member · report to ${name}`);
    expect(translator('zh-CN')('Work 成员 · 向{name}回报', {name})).toBe(`Work 成员 · 向${name}回报`);
  });
  it('localizes stored system messages while retaining names and native evidence', () => {
    expect(systemText('逐个连接：等待软件开发完成就绪确认', 'en')).toBe('Connecting in order: waiting for 软件开发 to confirm readiness.');
    expect(systemText('已派发：空闲', 'en')).toBe('Dispatched: 空闲');
    expect(systemText('原生特殊提示', 'en')).toBe('原生特殊提示');
    expect(systemText('连接已中断，正在等待完整答复', 'en')).toBe('连接已中断，正在等待完整答复');
    expect(systemText('需要核对：请先切换到 Work 模式', 'en')).toBe('Needs recheck: Switch to Work mode first.');
  });
  it('localizes validation errors and legacy branding without changing the saved error', () => {
    const error = JSON.stringify([{message: '请填写角色职责', path: ['responsibilities']}]);
    expect(systemText(error, 'en')).toBe('Enter the role’s responsibilities.');
    expect(systemText(error, 'zh-CN')).toBe(error);
    expect(systemText('插件后台暂未连接，请关闭侧栏后重新打开；若仍未恢复，请在扩展管理页重新加载 Work Team。团队记录会保留。', 'en')).toContain('reload GptWorkBot');
  });
  it('has English translations for every static interface label used by the panel and form', () => {
    const translate = translator('en');
    for (const file of ['src/panel/main.tsx', 'src/panel/CreateRoleDialog.tsx']) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'tr' && ts.isStringLiteral(node.arguments[0])) {
          const label = node.arguments[0].text;
          if (/\p{Script=Han}/u.test(label)) expect(translate(label), `${file}: ${label}`).not.toBe(label);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });
});
