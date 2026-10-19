import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import '../src/search-engines.js';

const providers = globalThis.tabloSearchEngines;

test('все шесть поисковиков открывают корректный адрес и сохраняют Unicode и специальные символы запроса', () => {
  const query = 'Вена 🌦 + folders & q=other # icons?';
  const expected = {
    google: ['www.google.com', '/search', 'q'],
    yandex: ['yandex.ru', '/search/', 'text'],
    bing: ['www.bing.com', '/search', 'q'],
    duckduckgo: ['duckduckgo.com', '/', 'q'],
    brave: ['search.brave.com', '/search', 'q'],
    ecosia: ['www.ecosia.org', '/search', 'q']
  };
  assert.equal(providers.items.length, 6);
  for (const [id, [hostname, path, parameter]] of Object.entries(expected)) {
    const target = new URL(providers.url(id, query));
    assert.equal(target.protocol, 'https:');
    assert.equal(target.hostname, hostname);
    assert.equal(target.pathname, path);
    assert.equal(target.searchParams.get(parameter), query);
    assert.equal(target.hash, '');
    assert.equal([...target.searchParams].length, 1);
  }
  assert.throws(() => providers.url('unknown', query));
});

test('значки поисковиков встроены в расширение и не требуют сторонних запросов', () => {
  for (const provider of providers.items) {
    assert.ok(provider.icon.startsWith('assets/'));
    assert.ok(existsSync(new URL(`../src/${provider.icon}`, import.meta.url)), provider.icon);
  }
});
