import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDefaultState } from '../src/model.js';

const source = readFileSync(new URL('../src/search.js', import.meta.url), 'utf8');
const providersSource = readFileSync(new URL('../src/search-engines.js', import.meta.url), 'utf8');
const weatherPreviewSource = readFileSync(new URL('../src/weather-preview.js', import.meta.url), 'utf8');
const legacy = () => ({ schemaVersion: 1, revision: 19, showSearch: false, showClock: false, showWeather: true, openInNewTab: true, width: 'fluid', tileSize: 'small', searchEngine: 'google' });

function load(value, { body = true, form = true, weatherPreview } = {}) {
  let stored = value === undefined ? null : JSON.stringify(value);
  const writes = [];
  const handlers = new Map();
  function element(tagName) {
    return {
      tagName: tagName.toUpperCase(), dataset: {}, children: [], attributes: {}, handlers: new Map(),
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      replaceChildren(...children) { this.children = children; for (const child of children) child.parentElement = this; },
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
      addEventListener(name, handler) { this.handlers.set(name, handler); },
      contains(node) { return node === this || this.children.some(child => child.contains(node)); },
      closest(selector) { return this.tagName === 'BUTTON' && selector === 'button[data-engine]' && this.dataset.engine ? this : this.parentElement?.closest(selector) || null; },
      querySelectorAll() { return this.children.filter(child => child.tagName === 'BUTTON'); },
      querySelector(selector) { return this.querySelectorAll().find(child => selector === `[data-engine="${child.dataset.engine}"]` || selector === `button[data-engine="${child.dataset.engine}"]`) || null; },
      focus() { document.activeElement = this; }
    };
  }
  const engines = element('div');
  const input = { value: '' };
  const search = { hidden: false, addEventListener(name, handler) { handlers.set(name, handler); } };
  const root = { dataset: {} };
  const document = {
    documentElement: root,
    body: body ? { dataset: {} } : null,
    activeElement: null,
    createElement: element,
    getElementById(id) { return !form ? null : id === 'search-form' ? search : id === 'search-input' ? input : id === 'search-engines' ? engines : null; }
  };
  const context = vm.createContext({
    document, URL,
    localStorage: {
      getItem(key) { if (key === 'tabloWeatherPreview') return weatherPreview === undefined ? null : JSON.stringify(weatherPreview); assert.equal(key, 'tabloSearchPreferences'); return stored; },
      setItem(key, value) { assert.equal(key, 'tabloSearchPreferences'); stored = value; writes.push(JSON.parse(value)); }
    }
  });
  vm.runInContext(providersSource, context);
  vm.runInContext(source, context);
  if (weatherPreview !== undefined) vm.runInContext(weatherPreviewSource, context);
  const button = id => engines.children.find(button => button.dataset.engine === id);
  const click = id => engines.handlers.get('click')({ target: button(id) });
  const enabled = () => engines.children.map(button => button.dataset.engine);
  const selected = () => engines.children.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.engine);
  return { api: context.tabloSearch, root, document, search, input, engines, button, click, enabled, selected, handlers, writes, get stored() { return stored === null ? null : JSON.parse(stored); } };
}

test('старый ранний кэш из девяти полей получает недельный вид до разбора body и сохраняет остальные предпочтения', () => {
  const before = legacy();
  const preview = load(before, { body: false, form: false });
  assert.deepEqual(preview.root.dataset, { showSearch: 'false', showClock: 'false', showWeather: 'true', weatherLayout: 'week', clockRow: 'false', boardWidth: 'fluid', tileSize: 'small', settingsRevision: '19' });
  assert.deepEqual(preview.stored, before);
  assert.equal(preview.writes.length, 0);
});

test('новый ранний кэш восстанавливает недельный или компактный вид без сброса поиска и размеров', () => {
  for (const weatherLayout of ['week', 'compact']) {
    const preview = load({ ...legacy(), weatherLayout });
    assert.equal(preview.root.dataset.weatherLayout, weatherLayout);
    assert.equal(preview.root.dataset.clockRow, String(weatherLayout === 'compact'));
    assert.equal(preview.search.hidden, true);
    assert.equal(preview.input.placeholder, 'Поиск в Google');
    assert.deepEqual(preview.selected(), ['google']);
    assert.deepEqual(preview.enabled(), ['google', 'yandex']);
    assert.deepEqual(preview.document.body.dataset, { width: 'fluid', size: 'small' });
    assert.equal(preview.root.dataset.settingsRevision, '19');
  }
});

test('ранняя строка часов зависит от часов, включённой погоды и компактного вида', () => {
  for (const showClock of [false, true]) {
    for (const showWeather of [false, true]) {
      for (const weatherLayout of ['week', 'compact']) {
        const preview = load({ ...legacy(), showClock, showWeather, weatherLayout }, { body: false, form: false });
        assert.equal(preview.root.dataset.clockRow, String(showClock || showWeather && weatherLayout === 'compact'));
        assert.equal(preview.root.dataset.showClock, String(showClock));
        assert.equal(preview.root.dataset.showWeather, String(showWeather));
      }
    }
  }
});

test('применение настроек сохраняет вид погоды и список поисковиков и восстанавливает его при следующем открытии', () => {
  const preview = load(legacy());
  const settings = { ...createDefaultState().settings, showClock: false, showWeather: true, showSearch: false, openInNewTab: true, width: 'compact', tileSize: 'large', searchEngine: 'google', weatherLayout: 'compact' };
  preview.api.apply(settings, 20);
  assert.equal(preview.writes.length, 1);
  assert.deepEqual(preview.stored, { schemaVersion: 1, revision: 20, showSearch: false, showClock: false, showWeather: true, openInNewTab: true, width: 'compact', tileSize: 'large', searchEngine: 'google', weatherLayout: 'compact', searchEngines: ['google', 'yandex'] });
  const reopened = load(preview.stored, { body: false, form: false });
  assert.equal(reopened.root.dataset.weatherLayout, 'compact');
  assert.equal(reopened.root.dataset.clockRow, 'true');
  assert.equal(reopened.root.dataset.boardWidth, 'compact');
  assert.equal(reopened.root.dataset.tileSize, 'large');
  assert.equal(reopened.root.dataset.settingsRevision, '20');
  assert.equal(reopened.writes.length, 0);
});

test('отключённая погода не оставляет раннюю строку при скрытых часах независимо от вида', () => {
  const preview = load({ ...legacy(), weatherLayout: 'compact' });
  for (const weatherLayout of ['compact', 'week']) {
    preview.api.apply({ ...createDefaultState().settings, showClock: false, showWeather: false, weatherLayout }, 20);
    assert.equal(preview.root.dataset.clockRow, 'false');
    assert.equal(preview.root.dataset.showWeather, 'false');
    assert.equal(preview.root.dataset.weatherLayout, weatherLayout);
  }
});

test('неподдерживаемый вид и неизвестные поля раннего кэша не подменяют безопасные defaults', () => {
  for (const value of [{ ...legacy(), weatherLayout: 'weekly' }, { ...legacy(), weatherLayout: null }, { ...legacy(), weatherLayout: 1 }, { ...legacy(), weatherLayout: 'week', unknown: true }]) {
    const preview = load(value, { body: false, form: false });
    assert.equal(preview.root.dataset.settingsRevision, '0');
    assert.equal(preview.root.dataset.weatherLayout, 'week');
    assert.equal(preview.root.dataset.showClock, 'true');
    assert.equal(preview.root.dataset.boardWidth, 'wide');
  }
});

test('миграция раннего кэша сохраняет отправку поиска в выбранной системе и в новой вкладке', () => {
  const preview = load(legacy());
  const requests = [];
  preview.api.connect({ submit(...values) { requests.push(values); } });
  preview.api.mount();
  preview.input.value = '  пример запроса  ';
  let prevented = false;
  preview.handlers.get('submit')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(requests, [['пример запроса', 'google', true]]);
  assert.equal(preview.writes.length, 0);
});

test('погодный снимок той же ревизии сохраняет компактный вид при миграции старого поискового кэша', () => {
  const weatherPreview = { schemaVersion: 2, revision: 19, allowed: true, city: createDefaultState().settings.weatherCity, weather: null, provider: 'open-meteo', layout: 'compact' };
  const preview = load(legacy(), { body: false, form: false, weatherPreview });
  assert.equal(preview.root.dataset.weatherLayout, 'compact');
  assert.equal(preview.root.dataset.clockRow, 'true');
  assert.equal(preview.root.dataset.settingsRevision, '19');
  assert.equal(preview.writes.length, 0);
  preview.api.mount();
  assert.equal(preview.root.dataset.weatherLayout, 'compact');
  assert.equal(preview.root.dataset.clockRow, 'true');
});

test('отстающий погодный снимок не возвращает старый вид и строку часов до загрузки приложения', () => {
  for (const weatherLayout of ['week', 'compact']) {
    const weatherPreview = { schemaVersion: 2, revision: 18, allowed: true, city: createDefaultState().settings.weatherCity, weather: null, provider: 'open-meteo', layout: weatherLayout === 'week' ? 'compact' : 'week' };
    const preview = load({ ...legacy(), weatherLayout }, { body: false, form: false, weatherPreview });
    assert.equal(preview.root.dataset.weatherLayout, weatherLayout);
    assert.equal(preview.root.dataset.clockRow, String(weatherLayout === 'compact'));
    assert.equal(preview.root.dataset.settingsRevision, '19');
  }
});

test('сохранённый компактный вид погоды не включает строку после отключения погоды и часов', () => {
  const weatherPreview = { schemaVersion: 2, revision: 19, allowed: true, city: createDefaultState().settings.weatherCity, weather: null, provider: 'metno', layout: 'compact' };
  const preview = load({ ...legacy(), showWeather: false }, { body: false, form: false, weatherPreview });
  assert.equal(preview.root.dataset.weatherLayout, 'compact');
  assert.equal(preview.root.dataset.showClock, 'false');
  assert.equal(preview.root.dataset.showWeather, 'false');
  assert.equal(preview.root.dataset.clockRow, 'false');
});

test('раннее переключение поисковика не сбрасывает компактный вид, восстановленный из погодного снимка', () => {
  const weatherPreview = { schemaVersion: 2, revision: 19, allowed: true, city: createDefaultState().settings.weatherCity, weather: null, provider: 'open-meteo', layout: 'compact' };
  const preview = load(legacy(), { weatherPreview });
  preview.api.mount();
  preview.click('yandex');
  assert.equal(preview.input.placeholder, 'Поиск в Яндексе');
  assert.equal(preview.root.dataset.weatherLayout, 'compact');
  assert.equal(preview.root.dataset.clockRow, 'true');
  assert.equal(preview.root.dataset.settingsRevision, '19');
  assert.equal(preview.writes.length, 0);
});

test('значки до основного модуля показывают только сохранённые включённые поисковики', () => {
  const cache = { ...legacy(), weatherLayout: 'compact', searchEngine: 'duckduckgo', searchEngines: ['bing', 'duckduckgo', 'ecosia'] };
  const preview = load(cache);
  assert.deepEqual(preview.enabled(), cache.searchEngines);
  assert.deepEqual(preview.selected(), ['duckduckgo']);
  assert.equal(preview.input.placeholder, 'Поиск в DuckDuckGo');
  assert.equal(preview.button('duckduckgo').children[0].src, 'assets/search/duckduckgo.svg');
  const settings = { ...createDefaultState().settings, searchEngine: 'ecosia', searchEngines: ['bing', 'duckduckgo', 'ecosia'] };
  preview.api.apply(settings, 20);
  const reopened = load(preview.stored);
  assert.deepEqual(reopened.selected(), ['ecosia']);
  assert.deepEqual(reopened.enabled(), cache.searchEngines);
});

test('каждая включённая система получает доступную кнопку с локальным значком и единственным активным состоянием', () => {
  const ids = ['google', 'yandex', 'bing', 'duckduckgo', 'brave', 'ecosia'];
  const preview = load({ ...legacy(), searchEngine: 'brave', searchEngines: ids });
  assert.deepEqual(preview.enabled(), ids);
  assert.deepEqual(preview.selected(), ['brave']);
  for (const id of ids) {
    const button = preview.button(id);
    assert.equal(button.type, 'button');
    assert.equal(button.className, 'search-engine');
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.title, button.getAttribute('aria-label'));
    const icon = button.children[0];
    assert.equal(icon.tagName, 'IMG');
    assert.match(icon.src, /^assets\//);
    assert.equal(icon.width, 24);
    assert.equal(icon.height, 24);
    assert.equal(icon.alt, '');
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    assert.equal(button.getAttribute('aria-pressed'), String(id === 'brave'));
  }
});

test('нажатие на вложенный значок переключает систему и не пересоздаёт остальные кнопки', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo', 'ecosia'] });
  preview.api.mount();
  const before = [...preview.engines.children];
  const choices = [];
  preview.api.connect({ select(...args) { choices.push(args); } });
  preview.engines.handlers.get('click')({ target: preview.button('ecosia').children[0] });
  assert.deepEqual(preview.selected(), ['ecosia']);
  assert.equal(preview.input.placeholder, 'Поиск в Ecosia');
  assert.equal(choices.length, 1);
  assert.equal(choices[0][0], 'ecosia');
  for (let index = 0; index < before.length; index++) assert.equal(preview.engines.children[index], before[index]);
  preview.click('ecosia');
  assert.equal(choices.length, 1);
});

test('переключение значка левой кнопкой сохраняет ввод запроса, не блокируя правый клик и фокус кнопок с клавиатуры', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo'] });
  preview.api.mount();
  preview.document.activeElement = preview.input;
  preview.input.value = 'Vienna weather';
  preview.input.selectionStart = 7;
  preview.input.selectionEnd = 14;
  let prevented = 0;
  const dispatch = button => preview.engines.handlers.get('mousedown')({ button, target: preview.button('duckduckgo').children[0], preventDefault() { prevented++; } });
  dispatch(0);
  assert.equal(prevented, 1);
  preview.click('duckduckgo');
  assert.deepEqual(preview.selected(), ['duckduckgo']);
  assert.equal(preview.document.activeElement, preview.input);
  assert.equal(preview.input.value, 'Vienna weather');
  assert.equal(preview.input.selectionStart, 7);
  assert.equal(preview.input.selectionEnd, 14);
  dispatch(2);
  assert.equal(prevented, 1);
  preview.button('google').focus();
  dispatch(0);
  assert.equal(prevented, 1);
});

test('делегированный клик игнорирует постороннюю кнопку и подставленную выключенную систему', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo'] });
  preview.api.mount();
  const choices = [];
  preview.api.connect({ select(...args) { choices.push(args); } });
  const outsider = preview.document.createElement('button');
  outsider.dataset.engine = 'duckduckgo';
  preview.engines.handlers.get('click')({ target: outsider });
  const disabled = preview.document.createElement('button');
  disabled.dataset.engine = 'bing';
  preview.engines.append(disabled);
  preview.engines.handlers.get('click')({ target: disabled });
  assert.deepEqual(choices, []);
  assert.deepEqual(preview.selected(), ['google']);
  assert.equal(preview.input.placeholder, 'Поиск в Google');
  assert.equal(preview.writes.length, 0);
});

test('при изменении доступных систем фокус остаётся в кнопках и переходит на выбранную при удалении прежней', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo', 'ecosia'] });
  preview.button('duckduckgo').focus();
  preview.api.apply({ ...createDefaultState().settings, searchEngine: 'google', searchEngines: ['google', 'duckduckgo'] }, 20);
  assert.deepEqual(preview.enabled(), ['google', 'duckduckgo']);
  assert.equal(preview.document.activeElement, preview.button('duckduckgo'));
  preview.api.apply({ ...createDefaultState().settings, searchEngine: 'bing', searchEngines: ['google', 'bing'] }, 21);
  assert.deepEqual(preview.enabled(), ['google', 'bing']);
  assert.deepEqual(preview.selected(), ['bing']);
  assert.equal(preview.document.activeElement, preview.button('bing'));
});

test('повреждённый список раннего кэша не подставляет неизвестные или выключенные поисковики', () => {
  for (const searchEngines of [null, [], ['google', 'unknown'], ['google', 'google'], ['bing']]) {
    const preview = load({ ...legacy(), searchEngines });
    assert.equal(preview.root.dataset.settingsRevision, '0');
    assert.deepEqual(preview.enabled(), ['google', 'yandex']);
  }
  const preview = load(legacy());
  const sparse = ['google'];
  sparse.length = 2;
  preview.api.apply({ ...createDefaultState().settings, searchEngine: 'google', searchEngines: sparse }, 20);
  assert.equal(preview.root.dataset.settingsRevision, '19');
  assert.deepEqual(preview.enabled(), ['google', 'yandex']);
});

test('старый выбранный DuckDuckGo мигрирует в доступный список без замены поисковика', () => {
  const preview = load({ ...legacy(), searchEngine: 'duckduckgo' });
  assert.deepEqual(preview.selected(), ['duckduckgo']);
  assert.deepEqual(preview.enabled(), ['google', 'yandex', 'duckduckgo']);
});

test('выбор и запрос до загрузки приложения не теряются при подключении обработчиков', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo'] });
  preview.api.mount();
  preview.input.value = '  Вена + folders & icons  ';
  preview.click('duckduckgo');
  preview.handlers.get('submit')({ preventDefault() {} });
  const selected = [];
  const submitted = [];
  preview.api.connect({ select(...args) { selected.push(args); }, submit(...args) { submitted.push(args); } });
  assert.equal(selected.length, 1);
  assert.equal(selected[0][0], 'duckduckgo');
  assert.deepEqual(submitted, [['Вена + folders & icons', 'duckduckgo', true]]);
  assert.equal(preview.input.value, '  Вена + folders & icons  ');
});

test('отключение ожидающего выбора сбрасывает его и не отправляет запрос выключенному поисковику', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo'] });
  preview.api.mount();
  preview.click('duckduckgo');
  preview.input.value = 'saved query';
  preview.handlers.get('submit')({ preventDefault() {} });
  preview.api.apply({ ...createDefaultState().settings, searchEngine: 'google', searchEngines: ['google'] }, 20);
  const choices = [];
  const queries = [];
  preview.api.connect({ select(...args) { choices.push(args); }, submit(...args) { queries.push(args); } });
  assert.deepEqual(choices, []);
  assert.deepEqual(queries, [['saved query', 'google', true]]);
  assert.deepEqual(preview.selected(), ['google']);
  assert.deepEqual(preview.enabled(), ['google']);
});

test('запоздавшее подтверждение выбора не возвращает старую ревизию и список', () => {
  const preview = load({ ...legacy(), searchEngines: ['google', 'duckduckgo'] });
  preview.api.mount();
  let ticket;
  preview.api.connect({ select(id, value) { ticket = value; } });
  preview.click('duckduckgo');
  preview.api.apply({ ...createDefaultState().settings, searchEngine: 'bing', searchEngines: ['bing', 'duckduckgo'] }, 21);
  preview.api.settleEngine(ticket, { ...createDefaultState().settings, searchEngine: 'duckduckgo', searchEngines: ['google', 'duckduckgo'] }, 20);
  assert.equal(preview.root.dataset.settingsRevision, '21');
  assert.deepEqual(preview.selected(), ['bing']);
  assert.deepEqual(preview.enabled(), ['bing', 'duckduckgo']);
});
