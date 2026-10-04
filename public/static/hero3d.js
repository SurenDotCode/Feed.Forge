// FeedForge 3D hero: a drifting helix of vertical 9:16 "video frames" in gold on ink.
// Self-contained, no logos, no external requests (three.js is vendored locally).
// Usage:  import { mountHero3D } from '/static/hero3d.js';
//         const hero = await mountHero3D(document.getElementById('hero'));  // hero.destroy() to remove
import * as THREE from '/static/vendor/three.module.min.js';

const GOLD = 0xa68b5b, CREAM = 0xf7f6f3, INK = 0x1a1a1a;

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export async function mountHero3D(host, opts = {}) {
  if (!host || !webglOK()) return { destroy() {}, ok: false };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '0', pointerEvents: 'none', touchAction: 'pan-y', opacity: '0',
    transition: 'opacity 900ms ease'
  });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(INK, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 15);

  const world = new THREE.Group();
  scene.add(world);

  // ---- frames along a helix ----
  const FRAMES = opts.frames || 26;
  const W = 0.9, H = 1.6; // 9:16
  const plane = new THREE.PlaneGeometry(W, H);
  const edges = new THREE.EdgesGeometry(plane);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FRAMES;
    const angle = t * Math.PI * 3.4;
    const radius = 3.0 + Math.sin(t * 9) * 0.15;
    const g = new THREE.Group();
    g.position.set(Math.cos(angle) * radius, (t - 0.5) * 7.4, Math.sin(angle) * radius);
    g.rotation.y = -angle + Math.PI / 2;
    g.rotation.z = Math.sin(t * 7) * 0.05;
    const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: i % 6 === 0 ? CREAM : GOLD, transparent: true, opacity: i % 6 === 0 ? 0.9 : 0.55 }));
    // a thin "progress bar" under each frame, like a video scrubber
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8 * (0.2 + 0.8 * ((i * 37) % 100) / 100), 0.025),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7 }));
    bar.position.set(-W * 0.4 + (W * 0.8 * (0.2 + 0.8 * ((i * 37) % 100) / 100)) / 2, -H / 2 + 0.12, 0.001);
    g.add(fill, line, bar);
    g.userData = { phase: Math.random() * Math.PI * 2, baseY: g.position.y };
    world.add(g);
    frames.push(g);
  }

  // ---- fine cream dust ----
  const N = 260, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 22;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: CREAM, size: 0.035, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false }));
  scene.add(dust);

  // ---- layout / resize ----
  let wide = true, maxOp = 1;
  function resize() {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    wide = w >= 900;
    // keep the helix right of the text column on desktop, centered and smaller on mobile
    const shift = (opts.offsetX ?? 2.6);
    world.position.x = wide ? shift : 0;
    world.scale.setScalar(wide ? 1 : 0.5);
    world.position.y = 0;
    maxOp = wide ? 1 : 0.32;
    canvas.style.opacity = String(maxOp);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- interaction ----
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // ---- loop (paused when hidden / offscreen) ----
  let raf = 0, running = false, visible = true, last = performance.now(), spin = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    spin += dt * 0.12;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    const sy = Math.min(window.scrollY / Math.max(host.clientHeight, 1), 1.2);
    world.rotation.y = spin + mouse.x * 0.35;
    world.rotation.x = mouse.y * 0.12 - 0.08;
    world.position.y = sy * 2.2;
    dust.rotation.y = -spin * 0.4;
    for (const f of frames) f.position.y = f.userData.baseY + Math.sin(now * 0.0006 + f.userData.phase) * 0.12;
    canvas.style.opacity = String(maxOp * Math.max(0, 1 - sy * 0.9));
    renderer.render(scene, camera);
  }
  function start() { if (!running && !reduce) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible && !document.hidden ? start() : stop(); }, { threshold: 0 });
  io.observe(host);
  const onVis = () => (document.hidden || !visible) ? stop() : start();
  document.addEventListener('visibilitychange', onVis);

  // first paint, then fade in; reduced motion shows one still frame
  frame(performance.now()); cancelAnimationFrame(raf);
  canvas.style.opacity = String(maxOp);
  if (!reduce) start();

  return {
    ok: true,
    destroy() {
      stop(); ro.disconnect(); io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      plane.dispose(); edges.dispose(); dustGeo.dispose(); renderer.dispose();
      canvas.remove();
    }
  };
}
