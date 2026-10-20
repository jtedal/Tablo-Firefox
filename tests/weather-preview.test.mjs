import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDefaultState } from '../src/model.js';

const forecastCode = readFileSync(new URL('../src/weather-forecast.js', import.meta.url), 'utf8');
const previewCode = readFileSync(new URL('../src/weather-preview.js', import.meta.url), 'utf8');
const iconsCode = readFileSync(new URL('../src/icons.js', import.meta.url), 'utf8');
const coreCode = readFileSync(new URL('../src/locales/core.js', import.meta.url), 'utf8');
const i18nCode = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
const settings = () => createDefaultState().settings;
const today = (city, timestamp = Date.now()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  return ['year', 'month', 'day'].map(name => parts.find(part => part.type === name).value).join('-');
};
function weather() {
  const date = today(settings().weatherCity);
  return { temperature: 14, apparentTemperature: 12, code: 2, isDay: true, windSpeed: 8, time: `${date}T12:00`, fetchedAt: Date.now() - 1000, stale: false, daily: Array.from({ length: 7 }, (_, index) => ({ date: new Date(Date.parse(`${date}T12:00Z`) + index * 86400000).toISOString().slice(0, 10), code: 2, temperatureMin: 7, temperatureMax: 16, precipitationProbability: 20 })) };
}
function snapshot(provider = 'open-meteo') {
  return { schemaVersion: 2, revision: 4, allowed: true, city: settings().weatherCity, weather: weather(), provider, layout: 'week' };
}
function load(value, { render = false } = {}) {
  let saved = value === undefined ? null : JSON.stringify(value);
  function element(tag, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    const classes = new Set();
    return {
      tagName: tag, namespaceURI, children: [], attributes: {}, dataset: {}, textContent: '',
      classList: { add(name) { classes.add(name); }, toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      set innerHTML(value) { throw new Error(`HTML parsing is forbidden: ${value}`); }
    };
  }
  const nodes = new Map(render ? ['weather-button', 'weather-symbol', 'weather-temperature', 'weather-city', 'weather-summary', 'weather-week-city', 'weather-week-open', 'weather-week', 'weather-week-days'].map(id => [id, element('div')]) : []);
  const context = vm.createContext({
    Intl, Date,
    navigator: { language: 'en' },
    document: { documentElement: { dataset: {} }, hidden: true, createElement: element, createElementNS(namespace, tag) { return element(tag, namespace); }, getElementById(id) { return nodes.get(id) || null; } },
    localStorage: { getItem(key) { return key === 'tabloWeatherPreview' ? saved : null; }, setItem(key, value) { assert.equal(key, 'tabloWeatherPreview'); saved = value; } }
  });
  vm.runInContext(coreCode, context);
  vm.runInContext(i18nCode, context);
  vm.runInContext(iconsCode, context);
  vm.runInContext(forecastCode, context);
  vm.runInContext(previewCode, context);
  const invoke = (method, ...values) => vm.runInContext(`tabloWeatherPreview.${method}(...JSON.parse(${JSON.stringify(JSON.stringify(values))}))`, context);
  return { invoke, nodes, get saved() { return JSON.parse(saved); } };
}

test('ранний погодный кэш мигрирует текущие условия старой версии без сети', () => {
  const old = snapshot();
  old.schemaVersion = 1;
  delete old.provider;
  delete old.layout;
  delete old.weather.daily;
  const cache = load(old);
  const result = cache.invoke('get', old.city);
  assert.equal(result.temperature, 14);
  assert.equal(result.daily.length, 0);
  assert.equal(cache.invoke('get', old.city, 'metno'), null);
});

test('ранний недельный прогноз изолирует источник, координаты и возвращаемые дни', () => {
  const value = snapshot('metno');
  value.weather.apparentTemperature = null;
  value.weather.forecastBasis = 'samples';
  value.weather.daily.forEach(day => { day.precipitationProbability = null; });
  const cache = load(value);
  const result = cache.invoke('get', value.city, 'metno');
  assert.equal(result.daily.length, 7);
  assert.equal(result.forecastBasis, 'samples');
  assert.equal(result.apparentTemperature, null);
  assert.equal(cache.invoke('get', value.city), null);
  assert.equal(cache.invoke('get', { ...value.city, latitude: 50 }, 'metno'), null);
  result.daily[0].temperatureMax = 999;
  assert.equal(cache.invoke('get', value.city, 'metno').daily[0].temperatureMax, 16);
});

test('смена источника не переносит прежние данные и прежнее разрешение в ранний кэш', () => {
  const value = snapshot();
  const cache = load(value);
  assert.equal(cache.invoke('apply', { ...settings(), weatherProvider: 'metno', weatherLayout: 'compact' }, 5, null), true);
  assert.equal(cache.saved.provider, 'metno');
  assert.equal(cache.saved.layout, 'compact');
  assert.equal(cache.saved.weather, null);
  assert.equal(cache.saved.allowed, null);
  assert.equal(cache.invoke('get', value.city, 'metno'), null);
});

test('повреждённые и далёкие даты недели не уничтожают сохранённую текущую погоду', () => {
  for (const mutate of [
    value => { value.weather.daily[1].date = value.weather.daily[0].date; },
    value => { value.weather.daily[0].precipitationProbability = 101; },
    value => { value.weather.daily[0].temperatureMax = null; },
    value => { value.weather.daily.forEach((day, index) => { day.date = `2050-01-0${index + 1}`; }); }
  ]) {
    const value = snapshot();
    mutate(value);
    const cache = load(value);
    const result = cache.invoke('get', value.city);
    assert.equal(result.temperature, 14);
    assert.equal(result.daily.length, 0);
  }
});

test('новый снимок сохраняет семь дней, а старые ревизии и отзыв разрешения не восстанавливают погоду', () => {
  const value = snapshot();
  const cache = load(value);
  const next = weather();
  next.fetchedAt = Date.now();
  next.temperature = 19;
  assert.equal(cache.invoke('apply', settings(), 5, true, next), true);
  assert.equal(cache.saved.weather.daily.length, 7);
  assert.equal(cache.invoke('get', value.city).temperature, 19);
  assert.equal(cache.invoke('apply', settings(), 4, true, value.weather), false);
  assert.equal(cache.invoke('get', value.city).temperature, 19);
  assert.equal(cache.invoke('apply', settings(), 6, false, next), true);
  assert.equal(cache.invoke('get', value.city), null);
  assert.equal(cache.saved.weather, null);
});

test('ранняя погода рисует сохранённую ночь и семь дней через SVG DOM без разбора HTML', () => {
  const value = snapshot();
  value.weather.code = 0;
  value.weather.isDay = false;
  const preview = load(value, { render: true });
  const symbol = preview.nodes.get('weather-symbol').children[0];
  assert.equal(symbol.tagName, 'span');
  const moon = symbol.children[0];
  assert.equal(moon.tagName, 'svg');
  assert.equal(moon.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(moon.attributes['aria-hidden'], 'true');
  assert.equal(moon.attributes.viewBox, '0 0 24 24');
  assert.equal(moon.children[0].attributes.d, 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z');
  assert.equal(preview.nodes.get('weather-city').textContent, value.city.name);
  assert.equal(preview.nodes.get('weather-temperature').textContent, '+14°');
  assert.equal(preview.nodes.get('weather-button').dataset.status, 'cached');
  const days = preview.nodes.get('weather-week-days').children[0].children;
  assert.equal(days.length, 7);
  for (const day of days) {
    const svg = day.children[2].children[0];
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.children.length, 2);
    for (const shape of svg.children) assert.equal(shape.namespaceURI, svg.namespaceURI);
  }
});
