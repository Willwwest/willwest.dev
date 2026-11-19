// The only module a page references directly, and the only code that runs before a scene is
// wanted: it decides whether to load three.js at all. Hosts are any element with data-fx.
// Without WebGL2, with Save-Data on, or without script, nothing loads and the page is exactly
// the static design. Scene modules (and three.js, a shared chunk) arrive on demand.
const scenes = {
  hero: () => import('./hero.js'),
  untangle: () => import('./method.js'),
  branch: () => import('./method.js'),
  lost: () => import('./lost.js'),
};
// These figures are scroll-driven motion, so reduced-motion visitors do not get them at all.
// The hero and 404 still render, as a single still frame.
const motionOnly = new Set(['untangle', 'branch']);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hosts = document.querySelectorAll('[data-fx]');
const conn = navigator.connection;

function start(host) {
  const kind = host.dataset.fx;
  scenes[kind]()
    .then((m) => m.mount(host, kind))
    .catch((err) => { host.remove(); console.warn('fx:', kind, err); });
}

// after the page's own load, and after the browser has a moment, so a scene never competes
// with the portrait for first paint
function whenSettled(fn) {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

if (hosts.length && 'WebGL2RenderingContext' in window && !(conn && conn.saveData)) {
  document.documentElement.classList.add('fx');
  for (const host of hosts) {
    const kind = host.dataset.fx;
    if (!scenes[kind] || (reduce && motionOnly.has(kind))) continue;
    if (motionOnly.has(kind)) {
      // load when it is about to scroll into view. CSS hides these on narrow screens, and a
      // display:none element never intersects, so phones never download them.
      const io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(host); }
      }, { rootMargin: '600px 0px' });
      io.observe(host);
    } else whenSettled(() => start(host));
  }
}
