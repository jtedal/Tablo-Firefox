(() => {
  const key = 'tabloWeatherPreview';
  const t = (key, params) => globalThis.tabloI18n.t(key, params);
  const locale = () => globalThis.tabloI18n?.locale() || 'ru';
  const maxCacheLength = 8192;
  const freshAge = 15 * 60 * 1000;
  const names = ['schemaVersion', 'revision', 'allowed', 'city', 'weather', 'provider', 'layout'];
  const cityNames = ['name', 'country', 'countryCode', 'admin1', 'latitude', 'longitude', 'timezone'];
  const conditions = new Map([
    [0, ['Ясно', 'sun']], [1, ['Преимущественно ясно', 'sun']], [2, ['Переменная облачность', 'cloud-sun']], [3, ['Пасмурно', 'cloud']],
    [45, ['Туман', 'fog']], [48, ['Туман с изморозью', 'fog']],
    [51, ['Небольшая морось', 'rain']], [53, ['Морось', 'rain']], [55, ['Сильная морось', 'rain']], [56, ['Небольшая переохлаждённая морось', 'rain']], [57, ['Сильная переохлаждённая морось', 'rain']],
    [61, ['Небольшой дождь', 'rain']], [63, ['Дождь', 'rain']], [65, ['Сильный дождь', 'rain']], [66, ['Небольшой ледяной дождь', 'rain']], [67, ['Сильный ледяной дождь', 'rain']], [68, ['Небольшой дождь со снегом', 'snow']], [69, ['Дождь со снегом', 'snow']],
    [71, ['Небольшой снег', 'snow']], [73, ['Снег', 'snow']], [75, ['Сильный снег', 'snow']], [77, ['Снежные зёрна', 'snow']],
    [80, ['Небольшой ливень', 'rain']], [81, ['Ливень', 'rain']], [82, ['Сильный ливень', 'rain']], [83, ['Небольшой ливень со снегом', 'snow']], [84, ['Ливень со снегом', 'snow']], [85, ['Небольшой снежный ливень', 'snow']], [86, ['Сильный снежный ливень', 'snow']],
    [95, ['Гроза', 'storm']], [96, ['Гроза с небольшим градом', 'storm']], [97, ['Сильная гроза', 'storm']], [99, ['Гроза с сильным градом', 'storm']]
  ]);
  const paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    cloud: '<path d="M6 19a5 5 0 0 1-1-9 7 7 0 0 1 13-2 5.5 5.5 0 0 1 0 11Z"/>',
    'cloud-sun': '<path d="M7 5V3M3 9H1m3-4L2.5 3.5M11 4l1-2"/><path d="M3 12a4 4 0 1 1 8-4M7 20a4 4 0 0 1-1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9Z"/>',
    fog: '<path d="M5 13a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 3 7M3 17h18M6 21h12"/>',
    rain: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 17l-1 3m6-3-1 3m6-3-1 3"/>',
    snow: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 18v4m-2-2h4m7-2v4m-2-2h4"/>',
    storm: '<path d="M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M12 13l-4 6h5l-2 4 7-8h-5l2-3"/>'
  };
  let current;

  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function city(value) {
    if (value === null) return null;
    if (!plainObject(value) || Object.keys(value).length !== cityNames.length || cityNames.some(name => !Object.hasOwn(value, name))) throw new Error();
    const result = {};
    for (const [name, maximum, optional] of [['name', 120, false], ['country', 120, false], ['countryCode', 2, false], ['admin1', 160, true], ['timezone', 100, false]]) {
      if (typeof value[name] !== 'string' || (!optional && !value[name].trim()) || value[name].trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value[name])) throw new Error();
      result[name] = value[name].trim();
    }
    if (!/^[A-Z]{2}$/.test(result.countryCode)) throw new Error();
    for (const [name, limit] of [['latitude', 90], ['longitude', 180]]) {
      if (!Number.isFinite(value[name]) || Math.abs(value[name]) > limit) throw new Error();
      result[name] = value[name];
    }
    new Intl.DateTimeFormat('ru', { timeZone: result.timezone });
    return result;
  }

  function validTime(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) return false;
    const [, year, month, day, hour, minute, second = '00'] = match;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  function weather(value, selected) {
    if (value === null) return null;
    if (!plainObject(value) || !Number.isFinite(value.temperature) || !(value.apparentTemperature === null || Number.isFinite(value.apparentTemperature)) || !conditions.has(value.code) || typeof value.isDay !== 'boolean' || !Number.isFinite(value.windSpeed) || value.windSpeed < 0 || !validTime(value.time) || !Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > Date.now()) throw new Error();
    const daily = [];
    if (Array.isArray(value.daily) && value.daily.length <= 7) {
      for (const day of value.daily) {
        if (!plainObject(day) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !validTime(`${day.date}T12:00`) || !conditions.has(day.code) || !Number.isFinite(day.temperatureMax) || !Number.isFinite(day.temperatureMin) || day.temperatureMin > day.temperatureMax || !(day.precipitationProbability === null || Number.isFinite(day.precipitationProbability) && day.precipitationProbability >= 0 && day.precipitationProbability <= 100) || daily.length && Date.parse(`${day.date}T00:00Z`) - Date.parse(`${daily.at(-1).date}T00:00Z`) !== 86400000) { daily.length = 0; break; }
        daily.push({ date: day.date, code: day.code, temperatureMax: day.temperatureMax, temperatureMin: day.temperatureMin, precipitationProbability: day.precipitationProbability });
      }
    }
    if (daily.length && selected) {
      const expected = globalThis.tabloForecast.dateInCity(selected, new Date(value.fetchedAt));
      if (Math.abs(Date.parse(`${daily[0].date}T12:00Z`) - Date.parse(`${expected}T12:00Z`)) > 86400000) daily.length = 0;
    }
    return { temperature: value.temperature, apparentTemperature: value.apparentTemperature, code: value.code, isDay: value.isDay, windSpeed: value.windSpeed, time: value.time, fetchedAt: value.fetchedAt, stale: false, daily, ...(value.forecastBasis === 'samples' ? { forecastBasis: 'samples' } : {}) };
  }

  function parseCache(raw) {
    if (typeof raw !== 'string' || raw.length > maxCacheLength) return null;
    try {
      const value = JSON.parse(raw);
      if (!plainObject(value) || ![1, 2].includes(value.schemaVersion) || Object.keys(value).some(name => !names.includes(name)) || names.slice(0, 5).some(name => !Object.hasOwn(value, name)) || !Number.isSafeInteger(value.revision) || value.revision < 0 || ![true, false, null].includes(value.allowed)) return null;
      const provider = value.provider ?? 'open-meteo';
      const layout = value.layout ?? 'week';
      if (!['open-meteo', 'metno'].includes(provider) || !['compact', 'week'].includes(layout)) return null;
      const selected = city(value.city);
      const saved = weather(value.weather, selected);
      return { schemaVersion: 2, revision: value.revision, allowed: value.allowed, city: selected, weather: value.allowed !== false && selected ? saved : null, provider, layout };
    } catch {
      return null;
    }
  }

  function readCache() {
    try { return parseCache(localStorage.getItem(key)); }
    catch { return null; }
  }

  function sameCity(first, second) {
    return !!first && !!second && first.latitude === second.latitude && first.longitude === second.longitude;
  }

  function get(selected, provider = 'open-meteo') {
    try {
      const checked = city(selected);
      if (!current || current.provider !== provider || current.allowed === false || !sameCity(current.city, checked) || !current.weather || current.weather.fetchedAt > Date.now()) return null;
      return { ...current.weather, daily: current.weather.daily.map(day => ({ ...day })), stale: Date.now() - current.weather.fetchedAt >= freshAge };
    } catch {
      return null;
    }
  }

  function apply(settings, revision, allowed, data = null) {
    try {
      if (!plainObject(settings) || !Number.isSafeInteger(revision) || revision < 0 || ![true, false, null].includes(allowed)) return false;
      const selected = city(settings.weatherCity);
      const provider = settings.weatherProvider || 'open-meteo';
      const layout = settings.weatherLayout || 'week';
      if (!['open-meteo', 'metno'].includes(provider) || !['compact', 'week'].includes(layout)) return false;
      const incoming = weather(data, selected);
      const stored = readCache();
      if ((stored && stored.revision > revision) || (current && current.revision > revision)) return false;
      const previous = stored && (!current || stored.revision > current.revision) ? stored : current;
      const permission = allowed === null ? previous?.provider === provider ? previous.allowed : null : allowed;
      let saved = incoming;
      for (const candidate of [current, stored]) {
        if (candidate?.provider === provider && sameCity(candidate?.city, selected) && candidate.weather && (!saved || candidate.weather.fetchedAt > saved.fetchedAt)) saved = candidate.weather;
      }
      current = { schemaVersion: 2, revision, allowed: permission, city: selected, weather: permission !== false && selected ? saved : null, provider, layout };
      const serialized = JSON.stringify(current);
      if (serialized.length > maxCacheLength) return false;
      try {
        if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
      } catch {}
      return true;
    } catch {
      return false;
    }
  }

  function temperature(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? '+' : ''}${rounded}°`;
  }

  function weatherIcon(name) {
    const span = document.createElement('span');
    span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
    return span;
  }

  function applyLayout(saved) {
    const root = document.documentElement;
    const expected = Number(root.dataset.settingsRevision);
    const outdated = Number.isSafeInteger(expected) && expected >= 0 && saved && saved.revision < expected;
    const layout = (!outdated && saved?.layout) || root.dataset.weatherLayout || 'week';
    if (!outdated && saved) globalThis.tabloSearch?.setWeatherLayout(layout, saved.revision);
    root.dataset.weatherLayout = layout;
    root.dataset.clockRow = String(root.dataset.showClock !== 'false' || root.dataset.showWeather !== 'false' && layout === 'compact');
    return layout;
  }

  function mount() {
    const button = document.getElementById('weather-button');
    const symbol = document.getElementById('weather-symbol');
    const degrees = document.getElementById('weather-temperature');
    const location = document.getElementById('weather-city');
    const summary = document.getElementById('weather-summary');
    const weekCity = document.getElementById('weather-week-city');
    if (!button || !symbol || !degrees || !location || !summary || !weekCity || !document.getElementById('weather-week-open')) return false;
    const expected = Number(document.documentElement.dataset.settingsRevision);
    const outdated = Number.isSafeInteger(expected) && expected >= 0 && current && current.revision < expected;
    const saved = outdated ? null : current;
    const selected = saved?.city;
    const layout = applyLayout(saved);
    weekCity.textContent = selected?.name || t(saved ? 'core.weather.city' : 'core.weather.title');
    weekCity.title = weekCity.textContent;
    button.hidden = document.documentElement.dataset.showWeather === 'false' || layout === 'week';
    const data = selected ? get(selected, saved.provider) : null;
    const [label, baseIcon] = data ? conditions.get(data.code) : ['', 'cloud-sun'];
    const icon = data && !data.isDay && baseIcon === 'sun' ? 'moon' : data && !data.isDay && baseIcon === 'cloud-sun' ? 'cloud' : baseIcon;
    symbol.replaceChildren(weatherIcon(icon));
    degrees.textContent = data ? temperature(data.temperature) : '';
    if (selected) location.textContent = selected.name;
    else if (outdated) location.textContent = t('core.weather.title');
    else location.textContent = t('core.weather.city');
    summary.textContent = saved?.allowed === false ? t('core.weather.enable') : saved && !selected ? t('core.weather.chooseCity') : data ? data.stale ? t('core.weather.stale') : t(label) : t('core.weather.loading');
    button.dataset.status = saved?.allowed === false ? 'permission' : saved && !selected ? 'empty' : data ? 'cached' : 'loading';
    const timestamp = data ? t('core.weather.saved', { time: new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(data.fetchedAt)) }) : '';
    button.title = data ? t('core.weather.tooltip', { city: selected.name, condition: t(label), temperature: temperature(data.temperature), saved: timestamp }) : t('core.weather.selectTitle', { city: location.textContent });
    button.setAttribute('aria-label', t('core.weather.aria', { city: location.textContent, temperature: degrees.textContent, summary: summary.textContent, saved: timestamp }));
    const week = document.getElementById('weather-week');
    const days = document.getElementById('weather-week-days');
    if (week && days) {
      week.hidden = document.documentElement.dataset.showWeather === 'false' || layout === 'compact';
      globalThis.tabloForecast.render(days, data, selected, (code, isDay) => {
        const [label, icon] = conditions.get(code);
        return { label: t(label), icon: !isDay && icon === 'sun' ? 'moon' : icon };
      }, weatherIcon);
    }
    return true;
  }

  current = readCache();
  applyLayout(current);
  globalThis.tabloWeatherPreview = Object.freeze({ get, apply });
  globalThis.tabloI18n?.onChange(mount);
  if (!mount() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!mount()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
