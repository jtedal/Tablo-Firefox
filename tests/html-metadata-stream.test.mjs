import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetadataHtml } from '../src/html-metadata-stream.js';

const encoder = new TextEncoder();

function fixture(chunks, { contentType = 'text/html; charset=utf-8', open = false, contentLength } = {}) {
  let cancelled = false;
  let reason;
  let reads = 0;
  const queue = chunks.map(value => typeof value === 'string' ? encoder.encode(value) : value);
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      if (queue.length) controller.enqueue(queue.shift());
      else if (!open) controller.close();
    },
    cancel(value) {
      cancelled = true;
      reason = value;
    }
  }, { highWaterMark: 0 });
  const headers = new Headers({ 'content-type': contentType });
  if (contentLength !== undefined) headers.set('content-length', contentLength);
  return { response: { body, headers }, get cancelled() { return cancelled; }, get reason() { return reason; }, get reads() { return reads; } };
}

async function read(chunks, options = {}, fixtureOptions = {}) {
  const value = fixture(chunks, fixtureOptions);
  const result = await readMetadataHtml(value.response, options);
  assert.equal(value.response.body.locked, false);
  return { ...result, fixture: value };
}

function utf16(value, bigEndian = false) {
  const bytes = new Uint8Array(value.length * 2 + 2);
  bytes.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    bytes[index * 2 + 2] = bigEndian ? code >> 8 : code & 255;
    bytes[index * 2 + 3] = bigEndian ? code & 255 : code >> 8;
  }
  return bytes;
}

test('готовый head отменяет незавершённый body без ожидания 4096 байт', async () => {
  for (const contentType of ['text/html; charset=utf-8', 'text/html']) {
    const { html, warnings, fixture: value } = await read(['<head><title>Ready</title></head>'], {}, { contentType, open: true, contentLength: 50 * 1024 * 1024 });
    assert.equal(html, '<head><title>Ready</title></head>');
    assert.deepEqual(warnings, []);
    assert.equal(value.cancelled, true);
    assert.equal(value.reads, 1);
  }
});

test('title и icon после нескольких мегабайт script/style сохраняются без HTML cap', async () => {
  const { html, fixture: value } = await read([
    '<head><script>', 'x'.repeat(2 * 1024 * 1024), '</script><style>',
    'x'.repeat(2 * 1024 * 1024), '</style><title>Late title</title><link rel="icon" href="late.svg"></head>',
    'never read'
  ]);
  assert.equal(html, '<head><script></script><style></style><title>Late title</title><link rel="icon" href="late.svg"></head>');
  assert.equal(value.cancelled, true);
  assert.equal(value.reads, 5);
});

test('большой обычный head и длинный атрибут сохраняются полностью', async () => {
  const content = ' '.repeat(1024 * 1024 + 97);
  const attribute = 'data:image/svg+xml,' + 'x'.repeat(1024 * 1024 + 83);
  const source = `<head>${content}<title>After one MiB</title><link rel="icon" href="${attribute}"></head>`;
  const { html } = await read([source]);
  assert.equal(html, source);
});

test('ложные head/body в quoted attributes, comments и raw-text не заканчивают чтение', async () => {
  const misleading = [
    '<meta content="</head><body>">',
    "<meta content='</head><body>'>",
    '<!-- </head><body> -->',
    '<!-- </head><body> --!>',
    '<script>const x = "</head><body>";</script>',
    '<style>x::before{content:"</head><body>"}</style>',
    '<title>literal </head><body> title</title>',
    '<textarea>literal </head><body> textarea</textarea>',
    '<iframe>literal </head><body> iframe</iframe>',
    '<template><template></head><body></template></template>'
  ];
  for (const fragment of misleading) {
    const { html } = await read([`<head>${fragment}<title>Real</title></head>`, 'body not read']);
    assert.ok(html.endsWith('<title>Real</title></head>'), fragment);
  }
});

test('abrupt comments <!--> и <!---> не поглощают настоящий title', async () => {
  for (const comment of ['<!-->', '<!--->']) {
    const { html } = await read([`<head>${comment}<title>Real</title></head>`]);
    assert.equal(html, '<head><!-- --><title>Real</title></head>');
  }
});

test('HTML declarations заканчиваются первым > даже при незакрытой quote', async () => {
  for (const declaration of ['<!bogus ">', '<?bogus ">', '<!DOCTYPE HTML PUBLIC ">']) {
    const source = `<head>${declaration}<title>Real</title></head>`;
    const { html, fixture: value } = await read([source], {}, { open: true });
    assert.equal(html, source);
    assert.equal(value.cancelled, true);
  }
});

test('HTML nonvoid self-closing slash не закрывает script/style/title/template', async () => {
  const source = '<head><template/><body></head></template><script/>"</head>"</script><style/>"</head>"</style><title/>literal </head></title><title>Real</title></head>';
  const { html } = await read([source]);
  assert.ok(html.endsWith('<title>Real</title></head>'));
  assert.ok(html.includes('<script/></script>'));
  assert.ok(html.includes('<title/>literal </head></title>'));
});

test('script double-escaped </script> не создаёт ложный конец head', async () => {
  const source = '<head><script><!--<script></script>const x="</head>";--></script><title>Real</title></head>';
  const { html } = await read([...source]);
  assert.equal(html, '<head><script></script><title>Real</title></head>');
});

test('script double-escaped --> возвращает normal и допускает настоящий конец script', async () => {
  const source = '<head><script><!--<script>--></script><title>Real</title></head>';
  const { html } = await read([...source]);
  assert.equal(html, '<head><script></script><title>Real</title></head>');
});

test('script end tag требует разделитель после полного имени', async () => {
  const source = '<head><script></scripture>"</head>"</script foo="still > quoted"><title>Real</title></head>';
  const { html } = await read([...source]);
  assert.equal(html, '<head><script></script foo="still > quoted"><title>Real</title></head>');
});

test('любая граница chunk в tags/comments/script/template не меняет результат', async () => {
  const source = '<head><meta content="</head>"><!-- </head> --!><template><body></head></template><script><!--<script></script>"</head>";--></script><style>"</head>"</style><title>A 🐈 title</title></head><body>Ignored';
  const expected = (await read([source])).html;
  const bytes = encoder.encode(source);
  for (let split = 1; split < bytes.length; split++) {
    const { html } = await read([bytes.subarray(0, split), bytes.subarray(split)]);
    assert.equal(html, expected, `split ${split}`);
  }
});

test('UTF-8 chars и BOM восстанавливаются из отдельных байт', async () => {
  const bytes = encoder.encode('\uFEFF<head><title>Вена 🐈 café</title></head>');
  const { html } = await read([...bytes].map(value => Uint8Array.of(value)), {}, { contentType: 'text/html; charset=windows-1251' });
  assert.equal(html, '<head><title>Вена 🐈 café</title></head>');
});

test('UTF-16 BOM имеет приоритет над HTTP charset и работает при byte chunks', async () => {
  for (const bigEndian of [false, true]) {
    const bytes = utf16('<head><title>Вена 🐈</title></head>', bigEndian);
    const { html } = await read([...bytes].map(value => Uint8Array.of(value)), {}, { contentType: 'text/html; charset=utf-8' });
    assert.equal(html, '<head><title>Вена 🐈</title></head>');
  }
});

test('HTTP charset имеет приоритет над meta', async () => {
  const prefix = encoder.encode('<head><meta charset="utf-8"><title>');
  const suffix = encoder.encode('</title></head>');
  const { html } = await read([prefix, Uint8Array.of(0xc2, 0xe5, 0xed, 0xe0), suffix], {}, { contentType: 'text/html; charset="windows-1251"' });
  assert.ok(html.includes('<title>Вена</title>'));
});

test('meta charset и http-equiv восстанавливаются из chunks без HTTP charset', async () => {
  for (const meta of ['<meta charset="windows-1251">', '<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">']) {
    const chunks = [...encoder.encode(`<head>${meta}<title>`)].map(value => Uint8Array.of(value));
    chunks.push(Uint8Array.of(0xc2, 0xe5, 0xed, 0xe0), encoder.encode('</title></head>'));
    const { html } = await read(chunks, {}, { contentType: 'text/html' });
    assert.ok(html.includes('<title>Вена</title>'), meta);
  }
});

test('charset в comment/script/title/template и content без http-equiv игнорируется', async () => {
  const source = '<head><!-- <meta charset="windows-1251"> --><script>"<meta charset=windows-1251>"</script><title>literal <meta charset=windows-1251></title><template><meta charset=windows-1251></template><meta content="text/html; charset=windows-1251"><meta charset=utf-8><title>Вена</title></head>';
  const { html, warnings } = await read([...source], {}, { contentType: 'text/html' });
  assert.ok(html.includes('<title>Вена</title>'));
  assert.deepEqual(warnings, []);
});

test('неизвестный charset даёт прежнее предупреждение и UTF-8 fallback', async () => {
  const { html, warnings } = await read(['<head><title>Вена</title></head>'], {}, { contentType: 'text/html; charset=does-not-exist' });
  assert.equal(html, '<head><title>Вена</title></head>');
  assert.deepEqual(warnings, ['Сайт указал неизвестную кодировку; название прочитано как UTF-8.']);
});

test('нет explicit head — title из body/HTML fragment остаётся доступным', async () => {
  const source = '<body>' + 'x'.repeat(1024 * 1024 + 1) + '<title>Body title</title>';
  const { html } = await read([source]);
  assert.equal(html, source);
});

test('shouldStopAtHead(false) сохраняет поздний body title и вызывается один раз', async () => {
  const inspected = [];
  const head = '<head><meta name=description content=test></head>';
  const body = '<body><title>Late body title</title></head><body><meta property="og:title" content="Late">';
  const { html } = await read([head, body], { shouldStopAtHead(value) { inspected.push(value); return false; } });
  assert.deepEqual(inspected, [head]);
  assert.equal(html, head + body);
});

test('body boundary после explicit head допускает раннюю отмену без </head>', async () => {
  const { html, fixture: value } = await read(['<head><title>Early</title><body>', '<title>Ignored</title>']);
  assert.equal(html, '<head><title>Early</title><body>');
  assert.equal(value.reads, 1);
  assert.equal(value.cancelled, true);
});

test('XHTML CDATA/PI и body дочитываются до EOF без HTML pruning', async () => {
  const source = '<?xml version="1.0"?><html><head><script><![CDATA[const x="</head>";]]></script><title>XML title</title></head><body><title>Body</title></body></html>';
  const { html } = await read([...source], {}, { contentType: 'application/xhtml+xml; charset=utf-8' });
  assert.equal(html, source);
});

test('SVG/MathML включают консервативный passthrough и не теряют последующий HTML title', async () => {
  for (const foreign of ['<svg><script/></svg>', '<math><mtext><script/></mtext></math>']) {
    const source = `<head>${foreign}<title>Real</title></head><body><title>Body</title>`;
    const { html } = await read([...source]);
    assert.equal(html, source);
  }
});

test('EOF очищает pending tokens, не превращая незакрытый comment в metadata', async () => {
  const { html } = await read(['<head><title>Ready</title><!-- <title>Fake</title>']);
  assert.equal(html, '<head><title>Ready</title><!-- -->');
});

test('уже отменённый signal не читает и освобождает stream', async () => {
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  controller.abort(reason);
  const value = fixture(['<head><title>Never</title></head>']);
  await assert.rejects(readMetadataHtml(value.response, { signal: controller.signal }), error => error === reason);
  assert.equal(value.cancelled, true);
  assert.equal(value.response.body.locked, false);
  assert.equal(value.reads, 0);
});

test('отмена прерывает pending reader.read без дополнительных данных', async () => {
  const controller = new AbortController();
  let requestRead;
  const pendingRead = new Promise(resolve => { requestRead = resolve; });
  let cancelled = false;
  const body = new ReadableStream({ pull() { requestRead(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const result = readMetadataHtml({ body, headers: new Headers({ 'content-type': 'text/html' }) }, { signal: controller.signal });
  await pendingRead;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('зависший underlying cancel не задерживает готовый результат и releaseLock', async () => {
  let cancelCalled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('<head><title>Ready</title></head>')); },
    cancel() { cancelCalled = true; return new Promise(() => {}); }
  });
  const { html } = await readMetadataHtml({ body, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) });
  assert.equal(html, '<head><title>Ready</title></head>');
  assert.equal(cancelCalled, true);
  assert.equal(body.locked, false);
});

test('ошибка stream и ошибка shouldStopAtHead освобождают reader', async () => {
  const failure = new Error('Stream failed');
  const body = new ReadableStream({ pull(controller) { controller.error(failure); } });
  await assert.rejects(readMetadataHtml({ body, headers: new Headers() }), error => error === failure);
  assert.equal(body.locked, false);
  const value = fixture(['<head><title>Ready</title></head>'], { open: true });
  await assert.rejects(readMetadataHtml(value.response, { shouldStopAtHead() { throw failure; } }), error => error === failure);
  assert.equal(value.cancelled, true);
  assert.equal(value.response.body.locked, false);
});

test('отсутствующий readable body даёт явную ошибку', async () => {
  await assert.rejects(readMetadataHtml({ body: null, headers: new Headers() }), /body/);
});
