// Shared plumbing for every scene: a renderer whose z=0 plane maps one world unit to one CSS
// pixel (origin at the canvas centre, +y up), a soft round point / hairline shader, and a
// render loop that only runs while its canvas is on screen and the tab is visible.
import {
  WebGLRenderer, PerspectiveCamera, Scene, ShaderMaterial,
  BufferGeometry, BufferAttribute, DynamicDrawUsage, Vector2, Vector3, Vector4,
} from 'three';

export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

// Seeded, so every visitor sees the same constellation and the layout never jumps on reload.
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// smoothstep; a > b is allowed and runs the ramp the other way
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// One shader for points and lines. Two page-aware extras live here so no scene re-implements
// them: uMask dims anything drawn under a block of text (rect in canvas pixels, y up), so the
// copy above keeps its contrast; uMouse/uGlow brighten whatever sits near the pointer.
const VERT = /* glsl */ `
attribute float alpha;
#ifdef POINTS
attribute float size;
#endif
uniform float uDpr, uDist, uMaskK, uGlow;
uniform vec2 uHalf, uMouse;
uniform vec4 uMask;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float persp = uDist / max(1.0, -mv.z);
  vec2 px = gl_Position.xy / gl_Position.w * uHalf;
  float edge = min(min(px.x - uMask.x, uMask.z - px.x), min(px.y - uMask.y, uMask.w - px.y));
  float near = 1.0 - smoothstep(0.0, 170.0, length(px - uMouse));
  vA = alpha * clamp(persp, 0.5, 1.3) * mix(1.0, uMaskK, smoothstep(-24.0, 36.0, edge))
             * (1.0 + uGlow * near);
#ifdef POINTS
  gl_PointSize = max(1.0, size * uDpr * persp * (1.0 + 0.3 * uGlow * near));
#endif
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float a = vA;
#ifdef POINTS
  a *= 1.0 - smoothstep(0.26, 0.5, length(gl_PointCoord - 0.5));
#endif
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, min(a, 1.0));
}`;

// --t1-ish cool grey rather than #fff, matching the keyline the logo wall uses
const INK = [0.84, 0.85, 0.88];

export function material(st, { points = false, color = INK, maskK = 1, glow = 0 } = {}) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: points ? { POINTS: '' } : {},
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uDpr: st.u.dpr, uDist: st.u.dist, uHalf: st.u.half, uMouse: st.u.mouse, uMask: st.u.mask,
      uMaskK: { value: maskK }, uGlow: { value: glow }, uColor: { value: new Vector3(...color) },
    },
  });
}

// Position + per-vertex alpha (+ size for points), all rewritten every frame.
export function buffers(n, { sizes = true } = {}) {
  const g = new BufferGeometry();
  const pos = new Float32Array(n * 3), alpha = new Float32Array(n), size = sizes ? new Float32Array(n) : null;
  const attrs = [
    ['position', new BufferAttribute(pos, 3)],
    ['alpha', new BufferAttribute(alpha, 1)],
    ...(sizes ? [['size', new BufferAttribute(size, 1)]] : []),
  ];
  for (const [name, a] of attrs) { a.setUsage(DynamicDrawUsage); g.setAttribute(name, a); }
  return { g, pos, alpha, size, dirty() { for (const [, a] of attrs) a.needsUpdate = true; } };
}

// A line set that reuses another buffer's positions, joined by an index of vertex pairs.
export function linesOver(src, pairs) {
  const g = new BufferGeometry();
  const alpha = new Float32Array(src.pos.length / 3);
  const a = new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage);
  g.setAttribute('position', src.g.getAttribute('position'));
  g.setAttribute('alpha', a);
  g.setIndex(pairs);
  return { g, alpha, dirty() { a.needsUpdate = true; } };
}

export function stage(host, { maxDpr = 1.75 } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const camera = new PerspectiveCamera(32, 1, 10, 10000);
  const scene = new Scene();
  const u = {
    dpr: { value: 1 }, dist: { value: 1 }, half: { value: new Vector2(1, 1) },
    mouse: { value: new Vector2(1e5, 1e5) },
    // x0 > x1 is an empty rect: nothing dimmed until a scene sets one
    mask: { value: new Vector4(1e5, 1e5, -1e5, -1e5) },
  };
  const st = {
    renderer, camera, scene, u, w: 0, h: 0,
    resize() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(devicePixelRatio || 1, maxDpr);
      st.w = w; st.h = h;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      const dist = h / 2 / Math.tan((camera.fov * Math.PI) / 360);
      camera.aspect = w / h;
      camera.position.set(0, 0, dist);
      camera.far = dist + 6000;
      camera.updateProjectionMatrix();
      u.dpr.value = dpr; u.dist.value = dist; u.half.value.set(w / 2, h / 2);
      return true;
    },
    // a DOM rect -> the mask uniform, in this canvas's centred, y-up pixel space
    maskRect(r, pad = 0) {
      const c = host.getBoundingClientRect();
      const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
      u.mask.value.set(r.left - cx - pad, cy - r.bottom - pad, r.right - cx + pad, cy - r.top + pad);
    },
    toLocal(clientX, clientY, out) {
      const c = host.getBoundingClientRect();
      return out.set(clientX - (c.left + c.width / 2), c.top + c.height / 2 - clientY);
    },
  };
  st.resize();
  return st;
}

// Drives frame(dt, t) then a render. Runs only while the host intersects the viewport and the
// tab is visible. still: draw one frame per resize/visibility change and never loop, which is
// what reduced-motion visitors get.
export function run(st, host, frame, { still = false, onResize, onFirst } = {}) {
  let visible = false, raf = 0, last = 0, t = 0, first = true;
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now; t += dt;
    frame(dt, t);
    st.renderer.render(st.scene, st.camera);
    if (first) { first = false; onFirst && onFirst(); }
    if (!still && visible && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (!raf && visible && !document.hidden && st.w) { last = 0; raf = requestAnimationFrame(tick); }
  };
  new IntersectionObserver((es) => {
    visible = es[es.length - 1].isIntersecting;
    if (visible) kick(); else { cancelAnimationFrame(raf); raf = 0; }
  }).observe(host);
  new ResizeObserver(() => { if (st.resize()) { onResize && onResize(); kick(); } }).observe(host);
  document.addEventListener('visibilitychange', kick);
  return { kick };
}
