import { normalizeUrl } from './model.js';
import { rasterizeIcon, MAX_RASTER_ICON_BYTES, MAX_SVG_ICON_BYTES, IconSizeError } from './icon-raster.js';
import { fetchWithRedirects } from './redirect-fetch.js';
import { readMetadataHtml } from './html-metadata-stream.js';
import { t } from './localize.js';

const MAX_PNG_BYTES = 64 * 1024;
const TIMEOUT_MS = 8000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', 'image/svg+xml']);

export function sitePermissionOrigin(url) {
  const parsed = new URL(normalizeUrl(url));
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function requestSiteAccess(url, browserApi = globalThis.browser) {
  try {
    if (!browserApi?.permissions?.request) return Promise.resolve(false);
    return Promise.resolve(browserApi.permissions.request({ origins: [sitePermissionOrigin(url)], permissions: ['webRequest'], data_collection: ['browsingActivity'] }));
  } catch (error) {
    return Promise.reject(error);
  }
}

function cleanTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim();
  return title ? title.slice(0, 80).replace(/[\uD800-\uDBFF]$/, '') : null;
}

function parseHtml(html) {
  const document = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
  for (const fallback of document.querySelectorAll('noscript')) fallback.remove();
  return document;
}

function iconScore(element) {
  const sizes = (element.getAttribute('sizes') || '').toLowerCase();
  const dimensions = [...sizes.matchAll(/(?:^|\s)(\d+)x(\d+)(?=\s|$)/g)]
    .map(match => Math.min(Number(match[1]), Number(match[2])));
  const size = Math.max(0, ...dimensions);
  const kind = (element.getAttribute('rel') || '').toLowerCase().includes('apple-touch-icon') ? 1 : 0;
  return (sizes.split(/\s+/).includes('any') ? 10512 : size >= 64 ? 10000 : 0) + Math.min(size, 512) + kind;
}

export function parseMetadataDocument(document, pageUrl) {
  const url = normalizeUrl(pageUrl);
  let base = url;
  try {
    const declaredBase = document.querySelector('base[href]')?.getAttribute('href');
    if (declaredBase) base = normalizeUrl(new URL(declaredBase, url).href);
  } catch {}
  const title = cleanTitle(document.querySelector('title')?.textContent)
    || cleanTitle(document.querySelector('meta[property="og:title"]')?.getAttribute('content'));
  const candidates = [...document.querySelectorAll('link[rel][href]')]
    .filter(element => (element.getAttribute('rel') || '').toLowerCase().split(/\s+/).some(rel => rel === 'icon' || rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed'))
    .sort((first, second) => iconScore(second) - iconScore(first))
    .flatMap(element => {
      try {
        const href = element.getAttribute('href');
        if (isInlineSvg(href) && href.length <= MAX_SVG_ICON_BYTES * 3 + 200) return [href];
        const candidate = new URL(href, base);
        if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password) return [];
        return [candidate.href];
      } catch {
        return [];
      }
    });
  candidates.push(new URL('/favicon.ico', url).href);
  return { title, candidates: [...new Set(candidates)] };
}

async function readLimited(response, limit, signal) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel();
    throw new IconSizeError(limit);
  }
  if (!response.body?.getReader) throw new Error('body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new IconSizeError(limit);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isInlineSvg(value) {
  return typeof value === 'string' && /^data:image\/svg\+xml(?:;charset=[a-z0-9_-]+)?(?:;base64)?,/i.test(value);
}

function inlineSvgBytes(value) {
  const comma = value.indexOf(',');
  const header = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  const bytes = /;base64$/i.test(header)
    ? Uint8Array.from(atob(payload), character => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  if (bytes.byteLength > MAX_SVG_ICON_BYTES) throw new IconSizeError(MAX_SVG_ICON_BYTES);
  return bytes;
}

function validPng(value) {
  if (typeof value !== 'string' || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  return (value.length - value.indexOf(',') - 1) * 3 / 4 <= MAX_PNG_BYTES;
}

export async function fetchSiteMetadata(input, {
  signal,
  fetchImpl = globalThis.fetch,
  browserApi = globalThis.browser,
  documentImpl = globalThis.document,
  parseDocument = parseHtml,
  rasterize = (bytes, type, options) => rasterizeIcon(bytes, type, { documentImpl, ...options })
} = {}) {
  const url = normalizeUrl(input);
  const result = { url, title: null, favicon: null, warnings: [], requiredOrigins: [] };
  if (!browserApi?.permissions?.contains || !await browserApi.permissions.contains({ origins: [sitePermissionOrigin(url)], permissions: ['webRequest'], data_collection: ['browsingActivity'] })) {
    result.warnings.push(t('Нет разрешения на чтение этого сайта. Название и значок можно задать вручную.'));
    return result;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException(t('Истекло время ожидания'), 'TimeoutError')), TIMEOUT_MS);
  const options = { signal: controller.signal, fetchImpl, browserApi };
  const pageRequired = new Set();
  const iconRequired = new Set();
  const oversizedIcons = new Set();
  let pageUrl = url;
  let candidates = [new URL('/favicon.ico', url).href];
  try {
    try {
      controller.signal.throwIfAborted();
      const fetched = await fetchWithRedirects(url, options);
      const response = fetched.response;
      pageUrl = fetched.url;
      if (pageUrl !== url) result.resolvedUrl = pageUrl;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`http-${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/^text\/html(?:\s*;|$)|^application\/xhtml\+xml(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw new Error('html-type');
      }
      const { html, warnings } = await readMetadataHtml(response, {
        signal: controller.signal,
        shouldStopAtHead: value => !!parseMetadataDocument(parseDocument(value), pageUrl).title
      });
      result.warnings.push(...warnings);
      const parsed = parseMetadataDocument(parseDocument(html), pageUrl);
      result.title = parsed.title;
      candidates = parsed.candidates;
      if (!result.title) result.warnings.push(t('Сайт не указал название страницы.'));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (error.requiredOrigins?.length) {
        error.requiredOrigins.forEach(origin => pageRequired.add(origin));
        result.pendingPage = true;
        result.warnings.push(t('Сайт перенаправляет на {hostname}. Для продолжения нужен доступ к этому адресу.', { hostname: new URL(error.targetUrl).hostname }));
      } else if (error.message === 'html-type') result.warnings.push(t('По этому адресу получена не HTML-страница; название не прочитано.'));
      else if (/^http-\d+$/.test(error.message)) result.warnings.push(t('Сайт вернул HTTP {status}; название не прочитано.', { status: error.message.slice(5) }));
      else if (error.name === 'RedirectError') result.warnings.push(error.message);
      else result.warnings.push(t('Не удалось прочитать страницу. Проверьте адрес и повторите загрузку.'));
    }
    const authorized = [];
    for (const candidate of candidates) {
      controller.signal.throwIfAborted();
      if (isInlineSvg(candidate) || await browserApi.permissions.contains({ origins: [sitePermissionOrigin(candidate)], data_collection: ['browsingActivity'] })) {
        authorized.push(candidate);
      } else {
        const origin = sitePermissionOrigin(candidate);
        if (iconRequired.size < 3) iconRequired.add(origin);
      }
      if (authorized.length === 3) break;
    }
    const fallback = new URL('/favicon.ico', pageUrl).href;
    if (!authorized.includes(fallback)) {
      if (authorized.length === 3) authorized.pop();
      authorized.push(fallback);
    }
    for (const candidate of authorized) {
      controller.signal.throwIfAborted();
      try {
        let bytes;
        let type;
        if (isInlineSvg(candidate)) {
          bytes = inlineSvgBytes(candidate);
          type = 'image/svg+xml';
        } else {
          const { response } = await fetchWithRedirects(candidate, options);
          if (!response.ok) {
            await response.body?.cancel();
            continue;
          }
          type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!IMAGE_TYPES.has(type)) {
            await response.body?.cancel();
            continue;
          }
          bytes = await readLimited(response, type === 'image/svg+xml' ? MAX_SVG_ICON_BYTES : MAX_RASTER_ICON_BYTES, controller.signal);
        }
        const png = await rasterize(bytes, type, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (validPng(png)) {
          result.favicon = png;
          break;
        }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof IconSizeError) oversizedIcons.add(error.maxBytes);
        error.requiredOrigins?.forEach(origin => iconRequired.add(origin));
      }
    }
    if (!result.favicon) {
      for (const maxBytes of oversizedIcons) result.warnings.push(t(maxBytes === MAX_SVG_ICON_BYTES ? 'SVG-значок превышает лимит 256 КиБ.' : 'Файл значка превышает лимит 8 МиБ.'));
      if (iconRequired.size) result.warnings.push(t('Значок сайта расположен на другом домене; для загрузки требуется дополнительное разрешение.'));
      else if (!oversizedIcons.size) result.warnings.push(t('Значок сайта недоступен; останется буквенное обозначение.'));
    }
  } catch (error) {
    if (controller.signal.reason?.name === 'TimeoutError') result.warnings.push(t('Сайт не ответил за 8 секунд. Можно сохранить плитку и повторить загрузку позже.'));
    else if (signal?.aborted) throw signal.reason || new DOMException(t('Загрузка отменена'), 'AbortError');
    else throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
  result.requiredOrigins = [...new Set([...pageRequired, ...(result.favicon ? [] : iconRequired)])].slice(0, 10);
  return result;
}
