import { t } from './localize.js';

const ICON_SIZE = 96;
const MAX_DIMENSION = 4096;
export const MAX_RASTER_ICON_BYTES = 8 * 1024 * 1024;
export const MAX_SVG_ICON_BYTES = 256 * 1024;
const DECODE_TIMEOUT_MS = 8000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico']);
const REMOVED_SVG_ELEMENTS = new Set(['script', 'foreignobject', 'image', 'feimage', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard']);

export class IconSizeError extends Error {
  constructor(maxBytes) {
    super('icon-size');
    this.name = 'IconSizeError';
    this.maxBytes = maxBytes;
  }
}

function abortReason(signal) {
  return signal?.reason || new DOMException(t('Загрузка отменена'), 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function drawIcon(source, width, height, documentImpl) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error('image-size');
  const canvas = documentImpl.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  const scale = Math.min(ICON_SIZE / width, ICON_SIZE / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  context.drawImage(source, (ICON_SIZE - scaledWidth) / 2, (ICON_SIZE - scaledHeight) / 2, scaledWidth, scaledHeight);
  return canvas.toDataURL('image/png');
}

function decodeBitmap(blob, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, bitmap) => {
      if (settled) {
        bitmap?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(bitmap);
    };
    const abort = () => finish(abortReason(signal));
    const timeout = setTimeout(() => finish(new DOMException(t('Истекло время декодирования значка'), 'TimeoutError')), DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    Promise.resolve().then(() => {
      checkAbort(signal);
      return globalThis.createImageBitmap(blob);
    }).then(bitmap => finish(null, bitmap), error => finish(error));
  });
}

function normalizeCss(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\(?:\r\n|[\n\r\f])/g, '').replace(/\\([0-9a-f]{1,6})\s?|\\([^\n\r\f])/gi, (match, hex, character) => {
    if (!hex) return character;
    const code = Number.parseInt(hex, 16);
    return code && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
}

function localCss(value) {
  const normalized = normalizeCss(value);
  if (/@import\b|\b(?:data|blob|https?|file|ftp|javascript)\s*:/i.test(normalized)) return false;
  for (const match of normalized.matchAll(/\burl\s*\(([^)]*)\)/gi)) {
    const reference = match[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!/^#[^\s'"()<>]+$/u.test(reference)) return false;
  }
  return true;
}

function dimension(value, positive = false) {
  if (value === null || value.trim() === '' || value.trim().toLowerCase() === 'auto') return null;
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm|q|em|ex|rem|%)?$/i);
  if (!match) return null;
  const factor = { pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 }[match[2]?.toLowerCase()] || 1;
  const amount = Number(match[1]) * factor;
  if (!Number.isFinite(amount) || amount < 0 || (positive && amount === 0) || amount > MAX_DIMENSION) throw new Error('image-size');
  return ['%', 'em', 'ex', 'rem'].includes(match[2]?.toLowerCase()) ? null : amount;
}

function checkCssDimensions(value) {
  for (const match of normalizeCss(value).matchAll(/(?:^|[;{\s])(?:width|height)\s*:\s*([^;{}!]+)/gi)) dimension(match[1]);
}

function svgSource(text) {
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(text)) throw new Error('svg-entity');
  const doctypes = [...text.matchAll(/<!DOCTYPE[\s\S]*?>/gi)];
  if (doctypes.length > 1) throw new Error('svg-xml');
  if (doctypes.length) {
    const declaration = doctypes[0];
    if (!/^<!DOCTYPE\s+[A-Za-z_][\w:.-]*(?:\s+(?:SYSTEM\s+(?:"[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')))?\s*>$/u.test(declaration[0])) throw new Error('svg-xml');
    const prefix = text.slice(0, declaration.index).replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '').trim();
    if (prefix) throw new Error('svg-xml');
    text = text.slice(0, declaration.index) + text.slice(declaration.index + declaration[0].length);
  }
  return text.replace(/<\?xml-stylesheet\b[\s\S]*?\?>/gi, '');
}

function prepareSvg(bytes, documentImpl) {
  const Parser = documentImpl.defaultView?.DOMParser || globalThis.DOMParser;
  const Serializer = documentImpl.defaultView?.XMLSerializer || globalThis.XMLSerializer;
  if (!Parser || !Serializer) throw new Error('svg-parser');
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const parsed = new Parser().parseFromString(svgSource(text), 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS || parsed.getElementsByTagName('parsererror').length) throw new Error('svg-xml');
  const originalWidth = dimension(root.getAttribute('width'), true);
  const originalHeight = dimension(root.getAttribute('height'), true);
  const viewBox = root.getAttribute('viewBox');
  if (viewBox !== null) {
    const values = viewBox.trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) throw new Error('image-size');
  } else if (originalWidth && originalHeight) root.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`);
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element !== root && !root.contains(element)) continue;
    if (element !== root && (element.namespaceURI !== SVG_NS || REMOVED_SVG_ELEMENTS.has(element.localName.toLowerCase()))) {
      element.remove();
      continue;
    }
    for (const child of [...(element.childNodes || [])]) {
      if (child.nodeType === 7) child.remove();
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value;
      if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      if (name === 'width' || name === 'height') dimension(value);
      if (name === 'style') checkCssDimensions(value);
      if (name.startsWith('on') || name === 'src' || (name === 'base' && attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace') || (name === 'href' && !/^#[^\s'"()<>]+$/u.test(value.trim())) || !localCss(value)) element.removeAttributeNode(attribute);
    }
    if (element.localName === 'style') {
      checkCssDimensions(element.textContent);
      if (!localCss(element.textContent)) element.remove();
    }
  }
  root.setAttribute('width', String(ICON_SIZE));
  root.setAttribute('height', String(ICON_SIZE));
  root.style.setProperty('width', `${ICON_SIZE}px`, 'important');
  root.style.setProperty('height', `${ICON_SIZE}px`, 'important');
  return new Blob([new Serializer().serializeToString(root)], { type: 'image/svg+xml' });
}

async function rasterizeSvg(bytes, documentImpl, signal) {
  const blob = prepareSvg(bytes, documentImpl);
  checkAbort(signal);
  const urlApi = documentImpl.defaultView?.URL || globalThis.URL;
  if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL) throw new Error('image-url');
  const image = documentImpl.createElement('img');
  const url = urlApi.createObjectURL(blob);
  let timeout;
  let abort;
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('image'));
      abort = () => reject(abortReason(signal));
      timeout = setTimeout(() => reject(new DOMException(t('Истекло время декодирования значка'), 'TimeoutError')), DECODE_TIMEOUT_MS);
      signal?.addEventListener('abort', abort, { once: true });
      checkAbort(signal);
      image.src = url;
    });
    checkAbort(signal);
    return drawIcon(image, image.naturalWidth, image.naturalHeight, documentImpl);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    urlApi.revokeObjectURL(url);
  }
}

export async function rasterizeIcon(bytes, type, { documentImpl = globalThis.document, signal } = {}) {
  checkAbort(signal);
  if (!documentImpl?.createElement) throw new Error('image');
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  else if (ArrayBuffer.isView(bytes)) bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  else throw new Error('image-bytes');
  const normalizedType = String(type || '').split(';')[0].trim().toLowerCase();
  if (!bytes.byteLength) throw new Error('image-size');
  const maxBytes = normalizedType === 'image/svg+xml' ? MAX_SVG_ICON_BYTES : MAX_RASTER_ICON_BYTES;
  if (bytes.byteLength > maxBytes) throw new IconSizeError(maxBytes);
  if (normalizedType === 'image/svg+xml') return rasterizeSvg(bytes, documentImpl, signal);
  if (!RASTER_TYPES.has(normalizedType)) throw new Error('image-type');
  if (!globalThis.createImageBitmap) throw new Error('image');
  const bitmap = await decodeBitmap(new Blob([bytes], { type: normalizedType }), signal);
  try {
    checkAbort(signal);
    return drawIcon(bitmap, bitmap.width, bitmap.height, documentImpl);
  } finally {
    bitmap.close();
  }
}
