const FRAME_INTERVAL = 1000 / 30;
const MAX_PIXELS = 1_800_000;
const COLORS = ['91, 112, 72', '165, 123, 53'];

export function startHeroParticles(canvas) {
  const context = canvas.getContext('2d');
  const document = canvas.ownerDocument;
  const view = document.defaultView;
  if (!context || !view) return () => {};

  const motionPreference = view.matchMedia('(prefers-reduced-motion: reduce)');
  const particles = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let frame = null;
  let lastDraw = null;
  let elapsed = 0;
  let visible = !view.IntersectionObserver;
  let disposed = false;

  function draw(delta) {
    elapsed += delta;
    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      const sway = Math.sin(elapsed * 0.36 + particle.phase);
      particle.x += (particle.horizontalSpeed + sway * 1.4) * delta / width;
      particle.y -= particle.verticalSpeed * delta / height;
      if (particle.x > 1.02) particle.x = -0.02;
      if (particle.x < -0.02) particle.x = 1.02;
      if (particle.y < -0.02) particle.y = 1.02;

      const x = particle.x * width;
      const y = particle.y * height;
      const radius = particle.radius;
      const opacity = particle.opacity * (0.88 + 0.12 * sway);
      if (particle.glow) {
        const halo = radius * 3.5;
        const gradient = context.createRadialGradient(x, y, 0, x, y, halo);
        gradient.addColorStop(0, `rgba(${particle.color}, ${opacity * 0.28})`);
        gradient.addColorStop(1, `rgba(${particle.color}, 0)`);
        context.fillStyle = gradient;
        context.fillRect(x - halo, y - halo, halo * 2, halo * 2);
      }
      context.fillStyle = `rgba(${particle.color}, ${opacity})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  function canDraw() {
    return !disposed && visible && !document.hidden && width > 0 && height > 0;
  }

  function update() {
    if (!canDraw() || motionPreference.matches) {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      lastDraw = null;
      return;
    }
    if (frame === null) frame = view.requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = null;
    if (!canDraw() || motionPreference.matches) return;
    if (lastDraw === null || now - lastDraw >= FRAME_INTERVAL - 1) {
      const delta = lastDraw === null ? 0 : Math.min((now - lastDraw) / 1000, 0.08);
      lastDraw = now;
      draw(delta);
    }
    update();
  }

  function repaint() {
    if (canDraw()) draw(0);
    update();
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = bounds.width;
    const nextHeight = bounds.height;
    const area = nextWidth * nextHeight;
    const nextRatio = Math.min(view.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (area || 1)));
    if (width === nextWidth && height === nextHeight && pixelRatio === nextRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const count = Math.min(52, Math.round(area / 19_000));
    particles.splice(count);
    while (particles.length < count) {
      const glow = Math.random() < 0.13;
      particles.push({
        x: Math.random(), y: Math.random(),
        radius: (glow ? 1.25 : 0.7) + Math.random() * 0.85,
        opacity: 0.17 + Math.random() * 0.22,
        color: COLORS[Math.random() < 0.63 ? 0 : 1],
        horizontalSpeed: Math.random() * 4 - 1,
        verticalSpeed: 3 + Math.random() * 5,
        phase: Math.random() * Math.PI * 2,
        glow,
      });
    }
    repaint();
  }

  const intersection = view.IntersectionObserver && new view.IntersectionObserver(entries => {
    visible = entries.at(-1).intersectionRatio >= 0.01;
    repaint();
  }, { threshold: 0.01 });
  const sizes = view.ResizeObserver && new view.ResizeObserver(resize);
  intersection?.observe(canvas);
  sizes?.observe(canvas);
  motionPreference.addEventListener('change', repaint);
  document.addEventListener('visibilitychange', repaint);
  view.addEventListener('resize', resize);
  resize();

  return () => {
    disposed = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    intersection?.disconnect();
    sizes?.disconnect();
    motionPreference.removeEventListener('change', repaint);
    document.removeEventListener('visibilitychange', repaint);
    view.removeEventListener('resize', resize);
    context.clearRect(0, 0, width, height);
  };
}
