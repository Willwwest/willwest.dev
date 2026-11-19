// 404: the numerals as a point cloud that has come apart. Points near the cursor (or a finger)
// pull back into place and slowly drift loose again once it moves on. With no pointer around,
// an invisible one wanders the numerals so touch screens and idle visitors still see it mend.
import { Points, Vector2 } from 'three';
import { stage, run, material, buffers, rng, clamp01, easeInOut, reduce } from './lib.js';

const FONT = '800 320px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const STEP = 5;

function sample() {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = FONT;
  const w = Math.ceil(g.measureText('404').width) + 40, h = 300;
  c.width = w; c.height = h;
  g.font = FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.fillText('404', w / 2, h / 2 + 12);
  const px = g.getImageData(0, 0, w, h).data;
  const R = rng(404), out = [];
  for (let y = 0; y < h; y += STEP) {
    for (let x = 0; x < w; x += STEP) {
      const jx = Math.min(w - 1, Math.floor(x + R() * STEP)), jy = Math.min(h - 1, Math.floor(y + R() * STEP));
      // normalised by width, so the shape scales as one unit
      if (px[(jy * w + jx) * 4 + 3] > 128) out.push((jx - w / 2) / w, (h / 2 - jy) / w);
    }
  }
  return out;
}

export function mount(host) {
  const st = stage(host);
  const home = sample(), N = home.length / 2;
  const R = rng(4040);
  const dir = new Float32Array(N * 3), drift = new Float32Array(N * 2), heal = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, r = 0.12 + Math.pow(R(), 0.7) * 0.5, q = Math.sqrt(1 - u * u);
    dir[i * 3] = q * Math.cos(a) * r; dir[i * 3 + 1] = q * Math.sin(a) * r * 0.8; dir[i * 3 + 2] = u * r * 1.6;
    drift[i * 2] = R() * Math.PI * 2; drift[i * 2 + 1] = 0.3 + R() * 0.5;
    heal[i] = reduce ? 1 : R() * 0.3;
  }
  const pts = buffers(N);
  const mat = material(st, { points: true, maskK: 0.45, glow: 0 });
  const P = new Points(pts.g, mat);
  P.frustumCulled = false;
  st.scene.add(P);

  const main = document.querySelector('main');
  const fitMask = () => main && st.maskRect(main.getBoundingClientRect(), 10);

  const cur = new Vector2(1e5, 1e5), ptr = new Vector2(1e5, 1e5), auto = new Vector2(), FAR = new Vector2(1e5, 1e5);
  let lastMove = -1e9, clock = 0;
  const onPtr = (e) => { st.toLocal(e.clientX, e.clientY, ptr); lastMove = clock; };
  if (!reduce) {
    addEventListener('pointermove', onPtr, { passive: true });
    addEventListener('pointerdown', onPtr, { passive: true });
  }

  run(st, host, (dt, t) => {
    clock = t;
    const S = Math.min(st.w * 0.9, 1150);
    const idle = t - lastMove > 2.2;
    if (idle) {
      auto.set(Math.sin(t * 0.43) * S * 0.42, Math.sin(t * 0.97 + 0.6) * S * 0.11);
      cur.lerp(auto, 1 - Math.exp(-dt * 2));
    } else cur.lerp(ptr, 1 - Math.exp(-dt * 14));
    const reach = Math.max(90, S * 0.13);
    for (let i = 0; i < N; i++) {
      const hx = home[i * 2] * S, hy = home[i * 2 + 1] * S;
      if (!reduce) {
        const d = Math.hypot(hx - cur.x, hy - cur.y);
        heal[i] = clamp01(heal[i] + (d < reach ? dt * 4.5 * (1 - d / reach) : 0) - dt * 0.16);
      }
      const e = easeInOut(heal[i]), loose = 1 - e;
      const w = drift[i * 2] + t * drift[i * 2 + 1];
      const n = i * 3;
      pts.pos[n] = hx + (dir[n] * S + Math.sin(w) * 10) * loose;
      pts.pos[n + 1] = hy + (dir[n + 1] * S + Math.cos(w * 1.3) * 10) * loose;
      pts.pos[n + 2] = (dir[n + 2] * S) * loose;
      pts.alpha[i] = 0.2 + 0.5 * e;
      pts.size[i] = 1.8 + 0.8 * e;
    }
    pts.dirty();
    st.u.mouse.value.copy(idle ? FAR : cur);
    mat.uniforms.uGlow.value = idle ? 0 : 0.6;
  }, { still: reduce, onResize: fitMask, onFirst: () => { fitMask(); host.classList.add('on'); } });
}
