import { normalizeUrl } from './model.js';
import { t } from './localize.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEADER_WAIT_MS = 8000;
let requestQueue = Promise.resolve();

function safeUrl(input) {
  const parsed = new URL(normalizeUrl(input));
  parsed.hash = '';
  return parsed.href;
}

function permissionPattern(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

function abortReason(signal) {
  return signal.reason ?? new DOMException(t('Запрос отменён.'), 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function waitForTurn(previous, signal) {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    previous.then(() => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(abortReason(signal));
      else resolve();
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

async function cancelBody(response) {
  try { await response?.body?.cancel(); } catch {}
}

export class RedirectAccessError extends Error {
  constructor(targetUrl) {
    const url = safeUrl(targetUrl);
    super(t('Для чтения сайта {hostname} требуется разрешение Firefox.', { hostname: new URL(url).hostname }));
    this.name = 'RedirectAccessError';
    this.targetUrl = url;
    this.requiredOrigins = [permissionPattern(url)];
  }
}

export class RedirectError extends Error {
  constructor(message) {
    super(t(message));
    this.name = 'RedirectError';
  }
}

async function requireAccess(url, browserApi, signal) {
  throwIfAborted(signal);
  const allowed = browserApi?.permissions?.contains
    && await browserApi.permissions.contains({ origins: [permissionPattern(url)], data_collection: ['browsingActivity'] });
  throwIfAborted(signal);
  if (!allowed) throw new RedirectAccessError(url);
}

function observeHeaders(url, browserApi, documentUrl, tabId) {
  const event = browserApi?.webRequest?.onHeadersReceived;
  let documentAddress;
  try {
    const parsed = new URL(documentUrl);
    if (parsed.protocol === 'moz-extension:') {
      parsed.hash = '';
      documentAddress = parsed.href;
    }
  } catch {}
  if (!event?.addListener || !event?.removeListener || !documentAddress || !Number.isInteger(tabId) || tabId < 0) {
    return { get: () => null, wait: async () => null, close() {} };
  }
  const extensionRoot = browserApi.runtime?.getURL?.('');
  if (extensionRoot && !documentAddress.startsWith(extensionRoot)) return { get: () => null, wait: async () => null, close() {} };
  let observed = null;
  let requestId;
  let waiter;
  const finish = (value, error) => {
    if (!waiter) return;
    const pending = waiter;
    waiter = null;
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error);
    else pending.resolve(value);
  };
  const observer = details => {
    if (details.url !== url || details.tabId !== tabId || details.type !== 'xmlhttprequest'
      || details.originUrl !== documentAddress || details.documentUrl !== documentAddress) return;
    if (requestId !== undefined && details.requestId !== requestId) return;
    requestId = details.requestId;
    observed = {
      status: details.statusCode,
      location: details.responseHeaders?.find(header => header.name.toLowerCase() === 'location')?.value
    };
    finish(observed);
  };
  event.addListener(observer, { urls: [permissionPattern(url)], types: ['xmlhttprequest'], tabId }, ['responseHeaders']);
  return {
    get: () => observed,
    wait(signal) {
      if (observed) return Promise.resolve(observed);
      if (signal?.aborted) return Promise.reject(abortReason(signal));
      return new Promise((resolve, reject) => {
        const abort = () => finish(null, abortReason(signal));
        waiter = { resolve, reject, signal, abort, timer: setTimeout(() => finish(null), HEADER_WAIT_MS) };
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    close() {
      event.removeListener(observer);
      finish(null);
    }
  };
}

async function performRedirectFetch(input, { browserApi, fetchImpl, signal, documentUrl, maxRedirects }) {
  let url = safeUrl(input);
  const visited = new Set([url]);
  let redirects = 0;
  let tabId;
  throwIfAborted(signal);
  if (browserApi?.tabs?.getCurrent) tabId = (await browserApi.tabs.getCurrent())?.id;
  throwIfAborted(signal);
  for (;;) {
    await requireAccess(url, browserApi, signal);
    const observer = observeHeaders(url, browserApi, documentUrl, tabId);
    let response;
    try {
      throwIfAborted(signal);
      response = await fetchImpl(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', cache: 'no-store' });
      throwIfAborted(signal);
      const opaqueRedirect = response.type === 'opaqueredirect';
      const headers = opaqueRedirect ? await observer.wait(signal) : observer.get();
      throwIfAborted(signal);
      const status = opaqueRedirect ? headers?.status : response.status;
      if (opaqueRedirect && !REDIRECT_STATUSES.has(status)) {
        throw new RedirectError('Firefox не предоставил заголовки перенаправления. Разрешите расширению получать заголовки сайтов и повторите попытку.');
      }
      if (!REDIRECT_STATUSES.has(status)) {
        const finalUrl = response.url ? safeUrl(response.url) : url;
        if (finalUrl !== url) await requireAccess(finalUrl, browserApi, signal);
        return { response, url: finalUrl, redirects };
      }
      await cancelBody(response);
      const location = response.headers.get('location') || headers?.location;
      if (typeof location !== 'string' || !location.trim()) throw new RedirectError('Сайт вернул перенаправление без адреса назначения.');
      if (/[\s\u0000-\u001f\u007f\\]/u.test(location)) throw new RedirectError('Сайт указал недопустимый адрес перенаправления.');
      let targetUrl;
      try { targetUrl = safeUrl(new URL(location, url).href); }
      catch { throw new RedirectError('Сайт указал недопустимый адрес перенаправления. Разрешены HTTP и HTTPS без логина и пароля.'); }
      if (visited.has(targetUrl)) throw new RedirectError('Сайт зациклил перенаправления.');
      if (redirects >= maxRedirects) throw new RedirectError(t('Превышен лимит перенаправлений: {limit}.', { limit: maxRedirects }));
      visited.add(targetUrl);
      redirects += 1;
      url = targetUrl;
    } catch (error) {
      await cancelBody(response);
      throw error;
    } finally {
      observer.close();
    }
  }
}

export function fetchWithRedirects(input, {
  browserApi = globalThis.browser,
  fetchImpl = globalThis.fetch,
  signal,
  documentUrl = globalThis.location?.href,
  maxRedirects = 10
} = {}) {
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    return Promise.reject(new RangeError(t('Лимит перенаправлений должен быть целым числом от 0 до 10.')));
  }
  const previous = requestQueue;
  let release;
  const current = new Promise(resolve => { release = resolve; });
  requestQueue = previous.then(() => current);
  return waitForTurn(previous, signal)
    .then(() => performRedirectFetch(input, { browserApi, fetchImpl, signal, documentUrl, maxRedirects }))
    .finally(release);
}
