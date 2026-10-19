(() => {
  const key = 'tabloLanguagePreferences';
  const choices = ['auto', 'ru', 'en'];
  const listeners = new Set();
  const messages = new Map();
  const catalogs = [globalThis.tabloLocaleCore, globalThis.tabloLocaleUI, globalThis.tabloLocaleApp, globalThis.tabloLocaleErrors].filter(Boolean);
  let current = { schemaVersion: 1, revision: 0, language: 'auto' };

  function resolve(language = 'auto') {
    if (language === 'ru' || language === 'en') return language;
    let browserLanguage;
    try { browserLanguage = globalThis.browser?.i18n?.getUILanguage(); } catch {}
    browserLanguage ||= globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'en';
    return /^ru(?:-|$)/i.test(browserLanguage) ? 'ru' : 'en';
  }

  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > 256) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !choices.includes(value.language)) return null;
      return { schemaVersion: 1, revision: value.revision, language: value.language };
    } catch { return null; }
  }

  try { current = parse(localStorage.getItem(key)) || current; } catch {}
  let language = resolve(current.language);

  function t(name, params = {}) {
    let text;
    for (const catalog of catalogs) if (Object.hasOwn(catalog[language] || {}, name)) { text = catalog[language][name]; break; }
    if (text === undefined) for (const catalog of catalogs) if (Object.hasOwn(catalog.ru || {}, name)) { text = catalog.ru[name]; break; }
    const result = String(text ?? name).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, param) => Object.hasOwn(params, param) ? String(params[param]) : match);
    if (catalogs.some(catalog => ['ru', 'en'].some(locale => Object.hasOwn(catalog[locale] || {}, name)))) {
      messages.delete(result);
      messages.set(result, { name, params: { ...params } });
      if (messages.size > 1000) messages.delete(messages.keys().next().value);
    }
    return result;
  }

  function retranslate(text) {
    const message = messages.get(text);
    if (!message) return text;
    messages.delete(text);
    messages.set(text, message);
    return t(message.name, message.params);
  }

  function translate(root = document) {
    const nodes = [...(root.querySelectorAll?.('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]') || [])];
    if (root.matches?.('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]')) nodes.unshift(root);
    for (const node of nodes) {
      const text = node.getAttribute('data-i18n');
      if (text && node.textContent !== t(text)) node.textContent = t(text);
      for (const attribute of ['title', 'aria-label', 'placeholder']) {
        const name = node.getAttribute(`data-i18n-${attribute}`);
        if (name && node.getAttribute(attribute) !== t(name)) node.setAttribute(attribute, t(name));
      }
    }
  }

  function refresh() {
    const previous = language;
    language = resolve(current.language);
    if (globalThis.document?.documentElement) document.documentElement.lang = language;
    if (globalThis.document) translate();
    if (previous !== language) for (const listener of listeners) listener(language, previous);
  }

  function apply(settings, revision, { authoritative = false } = {}) {
    if (!settings || !choices.includes(settings.language) || !Number.isSafeInteger(revision) || revision < 0 || !authoritative && revision < current.revision) return false;
    current = { schemaVersion: 1, revision, language: settings.language };
    try {
      const raw = JSON.stringify(current);
      if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
    } catch {}
    refresh();
    return true;
  }

  globalThis.tabloI18n = Object.freeze({ t, retranslate, resolve, locale: () => language, preference: () => current.language, apply, translate, onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
  refresh();
  if (globalThis.document && typeof MutationObserver === 'function') new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) translate(node);
  }).observe(document.documentElement, { childList: true, subtree: true });
  globalThis.addEventListener?.('languagechange', refresh);
  globalThis.addEventListener?.('storage', event => {
    if (event.key !== key) return;
    const next = parse(event.newValue);
    if (next && next.revision >= current.revision) { current = next; refresh(); }
  });
})();
