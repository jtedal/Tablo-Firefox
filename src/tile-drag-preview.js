const owners = new WeakMap();

export function createTileDragPreview(sourceElement) {
  const sourceId = sourceElement.dataset.id;
  const sourceGrid = sourceElement.parentElement;
  if (!sourceId || !sourceGrid?.classList.contains('tile-grid')) throw new TypeError('Плитка должна находиться в сетке.');
  const grids = new Map();
  const placeholder = document.createElement('div');
  placeholder.className = 'drag-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.pointerEvents = 'none';
  let destination = null;
  let committed = false;
  let restored = false;
  let cleaned = false;
  let cleanupTimer;
  const owner = { destroy: () => restore(true) };

  const preserve = (style, name) => ({ value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) });
  const reset = (style, name, previous) => {
    if (previous.value) style.setProperty(name, previous.value, previous.priority);
    else style.removeProperty(name);
  };
  const number = value => Number.parseFloat(value) || 0;

  function snapshot(grid) {
    if (grids.has(grid)) return grids.get(grid);
    const previous = owners.get(grid);
    if (previous && previous !== owner) previous.destroy();
    const style = getComputedStyle(grid);
    const elements = [...grid.children].filter(element => element.matches('.tile,.tile-add'));
    const entries = elements.map(element => ({
      element,
      id: element.dataset.id || null,
      kind: element.classList.contains('tile-add') ? 'add' : 'tile',
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
      translate: preserve(element.style, 'translate')
    }));
    let widths = [...style.gridTemplateColumns.matchAll(/([\d.]+)px/g)].map(match => Number(match[1])).filter(width => width > 0);
    if (!widths.length) {
      const firstRow = entries.filter(entry => entry.top === entries[0]?.top);
      widths = firstRow.map(entry => entry.width);
    }
    if (!widths.length) widths = [Math.max(1, grid.clientWidth - number(style.paddingLeft) - number(style.paddingRight))];
    const columnGap = number(style.columnGap);
    const rowGap = number(style.rowGap);
    const left = entries[0]?.left ?? number(style.paddingLeft);
    const top = entries[0]?.top ?? number(style.paddingTop);
    const columns = [];
    let columnLeft = left;
    for (const width of widths) {
      columns.push({ left: columnLeft, width });
      columnLeft += width + columnGap;
    }
    const record = {
      grid,
      entries,
      logical: entries.slice(),
      columns,
      top,
      rowGap,
      tileHeight: entries[0]?.height || number(style.getPropertyValue('--tile-height')) || sourceElement.offsetHeight || 128,
      paddingBottom: number(style.paddingBottom),
      initialHeight: grid.offsetHeight,
      minHeight: preserve(grid.style, 'min-height'),
      hadClass: grid.classList.contains('drag-preview-grid')
    };
    grids.set(grid, record);
    return record;
  }

  function slot(record, index) {
    const columns = record.columns.length;
    const original = record.entries[index];
    if (original) return { left: original.left, top: original.top, width: original.width, height: original.height };
    const column = record.columns[index % columns];
    return { left: column.left, top: record.top + Math.floor(index / columns) * (record.tileHeight + record.rowGap), width: column.width, height: record.tileHeight };
  }

  function coordinates(grid) {
    const rect = grid.getBoundingClientRect();
    const scaleX = grid.offsetWidth ? rect.width / grid.offsetWidth : 1;
    const scaleY = grid.offsetHeight ? rect.height / grid.offsetHeight : scaleX;
    return { rect, scaleX: scaleX || 1, scaleY: scaleY || 1 };
  }

  function ids(record) {
    return record.entries.filter(entry => entry.kind === 'tile' && entry.id !== sourceId).map(entry => entry.id);
  }

  function apply(record) {
    owners.set(record.grid, owner);
    record.grid.classList.add('drag-preview-grid');
    for (let index = 0; index < record.logical.length; index++) {
      const entry = record.logical[index];
      if (entry.element === sourceElement) continue;
      const position = slot(record, index);
      entry.element.style.translate = `${position.left - entry.left}px ${position.top - entry.top}px`;
    }
    const last = record.logical.length ? slot(record, record.logical.length - 1) : null;
    const height = last ? last.top + last.height + record.paddingBottom + record.grid.clientTop : 0;
    if (height > record.initialHeight + .5) record.grid.style.minHeight = `${Math.ceil(height)}px`;
    else reset(record.grid.style, 'min-height', record.minHeight);
  }

  function hit(grid, clientX, clientY) {
    if (restored || committed || !grid?.classList.contains('tile-grid')) return null;
    const record = snapshot(grid);
    const { rect, scaleX, scaleY } = coordinates(grid);
    const x = (clientX - rect.left) / scaleX + grid.scrollLeft - grid.clientLeft;
    const y = (clientY - rect.top) / scaleY + grid.scrollTop - grid.clientTop;
    let column = 0;
    let distance = Infinity;
    record.columns.forEach((candidate, index) => {
      const next = Math.abs(x - candidate.left - candidate.width / 2);
      if (next < distance) { distance = next; column = index; }
    });
    const row = Math.max(0, Math.round((y - record.top - record.tileHeight / 2) / (record.tileHeight + record.rowGap)));
    const positionIndex = row * record.columns.length + column;
    const position = slot(record, positionIndex);
    const ratio = Math.max(0, Math.min(1, (x - position.left) / position.width));
    const inside = x >= position.left && x <= position.left + position.width && y >= position.top && y <= position.top + position.height;
    const entry = record.logical[positionIndex];
    const targetIds = ids(record);
    if (!entry) return { id: null, kind: 'empty', index: targetIds.length, ratio, inside };
    if (entry.element === sourceElement) return { id: sourceId, kind: 'placeholder', index: destination?.grid === grid ? destination.index : targetIds.length, ratio, inside };
    if (entry.kind === 'add') return { id: null, kind: 'add', index: targetIds.length, ratio, inside };
    return { id: entry.id, kind: 'tile', index: targetIds.indexOf(entry.id), ratio, inside };
  }

  function set(grid, index) {
    if (restored || committed || !grid?.classList.contains('tile-grid')) return;
    const target = snapshot(grid);
    const targetIds = ids(target);
    const nextIndex = Math.max(0, Math.min(targetIds.length, Number.isFinite(index) ? Math.trunc(index) : targetIds.length));
    if (destination?.grid === grid && destination.index === nextIndex) return;
    const source = snapshot(sourceGrid);
    const sourceEntry = source.entries.find(entry => entry.element === sourceElement);
    destination = { grid, index: nextIndex };
    for (const record of grids.values()) {
      record.logical = record.entries.filter(entry => entry.element !== sourceElement);
      if (record === target) record.logical.splice(nextIndex, 0, sourceEntry);
      apply(record);
    }
    sourceElement.classList.add('dragging');
    if (placeholder.parentElement !== grid) grid.append(placeholder);
    const position = slot(target, nextIndex);
    placeholder.style.left = `${position.left}px`;
    placeholder.style.top = `${position.top}px`;
    placeholder.style.width = `${position.width}px`;
    placeholder.style.height = `${position.height}px`;
    placeholder.dataset.dragIndex = String(nextIndex);
  }

  function getDestination() {
    if (!destination || restored) return null;
    const targetIds = ids(snapshot(destination.grid));
    return { ...destination, beforeId: targetIds[destination.index] || null, afterId: targetIds[destination.index - 1] || null, ids: targetIds };
  }

  function commit() {
    if (restored || committed || !destination) return;
    const source = snapshot(sourceGrid);
    const sourceEntry = source.entries.find(entry => entry.element === sourceElement);
    const position = slot(snapshot(destination.grid), destination.index);
    const from = coordinates(sourceGrid);
    const to = coordinates(destination.grid);
    const left = to.rect.left + (position.left + destination.grid.clientLeft - destination.grid.scrollLeft) * to.scaleX;
    const top = to.rect.top + (position.top + destination.grid.clientTop - destination.grid.scrollTop) * to.scaleY;
    const sourceLeft = from.rect.left + (sourceEntry.left + sourceGrid.clientLeft - sourceGrid.scrollLeft) * from.scaleX;
    const sourceTop = from.rect.top + (sourceEntry.top + sourceGrid.clientTop - sourceGrid.scrollTop) * from.scaleY;
    const transition = preserve(sourceElement.style, 'transition');
    sourceElement.style.transition = 'none';
    sourceElement.style.translate = `${(left - sourceLeft) / from.scaleX}px ${(top - sourceTop) / from.scaleY}px`;
    sourceElement.classList.remove('dragging');
    void sourceElement.offsetWidth;
    reset(sourceElement.style, 'transition', transition);
    placeholder.remove();
    committed = true;
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(cleanupTimer);
    placeholder.remove();
    sourceElement.classList.remove('dragging');
    for (const record of grids.values()) {
      if (owners.get(record.grid) !== owner) continue;
      for (const entry of record.entries) reset(entry.element.style, 'translate', entry.translate);
      if (!record.hadClass) record.grid.classList.remove('drag-preview-grid');
      reset(record.grid.style, 'min-height', record.minHeight);
      owners.delete(record.grid);
    }
  }

  function restore(immediate = false) {
    if (restored && !immediate) return;
    restored = true;
    placeholder.remove();
    sourceElement.classList.remove('dragging');
    if (immediate) { cleanup(); return; }
    for (const record of grids.values()) {
      for (const entry of record.entries) reset(entry.element.style, 'translate', entry.translate);
    }
    cleanupTimer = setTimeout(cleanup, 220);
  }

  const initial = snapshot(sourceGrid);
  set(sourceGrid, initial.entries.filter(entry => entry.kind === 'tile').findIndex(entry => entry.element === sourceElement));
  return { hit, set, getDestination, commit, restore, destroy: () => restore(true), get committed() { return committed; } };
}
