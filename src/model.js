import { t, resolveLocale } from './localize.js';
import './search-engines.js';

const SEARCH_ENGINES = globalThis.tabloSearchEngines;

const DEFAULT_WEATHER_CITY = Object.freeze({
  name: 'Вена',
  country: 'Австрия',
  countryCode: 'AT',
  admin1: 'Вена',
  latitude: 48.20849,
  longitude: 16.37208,
  timezone: 'Europe/Vienna'
});

const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',
  background: 'aurora',
  tileSize: 'medium',
  width: 'wide',
  showClock: true,
  showWeather: true,
  weatherProvider: 'open-meteo',
  weatherLayout: 'week',
  weatherCity: DEFAULT_WEATHER_CITY,
  showSearch: true,
  searchEngine: 'yandex',
  searchEngines: Object.freeze([...SEARCH_ENGINES.defaults]),
  openInNewTab: false,
  customBackground: null,
  dim: 20
});

const MAX_ITEMS = 500;
const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
const MAX_FAVICON_BYTES = 64 * 1024;
const MAX_TOTAL_FAVICON_BYTES = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(t(message));
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(t('{label}: ожидается объект.', { label: t(label) }));
  }
}

function keys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(t('{label}: неизвестное поле «{key}».', { label: t(label), key }));
  }
}

function title(value, label = 'Название') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    fail(t('{label}: укажите от 1 до 80 символов.', { label: t(label) }));
  }
  return value.trim();
}

function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) {
    fail('Некорректный идентификатор плитки.');
  }
  return value;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) fail('Генератор идентификаторов недоступен.');
  globalThis.crypto.getRandomValues(bytes);
  return `tile-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
}

function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    fail('Цвет плитки должен быть в формате #rrggbb.');
  }
  return value.toLowerCase();
}

function icon(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('Некорректный значок плитки.');
  }
  return value.trim();
}

function favicon(value) {
  if (value === null) return null;
  if (typeof value !== 'string') fail('Некорректный значок сайта.');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) fail('Значок сайта должен быть PNG в формате data:image/png;base64.');
  const encoded = match[1];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.length / 4 * 3 - padding > MAX_FAVICON_BYTES) fail('Значок сайта превышает 64 КБ.');
  try {
    if (btoa(atob(encoded)) !== encoded) fail('Некорректный base64 значка сайта.');
  } catch {
    fail('Некорректный base64 значка сайта.');
  }
  return value;
}

export function validateWeatherCity(value) {
  if (value === null) return null;
  record(value, 'Город');
  keys(value, ['name', 'country', 'countryCode', 'admin1', 'latitude', 'longitude', 'timezone'], 'Город');
  const result = {};
  for (const [key, max, optional] of [['name', 120, false], ['country', 120, false], ['countryCode', 2, false], ['admin1', 160, true], ['timezone', 100, false]]) {
    if (typeof value[key] !== 'string' || (!optional && !value[key].trim()) || value[key].trim().length > max || /[\u0000-\u001f\u007f]/.test(value[key])) {
      fail(t('Некорректное поле города «{key}».', { key }));
    }
    result[key] = value[key].trim();
  }
  if (!/^[A-Z]{2}$/.test(result.countryCode)) fail('Некорректный код страны.');
  for (const [key, limit] of [['latitude', 90], ['longitude', 180]]) {
    if (!Number.isFinite(value[key]) || Math.abs(value[key]) > limit) fail('Некорректные координаты города.');
    result[key] = value[key];
  }
  try {
    new Intl.DateTimeFormat('ru', { timeZone: result.timezone });
  } catch {
    fail('Некорректный часовой пояс города.');
  }
  return result;
}

export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 4096) {
    fail('Укажите адрес сайта.');
  }
  let value = input.trim();
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) fail('В адресе сайта недопустимые символы.');
  if (value.startsWith('//')) value = `https:${value}`;
  else if (!/^https?:\/\//i.test(value)) {
    const scheme = value.match(/^([a-z][a-z\d+.-]*):/i);
    const hostWithPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(value);
    if (scheme && !hostWithPort) fail('Допускаются только адреса HTTP и HTTPS.');
    value = `https://${value}`;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('Некорректный адрес сайта.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    fail('Допускаются только адреса HTTP и HTTPS.');
  }
  if (parsed.username || parsed.password || value.match(/^https?:\/\/([^/?#]*)/i)?.[1].includes('@')) {
    fail('Адрес сайта не должен содержать логин или пароль.');
  }
  return parsed.href;
}

export function displayHost(url) {
  return new URL(normalizeUrl(url)).hostname.replace(/^www\./i, '');
}

export function makeSite({ title: siteTitle, url, color: siteColor = '#5365dd', icon: siteIcon = 'auto', favicon: siteFavicon = null }) {
  const normalizedUrl = normalizeUrl(url);
  return {
    id: newId(),
    type: 'site',
    title: title(siteTitle || displayHost(normalizedUrl)),
    url: normalizedUrl,
    color: color(siteColor),
    icon: icon(siteIcon),
    favicon: favicon(siteFavicon)
  };
}

export function makeFolder(folderTitle = t('Новая папка')) {
  return { id: newId(), type: 'folder', title: title(folderTitle), children: [] };
}

export function createDefaultState(language = 'auto') {
  if (!['auto', 'ru', 'en'].includes(language)) fail(t('Некорректная настройка «{key}».', { key: 'language' }));
  const english = resolveLocale(language) === 'en';
  const work = makeFolder(english ? 'Work' : 'Работа');
  work.children = [
    makeSite({ title: 'GitHub', url: 'https://github.com', color: '#232735' }),
    makeSite({ title: 'Figma', url: 'https://figma.com', color: '#6c55e8' }),
    makeSite({ title: 'Notion', url: 'https://notion.so', color: '#e5e2dc' })
  ];
  return {
    schemaVersion: 1,
    revision: 0,
    items: [
      makeSite(english ? { title: 'Google', url: 'https://google.com', color: '#f5f5f5' } : { title: 'Яндекс', url: 'https://ya.ru', color: '#fc3f45' }),
      makeSite({ title: 'YouTube', url: 'https://youtube.com', color: '#f02d3a' }),
      makeSite(english ? { title: 'Reddit', url: 'https://reddit.com', color: '#ff4500' } : { title: 'Telegram', url: 'https://web.telegram.org', color: '#269ed8' }),
      makeSite({ title: 'Wikipedia', url: 'https://wikipedia.org', color: '#e9ebef' }),
      work,
      makeSite({ title: 'Twitch', url: 'https://twitch.tv', color: '#9146ff' }),
      makeSite(english ? { title: 'Gmail', url: 'https://mail.google.com', color: '#f5f5f5' } : { title: 'VK', url: 'https://vk.com', color: '#0077ff' }),
      makeSite(english ? { title: 'Amazon', url: 'https://amazon.com', color: '#232f3e' } : { title: 'Ozon', url: 'https://ozon.ru', color: '#005bff' })
    ],
    settings: { ...DEFAULT_SETTINGS, language, searchEngine: english ? 'google' : 'yandex', searchEngines: [...DEFAULT_SETTINGS.searchEngines], weatherCity: { ...DEFAULT_WEATHER_CITY, ...(english ? { name: 'Vienna', country: 'Austria', admin1: 'Vienna' } : {}) } }
  };
}

function validateBackground(value) {
  if (value === null) return null;
  if (typeof value !== 'string') fail('Некорректное фоновое изображение.');
  const match = /^data:image\/(?:jpeg|png|webp|avif);base64,([a-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[1] || match[1].length % 4 !== 0) fail('Фон должен быть изображением в формате data:image.');
  const encoded = match[1];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.length / 4 * 3 - padding > MAX_BACKGROUND_BYTES) fail('Фоновое изображение превышает 5 МБ.');
  return value;
}

function validateSettings(value) {
  record(value, 'Настройки');
  keys(value, Object.keys(DEFAULT_SETTINGS), 'Настройки');
  const result = { ...DEFAULT_SETTINGS, ...value };
  const choices = {
    language: ['auto', 'ru', 'en'],
    background: ['aurora', 'dawn', 'forest', 'midnight'],
    tileSize: ['small', 'medium', 'large'],
    width: ['compact', 'wide', 'fluid'],
    searchEngine: SEARCH_ENGINES.ids,
    weatherProvider: ['open-meteo', 'metno'],
    weatherLayout: ['compact', 'week']
  };
  for (const [key, values] of Object.entries(choices)) {
    if (!values.includes(result[key])) fail(t('Некорректная настройка «{key}».', { key }));
  }
  const enabled = Object.hasOwn(value, 'searchEngines') ? value.searchEngines : [...new Set([...SEARCH_ENGINES.defaults, result.searchEngine])];
  if (!Array.isArray(enabled) || !enabled.length || enabled.length > SEARCH_ENGINES.ids.length || [...enabled].some(id => !SEARCH_ENGINES.ids.includes(id)) || new Set(enabled).size !== enabled.length || !enabled.includes(result.searchEngine)) fail(t('Некорректная настройка «{key}».', { key: 'searchEngines' }));
  result.searchEngines = [...enabled];
  for (const key of ['showClock', 'showWeather', 'showSearch', 'openInNewTab']) {
    if (typeof result[key] !== 'boolean') fail(t('Настройка «{key}» должна быть логической.', { key }));
  }
  if (!Number.isFinite(result.dim) || result.dim < 0 || result.dim > 70) fail('Затемнение фона должно быть от 0 до 70.');
  result.customBackground = validateBackground(result.customBackground);
  result.weatherCity = validateWeatherCity(result.weatherCity);
  return result;
}

export function validateState(value) {
  record(value, 'Данные');
  keys(value, ['schemaVersion', 'revision', 'items', 'settings'], 'Данные');
  if (value.schemaVersion !== 1) fail('Неподдерживаемая версия данных.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('Некорректная ревизия данных.');
  if (!Array.isArray(value.items)) fail('Список плиток отсутствует.');
  const seen = new Set();
  let count = 0;
  let faviconBytes = 0;
  function item(raw, isChild) {
    record(raw, 'Плитка');
    if (++count > MAX_ITEMS) fail('Допускается не более 500 плиток, включая содержимое папок.');
    const itemId = id(raw.id);
    if (seen.has(itemId)) fail('Идентификаторы плиток не должны повторяться.');
    seen.add(itemId);
    if (raw.type === 'site') {
      keys(raw, ['id', 'type', 'title', 'url', 'color', 'icon', 'favicon'], 'Сайт');
      const siteFavicon = favicon(Object.hasOwn(raw, 'favicon') ? raw.favicon : null);
      if (siteFavicon) {
        const encoded = siteFavicon.slice(siteFavicon.indexOf(',') + 1);
        faviconBytes += encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
        if (faviconBytes > MAX_TOTAL_FAVICON_BYTES) fail('Общий размер значков сайтов превышает 2 МБ.');
      }
      return { id: itemId, type: 'site', title: title(raw.title), url: normalizeUrl(raw.url), color: color(raw.color), icon: icon(raw.icon), favicon: siteFavicon };
    }
    if (raw.type === 'folder' && !isChild) {
      keys(raw, ['id', 'type', 'title', 'children'], 'Папка');
      if (!Array.isArray(raw.children)) fail('Некорректное содержимое папки.');
      return { id: itemId, type: 'folder', title: title(raw.title), children: raw.children.map(child => item(child, true)) };
    }
    fail(isChild ? 'Вложенные папки не поддерживаются.' : 'Неизвестный тип плитки.');
  }
  return { schemaVersion: 1, revision: value.revision, items: value.items.map(raw => item(raw, false)), settings: validateSettings(value.settings) };
}

export function findItem(state, itemId) {
  for (let index = 0; index < state.items.length; index++) {
    const item = state.items[index];
    if (item.id === itemId) return { item, parentId: null, index };
    if (item.type === 'folder') {
      const childIndex = item.children.findIndex(child => child.id === itemId);
      if (childIndex !== -1) return { item: item.children[childIndex], parentId: item.id, index: childIndex };
    }
  }
  return null;
}

export function listItems(state, folderId = null) {
  if (folderId === null) return state.items;
  const folder = state.items.find(item => item.id === folderId && item.type === 'folder');
  if (!folder) fail('Папка не найдена.');
  return folder.children;
}

function change(state, operation) {
  const draft = validateState(state);
  operation(draft);
  const normalized = validateState(draft);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, normalized);
  return state;
}

export function addItem(state, item, parentId = null) {
  return change(state, draft => {
    if (parentId !== null && item.type !== 'site') fail('Вложенные папки не поддерживаются.');
    listItems(draft, parentId).push(item);
  });
}

export function updateItem(state, itemId, patch) {
  return change(state, draft => {
    const found = findItem(draft, itemId);
    if (!found) fail('Плитка не найдена.');
    record(patch, 'Изменения плитки');
    keys(patch, found.item.type === 'site' ? ['title', 'url', 'color', 'icon', 'favicon'] : ['title'], 'Изменения плитки');
    Object.assign(found.item, patch);
  });
}

export function deleteItem(state, itemId) {
  return change(state, draft => {
    const found = findItem(draft, itemId);
    if (!found) fail('Плитка не найдена.');
    listItems(draft, found.parentId).splice(found.index, 1);
  });
}

export function moveItem(state, itemId, parentId = null, index) {
  return change(state, draft => {
    const found = findItem(draft, itemId);
    if (!found) fail('Плитка не найдена.');
    if (parentId !== null && found.item.type !== 'site') fail('Вложенные папки не поддерживаются.');
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) fail('Некорректная позиция плитки.');
    listItems(draft, parentId);
    listItems(draft, found.parentId).splice(found.index, 1);
    const destination = listItems(draft, parentId);
    destination.splice(index === undefined ? destination.length : Math.min(index, destination.length), 0, found.item);
  });
}

export function createFolderFromItems(state, sourceId, targetId, folderTitle = t('Новая папка')) {
  return change(state, draft => {
    const source = findItem(draft, sourceId);
    const target = findItem(draft, targetId);
    if (!source || !target || sourceId === targetId || source.item.type !== 'site' || target.item.type !== 'site' || target.parentId !== null) {
      fail('Папку можно создать из двух сайтов; целевая плитка должна быть на главной странице.');
    }
    const folder = makeFolder(folderTitle);
    folder.children = [target.item, source.item];
    listItems(draft, source.parentId).splice(source.index, 1);
    const targetIndex = draft.items.findIndex(item => item.id === targetId);
    draft.items.splice(targetIndex, 1, folder);
  });
}

export function allSites(state) {
  return state.items.flatMap(item => item.type === 'site' ? [item] : item.children);
}
