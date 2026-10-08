/**
 * Batched geometry builder.
 *
 * Everything static is appended into per-material buckets with position,
 * normal, world-space UV (metres; materials set texture repeat), linear tint
 * colour and lighting scope. One bucket becomes one draw call.
 */
import * as THREE from 'three';

class Grow {
  data: Float32Array;
  length = 0;
  constructor(cap = 1024) {
    this.data = new Float32Array(cap);
  }
  push(...v: number[]): void {
    if (this.length + v.length > this.data.length) {
      const n = new Float32Array(Math.max(this.data.length * 2, this.length + v.length));
      n.set(this.data);
      this.data = n;
    }
    for (let i = 0; i < v.length; i++) this.data[this.length++] = v[i]!;
  }
  view(): Float32Array {
    return this.data.subarray(0, this.length);
  }
}

class GrowU32 {
  data: Uint32Array;
  length = 0;
  constructor(cap = 1024) {
    this.data = new Uint32Array(cap);
  }
  push(...v: number[]): void {
    if (this.length + v.length > this.data.length) {
      const n = new Uint32Array(Math.max(this.data.length * 2, this.length + v.length));
      n.set(this.data);
      this.data = n;
    }
    for (let i = 0; i < v.length; i++) this.data[this.length++] = v[i]!;
  }
}

export class Bucket {
  pos = new Grow();
  nor = new Grow();
  uv = new Grow();
  col = new Grow();
  scope = new Grow();
  idx = new GrowU32();
  get vertexCount(): number {
    return this.pos.length / 3;
  }
}

export type V3 = [number, number, number];

/** Box face mask bits. */
export const PX = 1;
export const NX = 2;
export const PY = 4;
export const NY = 8;
export const PZ = 16;
export const NZ = 32;
export const ALL = 63;

export class GeometryBuilder {
  readonly buckets = new Map<string, Bucket>();
  tint: V3 = [1, 1, 1];
  scope = -1;
  /** Subtracted from y for vertical-face UVs (room-relative panelling). */
  vOffset = 0;
  /** Explicit UVs instead of world mapping for the next primitive(s). */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;

  bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Bucket()));
    return b;
  }

  /** Set a local frame: subsequent primitives are rotated by yaw and translated. */
  frame(x = 0, y = 0, z = 0, yaw = 0): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    return this;
  }

  setTint(hexOrColor: string | THREE.Color | V3): this {
    if (Array.isArray(hexOrColor)) this.tint = hexOrColor;
    else {
      const c = typeof hexOrColor === 'string' ? new THREE.Color(hexOrColor) : hexOrColor;
      this.tint = [c.r, c.g, c.b];
    }
    return this;
  }

  private tp(x: number, y: number, z: number): V3 {
    return [this.ox + x * this.c + z * this.s, this.oy + y, this.oz - x * this.s + z * this.c];
  }

  private tn(x: number, y: number, z: number): V3 {
    return [x * this.c + z * this.s, y, -x * this.s + z * this.c];
  }

  private worldUv(p: V3, n: V3): [number, number] {
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) return [p[0], p[2]];
    if (ax >= az) return [p[2], p[1] - this.vOffset];
    return [p[0], p[1] - this.vOffset];
  }

  /** Raw vertex append (world space). */
  vertex(b: Bucket, p: V3, n: V3, uv: [number, number]): number {
    const i = b.vertexCount;
    b.pos.push(p[0], p[1], p[2]);
    b.nor.push(n[0], n[1], n[2]);
    b.uv.push(uv[0], uv[1]);
    b.col.push(this.tint[0], this.tint[1], this.tint[2]);
    b.scope.push(this.scope);
    return i;
  }

  /** Quad from local corners a,b,c,d (counter-clockwise seen from the front). */
  quad(key: string, a: V3, b: V3, c: V3, d: V3, uvs?: [number, number][]): void {
    const bk = this.bucket(key);
    const pa = this.tp(...a);
    const pb = this.tp(...b);
    const pc = this.tp(...c);
    const pd = this.tp(...d);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
    let n: V3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(...n) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const ps = [pa, pb, pc, pd];
    const i0 = bk.vertexCount;
    ps.forEach((p, k) => this.vertex(bk, p, n, uvs ? uvs[k]! : this.worldUv(p, n)));
    bk.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /** Axis-aligned (in the local frame) box. */
  box(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = ALL): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (faces & PX) this.quad(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (faces & NX) this.quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (faces & PY) this.quad(key, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (faces & NY) this.quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    if (faces & PZ) this.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (faces & NZ) this.quad(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  }

  /** Box by centre-bottom and size (local frame). */
  cbox(key: string, cx: number, y: number, cz: number, w: number, h: number, d: number, faces = ALL): void {
    this.box(key, cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, faces);
  }

  /** Surface of revolution around local (cx, cz); profile is [radius, y] bottom→top. */
  lathe(key: string, cx: number, cz: number, profile: [number, number][], seg = 12, cap = true): void {
    const bk = this.bucket(key);
    const rings: number[][] = [];
    for (let i = 0; i < profile.length; i++) {
      const [r, y] = profile[i]!;
      const prev = profile[Math.max(0, i - 1)]!;
      const next = profile[Math.min(profile.length - 1, i + 1)]!;
      // Profile normal (2D) from neighbours.
      const dy = next[1] - prev[1];
      const dr = next[0] - prev[0];
      const nl = Math.hypot(dy, dr) || 1;
      const nr = dy / nl;
      const ny = -dr / nl;
      const ring: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const p = this.tp(cx + ca * r, y, cz + sa * r);
        const n = this.tn(ca * nr, ny, sa * nr);
        ring.push(this.vertex(bk, p, n, [(k / seg) * Math.PI * 2 * Math.max(r, 0.05), y]));
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < seg; k++) {
        const a = rings[i]![k]!;
        const b = rings[i]![k + 1]!;
        const c = rings[i + 1]![k + 1]!;
        const d = rings[i + 1]![k]!;
        bk.idx.push(a, c, b, a, d, c);
      }
    }
    if (cap) {
      const [rt, yt] = profile[profile.length - 1]!;
      if (rt > 1e-4) this.disc(key, cx, yt, cz, rt, seg, true);
      const [rb, yb] = profile[0]!;
      if (rb > 1e-4) this.disc(key, cx, yb, cz, rb, seg, false);
    }
  }

  disc(key: string, cx: number, y: number, cz: number, r: number, seg = 12, up = true): void {
    const bk = this.bucket(key);
    const n = this.tn(0, up ? 1 : -1, 0);
    const c = this.vertex(bk, this.tp(cx, y, cz), n, [cx, cz]);
    const ring: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const p = this.tp(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      ring.push(this.vertex(bk, p, n, [p[0], p[2]]));
    }
    for (let k = 0; k < seg; k++) {
      if (up) bk.idx.push(c, ring[k + 1]!, ring[k]!);
      else bk.idx.push(c, ring[k]!, ring[k + 1]!);
    }
  }

  cylinder(key: string, cx: number, y: number, cz: number, r0: number, r1: number, h: number, seg = 10, cap = true): void {
    this.lathe(key, cx, cz, [
      [r0, y],
      [r1, y + h],
    ], seg, cap);
  }

  /** UV sphere / ellipsoid. */
  sphere(key: string, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, segW = 10, segH = 7): void {
    const bk = this.bucket(key);
    const rows: number[][] = [];
    for (let j = 0; j <= segH; j++) {
      const v = j / segH;
      const phi = v * Math.PI;
      const row: number[] = [];
      for (let k = 0; k <= segW; k++) {
        const th = (k / segW) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th);
        const ny = -Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(th);
        const p = this.tp(cx + nx * rx, cy + ny * ry, cz + nz * rz);
        const nn = Math.hypot(nx / rx, ny / ry, nz / rz) || 1;
        const n = this.tn(nx / rx / nn, ny / ry / nn, nz / rz / nn);
        row.push(this.vertex(bk, p, n, [(k / segW) * Math.PI * 2 * rx, p[1]]));
      }
      rows.push(row);
    }
    for (let j = 0; j < segH; j++) {
      for (let k = 0; k < segW; k++) {
        const a = rows[j]![k]!;
        const b = rows[j]![k + 1]!;
        const c = rows[j + 1]![k + 1]!;
        const d = rows[j + 1]![k]!;
        bk.idx.push(a, c, b, a, d, c);
      }
    }
  }

  /** Vertical prism from a simple polygon (local x,z), y0..y1. */
  prism(key: string, pts: [number, number][], y0: number, y1: number, top = true, bottom = false): void {
    // Normalise winding so side faces point outward.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[(i + 1) % pts.length]!;
      area += ax * bz - bx * az;
    }
    if (area > 0) pts = pts.slice().reverse();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[(i + 1) % n]!;
      this.quad(key, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
    }
    const tri = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new THREE.Vector2(x, z)),
      [],
    );
    const bk = this.bucket(key);
    // Cap triangles: orient each by its actual normal.
    const capUp = (a: number, b: number, c: number): boolean => {
      const [ax, az] = pts[a]!;
      const [bx, bz] = pts[b]!;
      const [cx, cz] = pts[c]!;
      // y component of (b-a)×(c-a) for points in the xz plane.
      return (bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0;
    };
    if (top) {
      const nn = this.tn(0, 1, 0);
      const base = bk.vertexCount;
      for (const [x, z] of pts) {
        const p = this.tp(x, y1, z);
        this.vertex(bk, p, nn, [p[0], p[2]]);
      }
      for (const [a, b, c] of tri) {
        if (capUp(a!, b!, c!)) bk.idx.push(base + a!, base + b!, base + c!);
        else bk.idx.push(base + a!, base + c!, base + b!);
      }
    }
    if (bottom) {
      const nn = this.tn(0, -1, 0);
      const base = bk.vertexCount;
      for (const [x, z] of pts) {
        const p = this.tp(x, y0, z);
        this.vertex(bk, p, nn, [p[0], p[2]]);
      }
      for (const [a, b, c] of tri) {
        if (capUp(a!, b!, c!)) bk.idx.push(base + a!, base + c!, base + b!);
        else bk.idx.push(base + a!, base + b!, base + c!);
      }
    }
  }

  /** Quad whose winding is fixed so its normal points along (nx, ny, nz). */
  quadFacing(key: string, a: V3, b: V3, c: V3, d: V3, nx: number, ny: number, nz: number): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (n[0]! * nx + n[1]! * ny + n[2]! * nz >= 0) this.quad(key, a, b, c, d);
    else this.quad(key, d, c, b, a);
  }

  /** Triangle whose winding is fixed so its normal points along (nx, ny, nz). */
  triFacing(key: string, a: V3, b: V3, c: V3, nx: number, ny: number, nz: number): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (n[0]! * nx + n[1]! * ny + n[2]! * nz >= 0) this.tri(key, a, b, c);
    else this.tri(key, a, c, b);
  }

  /** Triangle (local), flat normal. */
  tri(key: string, a: V3, b: V3, c: V3): void {
    const bk = this.bucket(key);
    const pa = this.tp(...a);
    const pb = this.tp(...b);
    const pc = this.tp(...c);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    let n: V3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(...n) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const i0 = bk.vertexCount;
    for (const p of [pa, pb, pc]) this.vertex(bk, p, n, this.worldUv(p, n));
    bk.idx.push(i0, i0 + 1, i0 + 2);
  }

  /** Horizontal polygon at height y (local x,z), facing up or down, with optional holes. */
  flatPoly(key: string, pts: [number, number][], y: number, up: boolean, holes: [number, number][][] = []): void {
    const bk = this.bucket(key);
    const all = [...pts, ...holes.flat()];
    const tri = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new THREE.Vector2(x, z)),
      holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))),
    );
    const nn = this.tn(0, up ? 1 : -1, 0);
    const base = bk.vertexCount;
    for (const [x, z] of all) {
      const p = this.tp(x, y, z);
      this.vertex(bk, p, nn, [p[0], p[2]]);
    }
    for (const [a, b, c] of tri) {
      const [ax, az] = all[a!]!;
      const [bx, bz] = all[b!]!;
      const [cx, cz] = all[c!]!;
      // y component of (b-a)×(c-a) for points in the xz plane.
      const facesUp = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0;
      if (facesUp === up) bk.idx.push(base + a!, base + b!, base + c!);
      else bk.idx.push(base + a!, base + c!, base + b!);
    }
  }

  /** Square-section bar between two points (rails, ribs, chains). */
  beam(key: string, a: V3, b: V3, w: number, h = w): void {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    if (len < 1e-6) return;
    // Side vector: horizontal and perpendicular to the bar (any horizontal for a vertical bar).
    let sx = -d[2];
    let sz = d[0];
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-6) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    // Up vector: perpendicular to both.
    const ux = (d[1] * sz) / len;
    const uy = (d[2] * sx - d[0] * sz) / len;
    const uz = (-d[1] * sx) / len;
    const sgn = uy < 0 ? -1 : 1;
    const U: V3 = [ux * sgn * (h / 2), uy * sgn * (h / 2), uz * sgn * (h / 2)];
    const S: V3 = [sx * (w / 2), 0, sz * (w / 2)];
    const c = (p: V3, i: number, j: number): V3 => [p[0] + i * S[0] + j * U[0], p[1] + j * U[1], p[2] + i * S[2] + j * U[2]];
    this.quadFacing(key, c(a, -1, 1), c(a, 1, 1), c(b, 1, 1), c(b, -1, 1), U[0], U[1], U[2]);
    this.quadFacing(key, c(a, -1, -1), c(a, 1, -1), c(b, 1, -1), c(b, -1, -1), -U[0], -U[1], -U[2]);
    this.quadFacing(key, c(a, 1, -1), c(a, 1, 1), c(b, 1, 1), c(b, 1, -1), S[0], 0, S[2]);
    this.quadFacing(key, c(a, -1, -1), c(a, -1, 1), c(b, -1, 1), c(b, -1, -1), -S[0], 0, -S[2]);
  }

  /** Index counts per bucket, to pass to `cutRectHole` later. */
  mark(): Map<string, number> {
    return new Map([...this.buckets].map(([k, b]) => [k, b.idx.length]));
  }

  /**
   * Cut a plan rectangle out of every triangle added since `mark` to buckets whose key
   * passes `match` (used to open the roof where the dome's drum comes through).
   */
  cutRectHole(mark: Map<string, number>, match: (key: string) => boolean, hole: { x0: number; z0: number; x1: number; z1: number }): void {
    type Vx = number[]; // x y z nx ny nz u v r g b scope
    const lerp = (a: Vx, b: Vx, t: number): Vx => a.map((v, i) => v + (b[i]! - v) * t);
    // Keep the part of a convex polygon where sign * (p[axis] - at) >= 0.
    const clip = (poly: Vx[], axis: 0 | 2, at: number, sign: 1 | -1): Vx[] => {
      const out: Vx[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const da = sign * (a[axis]! - at);
        const db = sign * (b[axis]! - at);
        if (da >= 0) out.push(a);
        if (da >= 0 !== db >= 0) out.push(lerp(a, b, da / (da - db)));
      }
      return out;
    };
    for (const [key, bk] of this.buckets) {
      if (!match(key)) continue;
      const from = mark.get(key) ?? 0;
      if (from >= bk.idx.length) continue;
      const old = bk.idx.data.slice(from, bk.idx.length);
      bk.idx.length = from;
      const read = (i: number): Vx => [
        bk.pos.data[i * 3]!, bk.pos.data[i * 3 + 1]!, bk.pos.data[i * 3 + 2]!,
        bk.nor.data[i * 3]!, bk.nor.data[i * 3 + 1]!, bk.nor.data[i * 3 + 2]!,
        bk.uv.data[i * 2]!, bk.uv.data[i * 2 + 1]!,
        bk.col.data[i * 3]!, bk.col.data[i * 3 + 1]!, bk.col.data[i * 3 + 2]!,
        bk.scope.data[i]!,
      ];
      const write = (v: Vx): number => {
        const i = bk.vertexCount;
        bk.pos.push(v[0]!, v[1]!, v[2]!);
        bk.nor.push(v[3]!, v[4]!, v[5]!);
        bk.uv.push(v[6]!, v[7]!);
        bk.col.push(v[8]!, v[9]!, v[10]!);
        bk.scope.push(v[11]!);
        return i;
      };
      for (let t = 0; t + 2 < old.length; t += 3) {
        const ids = [old[t]!, old[t + 1]!, old[t + 2]!];
        const tri = ids.map(read);
        const xs = tri.map((v) => v[0]!);
        const zs = tri.map((v) => v[2]!);
        if (Math.max(...xs) <= hole.x0 || Math.min(...xs) >= hole.x1 || Math.max(...zs) <= hole.z0 || Math.min(...zs) >= hole.z1) {
          bk.idx.push(ids[0]!, ids[1]!, ids[2]!);
          continue;
        }
        const mid = clip(clip(tri, 0, hole.x0, 1), 0, hole.x1, -1);
        const pieces = [clip(tri, 0, hole.x0, -1), clip(tri, 0, hole.x1, 1), clip(mid, 2, hole.z0, -1), clip(mid, 2, hole.z1, 1)];
        for (const piece of pieces) {
          if (piece.length < 3) continue;
          const vi = piece.map(write);
          for (let k = 1; k + 1 < vi.length; k++) bk.idx.push(vi[0]!, vi[k]!, vi[k + 1]!);
        }
      }
    }
  }

  /** Finish: one BufferGeometry per bucket key. */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [key, b] of this.buckets) {
      if (b.vertexCount === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos.view().slice(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.nor.view().slice(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.view().slice(), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.col.view().slice(), 3));
      g.setAttribute('aScope', new THREE.BufferAttribute(b.scope.view().slice(), 1));
      g.setIndex(new THREE.BufferAttribute(b.idx.data.slice(0, b.idx.length), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(key, g);
    }
    return out;
  }
}
