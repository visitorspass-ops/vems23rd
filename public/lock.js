// Lock layout (browser). A locked picture keeps every word's position. The
// snapshot stores each spot (position, size, direction, font, box width) and
// which description sits there. When descriptions are added, edited or removed
// later, only the assignment of descriptions to spots changes:
//  - a new description takes spots from whichever description has the most
//    repeats (similar length first); starred ones take large accent spots
//  - spots whose description is gone go to the descriptions with the fewest spots
import { glyph } from './layout.js';

export function makeSnapshot(art) {
  const key = (g) => art.groups[g].key;
  return {
    W: art.A.W, H: art.A.H, at: Date.now(),
    accent: art.L.placements.map((p) => ({ k: key(p.g), x: p.x, y: p.y, s: p.s, ang: p.ang, f: p.f, mw: p.mw, sh: p.sh, br: p.br || [], lines: p.lines || 1, pinned: !!p.pinned })),
    rows: art.R ? art.R.runs.map((r) => ({ y: r.y, h: r.h, x0: r.x0, x1: r.x1, items: r.items.map((it) => ({ k: key(it.g), x: it.x, w: it.w, f: it.f, dy: it.dy })) })) : [],
    size: art.R ? art.R.size : 0.92, caps: art.R ? art.R.caps : false,
  };
}

export function applySnapshot(A, snap, groups, S) {
  const gi = new Map(groups.map((g, i) => [g.key, i]));
  const slots = [];
  snap.accent.forEach((p) => slots.push({ kind: 'a', p, g: gi.has(p.k) ? gi.get(p.k) : -1 }));
  snap.rows.forEach((r) => r.items.forEach((it) => slots.push({ kind: 'r', p: it, len: it.w, g: gi.has(it.k) ? gi.get(it.k) : -1 })));
  const count = new Array(groups.length).fill(0);
  slots.forEach((sl) => sl.g >= 0 && count[sl.g]++);
  const len = (g) => groups[g].shape.length;
  // 1. descriptions that aren't in the snapshot yet (starred first)
  const missing = groups.map((g, i) => i).filter((i) => !count[i]).sort((a, b) => (groups[b].star || 0) - (groups[a].star || 0));
  for (const g of missing) {
    const want = groups[g].star ? 'a' : 'r', need = groups[g].star === 2 ? 2 : groups[g].star ? 1 : 3;
    for (let t = 0; t < need; t++) {
      let best = null, bestScore = -Infinity;
      for (const sl of slots) {
        if (sl.g < 0 || sl.p.pinned || count[sl.g] < 2 || (groups[sl.g].star && sl.kind === 'a')) continue;
        const kindBonus = sl.kind === want ? 1000 : 0, sizeBonus = sl.kind === 'a' ? sl.p.s * 10 : 0;
        const score = kindBonus + count[sl.g] * 5 + (want === 'a' ? sizeBonus : 0) - Math.abs(len(sl.g) - len(g)) * 3;
        if (score > bestScore) { bestScore = score; best = sl; }
      }
      if (!best) break;
      count[best.g]--; best.g = g; count[g]++;
    }
  }
  // 2. spots whose description was removed go to the least-shown descriptions
  for (const sl of slots) if (sl.g < 0 && groups.length) {
    let m = 0; for (let i = 1; i < groups.length; i++) if (count[i] < count[m]) m = i;
    sl.g = m; count[m]++;
  }
  // 3. rebuild the layouts (and hover maps) from the fixed spots
  const { W, H } = A, N = W * H;
  const accOwner = new Int32Array(N).fill(-1), placements = [];
  slots.filter((sl) => sl.kind === 'a').forEach((sl) => {
    const p = sl.p, idx = placements.length, pts = glyph(p.sh, p.f, p.s, p.ang);
    let R = 0, G = 0, B = 0, n = 0;
    for (let q = 0; q < pts.length; q += 2) {
      const x = p.x + pts[q], y = p.y + pts[q + 1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x; accOwner[j] = idx; R += A.rgb[j * 3]; G += A.rgb[j * 3 + 1]; B += A.rgb[j * 3 + 2]; n++;
    }
    placements.push({ ...p, g: sl.g, color: n ? [R / n, G / n, B / n] : [0, 0, 0], j: 0 });
  });
  const rowOwner = new Int32Array(N).fill(-1);
  let si = snap.accent.length;
  const runs = snap.rows.map((r) => ({
    ...r,
    items: r.items.map((it) => {
      const g = slots[si++].g;
      for (let cx = Math.max(r.x0, Math.floor(it.x)); cx < Math.min(r.x1, Math.ceil(it.x + it.w)); cx++)
        for (let cy = Math.floor(r.y); cy < Math.min(H, Math.ceil(r.y + r.h)); cy++) rowOwner[cy * W + cx] = g;
      return { ...it, g };
    }),
  }));
  return {
    L: { placements, owner: accOwner },
    R: snap.rows.length ? { runs, owner: rowOwner, caps: snap.caps, size: snap.size } : null,
  };
}
