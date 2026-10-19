import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDefaultState } from '../src/model.js';

const forecastCode = readFileSync(new URL('../src/weather-forecast.js', import.meta.url), 'utf8');
const previewCode = readFileSync(new URL('../src/weather-preview.js', import.meta.url), 'utf8');
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
function load(value) {
  let saved = value === undefined ? null : JSON.stringify(value);
  const context = vm.createContext({
    Intl, Date,
    document: { documentElement: { dataset: {} }, getElementById() { return null; } },
    localStorage: { getItem() { return saved; }, setItem(key, value) { assert.equal(key, 'tabloWeatherPreview'); saved = value; } }
  });
  vm.runInContext(forecastCode, context);
  vm.runInContext(previewCode, context);
  const invoke = (method, ...values) => vm.runInContext(`tabloWeatherPreview.${method}(...JSON.parse(${JSON.stringify(JSON.stringify(values))}))`, context);
  return { invoke, get saved() { return JSON.parse(saved); } };
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
