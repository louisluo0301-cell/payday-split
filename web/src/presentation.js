import { startHeroParticles } from './hero-particles.js';
import { wireShowcaseEffects } from './showcase-effects.js';

const hero = document.querySelector('.hero');
const canvas = document.querySelector('#hero-particles');
if (canvas) startHeroParticles(canvas);

if (hero) {
  wireShowcaseEffects(hero);
  const disclosure = hero.querySelector('[data-flip-trigger]');
  if (disclosure) disclosure.hidden = false;
}

const guide = document.querySelector('#quick-start');
if (guide) {
  if (location.hash === '#quick-start') guide.open = true;
  document.querySelectorAll('a[href="#quick-start"]').forEach(link => {
    link.addEventListener('click', () => { guide.open = true; });
  });
  const demoLink = guide.querySelector('[data-guide-demo]');
  if (demoLink && new URLSearchParams(location.search).get('demo') === '1') {
    demoLink.href = '#workspace-next-action';
    demoLink.removeAttribute('target');
    demoLink.textContent = 'Find Run sample income ↗';
  }
}

if (window.IntersectionObserver) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === hero) {
        hero.classList.toggle('showcase-view', entry.isIntersecting);
        continue;
      }
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('motion-enter');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.1 });
  if (hero) observer.observe(hero);
  document.querySelectorAll('[data-reveal]').forEach(section => observer.observe(section));
}
