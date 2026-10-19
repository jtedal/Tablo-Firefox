(() => {
  globalThis.tabloSearch?.mount();
  let settled = false;
  let failed = false;
  let loading = false;
  let reloadAvailable = false;
  let loadingTimer;
  let reloadTimer;

  function clearTimers() {
    clearTimeout(loadingTimer);
    clearTimeout(reloadTimer);
  }

  function render() {
    const status = document.getElementById('startup-status');
    const message = document.getElementById('startup-message');
    const reload = document.getElementById('startup-reload');
    const skeleton = document.getElementById('startup-skeleton');
    if (failed && skeleton) skeleton.hidden = true;
    if (!status || !message || !reload) return;
    const visible = !settled && document.documentElement.dataset.ready !== 'true' && loading;
    status.hidden = !visible;
    status.dataset.state = failed ? 'error' : 'loading';
    reload.hidden = !visible || !reloadAvailable;
    message.textContent = globalThis.tabloI18n.t(failed ? 'core.startup.failed' : 'core.startup.loading');
  }

  function begin() {
    clearTimers();
    settled = false;
    failed = false;
    loading = false;
    reloadAvailable = false;
    const skeleton = document.getElementById('startup-skeleton');
    if (skeleton) skeleton.hidden = document.documentElement.dataset.tilesPreview === 'true';
    const layout = document.getElementById('startup-skeleton-layout');
    const mapped = document.getElementById('startup-skeleton-mapped');
    if (layout) layout.hidden = false;
    if (mapped) mapped.hidden = true;
    render();
    loadingTimer = setTimeout(() => {
      loading = true;
      render();
    }, 600);
    reloadTimer = setTimeout(() => {
      reloadAvailable = true;
      render();
    }, 3000);
  }

  function finish() {
    clearTimers();
    settled = true;
    render();
  }

  function fail() {
    if (settled || document.documentElement.dataset.ready === 'true') return;
    clearTimers();
    failed = true;
    loading = true;
    reloadAvailable = true;
    render();
  }

  window.addEventListener('error', event => {
    if (event instanceof ErrorEvent || event.target?.tagName === 'SCRIPT') fail();
  }, true);
  window.addEventListener('unhandledrejection', fail);
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('#startup-reload')) location.reload();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
  globalThis.tabloStartup = { begin, finish };
  globalThis.tabloI18n?.onChange(render);
  begin();
})();
