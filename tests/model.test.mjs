import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultState, normalizeUrl, validateState, displayHost, makeSite, makeFolder,
  findItem, listItems, addItem, updateItem, deleteItem, moveItem, createFolderFromItems, allSites, validateWeatherCity
} from '../src/model.js';
import { createRepository } from '../src/storage.js';

const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ ...createDefaultState(), items: [] });
const site = (name = 'Сайт') => makeSite({ title: name, url: 'example.com' });

function browserMock(initial) {
  let stored = initial;
  const listeners = new Set();
  const writes = [];
  let failNext = false;
  let inFlight = 0;
  let maxInFlight = 0;
  const browser = {
    storage: {
      local: {
        async get() { return stored === undefined ? {} : { tabloState: clone(stored) }; },
        async set(values) {
          inFlight++;
          maxInFlight = Math.max(inFlight, maxInFlight);
          await new Promise(resolve => setTimeout(resolve, 2));
          inFlight--;
          if (failNext) {
            failNext = false;
            throw new Error('QUOTA_BYTES');
          }
          stored = clone(values.tabloState);
          writes.push(clone(stored));
          for (const listener of listeners) listener({ tabloState: { newValue: clone(stored) } }, 'local');
        }
      },
      onChanged: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); }
      }
    }
  };
  return {
    browser, writes, listeners,
    fail() { failNext = true; },
    get stored() { return stored; },
    get maxInFlight() { return maxInFlight; },
    external(value, area = 'local') {
      stored = value;
      for (const listener of listeners) listener({ tabloState: { newValue: value } }, area);
    }
  };
}

test('адреса нормализуются, сохраняют порт и ограничены безопасными схемами', () => {
  assert.equal(normalizeUrl(' example.com/path?q=1 '), 'https://example.com/path?q=1');
  assert.equal(normalizeUrl('example.com:8443/a'), 'https://example.com:8443/a');
  assert.equal(normalizeUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeUrl('http://EXAMPLE.com:80'), 'http://example.com/');
  assert.equal(normalizeUrl('//example.com'), 'https://example.com/');
  assert.equal(displayHost('https://www.example.com/a'), 'example.com');
  assert.equal(normalizeUrl('test'), 'https://test/');
  assert.equal(new URL(normalizeUrl('https://example.com/%6aavascript:alert(1)')).origin, 'https://example.com');
  for (const url of ['javascript:alert(1)', '%6aavascript:alert(1)', 'javascript%3Aalert(1)', 'java%0ascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'ftp://example.com', 'https:example.com', 'https://u:p@example.com', 'https://@example.com', 'https://user%3Apass@example.com', 'https://example.com%2f@evil.example', 'https://%40example.com', 'https://example.com\\evil', 'https://exa\nmple.com', '', null]) {
    assert.throws(() => normalizeUrl(url), undefined, String(url));
  }
});

test('начальные данные валидны и независимы друг от друга', () => {
  const first = createDefaultState('ru');
  const second = createDefaultState('ru');
  assert.deepEqual(validateState(first), first);
  assert.equal(first.schemaVersion, 1);
  assert.ok(first.items.some(item => item.type === 'folder' && item.children.length));
  first.settings.background = 'midnight';
  first.items[0].title = 'Изменено';
  assert.equal(second.settings.background, 'aurora');
  assert.notEqual(second.items[0].title, 'Изменено');
  first.settings.weatherCity.name = 'Изменённый город';
  assert.equal(second.settings.weatherCity.name, 'Вена');
  assert.equal(second.settings.weatherCity.countryCode, 'AT');
  assert.equal(second.settings.showWeather, true);
  assert.equal(second.settings.weatherProvider, 'open-meteo');
  assert.equal(second.settings.weatherLayout, 'week');
});

test('данные версии 0.1 загружаются с прежними настройками и новыми полями по умолчанию', () => {
  const oldState = createDefaultState();
  delete oldState.settings.showWeather;
  delete oldState.settings.weatherCity;
  delete oldState.settings.weatherProvider;
  delete oldState.settings.weatherLayout;
  oldState.settings.showClock = false;
  oldState.settings.background = 'forest';
  for (const item of allSites(oldState)) delete item.favicon;
  const migrated = validateState(oldState);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.settings.showClock, false);
  assert.equal(migrated.settings.background, 'forest');
  assert.equal(migrated.settings.showWeather, true);
  assert.equal(migrated.settings.weatherCity.name, 'Вена');
  assert.equal(migrated.settings.weatherProvider, 'open-meteo');
  assert.equal(migrated.settings.weatherLayout, 'week');
  assert.ok(allSites(migrated).every(item => item.favicon === null));
  assert.equal(Object.hasOwn(oldState.settings, 'weatherCity'), false);
  assert.equal(Object.hasOwn(oldState.settings, 'weatherProvider'), false);
  assert.equal(Object.hasOwn(oldState.settings, 'weatherLayout'), false);
});

test('источник погоды и вид виджета принимают только поддерживаемые значения', () => {
  const state = createDefaultState();
  const before = clone(state);
  for (const weatherProvider of ['open-meteo', 'metno']) {
    for (const weatherLayout of ['compact', 'week']) {
      const settings = { ...state.settings, weatherProvider, weatherLayout };
      const restored = validateState({ ...state, settings });
      assert.equal(restored.settings.weatherProvider, weatherProvider);
      assert.equal(restored.settings.weatherLayout, weatherLayout);
      assert.deepEqual(restored.items, state.items);
      assert.notEqual(restored.settings, settings);
    }
  }
  for (const weatherProvider of [undefined, null, '', 'yandex', 'Open-Meteo', 'met.no', 0, true, [], {}]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, weatherProvider } }), /weatherProvider/);
  }
  for (const weatherLayout of [undefined, null, '', 'daily', 'weekly', 'Week', 0, false, [], {}]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, weatherLayout } }), /weatherLayout/);
  }
  assert.deepEqual(state, before);
});

test('старые настройки без нового источника или вида получают только недостающие defaults', () => {
  for (const missing of [['weatherProvider'], ['weatherLayout'], ['weatherProvider', 'weatherLayout']]) {
    const state = createDefaultState();
    state.settings.weatherProvider = 'metno';
    state.settings.weatherLayout = 'compact';
    state.settings.showWeather = false;
    state.settings.weatherCity = null;
    state.settings.background = 'midnight';
    for (const key of missing) delete state.settings[key];
    const before = clone(state);
    const restored = validateState(state);
    assert.equal(restored.settings.weatherProvider, missing.includes('weatherProvider') ? 'open-meteo' : 'metno');
    assert.equal(restored.settings.weatherLayout, missing.includes('weatherLayout') ? 'week' : 'compact');
    assert.equal(restored.settings.showWeather, false);
    assert.equal(restored.settings.weatherCity, null);
    assert.equal(restored.settings.background, 'midnight');
    assert.deepEqual(restored.items, state.items);
    assert.deepEqual(state, before);
  }
});

test('город погоды имеет строгую схему, координаты и корректный часовой пояс', () => {
  const city = createDefaultState().settings.weatherCity;
  assert.deepEqual(validateWeatherCity(city), city);
  assert.notEqual(validateWeatherCity(city), city);
  assert.equal(validateWeatherCity(null), null);
  assert.equal(validateWeatherCity({ ...city, admin1: '' }).admin1, '');
  for (const value of [undefined, 'Вена', [], { ...city, extra: true }, { ...city, latitude: 91 }, { ...city, longitude: -181 }, { ...city, latitude: '48' }, { ...city, longitude: Infinity }, { ...city, countryCode: 'AUT' }, { ...city, countryCode: 'at' }, { ...city, timezone: 'Europe/Missing' }, { ...city, name: '' }, { ...city, admin1: null }, { ...city, country: 'a'.repeat(121) }, { ...city, name: 'Вена\n' }]) {
    assert.throws(() => validateWeatherCity(value));
  }
  const state = empty();
  assert.equal(validateState({ ...state, settings: { ...state.settings, weatherCity: null, showWeather: false } }).settings.weatherCity, null);
  assert.throws(() => validateState({ ...state, settings: { ...state.settings, showWeather: 1 } }), /логической/);
});

test('PNG-значки сохраняются и изменяются, неправильный MIME и base64 отклоняются атомарно', () => {
  const image = 'data:image/png;base64,YWJj';
  const state = empty();
  const item = makeSite({ url: 'example.com', favicon: image });
  assert.equal(item.favicon, image);
  addItem(state, item);
  updateItem(state, item.id, { favicon: null });
  assert.equal(state.items[0].favicon, null);
  updateItem(state, item.id, { favicon: image });
  assert.equal(state.items[0].favicon, image);
  const before = clone(state);
  for (const value of [undefined, 5, '', 'https://example.com/icon.png', 'data:image/svg+xml;base64,YWJj', 'data:image/jpeg;base64,YWJj', 'data:image/png;base64,', 'data:image/png;base64,YWJ', 'data:image/png;base64,YQ===', 'data:image/png;base64,YR==', 'data:image/png;base64,YW Jj', 'data:image/png;base64,====']) {
    assert.throws(() => updateItem(state, item.id, { favicon: value }));
    assert.deepEqual(state, before);
  }
});

test('размер значков ограничен 64 КБ на сайт и 2 МБ на всё табло, включая папки', () => {
  const image = `data:image/png;base64,${Buffer.alloc(64 * 1024).toString('base64')}`;
  const oversized = `data:image/png;base64,${Buffer.alloc(64 * 1024 + 1).toString('base64')}`;
  assert.throws(() => makeSite({ url: 'example.com', favicon: oversized }), /64 КБ/);
  const state = empty();
  const folder = makeFolder('Значки');
  folder.children = Array.from({ length: 32 }, () => makeSite({ url: 'example.com', favicon: image }));
  state.items = [folder];
  assert.equal(allSites(validateState(state)).length, 32);
  folder.children.push(makeSite({ url: 'example.com', favicon: image }));
  assert.throws(() => validateState(state), /2 МБ/);
});

test('валидация отклоняет неподдерживаемые поля, повторные ID и вложенные папки', () => {
  const state = empty();
  const a = site('A');
  assert.throws(() => validateState({ ...state, removed: [] }), /неизвестное поле/);
  assert.throws(() => validateState({ ...state, schemaVersion: 2 }), /версия/);
  assert.throws(() => validateState({ ...state, revision: -1 }), /ревизия/);
  assert.throws(() => validateState({ ...state, settings: { ...state.settings, surprise: true } }), /неизвестное поле/);
  assert.throws(() => validateState({ ...state, items: [a, a] }), /повторяться/);
  assert.throws(() => validateState({ ...state, items: [{ ...makeFolder('A'), children: [makeFolder('B')] }] }), /Вложенные/);
  assert.throws(() => validateState({ ...state, items: [{ ...a, id: '../../bad' }] }), /идентификатор/);
  assert.throws(() => validateState({ ...state, items: [{ ...a, title: 'a'.repeat(81) }] }), /80/);
  assert.throws(() => validateState({ ...state, items: [{ ...a, extra: true }] }), /неизвестное поле/);
});

test('валидация клонирует данные, нормализует строки и считает содержимое папок', () => {
  const state = empty();
  state.items = [{ ...site(), title: ' Название ', url: 'EXAMPLE.com', color: '#ABCDEF' }];
  const normalized = validateState(state);
  assert.equal(normalized.items[0].title, 'Название');
  assert.equal(normalized.items[0].url, 'https://example.com/');
  assert.equal(normalized.items[0].color, '#abcdef');
  assert.equal(state.items[0].title, ' Название ');
  assert.notEqual(normalized.settings, state.settings);
  const folder = makeFolder('Много');
  folder.children = Array.from({ length: 499 }, () => site());
  state.items = [folder];
  assert.equal(allSites(validateState(state)).length, 499);
  folder.children.push(site());
  assert.throws(() => validateState(state), /500/);
});

test('настройки принимают только заданные типы и ограничивают фоновое изображение', () => {
  const state = empty();
  for (const patch of [{ showClock: 'yes' }, { background: 'custom' }, { width: 'anything' }, { dim: 71 }, { dim: NaN }, { searchEngine: 'unsupported' }, { customBackground: 'https://example.com/image.png' }, { customBackground: 'data:image/svg+xml;base64,YWJj' }, { customBackground: 'data:image/gif;base64,YWJj' }]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, ...patch } }));
  }
  const background = 'data:image/png;base64,YWJj';
  assert.equal(validateState({ ...state, settings: { ...state.settings, customBackground: background } }).settings.customBackground, background);
  const oversized = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`;
  assert.throws(() => validateState({ ...state, settings: { ...state.settings, customBackground: oversized } }), /5 МБ/);
});

test('копия со старым DuckDuckGo сохраняет поисковик, сайты и папки', () => {
  const state = createDefaultState();
  state.settings.searchEngine = 'duckduckgo';
  state.settings.showSearch = false;
  delete state.settings.searchEngines;
  const before = clone(state);
  const parsed = JSON.parse(JSON.stringify(state));
  const restored = validateState(parsed);
  assert.equal(restored.settings.searchEngine, 'duckduckgo');
  assert.deepEqual(restored.settings.searchEngines, ['google', 'yandex', 'duckduckgo']);
  assert.equal(restored.settings.showSearch, false);
  assert.deepEqual(restored.items, before.items);
  assert.equal(restored.revision, before.revision);
  assert.deepEqual(parsed, before);
});

test('новые RU и EN профили включают Google и Яндекс, их списки независимы', () => {
  const russian = createDefaultState('ru');
  const english = createDefaultState('en');
  assert.deepEqual(russian.settings.searchEngines, ['google', 'yandex']);
  assert.deepEqual(english.settings.searchEngines, ['google', 'yandex']);
  assert.equal(russian.settings.searchEngine, 'yandex');
  assert.equal(english.settings.searchEngine, 'google');
  russian.settings.searchEngines.push('bing');
  assert.deepEqual(english.settings.searchEngines, ['google', 'yandex']);
  for (const language of ['ru', 'en']) assert.deepEqual(createDefaultState(language).settings.searchEngines, ['google', 'yandex']);
});

test('любой из шести поисковиков можно оставить единственным включённым', () => {
  const state = createDefaultState('en');
  for (const searchEngine of ['google', 'yandex', 'bing', 'duckduckgo', 'brave', 'ecosia']) {
    const settings = { ...state.settings, searchEngine, searchEngines: [searchEngine] };
    const normalized = validateState({ ...state, settings });
    assert.equal(normalized.settings.searchEngine, searchEngine);
    assert.deepEqual(normalized.settings.searchEngines, [searchEngine]);
    assert.deepEqual(normalized.items, state.items);
  }
});

test('проверка сохраняет порядок включённых поисковиков и изолирует возвращённый список', () => {
  const state = createDefaultState('en');
  state.settings.searchEngines = ['ecosia', 'brave', 'duckduckgo', 'bing', 'yandex', 'google'];
  state.settings.searchEngine = 'brave';
  const before = clone(state);
  const normalized = validateState(state);
  assert.deepEqual(normalized.settings.searchEngines, before.settings.searchEngines);
  assert.equal(normalized.settings.searchEngine, 'brave');
  normalized.settings.searchEngines.splice(0, 2);
  assert.deepEqual(state, before);
  const next = validateState(state);
  state.settings.searchEngines.reverse();
  assert.deepEqual(next.settings.searchEngines, before.settings.searchEngines);
});

test('явно заданный некорректный список поисковиков отклоняется без исправления данных', () => {
  const state = createDefaultState('en');
  for (const searchEngines of [Object.assign(Array(2), { 0: 'google' }), undefined, null, [], '', 'google', 0, false, {}, ['unsupported'], ['google', 'unsupported'], ['google', 'google'], ['GOOGLE'], [null], [1], [['google']], ['bing'], ['google', 'yandex', 'bing', 'duckduckgo', 'brave', 'ecosia', 'unsupported']]) {
    const candidate = { ...state, settings: { ...state.settings, searchEngines } };
    const before = structuredClone(candidate);
    assert.throws(() => validateState(candidate), undefined, JSON.stringify(searchEngines));
    assert.deepEqual(candidate, before);
  }
  for (const searchEngine of [undefined, null, '', 1, false, 'unsupported', 'bing']) {
    const candidate = { ...state, settings: { ...state.settings, searchEngine } };
    assert.throws(() => validateState(candidate));
  }
});

test('старые настройки получают список с выбранным поисковиком и сохраняют остальные предпочтения', () => {
  for (const searchEngine of ['google', 'yandex', 'bing', 'duckduckgo', 'brave', 'ecosia']) {
    const legacy = createDefaultState('ru');
    legacy.revision = 23;
    legacy.items[0].title = 'Мой сайт';
    legacy.settings.language = 'en';
    legacy.settings.searchEngine = searchEngine;
    legacy.settings.showSearch = false;
    legacy.settings.openInNewTab = true;
    legacy.settings.background = 'forest';
    legacy.settings.dim = 35;
    delete legacy.settings.searchEngines;
    const before = clone(legacy);
    const migrated = validateState(legacy);
    const expectedEngines = ['google', 'yandex', ...(['google', 'yandex'].includes(searchEngine) ? [] : [searchEngine])];
    assert.equal(migrated.revision, before.revision);
    assert.deepEqual(migrated.items, before.items);
    assert.deepEqual(migrated.settings, { ...before.settings, searchEngines: expectedEngines });
    assert.deepEqual(legacy, before);
    const reopened = validateState(JSON.parse(JSON.stringify(migrated)));
    assert.deepEqual(reopened, migrated);
    migrated.settings.searchEngines.push('unsupported');
    assert.deepEqual(legacy, before);
  }
});

test('отсутствие списка в старой копии не скрывает ошибочный выбранный поисковик', () => {
  const legacy = createDefaultState('en');
  delete legacy.settings.searchEngines;
  legacy.settings.searchEngine = 'unsupported';
  const before = clone(legacy);
  assert.throws(() => validateState(legacy));
  assert.deepEqual(legacy, before);
});

test('добавление и изменение атомарны, поиск возвращает реальное положение', () => {
  const state = empty();
  const folder = makeFolder('Работа');
  const a = site('A');
  assert.equal(addItem(state, folder), state);
  addItem(state, a, folder.id);
  const found = findItem(state, a.id);
  assert.equal(found.parentId, folder.id);
  assert.equal(found.index, 0);
  assert.equal(listItems(state, folder.id)[0], found.item);
  updateItem(state, a.id, { title: 'Новое', url: 'new.example' });
  assert.equal(findItem(state, a.id).item.url, 'https://new.example/');
  const before = clone(state);
  assert.throws(() => updateItem(state, a.id, { id: 'replaced' }), /неизвестное поле/);
  assert.deepEqual(state, before);
  assert.throws(() => addItem(state, makeFolder('Вложенная'), folder.id), /Вложенные/);
  assert.deepEqual(state, before);
  deleteItem(state, a.id);
  assert.equal(findItem(state, a.id), null);
  assert.equal(listItems(state, folder.id).length, 0);
  deleteItem(state, folder.id);
  assert.equal(state.items.length, 0);
});

test('перемещение использует итоговый индекс и переносит сайты между папкой и корнем', () => {
  const state = empty();
  const a = site('A');
  const b = site('B');
  const c = site('C');
  const folder = makeFolder('Папка');
  state.items = [a, b, c, folder];
  moveItem(state, a.id, null, 2);
  assert.deepEqual(state.items.map(item => item.id), [b.id, c.id, a.id, folder.id]);
  moveItem(state, b.id, folder.id);
  assert.equal(findItem(state, b.id).parentId, folder.id);
  moveItem(state, b.id, null, 0);
  assert.equal(state.items[0].id, b.id);
  assert.equal(listItems(state, folder.id).length, 0);
  const before = clone(state);
  assert.throws(() => moveItem(state, folder.id, folder.id), /Вложенные/);
  assert.throws(() => moveItem(state, a.id, 'missing'), /Папка не найдена/);
  assert.throws(() => moveItem(state, a.id, null, -1), /позиция/);
  assert.deepEqual(state, before);
});

test('создание папки сохраняет позицию цели и допускает источник в другой папке', () => {
  const state = empty();
  const a = site('A');
  const b = site('B');
  const c = site('C');
  state.items = [a, b, c];
  createFolderFromItems(state, a.id, c.id, 'Вместе');
  assert.equal(state.items[0].id, b.id);
  assert.equal(state.items[1].title, 'Вместе');
  assert.deepEqual(state.items[1].children.map(item => item.id), [c.id, a.id]);
  const formerFolderId = state.items[1].id;
  createFolderFromItems(state, a.id, b.id);
  assert.deepEqual(state.items[0].children.map(item => item.id), [b.id, a.id]);
  assert.deepEqual(listItems(state, formerFolderId).map(item => item.id), [c.id]);
  const before = clone(state);
  assert.throws(() => createFolderFromItems(state, c.id, a.id), /целев/);
  assert.deepEqual(state, before);
});

test('хранилище возвращает defaults только при отсутствии ключа и не затирает повреждённые данные', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  assert.equal((await repository.load()).schemaVersion, 1);
  assert.equal(mock.writes.length, 1);
  mock.external({ schemaVersion: 999 });
  await assert.rejects(repository.load(), /версия/);
  await assert.rejects(repository.save(empty()), /версия/);
  assert.deepEqual(await repository.readRaw(), { schemaVersion: 999 });
  assert.equal(mock.writes.length, 1);
  repository.dispose();
});

test('первая загрузка закрепляет UUID и сохраняет ровно один default для очереди и следующего repository', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  const [first, concurrent] = await Promise.all([repository.load(), repository.load()]);
  assert.deepEqual(first, concurrent);
  assert.equal(mock.writes.length, 1);
  repository.dispose();
  const reopened = createRepository(mock.browser);
  assert.deepEqual(await reopened.load(), first);
  assert.equal(mock.writes.length, 1);
  reopened.dispose();
});

test('неуспешная запись defaults отклоняет load и оставляет отсутствующий ключ нетронутым', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  mock.fail();
  await assert.rejects(repository.load(), /QUOTA_BYTES/);
  assert.equal(await repository.readRaw(), undefined);
  assert.equal(mock.writes.length, 0);
  const state = await repository.load();
  assert.deepEqual(mock.stored, state);
  assert.equal(mock.writes.length, 1);
  repository.dispose();
});

test('сохранения сериализованы, снимают копию входа и последовательно увеличивают revision', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  const state = empty();
  const first = repository.save(state);
  state.settings.background = 'forest';
  const second = repository.save(state);
  state.settings.background = 'dawn';
  const [savedFirst, savedSecond] = await Promise.all([first, second]);
  assert.equal(savedFirst.revision, 1);
  assert.equal(savedSecond.revision, 2);
  assert.equal(savedFirst.settings.background, 'aurora');
  assert.equal(savedSecond.settings.background, 'forest');
  assert.equal(state.revision, 0);
  assert.equal(mock.maxInFlight, 1);
  savedSecond.settings.background = 'midnight';
  assert.equal(mock.stored.settings.background, 'forest');
  repository.dispose();
});

test('ошибка записи видна вызывающему коду и не блокирует последующие сохранения', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  mock.fail();
  await assert.rejects(repository.save(empty()), /QUOTA_BYTES/);
  assert.equal(mock.writes.length, 0);
  assert.equal((await repository.save(empty())).revision, 1);
  repository.dispose();
});

test('подписка сообщает внешние валидные изменения, изолирует копии и снимается при dispose', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  const observed = [];
  repository.subscribe(state => { state.settings.background = 'dawn'; });
  const unsubscribe = repository.subscribe(state => observed.push(state));
  await repository.save(empty());
  assert.equal(observed.length, 0);
  const external = empty();
  external.revision = 25;
  mock.external(external);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].settings.background, 'aurora');
  assert.equal(external.settings.background, 'aurora');
  mock.external({ invalid: true });
  assert.equal(observed.length, 1);
  mock.external(external, 'sync');
  assert.equal(observed.length, 1);
  mock.external(external);
  assert.equal((await repository.save(empty())).revision, 26);
  unsubscribe();
  mock.external(external);
  assert.equal(observed.length, 2);
  repository.dispose();
  assert.equal(mock.listeners.size, 0);
  await assert.rejects(repository.load(), /закрыто/);
  await assert.rejects(repository.save(empty()), /закрыто/);
});

test('fingerprint не подавляет внешние изменения с той же revision и учитывает фон отдельно', async () => {
  const mock = browserMock();
  const repository = createRepository(mock.browser);
  const observed = [];
  repository.subscribe(state => observed.push(state));
  const state = empty();
  state.settings.customBackground = 'data:image/png;base64,YWJj';
  const saved = await repository.save(state);
  assert.equal(observed.length, 0);
  mock.external(clone(saved));
  assert.equal(observed.length, 0);
  const changedBackground = clone(saved);
  changedBackground.settings.customBackground = 'data:image/png;base64,ZGVm';
  mock.external(changedBackground);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].settings.customBackground, changedBackground.settings.customBackground);
  const changedPayload = clone(saved);
  changedPayload.settings.showClock = false;
  mock.external(changedPayload);
  assert.equal(observed.length, 2);
  assert.equal(observed[1].settings.showClock, false);
  const failed = empty();
  failed.revision = 10;
  mock.fail();
  await assert.rejects(repository.save(failed), /QUOTA_BYTES/);
  failed.revision = 11;
  mock.external(failed);
  assert.equal(observed.length, 3);
  repository.dispose();
});

test('preview localStorage переживает перезагрузку и сообщает ошибки JSON и квоты', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  let quota = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) {
        if (quota) throw new Error('QuotaExceededError');
        values.set(key, value);
      }
    }
  });
  const repository = createRepository(null);
  try {
    assert.equal(await repository.readRaw(), null);
    const state = empty();
    state.settings.background = 'midnight';
    await repository.save(state);
    assert.equal((await repository.load()).settings.background, 'midnight');
    quota = true;
    await assert.rejects(repository.save(state), /QuotaExceededError/);
    values.set('tabloState', '{broken');
    await assert.rejects(repository.load(), /JSON/);
    assert.equal(await repository.readRaw(), '{broken');
    await assert.rejects(repository.save(state), /JSON/);
    assert.equal(values.get('tabloState'), '{broken');
  } finally {
    repository.dispose();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
