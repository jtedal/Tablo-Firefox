(() => {
  const key = 'tabloBackgroundPreview';
  const maxCacheLength = 100 * 1024;
  const maxPreviewLength = 96 * 1024;
  const backgrounds = new Set(['aurora', 'dawn', 'forest', 'midnight']);
  const root = document.documentElement;
  let latest = null;
  let generation = 0;
  let completed = null;

  function validPreview(value) {
    if (typeof value !== 'string' || value.length > maxPreviewLength || !value.startsWith('data:image/jpeg;base64,')) return false;
    const encoded = value.slice(23);
    if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
    try {
      const bytes = atob(encoded);
      if (btoa(bytes) !== encoded || bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 || bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) return false;
      let offset = 2;
      let dimensions = false;
      while (offset < bytes.length - 2) {
        if (bytes.charCodeAt(offset++) !== 255) return false;
        while (bytes.charCodeAt(offset) === 255) offset++;
        const marker = bytes.charCodeAt(offset++);
        if (marker === 218) return dimensions;
        if (marker === 0 || marker === 216 || marker === 217) return false;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        const length = bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1);
        if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length - 2) return false;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          if (length < 8) return false;
          const height = bytes.charCodeAt(offset + 3) * 256 + bytes.charCodeAt(offset + 4);
          const width = bytes.charCodeAt(offset + 5) * 256 + bytes.charCodeAt(offset + 6);
          if (!width || !height || width > 640 || height > 640) return false;
          dimensions = true;
        }
        offset += length;
      }
    } catch {}
    return false;
  }

  function parseCache(raw) {
    if (typeof raw !== 'string' || raw.length > maxCacheLength) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(name => !['schemaVersion', 'revision', 'background', 'dim', 'previewJPEGdataURL'].includes(name))) return null;
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !backgrounds.has(value.background) || !Number.isFinite(value.dim) || value.dim < 0 || value.dim > 70) return null;
      if (value.previewJPEGdataURL !== null && !validPreview(value.previewJPEGdataURL)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function readCache() {
    try { return parseCache(localStorage.getItem(key)); }
    catch { return null; }
  }

  function store(snapshot) {
    try {
      const existing = readCache();
      if (existing && existing.revision > snapshot.revision) return;
      const serialized = JSON.stringify(snapshot);
      if (serialized.length <= maxCacheLength) localStorage.setItem(key, serialized);
    } catch {}
  }

  function snapshot(settings, revision, previewJPEGdataURL) {
    return { schemaVersion: 1, revision, background: settings.background, dim: settings.dim, previewJPEGdataURL };
  }

  function defer(task) {
    try {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 1500 });
      else setTimeout(task, 0);
    } catch {}
  }

  async function createPreview(source, ticket) {
    try {
      if (ticket !== generation || latest?.source !== source) return;
      const image = new Image();
      image.src = source;
      await image.decode();
      if (ticket !== generation || latest?.source !== source || !image.naturalWidth || !image.naturalHeight) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      for (const edge of [640, 480, 320, 200]) {
        const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.fillStyle = '#111a30';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.76, 0.56, 0.36]) {
          const preview = canvas.toDataURL('image/jpeg', quality);
          if (preview.length > maxPreviewLength || !validPreview(preview)) continue;
          if (ticket !== generation || latest?.source !== source) return;
          completed = { source, preview };
          store(snapshot(latest, latest.revision, preview));
          return;
        }
      }
    } catch {}
  }

  function remember(settings, revision) {
    try {
      if (!settings || !backgrounds.has(settings.background) || !Number.isFinite(settings.dim) || settings.dim < 0 || settings.dim > 70 || !Number.isSafeInteger(revision) || revision < 0 || latest && revision < latest.revision) return;
      const source = settings.customBackground || null;
      if (source !== null && (typeof source !== 'string' || source.length > 7 * 1024 * 1024 || !/^data:image\/(?:jpeg|png|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source))) return;
      if (latest && latest.source === source && latest.background === settings.background && latest.dim === settings.dim && latest.revision === revision) return;
      const changed = !latest || latest.source !== source;
      latest = { background: settings.background, dim: settings.dim, source, revision };
      if (changed) generation++;
      if (source && completed?.source !== source) {
        const cached = readCache();
        if (cached?.revision === revision && cached.background === settings.background && cached.dim === settings.dim && cached.previewJPEGdataURL) completed = { source, preview: cached.previewJPEGdataURL };
      }
      const preview = completed?.source === source ? completed.preview : null;
      store(snapshot(latest, revision, preview));
      if (source && changed && !preview) {
        const ticket = generation;
        defer(() => createPreview(source, ticket));
      }
    } catch {}
  }

  try {
    const cached = readCache();
    if (cached) {
      const source = cached.previewJPEGdataURL || `assets/${cached.background}.svg`;
      const wallpaper = `url("${source}")`;
      root.style.setProperty('--tablo-wallpaper', wallpaper);
      root.style.setProperty('--dim', String(cached.dim / 100));
      if (cached.previewJPEGdataURL) {
        const image = new Image();
        image.src = cached.previewJPEGdataURL;
        image.decode().catch(() => {
          if (root.style.getPropertyValue('--tablo-wallpaper') === wallpaper) root.style.setProperty('--tablo-wallpaper', `url("assets/${cached.background}.svg")`);
          try {
            const current = readCache();
            if (current?.revision === cached.revision && current.previewJPEGdataURL === cached.previewJPEGdataURL) store({ ...cached, previewJPEGdataURL: null });
          } catch {}
        });
      }
    }
  } catch {}

  globalThis.tabloBackground = Object.freeze({ remember });
})();
