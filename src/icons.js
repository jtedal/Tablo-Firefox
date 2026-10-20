(() => {
  if (globalThis.tabloIcons) return;
  const namespace = 'http://www.w3.org/2000/svg';
  const shapes = {
    "settings": [["path", {"d": "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"}], ["circle", {"cx": "12", "cy": "12", "r": "3"}]],
    "search": [["circle", {"cx": "10.5", "cy": "10.5", "r": "6.5"}], ["path", {"d": "m16 16 4.5 4.5"}]],
    "arrow-right": [["path", {"d": "M4 12h15m-6-6 6 6-6 6"}]],
    "plus": [["path", {"d": "M12 5v14M5 12h14"}]],
    "edit": [["path", {"d": "m15 4 5 5M4 20l1-6L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 19Z"}]],
    "more": [["circle", {"cx": "5", "cy": "12", "r": "1"}], ["circle", {"cx": "12", "cy": "12", "r": "1"}], ["circle", {"cx": "19", "cy": "12", "r": "1"}]],
    "close": [["path", {"d": "m6 6 12 12M6 18 18 6"}]],
    "image": [["rect", {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "4"}], ["circle", {"cx": "8", "cy": "8", "r": "1.5"}], ["path", {"d": "m3 17 5-5 4 4 4-7 5 8"}]],
    "folder": [["path", {"d": "M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"}]],
    "grid": [["rect", {"x": "3", "y": "3", "width": "7", "height": "7", "rx": "2"}], ["rect", {"x": "14", "y": "3", "width": "7", "height": "7", "rx": "2"}], ["rect", {"x": "3", "y": "14", "width": "7", "height": "7", "rx": "2"}], ["rect", {"x": "14", "y": "14", "width": "7", "height": "7", "rx": "2"}]],
    "trash": [["path", {"d": "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"}]],
    "external": [["path", {"d": "M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"}]],
    "move": [["path", {"d": "M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"}]],
    "home": [["path", {"d": "m3 10 9-7 9 7v10H3ZM9 20v-7h6v7"}]],
    "download": [["path", {"d": "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"}]],
    "upload": [["path", {"d": "M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"}]],
    "check": [["path", {"d": "m5 12 4 4L19 6"}]],
    "location": [["path", {"d": "M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z"}], ["circle", {"cx": "12", "cy": "10", "r": "2.5"}]],
    "chevron-right": [["path", {"d": "m9 5 7 7-7 7"}]],
    "refresh": [["path", {"d": "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"}]],
    "sun": [["circle", {"cx": "12", "cy": "12", "r": "4"}], ["path", {"d": "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"}]],
    "moon": [["path", {"d": "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"}]],
    "cloud": [["path", {"d": "M6 19a5 5 0 0 1-1-9 7 7 0 0 1 13-2 5.5 5.5 0 0 1 0 11Z"}]],
    "cloud-sun": [["path", {"d": "M7 5V3M3 9H1m3-4L2.5 3.5M11 4l1-2"}], ["path", {"d": "M3 12a4 4 0 1 1 8-4M7 20a4 4 0 0 1-1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9Z"}]],
    "fog": [["path", {"d": "M5 13a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 3 7M3 17h18M6 21h12"}]],
    "rain": [["path", {"d": "M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 17l-1 3m6-3-1 3m6-3-1 3"}]],
    "snow": [["path", {"d": "M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M7 18v4m-2-2h4m7-2v4m-2-2h4"}]],
    "storm": [["path", {"d": "M5 14a4 4 0 0 1 0-8 6 6 0 0 1 11 1 4 4 0 0 1 2 7M12 13l-4 6h5l-2 4 7-8h-5l2-3"}]]
  };
  for (const shape of Object.values(shapes)) {
    for (const part of shape) {
      Object.freeze(part[1]);
      Object.freeze(part);
    }
    Object.freeze(shape);
  }
  Object.freeze(shapes);

  function create(name, documentImpl = document) {
    const parts = typeof name === 'string' && Object.hasOwn(shapes, name) ? shapes[name] : shapes.grid;
    const span = documentImpl.createElement('span');
    const svg = documentImpl.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attributes] of parts) {
      const node = documentImpl.createElementNS(namespace, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      svg.append(node);
    }
    span.append(svg);
    return span;
  }

  globalThis.tabloIcons = Object.freeze({ create });
})();
