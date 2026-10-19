import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { createDefaultState, allSites } from '../src/model.js';

const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../src/site-icons.js', import.meta.url), 'utf8'), context);
const get = site => context.tabloSiteIcons.get(site);
const site = url => ({ url, icon: 'auto', favicon: null });

test('все стандартные сайты RU и EN имеют встроенный значок, включая содержимое папок', () => {
  for (const language of ['ru', 'en']) for (const item of allSites(createDefaultState(language))) {
    const path = get(item);
    assert.ok(path?.startsWith('assets/'), item.url);
    assert.ok(existsSync(new URL(`../src/${path}`, import.meta.url)), path);
  }
});

test('пользовательский favicon и ручной значок имеют приоритет перед встроенным', () => {
  const value = site('https://github.com/');
  assert.ok(get(value));
  assert.equal(get({ ...value, favicon: 'data:image/png;base64,aGVsbG8=' }), null);
  assert.equal(get({ ...value, icon: 'G' }), null);
});

test('встроенные значки не используют сеть и не совпадают с поддельными доменами', () => {
  for (const url of ['https://github.com.evil.example/', 'https://notgithub.com/', 'https://example.com/github.com', 'https://github.com@evil.example/', 'https://user:pass@github.com/', 'ftp://github.com/', 'javascript:alert(1)', 'invalid']) assert.equal(get(site(url)), null, url);
  assert.equal(get(null), null);
  assert.equal(get(site('https://mail.google.com/')), 'assets/sites/gmail.svg');
  assert.equal(get(site('https://www.google.com/')), 'assets/google.svg');
  assert.equal(get(site('https://en.wikipedia.org/wiki/Main_Page')), 'assets/sites/wikipedia.svg');
});
