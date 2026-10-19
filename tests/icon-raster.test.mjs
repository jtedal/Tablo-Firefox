import test from 'node:test';
import assert from 'node:assert/strict';
import { IconSizeError, MAX_RASTER_ICON_BYTES, MAX_SVG_ICON_BYTES, rasterizeIcon } from '../src/icon-raster.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE/YAAAAASUVORK5CYII=';
const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

function element(localName, attributes = {}, children = [], namespaceURI = SVG_NS) {
  const node = {
    localName, namespaceURI, children, textContent: '', parent: null,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, localName: name.includes(':') ? name.split(':')[1] : name, value, namespaceURI: name.startsWith('xlink:') ? 'http://www.w3.org/1999/xlink' : name === 'xml:base' ? 'http://www.w3.org/XML/1998/namespace' : null })),
    getAttribute(name) { return this.attributes.find(attribute => attribute.name === name)?.value ?? null; },
    setAttribute(name, value) {
      const attribute = this.attributes.find(attribute => attribute.name === name);
      if (attribute) attribute.value = String(value);
      else this.attributes.push({ name, localName: name, value: String(value), namespaceURI: null });
    },
    removeAttributeNode(attribute) { this.attributes.splice(this.attributes.indexOf(attribute), 1); },
    querySelectorAll(selector) {
      assert.equal(selector, '*');
      return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    },
    contains(other) { return this === other || this.children.some(child => child.contains(other)); },
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  };
  for (const child of children) child.parent = node;
  node.style = { setProperty: (name, value, priority) => node.setAttribute('style', `${node.getAttribute('style') || ''};${name}:${value}${priority ? `!${priority}` : ''};`) };
  return node;
}

function documentFixture({ root = element('svg', { viewBox: '0 0 24 24' }), parserError = false, imageEvent = 'load', naturalWidth = 96, naturalHeight = 96, canvasError = false, context = true } = {}) {
  const state = { root, drawCalls: [], blobs: [], revoked: [], images: [], parserInputs: [] };
  const documentImpl = {
    defaultView: {
      DOMParser: class {
        parseFromString(text, type) {
          state.parserInputs.push({ text, type });
          return { documentElement: root, getElementsByTagName: name => name === 'parsererror' && parserError ? [{}] : [] };
        }
      },
      XMLSerializer: class {
        serializeToString(node) {
          state.serializedRoot = node;
          return '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"/>';
        }
      },
      URL: {
        createObjectURL(blob) { state.blobs.push(blob); return `blob:fixture/${state.blobs.length}`; },
        revokeObjectURL(url) { state.revoked.push(url); }
      }
    },
    createElement(name) {
      if (name === 'canvas') return {
        width: 0, height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          return context ? { drawImage: (...args) => state.drawCalls.push(args) } : null;
        },
        toDataURL(type) {
          assert.equal(this.width, 96);
          assert.equal(this.height, 96);
          assert.equal(type, 'image/png');
          if (canvasError) throw new Error('export-error');
          return PNG;
        }
      };
      assert.equal(name, 'img');
      let src;
      const image = {
        naturalWidth, naturalHeight, onload: null, onerror: null,
        get src() { return src; },
        set src(value) {
          assert.match(value, /^blob:fixture\//);
          src = value;
          if (imageEvent !== 'hold') queueMicrotask(() => image[imageEvent === 'load' ? 'onload' : 'onerror']?.());
        },
        removeAttribute(name) { assert.equal(name, 'src'); src = undefined; }
      };
      state.images.push(image);
      return image;
    }
  };
  return { documentImpl, state };
}

function bitmapMock(t, result) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const calls = [];
  globalThis.createImageBitmap = blob => { calls.push(blob); return Promise.resolve(typeof result === 'function' ? result(blob) : result); };
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'createImageBitmap', original);
    else delete globalThis.createImageBitmap;
  });
  return calls;
}

function bitmap(width = 32, height = 16) {
  return { width, height, closed: 0, close() { this.closed += 1; } };
}

test('растровый значок вписывается в PNG 96×96 без изменения пропорций, bitmap освобождается', async t => {
  const source = bitmap();
  const calls = bitmapMock(t, source);
  const { documentImpl, state } = documentFixture();
  assert.equal(await rasterizeIcon(new Uint8Array([1, 2]), 'image/png', { documentImpl }), PNG);
  assert.deepEqual(state.drawCalls[0].slice(1), [0, 24, 96, 48]);
  assert.equal(calls[0].type, 'image/png');
  assert.equal(source.closed, 1);
});

test('разрешены существующие растровые MIME-типы и нормализованный MIME с charset', async t => {
  const calls = bitmapMock(t, () => bitmap());
  const { documentImpl } = documentFixture();
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', ' IMAGE/PNG; charset=binary']) {
    assert.equal(await rasterizeIcon(new Uint8Array([1]), type, { documentImpl }), PNG);
  }
  assert.equal(calls.length, 8);
});

test('ArrayBuffer и срезы typed array передаются декодеру без соседних байтов', async t => {
  const calls = bitmapMock(t, () => bitmap());
  const { documentImpl } = documentFixture();
  await rasterizeIcon(new Uint8Array([1, 2]).buffer, 'image/png', { documentImpl });
  await rasterizeIcon(new Uint8Array([0, 3, 4, 0]).subarray(1, 3), 'image/png', { documentImpl });
  assert.deepEqual([...new Uint8Array(await calls[0].arrayBuffer())], [1, 2]);
  assert.deepEqual([...new Uint8Array(await calls[1].arrayBuffer())], [3, 4]);
});

test('неизвестный MIME и пустой или слишком большой растровый input отклоняются до декодирования', async t => {
  const calls = bitmapMock(t, () => bitmap());
  const { documentImpl } = documentFixture();
  await assert.rejects(rasterizeIcon(new Uint8Array([1]), 'text/html', { documentImpl }), /image-type/);
  await assert.rejects(rasterizeIcon(new Uint8Array(), 'image/png', { documentImpl }), /image-size/);
  await assert.rejects(rasterizeIcon(new Uint8Array(MAX_RASTER_ICON_BYTES + 1), 'image/png', { documentImpl }), error => error instanceof IconSizeError && error.maxBytes === 8 * 1024 * 1024);
  await assert.rejects(rasterizeIcon('binary', 'image/png', { documentImpl }), /image-bytes/);
  assert.equal(calls.length, 0);
});

test('растровый значок размером как у Bridge и граничные 8 МиБ доходят до декодера и уменьшаются до PNG', async t => {
  const sources = [];
  const calls = bitmapMock(t, () => {
    const source = bitmap(1920, 1920);
    sources.push(source);
    return source;
  });
  const { documentImpl, state } = documentFixture();
  for (const size of [1_318_272, MAX_RASTER_ICON_BYTES]) {
    assert.equal(await rasterizeIcon(new Uint8Array(size), 'image/png', { documentImpl }), PNG);
  }
  assert.deepEqual(calls.map(blob => blob.size), [1_318_272, 8 * 1024 * 1024]);
  assert.deepEqual(state.drawCalls.map(call => call.slice(1)), [[0, 0, 96, 96], [0, 0, 96, 96]]);
  assert.ok(sources.every(source => source.closed === 1));
});

test('SVG сохраняет отдельный предел 256 КиБ независимо от растрового лимита', async t => {
  const calls = bitmapMock(t, () => bitmap());
  const { documentImpl, state } = documentFixture();
  const oversized = new Uint8Array(MAX_SVG_ICON_BYTES + 1);
  await assert.rejects(rasterizeIcon(oversized, 'image/svg+xml', { documentImpl }), error => error instanceof IconSizeError && error.maxBytes === 256 * 1024);
  assert.equal(state.parserInputs.length, 0);
  assert.equal(state.blobs.length, 0);
  assert.equal(calls.length, 0);
  const boundary = new TextEncoder().encode(`<svg xmlns="${SVG_NS}">${' '.repeat(MAX_SVG_ICON_BYTES - new TextEncoder().encode(`<svg xmlns="${SVG_NS}"></svg>`).byteLength)}</svg>`);
  assert.equal(boundary.byteLength, 256 * 1024);
  assert.equal(await rasterizeIcon(boundary, 'image/svg+xml', { documentImpl }), PNG);
  assert.equal(state.parserInputs.length, 1);
  assert.equal(calls.length, 0);
});

test('нулевые, бесконечные и чрезмерные размеры bitmap отклоняются с освобождением bitmap', async t => {
  let source;
  bitmapMock(t, () => source);
  const { documentImpl, state } = documentFixture();
  for (const [width, height] of [[0, 32], [32, 0], [4097, 32], [32, 4097], [Infinity, 1], [1, NaN]]) {
    source = bitmap(width, height);
    await assert.rejects(rasterizeIcon(new Uint8Array([1]), 'image/png', { documentImpl }), /image-size/);
    assert.equal(source.closed, 1);
  }
  assert.equal(state.drawCalls.length, 0);
});

test('ошибка canvas не оставляет bitmap в памяти', async t => {
  const source = bitmap();
  bitmapMock(t, source);
  const { documentImpl } = documentFixture({ canvasError: true });
  await assert.rejects(rasterizeIcon(new Uint8Array([1]), 'image/png', { documentImpl }), /export-error/);
  assert.equal(source.closed, 1);
});

test('отмена до начала работы не запускает декодер', async t => {
  const calls = bitmapMock(t, () => bitmap());
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(rasterizeIcon(new Uint8Array([1]), 'image/png', { documentImpl: documentFixture().documentImpl, signal: controller.signal }), /cancelled/);
  assert.equal(calls.length, 0);
});

test('отмена во время bitmap decode закрывает запоздавший результат', async t => {
  let finishDecode;
  const source = bitmap();
  bitmapMock(t, () => new Promise(resolve => { finishDecode = resolve; }));
  const controller = new AbortController();
  const pending = rasterizeIcon(new Uint8Array([1]), 'image/png', { documentImpl: documentFixture().documentImpl, signal: controller.signal });
  await Promise.resolve();
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  finishDecode(source);
  await new Promise(setImmediate);
  assert.equal(source.closed, 1);
});

test('bitmap decode ограничен 8 секундами, запоздавший bitmap закрывается', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishDecode;
  const source = bitmap();
  bitmapMock(t, () => new Promise(resolve => { finishDecode = resolve; }));
  const pending = rasterizeIcon(new Uint8Array([1]), 'image/png', { documentImpl: documentFixture().documentImpl });
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  await Promise.resolve();
  t.mock.timers.tick(8000);
  await rejected;
  finishDecode(source);
  await new Promise(setImmediate);
  assert.equal(source.closed, 1);
});

test('SVG загружается только из локального Blob, получает viewport96, URL и image очищаются', async () => {
  const { documentImpl, state } = documentFixture();
  assert.equal(await rasterizeIcon(bytes, 'image/svg+xml', { documentImpl }), PNG);
  assert.equal(state.parserInputs[0].type, 'image/svg+xml');
  assert.equal(state.blobs[0].type, 'image/svg+xml');
  assert.equal(state.root.getAttribute('width'), '96');
  assert.equal(state.root.getAttribute('height'), '96');
  assert.equal(state.root.getAttribute('viewBox'), '0 0 24 24');
  assert.deepEqual(state.revoked, ['blob:fixture/1']);
  assert.equal(state.images[0].src, undefined);
  assert.equal(state.images[0].onload, null);
  assert.equal(state.images[0].onerror, null);
});

test('SVG без viewBox сохраняет исходную систему координат через width и height', async () => {
  const root = element('svg', { width: '2cm', height: '1cm' });
  const { documentImpl } = documentFixture({ root });
  await rasterizeIcon(bytes, 'image/svg+xml', { documentImpl });
  assert.equal(root.getAttribute('viewBox'), `0 0 ${2 * 96 / 2.54} ${96 / 2.54}`);
});

test('SVG DOM sanitizer сохраняет внутренние ссылки, paths, inline CSS, gradients и media rules', async () => {
  const style = element('style');
  style.textContent = '.paint{fill:url(#gradient)} @media(prefers-color-scheme:dark){.paint{fill:white}}';
  const gradient = element('linearGradient', { id: 'gradient' });
  const path = element('path', { id: 'shape', d: 'M0 0h24v24H0z', fill: 'url(#gradient)', style: 'stroke:#fff;stroke-width:1' });
  const use = element('use', { 'xlink:href': '#shape' });
  const root = element('svg', { viewBox: '0 0 24 24' }, [style, gradient, path, use]);
  const { documentImpl } = documentFixture({ root });
  await rasterizeIcon(bytes, 'image/svg+xml', { documentImpl });
  assert.deepEqual(root.children, [style, gradient, path, use]);
  assert.equal(path.getAttribute('fill'), 'url(#gradient)');
  assert.equal(path.getAttribute('style'), 'stroke:#fff;stroke-width:1');
  assert.equal(use.getAttribute('xlink:href'), '#shape');
  assert.match(style.textContent, /prefers-color-scheme/);
});

test('SVG удаляет исполняемые и вложенные image элементы, внешние href и URL в CSS', async () => {
  const script = element('script');
  const foreign = element('foreignObject');
  const image = element('image', { href: 'data:image/png;base64,AAAA' });
  const feImage = element('feImage', { href: 'https://external.example/icon.png' });
  const animate = element('animate', { attributeName: 'href', to: 'data:image/svg+xml,...' });
  const externalUse = element('use', { href: 'https://external.example/icon.svg#shape' });
  const style = element('style');
  style.textContent = '@im\\70ort "data:text/css,..."; path {fill:red}';
  const path = element('path', { onclick: 'alert(1)', style: 'fill:u\\72l(data:image/svg+xml,...)', fill: '#0f0', 'xml:base': 'https://external.example/' });
  const root = element('svg', { viewBox: '0 0 24 24', onload: 'alert(1)' }, [script, foreign, image, feImage, animate, externalUse, style, path]);
  const { documentImpl } = documentFixture({ root });
  await rasterizeIcon(bytes, 'image/svg+xml', { documentImpl });
  assert.deepEqual(root.children, [externalUse, path]);
  assert.equal(externalUse.getAttribute('href'), null);
  assert.equal(path.getAttribute('onclick'), null);
  assert.equal(path.getAttribute('style'), null);
  assert.equal(path.getAttribute('xml:base'), null);
  assert.equal(path.getAttribute('fill'), '#0f0');
  assert.equal(root.getAttribute('onload'), null);
});

test('SVG parser error, чужой root и чрезмерные размеры отклоняются до создания Blob URL', async () => {
  for (const options of [
    { parserError: true },
    { root: element('html', {}, [], 'http://www.w3.org/1999/xhtml') },
    { root: element('svg', { width: '4097', height: '32' }) },
    { root: element('svg', { width: '0', height: '32' }) },
    { root: element('svg', { viewBox: '0 0 -1 32' }) },
    { root: element('svg', { viewBox: '0 0 24 24' }, [element('rect', { width: '1e100', height: '1' })]) }
  ]) {
    const { documentImpl, state } = documentFixture(options);
    await assert.rejects(rasterizeIcon(bytes, 'image/svg+xml', { documentImpl }), /svg-xml|image-size/);
    assert.deepEqual(state.blobs, []);
  }
});

test('SVG entity declarations отклоняются до XML parser, обычный XML UTF-16 BOM читается', async () => {
  const { documentImpl, state } = documentFixture();
  await assert.rejects(rasterizeIcon(new TextEncoder().encode('<!DOCTYPE svg [<!ENTITY a "x">]><svg/>'), 'image/svg+xml', { documentImpl }), /svg-entity/);
  assert.equal(state.parserInputs.length, 0);
  const utf16 = Buffer.from('\ufeff<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf16le');
  await rasterizeIcon(utf16, 'image/svg+xml', { documentImpl });
  assert.match(state.parserInputs[0].text, /^<svg /);
});

test('XML parser получает SVG без внешнего DTD и stylesheet processing instruction', async () => {
  const { documentImpl, state } = documentFixture();
  const source = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://external.example/svg.dtd"><?xml-stylesheet href="data:text/css,..."?><svg xmlns="http://www.w3.org/2000/svg"/>';
  await rasterizeIcon(new TextEncoder().encode(source), 'image/svg+xml', { documentImpl });
  assert.match(state.parserInputs[0].text, /^<svg /);
  assert.doesNotMatch(state.parserInputs[0].text, /DOCTYPE|xml-stylesheet|data:|https:/);
});

test('удаление DTD не делает валидными некорректные или повторяющиеся декларации', async () => {
  for (const source of [
    '<!doctype svg><svg/>',
    '<!DOCTYPE svg invalid><svg/>',
    '<!DOCTYPE svg><!DOCTYPE svg><svg/>',
    '<svg><!DOCTYPE svg></svg>'
  ]) {
    const { documentImpl, state } = documentFixture();
    await assert.rejects(rasterizeIcon(new TextEncoder().encode(source), 'image/svg+xml', { documentImpl }), /svg-xml/);
    assert.equal(state.parserInputs.length, 0);
  }
});

test('ошибка загрузки SVG и ошибка canvas освобождают Blob URL и очищают image', async () => {
  for (const options of [{ imageEvent: 'error' }, { canvasError: true }, { context: false }, { naturalWidth: 4097 }]) {
    const { documentImpl, state } = documentFixture(options);
    await assert.rejects(rasterizeIcon(bytes, 'image/svg+xml', { documentImpl }));
    assert.deepEqual(state.revoked, ['blob:fixture/1']);
    assert.equal(state.images[0].src, undefined);
    assert.equal(state.images[0].onload, null);
  }
});

test('отмена во время загрузки SVG очищает handlers, src и Blob URL', async () => {
  const { documentImpl, state } = documentFixture({ imageEvent: 'hold' });
  const controller = new AbortController();
  const pending = rasterizeIcon(bytes, 'image/svg+xml', { documentImpl, signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(state.revoked, ['blob:fixture/1']);
  assert.equal(state.images[0].src, undefined);
  assert.equal(state.images[0].onload, null);
});

test('загрузка SVG ограничена 8 секундами и освобождает локальный URL', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { documentImpl, state } = documentFixture({ imageEvent: 'hold' });
  const pending = rasterizeIcon(bytes, 'image/svg+xml', { documentImpl });
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  t.mock.timers.tick(8000);
  await rejected;
  assert.deepEqual(state.revoked, ['blob:fixture/1']);
  assert.equal(state.images[0].src, undefined);
});
