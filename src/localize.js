export const t = (message, params = {}) => globalThis.tabloI18n?.t(message, params) ?? message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
export const locale = () => globalThis.tabloI18n?.locale() || 'ru';

export function resolveLocale(preference = 'auto') {
  if (preference === 'ru' || preference === 'en') return preference;
  if (globalThis.tabloI18n) return globalThis.tabloI18n.resolve(preference);
  let language;
  try { language = globalThis.browser?.i18n?.getUILanguage(); } catch {}
  language ||= globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'en';
  return /^ru(?:-|$)/i.test(language) ? 'ru' : 'en';
}
