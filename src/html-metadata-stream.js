import { t } from './localize.js';

const SNIFF_BYTES = 4096;
const RAW_ELEMENTS = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);
const SPACE = /[\t\n\f\r ]/;

function attributes(tag) {
  const values = new Map();
  const start = /^<\/?[^\t\n\f\r />]+/.exec(tag)?.[0].length || 0;
  const pattern = /([^\t\n\f\r />=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/g;
  pattern.lastIndex = start;
  for (let match; (match = pattern.exec(tag));) {
    const name = match[1].toLowerCase();
    if (!values.has(name)) values.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return values;
}

class HtmlHeadCollector {
  constructor({ shouldStopAtHead = () => true, onTag } = {}) {
    this.shouldStopAtHead = shouldStopAtHead;
    this.onTag = onTag;
    this.parts = [];
    this.segment = '';
    this.mode = 'data';
    this.token = '';
    this.quote = null;
    this.rawName = null;
    this.rawPending = '';
    this.scriptState = 'normal';
    this.scriptTail = '';
    this.commentTail = '';
    this.commentLength = 0;
    this.templateDepth = 0;
    this.seenHead = false;
    this.boundaryRejected = false;
    this.done = false;
  }

  emit(value) {
    this.segment += value;
  }

  source() {
    return this.parts.join('') + this.segment;
  }

  completeTag() {
    const tag = this.token;
    const match = /^<(\/?)(([a-z][^\t\n\f\r />]*))/i.exec(tag);
    this.token = '';
    this.quote = null;
    this.mode = 'data';
    this.emit(tag);
    if (!match) return;
    const closing = !!match[1];
    const name = match[2].toLowerCase();
    this.onTag?.(tag, name, closing, this.templateDepth);
    if (!closing && (name === 'svg' || name === 'math')) {
      this.mode = 'passthrough';
      this.boundaryRejected = true;
      return;
    }
    if (name === 'template') {
      this.templateDepth = Math.max(0, this.templateDepth + (closing ? -1 : 1));
    } else if (!this.templateDepth) {
      if (name === 'head' && !closing) this.seenHead = true;
      if (this.seenHead && !this.boundaryRejected && (name === 'head' && closing || name === 'body' && !closing)) {
        if (this.shouldStopAtHead(this.source())) this.done = true;
        else this.boundaryRejected = true;
      }
    }
    if (!closing && RAW_ELEMENTS.has(name)) {
      this.mode = 'raw';
      this.rawName = name;
      this.rawPending = '';
      this.scriptState = 'normal';
      this.scriptTail = '';
    }
  }

  rawText(value) {
    if (this.rawName !== 'script' && this.rawName !== 'style') this.emit(value);
    if (this.rawName === 'script') {
      for (const character of value) {
        this.scriptTail = (this.scriptTail + character).slice(-3);
        if (this.scriptState !== 'normal' && this.scriptTail === '-->') this.scriptState = 'normal';
      }
    }
  }

  rawCharacter(character) {
    if (!this.rawPending) {
      if (character === '<') this.rawPending = '<';
      else this.rawText(character);
      return;
    }
    this.rawPending += character;
    const value = this.rawPending.toLowerCase();
    const closing = `</${this.rawName}`;
    const script = this.rawName === 'script';
    const patterns = [closing];
    if (script && this.scriptState === 'normal') patterns.push('<!--');
    if (script && this.scriptState === 'escaped') patterns.push('<script');
    if (script && value === '<!--' && this.scriptState === 'normal') {
      this.scriptState = 'escaped';
      this.scriptTail = '';
      this.rawPending = '';
      return;
    }
    const delimiter = SPACE.test(character) || character === '/' || character === '>';
    if (delimiter && value.slice(0, -1) === closing) {
      if (script && this.scriptState === 'double') {
        this.scriptState = 'escaped';
        this.scriptTail = '';
        this.rawPending = '';
      } else {
        this.token = this.rawPending;
        this.rawPending = '';
        this.rawName = null;
        this.mode = 'tag';
        if (character === '>') this.completeTag();
      }
      return;
    }
    if (script && this.scriptState === 'escaped' && delimiter && value.slice(0, -1) === '<script') {
      this.scriptState = 'double';
      this.scriptTail = '';
      this.rawPending = '';
      return;
    }
    if (patterns.some(pattern => pattern.startsWith(value) || pattern === value)) return;
    const pending = this.rawPending;
    this.rawPending = '';
    if (character === '<') {
      this.rawText(pending.slice(0, -1));
      this.rawPending = '<';
    } else this.rawText(pending);
  }

  feed(text) {
    let index = 0;
    while (index < text.length && !this.done) {
      if (this.mode === 'passthrough') {
        this.emit(text.slice(index));
        break;
      }
      if (this.mode === 'data') {
        const opening = text.indexOf('<', index);
        if (opening < 0) {
          this.emit(text.slice(index));
          break;
        }
        this.emit(text.slice(index, opening));
        this.token = '<';
        this.mode = 'open';
        index = opening + 1;
        continue;
      }
      if (this.mode === 'raw' && !this.rawPending && (this.rawName !== 'script' || this.scriptState === 'normal')) {
        const opening = text.indexOf('<', index);
        const end = opening < 0 ? text.length : opening;
        if (this.rawName !== 'script' && this.rawName !== 'style') this.emit(text.slice(index, end));
        if (opening < 0) break;
        this.rawPending = '<';
        index = opening + 1;
        continue;
      }
      const character = text[index++];
      if (this.mode === 'raw') {
        this.rawCharacter(character);
      } else if (this.mode === 'open') {
        if (character === '!') {
          this.token += character;
          this.mode = 'declaration-open';
        } else if (character === '?') {
          this.token += character;
          this.mode = 'declaration';
        } else if (/[a-z/]/i.test(character)) {
          this.token += character;
          this.mode = 'tag';
        } else {
          this.emit(this.token);
          this.token = '';
          this.mode = 'data';
          index--;
        }
      } else if (this.mode === 'declaration-open') {
        this.token += character;
        if (this.token === '<!--') {
          this.mode = 'comment';
          this.token = '';
          this.commentLength = 0;
          this.commentTail = '';
        } else if (this.token === '<![CDATA[') {
          this.mode = 'cdata';
          this.boundaryRejected = true;
          this.emit(this.token);
          this.token = '';
          this.commentTail = '';
        } else if (!'<!--'.startsWith(this.token) && !'<![CDATA['.startsWith(this.token)) {
          this.mode = 'declaration';
          if (character === '>') {
            this.emit(this.token);
            this.token = '';
            this.mode = 'data';
          }
        }
      } else if (this.mode === 'comment') {
        this.commentLength++;
        this.commentTail = (this.commentTail + character).slice(-4);
        if (this.commentTail.endsWith('-->') || this.commentTail.endsWith('--!>') || this.commentLength === 1 && character === '>' || this.commentLength === 2 && this.commentTail === '->') {
          this.emit('<!-- -->');
          this.mode = 'data';
        }
      } else if (this.mode === 'cdata') {
        this.emit(character);
        this.commentTail = (this.commentTail + character).slice(-3);
        if (this.commentTail === ']]>') this.mode = 'data';
      } else {
        this.token += character;
        if (this.mode === 'declaration' && character === '>') {
          this.emit(this.token);
          this.token = '';
          this.mode = 'data';
        } else if (this.mode === 'tag' && this.quote) {
          if (character === this.quote) this.quote = null;
        } else if (this.mode === 'tag' && (character === '"' || character === "'")) this.quote = character;
        else if (character === '>') {
          if (this.mode === 'tag') this.completeTag();
          else {
            this.emit(this.token);
            this.token = '';
            this.mode = 'data';
          }
        }
      }
    }
    if (this.segment) {
      this.parts.push(this.segment);
      this.segment = '';
    }
  }

  finish() {
    if (this.mode === 'raw') this.rawText(this.rawPending);
    else if (this.mode === 'comment') this.emit('<!-- -->');
    else this.emit(this.token);
    return this.source();
  }
}

function bomCharset(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

export async function readMetadataHtml(response, { signal, shouldStopAtHead = () => true } = {}) {
  if (!response.body?.getReader) throw new Error('body');
  const reader = response.body.getReader();
  const warnings = [];
  const contentType = response.headers.get('content-type') || '';
  const httpCharset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  const isXml = /^application\/xhtml\+xml(?:\s*;|$)/i.test(contentType);
  const collector = isXml ? null : new HtmlHeadCollector({ shouldStopAtHead });
  const xmlParts = [];
  let metaCharset;
  const probe = new HtmlHeadCollector({ onTag(tag, name, closing, templateDepth) {
    if (metaCharset || name !== 'meta' || closing || templateDepth) return;
    const values = attributes(tag);
    metaCharset = values.get('charset') || ((values.get('http-equiv') || '').toLowerCase() === 'content-type'
      ? values.get('content')?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] : undefined);
  } });
  const prefixParts = [];
  const buffered = [];
  let prefixLength = 0;
  const firstBytes = [];
  let decoder;
  let cancelPromise;
  const cancel = () => {
    if (!cancelPromise) {
      try {
        cancelPromise = Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
      } catch {
        cancelPromise = Promise.resolve();
      }
    }
    return cancelPromise;
  };
  const abort = () => { void cancel(); };
  const check = () => signal?.throwIfAborted();
  const append = value => {
    if (collector) collector.feed(value);
    else xmlParts.push(value);
  };
  const startDecoder = () => {
    const prefix = new Uint8Array(prefixLength);
    let offset = 0;
    for (const value of prefixParts) {
      prefix.set(value, offset);
      offset += value.byteLength;
    }
    const charset = bomCharset(prefix) || httpCharset || metaCharset || 'utf-8';
    try {
      decoder = new TextDecoder(charset);
    } catch {
      warnings.push(t('Сайт указал неизвестную кодировку; название прочитано как UTF-8.'));
      decoder = new TextDecoder();
    }
    for (const value of buffered) {
      append(decoder.decode(value, { stream: true }));
      if (collector?.done) break;
    }
    buffered.length = 0;
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      check();
      const { done, value } = await reader.read();
      check();
      if (done) {
        if (!decoder) startDecoder();
        if (!collector?.done) append(decoder.decode());
        break;
      }
      if (!decoder) {
        buffered.push(value);
        const prefix = value.slice(0, SNIFF_BYTES - prefixLength);
        prefixParts.push(prefix);
        prefixLength += prefix.byteLength;
        for (let index = 0; index < prefix.byteLength && firstBytes.length < 3; index++) firstBytes.push(prefix[index]);
        probe.feed(new TextDecoder('windows-1252').decode(prefix));
        if (prefixLength >= 3 && (bomCharset(firstBytes) || httpCharset || metaCharset || probe.done || prefixLength === SNIFF_BYTES)) startDecoder();
      } else append(decoder.decode(value, { stream: true }));
      if (collector?.done) break;
    }
    check();
    return { html: collector ? collector.finish() : xmlParts.join(''), warnings };
  } finally {
    signal?.removeEventListener('abort', abort);
    void cancel();
    reader.releaseLock();
  }
}
