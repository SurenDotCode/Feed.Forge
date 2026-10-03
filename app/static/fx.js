// FeedForge fx.js : border glow, pixel card, scroll stack in vanilla JS (no libraries).
// Mark elements with data-fx="glow" | "pixel" | "stack". New elements added later (e.g. job cards) are picked up automatically.
// Pixel card: put data-px-face on the always-visible text and data-px-reveal on the text revealed on hover/focus.
// Scroll stack: put data-fx="stack" on a container; its direct children become the stacked cards.
// Router hook: call window.__fx.refresh() after a view becomes visible again (optional, it also self-heals).
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover: hover) and (pointer: fine)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ---------------- border glow ---------------- */
const glowVis = new Set();
const glowIO = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? glowVis.add(e.target) : glowVis.delete(e.target))), { rootMargin: '220px' });
let gpx = -9999, gpy = -9999, graf = 0;
function glowFrame() {
  graf = 0;
  for (const el of glowVis) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const x = gpx - r.left, y = gpy - r.top, w = r.width, h = r.height;
    const outside = Math.max(-x, x - w, -y, y - h, 0);
    const inside = Math.max(Math.min(x, w - x, y, h - y), 0);
    const d = outside > 0 ? outside : inside;          // distance from the pointer to the border
    let gi = clamp(1 - d / 150); gi = gi * gi * (3 - 2 * gi);
    el.style.setProperty('--ga', (Math.atan2(y - h / 2, x - w / 2) * 180 / Math.PI + 90).toFixed(1) + 'deg');
    el.style.setProperty('--gx', x.toFixed(0) + 'px');
    el.style.setProperty('--gy', y.toFixed(0) + 'px');
    el.style.setProperty('--gi', gi.toFixed(3));
  }
}
function initGlow(el) {
  if (el.__glow) return; el.__glow = true;
  if (mqReduce.matches || !mqFine.matches) return;     // static faint ring (CSS) on touch / reduced motion
  glowIO.observe(el);
}
addEventListener('pointermove', (e) => {
  if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  gpx = e.clientX; gpy = e.clientY; if (!graf) graf = requestAnimationFrame(glowFrame);
}, { passive: true });
document.addEventListener('pointerleave', () => { gpx = gpy = -9999; if (!graf) graf = requestAnimationFrame(glowFrame); });

/* ---------------- pixel card ---------------- */
function initPixel(el) {
  if (el.__px) return; el.__px = true;
  const animate = !mqReduce.matches && mqFine.matches;
  let canvas, ctx, cells = [], cols = 0, rows = 0, size = 12, w = 1, h = 1, T = 0, dir = 0, raf = 0, last = 0, ox = .5, oy = .5;
  const on = () => el.classList.add('px-on');
  const off = () => el.classList.remove('px-on');
  if (animate) {
    canvas = document.createElement('canvas'); canvas.className = 'fx-px'; canvas.setAttribute('aria-hidden', 'true');
    el.prepend(canvas); ctx = canvas.getContext('2d');
    const layout = () => {
      const r = el.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = Math.max(10, Math.round(Math.min(w, h) / 11)); cols = Math.ceil(w / size); rows = Math.ceil(h / size);
      cells = Array.from({ length: cols * rows }, () => { const r = Math.random(); return { r, a: .10 + Math.random() * .24, cream: r > .94 }; });
      draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const maxD = Math.hypot(Math.max(ox, 1 - ox) * w, Math.max(oy, 1 - oy) * h) || 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const c = cells[j * cols + i], cx = (i + .5) * size, cy = (j + .5) * size;
        const delay = (Math.hypot(cx - ox * w, cy - oy * h) / maxD) * .62 + c.r * .13;
        const t = clamp((T - delay) / .25); if (t <= 0) continue;
        const p = 1 - Math.pow(1 - t, 3), s = size * p;
        ctx.globalAlpha = c.a * (.4 + .6 * p);
        ctx.fillStyle = c.cream ? '#F7F6F3' : '#A68B5B'; if (c.cream) ctx.globalAlpha *= .5;
        ctx.fillRect(cx - s / 2, cy - s / 2, Math.max(s - 1, 0), Math.max(s - 1, 0));
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, .05); last = now;
      T = clamp(T + dir * dt / .65, 0, 1.05); draw();
      raf = ((dir > 0 && T < 1.05) || (dir < 0 && T > 0)) ? requestAnimationFrame(tick) : 0;
    };
    const go = (d) => { dir = d; if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect(); ox = clamp((e.clientX - r.left) / r.width); oy = clamp((e.clientY - r.top) / r.height); on(); go(1);
    });
    el.addEventListener('pointerleave', () => { off(); go(-1); });
    el.addEventListener('focusin', () => { ox = .5; oy = .5; on(); go(1); });
    el.addEventListener('focusout', () => { off(); go(-1); });
    new ResizeObserver(layout).observe(el); layout();
  } else {
    el.addEventListener('focusin', on); el.addEventListener('focusout', off);
    el.addEventListener('pointerenter', (e) => { if (!e.pointerType || e.pointerType === 'mouse') on(); });
    el.addEventListener('pointerleave', off);
  }
}

/* ---------------- scroll stack ---------------- */
const stacks = new Map(); let sraf = 0;
function stackFrame() {
  sraf = 0;
  for (const [el, st] of stacks) {
    if (!st.visible) continue;
    const cards = st.cards, n = cards.length;
    const tops = cards.map((c) => parseFloat(getComputedStyle(c).top) || 0);
    const ps = [];
    for (let i = 0; i < n - 1; i++) {
      const h = cards[i].offsetHeight, top = tops[i], near = tops[i + 1] + 0, far = top + h;
      const nt = cards[i + 1].getBoundingClientRect().top;
      ps.push(clamp((far - nt) / Math.max(far - near, 1)));
    }
    for (let i = 0; i < n; i++) {
      let q = 0; for (let j = i; j < n - 1; j++) q += ps[j];
      const s = 1 - Math.min(q, 3) * .035;
      cards[i].style.transform = mqReduce.matches ? '' : `scale(${s.toFixed(4)})`;
      cards[i].style.setProperty('--dim', mqReduce.matches ? 0 : Math.min(q * .28, .6).toFixed(3));
    }
  }
}
const stackSched = () => { if (!sraf) sraf = requestAnimationFrame(stackFrame); };
function initStack(el) {
  if (el.__stack) return; el.__stack = true;
  const cards = [...el.children];
  cards.forEach((c, i) => { c.classList.add('fx-stack-card'); c.style.setProperty('--i', i); const d = document.createElement('div'); d.className = 'fx-dim'; c.appendChild(d); });
  const st = { cards, visible: false };
  stacks.set(el, st);
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; stackSched(); }, { rootMargin: '300px' }).observe(el);
}
addEventListener('scroll', stackSched, { passive: true });
addEventListener('resize', stackSched);

/* ---------------- boot + auto-pickup of new elements ---------------- */
function initOne(el) {
  const k = el.getAttribute('data-fx') || '';
  if (k.includes('glow')) initGlow(el);
  if (k.includes('pixel')) initPixel(el);
  if (k.includes('stack')) initStack(el);
}
function scan(root = document) {
  if (root.matches && root.matches('[data-fx]')) initOne(root);
  if (root.querySelectorAll) root.querySelectorAll('[data-fx]').forEach(initOne);
}
const mo = new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); }); });
function boot() { scan(document); mo.observe(document.body, { childList: true, subtree: true }); }
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
window.__fx = { scan, refresh() { scan(document); stackSched(); if (!graf) graf = requestAnimationFrame(glowFrame); } };
export { scan };
