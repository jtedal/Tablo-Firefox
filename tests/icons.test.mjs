import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../src/icons.js';

const icons = globalThis.tabloIcons;
const namespace = 'http://www.w3.org/2000/svg';

function createDocument() {
  class Node {
    constructor(localName, namespaceURI) {
      this.localName = localName;
      this.namespaceURI = namespaceURI;
      this.attributes = {};
      this.children = [];
    }
    set innerHTML(value) { throw new Error(`HTML sink used: ${value}`); }
    set outerHTML(value) { throw new Error(`HTML sink used: ${value}`); }
    insertAdjacentHTML() { throw new Error('HTML sink used'); }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
  }
  return {
    createElement: name => new Node(name, 'http://www.w3.org/1999/xhtml'),
    createElementNS: (namespaceURI, name) => new Node(name, namespaceURI)
  };
}

test('shared icons produce the existing accessible wrapper and SVG namespace without HTML parsing', () => {
  const document = createDocument();
  const span = icons.create('search', document);
  assert.equal(span.localName, 'span');
  assert.equal(span.namespaceURI, 'http://www.w3.org/1999/xhtml');
  assert.equal(span.children.length, 1);
  const svg = span.children[0];
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, namespace);
  assert.deepEqual(svg.attributes, { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  assert.deepEqual(svg.children.map(node => node.localName), ['circle', 'path']);
  assert.deepEqual(svg.children[0].attributes, { cx: '10.5', cy: '10.5', r: '6.5' });
  assert.ok(svg.children.every(node => node.namespaceURI === namespace));
});

test('all interface and weather icons contain only the approved SVG shapes and geometry attributes', () => {
  const names = ['settings', 'search', 'arrow-right', 'plus', 'edit', 'more', 'close', 'image', 'folder', 'grid', 'trash', 'external', 'move', 'home', 'download', 'upload', 'check', 'location', 'chevron-right', 'refresh', 'sun', 'moon', 'cloud', 'cloud-sun', 'fog', 'rain', 'snow', 'storm'];
  const allowed = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx'] };
  const signatures = new Set();
  for (const name of names) {
    const svg = icons.create(name, createDocument()).children[0];
    assert.ok(svg.children.length > 0, name);
    for (const node of svg.children) {
      assert.equal(node.namespaceURI, namespace, name);
      assert.ok(Object.hasOwn(allowed, node.localName), name);
      assert.deepEqual(Object.keys(node.attributes).sort(), [...allowed[node.localName]].sort(), name);
      assert.ok(Object.values(node.attributes).every(value => typeof value === 'string' && value.length > 0), name);
      assert.deepEqual(node.children, [], name);
    }
    signatures.add(JSON.stringify(svg));
  }
  assert.equal(signatures.size, names.length);
});

test('each icon has independent DOM nodes and mutations do not alter later icons', () => {
  const document = createDocument();
  const first = icons.create('sun', document);
  const second = icons.create('sun', document);
  assert.notEqual(first, second);
  assert.notEqual(first.children[0], second.children[0]);
  assert.notEqual(first.children[0].children[0], second.children[0].children[0]);
  first.children[0].children[0].setAttribute('r', '99');
  assert.equal(second.children[0].children[0].attributes.r, '4');
  assert.equal(icons.create('sun', document).children[0].children[0].attributes.r, '4');
});

test('unknown names, prototype keys and hostile values produce a fixed grid without interpreting input', () => {
  const document = createDocument();
  const expected = icons.create('grid', document);
  const hostile = { toString() { throw new Error('Input was coerced'); } };
  for (const name of ['unknown', '__proto__', 'constructor', 'toString', '<script>alert(1)</script>', 'sun" onload="alert(1)', '', null, undefined, 1, hostile]) {
    assert.deepEqual(icons.create(name, document), expected);
  }
});

test('classic preload and module loading share an immutable helper without requiring a DOM during initialization', () => {
  const context = vm.createContext({});
  const source = readFileSync(new URL('../src/icons.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const original = context.tabloIcons;
  assert.ok(Object.isFrozen(original));
  assert.deepEqual(Object.keys(original), ['create']);
  vm.runInContext(source, context);
  assert.equal(context.tabloIcons, original);
  assert.deepEqual(Reflect.ownKeys(icons), ['create']);
});
