// FeedForge ff-actions.js : job actions (More menu, delete with undo), toast, compact specs panel. Vanilla JS.
// Mark every job card and gallery tile with data-job-id="<id>". Everything is idempotent, so call the mount functions on every card update.
//   FFActions.configure({ topicSelector: '#topic', createCardSelector: '#create-card', undoMs: 6000 })
//   FFActions.mountJobExtras(el, job)            // compact specs panel under the video
//   FFActions.mountJobActions(el, job)           // adds the [More v] menu to the card's button row
//   FFActions.mountTileActions(el, job)          // gallery tile: a small "..." menu
//   FFActions.isHidden(id)                       // true for jobs hidden locally (server delete not available): skip them when rendering
// Event: document 'ff:job-deleted' {detail:{id}} when a job was deleted or hidden, so the page can drop its node from its own map.
const cfg = { topicSelector: '', createCardSelector: '', siteName: 'FeedForge', undoMs: 6000 };
const HIDE_KEY = 'ff-hidden-jobs';
const hidden = (() => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch (e) { return new Set(); } })();
const saveHidden = () => { try { localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden])); } catch (e) {} };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const abs = (u) => new URL(u, location.origin).href;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nodesFor = (id) => [...document.querySelectorAll('[data-job-id="' + CSS.escape(id) + '"]')];
const hasVideo = (j) => !!j.video_url;

/* ---------- toast (single live region, optional Undo) ---------- */
let toastEl = null, toastTimer = 0, current = null;
export function toast(msg, o = {}) {
  if (current) current.commit();                          // a newer toast commits the older pending action
  if (!toastEl) {
    toastEl = document.createElement('div'); toastEl.className = 'ffa-toast';
    toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.innerHTML = '<span>' + esc(msg) + '</span>' + (o.action ? '<button type="button" class="ffa-toast-btn">' + esc(o.action) + '</button>' : '');
  toastEl.classList.add('show');
  let done = false;
  const finish = (cb) => { if (done) return; done = true; clearTimeout(toastTimer); toastEl.classList.remove('show'); if (current === me) current = null; cb && cb(); };
  const me = { commit: () => finish(o.onExpire) };
  current = me;
  const b = toastEl.querySelector('button'); b && b.addEventListener('click', () => finish(o.onAction));
  toastTimer = setTimeout(() => finish(o.onExpire), o.ms || 4200);
}

/* ---------- delete with an undo window ---------- */
const pending = new Map();
export function deleteJob(job) {
  const id = job.id, nodes = nodesFor(id);
  nodes.forEach((n) => n.setAttribute('hidden', ''));     // optimistic hide
  let settled = false;
  const gone = () => { nodes.forEach((n) => n.remove()); document.dispatchEvent(new CustomEvent('ff:job-deleted', { detail: { id } })); };
  const commit = async () => {
    if (settled) return; settled = true; pending.delete(id);
    try {
      const r = await fetch('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE', keepalive: true });
      if (r.ok || r.status === 404) gone();
      else if (r.status === 405) { hidden.add(id); saveHidden(); gone(); toast('Removed from this view. Server-side delete is not available yet.', { ms: 5000 }); }
      else if (r.status === 409) { nodes.forEach((n) => n.removeAttribute('hidden')); toast('That video is still running. Try again when it finishes.', { ms: 5000 }); }
      else throw new Error('status ' + r.status);
    } catch (e) { nodes.forEach((n) => n.removeAttribute('hidden')); toast("Couldn't delete it. Check the connection and try again.", { ms: 5000 }); }
  };
  pending.set(id, commit);
  toast('Video deleted.', { action: 'Undo', ms: cfg.undoMs,
    onAction: () => { settled = true; pending.delete(id); nodes.forEach((n) => n.removeAttribute('hidden')); }, onExpire: commit });
}
addEventListener('pagehide', () => pending.forEach((fn) => fn()));

/* ---------- small actions ---------- */
async function copyLink(job) {
  try { await navigator.clipboard.writeText(abs(job.video_url)); toast('Link copied.'); }
  catch (e) { toast('Copy failed. Use Open in new tab and copy the address.', { ms: 5000 }); }
}
const canShareFiles = () => { try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.mp4', { type: 'video/mp4' })] }); } catch (e) { return false; } };
async function shareVideo(job) {
  try {
    const blob = await (await fetch(abs(job.video_url))).blob();
    const file = new File([blob], 'feedforge-' + job.id + '.mp4', { type: blob.type || 'video/mp4' });
    const pp = job.publish_pack || {};
    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: pp.title || job.topic, text: [pp.caption, (pp.hashtags || []).join(' ')].filter(Boolean).join('\n') });
  } catch (e) { if (e && e.name !== 'AbortError') toast("Couldn't share this video.", { ms: 5000 }); }
}
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function downloadScript(job) {
  const p = job.plan || {}, pp = job.publish_pack || {};
  const lines = ['TITLE: ' + (pp.title || p.title || job.topic), 'HOOK: ' + (p.hook || ''), 'CAPTION: ' + (pp.caption || p.caption || ''), 'HASHTAGS: ' + ((pp.hashtags || p.hashtags || []).join(' ')), ''];
  (p.scenes || []).forEach((s, i) => { lines.push('SCENE ' + (i + 1), 'Narration: ' + s.narration, 'Visual: ' + s.visual_prompt, ''); });
  saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), 'feedforge-' + job.id + '-script.txt');
}
function downloadVideo(job) { const a = document.createElement('a'); a.href = abs(job.video_url); a.download = 'feedforge-' + job.id + '.mp4'; document.body.appendChild(a); a.click(); a.remove(); }
function reuseTopic(job) {
  const input = cfg.topicSelector && document.querySelector(cfg.topicSelector);
  if (!input) { toast('Open the Create page first.'); return; }
  input.value = job.topic; input.dispatchEvent(new Event('input', { bubbles: true }));
  const target = (cfg.createCardSelector && document.querySelector(cfg.createCardSelector)) || input;
  target.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' });
  input.focus({ preventScroll: true }); input.select();
  toast('Topic loaded. Edit it if you like, then press Generate.', { ms: 5000 });
}

/* ---------- menu (rendered in <body>, so cards can never clip it) ---------- */
let menu = null;
function closeMenu(refocus) { if (!menu) return; const { el, btn } = menu; el.remove(); btn.setAttribute('aria-expanded', 'false'); menu = null; if (refocus) btn.focus(); }
function openMenu(btn, items) {
  if (menu && menu.btn === btn) { closeMenu(true); return; }
  closeMenu(false);
  const m = document.createElement('div'); m.className = 'ffa-menu'; m.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it === '-') { const s = document.createElement('div'); s.className = 'ffa-sep'; s.setAttribute('role', 'separator'); m.appendChild(s); return; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'ffa-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label; b.disabled = !!it.disabled; if (it.title) b.title = it.title;
    b.addEventListener('click', () => { closeMenu(false); it.run(); }); m.appendChild(b);
  });
  document.body.appendChild(m);
  const place = () => {                                   // keeps the menu anchored to its button while the page scrolls or resizes
    const r = btn.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    if (r.bottom < 0 || r.top > innerHeight) { closeMenu(false); return; }   // button scrolled out of view
    let top = r.bottom + 6; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = top + 'px'; m.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
  };
  place(); btn.setAttribute('aria-expanded', 'true'); menu = { el: m, btn, place };
  const first = m.querySelector('.ffa-item:not(:disabled)'); first && first.focus();
  m.addEventListener('keydown', (e) => {
    const its = [...m.querySelectorAll('.ffa-item:not(:disabled)')], i = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  });
}
document.addEventListener('pointerdown', (e) => { if (menu && !menu.el.contains(e.target) && !menu.btn.contains(e.target)) closeMenu(false); });
addEventListener('scroll', () => { if (menu) menu.place(); }, { passive: true, capture: true });
addEventListener('resize', () => { if (menu) menu.place(); });

function itemsFor(job, full) {
  const v = hasVideo(job), list = [];
  if (v) {
    if (!full) list.push({ label: 'Download MP4', run: () => downloadVideo(job) });
    list.push({ label: 'Copy link', run: () => copyLink(job) });
    if (canShareFiles()) list.push({ label: 'Share…', run: () => shareVideo(job) });
    list.push({ label: 'Open in new tab', run: () => window.open(abs(job.video_url), '_blank', 'noopener') });
  }
  if (full && job.plan && (job.plan.scenes || []).length) list.push({ label: 'Download script (.txt)', run: () => downloadScript(job) });
  if (full) list.push({ label: 'Reuse topic', run: () => reuseTopic(job) });
  list.push('-');
  const ok = job.status === 'done' || job.status === 'failed';
  list.push({ label: 'Delete', danger: true, disabled: !ok, title: ok ? '' : 'Wait for the job to finish', run: () => deleteJob(job) });
  return list;
}

/* ---------- mounting (idempotent) ---------- */
export function mountJobActions(el, job) {
  if (!el || !job) return;
  const sig = [job.id, job.status, job.video_url || ''].join('|');
  if (el.__sig === sig) return; el.__sig = sig;
  el.classList.add('ffa-actions');
  el.innerHTML = '<button type="button" class="ffa-btn ffa-more" aria-haspopup="menu" aria-expanded="false">More <span aria-hidden="true">▾</span></button>';
  const btn = el.querySelector('.ffa-more');
  btn.addEventListener('click', () => openMenu(btn, itemsFor(job, true)));
}
export function mountTileActions(el, job) {
  if (!el || !job) return;
  const sig = [job.id, job.status, job.video_url || ''].join('|');
  if (el.__sig === sig) return; el.__sig = sig;
  el.innerHTML = '<button type="button" class="ffa-tilebtn" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ' + esc(job.topic) + '">⋯</button>';
  const btn = el.querySelector('button');
  btn.addEventListener('click', () => openMenu(btn, itemsFor(job, false)));
}
export function mountJobExtras(el, job) {
  if (!el || !job) return;
  const sig = [job.id, job.status, job.quality ? job.quality.duration_s : ''].join('|');
  if (el.__sig === sig) return; el.__sig = sig;
  if (job.status !== 'done') { el.innerHTML = ''; return; }
  const q = job.quality || {}, checks = q.checks || {}, keys = Object.keys(checks), passed = keys.filter((k) => checks[k]).length;
  const row = (k, v) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>';
  el.innerHTML = '<div class="ffa-panel"><div class="ffa-h">Video specs</div><dl class="ffa-specs">' +
    row('Length', q.duration_s != null ? Number(q.duration_s).toFixed(1) + ' s' : 'n/a') +
    row('Format', checks.resolution_1080x1920 ? '1080×1920' : '9:16') +
    row('Size', q.size_mb != null ? esc(q.size_mb) + ' MB' : 'n/a') +
    row('Checks', keys.length ? passed + '/' + keys.length + ' passed' : 'n/a') + '</dl></div>';
}

export const configure = (o) => Object.assign(cfg, o);
export const isHidden = (id) => hidden.has(id);
window.FFActions = { configure, isHidden, toast, deleteJob, mountJobActions, mountTileActions, mountJobExtras };
document.dispatchEvent(new CustomEvent('ff:actions-ready'));
