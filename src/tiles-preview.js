(() => {
  const key = 'tabloTilesPreview';
  const maxCacheLength = 4 * 1024 * 1024;
  const maxItems = 500;
  const maxFaviconBytes = 64 * 1024;
  const maxTotalFaviconBytes = 2 * 1024 * 1024;
  const siteNames = ['id', 'type', 'title', 'url', 'color', 'icon', 'favicon'];
  const brands = [
    [['ya.ru','yandex.ru','yandex.com'], 'Я'],
    [['youtube.com','youtu.be'], 'YouTube'],
    [['telegram.org','t.me'], 'Telegram'],
    [['wikipedia.org'], 'W'],
    [['github.com'], 'GitHub'],
    [['figma.com'], 'Figma'],
    [['notion.so','notion.site'], 'Notion'],
    [['twitch.tv'], 'twitch'],
    [['vk.com','vk.ru'], 'VK'],
    [['ozon.ru'], 'OZON'],
    [['mail.ru'], '@'],
    [['reddit.com'], 'reddit'],
    [['netflix.com'], 'NETFLIX'],
    [['spotify.com'], 'Spotify'],
    [['rutube.ru'], 'RUTUBE'],
    [['discord.com','discord.gg'], 'Discord']
  ];
  const signatures = new WeakMap();
  const root = document.documentElement;
  const t = (key, params) => globalThis.tabloI18n.t(key, params);
  const locale = () => globalThis.tabloI18n?.locale() || 'ru';
  let current;
  let mounted = false;

  function updateVisibility() {
    root.dataset.pageVisible = String(!document.hidden);
  }

  function reveal(board) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;
    const finish = () => {
      delete board.dataset.tilesEntering;
      board.removeEventListener('animationend', ended);
      board.removeEventListener('animationcancel', ended);
      reduced.removeEventListener('change', changed);
    };
    const ended = event => {
      if (event.target === board && event.animationName === 'tablo-tiles-enter') finish();
    };
    const changed = () => { if (reduced.matches) finish(); };
    board.addEventListener('animationend', ended);
    board.addEventListener('animationcancel', ended);
    reduced.addEventListener('change', changed);
    board.dataset.tilesEntering = 'true';
  }

  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function fields(value, names) {
    if (!plainObject(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new Error();
  }

  function identity(value, seen) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || seen.has(value)) throw new Error();
    seen.add(value);
    return value;
  }

  function title(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error();
    return value.trim();
  }

  function url(value) {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\u0000-\u001f\u007f\\]/.test(value)) throw new Error();
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || /^https?:\/\/([^/?#]*)/i.exec(value)?.[1].includes('@') || parsed.href !== value) throw new Error();
    return value;
  }

  function favicon(value, budget) {
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error();
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length % 4 !== 0) throw new Error();
    const encoded = match[1];
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const bytes = encoded.length / 4 * 3 - padding;
    if (bytes > maxFaviconBytes || btoa(atob(encoded)) !== encoded) throw new Error();
    budget.faviconBytes += bytes;
    if (budget.faviconBytes > maxTotalFaviconBytes) throw new Error();
    return value;
  }

  function site(value, budget) {
    fields(value, siteNames);
    if (value.type !== 'site' || typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color) || typeof value.icon !== 'string' || !value.icon.trim() || value.icon.length > 32 || /[\u0000-\u001f\u007f]/.test(value.icon)) throw new Error();
    return { id: identity(value.id, budget.seen), type: 'site', title: title(value.title), url: url(value.url), color: value.color.toLowerCase(), icon: value.icon.trim(), favicon: favicon(value.favicon, budget) };
  }

  function item(value, budget, canonical) {
    if (!plainObject(value) || ++budget.count > maxItems) throw new Error();
    if (value.type === 'site') return site(value, budget);
    fields(value, canonical ? ['id', 'type', 'title', 'children'] : ['id', 'type', 'title', 'children', 'count']);
    if (value.type !== 'folder' || !Array.isArray(value.children)) throw new Error();
    const id = identity(value.id, budget.seen);
    const name = title(value.title);
    const count = canonical ? value.children.length : value.count;
    if (!Number.isSafeInteger(count) || count < 0 || count > maxItems || (!canonical && value.children.length !== Math.min(count, 6)) || (budget.count += count) > maxItems) throw new Error();
    const children = value.children.map(child => site(child, budget));
    return { id, type: 'folder', title: name, children: children.slice(0, 6), count };
  }

  function snapshot(value, canonical = false) {
    fields(value, canonical ? ['schemaVersion', 'revision', 'items', 'settings'] : ['schemaVersion', 'revision', 'openInNewTab', 'items']);
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.items) || value.items.length > maxItems) throw new Error();
    const openInNewTab = canonical && plainObject(value.settings) ? value.settings.openInNewTab : value.openInNewTab;
    if (typeof openInNewTab !== 'boolean') throw new Error();
    const budget = { count: 0, faviconBytes: 0, seen: new Set() };
    return { schemaVersion: 1, revision: value.revision, openInNewTab, items: value.items.map(value => item(value, budget, canonical)) };
  }

  function parseCache(raw) {
    if (typeof raw !== 'string' || raw.length > maxCacheLength) return null;
    try { return snapshot(JSON.parse(raw)); }
    catch { return null; }
  }

  function readCache() {
    try { return parseCache(localStorage.getItem(key)); }
    catch { return null; }
  }

  function remember(state) {
    try {
      const value = snapshot(state, true);
      const stored = readCache();
      if ((stored && stored.revision > value.revision) || (current && current.revision > value.revision)) return false;
      const serialized = JSON.stringify(value);
      if (serialized.length > maxCacheLength) return false;
      if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
      current = value;
      return true;
    } catch {
      return false;
    }
  }

  function host(value) {
    return new URL(value).hostname.replace(/^www\./i, '');
  }

  function logo(site, mini = false) {
    if (site.icon !== 'auto') return site.icon;
    const domain = host(site.url);
    const known = brands.find(([hosts]) => hosts.some(value => domain === value || domain.endsWith(`.${value}`)));
    if (known) return mini ? known[1].slice(0, 1) : known[1];
    return site.title.slice(0, mini ? 1 : 2).toLocaleUpperCase(locale());
  }

  function readableColor(hex) {
    const values = hex.slice(1).match(/.{2}/g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    return (luminance + .05) / .051 > 1.05 / (luminance + .05) ? '#01030a' : '#ffffff';
  }

  function countLabel(count) {
    const form = new Intl.PluralRules(locale()).select(count);
    return t(`core.tiles.${form === 'one' ? 'one' : form === 'few' ? 'few' : 'many'}`, { count });
  }

  function icon(name) {
    return globalThis.tabloIcons.create(name);
  }

  function count(item) {
    return Object.hasOwn(item, 'count') ? item.count : item.children.length;
  }

  function signature(item, openInNewTab) {
    const site = value => [value.id, value.type, value.title, value.url, value.color, value.icon, value.favicon];
    return JSON.stringify(item.type === 'site' ? [locale(), openInNewTab, ...site(item)] : [locale(), openInNewTab, item.id, item.type, item.title, count(item), item.children.slice(0, 6).map(site)]);
  }

  function create(item, openInNewTab) {
    const tile = document.createElement('article');
    tile.className = 'tile';
    tile.dataset.id = item.id;
    tile.draggable = true;
    let link;
    if (item.type === 'site') {
      tile.style.setProperty('--tile-color', item.color);
      link = document.createElement('a');
      link.className = 'tile-link';
      link.href = item.url;
      link.title = `${item.title}\n${host(item.url)}`;
      link.style.color = readableColor(item.color);
      if (openInNewTab) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      const mark = document.createElement('span');
      mark.className = 'tile-logo';
      const text = logo(item);
      mark.textContent = text;
      if (/\p{Extended_Pictographic}/u.test(text)) mark.classList.add('is-emoji');
      else if (text.length > 7) mark.classList.add('is-small');
      else if (text.length > 2) mark.classList.add('is-word');
      const favicon = item.icon === 'auto' && (item.favicon || globalThis.tabloSiteIcons?.get(item));
      if (favicon) {
        const image = document.createElement('img');
        image.className = 'tile-favicon';
        image.src = favicon;
        image.alt = '';
        image.width = 54;
        image.height = 54;
        image.draggable = false;
        image.addEventListener('error', () => image.replaceWith(mark), { once: true });
        link.append(image);
      } else link.append(mark);
    } else {
      link = document.createElement('button');
      link.type = 'button';
      link.className = 'folder-link';
      link.setAttribute('aria-label', t('core.tiles.folder', { name: item.title, count: countLabel(count(item)) }));
      link.title = t('core.tiles.openFolder', { name: item.title });
      const preview = document.createElement('span');
      preview.className = 'folder-preview';
      preview.setAttribute('aria-hidden', 'true');
      const children = item.children.slice(0, 6);
      preview.dataset.count = children.length;
      const rowLength = children.length <= 3 ? 3 : Math.ceil(children.length / 2);
      for (let index = 0; index < children.length; index += rowLength) {
        const row = document.createElement('span');
        row.className = 'folder-preview-row';
        for (const child of children.slice(index, index + rowLength)) {
          const mini = document.createElement('span');
          mini.className = 'folder-mini';
          mini.style.setProperty('--mini-color', child.color);
          mini.style.color = readableColor(child.color);
          mini.textContent = logo(child, true);
          const favicon = child.icon === 'auto' && (child.favicon || globalThis.tabloSiteIcons?.get(child));
          if (favicon) {
            const image = document.createElement('img');
            image.src = favicon;
            image.alt = '';
            image.draggable = false;
            image.addEventListener('error', () => mini.replaceChildren(document.createTextNode(logo(child, true))), { once: true });
            mini.replaceChildren(image);
          }
          row.append(mini);
        }
        preview.append(row);
      }
      if (!children.length) preview.append(icon('folder'));
      const badge = document.createElement('span');
      badge.className = 'folder-count-badge';
      badge.textContent = count(item);
      const caption = document.createElement('span');
      caption.className = 'folder-caption';
      caption.append(badge);
      link.append(preview, caption);
    }
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = item.title;
    if (item.type === 'folder') link.querySelector('.folder-caption').prepend(label);
    else link.append(label);
    tile.append(link);
    signatures.set(tile, signature(item, openInNewTab));
    return tile;
  }

  function matches(tile, item, openInNewTab) {
    return signatures.has(tile) && signatures.get(tile) === signature(item, openInNewTab);
  }

  function createAdd() {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tile-add';
    const label = document.createElement('span');
    label.textContent = t('core.tiles.add');
    label.setAttribute('data-i18n', 'core.tiles.add');
    add.append(icon('plus'), label);
    add.setAttribute('aria-haspopup', 'menu');
    return add;
  }

  function eligible() {
    const revision = Number(root.dataset.settingsRevision);
    return current && Number.isSafeInteger(revision) && revision >= 0 && current.revision === revision && root.dataset.ready !== 'true';
  }

  function mount() {
    if (mounted) return true;
    if (!eligible()) return false;
    const grid = document.getElementById('root-grid');
    const empty = document.getElementById('root-empty');
    const skeleton = document.getElementById('startup-skeleton');
    const layout = document.getElementById('startup-skeleton-layout');
    const board = document.querySelector('.board');
    if (!grid || !empty || !skeleton || !layout || !board) return false;
    const tiles = current.items.map(item => create(item, current.openInNewTab));
    if (tiles.length) tiles.push(createAdd());
    grid.replaceChildren(...tiles);
    grid.hidden = current.items.length === 0;
    empty.hidden = current.items.length > 0;
    skeleton.hidden = true;
    root.dataset.tilesPreview = 'true';
    board.dataset.earlyTiles = 'true';
    reveal(board);
    mounted = true;
    return true;
  }

  updateVisibility();
  document.addEventListener('visibilitychange', updateVisibility);
  current = readCache();
  globalThis.tabloTiles = Object.freeze({ create, matches, createAdd, remember, mount });
  if (eligible() && !mount() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (mount() || !eligible()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  }
})();
