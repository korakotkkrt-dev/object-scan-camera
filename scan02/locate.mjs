// Live localisation: where is the camera right now, relative to the model built so far?
// 1) the video frame is shrunk to the size the reconstruction used and SIFT features are taken (persistent COLMAP worker)
// 2) the features are matched against descriptors of the model points and the pose is solved (locate-worker.mjs)
// The result {R,t} is in the model's own coordinates, so the mesh can be drawn over the live picture (overlay.mjs drawLive).
import {QUALITY} from './pipeline.mjs';
import {limitFeatures} from './matching.mjs';
import {flatten} from './prep.mjs';

export class LiveLocator {
  constructor() {
    this.exW = null; this.loc = new Worker(new URL('./locate-worker.mjs', import.meta.url), {type: 'module'});
    this.wait = new Map(); this.nextId = 1; this.camera = null; this.deshade = false; this.points = 0; this.modelId = 0; this.liveScale = .6;   // live pictures are taken smaller than the model's (SIFT time grows with the pixel count); keypoints are scaled back
    this.loc.onmessage = ev => { if (ev.data.kind === 'indexed') { const w = this.wait.get('index'); this.wait.delete('index'); w && w.resolve(ev.data); } else this.done(ev); };
    this.loc.onerror = e => this.failAll(Error(e.message || 'live locator worker'));
  }
  done(ev) { const m = ev.data, w = this.wait.get(m.id); if (!w) return; this.wait.delete(m.id); m.kind === 'error' ? w.reject(Error(m.message || m.text)) : w.resolve(m); }
  failAll(err, only) { for (const [k, w] of this.wait) if (!only || w.worker === only) { this.wait.delete(k); w.reject(err); } }
  // the picture-feature worker (COLMAP wasm) holds a lot of memory: it is created on demand and dropped while the model is being rebuilt
  get ex() {
    if (!this.exW) { const w = this.exW = new Worker(new URL('./vendor/colmap/dist/worker.js', import.meta.url), {type: 'module'}); w.onmessage = ev => this.done(ev); w.onerror = e => { this.failAll(Error(e.message || 'COLMAP worker'), w); if (this.exW === w) { w.terminate(); this.exW = null; } }; }
    return this.exW;
  }
  sleep() { if (this.exW) { const w = this.exW; this.exW = null; this.failAll(Error('asleep'), w); w.terminate(); } }
  call(worker, msg, transfer = []) { const id = msg.id = this.nextId++; return new Promise((resolve, reject) => { this.wait.set(id, {resolve, reject, worker}); worker.postMessage(msg, transfer); }); }
  // model points -> descriptor index (up to two observations from different pictures per point, the 3000 points seen in most pictures)
  async setModel(result, pipeline, frames, { exclude = new Set() } = {}) {   // exclude = picture numbers whose descriptors must not be used (held-out tests)
    const r = result.reconstruction, q = QUALITY[result.quality] || QUALITY.normal, key = f => `${f.name}|${q.proc}|${result.deshade ? 1 : 0}`;
    const feats = frames.slice(0, result.frameCount).map(f => pipeline.cache.get(key(f)));
    const pts = r.points.filter(p => p.track.length >= 3).sort((a, b) => b.track.length - a.track.length).slice(0, 3000);
    const desc = [], xyz = [];
    for (const p of pts) {
      const obs = p.track.filter(([i, k]) => r.images[i] && r.images[i].registered && !exclude.has(i) && feats[i] && k < feats[i].count);
      if (!obs.length) continue;
      const pick = obs.length > 2 ? [obs[0], obs[obs.length >> 1]] : obs;
      for (const [i, k] of pick) { desc.push(feats[i].descriptors.subarray(128 * k, 128 * k + 128)); xyz.push(p.xyz[0], p.xyz[1], p.xyz[2]); }
    }
    this.camera = r.camera; this.deshade = !!result.deshade; this.points = xyz.length / 3;
    if (this.points < 30) { this.ready = false; return false; }
    const D = new Uint8Array(desc.length * 128); desc.forEach((d, i) => D.set(d, 128 * i));
    const X = Float32Array.from(xyz);
    const wait = new Promise((resolve, reject) => this.wait.set('index', {resolve, reject}));
    this.loc.postMessage({kind: 'index', desc: D, xyz: X}, [D.buffer, X.buffer]);
    await wait; this.ready = true; this.modelId++; this.modelGen = result.generatedAt; return true;   // modelGen: which build the index belongs to (every build has its own coordinates)
  }
  clearModel() { this.ready = false; this.points = 0; this.modelId++; }
  // one attempt on the current video picture; returns {ok, R, t, inliers, matches, ms, ...}
  async locate(source) {
    if (!this.ready) return {ok: false, reason: 'no-model'};
    const modelId = this.modelId, modelGen = this.modelGen, cam = this.camera, t0 = performance.now();
    const sc = this.liveScale, W = Math.round(cam.width * sc), H = Math.round(cam.height * sc);
    const c = new OffscreenCanvas(W, H), ctx = c.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(source, 0, 0, W, H);
    if (this.deshade) {
      const img = ctx.getImageData(0, 0, W, H), g = flatten(img.data, W, H);
      for (let i = 0; i < g.length; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = g[i]; img.data[4 * i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    }
    const bmp = await createImageBitmap(c);   // handed to the worker as it is: no JPEG encode / decode in between
    const f0 = await this.call(this.ex, {kind: 'extract', data: bmp}, [bmp]), f = limitFeatures(f0, 800), tf = performance.now();
    for (let i = 0; i < f.count; i++) { f.keypoints[6 * i] *= cam.width / W; f.keypoints[6 * i + 1] *= cam.height / H; }
    if (modelId !== this.modelId) return {ok: false, reason: 'model-changed'};
    const r = await this.call(this.loc, {kind: 'locate', desc: f.descriptors, kp: f.keypoints, count: f.count, camera: cam});
    if (modelId !== this.modelId) return {ok: false, reason: 'model-changed'};
    return {...r, modelGen, features: f.count, extractMs: Math.round(tf - t0), totalMs: Math.round(performance.now() - t0)};
  }
  terminate() { this.sleep(); this.loc.terminate(); }
}
