import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSiteAccess, fetchSiteMetadata, parseMetadataDocument, sitePermissionOrigin } from '../src/metadata.js';
import { MAX_RASTER_ICON_BYTES, MAX_SVG_ICON_BYTES } from '../src/icon-raster.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE/YAAAAASUVORK5CYII=';
const node = attributes => ({ getAttribute: key => attributes[key] ?? null });

function documentFixture({ title = null, og = null, icons = [], base = null } = {}) {
  return {
    querySelector(selector) {
      if (selector === 'title') return title === null ? null : { textContent: title };
      if (selector === 'meta[property="og:title"]') return og === null ? null : node({ content: og });
      if (selector === 'base[href]') return base === null ? null : node({ href: base });
      throw new Error(`Unexpected selector ${selector}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'link[rel][href]');
      return icons.map(node);
    }
  };
}

function permissions(allowed = ['https://example.com/*']) {
  const checked = [];
  return {
    checked,
    permissions: {
      async contains(value) {
        checked.push(value);
        return value.origins.every(origin => allowed.includes(origin));
      }
    }
  };
}

function fixture({ html = 'fixture HTML', document = documentFixture({ title: 'Example' }), allowed, response, iconResponse, rasterize, routes } = {}) {
  const browserApi = permissions(allowed);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (routes && Object.hasOwn(routes, url)) return typeof routes[url] === 'function' ? routes[url](url, options) : routes[url];
    if (calls.length === 1) return response ? response() : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return iconResponse ? iconResponse(url) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  };
  return {
    calls, browserApi,
    options: { browserApi, fetchImpl, parseDocument: () => document, rasterize: rasterize || (async () => PNG) }
  };
}

test('разрешение запрашивается синхронно, только для нормализованного origin и выбранного типа данных', async () => {
  let request;
  const pending = requestSiteAccess('https://EXAMPLE.com:443/folder?q=private#fragment', { permissions: {
    request(value) {
      request = value;
      return Promise.resolve(true);
    }
  } });
  assert.deepEqual(request, { origins: ['https://example.com/*'], permissions: ['webRequest'], data_collection: ['browsingActivity'] });
  assert.equal(await pending, true);
});

test('Firefox permission pattern охватывает hostname без порта, фактический HTTP запрос сохраняет порт и путь', async () => {
  assert.equal(sitePermissionOrigin('https://EXAMPLE.com:8443/private/path'), 'https://example.com/*');
  assert.equal(sitePermissionOrigin('http://localhost:3000/'), 'http://localhost/*');
  assert.equal(sitePermissionOrigin('https://[::1]:8443/'), 'https://[::1]/*');
  let requested;
  await requestSiteAccess('https://example.com:8443/path', { permissions: { request: value => { requested = value; return true; } } });
  assert.deepEqual(requested, { origins: ['https://example.com/*'], permissions: ['webRequest'], data_collection: ['browsingActivity'] });
  const sample = fixture();
  const result = await fetchSiteMetadata('https://example.com:8443/private/path', sample.options);
  assert.equal(result.url, 'https://example.com:8443/private/path');
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com:8443/private/path', 'https://example.com:8443/favicon.ico']);
  assert.deepEqual(sample.browserApi.checked[0].origins, ['https://example.com/*']);
});

test('отказ и отсутствие API разрешений не запускают запросы к сайту', async () => {
  assert.equal(await requestSiteAccess('example.com', { permissions: { request: () => false } }), false);
  assert.equal(await requestSiteAccess('example.com', {}), false);
  const sample = fixture({ allowed: [] });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.deepEqual(sample.calls, []);
  assert.equal(result.title, null);
  assert.equal(result.favicon, null);
  assert.match(result.warnings[0], /Нет разрешения/);
  assert.deepEqual(sample.browserApi.checked[0], { origins: ['https://example.com/*'], permissions: ['webRequest'], data_collection: ['browsingActivity'] });
});

test('опасные схемы и адреса с паролями отклоняются до сетевого запроса', async () => {
  const sample = fixture();
  for (const value of ['javascript:alert(1)', 'file:///x', 'https://u:p@example.com']) {
    await assert.rejects(fetchSiteMetadata(value, sample.options));
    await assert.rejects(requestSiteAccess(value, { permissions: { request() { throw new Error('must not call'); } } }), /HTTP|пароль/);
  }
  assert.deepEqual(sample.calls, []);
});

test('название берётся из title, нормализуется и не заменяется og:title', () => {
  const parsed = parseMetadataDocument(documentFixture({ title: '\n  Example\t &  Demo \u0000 ', og: 'Another name' }), 'example.com');
  assert.equal(parsed.title, 'Example & Demo');
  assert.deepEqual(parsed.candidates, ['https://example.com/favicon.ico']);
});

test('og:title используется только при пустом title; длинное имя не разрывает emoji', () => {
  assert.equal(parseMetadataDocument(documentFixture({ title: ' \n ', og: ' Open\t Graph ' }), 'example.com').title, 'Open Graph');
  const long = parseMetadataDocument(documentFixture({ title: `${'a'.repeat(79)}😀tail` }), 'example.com').title;
  assert.equal(long, 'a'.repeat(79));
  assert.equal(parseMetadataDocument(documentFixture(), 'example.com').title, null);
});

test('крупные значки сортируются первыми, относительные адреса используют base, опасные адреса исключаются', () => {
  const parsed = parseMetadataDocument(documentFixture({ base: '/assets/', icons: [
    { rel: 'icon', href: 'small.png', sizes: '16x16' },
    { rel: 'apple-touch-icon', href: 'touch.png', sizes: '180x180' },
    { rel: 'shortcut icon', href: 'large.png', sizes: '32x32 96x96' },
    { rel: 'ICON', href: 'large.png', sizes: '96x96' },
    { rel: 'stylesheet', href: 'style.css' },
    { rel: 'icon', href: 'data:image/png;base64,ABC' },
    { rel: 'icon', href: 'https://user:pass@foreign.example/icon.png' }
  ] }), 'https://example.com/path/page');
  assert.deepEqual(parsed.candidates, ['https://example.com/assets/touch.png', 'https://example.com/assets/large.png', 'https://example.com/assets/small.png', 'https://example.com/favicon.ico']);
});

test('успешный результат содержит исходный canonical URL, локальный PNG и ручные переходы без cookie/referrer', async () => {
  const sample = fixture();
  const result = await fetchSiteMetadata('example.com/path?q=1', sample.options);
  assert.deepEqual(result, { url: 'https://example.com/path?q=1', title: 'Example', favicon: PNG, warnings: [], requiredOrigins: [] });
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/path?q=1', 'https://example.com/favicon.ico']);
  for (const call of sample.calls) {
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('содержимое не-HTML страницы не передаётся парсеру', async () => {
  const sample = fixture({ response: () => new Response('{"title":"Wrong"}', { headers: { 'content-type': 'application/json' } }) });
  sample.options.parseDocument = () => { throw new Error('parser must not run'); };
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, null);
  assert.equal(result.favicon, PNG);
  assert.deepEqual(result.requiredOrigins, []);
  assert.match(result.warnings[0], /не HTML/);
});

test('HTTP ошибки сохраняют честное предупреждение без выдуманного title', async () => {
  const sample = fixture({ response: () => new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } }) });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, null);
  assert.match(result.warnings[0], /HTTP 403/);
});

test('HTML больше 1 МБ читается с Content-Length и без него, включая название после большого script', async () => {
  const html = `<html><head><script type="application/json">${'x'.repeat(1200000)}</script><title>Большая страница</title></head><body>ready</body></html>`;
  for (const headers of [
    { 'content-type': 'text/html; charset=utf-8', 'content-length': String(new TextEncoder().encode(html).byteLength) },
    { 'content-type': 'text/html; charset=utf-8' }
  ]) {
    const sample = fixture({ response: () => new Response(html, { headers }), document: documentFixture({ title: 'Большая страница' }) });
    sample.options.parseDocument = value => {
      assert.ok(value.includes('<title>Большая страница</title>'));
      return documentFixture({ title: 'Большая страница' });
    };
    const result = await fetchSiteMetadata('example.com', sample.options);
    assert.equal(result.title, 'Большая страница');
    assert.deepEqual(result.warnings, []);
    assert.equal(result.favicon, PNG);
  }
});

test('пустой head не прерывает чтение названия из последующей разметки', async () => {
  const html = '<html><head></head><body><title>Позднее название</title></body></html>';
  const sample = fixture({ html });
  sample.options.parseDocument = value => documentFixture({ title: value.includes('<title>Позднее название</title>') ? 'Позднее название' : null });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, 'Позднее название');
  assert.deepEqual(result.warnings, []);
});

test('кодировка windows-1251 из HTTP заголовка читается без потери кириллицы', async () => {
  const sample = fixture({ response: () => new Response(new Uint8Array([0xd2, 0xe5, 0xf1, 0xf2]), { headers: { 'content-type': 'text/html; charset=windows-1251' } }) });
  sample.options.parseDocument = html => {
    assert.equal(html, 'Тест');
    return documentFixture({ title: html });
  };
  assert.equal((await fetchSiteMetadata('example.com', sample.options)).title, 'Тест');
});

test('неизвестная кодировка явно отмечается, UTF-8 BOM имеет приоритет', async () => {
  const sample = fixture({ response: () => new Response('Тест', { headers: { 'content-type': 'text/html; charset=unknown-example' } }) });
  sample.options.parseDocument = html => documentFixture({ title: html });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, 'Тест');
  assert.match(result.warnings[0], /неизвестную кодировку/);
  const bom = fixture({ response: () => new Response(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Тест')]), { headers: { 'content-type': 'text/html; charset=windows-1251' } }) });
  bom.options.parseDocument = html => documentFixture({ title: html });
  assert.equal((await fetchSiteMetadata('example.com', bom.options)).title, 'Тест');
});

test('CDN без отдельного разрешения не получает запросов, используется собственный favicon.ico', async () => {
  const sample = fixture({ document: documentFixture({ title: 'Demo', icons: [{ rel: 'icon', sizes: '192x192', href: 'https://cdn.example.net/icon.png' }] }) });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, PNG);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/favicon.ico']);
  assert.ok(sample.browserApi.checked.some(check => check.origins.includes('https://cdn.example.net/*')));
});

test('CDN с уже выданным разрешением можно использовать без нового запроса permissions.request', async () => {
  const sample = fixture({ allowed: ['https://example.com/*', 'https://cdn.example.net/*'], document: documentFixture({ title: 'Demo', icons: [{ rel: 'icon', href: 'https://cdn.example.net/icon.png' }] }) });
  assert.equal((await fetchSiteMetadata('example.com', sample.options)).favicon, PNG);
  assert.equal(sample.calls[1].url, 'https://cdn.example.net/icon.png');
});

test('недоступный CDN возвращается для явного запроса разрешения только если собственный favicon не загрузился', async () => {
  const sample = fixture({ document: documentFixture({ title: 'Demo', icons: [
    { rel: 'icon', href: 'https://cdn.example.net:8443/one.png' },
    { rel: 'apple-touch-icon', href: 'https://cdn.example.net/two.png' },
    { rel: 'icon', href: 'https://assets.example.net/icon.png' },
    { rel: 'icon', href: 'https://static.example.net/icon.png' },
    { rel: 'icon', href: 'https://fourth.example.net/icon.png' }
  ] }), iconResponse: () => new Response('', { status: 404 }) });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, null);
  assert.deepEqual(result.requiredOrigins, ['https://cdn.example.net/*', 'https://assets.example.net/*', 'https://static.example.net/*']);
  assert.match(result.warnings.at(-1), /дополнительное разрешение/);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/favicon.ico']);
});

test('повторная загрузка с выданным CDN разрешением очищает requiredOrigins и использует исходный адрес иконки с портом', async () => {
  const sample = fixture({ allowed: ['https://example.com/*', 'https://cdn.example.net/*'], document: documentFixture({ title: 'Demo', icons: [
    { rel: 'icon', href: 'https://denied.example.net/icon.png', sizes: '256x256' },
    { rel: 'icon', href: 'https://cdn.example.net:8443/icon.png', sizes: '192x192' }
  ] }) });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, PNG);
  assert.deepEqual(result.requiredOrigins, []);
  assert.equal(sample.calls[1].url, 'https://cdn.example.net:8443/icon.png');
});

test('ошибка преобразования SVG и слишком большой PNG не мешают fallback, число скачиваний ограничено тремя', async () => {
  let rasterized = 0;
  const sample = fixture({ document: documentFixture({ title: 'Demo', icons: [
    { rel: 'icon', href: '/vector.svg', sizes: '256x256' },
    { rel: 'icon', href: '/large.png', sizes: '192x192' },
    { rel: 'icon', href: '/ignored.png', sizes: '128x128' },
    { rel: 'icon', href: '/also-ignored.png', sizes: '64x64' }
  ] }), iconResponse: url => {
    if (url.endsWith('.svg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    if (url.endsWith('large.png')) return new Response(new Uint8Array(MAX_RASTER_ICON_BYTES + 1), { headers: { 'content-type': 'image/png' } });
    return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/x-icon' } });
  }, rasterize: async (_bytes, type) => {
    if (type === 'image/svg+xml') throw new Error('invalid SVG fixture');
    rasterized++;
    return PNG;
  } });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, PNG);
  assert.equal(rasterized, 1);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/vector.svg', 'https://example.com/large.png', 'https://example.com/favicon.ico']);
});

test('PNG размером как у Bridge проходит чтение свыше старых 256 КиБ и сохраняется как маленький локальный PNG', async () => {
  const source = new Uint8Array(1_318_272);
  source.set([137, 80, 78, 71]);
  source[source.length - 1] = 123;
  let rasterized = 0;
  const sample = fixture({
    document: documentFixture({ title: 'Example App', icons: [{ rel: 'icon', href: '/favicon.png' }] }),
    iconResponse: () => new Response(source, { headers: { 'content-type': 'image/png', 'content-length': String(source.byteLength) } }),
    rasterize: async (bytes, type) => {
      assert.equal(type, 'image/png');
      assert.equal(bytes.byteLength, 1_318_272);
      assert.deepEqual(bytes.subarray(0, 4), new Uint8Array([137, 80, 78, 71]));
      assert.equal(bytes[bytes.length - 1], 123);
      rasterized++;
      return PNG;
    }
  });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, 'Example App');
  assert.equal(result.favicon, PNG);
  assert.deepEqual(result.warnings, []);
  assert.equal(rasterized, 1);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/favicon.png']);
});

test('растровые данные свыше 8 МиБ и SVG свыше 256 КиБ останавливают чтение до растеризации', async () => {
  for (const [type, limit] of [['image/png', MAX_RASTER_ICON_BYTES], ['image/svg+xml', MAX_SVG_ICON_BYTES]]) {
    for (const declaredLength of [true, false]) {
      let reads = 0;
      let cancelled = 0;
      let released = 0;
      let rasterized = 0;
      const half = new Uint8Array(limit / 2);
      const chunks = [half, half, new Uint8Array([1]), new Uint8Array([2])];
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': type, ...(declaredLength ? { 'content-length': String(limit + 1) } : {}) }),
        body: {
          async cancel() { cancelled++; },
          getReader() {
            return {
              async read() { return { done: false, value: chunks[reads++] }; },
              async cancel() { cancelled++; },
              releaseLock() { released++; }
            };
          }
        }
      };
      const sample = fixture({
        document: documentFixture({ title: 'Название остаётся доступным', icons: [{ rel: 'icon', href: '/oversized-icon' }] }),
        iconResponse: url => url.endsWith('/oversized-icon') ? response : new Response('', { status: 404 }),
        rasterize: async () => { rasterized++; return PNG; }
      });
      const result = await fetchSiteMetadata('example.com', sample.options);
      assert.equal(result.title, 'Название остаётся доступным');
      assert.equal(result.favicon, null);
      assert.equal(rasterized, 0);
      assert.equal(reads, declaredLength ? 0 : 3);
      assert.equal(cancelled, 1);
      assert.equal(released, declaredLength ? 0 : 1);
      assert.deepEqual(result.warnings, [type === 'image/svg+xml' ? 'SVG-значок превышает лимит 256 КиБ.' : 'Файл значка превышает лимит 8 МиБ.']);
      assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/oversized-icon', 'https://example.com/favicon.ico']);
    }
  }
});

test('растеризатор не может вернуть удалённый адрес, SVG data или чрезмерный PNG', async () => {
  for (const value of ['https://example.com/icon.png', 'data:image/svg+xml;base64,ABC', `data:image/png;base64,iVBORw0KGgo${'A'.repeat(100000)}`]) {
    const sample = fixture({ rasterize: async () => value });
    const result = await fetchSiteMetadata('example.com', sample.options);
    assert.equal(result.favicon, null);
    assert.match(result.warnings.at(-1), /Значок сайта недоступен/);
  }
});

test('сетевая ошибка страницы не создаёт title и сохраняет понятное предупреждение', async () => {
  const sample = fixture();
  const originalFetch = sample.options.fetchImpl;
  sample.options.fetchImpl = async (url, options) => {
    if (url === 'https://example.com/') {
      sample.calls.push({ url, options });
      throw new TypeError('NetworkError when attempting to fetch resource');
    }
    return originalFetch(url, options);
  };
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, null);
  assert.match(result.warnings[0], /Проверьте адрес/);
  assert.ok(sample.calls.every(call => new URL(call.url).origin === 'https://example.com'));
});

test('отсутствие разрешения webRequest останавливает metadata до сети', async () => {
  const sample = fixture();
  const originalContains = sample.browserApi.permissions.contains;
  sample.browserApi.permissions.contains = value => value.permissions?.includes('webRequest') ? false : originalContains(value);
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, null);
  assert.equal(result.favicon, null);
  assert.equal(sample.calls.length, 0);
  assert.match(result.warnings[0], /Нет разрешения/);
});

test('удалённый SVG передаётся растеризатору и сохраняется только локальный PNG', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="red" d="M0 0h64v64H0z"/></svg>';
  const received = [];
  const sample = fixture({ document: documentFixture({ title: 'SVG Site', icons: [{ rel: 'icon', href: '/mark.svg', sizes: 'any' }] }),
    iconResponse: () => new Response(svg, { headers: { 'content-type': 'IMAGE/SVG+XML; charset=utf-8' } }),
    rasterize: async (bytes, type, options) => {
      received.push({ svg: new TextDecoder().decode(bytes), type, signal: options.signal });
      return PNG;
    }
  });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, 'SVG Site');
  assert.equal(result.favicon, PNG);
  assert.deepEqual(result.requiredOrigins, []);
  assert.equal(received.length, 1);
  assert.equal(received[0].svg, svg);
  assert.equal(received[0].type, 'image/svg+xml');
  assert.ok(received[0].signal instanceof AbortSignal);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/mark.svg']);
});

test('встроенные percent и base64 SVG загружаются без отдельного сетевого запроса', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Значок</title><circle cx="16" cy="16" r="10"/></svg>';
  for (const href of [`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]) {
    let rasterized = 0;
    const sample = fixture({ document: documentFixture({ title: 'Inline', icons: [{ rel: 'icon', href, sizes: 'any' }] }),
      rasterize: async (bytes, type) => {
        assert.equal(new TextDecoder().decode(bytes), svg);
        assert.equal(type, 'image/svg+xml');
        rasterized++;
        return PNG;
      }
    });
    const parsed = parseMetadataDocument(documentFixture({ icons: [{ rel: 'icon', href, sizes: 'any' }, { rel: 'apple-touch-icon', href: '/touch.png', sizes: '180x180' }] }), 'https://example.com/');
    assert.equal(parsed.candidates[0], href);
    const result = await fetchSiteMetadata('example.com', sample.options);
    assert.equal(result.favicon, PNG);
    assert.deepEqual(result.requiredOrigins, []);
    assert.equal(rasterized, 1);
    assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/']);
    assert.ok(sample.browserApi.checked.every(value => value.origins.every(origin => origin === 'https://example.com/*')));
  }
});

test('повреждённый встроенный SVG и SVG сверх лимита не блокируют favicon fallback', async () => {
  for (const href of ['data:image/svg+xml,%ZZ', 'data:image/svg+xml;base64,###', `data:image/svg+xml,${'a'.repeat(256 * 1024 + 1)}`]) {
    let rasterized = 0;
    const sample = fixture({ document: documentFixture({ title: 'Invalid Inline', icons: [{ rel: 'icon', href, sizes: 'any' }] }),
      rasterize: async (_bytes, type) => {
        assert.equal(type, 'image/png');
        rasterized++;
        return PNG;
      }
    });
    const result = await fetchSiteMetadata('example.com', sample.options);
    assert.equal(result.favicon, PNG);
    assert.equal(rasterized, 1);
    assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/favicon.ico']);
  }
});

test('разрешённые перенаправления читают title и относительный значок относительно конечной страницы и base', async () => {
  for (const [base, href, finalIcon] of [
    [null, '../icons/mark.svg', 'https://target.test/icons/mark.svg'],
    ['./assets/', 'mark.svg', 'https://target.test/app/assets/mark.svg']
  ]) {
    const sample = fixture({ allowed: ['https://example.com/*', 'https://target.test/*'],
      document: documentFixture({ title: 'Final page title', base, icons: [{ rel: 'icon', href, sizes: 'any' }] }),
      routes: {
        'https://example.com/old': () => new Response('', { status: 301, headers: { location: 'https://target.test/app/home' } }),
        'https://target.test/app/home': () => new Response('<title>Final page title</title>', { headers: { 'content-type': 'text/html' } }),
        [finalIcon]: () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
      }
    });
    const result = await fetchSiteMetadata('https://example.com/old', sample.options);
    assert.equal(result.url, 'https://example.com/old');
    assert.equal(result.resolvedUrl, 'https://target.test/app/home');
    assert.equal(result.title, 'Final page title');
    assert.equal(result.favicon, PNG);
    assert.deepEqual(result.requiredOrigins, []);
    assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/old', 'https://target.test/app/home', finalIcon]);
  }
});

test('успешный исходный favicon не скрывает разрешение, необходимое для перенаправленной страницы', async () => {
  const allowed = ['https://example.com/*'];
  const sample = fixture({ allowed, document: documentFixture({ title: 'Authorized final title' }), routes: {
    'https://example.com/': () => new Response('', { status: 302, headers: { location: 'https://target.test/final/page' } }),
    'https://example.com/favicon.ico': () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
    'https://target.test/final/page': () => new Response('<title>Authorized final title</title>', { headers: { 'content-type': 'text/html' } }),
    'https://target.test/favicon.ico': () => new Response(new Uint8Array([2]), { headers: { 'content-type': 'image/png' } })
  } });
  const pending = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(pending.title, null);
  assert.equal(pending.favicon, PNG);
  assert.equal(pending.pendingPage, true);
  assert.deepEqual(pending.requiredOrigins, ['https://target.test/*']);
  assert.match(pending.warnings[0], /target\.test/);
  assert.deepEqual(sample.calls.map(call => call.url), ['https://example.com/', 'https://example.com/favicon.ico']);
  allowed.push('https://target.test/*');
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.title, 'Authorized final title');
  assert.equal(result.resolvedUrl, 'https://target.test/final/page');
  assert.equal(result.pendingPage, undefined);
  assert.deepEqual(result.requiredOrigins, []);
  assert.deepEqual(sample.calls.slice(2).map(call => call.url), ['https://example.com/', 'https://target.test/final/page', 'https://target.test/favicon.ico']);
});

test('перенаправленный SVG значок требует разрешение CDN до запроса и загружается после повторной попытки', async () => {
  const allowed = ['https://example.com/*'];
  const sample = fixture({ allowed, document: documentFixture({ title: 'Redirecting icon', icons: [{ rel: 'icon', href: '/icon.svg', sizes: 'any' }] }), routes: {
    'https://example.com/': () => new Response('<title>Redirecting icon</title>', { headers: { 'content-type': 'text/html' } }),
    'https://example.com/icon.svg': () => new Response('', { status: 307, headers: { location: '/assets/current.svg' } }),
    'https://example.com/assets/current.svg': () => new Response('', { status: 308, headers: { location: 'https://cdn.test/brand.svg' } }),
    'https://example.com/favicon.ico': () => new Response('', { status: 404 }),
    'https://cdn.test/brand.svg': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
  } });
  const pending = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(pending.title, 'Redirecting icon');
  assert.equal(pending.favicon, null);
  assert.deepEqual(pending.requiredOrigins, ['https://cdn.test/*']);
  assert.match(pending.warnings.at(-1), /дополнительное разрешение/);
  assert.equal(sample.calls.some(call => call.url.startsWith('https://cdn.test/')), false);
  allowed.push('https://cdn.test/*');
  const countBeforeRetry = sample.calls.length;
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, PNG);
  assert.deepEqual(result.requiredOrigins, []);
  assert.deepEqual(sample.calls.slice(countBeforeRetry).map(call => call.url), ['https://example.com/', 'https://example.com/icon.svg', 'https://example.com/assets/current.svg', 'https://cdn.test/brand.svg']);
});

test('успешный favicon fallback избавляет от ненужного разрешения перенаправленной иконки', async () => {
  const sample = fixture({ document: documentFixture({ title: 'Fallback', icons: [{ rel: 'icon', href: '/redirect.svg' }] }), routes: {
    'https://example.com/': () => new Response('<title>Fallback</title>', { headers: { 'content-type': 'text/html' } }),
    'https://example.com/redirect.svg': () => new Response('', { status: 302, headers: { location: 'https://cdn.test/brand.svg' } }),
    'https://example.com/favicon.ico': () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
  } });
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.equal(result.favicon, PNG);
  assert.equal(result.title, 'Fallback');
  assert.deepEqual(result.requiredOrigins, []);
  assert.equal(sample.calls.some(call => call.url.startsWith('https://cdn.test/')), false);
});

test('заранее отменённая загрузка не обращается к сети', async () => {
  const sample = fixture();
  const controller = new AbortController();
  controller.abort(new DOMException('Отмена', 'AbortError'));
  await assert.rejects(fetchSiteMetadata('example.com', { ...sample.options, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(sample.calls, []);
});

test('тайм-аут прерывает сетевой запрос и возвращает ограничение явно', async () => {
  const sample = fixture();
  sample.options.fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const started = Date.now();
  const result = await fetchSiteMetadata('example.com', sample.options);
  assert.ok(Date.now() - started < 10000);
  assert.equal(result.title, null);
  assert.match(result.warnings[0], /за 8 секунд/);
});
