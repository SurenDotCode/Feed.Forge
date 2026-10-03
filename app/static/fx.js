// FeedForge fx.js : border glow, pixel card, scroll stack in vanilla JS (no libraries).
// Mark elements with data-fx="glow" | "pixel" | "stack" | "fuse" (undo-window button, see fx.css). New elements added later (e.g. job cards) are picked up automatically.
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


/* ---------------- fuse button ---------------- */
function initFuse(btn) {
  if (btn.__fuse) return; btn.__fuse = true;
  const ms = () => +btn.dataset.fuseMs || 5000;
  const watchSel = btn.dataset.fuseWatch || '', reqSel = btn.dataset.fuseRequire || '';
  const status = btn.dataset.fuseStatus ? document.querySelector(btn.dataset.fuseStatus) : null;
  const ui = document.createElement('span'); ui.className = 'fuse-ui'; ui.setAttribute('aria-hidden', 'true');
  ui.innerHTML = '<span class="fuse-label">Undo</span><span class="fuse-count"></span>';
  btn.appendChild(ui);
  // the fuse: a ring around the button edge that burns away clockwise from the top center, with a spark at the burning tip
  const NS = 'http://www.w3.org/2000/svg', PAD = 6;
  const ring = document.createElementNS(NS, 'svg'); ring.setAttribute('class', 'fuse-ring'); ring.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(NS, 'path'); track.setAttribute('class', 'fuse-track');
  const burn = document.createElementNS(NS, 'path'); burn.setAttribute('class', 'fuse-burn-path');
  const spark = document.createElementNS(NS, 'circle'); spark.setAttribute('class', 'fuse-spark-dot'); spark.setAttribute('r', '3.6');
  ring.append(track, burn, spark); btn.appendChild(ring);
  let total = 1, lastP = 1;
  function paintRing(p) {
    const head = (1 - p) * total;
    burn.style.strokeDasharray = (p * total).toFixed(2) + ' ' + total.toFixed(2);
    burn.style.strokeDashoffset = (-head).toFixed(2);
    const pt = burn.getPointAtLength(Math.min(head, total));
    spark.setAttribute('cx', pt.x.toFixed(2)); spark.setAttribute('cy', pt.y.toFixed(2));
  }
  function layout() {
    const w = btn.offsetWidth + 2 * PAD, h = btn.offsetHeight + 2 * PAD; if (!w || !h) return;
    ring.setAttribute('width', w); ring.setAttribute('height', h); ring.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    ring.style.left = ring.style.top = -PAD + 'px';
    const rr = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 10;
    const r = Math.min(rr + PAD - 1, (h - 2) / 2, (w - 2) / 2), x0 = 1, y0 = 1, x1 = w - 1, y1 = h - 1;
    const d = `M ${w / 2} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} H ${w / 2}`;
    track.setAttribute('d', d); burn.setAttribute('d', d); total = burn.getTotalLength(); paintRing(lastP);
  }
  new ResizeObserver(layout).observe(btn); layout();
  const count = ui.querySelector('.fuse-count');
  let burning = false, deadline = 0, left = 5000, raf = 0, bypass = false, clearT = 0, lastSec = -1;
  const say = (t, ms = 0) => { if (!status) return; status.textContent = t; clearTimeout(clearT); if (ms) clearT = setTimeout(() => { status.textContent = ''; }, ms); };
  const valid = () => { if (!reqSel) return true; const i = document.querySelector(reqSel); return !!i && i.value.trim().length >= 3; };
  const watched = (t) => !!watchSel && !!t.closest && !!t.closest(watchSel);
  const paint = (rem) => {
    const p = Math.max(0, Math.min(1, rem / ms())); lastP = p; paintRing(p);
    const s = Math.ceil(rem / 1000); if (s !== lastSec) { lastSec = s; count.textContent = s + 's'; }
  };
  const tick = () => {
    if (!burning) return;
    const rem = deadline - performance.now(); paint(rem);
    if (rem <= 0) { commit(); return; }
    raf = requestAnimationFrame(tick);
  };
  const arm = () => { deadline = performance.now() + ms(); lastSec = -1; paint(ms()); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
  function start() {
    burning = true; btn.classList.add('is-fuse');
    btn.setAttribute('aria-label', 'Undo. Video generation starts in ' + Math.round(ms() / 1000) + ' seconds. Press Escape to cancel.');
    say('Starting in ' + Math.round(ms() / 1000) + 's. Edit your topic to restart the timer, or press Esc to undo.');
    arm();
  }
  function restart() { say('You edited the topic, so the timer restarted. Starting in ' + Math.round(ms() / 1000) + 's. Press Esc to undo.'); arm(); }
  function end() { burning = false; cancelAnimationFrame(raf); btn.classList.remove('is-fuse'); btn.removeAttribute('aria-label'); }
  function cancel(why) {
    if (!burning) return; end();
    if (why === 'undo') say('Undone. Nothing was started. Edit your topic and press Generate when ready.', 6000);
    else if (why === 'invalid') say('The topic is too short, so the timer was cancelled.', 6000);
    else say('');
  }
  function commit() {
    end(); say('Starting now.', 2500);
    const r = btn.getBoundingClientRect();
    bypass = true;
    try { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); }
    finally { bypass = false; }
  }
  // the first click on the button lights the fuse; the next click is Undo. Runs before any other click handler.
  document.addEventListener('click', (e) => {
    if (bypass || !e.target.closest || e.target.closest('[data-fx~="fuse"]') !== btn) return;
    if (btn.disabled) return;
    if (burning) { e.preventDefault(); e.stopImmediatePropagation(); cancel('undo'); return; }
    if (!valid()) return;                           // let the page show its own "enter a topic" message
    e.preventDefault(); e.stopImmediatePropagation(); start();
  }, true);
  // Enter in the topic field acts like pressing the button
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && burning) { e.preventDefault(); cancel('undo'); return; }
    if (e.key !== 'Enter' || e.isComposing || bypass || !reqSel || !e.target.matches || !e.target.matches(reqSel)) return;
    if (burning) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!valid() || btn.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation(); start();
  }, true);
  // editing the topic or the scene count while the fuse burns relights it, so what runs is what is on screen
  const onEdit = (e) => { if (!burning || !watched(e.target)) return; if (!valid()) cancel('invalid'); else restart(); };
  document.addEventListener('input', onEdit); document.addEventListener('change', onEdit);
  // never start anything behind the user's back
  addEventListener('hashchange', () => cancel('left')); addEventListener('pagehide', () => cancel('left'));
  document.addEventListener('visibilitychange', () => {
    if (!burning) return;
    if (document.hidden) { left = deadline - performance.now(); cancelAnimationFrame(raf); }
    else { deadline = performance.now() + Math.max(left, 800); raf = requestAnimationFrame(tick); }
  });
  btn.__fuseApi = { cancel: () => cancel('undo'), isBurning: () => burning };
}

/* ---------------- boot + auto-pickup of new elements ---------------- */
function initOne(el) {
  const k = el.getAttribute('data-fx') || '';
  if (k.includes('glow')) initGlow(el);
  if (k.includes('pixel')) initPixel(el);
  if (k.includes('stack')) initStack(el);
  if (k.includes('fuse')) initFuse(el);
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
