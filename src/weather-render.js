export function createWeatherRenderer({ button, symbol, temperature, city, summary, icon }) {
  const owner = button.ownerDocument;
  const reduced = owner.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = new Map();
  let previous;
  let currentIcon;

  function finish(node, record) {
    if (active.get(node) !== record) return;
    active.delete(node);
    node.style.willChange = record.willChange;
    record.ghost.remove();
    record.animations.forEach(animation => animation.cancel());
  }

  function stopField(node) {
    const record = active.get(node);
    if (record) finish(node, record);
  }

  function stop() {
    for (const [node, record] of active) finish(node, record);
  }

  function change(node, apply, animate) {
    stopField(node);
    if (!animate || owner.hidden || reduced?.matches || button.hidden || typeof node.animate !== 'function' || !node.getClientRects().length) {
      apply();
      return;
    }
    const bounds = node.getBoundingClientRect();
    const host = button.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      apply();
      return;
    }
    const ghost = node.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.classList.add('weather-transition-ghost');
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${bounds.left - host.left - button.clientLeft}px`,
      top: `${bounds.top - host.top - button.clientTop}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      margin: '0',
      pointerEvents: 'none',
      willChange: 'opacity'
    });
    const record = { ghost, animations: [], willChange: node.style.willChange };
    active.set(node, record);
    try {
      button.append(ghost);
      apply();
      node.style.willChange = 'opacity';
      const options = { duration: 260, easing: 'ease-out', fill: 'both' };
      record.animations.push(node.animate([{ opacity: 0 }, { opacity: 1 }], options));
      record.animations.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], options));
      Promise.all(record.animations.map(animation => animation.finished)).then(() => finish(node, record), () => finish(node, record));
    } catch {
      record.animations.forEach(animation => animation.finished.catch(() => {}));
      finish(node, record);
    }
  }

  function text(node, value, animate) {
    if (node.textContent !== value) change(node, () => { node.textContent = value; }, animate);
  }

  function update(value) {
    const hasWeather = value.hasWeather === true;
    const animate = !!previous?.hasWeather && hasWeather && previous.cityKey === value.cityKey;
    if (!animate) stop();
    const hasWeatherValue = String(hasWeather);
    if (button.dataset.hasWeather !== hasWeatherValue) button.dataset.hasWeather = hasWeatherValue;
    if (currentIcon !== value.iconName) {
      const next = icon(value.iconName);
      const existingSvg = symbol.querySelector('svg');
      const nextSvg = next.querySelector('svg');
      if (!existingSvg || !nextSvg || existingSvg.innerHTML !== nextSvg.innerHTML || existingSvg.getAttribute('viewBox') !== nextSvg.getAttribute('viewBox')) {
        change(symbol, () => symbol.replaceChildren(next), animate);
      }
      currentIcon = value.iconName;
    }
    text(temperature, value.temperature, animate);
    text(city, value.city, false);
    text(summary, value.summary, animate);
    previous = { cityKey: value.cityKey, hasWeather };
  }

  owner.addEventListener('visibilitychange', () => { if (owner.hidden) stop(); });
  reduced?.addEventListener('change', () => { if (reduced.matches) stop(); });
  return Object.freeze({ update, stop });
}
