// Image preparation for the reconstruction: resize to the chosen quality and, optionally, remove slowly varying light (shadows, vignetting, exposure drift).
// Light removal = local contrast normalisation: every pixel is compared with the mean and spread of its own neighbourhood (about 4 % of the image), so a soft shadow or a
// brighter frame no longer changes what the matcher sees. Hard shadow edges are still edges; the colours used for the model always come from the original photo.

function boxMean(g, w, h, r) {
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// RGBA bytes -> grey values 0..255 with the local light removed
export function flatten(rgba, w, h) {
  const n = w * h, g = new Float32Array(n), g2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = .299 * rgba[4 * i] + .587 * rgba[4 * i + 1] + .114 * rgba[4 * i + 2]; g[i] = v; g2[i] = v * v; }
  const r = Math.max(6, Math.round(Math.max(w, h) * .04)), m = boxMean(g, w, h, r), m2 = boxMean(g2, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sd = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i]));
    out[i] = Math.min(255, Math.max(0, 128 + 42 * (g[i] - m[i]) / (sd + 8)));    // +8 grey levels: flat noisy areas are not blown up into fake texture
  }
  return out;
}

// photo -> JPEG no larger than maxSide (never enlarged), grey + light removed when deshade is on
export async function resized(blob, maxSide, { deshade = false } = {}) {
  const bmp = await createImageBitmap(blob), s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s), c = new OffscreenCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: deshade });
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
  if (deshade) {
    const img = ctx.getImageData(0, 0, w, h), n = flatten(img.data, w, h);
    for (let i = 0; i < w * h; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = n[i]; img.data[4 * i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: .92 }), width: w, height: h };
}

// photo -> {width,height,data (original colours), gray (light removed, only when asked)} for the surface stage
export async function denseImage(blob, width, height, { deshade = false } = {}) {
  const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(width, height), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, width, height); bmp.close();
  const img = ctx.getImageData(0, 0, width, height), out = { width, height, data: img.data };
  if (deshade) out.gray = flatten(img.data, width, height);
  return out;
}
