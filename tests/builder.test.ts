import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import type { MansionBlueprint, MansionSize, MassingType, Room, StyleId } from "../src/mansion";
import { meshMansion } from "../src/mansion/build";
import { buildFacades, buildInteriors, buildReveals, type ArchContext } from "../src/mansion/build/arch";
import { buildAtrium, buildDome } from "../src/mansion/build/atrium";
import { GeometryBuilder, type Bucket } from "../src/mansion/build/geometry";
import { ScopedLighting } from "../src/mansion/build/lighting";
import { RECIPES } from "../src/mansion/build/materials";
import { buildLanterns, buildProps } from "../src/mansion/build/props";
import { buildPorticos, buildRoofs } from "../src/mansion/build/roofs";
import { buildGardens, buildTerrain } from "../src/mansion/build/site";
import { buildStairs } from "../src/mansion/build/stairs";
import { synthesize } from "../src/mansion/build/textures";
import { Fixtures } from "../src/party/render/fixtures";

/** Geometry-only pass of the renderer (no WebGL needed). */
function mesh(style: StyleId, massing: MassingType, size: MansionSize, seed: string) {
  const bp = generateMansion({ seed, style, massing, size });
  const g = new GeometryBuilder();
  let s = 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const ctx: ArchContext = { bp, g, rooms: new Map(bp.rooms.map((r) => [r.id, r])), style: bp.style, rand };
  buildInteriors(ctx);
  buildAtrium(ctx);
  buildReveals(ctx);
  buildFacades(ctx);
  const roofMark = g.mark();
  buildRoofs(ctx);
  buildDome(ctx, roofMark);
  buildPorticos(ctx);
  buildStairs(ctx);
  buildProps(bp, g, rand);
  buildLanterns(bp.lights, g, (l) => (l.z > 0 ? 0 : Math.PI));
  buildGardens(ctx);
  return { bp, g, geos: g.build() };
}

describe("renderer geometry", () => {
  const cases: [StyleId, MassingType, MansionSize][] = [
    ["palladian", "block", "grand"],
    ["georgian", "u-garden", "compact"],
    ["beauxarts", "h", "palatial"],
    ["palladian", "u-entrance", "grand"],
    ["orangery", "u-garden", "grand"],
    ["orangery", "block", "palatial"],
  ];
  it.each(cases)("%s / %s / %s meshes cleanly", (style, massing, size) => {
    const { geos } = mesh(style, massing, size, `mesh-${style}-${massing}`);
    let tris = 0;
    for (const [key, geo] of geos) {
      expect(RECIPES[key], `bucket ${key} has no material`).toBeDefined();
      const pos = geo.getAttribute("position").array as Float32Array;
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]!), `${key} NaN`).toBe(true);
      expect(geo.getAttribute("aScope").count).toBe(geo.getAttribute("position").count);
      tris += (geo.index?.count ?? 0) / 3;
    }
    // A whole estate (house, furniture, gardens) stays well inside a real-time budget.
    expect(tris).toBeGreaterThan(20_000);
    expect(tris).toBeLessThan(900_000);
  });

  it("interior geometry carries room scopes; façades are exterior", () => {
    const { bp, geos } = mesh("palladian", "block", "grand", "scopes");
    const floor = [...geos.entries()].find(([k]) => k.startsWith("floor-"))![1];
    const sc = floor.getAttribute("aScope").array as Float32Array;
    expect(Math.min(...sc)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...sc)).toBeLessThan(bp.rooms.length);
    const ext = geos.get(`ext-wall-${bp.style.wallMaterial}`) ?? geos.get("ext-rustic")!;
    expect(Array.from(ext.getAttribute("aScope").array as Float32Array).every((v) => v === -1)).toBe(true);
  });

  it("the roof is opened where the dome stands, and the hall has its stair, galleries and glass", () => {
    for (const hall of ["gallery", "rotunda"] as const) {
      const bp = generateMansion({ seed: `dome-mesh-${hall}`, hall });
      const g = new GeometryBuilder();
      const ctx: ArchContext = { bp, g, rooms: new Map(bp.rooms.map((r) => [r.id, r])), style: bp.style, rand: () => 0.5 };
      buildInteriors(ctx);
      const before = g.mark();
      buildAtrium(ctx);
      // The hall mesher adds marble (stair, columns), gallery floors and balustrades.
      expect((g.buckets.get("marble")?.idx.length ?? 0) - (before.get("marble") ?? 0)).toBeGreaterThan(3000);
      const roofMark = g.mark();
      buildRoofs(ctx);
      buildDome(ctx, roofMark);
      const d = bp.atrium!.dome;
      const half = d.radius + 0.5;
      const roof = g.buckets.get(`roof-${bp.style.roofMaterial}`)!;
      for (let t = roofMark.get(`roof-${bp.style.roofMaterial}`) ?? 0; t < roof.idx.length; t += 3) {
        let cx = 0;
        let cz = 0;
        for (let k = 0; k < 3; k++) {
          cx += roof.pos.data[roof.idx.data[t + k]! * 3]! / 3;
          cz += roof.pos.data[roof.idx.data[t + k]! * 3 + 2]! / 3;
        }
        expect(Math.abs(cx - d.x) < half && Math.abs(cz - d.z) < half, `${hall}: roof triangle inside the dome base`).toBe(false);
      }
      expect(g.buckets.get("glass")!.idx.length).toBeGreaterThan(0);
    }
  });

  it("terrain is finite and covers the perch", () => {
    const bp = generateMansion({ seed: "terrain" });
    const t = buildTerrain(bp, 0);
    const pos = t.getAttribute("position").array as Float32Array;
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
    t.computeBoundingBox();
    const bb = t.boundingBox!;
    expect(bb.max.z).toBeGreaterThan(bp.site.perch.eye.z);
  });

  it("procedural textures stay in range and noise textures tile seamlessly", () => {
    for (const key of ["ashlar", "brick", "herringbone", "damask", "books", "slate", "rug0"] as const) {
      const f = synthesize(key, 64);
      expect(
        f.col.every((v) => v >= 0 && v <= 1.0001),
        key,
      ).toBe(true);
    }
    // For continuous noise, the step across the wrap must look like any other step.
    for (const key of ["grass", "gravel", "foliage", "stucco", "plaster"] as const) {
      const N = 128;
      const f = synthesize(key, N);
      let wrap = 0;
      let inner = 0;
      for (let j = 0; j < N; j++) {
        wrap += Math.abs(f.h[j * N]! - f.h[j * N + N - 1]!);
        for (let i = 0; i + 1 < N; i++) inner += Math.abs(f.h[j * N + i]! - f.h[j * N + i + 1]!);
      }
      expect(wrap / N / (inner / (N * (N - 1))), key).toBeLessThan(2);
    }
  });
});

/**
 * Z-fighting guard. Two surfaces of different materials in one plane, facing the same way and
 * overlapping, flicker as the camera moves. Returns such overlaps (m2) by material pair, above `minY`.
 */
function coplanarOverlaps(g: GeometryBuilder, minY: number): Map<string, number> {
  const TRANSPARENT = new Set(["glass", "roof-glass", "sheer"]);
  type Tri = { key: string; p: number[][]; n: number[]; d: number };
  const groups = new Map<string, Tri[]>();
  for (const [key, b] of g.buckets) {
    // Drapes are double-sided cloth hung on the wall plane; their backs are never seen.
    if (key === "fabric") continue;
    for (let i = 0; i + 2 < b.idx.length; i += 3) {
      const p = [0, 1, 2].map((k) => {
        const v = b.idx.data[i + k]!;
        return [b.pos.data[v * 3]!, b.pos.data[v * 3 + 1]!, b.pos.data[v * 3 + 2]!];
      });
      if (Math.max(p[0]![1]!, p[1]![1]!, p[2]![1]!) < minY) continue;
      const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!);
      const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
      const c = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const len = Math.hypot(c[0]!, c[1]!, c[2]!);
      if (len < 1e-4) continue;
      const n0 = c.map((v) => v / len);
      // Glass is seen from both sides.
      for (const sgn of TRANSPARENT.has(key) ? [1, -1] : [1]) {
        const n = n0.map((v) => v * sgn);
        const d = n[0]! * p[0]![0]! + n[1]! * p[0]![1]! + n[2]! * p[0]![2]!;
        for (const off of [0, 0.5]) {
          const gk = `${n.map((v) => Math.round(v * 40)).join(",")}|${Math.floor(d / 0.006 + off)}|${off}`;
          let l = groups.get(gk);
          if (!l) groups.set(gk, (l = []));
          l.push({ key, p, n, d });
        }
      }
    }
  }
  const area2 = (P: number[][]) => P.reduce((s, q, i) => s + q[0]! * P[(i + 1) % P.length]![1]! - P[(i + 1) % P.length]![0]! * q[1]!, 0) / 2;
  const overlap = (a: Tri, b: Tri): number => {
    const m = a.n.map(Math.abs);
    const ax = m[0]! > m[1]! && m[0]! > m[2]! ? 0 : m[1]! > m[2]! ? 1 : 2;
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    let poly = a.p.map((q) => [q[u]!, q[v]!]);
    const B = b.p.map((q) => [q[u]!, q[v]!]);
    const sB = Math.sign(area2(B)) || 1;
    for (let i = 0; i < 3 && poly.length; i++) {
      const c0 = B[i]!;
      const c1 = B[(i + 1) % 3]!;
      const side = (q: number[]) => sB * ((c1[0]! - c0[0]!) * (q[1]! - c0[1]!) - (c1[1]! - c0[1]!) * (q[0]! - c0[0]!));
      const out: number[][] = [];
      poly.forEach((q, j) => {
        const r = poly[(j + 1) % poly.length]!;
        const sq = side(q);
        const sr = side(r);
        if (sq >= 0) out.push(q);
        if (sq >= 0 !== sr >= 0) out.push([q[0]! + ((r[0]! - q[0]!) * sq) / (sq - sr), q[1]! + ((r[1]! - q[1]!) * sq) / (sq - sr)]);
      });
      poly = out;
    }
    return poly.length >= 3 ? Math.abs(area2(poly)) / Math.max(0.2, m[ax]!) : 0;
  };
  const found = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of groups.values()) {
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i]!;
        const b = l[j]!;
        if (a.key === b.key || (TRANSPARENT.has(a.key) && TRANSPARENT.has(b.key))) continue;
        if (Math.abs(a.d - b.d) > 0.004 || a.n[0]! * b.n[0]! + a.n[1]! * b.n[1]! + a.n[2]! * b.n[2]! < 0.9995) continue;
        const id = JSON.stringify([a.p, b.p]);
        if (seen.has(id)) continue;
        seen.add(id);
        const ar = overlap(a, b);
        if (ar < 0.004) continue;
        const k = [a.key, b.key].sort().join(" x ");
        found.set(k, (found.get(k) ?? 0) + ar);
      }
    }
  }
  return found;
}

describe("no z-fighting on the roofs", () => {
  const cases: [StyleId, MassingType, string][] = [
    ["orangery", "u-garden", "or-1"],
    ["orangery", "h", "pv-1"],
    ["orangery", "block", "c-1"],
    ["georgian", "block", "e-1"],
    ["beauxarts", "h", "opq-7"],
    ["palladian", "u-garden", "e-5"],
  ];
  it.each(cases)("%s / %s: no two materials share a plane from the eaves up", (style, massing, seed) => {
    const { bp, g } = mesh(style, massing, "grand", seed);
    const eave = bp.masses.find((m) => m.kind === "main")!.roof.eaveY;
    const found = coplanarOverlaps(g, eave - 0.7);
    // Lanterns, the hall's attic and glass roof, glazing bars: nothing larger than a bar's end may coincide.
    for (const [pair, area] of found) expect(area, `${pair} share a plane over ${area.toFixed(2)} m2`).toBeLessThan(0.3);
  });
});

/* ------------------------------------------------------------------ */
/* Movable fittings: doors, drapes and room lights switched at run time */
/* ------------------------------------------------------------------ */

/** Bit-for-bit equal arrays. */
function identical(a: Float32Array | Uint32Array, b: Float32Array | Uint32Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const p = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const q = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
}

/** Every bucket identical, vertex for vertex, except those named. */
function expectSameBuckets(a: GeometryBuilder, b: GeometryBuilder, except: string[] = []): void {
  const keys = (g: GeometryBuilder) => [...g.buckets.keys()].filter((k) => !except.includes(k));
  expect(keys(b)).toEqual(keys(a));
  for (const k of keys(a)) {
    const p = a.buckets.get(k)!;
    const q = b.buckets.get(k)!;
    for (const f of ["pos", "nor", "uv", "col", "scope"] as const) expect(identical(q[f].view(), p[f].view()), `${k}.${f}`).toBe(true);
    expect(identical(q.idx.data.subarray(0, q.idx.length), p.idx.data.subarray(0, p.idx.length)), `${k}.idx`).toBe(true);
  }
}

const tris = (g: GeometryBuilder, key: string) => (g.buckets.get(key)?.idx.length ?? 0) / 3;

/** The vertices `full` has and `thin` lacks (thin = full with whole primitives left out), as runs of consecutive vertices. */
function removedRuns(full: Bucket, thin: Bucket): THREE.Vector3[][] {
  const same = (i: number, j: number) => {
    for (let k = 0; k < 3; k++) if (full.pos.data[i * 3 + k] !== thin.pos.data[j * 3 + k] || full.nor.data[i * 3 + k] !== thin.nor.data[j * 3 + k]) return false;
    return true;
  };
  const runs: THREE.Vector3[][] = [];
  let run: THREE.Vector3[] | null = null;
  let j = 0;
  for (let i = 0; i < full.vertexCount; i++) {
    if (j < thin.vertexCount && same(i, j)) {
      j++;
      run = null;
      continue;
    }
    if (!run) runs.push((run = []));
    run.push(new THREE.Vector3(full.pos.data[i * 3], full.pos.data[i * 3 + 1], full.pos.data[i * 3 + 2]));
  }
  expect(j, "thin is a subsequence of full").toBe(thin.vertexCount);
  return runs;
}

function expectBox(got: THREE.Box3, want: THREE.Box3, label: string, eps = 1e-4): void {
  for (const c of ["x", "y", "z"] as const) {
    expect(Math.abs(got.min[c] - want.min[c]), `${label} min.${c}`).toBeLessThan(eps);
    expect(Math.abs(got.max[c] - want.max[c]), `${label} max.${c}`).toBeLessThan(eps);
  }
}

/** Windows that get drapes: glazed, on a solid façade, not the entrance or a glasshouse front, with a chosen room behind. */
function drapedWindows(bp: MansionBlueprint, pick: (r: Room) => boolean): Set<string> {
  const rooms = new Map(bp.rooms.map((r) => [r.id, r]));
  const out = new Set<string>();
  for (const w of bp.walls) {
    if (!w.exterior || w.glazed) continue;
    const room = rooms.get((w.neg ?? w.pos)!);
    if (!room || !pick(room)) continue;
    for (const o of w.openings) if (o.glazed && o.kind !== "entrance" && !o.dressing?.giant) out.add(o.id);
  }
  return out;
}

const PARTY_ROOMS = new Set(["bedroom", "dressing-room", "sitting-room", "study", "cinema"]);
const party = (r: Room) => PARTY_ROOMS.has(r.type);
const bedroom = (r: Room) => r.type === "bedroom";

describe.each(["party-1", "curtains"])("movable fittings (%s)", (seed) => {
  const bp = generateMansion({ seed });
  const baked = meshMansion(bp);

  it("with the options off the mesh is unchanged and nothing is handed back", () => {
    const off = meshMansion(bp, { dynamicDoors: false, dynamicCurtains: () => false });
    for (const m of [baked, off]) {
      expect(m.doorLeaves).toEqual([]);
      expect(m.curtains).toEqual([]);
    }
    expectSameBuckets(baked.g, off.g);
  });

  it("the blueprint is not touched", () => {
    const json = (b: MansionBlueprint) => JSON.stringify(b, (k, v) => (k === "generationMs" ? 0 : v));
    const before = json(bp);
    meshMansion(bp, { dynamicDoors: true, dynamicCurtains: party });
    expect(json(bp)).toBe(before);
  });

  it("dynamic doors: one spec per interior leaf, those leaves out of the mesh, nothing else changed", () => {
    const dyn = meshMansion(bp, { dynamicDoors: true });
    const ids = new Set<string>();
    let doors = 0;
    let doubles = 0;
    for (const w of bp.walls) {
      if (w.exterior || !w.pos) continue;
      for (const o of w.openings) {
        if (o.kind === "door") doors++;
        else if (o.kind === "double-door") doubles++;
        else continue;
        ids.add(o.id);
      }
    }
    expect(doors + doubles).toBeGreaterThan(10);
    expect(dyn.doorLeaves.length).toBe(doors + 2 * doubles);
    for (const l of dyn.doorLeaves) expect(ids.has(l.opening), l.opening).toBe(true);
    expect(dyn.curtains).toEqual([]);
    // Each baked leaf was a 12-triangle box in the trim bucket.
    expect(tris(baked.g, "int-trim") - tris(dyn.g, "int-trim")).toBe(12 * dyn.doorLeaves.length);
    expectSameBuckets(baked.g, dyn.g, ["int-trim"]);
  });

  it("a fully open leaf is the baked one; closed, it lies across its doorway", () => {
    const dyn = meshMansion(bp, { dynamicDoors: true });
    const runs = removedRuns(baked.g.buckets.get("int-trim")!, dyn.g.buckets.get("int-trim")!);
    const openings = [...new Set(dyn.doorLeaves.map((l) => l.opening))];
    expect(runs.length).toBe(openings.length);
    const fx = new Fixtures(dyn.doorLeaves, [], new ScopedLighting(bp));
    const box = new THREE.Box3();
    openings.forEach((id, k) => expectBox(fx.bounds(id, box), new THREE.Box3().setFromPoints(runs[k]!), `open ${id}`));
    for (const id of openings) fx.setDoor(id, 0);
    fx.update();
    const where = new Map(bp.walls.flatMap((w) => w.openings.map((o) => [o.id, { w, o }] as const)));
    for (const id of openings) {
      const { w, o } = where.get(id)!;
      fx.bounds(id, box);
      const [t, n] = w.axis === "x" ? (["x", "z"] as const) : (["z", "x"] as const);
      const base = w.axis === "x" ? w.a.x : w.a.z;
      const line = w.axis === "x" ? w.a.z : w.a.x;
      expect(box.min[t], id).toBeGreaterThan(base + o.u0 - 0.01);
      expect(box.max[t], id).toBeLessThan(base + o.u1 + 0.01);
      expect(box.max[t] - box.min[t], id).toBeGreaterThan((o.u1 - o.u0) * 0.9);
      expect(box.max[n] - box.min[n], id).toBeLessThan(0.0501);
      expect(box.min[n], id).toBeGreaterThan(line);
      expect(box.max[n], id).toBeLessThan(line + w.thickness / 2 + 0.05);
    }
    fx.dispose();
  });

  it("dynamic curtains: only the chosen rooms’ windows, their drapes out of the mesh, pelmets kept", () => {
    const dyn = meshMansion(bp, { dynamicCurtains: bedroom });
    const windows = drapedWindows(bp, bedroom);
    expect(windows.size).toBeGreaterThan(0);
    expect(dyn.curtains.length).toBe(windows.size);
    const byIndex = new Map(bp.rooms.map((r) => [r.index, r]));
    for (const c of dyn.curtains) {
      expect(windows.has(c.opening), c.opening).toBe(true);
      expect(byIndex.get(c.scope)!.type).toBe("bedroom");
    }
    expect(dyn.doorLeaves).toEqual([]);
    expect(tris(dyn.g, "fabric")).toBeLessThan(tris(baked.g, "fabric"));
    // The seeded drape overlap is still drawn, so nothing meshed after the curtains moves.
    expectSameBuckets(baked.g, dyn.g, ["fabric", "sheer"]);
  });

  it("curtains start where the baked drapes and sheers hung, and draw across the window", () => {
    const dyn = meshMansion(bp, { dynamicCurtains: party });
    expect(dyn.curtains.length).toBe(drapedWindows(bp, party).size);
    const drapes = removedRuns(baked.g.buckets.get("fabric")!, dyn.g.buckets.get("fabric")!);
    expect(drapes.length).toBe(dyn.curtains.length);
    const fx = new Fixtures([], dyn.curtains, new ScopedLighting(bp));
    const box = new THREE.Box3();
    dyn.curtains.forEach((c, k) => expectBox(fx.bounds(c.opening, box), new THREE.Box3().setFromPoints(drapes[k]!), `${c.start} ${c.opening}`));
    // Baked sheers are two coincident quads each.
    const sheerBaked = removedRuns(baked.g.buckets.get("sheer")!, dyn.g.buckets.get("sheer")!).flat();
    const sheerStart = dyn.curtains.flatMap((c, w) => (c.start === "sheer" ? [w] : []));
    expect(sheerBaked.length).toBe(8 * sheerStart.length);
    const sheers = fx.root.getObjectByName("fixtures-sheers") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const size = new THREE.Vector3();
    const at = (w: number) => {
      sheers.getMatrixAt(w, m);
      return sheers.geometry.boundingBox!.clone().applyMatrix4(m);
    };
    sheerStart.forEach((w, k) => expectBox(at(w), new THREE.Box3().setFromPoints(sheerBaked.slice(k * 8, k * 8 + 8)), `sheer ${dyn.curtains[w]!.opening}`));
    // Drawing an open curtain spans what a baked drawn one did; opening it again restores the start exactly.
    const c = dyn.curtains.find((q) => q.start === "open")!;
    const w = dyn.curtains.indexOf(c);
    const start = fx.bounds(c.opening, new THREE.Box3());
    fx.setCurtain(c.opening, 1);
    fx.update();
    fx.bounds(c.opening, box);
    const [t, n] = c.axis === "x" ? (["x", "z"] as const) : (["z", "x"] as const);
    expect(box.min[t]).toBeCloseTo(c.t0 - 0.25, 5);
    expect(box.max[t]).toBeCloseTo(c.t1 + 0.25, 5);
    expect(Math.abs((c.inward > 0 ? box.max[n] : box.min[n]) - c.face)).toBeCloseTo(0.1, 5);
    fx.setCurtain(c.opening, 0);
    fx.update();
    expectBox(fx.bounds(c.opening, box), start, "reopened", 1e-9);
    // The sheer shows and hides.
    expect(at(w).getSize(size).length()).toBe(0);
    fx.setCurtain(c.opening, 0, true);
    fx.update();
    expect(at(w).getSize(size).length()).toBeGreaterThan(1);
    fx.setCurtain(c.opening, 0, false);
    fx.update();
    expect(at(w).getSize(size).length()).toBe(0);
    fx.dispose();
  });

  it("switching a room’s lights off and on restores the light texture exactly", () => {
    const L = new ScopedLighting(bp);
    const data = L.texture.image.data as Float32Array;
    const before = data.slice();
    const stride = data.length / L.texture.image.height;
    const room = bp.rooms.find((r) => bp.lights.filter((l) => l.scope === r.id).length >= 2)!;
    const r = room.index;
    const ambient = L.ambient[r]!.clone();
    const version = L.texture.version;
    L.setScopeScale(r, 0);
    expect(L.texture.version).toBeGreaterThan(version);
    expect(L.scopeScale(r)).toBe(0);
    expect(L.ambient[r]!.getHex()).toBe(0);
    // Off: the bounce and the lights' colours. Kept: the sky term, light positions and spot cones, and every other scope.
    let switched = 0;
    for (let i = 0; i < data.length; i++) {
      const row = Math.floor(i / stride);
      const texel = Math.floor((i % stride) / 4);
      const ch = i % 4;
      const off = row === r && ch < 3 && (texel === 0 || texel % 3 === 2);
      if (off && before[i] !== 0) switched++;
      expect(data[i], `scope ${row} texel ${texel}.${ch}`).toBe(off ? 0 : before[i]);
    }
    expect(switched).toBeGreaterThan(3);
    L.setScopeScale(r, 0.5);
    L.setScopeScale(r, 1);
    expect(identical(data, before)).toBe(true);
    expect(L.ambient[r]!.equals(ambient)).toBe(true);
    // Exterior scopes are not switched.
    L.setScopeScale(bp.rooms.length, 0);
    expect(L.scopeScale(bp.rooms.length)).toBe(1);
    expect(identical(data, before)).toBe(true);
  });
});
