(() => {
  if (globalThis.tabloSearchEngines) return;
  const items = Object.freeze([
    { id: 'google', name: 'Google', icon: 'assets/google.svg', url: 'https://www.google.com/search', parameter: 'q' },
    { id: 'yandex', name: 'Yandex', icon: 'assets/yandex.svg', url: 'https://yandex.ru/search/', parameter: 'text' },
    { id: 'bing', name: 'Bing', icon: 'assets/search/bing.ico', url: 'https://www.bing.com/search', parameter: 'q' },
    { id: 'duckduckgo', name: 'DuckDuckGo', icon: 'assets/search/duckduckgo.svg', url: 'https://duckduckgo.com/', parameter: 'q' },
    { id: 'brave', name: 'Brave', icon: 'assets/search/brave.svg', url: 'https://search.brave.com/search', parameter: 'q' },
    { id: 'ecosia', name: 'Ecosia', icon: 'assets/search/ecosia.svg', url: 'https://www.ecosia.org/search', parameter: 'q' }
  ].map(item => Object.freeze(item)));
  const ids = Object.freeze(items.map(item => item.id));
  const defaults = Object.freeze(['google', 'yandex']);
  const get = id => items.find(item => item.id === id);
  const name = id => id === 'yandex' ? globalThis.tabloI18n?.t('ui.yandex') || 'Яндекс' : get(id)?.name || id;

  function url(id, query) {
    const engine = get(id);
    if (!engine) throw new Error(globalThis.tabloI18n?.t('core.search.unavailable') || 'Unknown search engine.');
    const target = new URL(engine.url);
    target.searchParams.set(engine.parameter, query);
    return target.href;
  }

  globalThis.tabloSearchEngines = Object.freeze({ items, ids, defaults, get, name, url });
})();
