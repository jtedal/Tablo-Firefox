import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createWeatherService } from '../src/weather.js';
import { createDefaultState } from '../src/model.js';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const catalogSource = readFileSync(new URL('../src/locales/app.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
const errorsSource = readFileSync(new URL('../src/locales/errors.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../src/locales/core.js', import.meta.url), 'utf8');

function setup({ appWrapper = false } = {}) {
  const values = new Map();
  const context = vm.createContext({
    Intl,
    navigator: { language: 'ru' },
    localStorage: { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } }
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(catalogSource, context);
  vm.runInContext(errorsSource, context);
  vm.runInContext(i18nSource, context);
  context.translations = new Map();
  vm.runInContext(appWrapper ? functionSource('t') : 'const t = (key, params = {}) => tabloI18n.t(key, params);', context);
  vm.runInContext('const locale = () => tabloI18n.locale();', context);
  return context;
}

function functionSource(name) {
  const match = new RegExp(`function ${name}\\([^]*?\\n\\}`).exec(appSource);
  assert.ok(match, `Function ${name} is present`);
  return match[0];
}

test('каталог приложения имеет одинаковые ключи и именованные параметры для русского и английского', () => {
  const context = setup();
  const { ru, en } = context.tabloLocaleApp;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  const parameters = value => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(ru)) {
    assert.match(key, /^app\./);
    assert.equal(typeof en[key], 'string');
    assert.ok(ru[key].length && en[key].length);
    assert.deepEqual(parameters(en[key]), parameters(ru[key]), key);
    assert.doesNotMatch(en[key], /[А-Яа-яЁё]/, key);
  }
});

test('все статические ссылки на app-переводы существуют в обоих языках', () => {
  const context = setup();
  const keys = new Set([...appSource.matchAll(/['"](app\.[A-Za-z0-9_.]+)['"]/g)].map(match => match[1]));
  for (const key of keys) {
    assert.ok(Object.hasOwn(context.tabloLocaleApp.ru, key), key);
    assert.ok(Object.hasOwn(context.tabloLocaleApp.en, key), key);
  }
});

test('счётчик сайтов использует русские формы и английское единственное или множественное число', () => {
  const context = setup();
  vm.runInContext(functionSource('countLabel'), context);
  for (const [count, expected] of [[0, '0 сайтов'], [1, '1 сайт'], [2, '2 сайта'], [5, '5 сайтов'], [11, '11 сайтов'], [21, '21 сайт'], [22, '22 сайта'], [25, '25 сайтов'], [101, '101 сайт'], [111, '111 сайтов']]) {
    assert.equal(context.countLabel(count), expected);
  }
  context.tabloI18n.apply({ language: 'en' }, 1);
  for (const count of [0, 1, 2, 11, 21, 101]) assert.equal(context.countLabel(count), `${count} ${count === 1 ? 'site' : 'sites'}`);
});

test('перевод подтверждений сохраняет пользовательское название и пересчитывает количество при смене языка', () => {
  const context = setup();
  const nodes = new Map(['confirm-title', 'confirm-text', 'confirm-action'].map(id => [id, {}]));
  context.$ = id => nodes.get(id);
  context.confirmView = { title: 'app.folder.deleteTitle', text: 'app.folder.deleteBody', label: 'app.action.delete', params: { title: 'Работа <important>' } };
  vm.runInContext(functionSource('countLabel'), context);
  vm.runInContext(functionSource('renderConfirm'), context);
  context.renderConfirm();
  assert.equal(nodes.get('confirm-text').textContent, 'Папка «Работа <important>» и все сайты внутри неё будут удалены.');
  context.tabloI18n.apply({ language: 'en' }, 1);
  context.renderConfirm();
  assert.equal(nodes.get('confirm-text').textContent, 'The folder “Работа <important>” and all its sites will be deleted.');
  assert.equal(nodes.get('confirm-action').textContent, 'Delete');
  vm.runInContext("confirmView = { title: 'app.backup.restoreTitle', text: 'app.backup.restoreBody', label: 'app.action.restore', params: () => ({ sites: countLabel(21) }) };", context);
  context.renderConfirm();
  assert.match(nodes.get('confirm-text').textContent, /21 sites/);
  context.tabloI18n.apply({ language: 'ru' }, 2);
  context.renderConfirm();
  assert.match(nodes.get('confirm-text').textContent, /21 сайт\./);
});

test('применение языка защищает синхронные события от повторного render и обновляет тексты один раз', () => {
  const context = setup();
  context.document = { documentElement: {}, querySelectorAll() { return []; } };
  context.state = { settings: { language: 'en' }, revision: 1 };
  context.applyingLanguage = false;
  context.displayedLocale = 'ru';
  let refreshes = 0;
  let notifications = 0;
  context.refreshLocalizedMessages = () => { refreshes++; };
  context.tabloI18n.onChange(() => { notifications++; assert.equal(context.applyingLanguage, true); });
  vm.runInContext(functionSource('applyLanguage'), context);
  context.applyLanguage();
  assert.equal(context.displayedLocale, 'en');
  assert.equal(context.applyingLanguage, false);
  assert.equal(refreshes, 1);
  assert.equal(notifications, 1);
  context.applyLanguage();
  assert.equal(refreshes, 1);
  assert.equal(notifications, 1);
});

test('ошибка HTTP 503, полученная на русском, повторно переводится в уведомлении и сохранённом статусе без потери диагностики', async () => {
  const context = setup({ appWrapper: true });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'tabloI18n');
  Object.defineProperty(globalThis, 'tabloI18n', { configurable: true, value: context.tabloI18n });
  try {
    const service = createWeatherService({ storage: {}, fetchImpl: async () => ({ ok: false, status: 503 }) });
    let message;
    await assert.rejects(service.getWeather(createDefaultState('ru').settings.weatherCity), error => { message = error.message; return true; });
    assert.equal(message, 'Сервис погоды недоступен (HTTP 503).');
    const nodes = new Map(['toast', 'toast-message', 'toast-action', 'save-status', 'icons-status', 'editor-error', 'storage-error-text', 'city-results', 'city-status'].map(id => [id, { textContent: '', matches() { return false; }, showPopover() {}, replaceChildren() {} }]));
    const foreign = 'NetworkError: The operation could not be completed.';
    nodes.get('icons-status').textContent = foreign;
    context.$ = id => nodes.get(id);
    context.retranslate = text => context.tabloI18n.retranslate(text);
    context.clearTimeout = () => {};
    context.setTimeout = () => 1;
    context.toastTimer = null;
    context.mountPopover = () => {};
    context.animateSurface = () => {};
    context.hideToast = () => {};
    context.cityRequest = null;
    context.metadataRequest = null;
    context.editor = null;
    context.movingId = null;
    context.iconBatchOrigins = [];
    context.renderConfirm = () => {};
    context.closeMenu = () => {};
    context.updateClock = () => {};
    vm.runInContext(functionSource('translatedMessage'), context);
    vm.runInContext(functionSource('showToast'), context);
    vm.runInContext(functionSource('refreshLocalizedMessages'), context);
    context.tabloI18n.apply({ language: 'en' }, 1);
    context.showToast(message);
    assert.equal(nodes.get('toast-message').textContent, 'Weather service unavailable (HTTP 503).');
    context.refreshLocalizedMessages();
    assert.equal(nodes.get('icons-status').textContent, foreign);
    context.tabloI18n.apply({ language: 'ru' }, 2);
    context.refreshLocalizedMessages();
    assert.equal(nodes.get('toast-message').textContent, message);
    assert.equal(nodes.get('icons-status').textContent, foreign);
    const backup = context.t('app.backup.failed', { error: message });
    context.tabloI18n.apply({ language: 'en' }, 3);
    context.showToast(backup);
    assert.equal(nodes.get('toast-message').textContent, 'Could not read the backup: Weather service unavailable (HTTP 503).');
    context.tabloI18n.apply({ language: 'ru' }, 4);
    context.refreshLocalizedMessages();
    assert.equal(nodes.get('toast-message').textContent, backup);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'tabloI18n', previous);
    else delete globalThis.tabloI18n;
  }
});

test('название пользователя, совпадающее с известной ошибкой, остаётся дословным в английском подтверждении', () => {
  const context = setup();
  const title = context.tabloI18n.t('Сервис погоды недоступен (HTTP {status}).', { status: 503 });
  context.tabloI18n.apply({ language: 'en' }, 1);
  const nodes = new Map(['confirm-title', 'confirm-text', 'confirm-action'].map(id => [id, {}]));
  context.$ = id => nodes.get(id);
  context.confirmView = { title: 'app.folder.deleteTitle', text: 'app.folder.deleteBody', label: 'app.action.delete', params: { title } };
  vm.runInContext(functionSource('renderConfirm'), context);
  context.renderConfirm();
  assert.equal(nodes.get('confirm-text').textContent, `The folder “${title}” and all its sites will be deleted.`);
});

test('включение поисковиков сохраняет выбор, а выключение текущего выбирает первый оставшийся без повторов', () => {
  const context = setup();
  context.tabloSearchEngines = globalThis.tabloSearchEngines;
  vm.runInContext(functionSource('updateEnabledSearchEngine'), context);
  const settings = { searchEngine: 'yandex', searchEngines: ['google', 'yandex'], language: 'ru', width: 'fluid' };
  const original = settings.searchEngines;
  context.updateEnabledSearchEngine(settings, 'brave', true);
  context.updateEnabledSearchEngine(settings, 'brave', true);
  assert.deepEqual([...settings.searchEngines], ['google', 'yandex', 'brave']);
  assert.equal(settings.searchEngine, 'yandex');
  context.updateEnabledSearchEngine(settings, 'yandex', false);
  assert.deepEqual([...settings.searchEngines], ['google', 'brave']);
  assert.equal(settings.searchEngine, 'google');
  assert.deepEqual(original, ['google', 'yandex']);
  assert.equal(settings.language, 'ru');
  assert.equal(settings.width, 'fluid');
});

test('защита использует актуальный список: последний поисковик не удаляется, устаревший или неизвестный выбор отклоняется', () => {
  const context = setup();
  context.tabloSearchEngines = globalThis.tabloSearchEngines;
  vm.runInContext(functionSource('updateEnabledSearchEngine'), context);
  vm.runInContext(functionSource('selectSearchEngine'), context);
  const latest = { searchEngine: 'google', searchEngines: ['google'] };
  const before = JSON.stringify(latest);
  assert.throws(() => context.updateEnabledSearchEngine(latest, 'google', false), /хотя бы один/);
  assert.equal(JSON.stringify(latest), before);
  for (const id of ['bing', 'unknown', null]) {
    assert.throws(() => context.selectSearchEngine(latest, id), /больше не включён/);
    assert.equal(JSON.stringify(latest), before);
  }
  context.tabloI18n.apply({ language: 'en' }, 1);
  assert.throws(() => context.updateEnabledSearchEngine(latest, 'google', false), /at least one search engine/);
  assert.equal(JSON.stringify(latest), before);
  context.selectSearchEngine(latest, 'google');
  assert.equal(latest.searchEngine, 'google');
});
