import { t, locale } from './localize.js';
import { validateWeatherCity } from './model.js';

const CACHE_KEY = 'tabloWeatherCache';
const CACHE_TTL = 15 * 60 * 1000;
const STALE_TTL = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 8000;
const WEATHER_CODES = new Map([
  [0, ['Ясно', 'sun']],
  [1, ['Преимущественно ясно', 'sun']],
  [2, ['Переменная облачность', 'cloud-sun']],
  [3, ['Пасмурно', 'cloud']],
  [45, ['Туман', 'fog']],
  [48, ['Туман с изморозью', 'fog']],
  [51, ['Небольшая морось', 'rain']],
  [53, ['Морось', 'rain']],
  [55, ['Сильная морось', 'rain']],
  [56, ['Небольшая переохлаждённая морось', 'rain']],
  [57, ['Сильная переохлаждённая морось', 'rain']],
  [61, ['Небольшой дождь', 'rain']],
  [63, ['Дождь', 'rain']],
  [65, ['Сильный дождь', 'rain']],
  [66, ['Небольшой ледяной дождь', 'rain']],
  [67, ['Сильный ледяной дождь', 'rain']],
  [68, ['Небольшой дождь со снегом', 'snow']],
  [69, ['Дождь со снегом', 'snow']],
  [71, ['Небольшой снег', 'snow']],
  [73, ['Снег', 'snow']],
  [75, ['Сильный снег', 'snow']],
  [77, ['Снежные зёрна', 'snow']],
  [80, ['Небольшой ливень', 'rain']],
  [81, ['Ливень', 'rain']],
  [82, ['Сильный ливень', 'rain']],
  [83, ['Небольшой ливень со снегом', 'snow']],
  [84, ['Ливень со снегом', 'snow']],
  [85, ['Небольшой снежный ливень', 'snow']],
  [86, ['Сильный снежный ливень', 'snow']],
  [95, ['Гроза', 'storm']],
  [96, ['Гроза с небольшим градом', 'storm']],
  [97, ['Сильная гроза', 'storm']],
  [99, ['Гроза с сильным градом', 'storm']]
]);

export function describeWeather(code, isDay) {
  const [label, icon] = WEATHER_CODES.get(code) || ['Условия неизвестны', 'cloud'];
  return { label: t(label), icon: !isDay && icon === 'sun' ? 'moon' : !isDay && icon === 'cloud-sun' ? 'cloud' : icon };
}

function abortError() {
  return new DOMException(t('Запрос отменён.'), 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function validateDaily(value, time) {
  if (!Array.isArray(value) || !value.length || value.length > 7) return [];
  const firstDay = time.slice(0, 10);
  const firstTimestamp = Date.parse(`${firstDay}T00:00:00Z`);
  const days = [];
  for (let index = 0; index < value.length; index++) {
    const day = value[index];
    const expectedDate = new Date(firstTimestamp + index * 86400000).toISOString().slice(0, 10);
    if (!plainObject(day) || day.date !== expectedDate || !WEATHER_CODES.has(day.code) || !Number.isFinite(day.temperatureMax) || !Number.isFinite(day.temperatureMin) || day.temperatureMin > day.temperatureMax || !(day.precipitationProbability === null || Number.isFinite(day.precipitationProbability) && day.precipitationProbability >= 0 && day.precipitationProbability <= 100)) return [];
    days.push({ date: day.date, code: day.code, temperatureMax: day.temperatureMax, temperatureMin: day.temperatureMin, precipitationProbability: day.precipitationProbability });
  }
  return days;
}

function copyWeather(value, stale = value.stale) {
  return { ...value, daily: value.daily.map(day => ({ ...day })), stale };
}

function cityDate(city) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now()));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function validateWeather(value, now = Date.now()) {
  if (!plainObject(value) || !Number.isFinite(value.temperature) || !Number.isFinite(value.apparentTemperature) || !WEATHER_CODES.has(value.code) || typeof value.isDay !== 'boolean' || !Number.isFinite(value.windSpeed) || value.windSpeed < 0 || !validTime(value.time) || !Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > now) {
    throw new Error(t('Сервис погоды вернул некорректные данные.'));
  }
  return {
    temperature: value.temperature,
    apparentTemperature: value.apparentTemperature,
    code: value.code,
    isDay: value.isDay,
    windSpeed: value.windSpeed,
    time: value.time,
    fetchedAt: value.fetchedAt,
    daily: validateDaily(value.daily, value.time),
    stale: false
  };
}

function parseDaily(payload) {
  const daily = payload.daily;
  const units = payload.daily_units;
  const fields = ['time', 'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max'];
  if (!plainObject(daily) || !plainObject(units) || units.time !== 'iso8601' || units.weather_code !== 'wmo code' || units.temperature_2m_max !== '°C' || units.temperature_2m_min !== '°C' || units.precipitation_probability_max !== '%' || fields.some(field => !Array.isArray(daily[field])) || !daily.time.length || daily.time.length > 7 || fields.some(field => daily[field].length !== daily.time.length)) return [];
  return daily.time.map((date, index) => ({ date, code: daily.weather_code[index], temperatureMax: daily.temperature_2m_max[index], temperatureMin: daily.temperature_2m_min[index], precipitationProbability: daily.precipitation_probability_max[index] }));
}

function parseCurrent(payload) {
  const current = payload?.current;
  const units = payload?.current_units;
  if (!plainObject(payload) || payload.error || !plainObject(current) || !plainObject(units) || units.temperature_2m !== '°C' || units.apparent_temperature !== '°C' || units.wind_speed_10m !== 'km/h' || units.weather_code !== 'wmo code' || units.is_day !== '' || units.time !== 'iso8601' || ![0, 1].includes(current.is_day)) {
    throw new Error(t('Сервис погоды вернул некорректные данные.'));
  }
  return validateWeather({
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    code: current.weather_code,
    isDay: current.is_day === 1,
    windSpeed: current.wind_speed_10m,
    time: current.time,
    daily: parseDaily(payload),
    fetchedAt: Date.now()
  });
}

export function createWeatherService({ fetchImpl = globalThis.fetch, storage = globalThis.browser?.storage?.local } = {}) {
  const cache = new Map();
  const needsForecast = new Set();
  const pending = new Map();
  let cacheLoaded;
  let writeQueue = Promise.resolve();

  async function request(url, signal) {
    checkAbort(signal);
    if (typeof fetchImpl !== 'function') throw new Error(t('Сетевые запросы недоступны.'));
    const controller = new AbortController();
    let timeoutError;
    const onAbort = () => controller.abort(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timeoutError = new Error(t('Сервис погоды не ответил за 8 секунд.'));
      timeoutError.name = 'TimeoutError';
      controller.abort(timeoutError);
    }, REQUEST_TIMEOUT);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
      checkAbort(signal);
      if (!response.ok) throw new Error(t('Сервис погоды недоступен (HTTP {status}).', { status: response.status }));
      const payload = await response.json();
      checkAbort(signal);
      return payload;
    } catch (error) {
      checkAbort(signal);
      if (timeoutError) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function loadCache() {
    if (!cacheLoaded) {
      cacheLoaded = (async () => {
        if (!storage?.get) return;
        try {
          const raw = (await storage.get(CACHE_KEY))?.[CACHE_KEY];
          if (!plainObject(raw)) return;
          const now = Date.now();
          for (const [key, value] of Object.entries(raw).slice(0, 24)) {
            if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(key)) continue;
            try {
              const weather = validateWeather(value, now);
              if (now - weather.fetchedAt <= STALE_TTL) {
                cache.set(key, weather);
                if (!Array.isArray(value.daily) || value.daily.length && !weather.daily.length) needsForecast.add(key);
              }
            } catch {}
          }
        } catch {}
      })();
    }
    return cacheLoaded;
  }

  async function saveCache(key, weather) {
    cache.set(key, weather);
    needsForecast.delete(key);
    const now = Date.now();
    for (const [cityKey, value] of cache) {
      if (now - value.fetchedAt > STALE_TTL) {
        cache.delete(cityKey);
        needsForecast.delete(cityKey);
      }
    }
    while (cache.size > 24) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      needsForecast.delete(oldest);
    }
    if (!storage?.set) return;
    writeQueue = writeQueue.catch(() => {}).then(() => storage.set({ [CACHE_KEY]: Object.fromEntries([...cache].map(([cityKey, value]) => {
      if (!needsForecast.has(cityKey)) return [cityKey, value];
      const { daily, ...legacy } = value;
      return [cityKey, legacy];
    })) }));
    try { await writeQueue; } catch {}
  }

  async function searchCities(query, { signal } = {}) {
    checkAbort(signal);
    if (typeof query !== 'string') throw new Error(t('Укажите название города.'));
    const name = query.trim();
    if (name.length < 2) return [];
    if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(t('Некорректное название города.'));
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name, count: '6', language: locale(), format: 'json' });
    const payload = await request(url.href, signal);
    if (!plainObject(payload) || payload.error || (payload.results !== undefined && !Array.isArray(payload.results))) throw new Error(t('Сервис поиска городов вернул некорректные данные.'));
    const cities = [];
    const seen = new Set();
    for (const value of (payload.results || []).slice(0, 6)) {
      if (!plainObject(value)) continue;
      try {
        const city = validateWeatherCity({ name: value.name, country: value.country, countryCode: value.country_code, admin1: value.admin1 ?? '', latitude: value.latitude, longitude: value.longitude, timezone: value.timezone });
        const key = `${city.latitude},${city.longitude}`;
        if (!seen.has(key)) cities.push(city);
        seen.add(key);
      } catch {}
    }
    return cities;
  }

  async function getCachedWeather(cityValue) {
    const city = validateWeatherCity(cityValue);
    if (!city) throw new Error(t('Выберите город для погоды.'));
    await loadCache();
    const saved = cache.get(`${city.latitude},${city.longitude}`);
    if (!saved) return null;
    const age = Date.now() - saved.fetchedAt;
    if (age < 0 || age > STALE_TTL) return null;
    return copyWeather(saved, age >= CACHE_TTL || saved.time.slice(0, 10) !== cityDate(city));
  }

  async function getWeather(cityValue, { force = false, signal } = {}) {
    checkAbort(signal);
    const city = validateWeatherCity(cityValue);
    if (!city) throw new Error(t('Выберите город для погоды.'));
    if (typeof force !== 'boolean') throw new Error(t('Некорректный режим обновления погоды.'));
    await loadCache();
    checkAbort(signal);
    const key = `${city.latitude},${city.longitude}`;
    const saved = cache.get(key);
    if (!force && saved && !needsForecast.has(key) && Date.now() - saved.fetchedAt < CACHE_TTL && saved.time.slice(0, 10) === cityDate(city)) return copyWeather(saved, false);
    if (!signal && pending.has(key)) return copyWeather(await pending.get(key));
    const operation = (async () => {
      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude), current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', forecast_days: '7', timezone: 'auto', temperature_unit: 'celsius', wind_speed_unit: 'kmh' });
        const weather = parseCurrent(await request(url.href, signal));
        await saveCache(key, weather);
        checkAbort(signal);
        return weather;
      } catch (error) {
        checkAbort(signal);
        const fallback = cache.get(key);
        if (fallback && Date.now() - fallback.fetchedAt <= STALE_TTL) return copyWeather(fallback, true);
        throw error;
      }
    })();
    if (!signal) pending.set(key, operation);
    try {
      return copyWeather(await operation);
    } finally {
      if (!signal && pending.get(key) === operation) pending.delete(key);
    }
  }

  return { searchCities, getCachedWeather, getWeather };
}
