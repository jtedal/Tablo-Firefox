(() => {
  const renderers = new WeakMap();
  const t = (key, params) => globalThis.tabloI18n.t(key, params);
  const locale = () => globalThis.tabloI18n?.locale() || 'ru';
  const degrees = value => `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}°`;

  function dateInCity(city, now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(name => parts.find(part => part.type === name).value).join('-');
  }

  function render(node, data, city, describe, icon) {
    const today = city ? dateInCity(city) : '';
    const lastDay = today ? new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10) : '';
    const daily = (data?.daily || []).filter(day => day.date >= today && day.date <= lastDay).slice(0, 7);
    const signature = JSON.stringify([locale(), today, daily, !!data, city?.name]);
    const previous = renderers.get(node);
    if (previous === signature) return daily.length;
    renderers.set(node, signature);
    if (!daily.length) {
      const text = document.createElement('p');
      text.className = 'weather-forecast-empty';
      text.textContent = t(data ? 'core.forecast.unavailable' : 'core.forecast.loading');
      node.replaceChildren(text);
      return 0;
    }
    const list = document.createElement('ol');
    list.className = 'weather-forecast-list';
    for (const day of daily) {
      const item = document.createElement('li');
      item.className = 'weather-forecast-day';
      item.classList.toggle('is-today', day.date === today);
      const date = new Date(`${day.date}T12:00:00Z`);
      const condition = describe(day.code, true);
      const weekday = document.createElement('time');
      weekday.dateTime = day.date;
      weekday.className = 'forecast-weekday';
      weekday.textContent = day.date === today ? t('core.forecast.today') : new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(date);
      const calendar = document.createElement('span');
      calendar.className = 'forecast-date';
      calendar.textContent = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
      const symbol = icon(condition.icon);
      symbol.classList.add('forecast-symbol');
      const high = document.createElement('strong');
      high.className = 'forecast-high';
      high.textContent = degrees(day.temperatureMax);
      high.setAttribute('aria-label', t(data.forecastBasis === 'samples' ? 'core.forecast.sampleHigh' : 'core.forecast.high', { temperature: degrees(day.temperatureMax) }));
      const low = document.createElement('span');
      low.className = 'forecast-low';
      low.textContent = degrees(day.temperatureMin);
      low.setAttribute('aria-label', t(data.forecastBasis === 'samples' ? 'core.forecast.sampleLow' : 'core.forecast.low', { temperature: degrees(day.temperatureMin) }));
      const precipitation = document.createElement('span');
      precipitation.className = 'forecast-precipitation';
      precipitation.textContent = day.precipitationProbability === null ? '—' : `${Math.round(day.precipitationProbability)}%`;
      precipitation.setAttribute('aria-label', t(day.precipitationProbability === null ? 'core.forecast.noPrecipitation' : 'core.forecast.precipitation', { chance: Math.round(day.precipitationProbability) }));
      item.title = t('core.forecast.tooltip', { date: new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeZone: 'UTC' }).format(date), condition: condition.label, low: degrees(day.temperatureMin), high: degrees(day.temperatureMax), precipitation: day.precipitationProbability === null ? '' : t('core.forecast.tooltipPrecipitation', { chance: Math.round(day.precipitationProbability) }) });
      item.append(weekday, calendar, symbol, high, low, precipitation);
      list.append(item);
    }
    node.replaceChildren(list);
    if (previous && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) list.animate?.([{ opacity: .65 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    return daily.length;
  }

  globalThis.tabloForecast = Object.freeze({ render, dateInCity });
})();
