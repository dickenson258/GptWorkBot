// Runs in the head so the document language is selected before first paint.
(() => {
  const key = 'gptworkbot-homepage-language';
  const normalize = value => /^zh(?:-|$)/i.test(value || '') ? 'zh' : /^en(?:-|$)/i.test(value || '') ? 'en' : undefined;
  function stored() { try { return normalize(localStorage.getItem(key)); } catch { return undefined; } }
  function browser() { return normalize(navigator.languages?.[0] || navigator.language) === 'zh' ? 'zh' : 'en'; }
  function requested() { return normalize(new URL(location.href).searchParams.get('lang')); }
  function choose() { return requested() || stored() || browser(); }
  function persist(locale) { try { locale ? localStorage.setItem(key, locale) : localStorage.removeItem(key); } catch { /* Private/restricted storage still allows switching for this visit. */ } }
  function updateUrl(locale) {
    const url = new URL(location.href);
    locale ? url.searchParams.set('lang', locale) : url.searchParams.delete('lang');
    try { history.replaceState(null, '', url); } catch { /* A restricted history API does not prevent rendering. */ }
  }
  window.GptWorkBotLanguage = {
    choose, browser,
    isAutomatic: () => !requested() && !stored(),
    set: locale => { if (!['zh', 'en'].includes(locale)) return; persist(locale); updateUrl(locale); window.GptWorkBotRender?.(locale); },
    automatic: () => { persist(undefined); updateUrl(undefined); window.GptWorkBotRender?.(browser()); }
  };
  document.documentElement.lang = choose() === 'zh' ? 'zh-CN' : 'en';
})();
