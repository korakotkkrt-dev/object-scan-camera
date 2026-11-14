// Finds where the live camera is relative to the model built so far.
// index   : one 128-value SIFT descriptor per model point observation + its 3D position
// locate  : descriptors + pixel positions of the current video frame -> match against the index -> camera pose by RANSAC (6-point DLT) + Gauss-Newton refinement
// The pose uses the same convention as the reconstruction: x_camera = R * X + t (R row-major, 3x3).
let idx = null;

// ---- small linear algebra -----------------------------------------------------------------------------------------------------------------
function jacobi(A, n) {            // symmetric eigen-decomposition, A is n*n row-major (destroyed); returns {w, V} with V columns = eigenvectors
  const V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q]; if (Math.abs(apq) < 1e-30) continue;
      const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = A[k * n + p], y = A[k * n + q]; A[k * n + p] = c * x - s * y; A[k * n + q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = A[p * n + k], y = A[q * n + k]; A[p * n + k] = c * x - s * y; A[q * n + k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = V[k * n + p], y = V[k * n + q]; V[k * n + p] = c * x - s * y; V[k * n + q] = s * x + c * y; }
    }
  }
  const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = A[i * n + i];
  return { w, V };
}
const det3 = m => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
function polar(M) {                // nearest rotation to M (3x3 row-major): M * (M^T M)^(-1/2)
  const S = new Float64Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += M[k * 3 + i] * M[k * 3 + j]; S[i * 3 + j] = s; }
  const { w, V } = jacobi(S, 3), inv = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += V[i * 3 + k] * V[j * 3 + k] / Math.sqrt(Math.max(w[k], 1e-18)); inv[i * 3 + j] = s; }
  const R = new Float64Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += M[i * 3 + k] * inv[k * 3 + j]; R[i * 3 + j] = s; }
  return R;
}

// ---- pose from n >= 6 correspondences (normalised image coordinates, 3D points) -----------------------------------------------------------
function dlt(xn, X, ids) {
  const n = ids.length; let cx = 0, cy = 0, cz = 0;
  for (const i of ids) { cx += X[3 * i]; cy += X[3 * i + 1]; cz += X[3 * i + 2]; } cx /= n; cy /= n; cz /= n;
  let sc = 0; for (const i of ids) sc += Math.hypot(X[3 * i] - cx, X[3 * i + 1] - cy, X[3 * i + 2] - cz); sc = sc / n || 1;
  const AtA = new Float64Array(144), row = new Float64Array(12);
  const add = () => { for (let a = 0; a < 12; a++) { const ra = row[a]; if (ra === 0) continue; for (let b = a; b < 12; b++) AtA[a * 12 + b] += ra * row[b]; } };
  for (const i of ids) {
    const x = (X[3 * i] - cx) / sc, y = (X[3 * i + 1] - cy) / sc, z = (X[3 * i + 2] - cz) / sc, u = xn[2 * i], v = xn[2 * i + 1];
    row.fill(0); row[0] = x; row[1] = y; row[2] = z; row[3] = 1; row[8] = -u * x; row[9] = -u * y; row[10] = -u * z; row[11] = -u; add();
    row.fill(0); row[4] = x; row[5] = y; row[6] = z; row[7] = 1; row[8] = -v * x; row[9] = -v * y; row[10] = -v * z; row[11] = -v; add();
  }
  for (let a = 0; a < 12; a++) for (let b = 0; b < a; b++) AtA[a * 12 + b] = AtA[b * 12 + a];
  const { w, V } = jacobi(AtA, 12); let k = 0; for (let i = 1; i < 12; i++) if (w[i] < w[k]) k = i;
  const p = new Float64Array(12); for (let i = 0; i < 12; i++) p[i] = V[i * 12 + k];
  // P' acts on the centred / scaled points; fold the normalisation back: M = M'/sc, p4 = p4' - M c
  const M = new Float64Array(9), t = new Float64Array(3), c = [cx, cy, cz];
  for (let r = 0; r < 3; r++) { for (let q = 0; q < 3; q++) M[r * 3 + q] = p[4 * r + q] / sc; t[r] = p[4 * r + 3] - (M[r * 3] * c[0] + M[r * 3 + 1] * c[1] + M[r * 3 + 2] * c[2]); }
  if (det3(M) < 0) { for (let i = 0; i < 9; i++) M[i] = -M[i]; for (let i = 0; i < 3; i++) t[i] = -t[i]; }
  const lam = (Math.hypot(M[0], M[1], M[2]) + Math.hypot(M[3], M[4], M[5]) + Math.hypot(M[6], M[7], M[8])) / 3;
  if (!(lam > 1e-12)) return null;
  for (let i = 0; i < 9; i++) M[i] /= lam; for (let i = 0; i < 3; i++) t[i] /= lam;
  return { R: polar(M), t: [t[0], t[1], t[2]] };
}
function residuals(pose, f, cx, cy, uv, X, ids, thr) {
  const R = pose.R, t = pose.t; let count = 0; const inl = [];
  for (const i of ids) {
    const x = R[0] * X[3 * i] + R[1] * X[3 * i + 1] + R[2] * X[3 * i + 2] + t[0], y = R[3] * X[3 * i] + R[4] * X[3 * i + 1] + R[5] * X[3 * i + 2] + t[1], z = R[6] * X[3 * i] + R[7] * X[3 * i + 1] + R[8] * X[3 * i + 2] + t[2];
    if (z <= 1e-9) continue;
    const du = f * x / z + cx - uv[2 * i], dv = f * y / z + cy - uv[2 * i + 1];
    if (du * du + dv * dv < thr * thr) { count++; inl.push(i); }
  }
  return { count, inl };
}
function rodrigues(w) {
  const th = Math.hypot(w[0], w[1], w[2]); if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [w[0] / th, w[1] / th, w[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s, k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s, k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
}
const mul3 = (a, b) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; };
function refine(pose, f, cx, cy, uv, X, inl, iters = 12) {       // Gauss-Newton on the pixel error, 6 parameters (rotation increment, translation), numerical Jacobian
  let R = Array.from(pose.R), t = pose.t.slice();
  const err = (R, t) => { const e = new Float64Array(inl.length * 2); inl.forEach((i, k) => { const x = R[0] * X[3 * i] + R[1] * X[3 * i + 1] + R[2] * X[3 * i + 2] + t[0], y = R[3] * X[3 * i] + R[4] * X[3 * i + 1] + R[5] * X[3 * i + 2] + t[1], z = Math.max(1e-6, R[6] * X[3 * i] + R[7] * X[3 * i + 1] + R[8] * X[3 * i + 2] + t[2]); e[2 * k] = f * x / z + cx - uv[2 * i]; e[2 * k + 1] = f * y / z + cy - uv[2 * i + 1]; }); return e; };
  const huber = e => { const o = new Float64Array(e.length); for (let k = 0; k < e.length; k += 2) { const r = Math.hypot(e[k], e[k + 1]), w = r < 3 ? 1 : 3 / r; o[k] = w; o[k + 1] = w; } return o; };
  let lambda = 1e-3, e = err(R, t), cost = e.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < iters; it++) {
    const J = []; const hw = huber(e);
    for (let p = 0; p < 6; p++) {
      const d = 1e-5, dw = [0, 0, 0], dt = [0, 0, 0]; if (p < 3) dw[p] = d; else dt[p - 3] = d;
      const R2 = mul3(rodrigues(dw), R), t2 = [t[0] + dt[0], t[1] + dt[1], t[2] + dt[2]], e2 = err(R2, t2), col = new Float64Array(e.length);
      for (let k = 0; k < e.length; k++) col[k] = (e2[k] - e[k]) / d; J.push(col);
    }
    const H = new Float64Array(36), g = new Float64Array(6);
    for (let a = 0; a < 6; a++) { for (let b = 0; b < 6; b++) { let s = 0; for (let k = 0; k < e.length; k++) s += hw[k] * J[a][k] * J[b][k]; H[a * 6 + b] = s; } let s = 0; for (let k = 0; k < e.length; k++) s += hw[k] * J[a][k] * e[k]; g[a] = s; }
    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const Hd = Float64Array.from(H); for (let a = 0; a < 6; a++) Hd[a * 6 + a] *= (1 + lambda);
      const dx = solve6(Hd, g); if (!dx) { lambda *= 10; continue; }
      const R2 = mul3(rodrigues([-dx[0], -dx[1], -dx[2]]), R), t2 = [t[0] - dx[3], t[1] - dx[4], t[2] - dx[5]], e2 = err(R2, t2), c2 = e2.reduce((s, v) => s + v * v, 0);
      if (c2 < cost) { R = R2; t = t2; e = e2; cost = c2; lambda = Math.max(1e-7, lambda / 3); improved = true; } else lambda *= 10;
    }
    if (!improved) break;
  }
  return { R: Float64Array.from(polar(R)), t };
}
function solve6(A, b) {            // Gaussian elimination with partial pivoting
  const n = 6, M = Array.from({ length: n }, (_, i) => [...A.slice(i * n, i * n + n), b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-14) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  const x = new Float64Array(n); for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; } return x;
}

// ---- matching: live descriptors against the model descriptors, COLMAP's angular ratio test --------------------------------------------------
function match(desc, nl, { maxRatio = .8, maxDist = .75 } = {}) {
  const D = idx.desc, ni = idx.n, out = [];
  for (let i = 0; i < nl; i++) {
    let best = -1, second = -1, bj = -1; const at = 128 * i;
    for (let j = 0; j < ni; j++) { let d = 0, bt = 128 * j; for (let k = 0; k < 128; k++) d += desc[at + k] * D[bt + k]; if (d > best) { second = best; best = d; bj = j; } else if (d > second) second = d; }
    const ang = d => Math.acos(Math.min(1, Math.max(-1, d / (512 * 512))));
    if (ang(best) < maxDist && ang(best) < maxRatio * ang(second)) out.push([i, bj]);
  }
  return out;
}

function locate(req) {
  const t0 = performance.now(), { desc, kp, count, camera } = req, f = camera.focal, cx = camera.cx, cy = camera.cy;
  if (!idx || count < 12) return { ok: false, reason: 'few-features', ms: 0 };
  const m = match(desc, count), n = m.length;
  if (n < 12) return { ok: false, reason: 'few-matches', matches: n, ms: Math.round(performance.now() - t0) };
  const uv = new Float64Array(2 * n), xn = new Float64Array(2 * n), X = new Float64Array(3 * n);
  m.forEach(([i, j], k) => { uv[2 * k] = kp[6 * i]; uv[2 * k + 1] = kp[6 * i + 1]; xn[2 * k] = (kp[6 * i] - cx) / f; xn[2 * k + 1] = (kp[6 * i + 1] - cy) / f; X[3 * k] = idx.xyz[3 * j]; X[3 * k + 1] = idx.xyz[3 * j + 1]; X[3 * k + 2] = idx.xyz[3 * j + 2]; });
  const all = Array.from({ length: n }, (_, i) => i), thr = Math.max(4, camera.width / 100);
  let best = null, bestN = 0, rng = 12345; const rnd = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
  // adaptive RANSAC: the number of rounds follows the best inlier share seen so far (99 % chance of one all-inlier sample), at most 3000 rounds / 0.9 s
  const tEnd = performance.now() + 900; let maxIt = 3000, rounds = 0;
  for (let it = 0; it < maxIt; it++) {
    rounds = it + 1; if ((it & 31) === 31 && performance.now() > tEnd) break;
    const s = new Set(); while (s.size < 6) s.add(Math.floor(rnd() * n));
    const pose = dlt(xn, X, [...s]); if (!pose) continue;
    const r = residuals(pose, f, cx, cy, uv, X, all, thr * 2);   // a 6-point DLT is rough: count generously here, tighten after the refit
    if (r.count > bestN) { bestN = r.count; best = { pose, inl: r.inl }; const share = Math.min(.999, bestN / n); maxIt = Math.min(3000, Math.ceil(Math.log(.01) / Math.log(1 - Math.pow(share, 6))) + 20); }
  }
  if (!best || bestN < 12) return { ok: false, reason: 'no-consensus', matches: n, inliers: bestN, rounds, ms: Math.round(performance.now() - t0) };
  let pose = dlt(xn, X, best.inl) || best.pose, r = residuals(pose, f, cx, cy, uv, X, all, thr);
  if (r.count < bestN * .8) { pose = best.pose; r = { count: bestN, inl: best.inl }; }
  pose = refine(pose, f, cx, cy, uv, X, r.inl);
  const fin = residuals(pose, f, cx, cy, uv, X, all, thr * .6);
  if (fin.count < 12) return { ok: false, reason: 'refine-failed', matches: n, inliers: fin.count, ms: Math.round(performance.now() - t0) };
  return { ok: true, R: pose.R, t: pose.t, matches: n, inliers: fin.count, rounds, ms: Math.round(performance.now() - t0) };
}

self.onmessage = ({ data }) => {
  try {
    if (data.kind === 'index') { idx = { desc: data.desc, xyz: data.xyz, n: data.xyz.length / 3 }; self.postMessage({ kind: 'indexed', n: idx.n }); }
    else if (data.kind === 'locate') self.postMessage({ kind: 'located', id: data.id, ...locate(data) });
    else if (data.kind === 'test') self.postMessage({ kind: 'test', ...data });
  } catch (e) { self.postMessage({ kind: 'error', id: data.id, message: String(e && e.message || e) }); }
};
