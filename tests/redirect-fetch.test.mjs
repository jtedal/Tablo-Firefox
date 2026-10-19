import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRedirects, RedirectAccessError, RedirectError } from '../src/redirect-fetch.js';

const DOCUMENT_URL = 'moz-extension://tablo-test/newtab.html';

function fixture({ allowed = ['https://example.com/*'], routes = {}, tab = { id: 9 } } = {}) {
  const listeners = new Set();
  const calls = [];
  const checks = [];
  const filters = [];
  const browserApi = {
    permissions: { async contains(value) { checks.push(value); return value.origins.every(origin => allowed.includes(origin)); } },
    runtime: { getURL: value => `moz-extension://tablo-test/${value}` },
    tabs: { getCurrent: async () => tab },
    webRequest: { onHeadersReceived: {
      addListener(listener, filter, extra) { listeners.add(listener); filters.push({ filter, extra }); },
      removeListener(listener) { listeners.delete(listener); }
    } }
  };
  const emit = details => {
    for (const listener of listeners) listener({ url: calls.at(-1)?.url, requestId: String(calls.length), type: 'xmlhttprequest', tabId: 9, originUrl: DOCUMENT_URL, documentUrl: DOCUMENT_URL, ...details });
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url];
    return typeof route === 'function' ? route({ url, options, emit }) : route || new Response('final');
  };
  return { calls, checks, filters, listeners, allowed, browserApi, emit, options: { browserApi, fetchImpl, documentUrl: DOCUMENT_URL } };
}

const redirect = (location, status = 302) => new Response('redirect', { status, headers: location === null ? {} : { location } });
const opaque = () => ({ type: 'opaqueredirect', status: 0, headers: new Headers(), body: null });

test('конечный ответ сохраняется, адрес нормализуется и fragment не уходит в сеть', async () => {
  const response = new Response('hello');
  const sample = fixture({ routes: { 'https://example.com/path?q=1': response } });
  const result = await fetchWithRedirects('https://EXAMPLE.com:443/path?q=1#section', sample.options);
  assert.deepEqual(result, { response, url: 'https://example.com/path?q=1', redirects: 0 });
  assert.equal(await result.response.text(), 'hello');
  assert.deepEqual(sample.checks, [{ origins: ['https://example.com/*'], data_collection: ['browsingActivity'] }]);
  assert.deepEqual(sample.calls[0].options, { signal: undefined, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', cache: 'no-store' });
  assert.equal(sample.listeners.size, 0);
});

test('относительные Location и все поддерживаемые HTTP статусы проходят последовательные проверки', async () => {
  const routes = {};
  const statuses = [301, 302, 303, 307, 308];
  statuses.forEach((status, index) => { routes[`https://example.com/${index}`] = redirect(`/${index + 1}`, status); });
  const sample = fixture({ routes });
  const result = await fetchWithRedirects('https://example.com/0', sample.options);
  assert.equal(result.url, 'https://example.com/5');
  assert.equal(result.redirects, 5);
  assert.equal(sample.calls.length, 6);
  assert.equal(sample.checks.length, 6);
  assert.equal(sample.listeners.size, 0);
});

test('другой домен не запрашивается до разрешения, повтор после разрешения завершает цепочку', async () => {
  const sample = fixture({ routes: { 'https://example.com/': () => redirect('https://target.test/docs/page') } });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), error => {
    assert.ok(error instanceof RedirectAccessError);
    assert.deepEqual(error.requiredOrigins, ['https://target.test/*']);
    assert.equal(error.targetUrl, 'https://target.test/docs/page');
    return true;
  });
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/']);
  sample.allowed.push('https://target.test/*');
  const result = await fetchWithRedirects('example.com', sample.options);
  assert.equal(result.url, 'https://target.test/docs/page');
  assert.equal(result.redirects, 1);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/', 'https://target.test/docs/page']);
  assert.equal(sample.listeners.size, 0);
});

test('отсутствие исходного разрешения не запускает fetch и наблюдатель', async () => {
  const sample = fixture({ allowed: [] });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), RedirectAccessError);
  assert.equal(sample.calls.length, 0);
  assert.equal(sample.filters.length, 0);
});

test('разрешения перепроверяются перед каждым переходом, включая тот же origin', async () => {
  const sample = fixture({ routes: { 'https://example.com/': () => { sample.allowed.length = 0; return redirect('/next'); } } });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), error => error instanceof RedirectAccessError && error.targetUrl === 'https://example.com/next');
  assert.equal(sample.calls.length, 1);
  assert.equal(sample.checks.length, 2);
});

test('opaque redirect использует заголовки только собственного запроса', async () => {
  const sample = fixture({ routes: { 'https://example.com/': ({ emit }) => {
    emit({ url: 'https://example.com/other', requestId: 'foreign-url', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-url' }] });
    emit({ tabId: 88, requestId: 'foreign-tab', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-tab' }] });
    emit({ originUrl: 'https://example.com/', requestId: 'foreign-origin', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-origin' }] });
    emit({ documentUrl: 'moz-extension://other/newtab.html', requestId: 'foreign-document', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-document' }] });
    emit({ type: 'image', requestId: 'foreign-type', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-type' }] });
    emit({ requestId: 'own', statusCode: 301, responseHeaders: [{ name: 'lOcAtIoN', value: '/correct' }] });
    emit({ requestId: 'another', statusCode: 301, responseHeaders: [{ name: 'Location', value: '/wrong-id' }] });
    return opaque();
  } } });
  const result = await fetchWithRedirects('example.com', sample.options);
  assert.equal(result.url, 'https://example.com/correct');
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/correct']);
  assert.deepEqual(sample.filters[0], { filter: { urls: ['https://example.com/*'], types: ['xmlhttprequest'], tabId: 9 }, extra: ['responseHeaders'] });
  assert.equal(sample.listeners.size, 0);
});

test('opaque redirect без доступного наблюдателя возвращает понятную ошибку платформы', async () => {
  const sample = fixture({ routes: { 'https://example.com/': opaque } });
  delete sample.browserApi.webRequest;
  await assert.rejects(fetchWithRedirects('example.com', sample.options), error => error instanceof RedirectError && error.name === 'RedirectError' && /Firefox не предоставил заголовки/.test(error.message));
  assert.equal(sample.calls.length, 1);
});

test('заголовки opaque redirect могут прийти событием после разрешения fetch Promise', async () => {
  const sample = fixture({ routes: { 'https://example.com/': ({ emit }) => {
    setTimeout(() => emit({ statusCode: 302, responseHeaders: [{ name: 'Location', value: '/delayed' }] }), 10);
    return opaque();
  } } });
  const result = await fetchWithRedirects('example.com', sample.options);
  assert.equal(result.url, 'https://example.com/delayed');
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/delayed']);
  assert.equal(sample.listeners.size, 0);
});

test('отмена ожидания заголовков немедленно отклоняет запрос и удаляет наблюдатель', async () => {
  const controller = new AbortController();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const sample = fixture({ routes: { 'https://example.com/': () => { entered(); return opaque(); } } });
  const pending = fetchWithRedirects('example.com', { ...sample.options, signal: controller.signal });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sample.listeners.size, 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(sample.listeners.size, 0);
  await fetchWithRedirects('https://example.com/after', sample.options);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/after']);
});

test('undefined из tabs.getCurrent не ломает обычный ответ, но не включает наблюдение чужих вкладок', async () => {
  const sample = fixture({ tab: undefined });
  sample.browserApi.tabs.getCurrent = async () => undefined;
  const result = await fetchWithRedirects('example.com', sample.options);
  assert.equal(result.redirects, 0);
  assert.equal(sample.filters.length, 0);
});

test('fragment собственного документа исключается из проверки заголовков', async () => {
  const sample = fixture({ routes: { 'https://example.com/': ({ emit }) => { emit({ statusCode: 302, responseHeaders: [{ name: 'Location', value: '/next' }] }); return opaque(); } } });
  const result = await fetchWithRedirects('example.com', { ...sample.options, documentUrl: `${DOCUMENT_URL}#settings` });
  assert.equal(result.url, 'https://example.com/next');
});

test('наблюдатель не регистрируется для документа другого расширения', async () => {
  const sample = fixture({ routes: { 'https://example.com/': opaque } });
  await assert.rejects(fetchWithRedirects('example.com', { ...sample.options, documentUrl: 'moz-extension://other/newtab.html' }), /Firefox не предоставил заголовки/);
  assert.equal(sample.filters.length, 0);
});

test('цикл завершается до повторного запроса, тело redirect освобождается', async () => {
  const response = redirect('/#again');
  const sample = fixture({ routes: { 'https://example.com/': response } });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), error => error instanceof RedirectError && /зациклил/.test(error.message));
  assert.equal(sample.calls.length, 1);
  assert.equal(response.bodyUsed, true);
  assert.equal(sample.listeners.size, 0);
});

test('лимит ограничивает число переходов и освобождает последнее тело', async () => {
  const first = redirect('/1');
  const second = redirect('/2');
  const sample = fixture({ routes: { 'https://example.com/': first, 'https://example.com/1': second } });
  await assert.rejects(fetchWithRedirects('example.com', { ...sample.options, maxRedirects: 1 }), /лимит перенаправлений: 1/);
  assert.equal(sample.calls.length, 2);
  assert.equal(first.bodyUsed, true);
  assert.equal(second.bodyUsed, true);
  assert.equal(sample.listeners.size, 0);
});

test('нулевой лимит разрешает конечный ответ и запрещает первый переход', async () => {
  const sample = fixture();
  assert.equal((await fetchWithRedirects('example.com', { ...sample.options, maxRedirects: 0 })).redirects, 0);
  sample.options.fetchImpl = async () => redirect('/next');
  await assert.rejects(fetchWithRedirects('example.com', { ...sample.options, maxRedirects: 0 }), /лимит перенаправлений: 0/);
});

test('опасные назначения отклоняются и никогда не запрашиваются', async () => {
  for (const location of ['javascript:alert(1)', 'data:text/plain,hello', 'file:///tmp/a', 'https://u:p@example.com/', 'https://other.test/a b', '//other.test\\evil']) {
    const response = redirect(location);
    const sample = fixture({ routes: { 'https://example.com/': response } });
    await assert.rejects(fetchWithRedirects('example.com', sample.options), /недопустимый адрес/);
    assert.equal(sample.calls.length, 1);
    assert.equal(response.bodyUsed, true);
    assert.equal(sample.listeners.size, 0);
  }
});

test('перенаправление без Location завершает работу и освобождает тело', async () => {
  const response = redirect(null);
  const sample = fixture({ routes: { 'https://example.com/': response } });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), /без адреса назначения/);
  assert.equal(response.bodyUsed, true);
  assert.equal(sample.listeners.size, 0);
});

test('некорректный вход и лимит отклоняются до сетевого запроса', async () => {
  const sample = fixture();
  for (const input of ['javascript:alert(1)', 'https://user:pass@example.com', 'file:///a']) {
    await assert.rejects(fetchWithRedirects(input, sample.options));
  }
  for (const maxRedirects of [-1, 11, 1.5, Infinity, '3']) {
    await assert.rejects(fetchWithRedirects('example.com', { ...sample.options, maxRedirects }), RangeError);
  }
  assert.equal(sample.calls.length, 0);
});

test('ошибка fetch всегда удаляет наблюдатель', async () => {
  const sample = fixture({ routes: { 'https://example.com/': () => { throw new Error('network fixture'); } } });
  await assert.rejects(fetchWithRedirects('example.com', sample.options), /network fixture/);
  assert.equal(sample.listeners.size, 0);
});

test('отмена во время fetch освобождает наблюдатель', async () => {
  const controller = new AbortController();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const sample = fixture({ routes: { 'https://example.com/': ({ options }) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    entered();
  }) } });
  const pending = fetchWithRedirects('example.com', { ...sample.options, signal: controller.signal });
  await started;
  assert.equal(sample.listeners.size, 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(sample.listeners.size, 0);
});

test('отменённый запрос не ждёт очереди и никогда не запускает сеть', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const sample = fixture({ routes: { 'https://example.com/first': () => new Promise(resolve => { release = resolve; entered(); }) } });
  const first = fetchWithRedirects('https://example.com/first', sample.options);
  await started;
  const controller = new AbortController();
  const queued = fetchWithRedirects('https://example.com/queued', { ...sample.options, signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/first']);
  release(new Response('first'));
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/first']);
  await fetchWithRedirects('https://example.com/after', sample.options);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/first', 'https://example.com/after']);
});

test('параллельные обращения одного URL получают собственные заголовки последовательно', async () => {
  let release;
  let entered;
  let sequence = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const sample = fixture({ routes: { 'https://example.com/': async ({ emit }) => {
    sequence += 1;
    const current = sequence;
    if (current === 1) await new Promise(resolve => { release = resolve; entered(); });
    emit({ statusCode: 302, responseHeaders: [{ name: 'Location', value: `/final-${current}` }] });
    return opaque();
  } } });
  const first = fetchWithRedirects('example.com', sample.options);
  await started;
  const second = fetchWithRedirects('example.com', sample.options);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sample.calls.length, 1);
  assert.equal(sample.listeners.size, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.url), ['https://example.com/final-1', 'https://example.com/final-2']);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/final-1', 'https://example.com/', 'https://example.com/final-2']);
  assert.equal(sample.listeners.size, 0);
});
