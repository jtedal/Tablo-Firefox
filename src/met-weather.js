import { validateWeatherCity } from './model.js';
import { t } from './localize.js';

const CACHE_KEY = 'tabloMetWeatherCache';
const CACHE_TTL = 15 * 60 * 1000;
const STALE_TTL = 6 * 60 * 60 * 1000;
const CACHE_RETENTION = 10 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 8000;
const USER_AGENT = 'Tablo-Firefox/0.5.0 (https://addons.mozilla.org/addon/3101048/; Tablo - favorite sites)';
const SYMBOL_CODES = new Map(Object.entries({
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightsleet: 68, sleet: 69, heavysleet: 69,
  lightsleetshowers: 83, sleetshowers: 84, heavysleetshowers: 84,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 86, heavysnowshowers: 86,
  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 97,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 97,
  lightsleetandthunder: 95, sleetandthunder: 95, heavysleetandthunder: 97,
  lightssleetshowersandthunder: 95, sleetshowersandthunder: 95, heavysleetshowersandthunder: 97,
  lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 97,
  lightssnowshowersandthunder: 95, snowshowersandthunder: 95, heavysnowshowersandthunder: 97
}));
const WEATHER_CODES = new Set(SYMBOL_CODES.values());

function abortError() {
  return new DOMException(t('Запрос отменён.'), 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validLocalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value;
}

function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19) ? timestamp : NaN;
}

function localTime(timestamp, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function symbol(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const match = /^([a-z]+)(?:_(day|night|polartwilight))?$/.exec(value);
  if (!match || !SYMBOL_CODES.has(match[1])) return null;
  return { code: SYMBOL_CODES.get(match[1]), isDay: match[2] !== 'night' && match[2] !== 'polartwilight' };
}

function validateDaily(value) {
  if (!Array.isArray(value) || value.length > 7) return [];
  const result = [];
  for (const day of value) {
    if (!plainObject(day) || !validLocalTime(`${day.date}T00:00`) || !WEATHER_CODES.has(day.code) || !Number.isFinite(day.temperatureMin) || !Number.isFinite(day.temperatureMax) || day.temperatureMin > day.temperatureMax || day.precipitationProbability !== null) return [];
    if (result.length && Date.parse(`${day.date}T00:00:00Z`) - Date.parse(`${result.at(-1).date}T00:00:00Z`) !== 86400000) return [];
    result.push({ date: day.date, code: day.code, temperatureMin: day.temperatureMin, temperatureMax: day.temperatureMax, precipitationProbability: null });
  }
  return result;
}

function validateWeather(value, now) {
  if (!plainObject(value) || !Number.isFinite(value.temperature) || value.apparentTemperature !== null || !WEATHER_CODES.has(value.code) || typeof value.isDay !== 'boolean' || !Number.isFinite(value.windSpeed) || value.windSpeed < 0 || !validLocalTime(value.time) || !Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > now || value.forecastBasis !== 'samples') throw new Error(t('MET Norway вернул некорректные данные.'));
  return {
    temperature: value.temperature,
    apparentTemperature: null,
    code: value.code,
    isDay: value.isDay,
    windSpeed: value.windSpeed,
    time: value.time,
    fetchedAt: value.fetchedAt,
    stale: false,
    daily: validateDaily(value.daily),
    forecastBasis: 'samples'
  };
}

function copyWeather(weather, stale = weather.stale) {
  return { ...weather, daily: weather.daily.map(day => ({ ...day })), stale };
}

function cityKey(city) {
  const coordinate = value => String(Math.trunc(value * 10000) / 10000);
  return `${coordinate(city.latitude)},${coordinate(city.longitude)}@${city.timezone}`;
}

function parseSamples(payload) {
  const properties = payload?.properties;
  const units = properties?.meta?.units;
  if (!plainObject(payload) || !plainObject(properties) || !plainObject(units) || units.air_temperature !== 'celsius' || units.wind_speed !== 'm/s' || !Array.isArray(properties.timeseries) || !properties.timeseries.length || properties.timeseries.length > 1000) throw new Error(t('MET Norway вернул некорректные данные.'));
  const points = [];
  const seen = new Set();
  for (const value of properties.timeseries) {
    const timestamp = utcTimestamp(value?.time);
    const details = value?.data?.instant?.details;
    if (!Number.isFinite(timestamp) || seen.has(timestamp) || !plainObject(details) || !Number.isFinite(details.air_temperature)) continue;
    seen.add(timestamp);
    let condition = null;
    for (const period of ['next_1_hours', 'next_6_hours', 'next_12_hours']) {
      condition = symbol(value?.data?.[period]?.summary?.symbol_code);
      if (condition) break;
    }
    points.push({ timestamp, temperature: details.air_temperature, windSpeed: Number.isFinite(details.wind_speed) && details.wind_speed >= 0 ? details.wind_speed : null, code: condition?.code ?? null, isDay: condition?.isDay ?? null });
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

function validateSamples(value) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error(t('MET Norway вернул некорректные данные.'));
  const points = [];
  for (const point of value) {
    if (!plainObject(point) || !Number.isFinite(point.timestamp) || !Number.isFinite(new Date(point.timestamp).valueOf()) || !Number.isFinite(point.temperature) || !(point.windSpeed === null || Number.isFinite(point.windSpeed) && point.windSpeed >= 0) || !(point.code === null && point.isDay === null || WEATHER_CODES.has(point.code) && typeof point.isDay === 'boolean') || points.length && point.timestamp <= points.at(-1).timestamp) throw new Error(t('MET Norway вернул некорректные данные.'));
    points.push({ timestamp: point.timestamp, temperature: point.temperature, windSpeed: point.windSpeed, code: point.code, isDay: point.isDay });
  }
  return points;
}

function weatherFromSamples(samples, city, now, fetchedAt = now) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const points = samples.map(point => ({ ...point, time: localTime(point.timestamp, formatter), condition: point.code === null ? null : { code: point.code, isDay: point.isDay } }));
  const current = points.filter(point => point.condition && Number.isFinite(point.windSpeed) && point.windSpeed >= 0 && Math.abs(point.timestamp - now) <= STALE_TTL).sort((a, b) => Math.abs(a.timestamp - now) - Math.abs(b.timestamp - now) || a.timestamp - b.timestamp)[0];
  if (!current) throw new Error(t('MET Norway не вернул актуальный прогноз.'));
  const groups = new Map();
  for (const point of points) {
    const date = point.time.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(point);
  }
  const daily = [];
  const firstDay = localTime(now, formatter).slice(0, 10);
  const firstTimestamp = Date.parse(`${firstDay}T00:00:00Z`);
  for (let index = 0; index < 7; index++) {
    const date = new Date(firstTimestamp + index * 86400000).toISOString().slice(0, 10);
    const samples = groups.get(date);
    const representative = samples?.filter(point => point.condition).sort((a, b) => Math.abs(Number(a.time.slice(11, 13)) * 60 + Number(a.time.slice(14, 16)) - 720) - Math.abs(Number(b.time.slice(11, 13)) * 60 + Number(b.time.slice(14, 16)) - 720))[0];
    if (!representative) break;
    daily.push({ date, code: representative.condition.code, temperatureMin: Math.min(...samples.map(point => point.temperature)), temperatureMax: Math.max(...samples.map(point => point.temperature)), precipitationProbability: null });
  }
  return validateWeather({ temperature: current.temperature, apparentTemperature: null, code: current.condition.code, isDay: current.condition.isDay, windSpeed: current.windSpeed * 3.6, time: current.time, fetchedAt, daily, forecastBasis: 'samples' }, now);
}

function header(response, name) {
  const value = response.headers?.get?.(name);
  return typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function retryTime(response, now) {
  const value = response.headers?.get?.('Retry-After');
  if (typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value)) {
    if (/^\d+$/.test(value.trim())) {
      const timestamp = now + Number(value.trim()) * 1000;
      if (Number.isFinite(timestamp)) return timestamp;
    }
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value.trim()) return Math.max(now, timestamp);
  }
  return now + CACHE_TTL;
}

export function createMetWeatherService({ fetchImpl = globalThis.fetch, storage = globalThis.browser?.storage?.local } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheLoaded;
  let writeQueue = Promise.resolve();
  let retryAt = 0;

  function retained(entry, now) {
    return now >= entry.weather.fetchedAt && (now < entry.expiresAt || now - entry.weather.fetchedAt <= CACHE_RETENTION);
  }

  function usable(entry, now) {
    return now >= entry.weather.fetchedAt && (now < entry.expiresAt || now - entry.weather.fetchedAt <= STALE_TTL);
  }

  async function loadCache() {
    if (!cacheLoaded) cacheLoaded = (async () => {
      if (!storage?.get) return;
      try {
        const raw = (await storage.get(CACHE_KEY))?.[CACHE_KEY];
        if (!plainObject(raw)) return;
        if (Number.isFinite(raw._retryAfter) && raw._retryAfter > 0) retryAt = raw._retryAfter;
        const now = Date.now();
        for (const [key, value] of Object.entries(raw).filter(([key]) => key !== '_retryAfter').slice(0, 24)) {
          if (!/^-?\d+(?:\.\d{1,4})?,-?\d+(?:\.\d{1,4})?@[^\u0000-\u001f\u007f]{1,100}$/.test(key) || !plainObject(value) || !Number.isFinite(value.expiresAt) || value.expiresAt < 0 || !(value.lastModified === null || typeof value.lastModified === 'string' && value.lastModified.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value.lastModified) && Number.isFinite(Date.parse(value.lastModified)))) continue;
          try {
            const entry = { weather: validateWeather(value.weather, now), samples: validateSamples(value.samples), expiresAt: value.expiresAt, lastModified: value.lastModified };
            entry.weather = weatherFromSamples(entry.samples, { timezone: key.slice(key.indexOf('@') + 1) }, entry.weather.fetchedAt);
            if (retained(entry, now)) cache.set(key, entry);
          } catch {}
        }
      } catch {}
    })();
    return cacheLoaded;
  }

  async function persistCache() {
    const now = Date.now();
    for (const [savedKey, value] of cache) if (!retained(value, now)) cache.delete(savedKey);
    while (cache.size > 24) cache.delete(cache.keys().next().value);
    if (!storage?.set) return;
    writeQueue = writeQueue.catch(() => {}).then(() => storage.set({ [CACHE_KEY]: { ...Object.fromEntries(cache), ...(retryAt > 0 ? { _retryAfter: retryAt } : {}) } }));
    try { await writeQueue; } catch {}
  }

  async function saveCache(key, entry) {
    cache.set(key, entry);
    await persistCache();
  }

  async function request(city, saved, signal) {
    checkAbort(signal);
    if (typeof fetchImpl !== 'function') throw new Error(t('Сетевые запросы недоступны.'));
    const controller = new AbortController();
    let timeoutError;
    const onAbort = () => controller.abort(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timeoutError = new Error(t('MET Norway не ответил за 8 секунд.'));
      timeoutError.name = 'TimeoutError';
      controller.abort(timeoutError);
    }, REQUEST_TIMEOUT);
    try {
      const coordinates = cityKey(city).split('@')[0].split(',');
      const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
      url.search = new URLSearchParams({ lat: coordinates[0], lon: coordinates[1] });
      const headers = { 'User-Agent': USER_AGENT };
      if (saved?.lastModified) headers['If-Modified-Since'] = saved.lastModified;
      const response = await fetchImpl(url.href, { headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store' });
      checkAbort(signal);
      const now = Date.now();
      const expires = header(response, 'Expires');
      const expiresAt = expires === null ? now + CACHE_TTL : Date.parse(expires);
      const lastModified = header(response, 'Last-Modified') || saved?.lastModified || null;
      if (response.status === 304) {
        if (!saved) throw new Error(t('MET Norway вернул пустой прогноз без кэша.'));
        return { weather: weatherFromSamples(saved.samples, city, now), samples: saved.samples, expiresAt, lastModified };
      }
      if (response.status === 429) {
        retryAt = Math.max(retryAt, retryTime(response, now));
        await persistCache();
      }
      if (!response.ok) throw new Error(t('MET Norway недоступен (HTTP {status}).', { status: response.status }));
      const payload = await response.json();
      checkAbort(signal);
      const samples = parseSamples(payload);
      return { weather: weatherFromSamples(samples, city, now), samples, expiresAt, lastModified: header(response, 'Last-Modified') };
    } catch (error) {
      checkAbort(signal);
      if (timeoutError) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function getCachedWeather(cityValue) {
    const city = validateWeatherCity(cityValue);
    if (!city) throw new Error(t('Выберите город для погоды.'));
    await loadCache();
    const saved = cache.get(cityKey(city));
    const now = Date.now();
    if (!saved || !usable(saved, now)) return null;
    try { return copyWeather(weatherFromSamples(saved.samples, city, now, saved.weather.fetchedAt), now >= saved.expiresAt); }
    catch { return null; }
  }

  async function getWeather(cityValue, { force = false, signal } = {}) {
    checkAbort(signal);
    const city = validateWeatherCity(cityValue);
    if (!city) throw new Error(t('Выберите город для погоды.'));
    if (typeof force !== 'boolean') throw new Error(t('Некорректный режим обновления погоды.'));
    await loadCache();
    checkAbort(signal);
    const key = cityKey(city);
    let saved = cache.get(key);
    if (saved && retained(saved, Date.now()) && Date.now() < saved.expiresAt) {
      try { return copyWeather(weatherFromSamples(saved.samples, city, Date.now(), saved.weather.fetchedAt), false); }
      catch {
        cache.delete(key);
        saved = undefined;
      }
    }
    if (Date.now() < retryAt) {
      if (saved && usable(saved, Date.now())) {
        try { return copyWeather(weatherFromSamples(saved.samples, city, Date.now(), saved.weather.fetchedAt), true); }
        catch {}
      }
      throw new Error(t('MET Norway временно ограничил запросы. Повторите попытку позже.'));
    }
    if (!signal && pending.has(key)) return copyWeather(await pending.get(key));
    const operation = (async () => {
      try {
        const entry = await request(city, saved, signal);
        if (retryAt <= Date.now()) retryAt = 0;
        await saveCache(key, entry);
        checkAbort(signal);
        return entry.weather;
      } catch (error) {
        checkAbort(signal);
        const fallback = cache.get(key);
        if (fallback && usable(fallback, Date.now())) {
          try { return copyWeather(weatherFromSamples(fallback.samples, city, Date.now(), fallback.weather.fetchedAt), true); }
          catch {}
        }
        throw error;
      }
    })();
    if (!signal) pending.set(key, operation);
    try { return copyWeather(await operation); }
    finally { if (!signal && pending.get(key) === operation) pending.delete(key); }
  }

  return { getCachedWeather, getWeather };
}
