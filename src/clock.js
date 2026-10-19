(() => {
  let timeFormat;
  let dateFormat;
  let timer;

  function resetFormatters() {
    const locale = globalThis.tabloI18n?.locale() || 'ru';
    timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dateFormat = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function update() {
    clearTimeout(timer);
    timer = null;
    const clock = document.getElementById('clock');
    const date = document.getElementById('date');
    if (!clock || !date) return false;
    const now = new Date();
    clock.textContent = timeFormat.format(now);
    clock.dateTime = now.toISOString();
    const label = dateFormat.format(now);
    date.textContent = label.charAt(0).toLocaleUpperCase(globalThis.tabloI18n?.locale() || 'ru') + label.slice(1);
    if (!document.hidden) timer = setTimeout(update, 60000 - now.getTime() % 60000 + 20);
    return true;
  }

  resetFormatters();
  globalThis.tabloClock = Object.freeze({ update });
  globalThis.tabloI18n?.onChange(() => { resetFormatters(); update(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetFormatters();
    update();
  });
  if (!update() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('clock') || !document.getElementById('date')) return;
      update();
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
