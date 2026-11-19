// Hero constellation. The counts are the headline's: one point per application in production
// (APPS), grouped into one cluster per enterprise (ORGS). Points inside a cluster are joined by
// faint hairlines; every so often a new wire draws itself between two neighbouring clusters and
// the far end flashes as it lands, which is the whole job in one gesture.
import { Points, LineSegments, Group, Vector2 } from 'three';
import { stage, run, material, buffers, rng, smooth, easeOut, reduce, fine } from './lib.js';

const ORGS = 112;
const APPS = 214;
const WIRES = 9;
const GROW = 0.9, HOLD = 2.4, FADE = 1.3;

export function mount(host) {
  const st = stage(host);
  const R = rng(214112);

  // Cluster centres by best-candidate sampling: even coverage without a visible grid. x is
  // weighted because the canvas is wider than it is tall.
  const cx = new Float32Array(ORGS), cy = new Float32Array(ORGS), cz = new Float32Array(ORGS);
  const ph = new Float32Array(ORGS), spin = new Float32Array(ORGS);
  for (let i = 0; i < ORGS; i++) {
    let bx = 0, by = 0, bd = -1;
    for (let k = 0; k < 16; k++) {
      const x = R() * 2 - 1, y = R() * 2 - 1;
      let d = Infinity;
      for (let j = 0; j < i; j++) {
        const dx = (x - cx[j]) * 1.6, dy = y - cy[j];
        d = Math.min(d, dx * dx + dy * dy);
      }
      if (d > bd) { bd = d; bx = x; by = y; }
    }
    cx[i] = bx; cy[i] = by; cz[i] = R() * 2 - 1;
    ph[i] = R() * Math.PI * 2;
    spin[i] = (R() < 0.5 ? -1 : 1) * (0.03 + R() * 0.05);
  }

  // Every enterprise gets one application; the rest are dealt out, at most four per cluster.
  const count = new Uint8Array(ORGS).fill(1);
  for (let left = APPS - ORGS; left > 0;) {
    const o = Math.floor(R() * ORGS);
    if (count[o] < 4) { count[o]++; left--; }
  }
  const org = new Uint16Array(APPS), ox = new Float32Array(APPS), oy = new Float32Array(APPS);
  const oz = new Float32Array(APPS), baseA = new Float32Array(APPS), baseS = new Float32Array(APPS);
  const sx = new Float32Array(APPS), sy = new Float32Array(APPS), sz = new Float32Array(APPS);
  const delay = new Float32Array(APPS), flash = new Float32Array(APPS);
  const pairs = [];
  for (let o = 0, a = 0; o < ORGS; o++) {
    const turn = R() * Math.PI * 2;
    for (let k = 0; k < count[o]; k++, a++) {
      org[a] = o;
      if (count[o] > 1) {
        const ang = turn + (k / count[o]) * Math.PI * 2 + (R() - 0.5) * 0.9, r = 10 + R() * 20;
        ox[a] = Math.cos(ang) * r; oy[a] = Math.sin(ang) * r; oz[a] = (R() - 0.5) * 24;
      }
      if (k) pairs.push(a - 1, a);
      baseA[a] = 0.34 + R() * 0.24;
      baseS[a] = 2.0 + R() * 0.9;
      // where it starts before the load-in pulls it home
      sx[a] = (R() * 2 - 1) * 1.5; sy[a] = (R() * 2 - 1) * 1.5; sz[a] = R() * 2 - 1;
      delay[a] = R() * 0.7;
    }
  }
  const LINKS = pairs.length / 2;

  const pts = buffers(APPS);
  // wires get their own two vertices each (the moving end is not an app), so lines carry a
  // buffer of their own rather than indexing the points
  const ln = buffers((LINKS + WIRES) * 2, { sizes: false });
  const group = new Group();
  const pointMat = material(st, { points: true, maskK: 0.42, glow: 0 });
  const lineMat = material(st, { maskK: 0.42, glow: 0 });
  const P = new Points(pts.g, pointMat), L = new LineSegments(ln.g, lineMat);
  P.frustumCulled = L.frustumCulled = false;
  group.add(L, P);
  st.scene.add(group);

  // Mask the copy block: headline down to the buttons, not the padded column around them.
  const text = host.closest('.hero')?.querySelectorAll('.htxt > *') || [];
  const fitMask = () => {
    if (!text.length) return;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const el of text) {
      const q = el.getBoundingClientRect();
      if (!q.width) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    if (r > l) st.maskRect({ left: l, top: t, right: r, bottom: b }, 8);
  };

  const wires = Array.from({ length: WIRES }, () => ({ a: -1, b: -1, t0: -99, landed: true }));
  const hx = new Float32Array(APPS), hy = new Float32Array(APPS), hz = new Float32Array(APPS);
  let nextWire = 2.4;

  const spawn = (w, t) => {
    const a = Math.floor(R() * APPS);
    let b = -1, bd = Infinity;
    for (let k = 0; k < 28; k++) {
      const c = Math.floor(R() * APPS);
      if (org[c] === org[a]) continue;
      const d = Math.hypot(hx[c] - hx[a], hy[c] - hy[a]);
      if (d > 40 && d < bd) { bd = d; b = c; }
    }
    if (b < 0) return;
    w.a = a; w.b = b; w.t0 = t; w.landed = false;
  };

  // pointer: a light near the cursor and a small parallax tilt, fine pointers only
  const mouse = new Vector2(1e5, 1e5), mouseT = new Vector2(1e5, 1e5);
  let tiltX = 0, tiltY = 0, tx = 0, ty = 0, presence = 0, present = false;
  if (fine && !reduce) {
    addEventListener('pointermove', (e) => {
      st.toLocal(e.clientX, e.clientY, mouseT);
      if (!present) mouse.copy(mouseT);
      present = true;
      tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { present = false; tx = ty = 0; });
  }

  const frame = (dt, t) => {
    const W = st.w / 2, H = st.h / 2, D = Math.min(st.w, 1000) * 0.32;

    for (let i = 0; i < APPS; i++) {
      const o = org[i];
      const a = reduce ? 0 : t * spin[o];
      const c = Math.cos(a), s = Math.sin(a);
      const drift = reduce ? 0 : 1;
      hx[i] = cx[o] * W * 1.03 + Math.sin(t * 0.13 + ph[o]) * 7 * drift + ox[i] * c - oy[i] * s;
      hy[i] = cy[o] * H * 1.03 + Math.cos(t * 0.11 + ph[o]) * 6 * drift + ox[i] * s + oy[i] * c;
      hz[i] = cz[o] * D + oz[i];
    }

    // wires
    if (!reduce) {
      if (t > nextWire) {
        const free = wires.find((w) => t - w.t0 > GROW + HOLD + FADE);
        if (free) spawn(free, t);
        nextWire = t + 0.45 + R() * 0.6;
      }
    } else if (wires[0].a < 0) {
      for (const w of wires) { spawn(w, -GROW - 0.5); w.landed = true; }
    }

    const { pos, alpha, size } = pts;
    for (let i = 0; i < APPS; i++) {
      const e = reduce ? 1 : easeOut(smooth(0, 1, (t - delay[i]) / 2.4));
      pos[i * 3] = sx[i] * W + (hx[i] - sx[i] * W) * e;
      pos[i * 3 + 1] = sy[i] * H + (hy[i] - sy[i] * H) * e;
      pos[i * 3 + 2] = sz[i] * D * 2 + (hz[i] - sz[i] * D * 2) * e;
      flash[i] = Math.max(0, flash[i] - dt * 0.9);
      const f = flash[i] * flash[i];
      alpha[i] = baseA[i] * (0.25 + 0.75 * e) + f * 0.55;
      size[i] = baseS[i] + f * 2.2;
    }

    const lp = ln.pos, la = ln.alpha;
    for (let k = 0; k < LINKS; k++) {
      const a = pairs[k * 2], b = pairs[k * 2 + 1], v = k * 6;
      lp.set(pos.subarray(a * 3, a * 3 + 3), v);
      lp.set(pos.subarray(b * 3, b * 3 + 3), v + 3);
      const e = Math.min(alpha[a], alpha[b]) / 0.58;
      la[k * 2] = la[k * 2 + 1] = 0.15 * e;
    }
    for (let k = 0; k < WIRES; k++) {
      const w = wires[k], v = (LINKS + k) * 6, j = (LINKS + k) * 2;
      const age = t - w.t0;
      if (w.a < 0 || age > GROW + HOLD + FADE) { la[j] = la[j + 1] = 0; continue; }
      const g = easeOut(smooth(0, GROW, age));
      if (!w.landed && age >= GROW) { w.landed = true; flash[w.b] = 1; }
      const env = age < GROW + HOLD ? 1 : 1 - (age - GROW - HOLD) / FADE;
      const A = w.a * 3, B = w.b * 3;
      for (let c = 0; c < 3; c++) {
        lp[v + c] = pos[A + c];
        lp[v + 3 + c] = pos[A + c] + (pos[B + c] - pos[A + c]) * g;
      }
      la[j] = 0.3 * env; la[j + 1] = 0.3 * env * (0.4 + 0.6 * g);
    }
    pts.dirty(); ln.dirty();

    // tilt and light
    const k = 1 - Math.exp(-dt * 3);
    tiltX += (ty * 0.14 - tiltX) * k;
    tiltY += (tx * 0.22 - tiltY) * k;
    group.rotation.set(tiltX + (reduce ? 0 : Math.sin(t * 0.05) * 0.03), tiltY + (reduce ? 0 : Math.sin(t * 0.04) * 0.05), 0);
    presence += ((present ? 1 : 0) - presence) * k;
    mouse.lerp(mouseT, 1 - Math.exp(-dt * 8));
    st.u.mouse.value.copy(mouse);
    pointMat.uniforms.uGlow.value = 1.1 * presence;
    lineMat.uniforms.uGlow.value = 0.8 * presence;
  };

  fitMask();
  run(st, host, frame, {
    still: reduce,
    onResize: fitMask,
    onFirst: () => host.classList.add('on'),
  });
}
