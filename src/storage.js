import { createDefaultState, validateState } from './model.js';
import { t } from './localize.js';

const STORAGE_KEY = 'tabloState';

export function createRepository(browserApi = globalThis.browser) {
  const extensionStorage = browserApi?.storage?.local;
  const callbacks = new Set();
  const ownStates = [];
  let queue = Promise.resolve();
  let disposed = false;
  let knownRevision = 0;
  let previewStorage;
  if (!extensionStorage) {
    try {
      previewStorage = globalThis.localStorage;
    } catch {
      previewStorage = null;
    }
  }

  function ensureActive() {
    if (disposed) throw new Error(t('Хранилище уже закрыто.'));
  }

  async function readRaw() {
    if (extensionStorage) {
      const result = await extensionStorage.get(STORAGE_KEY);
      return result[STORAGE_KEY];
    }
    if (!previewStorage) throw new Error(t('Локальное хранилище недоступно.'));
    return previewStorage.getItem(STORAGE_KEY);
  }

  async function read() {
    const raw = await readRaw();
    if (extensionStorage) return raw;
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(t('Сохранённые данные повреждены: JSON не читается.'));
    }
  }

  async function write(state) {
    if (extensionStorage) return extensionStorage.set({ [STORAGE_KEY]: state });
    if (!previewStorage) throw new Error(t('Локальное хранилище недоступно.'));
    previewStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function fingerprint(state) {
    return {
      data: JSON.stringify({ ...state, settings: { ...state.settings, customBackground: null } }),
      background: state.settings.customBackground
    };
  }

  async function persist(state) {
    const ownState = fingerprint(state);
    ownStates.push(ownState);
    if (ownStates.length > 20) ownStates.shift();
    try {
      await write(state);
    } catch (error) {
      const index = ownStates.indexOf(ownState);
      if (index !== -1) ownStates.splice(index, 1);
      throw error;
    }
    knownRevision = Math.max(knownRevision, state.revision);
    return validateState(state);
  }

  function receive(value) {
    if (disposed || value === undefined) return;
    let state;
    try {
      state = validateState(value);
    } catch {
      return;
    }
    knownRevision = Math.max(knownRevision, state.revision);
    const incoming = fingerprint(state);
    if (ownStates.some(ownState => ownState.data === incoming.data && ownState.background === incoming.background)) return;
    for (const callback of callbacks) {
      try {
        callback(validateState(state));
      } catch (error) {
        console.error('Tablo: обработчик обновления хранилища завершился с ошибкой.', error);
      }
    }
  }

  function extensionChanged(changes, areaName) {
    if (areaName === 'local' && Object.hasOwn(changes, STORAGE_KEY)) receive(changes[STORAGE_KEY].newValue);
  }

  function previewChanged(event) {
    if (event.key !== STORAGE_KEY || event.newValue === null || (event.storageArea && event.storageArea !== previewStorage)) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      return;
    }
  }

  if (extensionStorage) browserApi.storage.onChanged?.addListener(extensionChanged);
  else globalThis.addEventListener?.('storage', previewChanged);

  return {
    async load() {
      ensureActive();
      const operation = queue.then(async () => {
        ensureActive();
        const value = await read();
        if (value === undefined) return persist(createDefaultState());
        const state = validateState(value);
        knownRevision = Math.max(knownRevision, state.revision);
        return state;
      });
      queue = operation.catch(() => {});
      return operation;
    },

    async readRaw() {
      ensureActive();
      return readRaw();
    },

    save(state) {
      let snapshot;
      try {
        ensureActive();
        snapshot = validateState(state);
      } catch (error) {
        return Promise.reject(error);
      }
      const operation = queue.then(async () => {
        ensureActive();
        const persisted = await read();
        const persistedRevision = persisted === undefined ? 0 : validateState(persisted).revision;
        const nextRevision = Math.max(snapshot.revision, persistedRevision, knownRevision) + 1;
        if (!Number.isSafeInteger(nextRevision)) throw new Error(t('Достигнут предел ревизий данных.'));
        snapshot.revision = nextRevision;
        return persist(snapshot);
      });
      queue = operation.catch(() => {});
      return operation;
    },

    subscribe(callback) {
      ensureActive();
      if (typeof callback !== 'function') throw new Error(t('Ожидается обработчик изменения данных.'));
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      callbacks.clear();
      if (extensionStorage) browserApi.storage.onChanged?.removeListener(extensionChanged);
      else globalThis.removeEventListener?.('storage', previewChanged);
    }
  };
}
