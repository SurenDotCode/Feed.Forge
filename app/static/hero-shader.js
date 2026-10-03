// FeedForge hero v2: "liquid gold topography". One fragment shader, raw WebGL, zero libraries (~5 KB).
// Domain-warped flow field drawn as gold contour lines on ink, with cursor-driven ripples and parallax.
// Usage:  import { mountHero } from '/static/hero-shader.js';
//         const h = await mountHero(document.getElementById('hero'));
// Navigation-safe: it pauses itself when its section is hidden (display:none) or off screen, and resumes by itself.
// Never call destroy() just because the user navigated; only use it if the hero is permanently removed.
// Options: mountHero(host, { calm: 'center' | 'left' (default), shift, quality }).  calm:'center' keeps the middle dark for centered text.
// h.refresh() forces a redraw after the hero becomes visible again. h.pause() / h.resume() are optional manual controls.
const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `
#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uEnergy; uniform float uShift; uniform float uCalm;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  p.x-=uShift;                                   // push the art toward the right on desktop
  vec2 m=(uMouse*uRes-.5*uRes)/uRes.y; m.x-=uShift;
  p+=(uMouse-.5)*.10;                            // parallax
  float d=length(p-m);
  p+=normalize(p-m+1e-4)*.07*uEnergy*exp(-d*2.6)*sin(d*20.-uTime*3.2);  // ripples
  float t=uTime;
  vec2 q=vec2(fbm(p*1.25+vec2(0.,t*.05)),fbm(p*1.25+vec2(5.2,1.3)-t*.04));
  vec2 r=vec2(fbm(p*1.45+3.*q+vec2(1.7,9.2)+t*.06),fbm(p*1.45+3.*q+vec2(8.3,2.8)-t*.05));
  float f=fbm(p*1.2+3.4*r);
  float k=f*11.;
  float tt=abs(fract(k)-.5)*2.;
#ifdef GL_OES_standard_derivatives
  float w=clamp(fwidth(k)*1.6,.02,.5);
  float line=smoothstep(1.-.07-w,1.-.01,tt)*(1.-smoothstep(.18,.5,w));   // fade lines where they get too dense
#else
  float line=smoothstep(.90,.985,tt);
#endif
  float glow=smoothstep(.88,1.,tt)*.0+smoothstep(.2,.9,f)*.16;
  vec3 ink=vec3(.102);
  vec3 gold=vec3(.651,.545,.357);
  vec3 cream=vec3(.97,.96,.93);
  vec2 cq=(uv-.5)*vec2(1.1,1.0);
  float mC=smoothstep(.16,.68,length(cq));                   // calm zone in the middle (centered hero)
  float mask=mix(mix(.16,.09,uCalm),1.,mix(smoothstep(.12,.72,uv.x),mC,uCalm));   // calm zone on the left, or in the middle
  vec3 col=ink+gold*glow*mask;
  float hi=smoothstep(.62,.9,f)*smoothstep(.97,1.,tt);    // rare cream highlights on peaks
  col+=mix(gold,cream,hi)*line*(.35+.65*f)*mask*1.15;
  float vg=smoothstep(1.25,.25,length(uv-.5)*1.15);
  col*=mix(.55,1.,vg);
  gl_FragColor=vec4(col,1.);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export async function mountHero(host, opts = {}) {
  const NOOP = { ok: false, destroy() {}, refresh() {}, pause() {}, resume() {} };
  if (!host) return NOOP;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 700ms ease' });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(canvas);

  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.remove(); return NOOP; }
  const U = {};
  function build() {                       // (re)creates every GL resource; also used after a context restore
    gl.getExtension('OES_standard_derivatives');   // must be enabled BEFORE compiling the shader
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['uRes', 'uTime', 'uMouse', 'uEnergy', 'uShift', 'uCalm']) U[k] = gl.getUniformLocation(prog, k);
  }
  try { build(); } catch (e) { canvas.remove(); return NOOP; }

  let alive = true, ctxLost = false, manualPause = false, wide = true, maxOp = 1;
  const shown = () => host.getClientRects().length > 0 && !document.hidden;   // false while display:none
  const inView = () => { const r = host.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

  function resize() {
    let w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) { if (canvas.width > 2) return false; w = innerWidth; h = innerHeight; }   // hidden: keep last size
    wide = w >= 900;
    let scale = Math.min(devicePixelRatio || 1, 1.5) * (opts.quality ?? 0.7);
    const px = w * h * scale * scale, cap = 1.3e6;
    if (px > cap) scale *= Math.sqrt(cap / px);
    const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
    if (cw !== canvas.width || ch !== canvas.height) { canvas.width = cw; canvas.height = ch; }   // this CLEARS the canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    maxOp = wide ? 1 : 0.4;
    return true;
  }

  const mouse = { x: .6, y: .5, tx: .6, ty: .5, e: 0 };
  let lastMove = 0;
  const onMove = (ev) => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    mouse.tx = (ev.clientX - r.left) / r.width; mouse.ty = 1 - (ev.clientY - r.top) / r.height;
    lastMove = performance.now();
  };
  addEventListener('pointermove', onMove, { passive: true });

  let raf = 0, running = false, t0 = performance.now(), tPaused = 0, pauseAt = performance.now();
  function draw(now) {
    if (ctxLost || !alive) return;
    const sy = Math.min(scrollY / Math.max(host.clientHeight, 1), 1.2);
    mouse.x += (mouse.tx - mouse.x) * .06; mouse.y += (mouse.ty - mouse.y) * .06;
    mouse.e += (((now - lastMove < 900) ? 1 : 0) - mouse.e) * .05;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, (now - t0 - tPaused) / 1000 + 12.);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uEnergy, mouse.e);
    gl.uniform1f(U.uShift, wide ? (opts.shift ?? (opts.calm === 'center' ? 0. : 0.25)) : 0.);
    gl.uniform1f(U.uCalm, opts.calm === 'center' ? 1. : 0.);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.style.opacity = String(maxOp * Math.max(0, 1 - sy * .9));
  }
  function loop(now) { raf = requestAnimationFrame(loop); draw(now); }
  function start() {
    if (running || reduce || manualPause || ctxLost || !alive) return;
    running = true; tPaused += performance.now() - pauseAt; raf = requestAnimationFrame(loop);
  }
  function stop() { if (running) { running = false; pauseAt = performance.now(); cancelAnimationFrame(raf); } }

  // Bring the hero back to a correct, painted, running state. Safe to call at any time.
  function refresh() {
    if (!alive || ctxLost) return;
    if (!shown()) { stop(); return; }
    resize();                              // resizing wipes the canvas, so always repaint right after
    draw(performance.now());
    canvas.style.opacity = String(maxOp * Math.max(0, 1 - Math.min(scrollY / Math.max(host.clientHeight, 1), 1.2) * .9));
    if (inView()) start(); else stop();
  }

  const ro = new ResizeObserver(refresh); ro.observe(host);
  const io = new IntersectionObserver(refresh); io.observe(host);
  const onVis = () => refresh();
  document.addEventListener('visibilitychange', onVis);
  const onScroll = () => { if (!running && shown()) draw(performance.now()); };   // keeps the scroll fade right while paused
  addEventListener('scroll', onScroll, { passive: true });

  // GPU context loss (tab discard, driver reset): rebuild everything when the browser gives it back
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ctxLost = true; stop(); });
  canvas.addEventListener('webglcontextrestored', () => { try { build(); ctxLost = false; refresh(); } catch (e) {} });

  // Self-healing watchdog: whatever the page's router does, a visible hero is never left blank for more than ~1.5s
  const heal = setInterval(() => {
    if (!alive || ctxLost || manualPause) return;
    if (shown() && inView()) {
      if (canvas.width <= 2 || canvas.style.opacity === '0') refresh();
      else if (!running && !reduce) { refresh(); }
    }
  }, 1500);

  refresh();
  canvas.style.opacity = String(maxOp);
  if (reduce) draw(performance.now());

  return {
    ok: true,
    refresh,
    pause() { manualPause = true; stop(); },
    resume() { manualPause = false; refresh(); },
    destroy() {
      alive = false; stop(); clearInterval(heal); ro.disconnect(); io.disconnect();
      removeEventListener('pointermove', onMove); removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      const ext = gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext();
      canvas.remove();
    }
  };
}
export { mountHero as mountHero3D };   // alias so older wiring keeps working
