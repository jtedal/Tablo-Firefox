const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const active = new Map();

function frames(element) {
  if (element.classList.contains('settings-dialog')) return { hidden: 'translateX(28px)', shown: 'none', enter: 240, exit: 160 };
  if (element.classList.contains('folder-dialog')) return { hidden: 'scale(.94)', shown: 'none', enter: 240, exit: 150 };
  if (element.id === 'menu') return { hidden: 'translateY(-5px) scale(.98)', shown: 'none', enter: 120, exit: 90 };
  if (element.id === 'toast') return { hidden: 'translateX(-50%) translateY(10px)', shown: 'translateX(-50%)', enter: 180, exit: 120 };
  return { hidden: 'translateY(12px) scale(.985)', shown: 'none', enter: 180, exit: 120 };
}

export function stopSurfaceMotion(element) {
  const running = active.get(element);
  if (!running) return;
  active.delete(element);
  running.cleanup?.();
  running.animations.forEach(animation => animation.cancel());
  running.resolve(false);
}

export function revealTablo(element, skeleton) {
  stopSurfaceMotion(element);
  if (skeleton) skeleton.hidden = false;
  if (reducedMotion.matches || typeof element.animate !== 'function') {
    if (skeleton) skeleton.hidden = true;
    return Promise.resolve(true);
  }
  let resolve;
  const finished = new Promise(done => { resolve = done; });
  const owner = element.ownerDocument;
  const surfaces = [...element.querySelectorAll('[data-reveal]')].filter(surface => surface.dataset.earlyTiles !== 'true');
  const targets = [...(surfaces.length ? surfaces : [element]), skeleton].filter(Boolean);
  const previousWillChange = targets.map(target => target.style.willChange);
  let frame = 0;
  const animations = [];
  let running;
  let visibilityChanged;
  const cancelFrame = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const cleanup = () => {
    cancelFrame();
    if (visibilityChanged) owner.removeEventListener('visibilitychange', visibilityChanged);
    targets.forEach((target, index) => { target.style.willChange = previousWillChange[index]; });
    if (skeleton) skeleton.hidden = true;
  };
  try {
    targets.forEach(target => {
      target.style.willChange = 'opacity';
      const hiding = target === skeleton;
      const animation = target.animate([{ opacity: hiding ? 1 : 0 }, { opacity: hiding ? 0 : 1 }], { duration: 300, easing: 'ease-in-out', fill: 'both' });
      animations.push(animation);
      animation.pause();
      animation.currentTime = 0;
    });
    running = { opening: true, animations, resolve, finished, cleanup };
    active.set(element, running);
    const complete = () => {
      if (active.get(element) !== running) return;
      active.delete(element);
      cleanup();
      animations.forEach(animation => animation.cancel());
      resolve(true);
    };
    const queuePlay = () => {
      cancelFrame();
      if (active.get(element) !== running || owner.hidden) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (active.get(element) !== running || owner.hidden) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (active.get(element) === running && !owner.hidden) animations.forEach(animation => animation.play());
        });
      });
    };
    visibilityChanged = () => {
      if (active.get(element) !== running) return;
      if (owner.hidden) {
        cancelFrame();
        animations.forEach(animation => animation.pause());
      } else queuePlay();
    };
    owner.addEventListener('visibilitychange', visibilityChanged);
    Promise.all(animations.map(animation => animation.finished)).then(complete, complete);
    queuePlay();
  } catch {
    if (active.get(element) === running) active.delete(element);
    cleanup();
    animations.forEach(animation => { animation.finished.catch(() => {}); animation.cancel(); });
    resolve(true);
  }
  return finished;
}

export function animateSurface(element, opening = true, complete) {
  const previous = active.get(element);
  if (!opening && previous && !previous.opening) return previous.finished;
  const style = getComputedStyle(element);
  const current = { opacity: style.opacity, transform: style.transform };
  const backdropOpacity = element instanceof HTMLDialogElement ? getComputedStyle(element, '::backdrop').opacity : null;
  stopSurfaceMotion(element);
  if (reducedMotion.matches || typeof element.animate !== 'function') {
    complete?.();
    return Promise.resolve(true);
  }
  const profile = frames(element);
  const duration = opening ? profile.enter : profile.exit;
  const options = { duration, easing: opening ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(.4, 0, 1, 1)', fill: 'both' };
  const from = opening && !previous ? { opacity: 0, transform: profile.hidden } : current;
  const to = { opacity: opening ? 1 : 0, transform: opening ? profile.shown : profile.hidden };
  let resolve;
  const finished = new Promise(done => { resolve = done; });
  const running = { opening, animations: [], resolve, finished };
  active.set(element, running);
  const finish = () => {
    if (active.get(element) !== running) return;
    active.delete(element);
    complete?.();
    running.animations.forEach(animation => animation.cancel());
    resolve(true);
  };
  try {
    const animation = element.animate([from, to], options);
    running.animations.push(animation);
    if (backdropOpacity !== null) {
      try {
        const backdrop = element.animate([
          { opacity: opening && !previous ? 0 : backdropOpacity },
          { opacity: opening ? 1 : 0 }
        ], { ...options, pseudoElement: '::backdrop' });
        if (backdrop.effect.pseudoElement === '::backdrop') running.animations.push(backdrop);
        else backdrop.cancel();
      } catch {}
    }
    animation.finished.then(finish, () => {
      if (active.get(element) === running) finish();
    });
  } catch { finish(); }
  return finished;
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  for (const running of active.values()) running.animations.forEach(animation => animation.finish());
});
