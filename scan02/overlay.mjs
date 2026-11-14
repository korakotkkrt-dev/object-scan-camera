// Coverage helpers: put the reconstructed model back onto the captured frames and show which viewing directions are still missing.
// Everything is computed from the camera poses the reconstruction already returns (R, t per image; world -> camera: x_c = R x + t).
const mv = (r, p) => [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];
const mt = (r, p) => [r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[2] * p[0] + r[5] * p[1] + r[8] * p[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
export const camCenter = p => mt(p.R, p.t.map(v => -v));
const project = (p, c, x) => { const q = mv(p.R, x); q[0] += p.t[0]; q[1] += p.t[1]; q[2] += p.t[2]; return [c.focal * q[0] / q[2] + c.cx, c.focal * q[1] / q[2] + c.cy, q[2]]; };

// ---- the model drawn over one captured frame -------------------------------------------------------------------------------------------
// green = the model already has surface here, orange = inside the object frame but no surface yet (scan more from nearby), white dots = points used to find the camera
export function drawFrame(canvas, bitmap, result, idx, { roi = .88, showModel = true } = {}) {
  const w = bitmap.width, h = bitmap.height;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const r = result && result.reconstruction, pose = r && r.images[idx];
  if (!showModel || !pose || !pose.registered) return { coverage: null, registered: !!(pose && pose.registered) };
  const cam = r.camera, sx = w / cam.width, sy = h / cam.height;
  const m = result.mesh, V = m.vertices, F = m.faces, n = V.length / 3;
  const px = new Float32Array(n * 2), pz = new Float32Array(n);
  for (let i = 0; i < n; i++) { const q = project(pose, cam, [V[3 * i], V[3 * i + 1], V[3 * i + 2]]); px[2 * i] = q[0] * sx; px[2 * i + 1] = q[1] * sy; pz[i] = q[2]; }
  const lay = (fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn(x); return c; };
  const tris = x => { x.beginPath(); for (let f = 0; f < F.length; f += 3) { const a = F[f], b = F[f + 1], c = F[f + 2]; if (pz[a] <= 0 || pz[b] <= 0 || pz[c] <= 0) continue; x.moveTo(px[2 * a], px[2 * a + 1]); x.lineTo(px[2 * b], px[2 * b + 1]); x.lineTo(px[2 * c], px[2 * c + 1]); x.closePath(); } x.fill(); };
  const ix = w * (1 - roi) / 2, iy = h * (1 - roi) / 2, rw = w * roi, rh = h * roi;
  const model = lay(x => { x.fillStyle = '#35e0a0'; x.strokeStyle = '#35e0a0'; x.lineWidth = 1; tris(x); });
  const gap = lay(x => { x.fillStyle = '#ff9a3d'; x.fillRect(ix, iy, rw, rh); x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; x.strokeStyle = '#000'; x.lineWidth = 2; tris(x); x.stroke(); });
  // share of the object frame that has surface (counted on a small copy)
  const sm = document.createElement('canvas'); sm.width = 96; sm.height = Math.max(1, Math.round(96 * h / w));
  const sx2 = sm.getContext('2d', { willReadFrequently: true }); sx2.drawImage(gap, 0, 0, sm.width, sm.height);
  const a = sx2.getImageData(0, 0, sm.width, sm.height).data;
  const rx0 = Math.round(sm.width * (1 - roi) / 2), rx1 = Math.round(sm.width * (1 + roi) / 2), ry0 = Math.round(sm.height * (1 - roi) / 2), ry1 = Math.round(sm.height * (1 + roi) / 2);
  let tot = 0, miss = 0;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) { tot++; if (a[4 * (y * sm.width + x) + 3] > 100) miss++; }
  ctx.globalAlpha = .5; ctx.drawImage(model, 0, 0);
  ctx.globalAlpha = .3; ctx.drawImage(gap, 0, 0);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(127,231,203,.9)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(ix, iy, rw, rh); ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  for (const p of r.points) { const q = project(pose, cam, p.xyz); if (q[2] <= 0) continue; const X = q[0] * sx, Y = q[1] * sy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; ctx.fillRect(X - 1, Y - 1, 3, 3); }
  return { coverage: tot ? 1 - miss / tot : null, registered: true };
}

// ---- how many captured frames see each surface point ---------------------------------------------------------------------------------
export function vertexCoverage(result) {
  const m = result.mesh, V = m.vertices, F = m.faces, n = V.length / 3, counts = new Uint8Array(n);
  if (!n) return counts;
  const r = result.reconstruction, cams = r.images.map(p => p.registered ? { p, c: camCenter(p) } : null).filter(Boolean);
  const N = new Float32Array(n * 3);
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f], b = F[f + 1], c = F[f + 2];
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2], vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[3 * i] += nx; N[3 * i + 1] += ny; N[3 * i + 2] += nz; }
  }
  // the winding is the same for every depth map, so the normals all point to the camera side or all away: pick the sign that mostly faces the cameras
  let s = 0;
  for (let i = 0; i < n; i += 7) for (const k of cams) s += Math.sign(dot([N[3 * i], N[3 * i + 1], N[3 * i + 2]], [k.c[0] - V[3 * i], k.c[1] - V[3 * i + 1], k.c[2] - V[3 * i + 2]]));
  const sign = s >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const x = [V[3 * i], V[3 * i + 1], V[3 * i + 2]], nn = unit([N[3 * i], N[3 * i + 1], N[3 * i + 2]]);
    let seen = 0;
    for (const k of cams) {
      const q = project(k.p, r.camera, x); if (q[2] <= 0 || q[0] < 0 || q[1] < 0 || q[0] >= r.camera.width || q[1] >= r.camera.height) continue;
      if (sign * dot(nn, unit([k.c[0] - x[0], k.c[1] - x[1], k.c[2] - x[2]])) > .25) seen++;
    }
    counts[i] = seen;
  }
  return counts;
}

// eigen-decomposition of a symmetric 3x3 matrix (Jacobi rotations); returns [{value, vector}] sorted by value ascending
function eig3(A) {
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 30; it++) {
    let p = 0, q = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(a[1][2]); }
    if (mx < 1e-14) break;
    const th = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
  }
  return [0, 1, 2].map(i => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => x.value - y.value);
}

// ---- from which directions the object has been seen --------------------------------------------------------------------------------------
// top view of the viewing dome: angle = direction around the object (0 = where the scan started, increasing the way you walked), distance from the centre = how high the camera was
export function ringData(result) {
  const r = result.reconstruction, regs = r.images.map((p, i) => p.registered ? { p, i } : null).filter(Boolean);
  if (regs.length < 3) return null;
  const V = result.mesh.vertices; let c = [0, 0, 0], k = 0;
  if (V.length) { for (let i = 0; i < V.length; i += 3 * 5) { c[0] += V[i]; c[1] += V[i + 1]; c[2] += V[i + 2]; k++; } }
  else for (const p of r.points) { c[0] += p.xyz[0]; c[1] += p.xyz[1]; c[2] += p.xyz[2]; k++; }
  if (!k) return null; c = c.map(v => v / k);
  // vertical axis: the way the cameras' 'down' points on average (handheld phone, upright). If the camera positions clearly lie on a plane (a walk around the object)
  // the normal of that plane is used instead, so a rolled camera does not confuse the directions.
  let U = [0, 0, 0]; for (const g of regs) { U[0] -= g.p.R[3]; U[1] -= g.p.R[4]; U[2] -= g.p.R[5]; } U = unit(U);
  { const cs = regs.map(g => camCenter(g.p)), m = [0, 1, 2].map(a => cs.reduce((s, q) => s + q[a], 0) / cs.length);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of cs) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (q[a] - m[a]) * (q[b] - m[b]);
    const ev = eig3(C);   // [{value, vector}] sorted ascending
    if (ev[2].value > 0 && ev[0].value / ev[1].value < .2 && ev[1].value / ev[2].value > .05) { let n = ev[0].vector; if (dot(n, U) < 0) n = n.map(v => -v); U = unit(n); } }
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ax = axes.reduce((b, a) => Math.abs(dot(a, U)) < Math.abs(dot(b, U)) ? a : b);
  const e1 = unit([ax[0] - dot(ax, U) * U[0], ax[1] - dot(ax, U) * U[1], ax[2] - dot(ax, U) * U[2]]), e2 = [U[1] * e1[2] - U[2] * e1[1], U[2] * e1[0] - U[0] * e1[2], U[0] * e1[1] - U[1] * e1[0]];
  const polar = g => { const cc = camCenter(g.p), d = [cc[0] - c[0], cc[1] - c[1], cc[2] - c[2]], L = Math.hypot(d[0], d[1], d[2]) || 1; return { az: Math.atan2(dot(d, e2), dot(d, e1)) * 180 / Math.PI, el: Math.asin(Math.max(-1, Math.min(1, dot(d, U) / L))) * 180 / Math.PI, i: g.i, center: cc }; };
  let cams = regs.map(polar); const a0 = cams[0].az;
  let dir = 0; for (let i = 1; i < cams.length; i++) { let d = cams[i].az - cams[i - 1].az; d = ((d + 540) % 360) - 180; dir += d; }
  const flip = dir < 0 ? -1 : 1;
  cams = cams.map(q => ({ ...q, az: (((flip * (q.az - a0)) % 360) + 360) % 360 }));
  const cells = Array.from({ length: 12 }, () => [0, 0, 0]);
  for (const q of cams) { const s = Math.min(11, Math.floor(q.az / 30)), b = q.el < 30 ? 0 : q.el < 60 ? 1 : 2; cells[s][b]++; }
  const sectors = cells.map(c => c[0] + c[1] + c[2]);
  const empty = []; for (let s = 0; s < 12; s++) if (!sectors[s]) empty.push(s);
  const groups = []; for (const s of empty) { const g = groups[groups.length - 1]; if (g && g.end === s - 1) g.end = s; else groups.push({ start: s, end: s }); }
  if (groups.length > 1 && groups[0].start === 0 && groups[groups.length - 1].end === 11) { const l = groups.pop(); groups[0].start = l.start - 12; }
  const hints = [];
  if (!empty.length) hints.push('เก็บภาพครบรอบวัตถุแล้ว');
  else for (const g of groups) { const a = ((g.start * 30) % 360 + 360) % 360, b = (((g.end + 1) * 30) % 360 + 360) % 360; hints.push(`ยังไม่มีภาพช่วง ${a}°–${b}° ของวงรอบ`); }
  const high = cams.filter(q => q.el >= 45).length, low = cams.filter(q => q.el < 30).length;
  if (!high) hints.push('ยังไม่มีภาพมุมสูง (ถือกล้องสูงขึ้นแล้วเอียงลงมอง)');
  if (!low) hints.push('ยังไม่มีภาพมุมต่ำ (ลดกล้องให้ต่ำลง)');
  const lone = cams.filter(q => cells[Math.min(11, Math.floor(q.az / 30))].reduce((s, v) => s + v, 0) === 1).length;
  if (lone && !empty.length) hints.push('บางช่วงมีภาพเพียงภาพเดียว ถ่ายซ้ำช่วงนั้นอีกเล็กน้อย');
  // where a camera position (model coordinates) lies on the same ring, for the live marker
  const where = cc => { const d = [cc[0] - c[0], cc[1] - c[1], cc[2] - c[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
    return { az: (((flip * (Math.atan2(dot(d, e2), dot(d, e1)) * 180 / Math.PI - a0)) % 360) + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, dot(d, U) / L))) * 180 / Math.PI }; };
  return { cams, cells, sectors, hints, spanOk: empty.length === 0, where };
}

// ---- the model drawn over the LIVE camera picture -----------------------------------------------------------------------------------------
// canvas has the size the reconstruction used (camera.width x camera.height) and is laid over the <video> with the same object-fit, so both line up.
// mode 'points'  : the 3D points of the model, in their photo colours (a point cloud on the live picture); cells inside the object frame that hold no point get an orange tint = scan there next
// mode 'surface' : green = surface already in the model, orange = inside the object frame but not yet built
// mode 'both'    : surface + points.  Returns the share of the object frame that is already covered.
let liveCache = null;
export function drawLive(canvas, result, pose, { roi = .88, mode = 'points' } = {}) {
  const r = result.reconstruction, cam = r.camera, w = cam.width, h = cam.height;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
  if (!pose) return null;
  const m = result.mesh, hasSurface = !!(m && m.faces && m.faces.length >= 60);
  if (mode !== 'points' && !hasSurface) mode = 'points';
  const ix = w * (1 - roi) / 2, iy = h * (1 - roi) / 2, rw = w * roi, rh = h * roi;
  let cover = null;
  if (mode !== 'points') {
    const V = m.vertices, F = m.faces, n = V.length / 3;
    if (!liveCache || liveCache.mesh !== m) liveCache = { mesh: m, px: new Float32Array(n * 2), pz: new Float32Array(n), a: document.createElement('canvas'), b: document.createElement('canvas') };
    const { px, pz, a, b } = liveCache;
    for (let i = 0; i < n; i++) { const q = project(pose, cam, [V[3 * i], V[3 * i + 1], V[3 * i + 2]]); px[2 * i] = q[0]; px[2 * i + 1] = q[1]; pz[i] = q[2]; }
    a.width = b.width = w; a.height = b.height = h;
    const tris = x => { x.beginPath(); for (let f = 0; f < F.length; f += 3) { const i = F[f], j = F[f + 1], k = F[f + 2]; if (pz[i] <= 0 || pz[j] <= 0 || pz[k] <= 0) continue; x.moveTo(px[2 * i], px[2 * i + 1]); x.lineTo(px[2 * j], px[2 * j + 1]); x.lineTo(px[2 * k], px[2 * k + 1]); x.closePath(); } x.fill(); };
    const A = a.getContext('2d'); A.fillStyle = '#35e0a0'; tris(A);
    const B = b.getContext('2d'); B.fillStyle = '#ff9a3d'; B.fillRect(ix, iy, rw, rh); B.globalCompositeOperation = 'destination-out'; B.fillStyle = '#000'; B.strokeStyle = '#000'; B.lineWidth = 2; tris(B); B.stroke(); B.globalCompositeOperation = 'source-over';
    const sm = document.createElement('canvas'); sm.width = 96; sm.height = Math.max(1, Math.round(96 * h / w));
    const sx = sm.getContext('2d', { willReadFrequently: true }); sx.drawImage(b, 0, 0, sm.width, sm.height);
    const d = sx.getImageData(0, 0, sm.width, sm.height).data, x0 = Math.round(sm.width * (1 - roi) / 2), x1 = Math.round(sm.width * (1 + roi) / 2), y0 = Math.round(sm.height * (1 - roi) / 2), y1 = Math.round(sm.height * (1 + roi) / 2);
    let tot = 0, miss = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; if (d[4 * (y * sm.width + x) + 3] > 100) miss++; }
    ctx.globalAlpha = .45; ctx.drawImage(a, 0, 0); ctx.globalAlpha = .2; ctx.drawImage(b, 0, 0); ctx.globalAlpha = 1;
    cover = tot ? 1 - miss / tot : null;
  }
  if (mode !== 'surface') {
    const CX = 16, CY = 12, cells = new Uint16Array(CX * CY), pts = [], S = Math.max(2, w / 200);
    for (const p of r.points) {
      const q = project(pose, cam, p.xyz); if (q[2] <= 0) continue;
      const X = q[0], Y = q[1]; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      pts.push(X, Y, q[2], p.color);
      if (X >= ix && X < ix + rw && Y >= iy && Y < iy + rh) cells[Math.min(CY - 1, Math.floor((Y - iy) / rh * CY)) * CX + Math.min(CX - 1, Math.floor((X - ix) / rw * CX))]++;
    }
    let filled = 0; for (let k = 0; k < cells.length; k++) if (cells[k] >= 1) filled++;
    if (mode === 'points') {
      ctx.fillStyle = 'rgba(255,154,61,.16)';
      for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) if (!cells[cy * CX + cx]) ctx.fillRect(ix + cx * rw / CX, iy + cy * rh / CY, rw / CX, rh / CY);
      cover = filled / (CX * CY);
    }
    // far points first so near ones stay on top; a dark halo keeps every colour readable on the live picture
    const order = []; for (let k = 0; k < pts.length; k += 4) order.push(k); order.sort((a, b) => pts[b + 2] - pts[a + 2]);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; for (const k of order) ctx.fillRect(pts[k] - S, pts[k + 1] - S, 2 * S, 2 * S);
    for (const k of order) { const c = pts[k + 3] || [255, 255, 255]; ctx.fillStyle = `rgb(${Math.min(255, c[0] * 1.15 + 20)},${Math.min(255, c[1] * 1.15 + 20)},${Math.min(255, c[2] * 1.15 + 20)})`; ctx.fillRect(pts[k] - S * .62, pts[k + 1] - S * .62, S * 1.24, S * 1.24); }
  }
  return cover;
}

export function drawRing(canvas, ring, current = null) {
  const S = canvas.width, ctx = canvas.getContext('2d'), cx = S / 2, cy = S / 2, R = S / 2 - 12;
  ctx.clearRect(0, 0, S, S);
  if (!ring) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `${S / 11}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('รอผลคำนวณ', cx, cy); return; }
  const rad = d => (d - 90) * Math.PI / 180;
  for (let s = 0; s < 12; s++) for (let b = 0; b < 3; b++) {
    const r0 = R * (1 - (b + 1) / 3), r1 = R * (1 - b / 3), cnt = ring.cells[s][b];
    ctx.beginPath(); ctx.arc(cx, cy, r1, rad(s * 30), rad((s + 1) * 30)); ctx.arc(cx, cy, r0, rad((s + 1) * 30), rad(s * 30), true); ctx.closePath();
    ctx.fillStyle = cnt >= 2 ? 'rgba(53,224,160,.78)' : cnt === 1 ? 'rgba(255,170,60,.78)' : 'rgba(255,255,255,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(8,24,32,.9)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const q of ring.cams) { const rr = R * (1 - Math.max(0, Math.min(90, q.el)) / 90), a = rad(q.az); ctx.beginPath(); ctx.arc(cx + rr * Math.cos(a), cy + rr * Math.sin(a), 2.4, 0, 7); ctx.fill(); }
  if (current) { const rr = R * (1 - Math.max(0, Math.min(90, current.el)) / 90), a = rad(current.az), X = cx + rr * Math.cos(a), Y = cy + rr * Math.sin(a); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffe14d'; ctx.fillStyle = 'rgba(255,225,77,.35)'; ctx.beginPath(); ctx.arc(X, Y, S / 16, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#7fe7cb'; ctx.font = `bold ${Math.max(10, S / 14)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('เริ่ม', cx, 10);
}
