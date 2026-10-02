// FeedForge hero v2: "liquid gold topography". One fragment shader, raw WebGL, zero libraries (~5 KB).
// Domain-warped flow field drawn as gold contour lines on ink, with cursor-driven ripples and parallax.
// Usage:  import { mountHero } from '/static/hero-shader.js';
//         const h = await mountHero(document.getElementById('hero'));   // h.destroy() to remove
const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `
#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uEnergy; uniform float uShift;
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
  float mask=mix(.16,1.,smoothstep(.12,.72,uv.x));        // keep the text side calm
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
  if (!host) return { ok: false, destroy() {} };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 700ms ease' });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(canvas);

  let gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) { canvas.remove(); return { ok: false, destroy() {} }; }
  gl.getExtension('OES_standard_derivatives');   // must be enabled BEFORE compiling the shader
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
  } catch (e) { canvas.remove(); return { ok: false, destroy() {} }; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {}; for (const k of ['uRes', 'uTime', 'uMouse', 'uEnergy', 'uShift']) U[k] = gl.getUniformLocation(prog, k);

  // render at a reduced internal resolution: the field is soft, so it looks the same and costs far less
  let wide = true, maxOp = 1;
  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    wide = w >= 900;
    let scale = Math.min(devicePixelRatio || 1, 1.5) * (opts.quality ?? 0.7);
    const px = w * h * scale * scale, cap = 1.3e6;
    if (px > cap) scale *= Math.sqrt(cap / px);
    canvas.width = Math.max(2, Math.round(w * scale)); canvas.height = Math.max(2, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    maxOp = wide ? 1 : 0.4;
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  const mouse = { x: .6, y: .5, tx: .6, ty: .5, e: 0 };
  let lastMove = 0;
  const onMove = (ev) => {
    const r = host.getBoundingClientRect();
    mouse.tx = (ev.clientX - r.left) / r.width; mouse.ty = 1 - (ev.clientY - r.top) / r.height;
    lastMove = performance.now();
  };
  addEventListener('pointermove', onMove, { passive: true });

  let raf = 0, running = false, visible = true, t0 = performance.now(), tPaused = 0, pauseAt = 0;
  function draw(now) {
    const sy = Math.min(scrollY / Math.max(host.clientHeight, 1), 1.2);
    mouse.x += (mouse.tx - mouse.x) * .06; mouse.y += (mouse.ty - mouse.y) * .06;
    mouse.e += (((now - lastMove < 900) ? 1 : 0) - mouse.e) * .05;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, (now - t0 - tPaused) / 1000 + 12.);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uEnergy, mouse.e);
    gl.uniform1f(U.uShift, wide ? (opts.shift ?? 0.25) : 0.);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.style.opacity = String(maxOp * Math.max(0, 1 - sy * .9));
  }
  function loop(now) { raf = requestAnimationFrame(loop); draw(now); }
  function start() { if (!running && !reduce) { running = true; tPaused += performance.now() - pauseAt; raf = requestAnimationFrame(loop); } }
  function stop() { if (running) { running = false; pauseAt = performance.now(); cancelAnimationFrame(raf); } }
  pauseAt = performance.now();

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; (visible && !document.hidden) ? start() : stop(); });
  io.observe(host);
  const onVis = () => (document.hidden || !visible) ? stop() : start();
  document.addEventListener('visibilitychange', onVis);

  draw(performance.now());                 // first frame immediately (also the still frame for reduced motion)
  canvas.style.opacity = String(maxOp);
  tPaused = 0; if (!reduce) { pauseAt = performance.now(); start(); }

  return {
    ok: true,
    destroy() {
      stop(); ro.disconnect(); io.disconnect();
      removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      const ext = gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext();
      canvas.remove();
    }
  };
}
export { mountHero as mountHero3D };   // alias so older wiring keeps working
