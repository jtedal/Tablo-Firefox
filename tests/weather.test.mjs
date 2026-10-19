import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService, describeWeather } from '../src/weather.js';
import { createDefaultState } from '../src/model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const city = () => createDefaultState().settings.weatherCity;
const week = () => Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${18 + index}`, code: 2, temperatureMax: 17 + index, temperatureMin: 8 + index, precipitationProbability: index * 10 }));
const current = () => ({
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', weather_code: 'wmo code', is_day: '', wind_speed_10m: 'km/h' },
  current: { time: '2026-10-18T14:15', interval: 900, temperature_2m: 14.2, apparent_temperature: 12.3, weather_code: 2, is_day: 1, wind_speed_10m: 11.5 },
  daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
  daily: { time: week().map(day => day.date), weather_code: week().map(day => day.code), temperature_2m_max: week().map(day => day.temperatureMax), temperature_2m_min: week().map(day => day.temperatureMin), precipitation_probability_max: week().map(day => day.precipitationProbability) }
});
const response = payload => ({ ok: true, status: 200, async json() { return clone(payload); } });
const cached = (age = 0) => ({ temperature: 12, apparentTemperature: 10, code: 3, isDay: true, windSpeed: 5, time: '2026-10-18T14:00', fetchedAt: Date.now() - age, daily: week(), stale: false });
const cityKey = value => `${value.latitude},${value.longitude}`;

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 18, 12) }));

function storageMock(initial) {
  let raw = initial;
  const writes = [];
  return {
    writes,
    async get(key) { assert.equal(key, 'tabloWeatherCache'); return raw === undefined ? {} : { tabloWeatherCache: clone(raw) }; },
    async set(values) { raw = clone(values.tabloWeatherCache); writes.push(clone(raw)); },
    get raw() { return raw; }
  };
}

function geocoded(value = city()) {
  return { name: value.name, country: value.country, country_code: value.countryCode, admin1: value.admin1, latitude: value.latitude, longitude: value.longitude, timezone: value.timezone };
}

test('поиск городов не делает запрос для короткой строки и обращается только к Geocoding API', async () => {
  const calls = [];
  const service = createWeatherService({ fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options }); return response({ results: [geocoded()] }); } });
  assert.deepEqual(await service.searchCities(' '), []);
  assert.deepEqual(await service.searchCities(' В '), []);
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.searchCities(' Вена, Австрия '), [city()]);
  assert.equal(calls[0].url.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(calls[0].url.pathname, '/v1/search');
  assert.equal(calls[0].url.searchParams.get('name'), 'Вена, Австрия');
  assert.equal(calls[0].url.searchParams.get('count'), '6');
  assert.equal(calls[0].url.searchParams.get('language'), 'ru');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  await assert.rejects(service.searchCities(null), /название/);
  await assert.rejects(service.searchCities('a'.repeat(121)), /название/);
});

test('поиск отбрасывает некорректные результаты, повторные координаты и не выдумывает город', async () => {
  const valid = geocoded();
  const service = createWeatherService({ fetchImpl: async () => response({ results: [null, { ...valid, latitude: '48' }, valid, valid, { ...valid, country_code: 'AT1' }, { ...valid, latitude: 50, admin1: undefined }] }) });
  const result = await service.searchCities('Вена');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], city());
  assert.equal(result[1].admin1, '');
  const empty = createWeatherService({ fetchImpl: async () => response({ generationtime_ms: 1 }) });
  assert.deepEqual(await empty.searchCities('Неизвестныйгород'), []);
  const malformed = createWeatherService({ fetchImpl: async () => response({ results: {} }) });
  await assert.rejects(malformed.searchCities('Вена'), /некорректные/);
});

test('поиск сообщает HTTP-ошибки и отмену запроса', async () => {
  let calls = 0;
  const service = createWeatherService({ fetchImpl: async () => { calls++; return { ok: false, status: 429 }; } });
  await assert.rejects(service.searchCities('Вена'), /HTTP 429/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.searchCities('Вена', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('погода запрашивает текущие условия и семь дней прогноза с проверкой единиц измерения', async () => {
  let request;
  const storage = storageMock();
  const service = createWeatherService({ storage, fetchImpl: async (url, options) => { request = { url: new URL(url), options }; return response(current()); } });
  const weather = await service.getWeather(city());
  assert.equal(request.url.origin, 'https://api.open-meteo.com');
  assert.equal(request.url.pathname, '/v1/forecast');
  assert.equal(request.url.searchParams.get('latitude'), '48.20849');
  assert.equal(request.url.searchParams.get('longitude'), '16.37208');
  assert.equal(request.url.searchParams.get('timezone'), 'auto');
  assert.equal(request.url.searchParams.get('temperature_unit'), 'celsius');
  assert.equal(request.url.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(request.url.searchParams.get('current'), 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m');
  assert.equal(request.url.searchParams.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  assert.equal(request.url.searchParams.get('forecast_days'), '7');
  assert.equal(request.options.credentials, 'omit');
  assert.deepEqual({ ...weather, fetchedAt: 1 }, { temperature: 14.2, apparentTemperature: 12.3, code: 2, isDay: true, windSpeed: 11.5, time: '2026-10-18T14:15', fetchedAt: 1, daily: week(), stale: false });
  assert.ok(weather.fetchedAt <= Date.now());
  assert.deepEqual(storage.raw[cityKey(city())], weather);
});

test('свежий кэш переживает создание сервиса, force обновляет данные, результаты изолированы', async () => {
  const entry = cached();
  const storage = storageMock({ [cityKey(city())]: entry });
  let calls = 0;
  const service = createWeatherService({ storage, fetchImpl: async () => { calls++; return response(current()); } });
  const first = await service.getWeather(city());
  assert.deepEqual(first, entry);
  first.temperature = 999;
  assert.equal((await service.getWeather(city())).temperature, entry.temperature);
  assert.equal(calls, 0);
  assert.equal((await service.getWeather(city(), { force: true })).temperature, 14.2);
  assert.equal(calls, 1);
  const reopened = createWeatherService({ storage, fetchImpl: async () => { throw new Error('Сеть не должна вызываться'); } });
  assert.equal((await reopened.getWeather(city())).temperature, 14.2);
});

test('чтение сохранённой погоды не обращается к сети, не пишет данные и возвращает независимые результаты', async () => {
  const entry = cached();
  const storage = storageMock({ [cityKey(city())]: entry });
  let reads = 0;
  let requests = 0;
  const service = createWeatherService({
    storage: { async get(key) { reads++; return storage.get(key); }, set: values => storage.set(values) },
    fetchImpl: async () => { requests++; return response(current()); }
  });
  const [first, second] = await Promise.all([service.getCachedWeather(city()), service.getCachedWeather(city())]);
  assert.deepEqual(first, entry);
  assert.deepEqual(second, entry);
  assert.notEqual(first, second);
  first.temperature = 999;
  assert.equal((await service.getCachedWeather(city())).temperature, entry.temperature);
  assert.equal(reads, 1);
  assert.equal(requests, 0);
  assert.equal(storage.writes.length, 0);
});

test('чтение кэша точно различает свежесть до 15 минут и допустимую давность до шести часов', async t => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 18, 12) });
  try {
    for (const [age, stale] of [[15 * 60 * 1000 - 1, false], [15 * 60 * 1000, true], [6 * 60 * 60 * 1000, true], [6 * 60 * 60 * 1000 + 1, null]]) {
      const entry = cached(age);
      const storage = storageMock({ [cityKey(city())]: entry });
      const service = createWeatherService({ storage, fetchImpl: async () => assert.fail('Чтение кэша вызвало сеть') });
      assert.deepEqual(await service.getCachedWeather(city()), stale === null ? null : { ...entry, stale });
      assert.equal(storage.writes.length, 0);
    }
    const service = createWeatherService({ storage: storageMock({ [cityKey(city())]: cached() }), fetchImpl: async () => assert.fail('Чтение кэша вызвало сеть') });
    assert.equal((await service.getCachedWeather(city())).stale, false);
    t.mock.timers.tick(6 * 60 * 60 * 1000 + 1);
    assert.equal(await service.getCachedWeather(city()), null);
  } finally {
    t.mock.timers.reset();
  }
});

test('отсутствующие, повреждённые и недоступные записи кэша возвращают null без запроса сети', async () => {
  for (const raw of [undefined, {}, { [cityKey(city())]: { ...cached(), temperature: null } }, { [cityKey(city())]: { ...cached(), fetchedAt: Date.now() + 100000 } }]) {
    const storage = storageMock(raw);
    let requests = 0;
    const service = createWeatherService({ storage, fetchImpl: async () => { requests++; return response(current()); } });
    assert.equal(await service.getCachedWeather(city()), null);
    assert.equal(requests, 0);
    assert.equal(storage.writes.length, 0);
  }
  const service = createWeatherService({ storage: { async get() { throw new Error('Storage unavailable'); }, async set() { assert.fail('Чтение кэша вызвало запись'); } }, fetchImpl: async () => assert.fail('Чтение кэша вызвало сеть') });
  assert.equal(await service.getCachedWeather(city()), null);
});

test('чтение кэша отклоняет некорректный город до обращения к хранилищу и сети', async () => {
  let reads = 0;
  let requests = 0;
  const service = createWeatherService({ storage: { async get() { reads++; return {}; } }, fetchImpl: async () => { requests++; return response(current()); } });
  await assert.rejects(service.getCachedWeather(null), /Выберите город/);
  await assert.rejects(service.getCachedWeather({ ...city(), latitude: NaN }), /координаты/);
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('через 15 минут кэш обновляется и только при ошибке получает stale=true', async () => {
  const entry = cached(15 * 60 * 1000);
  const storage = storageMock({ [cityKey(city())]: entry });
  let failed = true;
  let calls = 0;
  const service = createWeatherService({ storage, fetchImpl: async () => { calls++; if (failed) throw new Error('Offline'); return response(current()); } });
  assert.deepEqual(await service.getWeather(city()), { ...entry, stale: true });
  assert.equal(storage.writes.length, 0);
  failed = false;
  const renewed = await service.getWeather(city());
  assert.equal(renewed.stale, false);
  assert.equal(renewed.temperature, 14.2);
  assert.equal(calls, 2);
});

test('ошибка принудительного обновления свежего кэша возвращает явно устаревший результат', async () => {
  const entry = cached();
  const service = createWeatherService({ storage: storageMock({ [cityKey(city())]: entry }), fetchImpl: async () => { throw new Error('Offline'); } });
  assert.deepEqual(await service.getWeather(city(), { force: true }), { ...entry, stale: true });
  assert.equal((await service.getWeather(city())).stale, false);
});

test('кэш старше шести часов, будущая и повреждённая запись не скрывают ошибку сети', async () => {
  for (const entry of [cached(6 * 60 * 60 * 1000 + 100), { ...cached(), fetchedAt: Date.now() + 100000 }, { ...cached(), temperature: null }, { ...cached(), code: 100 }]) {
    const service = createWeatherService({ storage: storageMock({ [cityKey(city())]: entry }), fetchImpl: async () => { throw new Error('Offline'); } });
    await assert.rejects(service.getWeather(city()), /Offline/);
  }
});

test('без сохранённой погоды ошибка не подменяется данными, следующий запрос повторяется', async () => {
  let failed = true;
  let calls = 0;
  const service = createWeatherService({ storage: storageMock(), fetchImpl: async () => { calls++; if (failed) return { ok: false, status: 503 }; return response(current()); } });
  await assert.rejects(service.getWeather(city()), /HTTP 503/);
  failed = false;
  assert.equal((await service.getWeather(city())).temperature, 14.2);
  assert.equal(calls, 2);
});

test('неполные данные API, null, числовые строки, неверные единицы и даты отклоняются', async () => {
  const mutations = [
    value => { delete value.current; },
    value => { delete value.current_units; },
    value => { value.current.temperature_2m = null; },
    value => { value.current.apparent_temperature = '12'; },
    value => { value.current.weather_code = 100; },
    value => { value.current.weather_code = '2'; },
    value => { value.current.is_day = true; },
    value => { value.current.wind_speed_10m = -1; },
    value => { value.current.time = '2026-02-30T14:15'; },
    value => { value.current.time = '2026-10-18T25:15'; },
    value => { value.current_units.temperature_2m = '°F'; },
    value => { value.current_units.wind_speed_10m = 'm/s'; },
    value => { value.error = true; }
  ];
  for (const mutate of mutations) {
    const payload = current();
    mutate(payload);
    const storage = storageMock();
    const service = createWeatherService({ storage, fetchImpl: async () => response(payload) });
    await assert.rejects(service.getWeather(city()), /некорректные/);
    assert.equal(storage.writes.length, 0);
  }
});

test('одновременные запросы одного города объединяются, разных городов изолированы', async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createWeatherService({ storage: storageMock(), fetchImpl: async () => { calls++; await gate; return response(current()); } });
  const first = service.getWeather(city());
  const second = service.getWeather(city());
  const other = service.getWeather({ ...city(), latitude: 50 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  release();
  const values = await Promise.all([first, second, other]);
  assert.deepEqual(values[0], values[1]);
  assert.notEqual(values[0], values[1]);
});

test('отмена собственного запроса не отменяет потребителя без signal и не возвращает кэш', async () => {
  const controllers = [];
  const releases = [];
  const service = createWeatherService({ storage: storageMock({ [cityKey(city())]: cached(20 * 60 * 1000) }), fetchImpl: async (url, { signal }) => {
    controllers.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      releases.push(() => resolve(response(current())));
    });
  } });
  const controller = new AbortController();
  const cancelled = service.getWeather(city(), { signal: controller.signal });
  const assertion = assert.rejects(cancelled, { name: 'AbortError' });
  const independent = service.getWeather(city());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, 2);
  controller.abort();
  await assertion;
  assert.equal(controllers[0].aborted, true);
  assert.equal(controllers[1].aborted, false);
  releases[1]();
  assert.equal((await independent).stale, false);
});

test('погода и поиск имеют собственный восьмисекундный timeout', async t => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 18, 12) });
  try {
    let started = 0;
    const service = createWeatherService({ storage: storageMock(), fetchImpl: async (url, { signal }) => {
      started++;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const forecast = service.getWeather(city());
    const search = service.searchCities('Вена');
    const forecastsError = assert.rejects(forecast, { name: 'TimeoutError' });
    const searchError = assert.rejects(search, { name: 'TimeoutError' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 2);
    t.mock.timers.tick(8000);
    await Promise.all([forecastsError, searchError]);
  } finally {
    t.mock.timers.reset();
  }
});

test('ошибки хранилища не подменяют успешно полученные условия', async () => {
  const service = createWeatherService({ storage: { async get() { throw new Error('Storage unavailable'); }, async set() { throw new Error('QUOTA_BYTES'); } }, fetchImpl: async () => response(current()) });
  const weather = await service.getWeather(city());
  assert.equal(weather.temperature, 14.2);
  assert.equal(weather.stale, false);
  await assert.rejects(service.getWeather(null), /Выберите город/);
  await assert.rejects(service.getWeather({ ...city(), latitude: NaN }), /координаты/);
  await assert.rejects(service.getWeather(city(), { force: 'yes' }), /режим/);
});

test('старый свежий кэш показывает текущую погоду сразу и обновляется для получения недели', async () => {
  const legacy = cached();
  delete legacy.daily;
  let calls = 0;
  const storage = storageMock({ [cityKey(city())]: legacy });
  const service = createWeatherService({ storage, fetchImpl: async () => { calls++; return response(current()); } });
  assert.deepEqual(await service.getCachedWeather(city()), { ...legacy, daily: [] });
  assert.equal(calls, 0);
  const updated = await service.getWeather(city());
  assert.equal(calls, 1);
  assert.equal(updated.temperature, 14.2);
  assert.deepEqual(updated.daily, week());
  await service.getWeather(city());
  assert.equal(calls, 1);
});

test('отсутствие недельного прогноза не скрывает текущую погоду и не выдумывает дни', async () => {
  const payload = current();
  delete payload.daily;
  delete payload.daily_units;
  const storage = storageMock();
  const service = createWeatherService({ storage, fetchImpl: async () => response(payload) });
  const weather = await service.getWeather(city());
  assert.equal(weather.temperature, 14.2);
  assert.equal(weather.stale, false);
  assert.deepEqual(weather.daily, []);
  assert.deepEqual(storage.raw[cityKey(city())].daily, []);
});

test('уже запрошенный отсутствующий или повреждённый прогноз соблюдает TTL и после перезапуска', async t => {
  for (const malformed of [false, true]) {
    const payload = current();
    if (malformed) payload.daily.weather_code[0] = 100;
    else {
      delete payload.daily;
      delete payload.daily_units;
    }
    let calls = 0;
    const storage = storageMock();
    const fetchImpl = async () => { calls++; return response(payload); };
    const service = createWeatherService({ storage, fetchImpl });
    assert.deepEqual((await service.getWeather(city())).daily, []);
    assert.deepEqual((await service.getWeather(city())).daily, []);
    assert.equal(calls, 1);
    const reopened = createWeatherService({ storage, fetchImpl });
    assert.deepEqual((await reopened.getWeather(city())).daily, []);
    assert.equal(calls, 1);
    t.mock.timers.tick(15 * 60 * 1000);
    assert.deepEqual((await reopened.getWeather(city())).daily, []);
    assert.equal(calls, 2);
  }
});

test('обновление другого города не превращает старый кэш без недели в уже проверенный прогноз', async () => {
  const otherCity = { ...city(), latitude: 50 };
  const legacy = cached();
  delete legacy.daily;
  const storage = storageMock({ [cityKey(city())]: cached(), [cityKey(otherCity)]: legacy });
  const service = createWeatherService({ storage, fetchImpl: async () => response(current()) });
  await service.getWeather(city(), { force: true });
  assert.equal(Object.hasOwn(storage.raw[cityKey(otherCity)], 'daily'), false);
  let calls = 0;
  const reopened = createWeatherService({ storage, fetchImpl: async () => { calls++; return response(current()); } });
  assert.deepEqual((await reopened.getCachedWeather(otherCity)).daily, []);
  assert.deepEqual((await reopened.getWeather(otherCity)).daily, week());
  assert.equal(calls, 1);
});

test('новая дата в часовом поясе города обновляет прогноз до истечения TTL и сохраняет старый кэш доступным', async t => {
  t.mock.timers.tick((9 * 60 + 58) * 60 * 1000);
  const entry = { ...cached(), time: '2026-10-18T23:58' };
  const payload = current();
  payload.current.time = '2026-10-19T00:00';
  payload.daily.time = week().map((day, index) => `2026-10-${19 + index}`);
  let calls = 0;
  const storage = storageMock({ [cityKey(city())]: entry });
  const service = createWeatherService({ storage, fetchImpl: async () => { calls++; return response(payload); } });
  assert.equal((await service.getWeather(city())).daily[0].date, '2026-10-18');
  assert.equal(calls, 0);
  t.mock.timers.tick(4 * 60 * 1000);
  const saved = await service.getCachedWeather(city());
  assert.equal(saved.temperature, entry.temperature);
  assert.equal(saved.daily[0].date, '2026-10-18');
  assert.equal(saved.stale, true);
  assert.equal(calls, 0);
  const refreshed = await service.getWeather(city());
  assert.equal(refreshed.daily[0].date, '2026-10-19');
  assert.equal(refreshed.stale, false);
  assert.equal(calls, 1);
  const westernCity = { ...city(), latitude: 40.7, longitude: -74, timezone: 'America/New_York' };
  const western = createWeatherService({ storage: storageMock({ [cityKey(westernCity)]: { ...entry, time: '2026-10-18T17:58' } }), fetchImpl: async () => assert.fail('В городе ещё не наступила следующая дата') });
  assert.equal((await western.getWeather(westernCity)).stale, false);
});

test('дневной прогноз проверяет единицы, согласованность массивов, даты и диапазоны показателей', async () => {
  const mutations = [
    value => { delete value.daily_units; },
    value => { value.daily_units.temperature_2m_max = '°F'; },
    value => { value.daily_units.temperature_2m_min = '°F'; },
    value => { value.daily_units.precipitation_probability_max = 'mm'; },
    value => { value.daily_units.weather_code = ''; },
    value => { value.daily_units.time = 'unixtime'; },
    value => { delete value.daily.temperature_2m_min; },
    value => { value.daily.weather_code.pop(); },
    value => { value.daily.time[0] = '2026-10-17'; },
    value => { value.daily.time[1] = '2026-10-18'; },
    value => { value.daily.time[1] = '2026-10-20'; },
    value => { value.daily.time[1] = '2026-02-30'; },
    value => { value.daily.time[1] = '2026-10-19T00:00'; },
    value => { value.daily.weather_code[0] = 100; },
    value => { value.daily.weather_code[0] = '2'; },
    value => { value.daily.temperature_2m_max[0] = null; },
    value => { value.daily.temperature_2m_min[0] = '8'; },
    value => { value.daily.temperature_2m_min[0] = 18; },
    value => { value.daily.precipitation_probability_max[0] = -1; },
    value => { value.daily.precipitation_probability_max[0] = 101; },
    value => { value.daily.precipitation_probability_max[0] = '10'; },
    value => { for (const field of Object.keys(value.daily)) value.daily[field].push(value.daily[field][0]); }
  ];
  for (const mutate of mutations) {
    const payload = current();
    mutate(payload);
    const storage = storageMock();
    const service = createWeatherService({ storage, fetchImpl: async () => response(payload) });
    const weather = await service.getWeather(city());
    assert.equal(weather.temperature, 14.2);
    assert.deepEqual(weather.daily, []);
    assert.deepEqual(storage.raw[cityKey(city())].daily, []);
  }
});

test('неполный прогноз остаётся неполным, а null вероятности осадков не становится нулём', async () => {
  const payload = current();
  for (const field of Object.keys(payload.daily)) payload.daily[field] = payload.daily[field].slice(0, 3);
  payload.daily.precipitation_probability_max = [0, null, 100];
  const service = createWeatherService({ storage: storageMock(), fetchImpl: async () => response(payload) });
  const weather = await service.getWeather(city());
  assert.equal(weather.daily.length, 3);
  assert.deepEqual(weather.daily.map(day => day.precipitationProbability), [0, null, 100]);
  assert.equal(weather.daily[2].date, '2026-10-20');
});

test('даты прогноза переходят через конец месяца, года и високосный день', async () => {
  for (const firstDate of ['2026-12-29', '2028-02-27']) {
    const payload = current();
    payload.current.time = `${firstDate}T23:45`;
    const timestamp = Date.parse(`${firstDate}T00:00:00Z`);
    const dates = Array.from({ length: 7 }, (_, index) => new Date(timestamp + index * 86400000).toISOString().slice(0, 10));
    payload.daily.time = dates;
    const service = createWeatherService({ storage: storageMock(), fetchImpl: async () => response(payload) });
    assert.deepEqual((await service.getWeather(city())).daily.map(day => day.date), dates);
  }
});

test('результаты сети, кэша, повторного сервиса и fallback не разделяют вложенные дни', async () => {
  let fail = false;
  const storage = storageMock();
  const service = createWeatherService({ storage, fetchImpl: async () => { if (fail) throw new Error('Offline'); return response(current()); } });
  const [first, second] = await Promise.all([service.getWeather(city()), service.getWeather(city())]);
  assert.notEqual(first.daily, second.daily);
  assert.notEqual(first.daily[0], second.daily[0]);
  first.daily[0].temperatureMax = 999;
  first.daily.pop();
  assert.deepEqual(second.daily, week());
  const read = await service.getCachedWeather(city());
  read.daily[0].code = 95;
  assert.deepEqual((await service.getCachedWeather(city())).daily, week());
  assert.deepEqual(storage.raw[cityKey(city())].daily, week());
  const reopened = createWeatherService({ storage, fetchImpl: async () => assert.fail('Свежий недельный кэш вызвал сеть') });
  assert.deepEqual((await reopened.getWeather(city())).daily, week());
  fail = true;
  const fallback = await service.getWeather(city(), { force: true });
  assert.equal(fallback.stale, true);
  assert.deepEqual(fallback.daily, week());
  fallback.daily[0].temperatureMin = -999;
  assert.deepEqual((await service.getCachedWeather(city())).daily, week());
});

test('повреждённая неделя в кэше не скрывает сохранённые текущие условия и запускает обновление', async () => {
  const entry = cached();
  entry.daily[1].date = entry.daily[0].date;
  let calls = 0;
  const service = createWeatherService({ storage: storageMock({ [cityKey(city())]: entry }), fetchImpl: async () => { calls++; return response(current()); } });
  const saved = await service.getCachedWeather(city());
  assert.equal(saved.temperature, entry.temperature);
  assert.deepEqual(saved.daily, []);
  assert.equal(calls, 0);
  assert.deepEqual((await service.getWeather(city())).daily, week());
  assert.equal(calls, 1);
});

test('WMO-коды имеют русские подписи, дневные и ночные иконки', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Ясно', icon: 'sun' });
  assert.deepEqual(describeWeather(0, false), { label: 'Ясно', icon: 'moon' });
  assert.equal(describeWeather(2, true).icon, 'cloud-sun');
  assert.equal(describeWeather(2, false).icon, 'cloud');
  for (const [codes, icon] of [[[3], 'cloud'], [[45, 48], 'fog'], [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], 'rain'], [[68, 69, 71, 73, 75, 77, 83, 84, 85, 86], 'snow'], [[95, 96, 97, 99], 'storm']]) {
    for (const code of codes) assert.equal(describeWeather(code, true).icon, icon);
  }
  for (const code of [68, 69, 83, 84]) assert.match(describeWeather(code, true).label, /со снегом/);
  assert.deepEqual(describeWeather(100, true), { label: 'Условия неизвестны', icon: 'cloud' });
});
