(() => {
  const key = 'tabloSearchPreferences';
  const maxCacheLength = 1024;
  const providers = globalThis.tabloSearchEngines;
  const names = ['schemaVersion', 'revision', 'showSearch', 'showClock', 'showWeather', 'openInNewTab', 'width', 'tileSize', 'searchEngine', 'weatherLayout', 'searchEngines'];
  const root = document.documentElement;
  let current = { schemaVersion: 1, revision: 0, showSearch: true, showClock: true, showWeather: true, openInNewTab: false, width: 'wide', tileSize: 'medium', searchEngine: globalThis.tabloI18n?.locale() === 'en' ? 'google' : 'yandex', weatherLayout: 'week', searchEngines: [...providers.defaults] };
  let mounted = false;
  let handlers = null;
  let pendingChoice = null;
  let queuedSubmit = null;
  let ticket = 0;
  let dispatchedTicket = 0;

  function snapshot(settings, revision) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !Number.isSafeInteger(revision) || revision < 0) return null;
    for (const name of ['showSearch', 'showClock', 'showWeather', 'openInNewTab']) if (typeof settings[name] !== 'boolean') return null;
    const weatherLayout = Object.hasOwn(settings, 'weatherLayout') ? settings.weatherLayout : 'week';
    if (!['compact', 'week'].includes(weatherLayout)) return null;
    if (!['compact', 'wide', 'fluid'].includes(settings.width) || !['small', 'medium', 'large'].includes(settings.tileSize) || !providers.ids.includes(settings.searchEngine)) return null;
    const enabled = Object.hasOwn(settings, 'searchEngines') ? settings.searchEngines : [...new Set([...providers.defaults, settings.searchEngine])];
    if (!Array.isArray(enabled) || !enabled.length || enabled.length > providers.ids.length || new Set(enabled).size !== enabled.length || [...enabled].some(id => !providers.ids.includes(id)) || !enabled.includes(settings.searchEngine)) return null;
    return { schemaVersion: 1, revision, showSearch: settings.showSearch, showClock: settings.showClock, showWeather: settings.showWeather, openInNewTab: settings.openInNewTab, width: settings.width, tileSize: settings.tileSize, searchEngine: settings.searchEngine, weatherLayout, searchEngines: [...enabled] };
  }

  function parseCache(raw) {
    if (typeof raw !== 'string' || raw.length > maxCacheLength) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || Object.keys(value).some(name => !names.includes(name)) || names.slice(0, 9).some(name => !Object.hasOwn(value, name))) return null;
      return snapshot(value, value.revision);
    } catch {
      return null;
    }
  }

  function remember(value) {
    try {
      const raw = localStorage.getItem(key);
      const previous = parseCache(raw);
      if (previous && previous.revision > value.revision) return;
      const serialized = JSON.stringify(value);
      if (serialized.length <= maxCacheLength && serialized !== raw) localStorage.setItem(key, serialized);
    } catch {}
  }

  function engine() {
    return pendingChoice?.engine || current.searchEngine;
  }

  function render() {
    root.dataset.showSearch = String(current.showSearch);
    root.dataset.showClock = String(current.showClock);
    root.dataset.showWeather = String(current.showWeather);
    root.dataset.weatherLayout = current.weatherLayout;
    root.dataset.clockRow = String(current.showClock || current.showWeather && current.weatherLayout === 'compact');
    root.dataset.boardWidth = current.width;
    root.dataset.tileSize = current.tileSize;
    root.dataset.settingsRevision = String(current.revision);
    if (document.body) {
      document.body.dataset.width = current.width;
      document.body.dataset.size = current.tileSize;
    }
    const form = document.getElementById('search-form');
    if (!form) return;
    form.hidden = !current.showSearch;
    const selected = engine();
    const input = document.getElementById('search-input');
    if (input) {
      const name = providers.name(selected);
      input.placeholder = globalThis.tabloI18n?.t(selected === 'yandex' ? 'core.search.yandex' : 'core.search.provider', { provider: name }) || (selected === 'yandex' ? 'Поиск в Яндексе' : `Поиск в ${name}`);
    }
    const group = document.getElementById('search-engines');
    if (group) {
      const signature = JSON.stringify(current.searchEngines);
      if (group.dataset.engines !== signature) {
        const focused = group.contains(document.activeElement) ? document.activeElement.dataset.engine : null;
        group.replaceChildren(...current.searchEngines.map(id => {
          const button = document.createElement('button');
          button.className = 'search-engine';
          button.type = 'button';
          button.dataset.engine = id;
          const icon = document.createElement('img');
          icon.src = providers.get(id).icon;
          icon.width = 24;
          icon.height = 24;
          icon.alt = '';
          icon.setAttribute('aria-hidden', 'true');
          button.append(icon);
          return button;
        }));
        group.dataset.engines = signature;
        if (focused) [...group.children].find(button => button.dataset.engine === (current.searchEngines.includes(focused) ? focused : selected))?.focus();
      }
      for (const button of group.children) {
        const id = button.dataset.engine;
        const name = providers.name(id);
        button.title = name;
        button.setAttribute('aria-label', name);
        button.setAttribute('aria-pressed', String(id === selected));
      }
    }
  }

  function flushChoice() {
    if (!pendingChoice || dispatchedTicket === pendingChoice.ticket || typeof handlers?.select !== 'function') return;
    dispatchedTicket = pendingChoice.ticket;
    handlers.select(pendingChoice.engine, pendingChoice.ticket);
  }

  function mount() {
    render();
    if (mounted) return true;
    const form = document.getElementById('search-form');
    const group = document.getElementById('search-engines');
    if (!form || !group) return false;
    mounted = true;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = document.getElementById('search-input')?.value.trim();
      if (!query) return;
      const request = { query, engine: engine(), openInNewTab: current.openInNewTab };
      if (typeof handlers?.submit === 'function') handlers.submit(request.query, request.engine, request.openInNewTab);
      else queuedSubmit = request;
    });
    group.addEventListener('mousedown', event => {
      const button = event.target?.closest('button[data-engine]');
      if (event.button === 0 && button && group.contains(button) && document.activeElement === document.getElementById('search-input')) event.preventDefault();
    });
    group.addEventListener('click', event => {
      const button = event.target?.closest('button[data-engine]');
      if (!button || !group.contains(button)) return;
      const selected = button.dataset.engine;
      if (!current.searchEngines.includes(selected) || selected === engine()) { render(); return; }
      pendingChoice = { engine: selected, ticket: ++ticket };
      render();
      flushChoice();
    });
    return true;
  }

  function apply(settings, revision) {
    const next = snapshot(settings, revision);
    if (!next) return;
    current = next;
    if (pendingChoice && !next.searchEngines.includes(pendingChoice.engine)) pendingChoice = null;
    render();
    remember(next);
  }

  function setWeatherLayout(layout, revision) {
    if (!['compact', 'week'].includes(layout) || !Number.isSafeInteger(revision) || revision < current.revision) return false;
    current = { ...current, weatherLayout: layout };
    render();
    return true;
  }

  function connect(value) {
    if (!value || typeof value !== 'object') return;
    handlers = value;
    flushChoice();
    if (queuedSubmit && typeof handlers.submit === 'function') {
      const request = queuedSubmit;
      queuedSubmit = null;
      handlers.submit(request.query, current.searchEngines.includes(request.engine) ? request.engine : engine(), request.openInNewTab);
    }
  }

  function settleEngine(choiceTicket, settings, revision) {
    if (!pendingChoice || pendingChoice.ticket !== choiceTicket) return;
    pendingChoice = null;
    const next = snapshot(settings, revision);
    if (next && next.revision >= current.revision) apply(next, revision);
    else render();
  }

  try {
    const cached = parseCache(localStorage.getItem(key));
    if (cached) current = cached;
  } catch {}
  render();
  globalThis.tabloSearch = Object.freeze({ mount, apply, connect, settleEngine, setWeatherLayout });
  globalThis.tabloI18n?.onChange(render);
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!mount()) return;
      observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  }
})();
