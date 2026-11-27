import { startHeroParticles } from './hero-particles.js';

const canvas = document.querySelector('#hero-particles');
if (canvas) startHeroParticles(canvas);

if (window.IntersectionObserver) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('motion-enter');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.1 });
  document.querySelectorAll('[data-reveal]').forEach(section => observer.observe(section));
}
