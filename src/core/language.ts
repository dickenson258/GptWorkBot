export type Locale = 'zh-CN' | 'en';
export const languageStorageKey = 'gptworkbot-ui-language';
export function normalizeLocale(value: unknown): Locale | undefined {
  return value === 'zh-CN' || value === 'en' ? value : undefined;
}
export function browserLocale(language = globalThis.navigator?.language || 'zh-CN'): Locale {
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en';
}
