import { createDefaultState, normalizeUrl, validateState, displayHost, makeSite, makeFolder, findItem, listItems, addItem, updateItem, deleteItem, moveItem, createFolderFromItems, allSites } from './model.js';
import { createRepository } from './storage.js';
import { requestSiteAccess, fetchSiteMetadata, sitePermissionOrigin } from './metadata.js';
import { createWeatherService, describeWeather } from './weather.js';
import { createMetWeatherService } from './met-weather.js';
import { animateSurface, stopSurfaceMotion, revealTablo } from './motion.js';
import { createTileDragPreview } from './tile-drag-preview.js';
import { createWeatherRenderer } from './weather-render.js';

const $ = id => document.getElementById(id);
const locale = () => globalThis.tabloI18n.locale();
const retranslate = text => globalThis.tabloI18n.retranslate(text);
const translations = new Map();
function t(key, params = {}) {
  const text = globalThis.tabloI18n.t(key, params);
  translations.set(text, { key, params });
  if (translations.size > 400) translations.delete(translations.keys().next().value);
  return text;
}

function translatedMessage({ key, params }) {
  if (key === 'app.icons.result') params = { ...params, next: t(iconBatchOrigins.length ? 'app.icons.moreOrigins' : 'app.icons.retryEditor') };
  if (key === 'app.backup.failed') params = { ...params, error: retranslate(params.error) };
  return t(key, params);
}
const ICONS = {
  settings: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m15 4 5 5M4 20l1-6L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 19Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
  folder: '<path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  home: '<path d="m3 10 9-7 9 7v10H3ZM9 20v-7h6v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  location: '<path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  cloud: '<path d="M6 19a5 5 0 0 1-1-9 7 7 0 0 1 13-2 5.5 5.5 0 0 1 0 11Z"/>',
  'cloud-sun': '<path d="M7 5V3M3 9H1m3-4L2.5 3.5M11 4l1-2"/><path d="M3 12a4 4 0 1 1 8-4M7 20a4 4 0 0 1-1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9Z"/>',
  fog: '<path d="M5 13a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 3 7M3 17h18M6 21h12"/>',
  rain: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 17l-1 3m6-3-1 3m6-3-1 3"/>',
  snow: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 18v4m-2-2h4m7-2v4m-2-2h4"/>',
  storm: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M12 13l-4 6h5l-2 4 7-8h-5l2-3"/>'
};
const PALETTE = ['#fc3f45','#d55876','#c16a3b','#40957b','#269ed8','#3266d8','#6c55e8','#9146ff','#343d56','#e5e2dc'];
const BACKGROUNDS = { aurora: 'app.background.aurora', dawn: 'app.background.dawn', forest: 'app.background.forest', midnight: 'app.background.midnight' };
const BRANDS = [
  [['ya.ru','yandex.ru','yandex.com'], 'Я', '#fc3f45'],
  [['youtube.com','youtu.be'], 'YouTube', '#f02d3a'],
  [['telegram.org','t.me'], 'Telegram', '#269ed8'],
  [['wikipedia.org'], 'W', '#e9ebef'],
  [['github.com'], 'GitHub', '#232735'],
  [['figma.com'], 'Figma', '#6c55e8'],
  [['notion.so','notion.site'], 'Notion', '#e5e2dc'],
  [['twitch.tv'], 'twitch', '#9146ff'],
  [['vk.com','vk.ru'], 'VK', '#0077ff'],
  [['ozon.ru'], 'OZON', '#005bff'],
  [['mail.ru'], '@', '#005ff9'],
  [['reddit.com'], 'reddit', '#e75b32'],
  [['netflix.com'], 'NETFLIX', '#b51d2c'],
  [['spotify.com'], 'Spotify', '#258749'],
  [['rutube.ru'], 'RUTUBE', '#253155'],
  [['discord.com','discord.gg'], 'Discord', '#5865f2']
];
const repository = createRepository();
const weatherService = createWeatherService();
const weatherServices = { 'open-meteo': weatherService, metno: createMetWeatherService() };
const WEATHER_PROVIDERS = { 'open-meteo': { name: 'Open-Meteo', origin: 'https://api.open-meteo.com/*', url: 'https://open-meteo.com/' }, metno: { name: 'MET Norway', origin: 'https://api.met.no/*', url: 'https://www.met.no/en' } };
let weatherPermissionProvider = null;
const weatherRenderer = createWeatherRenderer({ button: $('weather-button'), symbol: $('weather-symbol'), temperature: $('weather-temperature'), city: $('weather-city'), summary: $('weather-summary'), icon });
let weatherDetailSignature = null;
function weatherAccess(provider = state?.settings.weatherProvider || 'open-meteo') {
  return { origins: [WEATHER_PROVIDERS[provider].origin, 'https://geocoding-api.open-meteo.com/*'], data_collection: ['locationInfo'] };
}
let weatherAllowed = false;
let weatherView = { key: null, status: 'permission', data: null, error: null };
let weatherRequest;
let cityRequest;
let metadataRequest;
let iconBatchOrigins = [];
let state;
let currentFolder = null;
let editor = null;
let movingId = null;
let moveVersion = 0;
let editing = false;
let pending = 0;
let writeQueue = Promise.resolve();
let toastTimer;
let toastAction;
let confirmAction;
let confirmView;
let applyingLanguage = false;
let displayedLocale = locale();
let dragId = null;
let dragTarget = null;
let dragTimer;
let dragReady = false;
let dragPreview = null;
let dragSourceElement = null;
let dragPreviewFrame;
let suppressClickUntil = 0;
let appliedWallpaper = null;
let startupVersion = 0;
let weatherAccessVersion = 0;
let weatherAccessPending = true;
const modalStack = [];
const boundTiles = new WeakSet();
const boundAddTiles = new WeakSet();

function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
  return span;
}

function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
}

function button(text, handler, className = 'text-button', iconName) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  if (iconName) node.append(icon(iconName));
  const label = document.createElement('span');
  label.textContent = text;
  node.append(label);
  node.addEventListener('click', handler);
  return node;
}

function countLabel(count) {
  return t(`app.count.site.${new Intl.PluralRules(locale()).select(count)}`, { count });
}

function lock(callback) {
  return navigator.locks ? navigator.locks.request('tablo-state', callback) : callback();
}

function popoverParent() {
  return modalStack.filter(dialog => dialog.open).at(-1) || document.body;
}

function mountPopover(element) {
  stopSurfaceMotion(element);
  if (element.matches(':popover-open')) element.hidePopover();
  const parent = popoverParent();
  if (element.parentElement !== parent) parent.append(element);
}

function moveVisibleToast() {
  if ($('toast').hidden) return;
  mountPopover($('toast'));
  $('toast').showPopover();
}

function showDialog(id, origin) {
  closeMenu();
  const dialog = $(id);
  if (dialog.open && !dialog.hasAttribute('data-closing')) return;
  delete dialog.dataset.closing;
  dialog.inert = false;
  if (!dialog.open) {
    dialog.showModal();
    const index = modalStack.indexOf(dialog);
    if (index !== -1) modalStack.splice(index, 1);
    modalStack.push(dialog);
  }
  if (origin) {
    const rect = dialog.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, (origin.left + origin.width / 2 - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (origin.top + origin.height / 2 - rect.top) / rect.height * 100));
    dialog.style.transformOrigin = `${x}% ${y}%`;
  }
  animateSurface(dialog);
  moveVisibleToast();
}

function closeDialog(dialog) {
  if (!dialog.open) return Promise.resolve(true);
  if (dialog.id === 'folder-dialog') finishDrag(true);
  dialog.dataset.closing = '';
  dialog.inert = true;
  if (dialog.id === 'editor-dialog') metadataRequest?.abort();
  if (dialog.id === 'weather-dialog') cityRequest?.abort();
  return animateSurface(dialog, false, () => {
    dialog.close();
    delete dialog.dataset.closing;
    dialog.inert = false;
  });
}

function showToast(message, action, actionLabel = t('app.action.undo'), duration = 6000) {
  clearTimeout(toastTimer);
  const localized = translations.get(message);
  if (localized) message = translatedMessage(localized);
  message = retranslate(message);
  toastAction = action;
  $('toast-message').textContent = message;
  $('toast-action').hidden = !action;
  $('toast-action').textContent = actionLabel;
  mountPopover($('toast'));
  $('toast').hidden = false;
  if (!$('toast').matches(':popover-open')) $('toast').showPopover();
  animateSurface($('toast'));
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  stopSurfaceMotion($('toast'));
  if ($('toast').matches(':popover-open')) $('toast').hidePopover();
  $('toast').hidden = true;
  toastAction = null;
}

function applyChange(operation, message, undo = false) {
  pending++;
  document.body.classList.add('saving');
  document.body.classList.remove('save-failed');
  $('save-status').textContent = t('app.save.saving');
  const task = writeQueue.then(() => lock(async () => {
    let before;
    try {
      before = await repository.load();
      const next = structuredClone(before);
      operation(next);
      const saved = await repository.save(validateState(next));
      state = saved;
      render();
      if (message) {
        const revision = saved.revision;
        showToast(message, undo ? () => applyChange(draft => {
          if (draft.revision !== revision) throw new Error(t('app.save.changedUndo'));
          Object.assign(draft, structuredClone(before));
        }, t('app.save.undone')) : null);
      }
      return true;
    } catch (error) {
      if (before) state = before;
      if (state) render();
      document.body.classList.add('save-failed');
      showToast(error.message || t('app.save.failed'), null, '', 9000);
      return false;
    }
  })).finally(() => {
    pending--;
    if (!pending) {
      document.body.classList.remove('saving');
      $('save-status').textContent = document.body.classList.contains('save-failed') ? t('app.save.retry') : '';
    }
  });
  writeQueue = task.catch(() => {});
  return task;
}

function updateClock() {
  globalThis.tabloClock?.update();
}

function refreshLocalizedMessages() {
  cityRequest?.abort();
  cityRequest = null;
  $('city-results').replaceChildren();
  $('city-status').textContent = '';
  metadataRequest?.abort();
  if (editor) {
    editor.metadataPromise = null;
    $('editor-title').textContent = editor.type === 'folder' ? t(editor.id ? 'app.folder.renameTitle' : 'app.folder.create') : t(editor.id ? 'app.site.edit' : 'app.site.add');
    $('item-title').placeholder = t(editor.type === 'folder' ? 'app.folder.example' : 'app.site.title');
    $('metadata-button').disabled = false;
    $('metadata-button').replaceChildren(icon('download'), document.createTextNode(t(editor.requiredOrigins?.length ? 'app.metadata.continue' : 'app.metadata.fetch')));
    $('metadata-status').dataset.state = '';
    $('metadata-status').textContent = t('app.metadata.help');
    parentOptions($('item-parent'), $('item-parent').value || null);
    $('color-palette').querySelectorAll('[data-color]').forEach(node => node.setAttribute('aria-label', t('app.color.label', { color: node.dataset.color })));
  }
  if (movingId) parentOptions($('move-parent'), $('move-parent').value || null);
  for (const id of ['toast-message', 'toast-action', 'save-status', 'icons-status', 'editor-error', 'storage-error-text']) {
    const node = $(id);
    const message = translations.get(node.textContent);
    if (message) node.textContent = translatedMessage(message);
    else node.textContent = retranslate(node.textContent);
  }
  weatherDetailSignature = null;
  renderConfirm();
  closeMenu();
  updateClock();
}

function applyLanguage(authoritative = false) {
  applyingLanguage = true;
  try { globalThis.tabloI18n.apply(state.settings, state.revision, { authoritative }); }
  finally { applyingLanguage = false; }
  if (displayedLocale !== locale()) {
    displayedLocale = locale();
    refreshLocalizedMessages();
  }
  globalThis.tabloI18n.translate(document);
}

function cityKey(city) {
  return city ? `${state.settings.weatherProvider}:${city.latitude},${city.longitude}` : '';
}

function temperature(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}°`;
}

async function updateWeatherAccess() {
  const version = ++weatherAccessVersion;
  weatherPermissionProvider = state?.settings.weatherProvider || 'open-meteo';
  weatherAccessPending = true;
  let allowed;
  try { allowed = !!globalThis.browser?.permissions && await browser.permissions.contains(weatherAccess()); }
  catch { allowed = false; }
  if (version !== weatherAccessVersion) return;
  weatherAllowed = allowed;
  weatherAccessPending = false;
  if (!weatherAllowed) {
    weatherRequest?.abort();
    weatherView = { key: null, status: 'permission', data: null, error: null };
  }
}

function renderWeather() {
  if (!state) return;
  if (weatherView.error) weatherView.error = retranslate(weatherView.error);
  const city = state.settings.weatherCity;
  const key = cityKey(city);
  const canDisplay = weatherAccessPending || weatherAllowed;
  const saved = canDisplay && city ? globalThis.tabloWeatherPreview?.get(city, state.settings.weatherProvider) : null;
  if (saved && (weatherView.key !== key || !weatherView.data || saved.fetchedAt > weatherView.data.fetchedAt)) {
    const status = weatherView.key === key && ['loading', 'error'].includes(weatherView.status) ? weatherView.status : 'cached';
    weatherView = { key, status, data: saved, error: weatherView.key === key ? weatherView.error : null };
  }
  const storedData = canDisplay && weatherView.key === key ? weatherView.data : null;
  const data = storedData ? { ...storedData, stale: storedData.stale || Date.now() - storedData.fetchedAt >= 15 * 60 * 1000 } : null;
  const description = data ? describeWeather(data.code, data.isDay) : null;
  const updated = data ? new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(data.fetchedAt)) : '';
  const status = weatherAccessPending ? 'loading' : !weatherAllowed ? 'permission' : !city ? 'empty' : weatherView.status;
  $('weather-button').dataset.status = status;
  weatherRenderer.update({
    cityKey: key,
    temperature: data ? temperature(data.temperature) : '',
    city: city?.name || t('app.weather.yourCity'),
    summary: data ? (data.stale ? t('app.weather.cached') : description.label) : weatherAccessPending ? t('app.weather.loading') : !weatherAllowed ? t('app.weather.enable') : !city ? t('app.weather.chooseCity') : status === 'error' ? t('app.weather.retry') : t('app.weather.loading'),
    iconName: description?.icon || 'cloud-sun',
    hasWeather: !!data
  });
  $('weather-button').title = data ? t('app.weather.title', { city: city.name, condition: description.label, temperature: temperature(data.temperature), updated }) : t('app.weather.emptyTitle', { city: city?.name || t('app.weather.yourCity') });
  $('weather-button').setAttribute('aria-label', t('app.weather.accessible', { city: $('weather-city').textContent, temperature: $('weather-temperature').textContent, summary: $('weather-summary').textContent, saved: data ? t('app.weather.savedTime', { updated }) : '' }));
  $('weather-enable').hidden = weatherAccessPending || weatherAllowed;
  $('weather-refresh').hidden = weatherAccessPending || !weatherAllowed || !city;
  $('weather-refresh').disabled = status === 'loading';
  const detail = $('weather-detail');
  const detailSignature = JSON.stringify([locale(), data ? [key, city.name, data.temperature, data.apparentTemperature, data.code, data.isDay, data.windSpeed, data.stale, updated] : [key, city?.name, weatherAccessPending, weatherAllowed, status, weatherView.error]]);
  if (weatherDetailSignature !== detailSignature) {
    weatherDetailSignature = detailSignature;
    detail.replaceChildren();
    if (data) {
      const heading = document.createElement('div');
      heading.className = 'weather-detail-heading';
      const text = document.createElement('div');
      const degrees = document.createElement('strong');
      degrees.textContent = `${temperature(data.temperature)}C`;
      const name = document.createElement('h3');
      name.textContent = city.name;
      text.append(degrees, name);
      heading.append(icon(description.icon), text);
      const conditions = document.createElement('p');
      conditions.textContent = `${description.label}${data.apparentTemperature === null ? '' : t('app.weather.feelsLike', { temperature: temperature(data.apparentTemperature) })}`;
      const meta = document.createElement('p');
      meta.className = 'weather-detail-meta';
      meta.textContent = t('app.weather.windUpdated', { wind: Math.round(data.windSpeed), status: data.stale ? t('app.weather.fromCache') : t('app.weather.updated'), updated });
      detail.append(heading, conditions, meta);
    } else {
      const text = document.createElement('p');
      text.textContent = weatherAccessPending ? t('app.weather.checking') : !weatherAllowed ? t('app.weather.permission', { provider: WEATHER_PROVIDERS[state.settings.weatherProvider].name, city: city ? ` — ${city.name}` : '' }) : !city ? t('app.weather.findCity') : status === 'error' ? t('app.weather.errorRetry', { error: weatherView.error || t('app.weather.unavailable') }) : t('app.weather.fetching');
      detail.append(text);
    }
  }
  const provider = WEATHER_PROVIDERS[state.settings.weatherProvider];
  $('weather-source-name').textContent = t('app.weather.source', { provider: provider.name });
  $('weather-attribution').href = provider.url;
  $('weather-yandex').hidden = !city;
  if (city) {
    const target = new URL(locale() === 'ru' ? 'https://yandex.ru/pogoda/' : 'https://www.google.com/search');
    target.search = new URLSearchParams(locale() === 'ru' ? { lat: String(city.latitude), lon: String(city.longitude) } : { q: `weather ${city.name}` });
    $('weather-yandex').href = target.href;
  } else $('weather-yandex').removeAttribute('href');
  $('weather-external-label').textContent = t(locale() === 'ru' ? 'app.weather.openYandex' : 'app.weather.openGoogle');
  $('weather-week').hidden = !state.settings.showWeather || state.settings.weatherLayout !== 'week';
  $('weather-week-city').textContent = city?.name || t('app.weather.yourCity');
  $('weather-week-city').title = city?.name || t('app.weather.yourCity');
  const count = globalThis.tabloForecast.render($('weather-week-days'), data, city, describeWeather, icon);
  globalThis.tabloForecast.render($('weather-detail-days'), data, city, describeWeather, icon);
  const note = data?.forecastBasis === 'samples' ? t('app.weather.metNote') : data ? t('app.weather.note', { provider: provider.name, days: count && count < 7 ? t('app.weather.availableDays', { count }) : '' }) : '';
  $('weather-detail-note').textContent = note;
  $('weather-week-open').setAttribute('aria-label', t('app.weather.openForecast', { city: city?.name || t('app.weather.name') }));
  if (!data) for (const id of ['weather-week-days', 'weather-detail-days']) {
    const empty = $(id).querySelector('.weather-forecast-empty');
    if (empty) empty.textContent = weatherAccessPending ? t('app.weather.forecastLoading') : !weatherAllowed ? t('app.weather.forecastEnable') : !city ? t('app.weather.forecastCity') : status === 'error' ? t('app.weather.forecastError') : t('app.weather.forecastLoading');
  }
  globalThis.tabloWeatherPreview?.apply(state.settings, state.revision, weatherAccessPending ? null : weatherAllowed, data);
}

async function refreshWeather(force = false) {
  if (!state?.settings.showWeather || weatherAccessPending || !weatherAllowed || weatherPermissionProvider !== state.settings.weatherProvider || !state.settings.weatherCity) return;
  const city = state.settings.weatherCity;
  const key = cityKey(city);
  if (!force && weatherView.key === key && ['loading', 'loaded', 'error'].includes(weatherView.status)) return;
  weatherRequest?.abort();
  const controller = new AbortController();
  weatherRequest = controller;
  weatherView = { key, status: 'loading', data: weatherView.key === key ? weatherView.data : null, error: null };
  renderWeather();
  try {
    const data = await weatherServices[state.settings.weatherProvider].getWeather(city, { force, signal: controller.signal });
    if (controller.signal.aborted || cityKey(state.settings.weatherCity) !== key || !weatherAllowed) return;
    weatherView = { key, status: 'loaded', data, error: null };
  } catch (error) {
    if (controller.signal.aborted || cityKey(state.settings.weatherCity) !== key || !weatherAllowed) return;
    const saved = weatherView.key === key ? weatherView.data : null;
    weatherView = { key, status: 'error', data: saved ? { ...saved, stale: true } : null, error: error.message };
  }
  renderWeather();
}

function openWeather() {
  renderWeather();
  showDialog('weather-dialog');
}

function requestWeatherAccess(provider = state.settings.weatherProvider) {
  if (!globalThis.browser?.permissions) return Promise.reject(new Error(t('app.weather.permissionsFirefox')));
  return browser.permissions.request(weatherAccess(provider));
}

function renderMetadataPreview() {
  const preview = $('metadata-preview');
  preview.replaceChildren();
  let builtin = null;
  if (editor?.type === 'site' && !editor.favicon) {
    try { builtin = globalThis.tabloSiteIcons?.get({ url: normalizeUrl($('site-url').value), icon: $('item-icon').value.trim() || 'auto', favicon: null }); } catch {}
  }
  const source = editor?.favicon || builtin;
  if (source) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = source;
    preview.append(image);
  } else preview.append(icon('image'));
}

function loadEditorMetadata(url, accessPromise) {
  const session = editor;
  metadataRequest?.abort();
  const controller = new AbortController();
  metadataRequest = controller;
  $('metadata-button').disabled = true;
  $('metadata-status').dataset.state = '';
  $('metadata-status').textContent = t('app.metadata.loading');
  const task = (async () => {
    try {
      const allowed = await accessPromise;
      if (controller.signal.aborted || editor !== session) return;
      if (!allowed) throw new Error(t('app.metadata.denied'));
      const result = await fetchSiteMetadata(url, { signal: controller.signal });
      if (controller.signal.aborted || editor !== session || normalizeUrl($('site-url').value) !== url) return;
      if (result.favicon) session.favicon = result.favicon;
      session.requiredOrigins = result.requiredOrigins || [];
      if (result.title && (!session.titleDirty || !$('item-title').value.trim())) {
        $('item-title').value = result.title;
        session.titleDirty = false;
      }
      $('metadata-status').dataset.state = result.warnings.length ? 'error' : 'success';
      $('metadata-status').textContent = result.warnings.length ? result.warnings.join(' ') : result.title || result.favicon ? t('app.metadata.ready') : t('app.metadata.missing');
      if (session.requiredOrigins.length) $('metadata-status').textContent += t('app.metadata.continueHelp');
      renderMetadataPreview();
    } catch (error) {
      if (controller.signal.aborted || editor !== session) return;
      $('metadata-status').dataset.state = 'error';
      $('metadata-status').textContent = retranslate(error.message) || t('app.metadata.failed');
    } finally {
      if (editor === session && !controller.signal.aborted) {
        session.loadedUrl = url;
        session.metadataPromise = null;
        $('metadata-button').disabled = false;
        $('metadata-button').replaceChildren(icon('download'), document.createTextNode(session.requiredOrigins?.length ? t('app.metadata.continue') : t('app.metadata.fetch')));
      }
    }
  })();
  session.metadataPromise = task;
  return task;
}

function requestEditorMetadata() {
  try {
    const url = normalizeUrl($('site-url').value);
    const origins = editor.requiredOrigins || [];
    const access = origins.length && globalThis.browser?.permissions ? browser.permissions.request({ origins: [...new Set([sitePermissionOrigin(url), ...origins])], permissions: ['webRequest'], data_collection: ['browsingActivity'] }) : requestSiteAccess(url);
    return loadEditorMetadata(url, access);
  } catch (error) {
    $('metadata-status').dataset.state = 'error';
    $('metadata-status').textContent = retranslate(error.message);
    return Promise.resolve();
  }
}

async function autoMetadataIfAllowed() {
  if (!editor || editor.type !== 'site' || !globalThis.browser?.permissions) return;
  const session = editor;
  let url;
  try { url = normalizeUrl($('site-url').value); } catch { return; }
  if (session.loadedUrl === url || session.metadataPromise) return;
  try {
    const allowed = await browser.permissions.contains({ origins: [sitePermissionOrigin(url)], permissions: ['webRequest'], data_collection: ['browsingActivity'] });
    if (allowed && session === editor && $('editor-dialog').open && !$('editor-dialog').hasAttribute('data-closing') && !session.metadataPromise && session.loadedUrl !== url && normalizeUrl($('site-url').value) === url) await loadEditorMetadata(url, Promise.resolve(true));
  } catch {}
}

function updateEnabledSearchEngine(settings, id, enabled) {
  if (!globalThis.tabloSearchEngines.get(id) || typeof enabled !== 'boolean') throw new Error(t('app.search.unavailable'));
  const engines = enabled ? [...new Set([...settings.searchEngines, id])] : settings.searchEngines.filter(engine => engine !== id);
  if (!engines.length) throw new Error(t('app.search.keepOne'));
  settings.searchEngines = engines;
  if (!engines.includes(settings.searchEngine)) settings.searchEngine = engines[0];
}

function selectSearchEngine(settings, id) {
  if (!globalThis.tabloSearchEngines.get(id) || !settings.searchEngines.includes(id)) throw new Error(t('app.search.unavailable'));
  settings.searchEngine = id;
}

function renderSearchSettings(settings) {
  const catalog = globalThis.tabloSearchEngines;
  const focused = $('search-engine-options').contains(document.activeElement) ? document.activeElement.id : null;
  const choices = catalog.items.map(engine => {
    const label = document.createElement('label');
    label.className = 'search-engine-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `search-enabled-${engine.id}`;
    checkbox.dataset.searchEnabled = engine.id;
    checkbox.checked = settings.searchEngines.includes(engine.id);
    checkbox.addEventListener('change', () => {
      const enabled = checkbox.checked;
      applyChange(draft => updateEnabledSearchEngine(draft.settings, engine.id, enabled));
    });
    const name = document.createElement('span');
    name.textContent = catalog.name(engine.id);
    label.append(checkbox, name);
    return label;
  });
  $('search-engine-options').replaceChildren(...choices);
  $('search-engine').replaceChildren(...settings.searchEngines.map(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = catalog.name(id);
    return option;
  }));
  $('search-engine').value = settings.searchEngine;
  if (focused) $(focused)?.focus({ preventScroll: true });
}

function renderSettings() {
  applyLanguage();
  const settings = state.settings;
  document.body.dataset.background = settings.background;
  document.body.dataset.size = settings.tileSize;
  document.body.dataset.width = settings.width;
  document.documentElement.style.setProperty('--dim', String(settings.dim / 100));
  const showClockRow = settings.showClock || settings.showWeather && settings.weatherLayout === 'compact';
  document.body.classList.toggle('no-clock', !showClockRow);
  document.body.classList.toggle('no-search', !settings.showSearch);
  $('clock-section').hidden = !showClockRow;
  $('clock-face').hidden = !settings.showClock;
  $('weather-button').hidden = !settings.showWeather || settings.weatherLayout === 'week';
  $('weather-button').inert = false;
  $('weather-week-open').inert = false;
  document.documentElement.dataset.weatherLayout = settings.weatherLayout;
  if (weatherPermissionProvider !== settings.weatherProvider) {
    weatherAllowed = false;
    weatherRequest?.abort();
    updateWeatherAccess().then(() => { renderWeather(); refreshWeather(); });
  }
  globalThis.tabloSearch?.apply(settings, state.revision);
  const wallpaper = settings.customBackground || `assets/${settings.background}.svg`;
  if (appliedWallpaper !== wallpaper) {
    $('wallpaper').style.backgroundImage = `url("${wallpaper}"), var(--tablo-wallpaper, url("assets/aurora.svg")), url("assets/aurora.svg")`;
    appliedWallpaper = wallpaper;
    const background = new Image();
    background.src = wallpaper;
    background.decode().then(() => {
      if (appliedWallpaper === wallpaper) $('wallpaper').style.backgroundImage = `url("${wallpaper}")`;
    }).catch(() => {
      if (appliedWallpaper === wallpaper) $('wallpaper').style.backgroundImage = `url("assets/${state.settings.background}.svg")`;
    });
  }
  if (document.documentElement.dataset.ready === 'true' && $('startup-skeleton').hidden) globalThis.tabloBackground?.remember(settings, state.revision);
  document.querySelectorAll('[data-setting]').forEach(node => {
    const value = settings[node.dataset.setting];
    if (node.type === 'checkbox') node.checked = value;
    else node.value = value;
  });
  renderSearchSettings(settings);
  $('dim-value').value = `${settings.dim}%`;
  $('clear-background').hidden = !settings.customBackground;
  $('settings-city').textContent = settings.weatherCity?.name || t('app.weather.chooseCity');
  $('backgrounds').replaceChildren(...Object.entries(BACKGROUNDS).map(([key, name]) => {
    const choice = button(t(name), () => applyChange(draft => { draft.settings.background = key; draft.settings.customBackground = null; }), 'background-choice');
    choice.style.backgroundImage = `url("assets/${key}.svg")`;
    choice.setAttribute('aria-pressed', String(!settings.customBackground && settings.background === key));
    choice.title = t(name);
    return choice;
  }));
}

function createTile(item, parentId, existing) {
  const tile = existing || globalThis.tabloTiles.create(item, state.settings.openInNewTab);
  if (boundTiles.has(tile)) {
    const menuButton = tile.querySelector('.tile-actions .icon-button');
    menuButton.setAttribute('aria-label', t('app.tile.actionsFor', { title: item.title }));
    menuButton.title = t('app.tile.actions');
    return tile;
  }
  boundTiles.add(tile);
  tile.draggable = true;
  if (item.type === 'folder') tile.querySelector('.folder-link').addEventListener('click', () => {
    if (Date.now() > suppressClickUntil) openFolder(item.id);
  });
  const actions = document.createElement('div');
  actions.className = 'tile-actions';
  const menuButton = button('', event => { event.stopPropagation(); tileMenu(item.id, event.currentTarget); }, 'icon-button', 'more');
  menuButton.setAttribute('aria-label', t('app.tile.actionsFor', { title: item.title }));
  menuButton.title = t('app.tile.actions');
  menuButton.setAttribute('aria-haspopup', 'menu');
  actions.append(menuButton);
  tile.append(actions);
  tile.addEventListener('contextmenu', event => { event.preventDefault(); tileMenu(item.id, { x: event.clientX, y: event.clientY }); });
  tile.addEventListener('dragstart', event => {
    if (pending) { event.preventDefault(); return; }
    finishDrag(true);
    closeMenu();
    dragId = item.id;
    dragSourceElement = tile;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tablo-id', item.id);
    if (item.type === 'site') { event.dataTransfer.setData('text/uri-list', item.url); event.dataTransfer.setData('text/plain', item.url); }
    dragPreviewFrame = requestAnimationFrame(() => {
      if (dragId === item.id && tile.isConnected) ensureDragPreview();
    });
  });
  tile.addEventListener('dragend', () => finishDrag(false, true));
  tile.addEventListener('click', event => { if (Date.now() < suppressClickUntil) event.preventDefault(); });
  return tile;
}

function renderGrid(container, items, parentId, previous) {
  const existing = new Map([...container.children].filter(tile => tile.dataset.id).map(tile => [tile.dataset.id, tile]));
  const tiles = items.map(item => {
    const tile = existing.get(item.id);
    return createTile(item, parentId, tile && globalThis.tabloTiles.matches(tile, item, state.settings.openInNewTab) ? tile : null);
  });
  if (parentId === null && items.length > 0) {
    const add = [...container.children].find(tile => tile.classList.contains('tile-add')) || globalThis.tabloTiles.createAdd();
    if (!boundAddTiles.has(add)) {
      boundAddTiles.add(add);
      add.addEventListener('click', event => showAddMenu(event.currentTarget));
    }
    tiles.push(add);
  }
  const retained = new Set(tiles);
  for (const tile of [...container.children]) if (!retained.has(tile)) tile.remove();
  tiles.forEach((tile, index) => {
    if (container.children[index] !== tile) container.insertBefore(tile, container.children[index] || null);
  });
  if (!previous) return;
  const scale = container.offsetWidth ? container.getBoundingClientRect().width / container.offsetWidth : 1;
  const moved = [];
  for (const tile of tiles) {
    const before = previous.get(tile.dataset.id || `${container.id}:add`);
    if (!before) continue;
    const after = tile.getBoundingClientRect();
    const x = (before.left - after.left) / (scale || 1);
    const y = (before.top - after.top) / (scale || 1);
    if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
    tile.style.transition = 'none';
    tile.style.translate = `${x}px ${y}px`;
    moved.push(tile);
  }
  if (moved.length) {
    void container.offsetWidth;
    for (const tile of moved) { tile.style.transition = ''; tile.style.translate = ''; }
  }
}

function render() {
  const previous = dragPreview ? new Map([...document.querySelectorAll('.tile-grid>.tile,.tile-grid>.tile-add')].filter(tile => tile.getClientRects().length).map(tile => [tile.dataset.id || `${tile.parentElement.id}:add`, tile.getBoundingClientRect()])) : null;
  finishDrag(true);
  renderSettings();
  renderWeather();
  if (document.documentElement.dataset.ready === 'true') refreshWeather();
  document.body.classList.toggle('editing', editing);
  $('edit-button').setAttribute('aria-pressed', String(editing));
  $('edit-button').lastElementChild.textContent = editing ? t('app.tile.done') : t('app.tile.edit');
  renderGrid($('root-grid'), state.items, null, previous);
  $('root-empty').hidden = state.items.length > 0;
  $('root-grid').hidden = state.items.length === 0;
  globalThis.tabloTiles.remember(state);
  if (currentFolder) {
    const found = findItem(state, currentFolder);
    if (!found || found.item.type !== 'folder') { closeDialog($('folder-dialog')); currentFolder = null; }
    else {
      $('folder-title').textContent = found.item.title;
      $('folder-count').textContent = countLabel(found.item.children.length);
      renderGrid($('folder-grid'), found.item.children, currentFolder, previous);
      $('folder-empty').hidden = found.item.children.length > 0;
    }
  }
}

function openFolder(id) {
  const origin = document.querySelector(`#root-grid [data-id="${CSS.escape(id)}"] .folder-link`)?.getBoundingClientRect();
  closeMenu();
  currentFolder = id;
  render();
  showDialog('folder-dialog', origin);
}

function closeMenu() {
  const menu = $('menu');
  stopSurfaceMotion(menu);
  if (menu.matches(':popover-open')) menu.hidePopover();
  menu.hidden = true;
}

function showMenu(entries, anchor) {
  closeMenu();
  const menu = $('menu');
  mountPopover(menu);
  menu.replaceChildren();
  for (const entry of entries) {
    if (entry === null) { const line = document.createElement('div'); line.className = 'menu-divider'; menu.append(line); continue; }
    const option = button(entry.label, () => { closeMenu(); entry.action(); }, entry.danger ? 'danger-text' : '', entry.icon);
    option.setAttribute('role', 'menuitem');
    menu.append(option);
  }
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.showPopover();
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y };
  menu.style.left = `${Math.max(10, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 10))}px`;
  menu.style.top = `${Math.max(10, Math.min(rect.bottom + 7, innerHeight - menu.offsetHeight - 10))}px`;
  animateSurface(menu);
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function showAddMenu(anchor) {
  showMenu([
    { label: t('app.site.add'), icon: 'plus', action: () => openEditor('site', null, null) },
    { label: t('app.folder.create'), icon: 'folder', action: () => openEditor('folder', null, null) }
  ], anchor);
}

function tileMenu(id, anchor) {
  const found = findItem(state, id);
  if (!found) return;
  const item = found.item;
  const entries = item.type === 'site' ? [
    { label: t('app.site.openNew'), icon: 'external', action: () => window.open(item.url, '_blank', 'noopener,noreferrer') },
    { label: t('app.site.edit'), icon: 'edit', action: () => openEditor('site', id, found.parentId) },
    { label: t('app.site.move'), icon: 'folder', action: () => openMove(id) },
    ...(found.parentId ? [{ label: t('app.site.home'), icon: 'home', action: () => applyChange(draft => moveItem(draft, id, null), t('app.site.movedHome'), true) }] : []),
    null,
    { label: t('app.site.delete'), icon: 'trash', danger: true, action: () => applyChange(draft => deleteItem(draft, id), t('app.site.deleted'), true) }
  ] : [
    { label: t('app.folder.open'), icon: 'folder', action: () => openFolder(id) },
    { label: t('app.site.add'), icon: 'plus', action: () => openEditor('site', null, id) },
    { label: t('app.folder.rename'), icon: 'edit', action: () => openEditor('folder', id) },
    { label: t('app.folder.dissolve'), icon: 'grid', action: () => applyChange(draft => {
      const folder = findItem(draft, id);
      if (!folder) throw new Error(t('app.folder.missing'));
      const children = structuredClone(folder.item.children);
      const index = folder.index;
      deleteItem(draft, id);
      children.forEach((child, offset) => { addItem(draft, child); moveItem(draft, child.id, null, index + offset); });
    }, t('app.folder.sitesMoved'), true) },
    null,
    { label: t('app.folder.delete'), icon: 'trash', danger: true, action: () => confirm('app.folder.deleteTitle', 'app.folder.deleteBody', 'app.action.delete', () => applyChange(draft => deleteItem(draft, id), t('app.folder.deleted'), true), { title: item.title }) }
  ];
  showMenu(entries, anchor);
}

function parentOptions(select, selected = null) {
  select.replaceChildren();
  const root = document.createElement('option');
  root.value = '';
  root.textContent = t('app.parent.home');
  select.append(root);
  for (const folder of state.items.filter(item => item.type === 'folder')) {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.title;
    select.append(option);
  }
  select.value = selected || '';
}

function setEditorColor(color) {
  $('item-color').value = color;
  $('color-palette').querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.color === color)));
}

function openEditor(type = 'site', id = null, parentId = currentFolder) {
  closeMenu();
  const found = id ? findItem(state, id) : null;
  if (id && !found) return;
  metadataRequest?.abort();
  editor = { type, id, parentId, titleDirty: !!id, colorDirty: !!id, changeVersion: 0, favicon: found?.item.favicon || null, loadedUrl: found?.item.favicon ? found.item.url : null, metadataPromise: null };
  $('editor-form').reset();
  $('editor-title').textContent = type === 'folder' ? (id ? t('app.folder.renameTitle') : t('app.folder.create')) : (id ? t('app.site.edit') : t('app.site.add'));
  $('url-field').hidden = type !== 'site';
  $('site-fields').hidden = type !== 'site';
  $('site-url').required = type === 'site';
  $('item-title').required = type === 'folder';
  $('metadata-section').hidden = type !== 'site';
  $('metadata-button').disabled = false;
  $('metadata-button').lastChild.textContent = t('app.metadata.fetch');
  $('metadata-status').textContent = t('app.metadata.help');
  $('metadata-status').dataset.state = '';
  document.querySelector('.editor-advanced').open = false;
  $('editor-error').hidden = true;
  $('site-url').value = found?.item.url || '';
  $('item-title').value = found?.item.title || '';
  $('item-title').placeholder = type === 'folder' ? t('app.folder.example') : t('app.site.title');
  $('item-icon').value = found?.item.icon === 'auto' ? '' : (found?.item.icon || '');
  parentOptions($('item-parent'), found?.parentId || parentId);
  $('color-palette').replaceChildren(...PALETTE.map(color => {
    const swatch = button('', () => { editor.colorDirty = true; editor.changeVersion++; setEditorColor(color); }, 'color-swatch');
    swatch.dataset.color = color;
    swatch.style.setProperty('--swatch', color);
    swatch.setAttribute('aria-label', t('app.color.label', { color }));
    swatch.title = color;
    return swatch;
  }));
  setEditorColor(found?.item.color || '#5365dd');
  renderMetadataPreview();
  showDialog('editor-dialog');
  requestAnimationFrame(() => $(type === 'site' ? 'site-url' : 'item-title').focus());
}

function openMove(id) {
  const found = findItem(state, id);
  if (!found) return;
  movingId = id;
  moveVersion++;
  parentOptions($('move-parent'), found.parentId);
  showDialog('move-dialog');
}

function renderConfirm() {
  if (!confirmView) return;
  const { title, text, label, params } = confirmView;
  const values = typeof params === 'function' ? params() : params;
  $('confirm-title').textContent = t(title, values);
  $('confirm-text').textContent = t(text, values);
  $('confirm-action').textContent = t(label, values);
}

function confirm(title, text, label, action, params = {}) {
  closeMenu();
  confirmAction = action;
  confirmView = { title, text, label, params };
  renderConfirm();
  showDialog('confirm-dialog');
}

function clearDrag() {
  clearTimeout(dragTimer);
  dragTarget = null;
  dragReady = false;
  document.querySelectorAll('.drop-group,.drop-wait').forEach(node => node.classList.remove('drop-group', 'drop-wait'));
}

function ensureDragPreview() {
  if (!dragPreview && dragId && dragSourceElement?.isConnected) dragPreview = createTileDragPreview(dragSourceElement);
  return dragPreview;
}

function finishDrag(immediate = false, keepCommitted = false) {
  const active = dragId || dragPreview || dragSourceElement;
  clearDrag();
  cancelAnimationFrame(dragPreviewFrame);
  dragId = null;
  dragSourceElement = null;
  if (dragPreview && !(keepCommitted && dragPreview.committed)) {
    if (immediate) dragPreview.destroy();
    else dragPreview.restore();
    dragPreview = null;
  }
  if (active) suppressClickUntil = Date.now() + 250;
}

function gridDragOver(event, parentId, grid = event.currentTarget) {
  event.preventDefault();
  if (!dragId) return;
  event.stopPropagation();
  const source = findItem(state, dragId)?.item;
  if (!source || (source.type === 'folder' && parentId !== null) || (parentId === null && $('folder-dialog').open)) {
    event.dataTransfer.dropEffect = 'none';
    clearDrag();
    return;
  }
  const preview = ensureDragPreview();
  if (!preview) return;
  event.dataTransfer.dropEffect = 'move';
  const hit = preview.hit(grid, event.clientX, event.clientY);
  if (!hit) return;
  if (hit.kind === 'placeholder') { clearDrag(); return; }
  const target = hit.id ? findItem(state, hit.id)?.item : null;
  const grouping = target && hit.inside && source.type === 'site' && parentId === null && hit.ratio > .22 && hit.ratio < .78;
  if (grouping) {
    if (dragTarget?.id === hit.id && dragTarget.mode === 'group' && dragTarget.parentId === parentId) return;
    clearDrag();
    dragTarget = { id: hit.id, mode: 'group', parentId, index: hit.index, grid };
    const tile = grid.querySelector(`[data-id="${CSS.escape(hit.id)}"]`);
    if (target.type === 'folder') { dragReady = true; tile?.classList.add('drop-group'); }
    else {
      tile?.classList.add('drop-wait');
      const sourceId = dragId;
      dragTimer = setTimeout(() => {
        if (dragId !== sourceId || dragTarget?.id !== hit.id || dragTarget.mode !== 'group') return;
        dragReady = true;
        tile?.classList.remove('drop-wait');
        tile?.classList.add('drop-group');
      }, 650);
    }
    return;
  }
  clearDrag();
  preview.set(grid, hit.index + (hit.kind === 'tile' && hit.ratio >= .5 ? 1 : 0));
}

function gridDrop(event, parentId, grid = event.currentTarget) {
  event.preventDefault();
  event.stopPropagation();
  const sourceId = dragId;
  if (sourceId) {
    const source = findItem(state, sourceId);
    if (!source || (source.item.type === 'folder' && parentId !== null) || (parentId === null && $('folder-dialog').open)) { finishDrag(); return; }
    gridDragOver(event, parentId, grid);
    const groupTarget = dragTarget?.mode === 'group' && dragTarget.parentId === parentId ? dragTarget : null;
    const group = !!groupTarget && dragReady;
    if (groupTarget && !group) dragPreview?.set(grid, groupTarget.index + 1);
    const destination = dragPreview?.getDestination();
    if (!destination) { finishDrag(); return; }
    if (!group && source.parentId === parentId && source.index === destination.index) { finishDrag(); return; }
    clearDrag();
    cancelAnimationFrame(dragPreviewFrame);
    dragPreview.commit();
    if (group) dragSourceElement?.classList.add('dragging');
    dragId = null;
    dragSourceElement = null;
    suppressClickUntil = Date.now() + 250;
    applyChange(draft => {
      if (!findItem(draft, sourceId)) throw new Error(t('app.tile.changed'));
      if (group) {
        const target = findItem(draft, groupTarget.id);
        if (!target || target.parentId !== null) throw new Error(t('app.tile.targetChanged'));
        if (target.item.type === 'folder') moveItem(draft, sourceId, groupTarget.id);
        else createFolderFromItems(draft, sourceId, groupTarget.id);
      } else {
        const items = listItems(draft, parentId).filter(item => item.id !== sourceId);
        const before = items.findIndex(item => item.id === destination.beforeId);
        const after = items.findIndex(item => item.id === destination.afterId);
        const index = before !== -1 ? before : after !== -1 ? after + 1 : Math.min(destination.index, items.length);
        moveItem(draft, sourceId, parentId, index);
      }
    }, group ? t('app.tile.grouped') : null, group);
    return;
  }
  clearDrag();
  if ([...event.dataTransfer.types].includes('application/x-tablo-id')) return;
  const raw = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')).split('\n').find(line => line.trim() && !line.startsWith('#'));
  if (!raw) return;
  try {
    const url = normalizeUrl(raw);
    openEditor('site', null, parentId);
    $('site-url').value = url;
    suggestSite();
  } catch { showToast(t('app.tile.dropLink')); }
}

function suggestSite() {
  if (editor?.id || editor?.type !== 'site') return;
  try {
    const url = normalizeUrl($('site-url').value);
    const host = displayHost(url);
    const known = BRANDS.find(([hosts]) => hosts.some(domain => host === domain || host.endsWith(`.${domain}`)));
    if (!$('item-title').value.trim() && !editor.titleDirty) $('item-title').value = known ? (known[1] === 'Я' ? t('app.brand.yandex') : known[1] === 'W' ? 'Wikipedia' : known[1]) : host;
    if (known && !editor.colorDirty) setEditorColor(known[2]);
  } catch {}
}

function download(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function imageData(file) {
  if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) throw new Error(t('app.image.type'));
  if (file.size > 25 * 1024 * 1024) throw new Error(t('app.image.size'));
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2560 / bitmap.width, 1600 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#172039';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .86);
  } finally { bitmap.close(); }
}

function showSettings() {
  closeMenu();
  renderSettings();
  showDialog('settings-dialog');
}

function bindEvents() {
  $('settings-button').addEventListener('click', showSettings);
  $('background-button').addEventListener('click', showSettings);
  $('weather-button').addEventListener('click', openWeather);
  $('weather-week-open').addEventListener('click', openWeather);
  $('weather-settings-button').addEventListener('click', openWeather);
  $('weather-refresh').addEventListener('click', () => refreshWeather(true));
  $('weather-enable').addEventListener('click', async () => {
    let access;
    try { access = requestWeatherAccess(); } catch (error) { showToast(error.message); return; }
    $('weather-enable').disabled = true;
    try {
      if (!await access) { showToast(t('app.weather.denied')); return; }
      await updateWeatherAccess();
      if (!state.settings.showWeather) await applyChange(draft => { draft.settings.showWeather = true; });
      await refreshWeather();
      renderWeather();
    } catch (error) { showToast(error.message); }
    finally { $('weather-enable').disabled = false; }
  });
  $('city-form').addEventListener('submit', async event => {
    event.preventDefault();
    const query = $('city-query').value.trim();
    if (query.length < 2) return;
    let access;
    try { access = weatherAllowed ? Promise.resolve(true) : requestWeatherAccess(); }
    catch (error) { $('city-status').textContent = retranslate(error.message); return; }
    cityRequest?.abort();
    const controller = new AbortController();
    cityRequest = controller;
    $('city-status').textContent = t('app.city.searching');
    $('city-results').replaceChildren();
    try {
      if (!await access) throw new Error(t('app.city.permission'));
      await updateWeatherAccess();
      const cities = await weatherService.searchCities(query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      $('city-status').textContent = cities.length ? t('app.city.choose') : t('app.city.missing');
      $('city-results').replaceChildren(...cities.map(city => {
        const result = button('', async () => {
          const success = await applyChange(draft => { draft.settings.weatherCity = city; draft.settings.showWeather = true; }, t('app.city.selected', { name: city.name }));
          if (success) {
            $('city-results').replaceChildren();
            $('city-status').textContent = `${city.name}, ${city.country}`;
            $('city-query').value = '';
          }
        }, 'city-result');
        const name = document.createElement('strong');
        name.textContent = city.name;
        const location = document.createElement('span');
        location.textContent = [...new Set([city.admin1, city.country].filter(Boolean))].join(', ');
        result.replaceChildren(name, location);
        return result;
      }));
      renderWeather();
    } catch (error) { if (!controller.signal.aborted) $('city-status').textContent = retranslate(error.message) || t('app.city.failed'); }
  });
  $('refresh-icons').addEventListener('click', async () => {
    const sites = allSites(state);
    if (!sites.length) { $('icons-status').textContent = t('app.icons.noSites'); return; }
    let access;
    try {
      if (!globalThis.browser?.permissions) throw new Error(t('app.icons.firefox'));
      access = browser.permissions.request({ origins: [...new Set([...sites.map(site => sitePermissionOrigin(site.url)), ...iconBatchOrigins])], permissions: ['webRequest'], data_collection: ['browsingActivity'] });
    } catch (error) { $('icons-status').textContent = retranslate(error.message); return; }
    $('refresh-icons').disabled = true;
    $('icons-status').textContent = t('app.icons.loading');
    try {
      if (!await access) throw new Error(t('app.icons.denied'));
      const updates = [];
      const requiredOrigins = new Set();
      for (let index = 0; index < sites.length; index += 2) {
        const results = await Promise.allSettled(sites.slice(index, index + 2).map(async site => ({ site, data: await fetchSiteMetadata(site.url) })));
        for (const result of results) if (result.status === 'fulfilled') {
          const { site, data } = result.value;
          if (data.favicon) updates.push({ id: site.id, url: site.url, favicon: data.favicon });
          if (data.pendingPage || !data.favicon) data.requiredOrigins?.forEach(origin => requiredOrigins.add(origin));
        }
        $('icons-status').textContent = t('app.icons.progress', { checked: Math.min(index + 2, sites.length), total: sites.length });
      }
      if (updates.length) await applyChange(draft => {
        for (const update of updates) if (findItem(draft, update.id)?.item.url === update.url) updateItem(draft, update.id, { favicon: update.favicon });
      });
      iconBatchOrigins = [...requiredOrigins];
      $('icons-status').textContent = t('app.icons.result', { received: updates.length, total: sites.length, next: iconBatchOrigins.length ? t('app.icons.moreOrigins') : t('app.icons.retryEditor') });
    } catch (error) { $('icons-status').textContent = retranslate(error.message); }
    finally {
      $('refresh-icons').disabled = false;
      $('refresh-icons').replaceChildren(icon('refresh'), document.createTextNode(iconBatchOrigins.length ? t('app.icons.continue') : t('app.icons.fetch')));
    }
  });
  $('edit-button').addEventListener('click', () => { editing = !editing; render(); });
  $('empty-add').setAttribute('aria-haspopup', 'menu');
  $('empty-add').addEventListener('click', event => showAddMenu(event.currentTarget));
  $('folder-add').addEventListener('click', () => openEditor('site', null, currentFolder));
  $('rename-folder').addEventListener('click', () => openEditor('folder', currentFolder));
  $('folder-dialog').addEventListener('close', () => {
    if ($('folder-dialog').open) return;
    const id = currentFolder;
    currentFolder = null;
    closeMenu();
    if (id && !document.querySelector('dialog[open]')) document.querySelector(`#root-grid [data-id="${CSS.escape(id)}"] .folder-link`)?.focus({ preventScroll: true });
  });
  $('toast-close').addEventListener('click', hideToast);
  $('toast-action').addEventListener('click', () => { const action = toastAction; hideToast(); action?.(); });
  document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => closeDialog($(node.dataset.close))));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      stopSurfaceMotion(dialog);
      delete dialog.dataset.closing;
      dialog.inert = false;
      closeMenu();
      const index = modalStack.indexOf(dialog);
      if (index !== -1) modalStack.splice(index, 1);
      moveVisibleToast();
    });
    dialog.addEventListener('cancel', event => {
      if (dialog.id === 'storage-error-dialog') return;
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || dialog.id === 'storage-error-dialog') return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
    });
  });
  $('editor-dialog').addEventListener('close', () => { if (!$('editor-dialog').open) metadataRequest?.abort(); });
  $('weather-dialog').addEventListener('close', () => { if (!$('weather-dialog').open) cityRequest?.abort(); });
  $('metadata-button').addEventListener('click', requestEditorMetadata);
  $('item-title').addEventListener('input', () => { if (editor) editor.titleDirty = true; });
  for (const type of ['input', 'change']) $('editor-form').addEventListener(type, () => { if (editor) editor.changeVersion++; });
  $('site-url').addEventListener('input', () => {
    if (!editor) return;
    metadataRequest?.abort();
    editor.metadataPromise = null;
    editor.loadedUrl = null;
    editor.requiredOrigins = [];
    editor.favicon = null;
    if (!editor.titleDirty) $('item-title').value = '';
    $('metadata-button').disabled = false;
    $('metadata-button').replaceChildren(icon('download'), document.createTextNode(t('app.metadata.fetch')));
    $('metadata-status').dataset.state = '';
    $('metadata-status').textContent = t('app.metadata.shortHelp');
    renderMetadataPreview();
  });
  $('site-url').addEventListener('change', suggestSite);
  $('site-url').addEventListener('change', autoMetadataIfAllowed);
  $('site-url').addEventListener('blur', suggestSite);
  $('item-color').addEventListener('input', () => { editor.colorDirty = true; setEditorColor($('item-color').value); });
  $('editor-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    $('editor-error').hidden = true;
    try {
      const session = editor;
      const type = session.type;
      const id = session.id;
      const changeVersion = session.changeVersion;
      const parentId = $('item-parent').value || null;
      const url = type === 'site' ? normalizeUrl($('site-url').value) : null;
      const awaitingMetadata = type === 'site' && (!!session.metadataPromise || session.loadedUrl !== url);
      const metadata = type === 'site' ? session.metadataPromise || (session.loadedUrl !== url ? requestEditorMetadata() : null) : null;
      if (submit) submit.disabled = true;
      if (metadata) await metadata;
      if (editor !== session || !$('editor-dialog').open || $('editor-dialog').hasAttribute('data-closing')) return;
      if (session.changeVersion !== changeVersion || (url && normalizeUrl($('site-url').value) !== url)) throw new Error(t('app.metadata.changed'));
      if (awaitingMetadata && session.requiredOrigins?.length) throw new Error(t('app.metadata.otherOrigin'));
      const value = { title: $('item-title').value.trim() || (url ? displayHost(url) : '') };
      if (type === 'site') Object.assign(value, { url, color: $('item-color').value, icon: $('item-icon').value.trim() || 'auto', favicon: session.favicon });
      const newItem = id ? null : type === 'site' ? makeSite(value) : makeFolder(value.title);
      const success = await applyChange(draft => {
        if (id) {
          updateItem(draft, id, value);
          if (type === 'site' && findItem(draft, id).parentId !== parentId) moveItem(draft, id, parentId);
        } else addItem(draft, newItem, type === 'site' ? parentId : null);
      }, id ? t('app.site.saved') : type === 'site' ? t('app.site.added') : t('app.folder.created'));
      if (success && editor === session) closeDialog($('editor-dialog'));
    } catch (error) { $('editor-error').textContent = retranslate(error.message); $('editor-error').hidden = false; }
    finally { if (submit) submit.disabled = false; }
  });
  $('move-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = movingId;
    const version = moveVersion;
    const parentId = $('move-parent').value || null;
    const success = await applyChange(draft => moveItem(draft, id, parentId), t('app.site.moved'), true);
    if (success && movingId === id && moveVersion === version) closeDialog($('move-dialog'));
  });
  $('confirm-action').addEventListener('click', async () => {
    const action = confirmAction;
    $('confirm-action').disabled = true;
    try { const success = await action?.(); if (success !== false && confirmAction === action) closeDialog($('confirm-dialog')); }
    catch (error) { showToast(error.message); }
    finally { $('confirm-action').disabled = false; }
  });
  globalThis.tabloSearch?.connect({
    select(engine, ticket) {
      applyChange(draft => selectSearchEngine(draft.settings, engine)).then(() => globalThis.tabloSearch.settleEngine(ticket, state?.settings, state?.revision));
    },
    submit(query, engine, openInNewTab) {
      let url;
      const looksLikeAddress = /^https?:\/\//i.test(query) || (!/\s/.test(query) && /^(?:localhost(?::\d+)?|(?:[\p{L}\d-]+\.)+[\p{L}\d-]+(?::\d+)?|\[[\da-f:]+\])(?:[/?#].*)?$/iu.test(query));
      try {
        if (looksLikeAddress) url = normalizeUrl(query);
        else {
          if (!globalThis.tabloSearchEngines.get(engine) || state && !state.settings.searchEngines.includes(engine)) throw new Error(t('app.search.unavailable'));
          url = globalThis.tabloSearchEngines.url(engine, query);
        }
      }
      catch (error) { showToast(error.message); return; }
      if (openInNewTab && globalThis.browser?.tabs?.create) browser.tabs.create({ url }).catch(error => showToast(error.message));
      else if (openInNewTab) window.open(url, '_blank', 'noopener,noreferrer');
      else location.assign(url);
    }
  });
  document.querySelectorAll('[data-setting]').forEach(node => node.addEventListener('change', () => {
    const value = node.type === 'checkbox' ? node.checked : node.type === 'range' ? Number(node.value) : node.value;
    const key = node.dataset.setting;
    if (key === 'weatherProvider') {
      let access;
      try { access = requestWeatherAccess(value); } catch (error) { showToast(error.message); renderSettings(); return; }
      node.disabled = true;
      Promise.resolve(access).then(async allowed => {
        if (!allowed) { showToast(t('app.weather.providerDenied')); return; }
        weatherRequest?.abort();
        weatherView = { key: null, status: 'idle', data: null, error: null };
        await applyChange(draft => { draft.settings.weatherProvider = value; });
        await updateWeatherAccess();
        renderWeather();
        await refreshWeather();
      }).catch(error => showToast(error.message)).finally(() => { node.disabled = false; renderSettings(); });
      return;
    }
    if (key === 'showWeather' && !value) {
      weatherRequest?.abort();
      weatherView = { key: null, status: 'idle', data: null, error: null };
    }
    applyChange(draft => {
      if (key === 'searchEngine') selectSearchEngine(draft.settings, value);
      else draft.settings[key] = value;
    });
  }));
  $('dim').addEventListener('input', () => { $('dim-value').value = `${$('dim').value}%`; document.documentElement.style.setProperty('--dim', String(Number($('dim').value) / 100)); });
  $('background-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try { const data = await imageData(file); await applyChange(draft => { draft.settings.customBackground = data; }, t('app.image.updated')); }
    catch (error) { showToast(error.message || t('app.image.failed')); }
  });
  $('clear-background').addEventListener('click', () => applyChange(draft => { draft.settings.customBackground = null; }));
  $('export-button').addEventListener('click', async () => {
    await writeQueue;
    try { const latest = await lock(() => repository.load()); download(JSON.stringify(latest, null, 2), `tablo-${new Date().toISOString().slice(0,10)}.json`); showToast(t('app.backup.saved')); }
    catch (error) { showToast(error.message); }
  });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error(t('app.backup.size'));
      const imported = validateState(JSON.parse(await file.text()));
      confirm('app.backup.restoreTitle', 'app.backup.restoreBody', 'app.action.restore', () => applyChange(draft => Object.assign(draft, imported), t('app.backup.restored'), true), () => ({ sites: countLabel(allSites(imported).length) }));
    } catch (error) { showToast(t('app.backup.failed', { error: retranslate(error.message) }), null, '', 10000); }
  });
  $('reset-button').addEventListener('click', () => confirm('app.reset.title', 'app.reset.body', 'app.action.reset', () => applyChange(draft => Object.assign(draft, createDefaultState(state.settings.language)), t('app.reset.done'), true)));
  $('raw-export').addEventListener('click', async () => {
    try { const raw = await repository.readRaw(); download(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2), 'tablo-recovery.json'); }
    catch (error) { $('storage-error-text').textContent = retranslate(error.message); }
  });
  $('retry-load').addEventListener('click', () => closeDialog($('storage-error-dialog')).then(closed => { if (closed) initialize(); }));
  $('storage-error-dialog').addEventListener('cancel', event => event.preventDefault());
  document.addEventListener('pointerdown', event => { if (!$('menu').hidden && !$('menu').contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (document.documentElement.dataset.ready !== 'true') return;
    if (event.key === 'Escape' && dragId) { event.preventDefault(); finishDrag(); return; }
    if (!$('menu').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = [...$('menu').querySelectorAll('button')];
        const index = options.indexOf(document.activeElement);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
        return;
      }
    }
    if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (event.key === '/' && state?.settings.showSearch) { event.preventDefault(); $('search-input').focus(); }
    if (event.altKey && /^[1-9]$/.test(event.key)) {
      const item = state?.items[Number(event.key)-1];
      if (!item) return;
      event.preventDefault();
      if (item.type === 'folder') openFolder(item.id);
      else if (state.settings.openInNewTab) window.open(item.url, '_blank', 'noopener,noreferrer');
      else location.assign(item.url);
    }
  });
  for (const [id, parent] of [['root-grid', () => null], ['folder-grid', () => currentFolder]]) {
    $(id).addEventListener('dragover', event => gridDragOver(event, parent()));
    $(id).addEventListener('dragleave', event => { if (!$(id).contains(event.relatedTarget)) clearDrag(); });
    $(id).addEventListener('drop', event => gridDrop(event, parent()));
  }
  $('root-empty').addEventListener('dragover', event => event.preventDefault());
  $('root-empty').addEventListener('drop', event => gridDrop(event, null));
  $('folder-empty').addEventListener('dragover', event => gridDragOver(event, currentFolder, $('folder-grid')));
  $('folder-empty').addEventListener('drop', event => gridDrop(event, currentFolder, $('folder-grid')));
  document.addEventListener('dragend', () => finishDrag(false, true));
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('resize', () => finishDrag(true));
  window.addEventListener('resize', () => { if (state) syncStartupSkeleton(); });
  window.addEventListener('scroll', () => { if (state) syncStartupSkeleton(); }, { passive: true });
}

function syncStartupSkeleton() {
  const skeleton = $('startup-skeleton');
  if (skeleton.hidden) return;
  const mapped = $('startup-skeleton-mapped');
  const blocks = [];
  const add = (kind, rect) => {
    if (!rect.width || !rect.height) return;
    const block = document.createElement('span');
    block.className = `startup-skeleton-block startup-skeleton-${kind}`;
    block.style.left = `${rect.left}px`;
    block.style.top = `${rect.top}px`;
    block.style.width = `${rect.width}px`;
    block.style.height = `${rect.height}px`;
    blocks.push(block);
  };
  for (const tile of $('root-grid').children) add('tile', tile.getBoundingClientRect());
  mapped.replaceChildren(...blocks);
  $('startup-skeleton-layout').hidden = true;
  mapped.hidden = false;
}

async function prepareStartupAssets(version) {
  const deadline = performance.now() + 400;
  do {
    const revision = state.revision;
    const wallpaper = appliedWallpaper;
    const tasks = [...$('root-grid').querySelectorAll('img')].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).map(image => image.decode().catch(() => {}));
    if (document.fonts) tasks.push(document.fonts.ready);
    let timer;
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - performance.now())); })
    ]);
    clearTimeout(timer);
    if (version !== startupVersion) return;
    if (state.revision === revision && appliedWallpaper === wallpaper) return;
  } while (performance.now() < deadline);
}

async function initialize() {
  const version = ++startupVersion;
  const hasTilesPreview = document.documentElement.dataset.tilesPreview === 'true';
  stopSurfaceMotion($('tablo-surface'));
  document.documentElement.dataset.ready = 'false';
  document.querySelectorAll('[data-reveal]').forEach(element => { element.inert = true; });
  $('weather-button').inert = true;
  document.querySelector('.board').setAttribute('aria-busy', 'true');
  if (version > 1) globalThis.tabloStartup?.begin();
  try {
    const loaded = await lock(() => repository.load());
    if (version !== startupVersion) return;
    if (!state || loaded.revision >= state.revision) state = loaded;
    applyLanguage(true);
    const access = updateWeatherAccess();
    updateClock();
    render();
    syncStartupSkeleton();
    const city = state.settings.weatherCity;
    const key = cityKey(city);
    access.then(async () => {
      if (version !== startupVersion) return;
      renderWeather();
      if (weatherAccessPending || !weatherAllowed || !state.settings.showWeather || !city || cityKey(state.settings.weatherCity) !== key) return;
      const data = await weatherServices[state.settings.weatherProvider].getCachedWeather(city);
      if (version !== startupVersion || weatherAccessPending || !weatherAllowed || cityKey(state.settings.weatherCity) !== key) return;
      if (data && (weatherView.key !== key || !weatherView.data || data.fetchedAt > weatherView.data.fetchedAt)) {
        weatherView = { key, status: weatherView.key === key && weatherView.status === 'loading' ? 'loading' : 'cached', data, error: null };
      }
      renderWeather();
      refreshWeather();
    }).catch(() => {});
    if (!hasTilesPreview) await prepareStartupAssets(version);
    if (version !== startupVersion) return;
    updateClock();
    $('save-status').textContent = '';
    syncStartupSkeleton();
    if (hasTilesPreview) $('startup-skeleton').hidden = true;
    revealTablo($('tablo-surface'), hasTilesPreview ? null : $('startup-skeleton')).then(finished => {
      if (finished && version === startupVersion) globalThis.tabloBackground?.remember(state.settings, state.revision);
    });
    document.documentElement.dataset.ready = 'true';
    document.querySelectorAll('[data-reveal]').forEach(element => { element.inert = false; });
    document.querySelector('.board').setAttribute('aria-busy', 'false');
    globalThis.tabloStartup?.finish();
  } catch (error) {
    if (version !== startupVersion) return;
    globalThis.tabloStartup?.finish();
    $('startup-skeleton').hidden = true;
    document.querySelector('.board').setAttribute('aria-busy', 'false');
    $('storage-error-text').textContent = retranslate(error.message);
    showDialog('storage-error-dialog');
  }
}

fillIcons();
bindEvents();
updateClock();
globalThis.tabloI18n.onChange(() => {
  if (applyingLanguage) return;
  displayedLocale = locale();
  refreshLocalizedMessages();
  if (state) render();
});
setInterval(() => refreshWeather(true), 15 * 60 * 1000);
for (const event of [globalThis.browser?.permissions?.onAdded, globalThis.browser?.permissions?.onRemoved]) event?.addListener(async () => {
  await updateWeatherAccess();
  if (state) { renderWeather(); refreshWeather(); }
});
repository.subscribe(next => {
  if (pending || (state && next.revision <= state.revision)) return;
  state = next;
  render();
});
initialize();
