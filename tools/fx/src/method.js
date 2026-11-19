// The two "How I work" figures. Each sits under its block's sticky heading and is driven by how
// far the reader has got through that block:
//   untangle  a scribbled 3D knot pulls straight, left to right: discovery turning unknowns
//             into one path.
//   branch    that same straight line (identical end state, so the two read as one story)
//             splits into a tree, level by level: each build seeding the next.
import { Points, LineSegments, Group } from 'three';
import { stage, run, material, buffers, linesOver, rng, smooth, clamp01, easeInOut } from './lib.js';

const TAU = Math.PI * 2;
const wave = (axis, s) => {
  let v = 0;
  for (const h of axis) v += h.a * Math.sin(TAU * h.f * s + h.p);
  return v;
};

function untangle(st, group) {
  const N = 420;
  const R = rng(31);
  // three harmonics per axis, amplitudes summing to 1, so the knot stays inside radius 1
  const harm = [0, 1, 2].map(() => [5, 8, 13].map((f, j) => ({
    f: f + Math.floor(R() * 3), a: [0.55, 0.3, 0.15][j], p: R() * TAU,
  })));
  const pts = buffers(N);
  const pairs = [];
  for (let i = 1; i < N; i++) pairs.push(i - 1, i);
  const ln = linesOver(pts, pairs);
  const ends = buffers(2);
  const lineMat = material(st), pointMat = material(st, { points: true });
  const objs = [new LineSegments(ln.g, lineMat), new Points(pts.g, pointMat), new Points(ends.g, pointMat)];
  for (const o of objs) { o.frustumCulled = false; group.add(o); }

  return (p, t) => {
    const L = st.w * 0.86, K = Math.min(st.w * 0.4, st.h * 0.42);
    const ry = t * 0.22, rx = 0.45 + Math.sin(t * 0.17) * 0.25;
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const kx = wave(harm[0], s) * K, ky = wave(harm[1], s) * K, kz = wave(harm[2], s) * K;
      // spin the knot in 3D
      let x = kx * cy + kz * sy, z = -kx * sy + kz * cy;
      let y = ky * cx - z * sx; z = ky * sx + z * cx;
      // both ends are tethered to the line's ends, so it always runs in from the left and out
      // to the right, however tangled the middle is
      const tether = smooth(0, 0.1, s) * smooth(1, 0.9, s);
      const lx = (s - 0.5) * L;
      x = lx + (x - lx) * tether; y *= tether; z *= tether;
      // untangles from the left end first
      const u = easeInOut(clamp01(p * 1.5 - s * 0.5));
      pts.pos[i * 3] = x + (lx - x) * u;
      pts.pos[i * 3 + 1] = y * (1 - u);
      pts.pos[i * 3 + 2] = z * (1 - u);
      pts.alpha[i] = 0.36;
      pts.size[i] = 1.6;
      ln.alpha[i] = 0.16 + 0.1 * u;
    }
    ends.pos.set([-L / 2, 0, 0, L / 2, 0, 0]);
    ends.alpha.set([0.55, 0.3 + 0.6 * smooth(0.6, 1, p)]);
    ends.size.set([5, 6 + 1.5 * smooth(0.6, 1, p)]);
    pts.dirty(); ln.dirty(); ends.dirty();
  };
}

function branch(st, group) {
  const PATHS = 8, M = 220, N = PATHS * M;
  // split points and ramp widths as fractions of the width; level 1 forks in y, level 2 in
  // depth (the slow roll is what shows it), level 3 in y again
  const LV = [
    { at: -0.2, w: 0.14, y: 0.2, z: 0 },
    { at: 0.04, w: 0.11, y: 0, z: 0.22 },
    { at: 0.22, w: 0.09, y: 0.075, z: 0 },
  ];
  const pts = buffers(N);
  const pairs = [];
  for (let j = 0; j < PATHS; j++) for (let i = 1; i < M; i++) pairs.push(j * M + i - 1, j * M + i);
  const ln = linesOver(pts, pairs);
  const ends = buffers(PATHS + 1);
  const lineMat = material(st), pointMat = material(st, { points: true });
  const objs = [new LineSegments(ln.g, lineMat), new Points(pts.g, pointMat), new Points(ends.g, pointMat)];
  for (const o of objs) { o.frustumCulled = false; group.add(o); }

  return (p, t) => {
    const L = st.w * 0.86, H = st.h, x0 = -L / 2;
    const open = LV.map((_, k) => easeInOut(clamp01(p * 3.1 - k * 0.95)));
    const rx = 0.55 + Math.sin(t * 0.2) * 0.35, ry = Math.sin(t * 0.13) * 0.18;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    for (let j = 0; j < PATHS; j++) {
      for (let i = 0; i < M; i++) {
        const s = i / (M - 1), x = x0 + s * L;
        let y = 0, z = 0, spread = 1;
        for (let k = 0; k < 3; k++) {
          const sign = (j >> (2 - k)) & 1 ? 1 : -1;
          const f = open[k] * smooth(LV[k].at * st.w, (LV[k].at + LV[k].w) * st.w, x);
          y += sign * LV[k].y * H * f;
          z += sign * LV[k].z * H * f;
          spread *= 1 + f;
        }
        // eight paths share the trunk; split the opacity between however many overlap here,
        // so the trunk is not eight times brighter than a leaf
        const a = 0.42 * spread / PATHS;
        const yy = y * cx - z * sx, zz = y * sx + z * cx;
        const n = (j * M + i) * 3;
        pts.pos[n] = x * cy + zz * sy;
        pts.pos[n + 1] = yy;
        pts.pos[n + 2] = -x * sy + zz * cy;
        pts.alpha[j * M + i] = a;
        pts.size[j * M + i] = 1.6;
        ln.alpha[j * M + i] = a * 0.6;
      }
      const e = (j * M + M - 1) * 3;
      ends.pos.set(pts.pos.subarray(e, e + 3), j * 3);
      ends.alpha[j] = (0.3 + 0.55 * open[2]) / (1 + 7 * (1 - open[0]));
      ends.size[j] = 5 + 1.5 * open[2];
    }
    ends.pos.set(pts.pos.subarray(0, 3), PATHS * 3);
    ends.alpha[PATHS] = 0.55;
    ends.size[PATHS] = 5;
    pts.dirty(); ln.dirty(); ends.dirty();
  };
}

export function mount(host, kind) {
  const st = stage(host, { maxDpr: 2 });
  const group = new Group();
  st.scene.add(group);
  const update = (kind === 'branch' ? branch : untangle)(st, group);
  const block = host.closest('.cap') || host;
  let p = -1;
  run(st, host, (dt, t) => {
    // 0 as the block's top clears the lower part of the screen, 1 once most of it has been read
    const r = block.getBoundingClientRect(), vh = innerHeight;
    const target = clamp01((vh * 0.78 - r.top) / (r.height * 0.85 + vh * 0.1));
    p = p < 0 ? target : p + (target - p) * (1 - Math.exp(-dt * 5));
    update(p, t);
  }, { onFirst: () => host.classList.add('on') });
}
