import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetWeatherService } from '../src/met-weather.js';
import { createDefaultState } from '../src/model.js';

const NOW = Date.UTC(2026, 9, 19, 10, 30);
const clone = value => JSON.parse(JSON.stringify(value));
const city = () => createDefaultState().settings.weatherCity;
const key = (value = city()) => `${Math.trunc(value.latitude * 10000) / 10000},${Math.trunc(value.longitude * 10000) / 10000}@${value.timezone}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function point(timestamp, temperature = 12, symbol = 'partlycloudy_day', wind = 2) {
  return { time: new Date(timestamp).toISOString(), data: { instant: { details: { air_temperature: temperature, wind_speed: wind } }, next_1_hours: { summary: { symbol_code: symbol } } } };
}

function forecast() {
  const timeseries = [];
  for (let day = 0; day < 9; day++) {
    for (let hour = 0; hour < 24; hour += 6) timeseries.push(point(Date.UTC(2026, 9, 19 + day, hour), 8 + day + hour / 3));
  }
  timeseries.push(point(Date.UTC(2026, 9, 19, 10), 14.2));
  return { type: 'Feature', properties: { meta: { updated_at: '2026-10-19T09:00:00Z', units: { air_temperature: 'celsius', wind_speed: 'm/s' } }, timeseries } };
}

function response(payload = forecast(), headers = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), async json() { assert.notEqual(status, 304); return clone(payload); } };
}

function storageMock(initial) {
  let raw = initial;
  const writes = [];
  return {
    writes,
    async get(name) { assert.equal(name, 'tabloMetWeatherCache'); return raw === undefined ? {} : { tabloMetWeatherCache: clone(raw) }; },
    async set(values) { raw = clone(values.tabloMetWeatherCache); writes.push(clone(raw)); },
    get raw() { return raw; }
  };
}

function cached({ age = 0, expiresAt = NOW + 15 * 60000 } = {}) {
  const samples = [];
  for (let day = 0; day < 9; day++) {
    for (let hour = 0; hour < 24; hour += 6) samples.push({ timestamp: Date.UTC(2026, 9, 19 + day, hour), temperature: 8 + hour * 4 / 9, windSpeed: 2, code: 2, isDay: true });
  }
  samples.push({ timestamp: NOW - 30 * 60000, temperature: 12, windSpeed: 2, code: 2, isDay: true });
  samples.sort((a, b) => a.timestamp - b.timestamp);
  return {
    weather: { temperature: 12, apparentTemperature: null, code: 2, isDay: true, windSpeed: 7.2, time: '2026-10-19T12:00', fetchedAt: NOW - age, stale: false, daily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${19 + index}`, code: 2, temperatureMin: 8, temperatureMax: 16, precipitationProbability: null })), forecastBasis: 'samples' },
    samples,
    expiresAt,
    lastModified: new Date(NOW - 60 * 60000).toUTCString()
  };
}

test('MET использует HTTPS, точность до четырёх знаков и собственный честный ASCII User-Agent', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let request;
  const storage = storageMock();
  const service = createMetWeatherService({ storage, fetchImpl: async (url, options) => { request = { url: new URL(url), options }; return response(); } });
  const result = await service.getWeather(city());
  assert.equal(request.url.origin, 'https://api.met.no');
  assert.equal(request.url.pathname, '/weatherapi/locationforecast/2.0/compact');
  assert.equal(request.url.searchParams.get('lat'), '48.2084');
  assert.equal(request.url.searchParams.get('lon'), '16.372');
  assert.match(request.options.headers['User-Agent'], /^Tablo-Firefox\/0\.5\.0 .*https:\/\/addons\.mozilla\.org\/addon\/3101048\//);
  assert.doesNotMatch(request.options.headers['User-Agent'], /[^\x20-\x7e]/);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.redirect, 'follow');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(result.forecastBasis, 'samples');
  assert.equal(result.apparentTemperature, null);
  assert.equal(result.windSpeed, 7.2);
  assert.equal(result.time, '2026-10-19T12:00');
  assert.equal(result.temperature, 14.2);
  assert.equal(result.daily.length, 7);
  assert.deepEqual(storage.raw[key()].weather, result);
  assert.equal(storage.raw[key()].properties, undefined);
});

test('текущая погода выбирает ближайшую точку, а не первый элемент или порядок ответа', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  payload.properties.timeseries = [point(NOW - 9 * 3600000, -20), point(NOW + 3600000, 30), point(NOW - 10 * 60000, 16, 'clearsky_day'), point(NOW + 4 * 3600000, 40)];
  const service = createMetWeatherService({ fetchImpl: async () => response(payload) });
  const result = await service.getWeather(city());
  assert.equal(result.temperature, 16);
  assert.equal(result.code, 0);
  assert.equal(result.time, '2026-10-19T12:20');
});

test('устаревший ответ без точки в пределах шести часов не подменяет текущую погоду', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const offset of [-6 * 3600000 - 1, 6 * 3600000 + 1]) {
    const payload = forecast();
    payload.properties.timeseries = [point(NOW + offset)];
    const service = createMetWeatherService({ fetchImpl: async () => response(payload) });
    await assert.rejects(service.getWeather(city()), /актуальный прогноз/);
  }
});

test('температурный диапазон считается из реальных точек дня, условие — ближайшее к местному полудню', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  payload.properties.timeseries = [point(NOW - 30 * 60000, 12, 'clearsky_day'), point(NOW + 90 * 60000, 8, 'rain'), point(NOW + 270 * 60000, 19, 'snow')];
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
  assert.deepEqual(result.daily, [{ date: '2026-10-19', code: 0, temperatureMin: 8, temperatureMax: 19, precipitationProbability: null }]);
  assert.equal(result.forecastBasis, 'samples');
});

test('дни группируются в часовом поясе города, включая переход суток относительно UTC', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const tokyo = { ...city(), timezone: 'Asia/Tokyo' };
  const payload = forecast();
  payload.properties.timeseries = [point(NOW, 11), point(Date.UTC(2026, 9, 19, 16), 7), point(Date.UTC(2026, 9, 20, 3), 21, 'clearsky_day')];
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(tokyo);
  assert.equal(result.time, '2026-10-19T19:30');
  assert.deepEqual(result.daily.map(day => [day.date, day.temperatureMin, day.temperatureMax]), [['2026-10-19', 11, 11], ['2026-10-20', 7, 21]]);
});

test('день перехода на зимнее время остаётся одним местным днём', async t => {
  const autumn = Date.UTC(2026, 9, 25, 0, 30);
  t.mock.timers.enable({ apis: ['Date'], now: autumn });
  const payload = forecast();
  payload.properties.timeseries = [point(autumn, 9, 'clearsky_night'), point(autumn + 3600000, 5, 'fair_night'), point(autumn + 10 * 3600000, 14)];
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
  assert.equal(result.time, '2026-10-25T02:30');
  assert.equal(result.isDay, false);
  assert.deepEqual(result.daily.map(day => [day.date, day.temperatureMin, day.temperatureMax]), [['2026-10-25', 5, 14]]);
});

test('пропущенный день прерывает неделю, отсутствующие дни не выдумываются', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  payload.properties.timeseries = payload.properties.timeseries.filter(value => !value.time.startsWith('2026-10-21'));
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
  assert.deepEqual(result.daily.map(day => day.date), ['2026-10-19', '2026-10-20']);
});

test('испорченная будущая часть прогноза не скрывает валидные текущие условия', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  for (const value of payload.properties.timeseries) {
    if (value.time.startsWith('2026-10-20')) value.data.next_1_hours.summary.symbol_code = '<img src=x>';
  }
  payload.properties.timeseries.push({ time: '2026-02-30T10:00:00Z', data: { instant: { details: { air_temperature: -999 } } } });
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
  assert.equal(result.temperature, 14.2);
  assert.equal(result.daily.length, 1);
});

test('официальные символы MET, включая дождь со снегом и историческое lightss, преобразуются явно', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const expected = { clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45, lightrain: 61, rain: 63, heavyrain: 65, lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82, lightsleet: 68, sleet: 69, heavysleet: 69, lightsleetshowers: 83, sleetshowers: 84, heavysleetshowers: 84, lightsnow: 71, snow: 73, heavysnow: 75, lightsnowshowers: 85, snowshowers: 86, heavysnowshowers: 86, lightssleetshowersandthunder: 95, lightssnowshowersandthunder: 95, heavyrainandthunder: 97 };
  for (const [name, code] of Object.entries(expected)) {
    const payload = forecast();
    payload.properties.timeseries = [point(NOW, 12, name)];
    const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
    assert.equal(result.code, code, name);
  }
  for (const [name, isDay] of [['clearsky_day', true], ['clearsky_night', false], ['fair_polartwilight', false]]) {
    const payload = forecast();
    payload.properties.timeseries = [point(NOW, 12, name)];
    assert.equal((await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city())).isDay, isDay);
  }
});

test('при отсутствии next_1_hours используется настоящий шестичасовой символ', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  const value = point(NOW, 12);
  delete value.data.next_1_hours;
  value.data.next_6_hours = { summary: { symbol_code: 'snowshowers_night' } };
  payload.properties.timeseries = [value];
  const result = await createMetWeatherService({ fetchImpl: async () => response(payload) }).getWeather(city());
  assert.equal(result.code, 86);
  assert.equal(result.isDay, false);
});

test('неверные единицы, числовые строки и отсутствующие текущие условия отклоняются', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const mutate of [
    value => { value.properties.meta.units.air_temperature = 'fahrenheit'; },
    value => { value.properties.meta.units.wind_speed = 'km/h'; },
    value => { value.properties.timeseries = []; },
    value => { value.properties.timeseries = [point(NOW, '12')]; },
    value => { value.properties.timeseries = [point(NOW, 12, 'unknown')]; },
    value => { value.properties.timeseries = [point(NOW, 12, 'fair_day', -1)]; },
    value => { value.properties.timeseries = [point(NOW, 12, 'fair_day', null)]; },
    value => { value.properties.timeseries = [point(NOW, null)]; }
  ]) {
    const payload = forecast();
    mutate(payload);
    const storage = storageMock();
    await assert.rejects(createMetWeatherService({ storage, fetchImpl: async () => response(payload) }).getWeather(city()), /некорректные|актуальный/);
    assert.equal(storage.writes.length, 0);
  }
});

test('Expires соблюдается даже для force и при повторном создании сервиса', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock();
  let calls = 0;
  const service = createMetWeatherService({ storage, fetchImpl: async () => { calls++; return response(forecast(), { Expires: new Date(NOW + 30 * 60000).toUTCString(), 'Last-Modified': new Date(NOW - 60 * 60000).toUTCString() }); } });
  const first = await service.getWeather(city());
  first.daily[0].temperatureMin = -999;
  t.mock.timers.tick(20 * 60000);
  assert.equal((await service.getWeather(city(), { force: true })).daily[0].temperatureMin, 8);
  assert.equal(calls, 1);
  const reopened = createMetWeatherService({ storage, fetchImpl: async () => assert.fail('Expires не разрешает сетевой запрос') });
  assert.equal((await reopened.getWeather(city(), { force: true })).stale, false);
});

test('условное обновление передаёт исходный Last-Modified и обрабатывает 304 без JSON', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const saved = cached({ expiresAt: NOW });
  const storage = storageMock({ [key()]: saved });
  let calls = 0;
  const service = createMetWeatherService({ storage, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.headers['If-Modified-Since'], saved.lastModified);
    return response(undefined, { Expires: new Date(NOW + 3600000).toUTCString() }, 304);
  } });
  const renewed = await service.getWeather(city());
  assert.deepEqual(renewed, saved.weather);
  assert.equal(storage.raw[key()].lastModified, saved.lastModified);
  assert.equal(storage.raw[key()].expiresAt, NOW + 3600000);
  assert.equal((await service.getWeather(city(), { force: true })).stale, false);
  assert.equal(calls, 1);
});

test('304 без сохранённого ответа не создаёт погоду', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const service = createMetWeatherService({ storage: storageMock(), fetchImpl: async () => response(undefined, {}, 304) });
  await assert.rejects(service.getWeather(city()), /без кэша/);
});

test('Expires дольше шести часов не обходится новым запросом, даже когда обычный stale TTL прошёл', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock({ [key()]: cached({ age: 7 * 3600000, expiresAt: NOW + 3600000 }) });
  const service = createMetWeatherService({ storage, fetchImpl: async () => assert.fail('Expires ещё не истёк') });
  assert.equal((await service.getWeather(city(), { force: true })).stale, false);
  assert.equal((await service.getCachedWeather(city())).stale, false);
});

test('чтение кэша не делает сеть и записи, возвращает глубокую копию и признак истёкшего Expires', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const saved = cached({ age: 20 * 60000, expiresAt: NOW - 1 });
  const storage = storageMock({ [key()]: saved });
  let reads = 0;
  const service = createMetWeatherService({ storage: { async get(name) { reads++; return storage.get(name); }, set: values => storage.set(values) }, fetchImpl: async () => assert.fail('Сеть вызвана чтением кэша') });
  const [first, second] = await Promise.all([service.getCachedWeather(city()), service.getCachedWeather(city())]);
  assert.equal(first.stale, true);
  first.daily[0].temperatureMin = -999;
  assert.equal(second.daily[0].temperatureMin, 8);
  assert.equal((await service.getCachedWeather(city())).daily[0].temperatureMin, 8);
  assert.equal(reads, 1);
  assert.equal(storage.writes.length, 0);
});

test('ошибка обновления сохраняет допустимый старый прогноз, но не скрывается кэшем старше шести часов', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const saved = cached({ age: 20 * 60000, expiresAt: NOW - 1 });
  const storage = storageMock({ [key()]: saved });
  const service = createMetWeatherService({ storage, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.deepEqual(await service.getWeather(city()), { ...saved.weather, stale: true });
  assert.equal(storage.writes.length, 0);
  t.mock.timers.tick(6 * 3600000);
  assert.equal(await service.getCachedWeather(city()), null);
  await assert.rejects(service.getWeather(city()), /Offline/);
});

test('повреждённый, будущий и неверно адресованный кэш не используется', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const raw of [undefined, {}, { [key()]: { ...cached(), weather: { ...cached().weather, fetchedAt: NOW + 1 } } }, { [key()]: { ...cached(), weather: { ...cached().weather, apparentTemperature: 12 } } }, { [key()]: { ...cached(), lastModified: 'bad\r\nheader' } }, { '48.20849,16.37208@Europe/Vienna': cached() }]) {
    const service = createMetWeatherService({ storage: storageMock(raw), fetchImpl: async () => assert.fail('Неожиданный сетевой запрос') });
    assert.equal(await service.getCachedWeather(city()), null);
  }
});

test('сохранённые повреждённые дневные данные восстанавливаются из проверенных нормализованных точек', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const saved = cached();
  saved.weather.daily[0].temperatureMin = 999;
  const service = createMetWeatherService({ storage: storageMock({ [key()]: saved }), fetchImpl: async () => assert.fail('Неожиданный сетевой запрос') });
  const result = await service.getCachedWeather(city());
  assert.equal(result.temperature, 12);
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily[0].temperatureMin, 8);
});

test('304 с течением времени пересчитывает текущую точку из сохранённого ряда', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock();
  let calls = 0;
  const service = createMetWeatherService({ storage, fetchImpl: async () => {
    calls++;
    return calls === 1 ? response(forecast(), { Expires: new Date(NOW + 60000).toUTCString(), 'Last-Modified': new Date(NOW - 3600000).toUTCString() }) : response(undefined, { Expires: new Date(NOW + 3 * 3600000).toUTCString() }, 304);
  } });
  assert.equal((await service.getWeather(city())).temperature, 14.2);
  t.mock.timers.tick(2 * 3600000);
  const renewed = await service.getWeather(city());
  assert.equal(renewed.temperature, 12);
  assert.equal(renewed.time, '2026-10-19T14:00');
  assert.equal(renewed.fetchedAt, NOW + 2 * 3600000);
  assert.equal(calls, 2);
});

test('устаревший кэш сохраняет Last-Modified для условной проверки после перезапуска', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const saved = cached({ age: 7 * 3600000, expiresAt: NOW - 3600000 });
  const storage = storageMock({ [key()]: saved });
  const service = createMetWeatherService({ storage, fetchImpl: async (url, options) => {
    assert.equal(options.headers['If-Modified-Since'], saved.lastModified);
    return response(undefined, { Expires: new Date(NOW + 3600000).toUTCString() }, 304);
  } });
  assert.equal(await service.getCachedWeather(city()), null);
  const renewed = await service.getWeather(city());
  assert.equal(renewed.fetchedAt, NOW);
  assert.equal(renewed.stale, false);
  assert.equal(renewed.temperature, 12);
});

test('неистёкший Expires не мешает пересчитать погоду и дни после местной полуночи', async t => {
  const beforeMidnight = Date.UTC(2026, 9, 19, 21, 30);
  t.mock.timers.enable({ apis: ['Date'], now: beforeMidnight });
  const payload = forecast();
  payload.properties.timeseries.push(point(Date.UTC(2026, 9, 19, 21), 5, 'clearsky_night'), point(Date.UTC(2026, 9, 19, 22), 3, 'snow'), point(Date.UTC(2026, 9, 19, 23), 1, 'snow'));
  let calls = 0;
  const storage = storageMock();
  const service = createMetWeatherService({ storage, fetchImpl: async () => { calls++; return response(payload, { Expires: new Date(beforeMidnight + 3 * 3600000).toUTCString() }); } });
  const first = await service.getWeather(city());
  assert.equal(first.temperature, 5);
  assert.equal(first.daily[0].date, '2026-10-19');
  t.mock.timers.tick(3600000);
  const reopened = createMetWeatherService({ storage, fetchImpl: async () => assert.fail('Expires запрещает обновление') });
  for (const renewed of [await service.getWeather(city(), { force: true }), await service.getCachedWeather(city()), await reopened.getWeather(city())]) {
    assert.equal(renewed.temperature, 3);
    assert.equal(renewed.time, '2026-10-20T00:00');
    assert.equal(renewed.daily[0].date, '2026-10-20');
    assert.equal(renewed.fetchedAt, beforeMidnight);
  }
  assert.equal(calls, 1);
});

test('одновременные запросы объединяются только для одного города и часового пояса', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createMetWeatherService({ storage: storageMock(), fetchImpl: async () => { calls++; await gate; return response(); } });
  const first = service.getWeather(city());
  const second = service.getWeather(city());
  const other = service.getWeather({ ...city(), timezone: 'UTC' });
  await tick();
  assert.equal(calls, 2);
  release();
  const results = await Promise.all([first, second, other]);
  assert.deepEqual(results[0], results[1]);
  assert.notEqual(results[0].daily[0], results[1].daily[0]);
  assert.notEqual(results[0].time, results[2].time);
});

test('отмена запроса не возвращает старый кэш и не отменяет независимого потребителя', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const signals = [];
  const releases = [];
  const service = createMetWeatherService({ storage: storageMock({ [key()]: cached({ age: 20 * 60000, expiresAt: NOW - 1 }) }), fetchImpl: async (url, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      releases.push(() => resolve(response()));
    });
  } });
  const controller = new AbortController();
  const cancelled = service.getWeather(city(), { signal: controller.signal });
  const assertion = assert.rejects(cancelled, { name: 'AbortError' });
  const independent = service.getWeather(city());
  await tick();
  assert.equal(signals.length, 2);
  controller.abort();
  await assertion;
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  releases[1]();
  assert.equal((await independent).stale, false);
});

test('тайм-аут MET ограничен восемью секундами', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const service = createMetWeatherService({ storage: storageMock(), fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const request = service.getWeather(city());
  const assertion = assert.rejects(request, { name: 'TimeoutError' });
  await tick();
  t.mock.timers.tick(8000);
  await assertion;
});

test('ошибки хранилища не скрывают полученные данные, неверный ввод не вызывает сеть', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let calls = 0;
  const service = createMetWeatherService({ storage: { async get() { throw new Error('Storage unavailable'); }, async set() { throw new Error('Quota'); } }, fetchImpl: async () => { calls++; return response(); } });
  assert.equal((await service.getWeather(city())).temperature, 14.2);
  await assert.rejects(service.getWeather(null), /Выберите город/);
  await assert.rejects(service.getCachedWeather({ ...city(), timezone: '<invalid>' }), /пояс/);
  await assert.rejects(service.getWeather(city(), { force: 'yes' }), /режим/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(service.getWeather(city(), { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('429 сохраняет Retry-After в секундах, в HTTP-date и запасной срок при отсутствии или повреждении заголовка', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const [value, delay] of [['120', 120000], [new Date(NOW + 180000).toUTCString(), 180000], [undefined, 15 * 60000], ['invalid', 15 * 60000], ['-1', 15 * 60000]]) {
    const storage = storageMock();
    let calls = 0;
    const service = createMetWeatherService({ storage, fetchImpl: async () => { calls++; return response(undefined, value === undefined ? {} : { 'Retry-After': value }, 429); } });
    await assert.rejects(service.getWeather(city()), /HTTP 429/);
    assert.equal(storage.raw._retryAfter, NOW + delay);
    await assert.rejects(service.getWeather(city(), { force: true }), /ограничил запросы/);
    const reopened = createMetWeatherService({ storage, fetchImpl: async () => assert.fail('Retry-After запрещает запрос после перезапуска') });
    await assert.rejects(reopened.getWeather(city(), { force: true }), /ограничил запросы/);
    assert.equal(calls, 1);
  }
});

test('backoff возвращает допустимый старый кэш, действует до срока и очищается успешным ответом', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock({ [key()]: cached({ age: 20 * 60000, expiresAt: NOW - 1 }) });
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? response(undefined, { 'Retry-After': '120' }, 429) : response();
  };
  const first = createMetWeatherService({ storage, fetchImpl });
  assert.equal((await first.getWeather(city())).stale, true);
  const reopened = createMetWeatherService({ storage, fetchImpl });
  assert.equal((await reopened.getWeather(city(), { force: true })).stale, true);
  t.mock.timers.tick(119999);
  assert.equal((await reopened.getWeather(city(), { force: true })).stale, true);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  const renewed = await reopened.getWeather(city(), { force: true });
  assert.equal(calls, 2);
  assert.equal(renewed.stale, false);
  assert.equal(renewed.temperature, 14.2);
  assert.equal(storage.raw._retryAfter, undefined);
});

test('backoff не возвращает недопустимо старый кэш и распространяется на другие города', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock({ [key()]: cached({ age: 5 * 3600000, expiresAt: NOW - 1 }) });
  let calls = 0;
  const service = createMetWeatherService({ storage, fetchImpl: async () => { calls++; return response(undefined, { 'Retry-After': '7200' }, 429); } });
  assert.equal((await service.getWeather(city())).stale, true);
  await assert.rejects(service.getWeather({ ...city(), latitude: 50 }, { force: true }), /ограничил запросы/);
  t.mock.timers.tick(3600001);
  await assert.rejects(service.getWeather(city(), { force: true }), /ограничил запросы/);
  const reopened = createMetWeatherService({ storage, fetchImpl: async () => assert.fail('Ограничение сервиса ещё действует') });
  await assert.rejects(reopened.getWeather(city()), /ограничил запросы/);
  assert.equal(calls, 1);
});

test('успешная проверка 304 после окончания backoff тоже удаляет сохранённое ограничение', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock({ [key()]: cached({ age: 20 * 60000, expiresAt: NOW - 1 }), _retryAfter: NOW - 1 });
  const service = createMetWeatherService({ storage, fetchImpl: async () => response(undefined, { Expires: new Date(NOW + 3600000).toUTCString() }, 304) });
  assert.equal((await service.getWeather(city())).stale, false);
  assert.equal(storage.raw._retryAfter, undefined);
});

test('успешный параллельный ответ другого города не снимает новое действующее ограничение 429', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const storage = storageMock();
  let calls = 0;
  let release;
  const fetchImpl = async url => {
    calls++;
    if (new URL(url).searchParams.get('lat') === '50') return new Promise(resolve => { release = () => resolve(response()); });
    return response(undefined, { 'Retry-After': '120' }, 429);
  };
  const service = createMetWeatherService({ storage, fetchImpl });
  const successful = service.getWeather({ ...city(), latitude: 50 });
  const limited = assert.rejects(service.getWeather(city()), /HTTP 429/);
  await tick();
  await limited;
  assert.equal(calls, 2);
  assert.equal(storage.raw._retryAfter, NOW + 120000);
  release();
  assert.equal((await successful).stale, false);
  assert.equal(storage.raw._retryAfter, NOW + 120000);
  await assert.rejects(service.getWeather({ ...city(), latitude: 51 }, { force: true }), /ограничил запросы/);
  const reopened = createMetWeatherService({ storage, fetchImpl });
  await assert.rejects(reopened.getWeather({ ...city(), latitude: 52 }, { force: true }), /ограничил запросы/);
  assert.equal(calls, 2);
});

test('несогласованный кэш с будущим Expires восстанавливается полным запросом без If-Modified-Since', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  payload.properties.timeseries = [point(NOW, 12, 'fair_day', 2)];
  const storage = storageMock();
  const initial = createMetWeatherService({ storage, fetchImpl: async () => response(payload, { Expires: new Date(NOW + 3600000).toUTCString(), 'Last-Modified': new Date(NOW - 3600000).toUTCString() }) });
  await initial.getWeather(city());
  storage.raw[key()].samples[0].windSpeed = null;
  let calls = 0;
  const reopened = createMetWeatherService({ storage, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.headers['If-Modified-Since'], undefined);
    return response(payload, { Expires: new Date(NOW + 3600000).toUTCString() });
  } });
  assert.equal(await reopened.getCachedWeather(city()), null);
  const repaired = await reopened.getWeather(city(), { force: true });
  assert.equal(calls, 1);
  assert.equal(repaired.windSpeed, 7.2);
  assert.equal(repaired.stale, false);
  assert.equal(storage.raw[key()].samples[0].windSpeed, 2);
});

test('если точки стали непригодны с течением времени, будущий Expires не блокирует восстановление', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const payload = forecast();
  payload.properties.timeseries = [point(NOW, 12, 'fair_day', 2)];
  const storage = storageMock();
  let calls = 0;
  const service = createMetWeatherService({ storage, fetchImpl: async (url, options) => {
    calls++;
    if (calls === 2) {
      assert.equal(options.headers['If-Modified-Since'], undefined);
      payload.properties.timeseries = [point(Date.now(), 14, 'fair_day', 3)];
    }
    return response(payload, { Expires: new Date(NOW + 12 * 3600000).toUTCString(), 'Last-Modified': new Date(NOW - 3600000).toUTCString() });
  } });
  await service.getWeather(city());
  t.mock.timers.tick(6 * 3600000 + 1);
  assert.equal(await service.getCachedWeather(city()), null);
  const renewed = await service.getWeather(city(), { force: true });
  assert.equal(calls, 2);
  assert.equal(renewed.temperature, 14);
});
