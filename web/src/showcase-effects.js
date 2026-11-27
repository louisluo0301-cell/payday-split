const surfaceSelector = '[data-tilt], [data-spotlight], [data-magnetic], [data-trail]';
const decodeAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const pointerLimit = 1;
const maxTrailDots = 14;
const maxRipples = 2;

function setPoint(element, name, x, y, unit = 'px') {
  element.style.setProperty('--' + name + '-x', x.toFixed(1) + unit);
  element.style.setProperty('--' + name + '-y', y.toFixed(1) + unit);
}

function clearPoint(element, name) {
  element.style.removeProperty('--' + name + '-x');
  element.style.removeProperty('--' + name + '-y');
}

function boundedRatio(value) {
  return Math.max(-pointerLimit, Math.min(pointerLimit, value * 2 - 1));
}

export function wireShowcaseEffects(root = document) {
  const doc = root.ownerDocument ?? root;
  const view = doc.defaultView;
  if (!view) return () => {};

  const controller = new view.AbortController();
  const signal = controller.signal;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = view.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const resetters = [];
  const layers = [];
  const listen = (target, type, callback, options) => target.addEventListener(type, callback, { ...options, signal });
  const canAnimate = () => !reduced.matches && fine.matches && !doc.hidden;
  const elements = selector => {
    const descendants = [...root.querySelectorAll(selector)];
    if (root.matches?.(selector)) descendants.unshift(root);
    return descendants;
  };
  const decoration = className => {
    const span = doc.createElement('span');
    span.className = className;
    span.setAttribute('aria-hidden', 'true');
    return span;
  };

  for (const element of elements(surfaceSelector)) {
    const tilt = element.hasAttribute('data-tilt');
    const spotlight = element.hasAttribute('data-spotlight');
    const magnetic = element.hasAttribute('data-magnetic');
    const trail = element.hasAttribute('data-trail') ? decoration('showcase-trail') : null;
    let frame = null;
    let pointer;
    let bounds;
    let lastDot = -Infinity;

    if (trail) {
      layers.push(trail);
      element.append(trail);
      listen(trail, 'animationend', event => {
        if (event.target.parentNode === trail) event.target.remove();
      });
    }

    function resetSurface() {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      bounds = null;
      lastDot = -Infinity;
      if (tilt) {
        element.classList.remove('is-tilting');
        clearPoint(element, 'tilt');
      }
      if (spotlight) {
        element.classList.remove('is-spotlit');
      }
      if (magnetic) {
        element.classList.remove('is-magnetic');
        clearPoint(element, 'magnetic');
      }
    }

    function renderPointer(time) {
      frame = null;
      if (!canAnimate()) return;
      bounds ??= element.getBoundingClientRect();
      const { width, height } = bounds;
      if (width <= 0 || height <= 0) return;
      const x = pointer.x - bounds.left;
      const y = pointer.y - bounds.top;
      const across = boundedRatio(x / width);
      const down = boundedRatio(y / height);

      if (tilt) {
        setPoint(element, 'tilt', -down * 7, across * 7, 'deg');
        element.classList.add('is-tilting');
      }
      if (spotlight) {
        setPoint(element, 'spotlight', x, y);
        element.classList.add('is-spotlit');
      }
      if (magnetic) {
        setPoint(element, 'magnetic', across * 7, down * 5);
        element.classList.add('is-magnetic');
      }
      if (trail && time - lastDot >= 28) {
        lastDot = time;
        if (trail.childElementCount >= maxTrailDots) trail.firstElementChild.remove();
        const dot = decoration('showcase-trail-dot');
        setPoint(dot, 'trail', x, y);
        trail.append(dot);
      }
    }

    function trackPointer(event) {
      if (event.pointerType !== 'mouse' || event.buttons || !canAnimate()) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (frame === null) frame = view.requestAnimationFrame(renderPointer);
    }

    listen(element, 'pointerenter', trackPointer, { passive: true });
    listen(element, 'pointermove', trackPointer, { passive: true });
    listen(element, 'pointerleave', resetSurface);
    listen(element, 'pointercancel', resetSurface);
    resetters.push(() => {
      resetSurface();
      if (spotlight) clearPoint(element, 'spotlight');
      trail?.replaceChildren();
    });
  }

  for (const element of elements('[data-ripple]')) {
    const clearRipples = () => {
      element.querySelectorAll(':scope > .showcase-ripple').forEach(ripple => ripple.remove());
    };
    listen(element, 'click', event => {
      if (!canAnimate() || (event.pointerType && event.pointerType !== 'mouse')) return;
      const { left, top, width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const x = event.detail ? event.clientX - left : width / 2;
      const y = event.detail ? event.clientY - top : height / 2;
      const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
      const active = element.querySelectorAll(':scope > .showcase-ripple');
      if (active.length >= maxRipples) active[0].remove();
      const ripple = decoration('showcase-ripple');
      setPoint(ripple, 'ripple', x, y);
      ripple.style.setProperty('--ripple-size', radius * 2 + 'px');
      element.append(ripple);
    });
    listen(element, 'animationend', event => {
      const ripple = event.target;
      if (ripple.parentNode === element && ripple.classList.contains('showcase-ripple')) ripple.remove();
    });
    resetters.push(clearRipples);
  }

  for (const element of elements('[data-decode]')) {
    const visual = element.querySelector('[data-decode-text][aria-hidden="true"]');
    if (!visual || visual.childElementCount) continue;
    const original = visual.textContent;
    const characters = [...original];
    let frame = null;
    let started;
    let lastUpdate;

    function resetDecode() {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      element.classList.remove('is-decoding');
      if (visual.textContent !== original) visual.textContent = original;
    }

    function renderDecode(time) {
      frame = null;
      started ??= time;
      const progress = (time - started) / 380;
      if (!canAnimate() || progress >= 1) {
        resetDecode();
        return;
      }
      if (time - lastUpdate >= 38) {
        lastUpdate = time;
        const revealed = Math.floor(progress * characters.length);
        visual.textContent = characters.map((character, index) => {
          if (index < revealed || !/[a-z0-9]/i.test(character)) return character;
          return decodeAlphabet[Math.floor(Math.random() * decodeAlphabet.length)];
        }).join('');
      }
      frame = view.requestAnimationFrame(renderDecode);
    }

    function startDecode(event) {
      if (!canAnimate() || frame !== null || (event.pointerType && event.pointerType !== 'mouse')) return;
      started = undefined;
      lastUpdate = -Infinity;
      element.classList.add('is-decoding');
      frame = view.requestAnimationFrame(renderDecode);
    }

    listen(element, 'pointerenter', startDecode, { passive: true });
    listen(element, 'pointerleave', resetDecode);
    listen(element, 'focusin', startDecode);
    listen(element, 'focusout', resetDecode);
    resetters.push(resetDecode);
  }

  for (const element of elements('[data-flip]')) {
    const trigger = element.querySelector('button[data-flip-trigger]');
    const front = element.querySelector('[data-flip-front]');
    const back = element.querySelector('[data-flip-back]');
    if (!trigger || !front || !back || front.contains(trigger) || back.contains(trigger)) continue;
    if (back.id) trigger.setAttribute('aria-controls', back.id);

    function setFlipped(flipped) {
      const hiddenFace = flipped ? front : back;
      if (hiddenFace.contains(doc.activeElement)) trigger.focus({ preventScroll: true });
      element.classList.toggle('is-flipped', flipped);
      trigger.setAttribute('aria-expanded', String(flipped));
      front.setAttribute('aria-hidden', String(flipped));
      back.setAttribute('aria-hidden', String(!flipped));
      front.toggleAttribute('inert', flipped);
      back.toggleAttribute('inert', !flipped);
    }

    setFlipped(trigger.getAttribute('aria-expanded') === 'true');
    listen(trigger, 'click', () => setFlipped(trigger.getAttribute('aria-expanded') !== 'true'));
  }

  const resetMotion = () => resetters.forEach(reset => reset());
  listen(reduced, 'change', resetMotion);
  listen(fine, 'change', resetMotion);
  listen(view, 'resize', resetMotion, { passive: true });
  listen(view, 'scroll', resetMotion, { passive: true });
  listen(view, 'blur', resetMotion);
  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) resetMotion();
  });
  return () => {
    controller.abort();
    resetMotion();
    layers.forEach(layer => layer.remove());
  };
}
