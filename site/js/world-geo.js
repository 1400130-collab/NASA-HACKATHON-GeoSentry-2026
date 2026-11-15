// Shared by the page and its worker: where a point of the real-world tiles (data/world/, the nationwide grid in metres)
// lands in the scene, and how high the drawn terrain is there.
//
// The terrain mesh uses every s-th height sample and splits each cell along one diagonal, so its surface is not the
// smooth bilinear field of D.hAt(). surface() is that exact mesh: anything placed with it stands on the ground it is
// drawn on, with no gap and no sinking, at any "mountain height" setting (heights are scaled in the shaders).
export function makeGeo(cfg) {
  const { korea, k, Ws, Hs, W80, H80, step: s, h, fit } = cfg;
  const nx = Math.floor((W80 - 1) / s) + 1, nz = Math.floor((H80 - 1) / s) + 1;
  const poly = (c, a, b) => c[0] + c[1] * a + c[2] * b + c[3] * a * a + c[4] * a * b + c[5] * b * b + c[6] * a * a * a + c[7] * a * a * b + c[8] * a * b * b + c[9] * b * b * b;
  const out = [0, 0];
  const G = {
    mPerUnit: 1000 * k,
    // nationwide grid metres (east, south of its corner) -> scene x, z. Returns a shared array: read it before the next call.
    toScene: korea
      ? (mx, mz) => { out[0] = mx / 1000 / k - Ws / 2; out[1] = mz / 1000 / k - Hs / 2; return out; }
      : (mx, mz) => { const a = (mx - fit.c[0]) / fit.s, b = (mz - fit.c[1]) / fit.s; out[0] = poly(fit.fx, a, b) - Ws / 2; out[1] = poly(fit.fz, a, b) - Hs / 2; return out; },
    toGrid: korea
      ? (x, z) => { out[0] = (x + Ws / 2) * 1000 * k; out[1] = (z + Hs / 2) * 1000 * k; return out; }
      : (x, z) => { const a = (x + Ws / 2 - fit.rc[0]) / fit.rs, b = (z + Hs / 2 - fit.rc[1]) / fit.rs; out[0] = poly(fit.ix, a, b); out[1] = poly(fit.iz, a, b); return out; },
    inside: (x, z) => Math.abs(x) < Ws / 2 && Math.abs(z) < Hs / 2,
    // height of the drawn terrain (scene units, before exaggeration)
    surface(x, z) {
      let fx = ((x / Ws + 0.5) * W80 - 0.5) / s, fz = ((z / Hs + 0.5) * H80 - 0.5) / s;
      fx = fx < 0 ? 0 : fx > nx - 1.0001 ? nx - 1.0001 : fx; fz = fz < 0 ? 0 : fz > nz - 1.0001 ? nz - 1.0001 : fz;
      const j = fx | 0, i = fz | 0, u = fx - j, v = fz - i, q = i * s * W80 + j * s;
      const a = h[q], b = h[q + s], c = h[q + s * W80], d = h[q + s * W80 + s];
      return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    },
  };
  return G;
}
