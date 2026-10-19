import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDefaultState, validateState, validateWeatherCity, normalizeUrl, makeFolder, allSites } from '../src/model.js';
import { t, locale, resolveLocale } from '../src/localize.js';

const sources = Object.fromEntries(['locales/ui.js', 'locales/app.js', 'locales/core.js', 'locales/errors.js', 'i18n.js'].map(path => [path, readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')]));
const translatedAttributes = ['data-i18n', 'data-i18n-title', 'data-i18n-aria-label', 'data-i18n-placeholder'];
const clone = value => JSON.parse(JSON.stringify(value));

function element(attributes = {}, text = '', children = []) {
  return {
    nodeType: 1,
    attributes: { ...attributes },
    textContent: text,
    children,
    get innerHTML() { throw new Error('Translation must use textContent.'); },
    set innerHTML(value) { throw new Error(`Translation must not interpret HTML: ${value}`); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    matches() { return translatedAttributes.some(name => Object.hasOwn(this.attributes, name)); },
    querySelectorAll() { return this.children.flatMap(child => [...(child.matches() ? [child] : []), ...child.querySelectorAll()]); }
  };
}

function load({ browserLanguage = 'en-US', navigatorLanguages = ['en-US'], navigatorLanguage = 'en-US', browserThrows = false, raw = null, storageUnavailable = false, nodes = [], extraCatalog } = {}) {
  const handlers = new Map();
  const writes = [];
  const runtime = { browserLanguage, browserThrows };
  let stored = raw;
  let observer;
  const root = element({}, '', nodes);
  const document = { documentElement: root, querySelectorAll(selector) { return root.querySelectorAll(selector); } };
  const navigator = { languages: navigatorLanguages, language: navigatorLanguage };
  const context = vm.createContext({
    document,
    navigator,
    browser: { i18n: { getUILanguage() { if (runtime.browserThrows) throw new Error('unavailable'); return runtime.browserLanguage; } } },
    localStorage: {
      getItem(key) { assert.equal(key, 'tabloLanguagePreferences'); if (storageUnavailable) throw new Error('unavailable'); return stored; },
      setItem(key, value) { assert.equal(key, 'tabloLanguagePreferences'); if (storageUnavailable) throw new Error('unavailable'); stored = value; writes.push(JSON.parse(value)); }
    },
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
    },
    addEventListener(name, callback) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); }
  });
  for (const path of ['locales/ui.js', 'locales/app.js', 'locales/core.js', 'locales/errors.js']) vm.runInContext(sources[path], context);
  if (extraCatalog) {
    Object.assign(context.tabloLocaleUI.ru, extraCatalog.ru || {});
    Object.assign(context.tabloLocaleUI.en, extraCatalog.en || {});
  }
  vm.runInContext(sources['i18n.js'], context);
  return {
    api: context.tabloI18n, context, root, runtime, navigator, writes,
    get stored() { return stored; },
    dispatch(name, event = {}) { for (const callback of handlers.get(name) || []) callback(event); },
    append(node) { root.children.push(node); observer([{ addedNodes: [node] }]); }
  };
}

function withI18n(api, operation) {
  const previous = globalThis.tabloI18n;
  globalThis.tabloI18n = api;
  try { return operation(); }
  finally {
    if (previous === undefined) delete globalThis.tabloI18n;
    else globalThis.tabloI18n = previous;
  }
}

test('автоматический язык определяется интерфейсом Firefox, а не языком веб-контента', () => {
  for (const [browserLanguage, navigatorLanguages, expected] of [['ru-RU', ['en-US'], 'ru'], ['en-GB', ['ru-RU'], 'en'], ['de-DE', ['ru-RU'], 'en'], ['RU', ['en-US'], 'ru']]) {
    const page = load({ browserLanguage, navigatorLanguages });
    assert.equal(page.api.preference(), 'auto');
    assert.equal(page.api.locale(), expected);
    assert.equal(page.root.lang, expected);
    assert.equal(page.api.t('ui.settings'), expected === 'ru' ? 'Настройки' : 'Settings');
    assert.equal(page.writes.length, 0);
  }
});

test('при недоступном API Firefox выбирается первый язык браузера, затем одиночный язык и английский fallback', () => {
  assert.equal(load({ browserThrows: true, navigatorLanguages: ['ru-RU', 'en-US'] }).api.locale(), 'ru');
  assert.equal(load({ browserLanguage: '', navigatorLanguages: [], navigatorLanguage: 'ru' }).api.locale(), 'ru');
  assert.equal(load({ browserLanguage: null, navigatorLanguages: [], navigatorLanguage: '' }).api.locale(), 'en');
});

test('сохранённый ручной язык действует до загрузки остального приложения', () => {
  const title = element({ 'data-i18n': 'ui.settings' }, 'Настройки');
  const page = load({ browserLanguage: 'ru', raw: JSON.stringify({ schemaVersion: 1, revision: 12, language: 'en' }), nodes: [title] });
  assert.equal(page.api.preference(), 'en');
  assert.equal(page.api.locale(), 'en');
  assert.equal(page.root.lang, 'en');
  assert.equal(title.textContent, 'Settings');
  assert.equal(page.writes.length, 0);
});

test('выбор RU, EN и языка браузера сохраняется и восстанавливается при следующем открытии', () => {
  const page = load({ browserLanguage: 'ru' });
  for (const [revision, language, expected] of [[1, 'en', 'en'], [2, 'ru', 'ru'], [3, 'auto', 'ru']]) {
    assert.equal(page.api.apply({ language }, revision), true);
    assert.equal(page.api.preference(), language);
    assert.equal(page.api.locale(), expected);
    const reopened = load({ browserLanguage: 'ru', raw: page.stored });
    assert.equal(reopened.api.preference(), language);
    assert.equal(reopened.api.locale(), expected);
  }
  assert.deepEqual(page.writes.map(value => value.language), ['en', 'ru', 'auto']);
});

test('повреждённый ранний кэш не меняет автоязык и не перезаписывается до загрузки настроек', () => {
  const invalid = ['{', 'null', '[]', '"en"', 'x'.repeat(257), ...[
    { schemaVersion: 2, revision: 1, language: 'en' },
    { schemaVersion: 1, revision: -1, language: 'en' },
    { schemaVersion: 1, revision: 1.5, language: 'en' },
    { schemaVersion: 1, revision: 1, language: 'de' },
    { schemaVersion: 1, revision: 1, language: null },
    { schemaVersion: 1, revision: 1, language: 'en', unknown: true },
    { schemaVersion: 1, language: 'en' }
  ].map(JSON.stringify)];
  for (const raw of invalid) {
    const page = load({ browserLanguage: 'ru', raw });
    assert.equal(page.api.preference(), 'auto', raw);
    assert.equal(page.api.locale(), 'ru', raw);
    assert.equal(page.stored, raw);
    assert.equal(page.writes.length, 0);
  }
});

test('недоступный localStorage не мешает показать страницу или вручную поменять язык', () => {
  const page = load({ browserLanguage: 'ru', storageUnavailable: true });
  assert.equal(page.api.locale(), 'ru');
  assert.equal(page.api.apply({ language: 'en' }, 1), true);
  assert.equal(page.api.locale(), 'en');
  assert.equal(page.api.t('ui.weather'), 'Weather');
});

test('отстающие и некорректные настройки не отменяют более свежий выбор языка', () => {
  const page = load({ browserLanguage: 'ru' });
  page.api.apply({ language: 'en' }, 8);
  const stored = page.stored;
  for (const [settings, revision] of [[{ language: 'ru' }, 7], [{ language: 'de' }, 9], [{ language: null }, 9], [{}, 9], [null, 9], [{ language: 'ru' }, NaN], [{ language: 'ru' }, 8.5], [{ language: 'ru' }, -1]]) {
    assert.equal(page.api.apply(settings, revision), false);
    assert.equal(page.api.locale(), 'en');
    assert.equal(page.api.preference(), 'en');
    assert.equal(page.stored, stored);
  }
});

test('основное хранилище исправляет ошибочный ранний кэш даже после восстановления более старой копии', () => {
  const heading = element({ 'data-i18n': 'ui.weather' });
  const page = load({ browserLanguage: 'en', raw: JSON.stringify({ schemaVersion: 1, revision: 25, language: 'en' }), nodes: [heading] });
  assert.equal(page.api.locale(), 'en');
  assert.equal(page.api.apply({ language: 'ru' }, 18, { authoritative: true }), true);
  assert.equal(page.api.locale(), 'ru');
  assert.equal(page.api.preference(), 'ru');
  assert.equal(heading.textContent, 'Погода');
  assert.deepEqual(JSON.parse(page.stored), { schemaVersion: 1, revision: 18, language: 'ru' });
  const reopened = load({ browserLanguage: 'en', raw: page.stored });
  assert.equal(reopened.api.locale(), 'ru');
  assert.equal(page.api.apply({ language: 'en' }, 17), false);
  assert.equal(page.api.apply({ language: 'en' }, 19), true);
  assert.equal(page.api.locale(), 'en');
});

test('свежий выбор в другой вкладке синхронизируется, устаревшие и чужие события игнорируются', () => {
  const heading = element({ 'data-i18n': 'ui.weather' });
  const page = load({ nodes: [heading] });
  page.api.apply({ language: 'en' }, 5);
  for (const event of [
    { key: 'other', newValue: JSON.stringify({ schemaVersion: 1, revision: 6, language: 'ru' }) },
    { key: 'tabloLanguagePreferences', newValue: JSON.stringify({ schemaVersion: 1, revision: 4, language: 'ru' }) },
    { key: 'tabloLanguagePreferences', newValue: '{' },
    { key: 'tabloLanguagePreferences', newValue: null }
  ]) page.dispatch('storage', event);
  assert.equal(page.api.locale(), 'en');
  const writes = page.writes.length;
  page.dispatch('storage', { key: 'tabloLanguagePreferences', newValue: JSON.stringify({ schemaVersion: 1, revision: 6, language: 'ru' }) });
  assert.equal(page.api.locale(), 'ru');
  assert.equal(page.api.preference(), 'ru');
  assert.equal(heading.textContent, 'Погода');
  assert.equal(page.writes.length, writes);
  assert.equal(page.api.apply({ language: 'en' }, 5), false);
});

test('изменение языка Firefox действует в автоматическом режиме, ручной выбор остаётся приоритетным', () => {
  const page = load({ browserLanguage: 'ru' });
  const changes = [];
  const unsubscribe = page.api.onChange((next, previous) => changes.push([next, previous]));
  page.runtime.browserLanguage = 'en-US';
  page.dispatch('languagechange');
  assert.equal(page.api.locale(), 'en');
  page.api.apply({ language: 'ru' }, 1);
  page.runtime.browserLanguage = 'de-DE';
  page.dispatch('languagechange');
  assert.equal(page.api.locale(), 'ru');
  page.api.apply({ language: 'auto' }, 2);
  assert.equal(page.api.locale(), 'en');
  assert.deepEqual(changes, [['en', 'ru'], ['ru', 'en'], ['en', 'ru']]);
  unsubscribe();
  page.runtime.browserLanguage = 'ru';
  page.dispatch('languagechange');
  assert.equal(changes.length, 3);
});

test('ранний перевод меняет текст, подсказки, aria и placeholder, сохраняя динамическое содержимое', () => {
  const heading = element({ 'data-i18n': 'ui.settings' }, 'Настройки');
  const input = element({ 'data-i18n-title': 'ui.find-city', 'data-i18n-aria-label': 'ui.find-city', 'data-i18n-placeholder': 'ui.city-example' });
  const dynamic = element({}, 'Мой собственный город');
  const page = load({ nodes: [heading, input, dynamic] });
  assert.equal(heading.textContent, 'Settings');
  assert.equal(input.getAttribute('title'), 'Find a city');
  assert.equal(input.getAttribute('aria-label'), 'Find a city');
  assert.equal(input.getAttribute('placeholder'), 'For example, Vienna');
  page.api.apply({ language: 'ru' }, 1);
  assert.equal(heading.textContent, 'Настройки');
  assert.equal(input.getAttribute('placeholder'), 'Например, Вена');
  assert.equal(dynamic.textContent, 'Мой собственный город');
});

test('узлы, которые HTML-парсер добавляет позже, сразу получают текущий язык', () => {
  const page = load({ browserLanguage: 'en' });
  const leaf = element({ 'data-i18n': 'ui.add-site' }, 'Добавить сайт');
  page.append(leaf);
  assert.equal(leaf.textContent, 'Add site');
  const nested = element({}, '', [element({ 'data-i18n': 'ui.cancel' }, 'Отмена')]);
  page.append(nested);
  assert.equal(nested.children[0].textContent, 'Cancel');
  page.api.apply({ language: 'ru' }, 1);
  page.api.translate(leaf);
  assert.equal(leaf.textContent, 'Добавить сайт');
});

test('параметры остаются буквальным текстом: HTML, доллары и вложенные шаблоны не исполняются', () => {
  const value = '<img src=x onerror=alert(1)> $& $` ${secret} {title}';
  const node = element({ 'data-i18n': 'test.literal' });
  const page = load({ extraCatalog: { en: { 'test.literal': value } }, nodes: [node] });
  assert.equal(node.textContent, value);
  assert.equal(page.api.t('app.tile.actionsFor', { title: value }), `Actions: ${value}`);
  assert.equal(page.api.t('core.forecast.high', { temperature: '+12°' }), 'High +12°');
  assert.equal(page.api.t('core.forecast.high', Object.create({ temperature: 'inherited' })), 'High {temperature}');
});

test('отсутствующий английский перевод показывает русский текст, а не служебный ключ', () => {
  const page = load({ extraCatalog: { ru: { 'test.ru-only': 'Перевод появится позже: {name}' } } });
  assert.equal(page.api.t('test.ru-only', { name: 'Alice' }), 'Перевод появится позже: Alice');
  assert.equal(page.api.t('Некорректный адрес сайта.'), 'Invalid website address.');
  assert.equal(page.api.t('Название'), 'Name');
  for (const name of ['tabloLocaleUI', 'tabloLocaleApp', 'tabloLocaleCore']) {
    const catalog = page.context[name];
    for (const key of Object.keys(catalog.ru)) {
      if (key === 'test.ru-only') continue;
      assert.equal(typeof catalog.en[key], 'string', `${name}: ${key}`);
      assert.notEqual(page.api.t(key), key, `${name}: ${key}`);
    }
  }
});

test('обёртка модулей использует тот же текущий язык и поддерживает текст без раннего runtime', () => {
  withI18n(undefined, () => {
    assert.equal(t('Сообщение: {name}', { name: '$& <b>value</b>' }), 'Сообщение: $& <b>value</b>');
    assert.equal(resolveLocale('ru'), 'ru');
    assert.equal(resolveLocale('en'), 'en');
  });
  const page = load({ browserLanguage: 'ru' });
  withI18n(page.api, () => {
    assert.equal(locale(), 'ru');
    assert.equal(t('ui.weather'), 'Погода');
    assert.equal(resolveLocale('auto'), 'ru');
    page.api.apply({ language: 'en' }, 1);
    assert.equal(locale(), 'en');
    assert.equal(t('ui.weather'), 'Weather');
  });
});

test('новый EN-профиль получает международный набор сайтов, Google и английское название папки', () => {
  const page = load({ browserLanguage: 'en-US', navigatorLanguages: ['ru'] });
  withI18n(page.api, () => {
    const state = createDefaultState();
    const hosts = allSites(state).map(site => new URL(site.url).hostname);
    for (const host of ['google.com', 'reddit.com', 'mail.google.com', 'amazon.com']) assert.ok(hosts.includes(host), host);
    for (const host of ['vk.com', 'ozon.ru', 'ya.ru']) assert.ok(!hosts.includes(host), host);
    assert.equal(state.settings.language, 'auto');
    assert.equal(state.settings.searchEngine, 'google');
    assert.equal(state.settings.weatherCity.name, 'Vienna');
    assert.ok(state.items.some(item => item.type === 'folder' && item.title === 'Work'));
    assert.deepEqual(validateState(state), state);
  });
});

test('ручной RU-пресет доступен в английском Firefox и не меняет сохранённый язык интерфейса', () => {
  const page = load({ browserLanguage: 'en' });
  withI18n(page.api, () => {
    const state = createDefaultState('ru');
    const hosts = allSites(state).map(site => new URL(site.url).hostname);
    for (const host of ['ya.ru', 'vk.com', 'ozon.ru']) assert.ok(hosts.includes(host), host);
    assert.equal(state.settings.searchEngine, 'yandex');
    assert.equal(state.settings.language, 'ru');
    assert.equal(state.settings.weatherCity.name, 'Вена');
    assert.ok(state.items.some(item => item.type === 'folder' && item.title === 'Работа'));
    assert.equal(page.api.locale(), 'en');
  });
});

test('новый EN-пресет по явному выбору не зависит от русского языка Firefox', () => {
  const page = load({ browserLanguage: 'ru' });
  withI18n(page.api, () => {
    const state = createDefaultState('en');
    assert.equal(state.settings.language, 'en');
    assert.equal(state.settings.searchEngine, 'google');
    assert.equal(state.settings.weatherCity.name, 'Vienna');
    assert.equal(page.api.locale(), 'ru');
  });
});

test('старая резервная копия получает только новое поле языка, сохраняя сайты, город и поисковик', () => {
  const page = load({ browserLanguage: 'en' });
  withI18n(page.api, () => {
    const legacy = createDefaultState('ru');
    legacy.revision = 38;
    legacy.items[0].title = 'Мой сайт';
    legacy.items.find(item => item.type === 'folder').title = 'My personal folder';
    legacy.settings.weatherCity.name = 'Моя Вена';
    legacy.settings.background = 'forest';
    legacy.settings.searchEngine = 'yandex';
    delete legacy.settings.language;
    const before = clone(legacy);
    const migrated = validateState(legacy);
    assert.deepEqual(legacy, before);
    assert.deepEqual(migrated.items, before.items);
    assert.deepEqual(migrated.settings, { ...before.settings, language: 'auto' });
    assert.equal(migrated.revision, 38);
    migrated.settings.language = 'en';
    const switched = validateState(migrated);
    assert.deepEqual(switched.items, before.items);
    assert.equal(switched.settings.searchEngine, 'yandex');
    assert.deepEqual(switched.settings.weatherCity, before.settings.weatherCity);
  });
});

test('настройка языка принимает только auto, ru и en, ошибки следуют выбранному языку', () => {
  const page = load({ browserLanguage: 'en' });
  withI18n(page.api, () => {
    for (const language of ['auto', 'ru', 'en']) assert.equal(validateState({ ...createDefaultState(), settings: { ...createDefaultState().settings, language } }).settings.language, language);
    for (const language of [null, '', 'de', 'RU', 1, false, {}, []]) {
      assert.throws(() => createDefaultState(language), { message: 'Invalid setting “language”.' });
      const state = createDefaultState();
      state.settings.language = language;
      assert.throws(() => validateState(state), { message: 'Invalid setting “language”.' });
    }
    assert.throws(() => normalizeUrl('javascript:alert(1)'), { message: 'Only HTTP and HTTPS addresses are supported.' });
    assert.throws(() => validateWeatherCity({}), { message: 'Invalid city field “name”.' });
    assert.equal(makeFolder().title, 'New folder');
    page.api.apply({ language: 'ru' }, 1);
    assert.throws(() => normalizeUrl('javascript:alert(1)'), { message: 'Допускаются только адреса HTTP и HTTPS.' });
    assert.equal(makeFolder().title, 'Новая папка');
  });
});
