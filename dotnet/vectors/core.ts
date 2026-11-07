/**
 * Writes the core test vectors the C# sim is checked against: RNG draws, rounding, number-to-text,
 * grid snapping, rectangle maths and sort order, all computed by today's TypeScript.
 *
 * Run from the repo root: npx tsx dotnet/vectors/core.ts
 * Output: dotnet/Sim.Tests/Vectors/core.json (committed; regenerate only if the TypeScript changes).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Rng, snap } from "../../src/mansion/core/rng";
import { rectMinus, footprint, intersect, overlap1, r3, rect, type Rect } from "../../src/mansion/core/geom";

const OUT = "dotnet/Sim.Tests/Vectors/core.json";

/** Exact bits of a double, so -0, NaN and the last digit survive JSON. */
function bits(x: number): string {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, "0");
}

function draws<T>(n: number, f: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(f());
  return out;
}

const seeds: (string | number)[] = ["", "a", "42", 42, -7, 0.5, "mansion/7", "x".repeat(100), "naïve—ü😀", "party/guest-12/mind"];

const rng = seeds.map((seed) => {
  const forked = new Rng(seed).fork("party").fork(3);
  return {
    seed: String(seed),
    numeric: typeof seed === "number" ? bits(seed) : null,
    key: new Rng(seed).key,
    uints: draws(64, (() => {
      const r = new Rng(seed);
      return () => r.nextUint();
    })()),
    forkKey: forked.key,
    forkUints: draws(16, () => forked.nextUint()),
    next: draws(8, (() => {
      const r = new Rng(seed);
      return () => bits(r.next());
    })()),
    range: draws(8, (() => {
      const r = new Rng(seed);
      return () => bits(r.range(-2, 5));
    })()),
    int: draws(16, (() => {
      const r = new Rng(seed);
      return () => r.int(-3, 9);
    })()),
    chance: draws(16, (() => {
      const r = new Rng(seed);
      return () => r.chance(0.3);
    })()),
    pick: draws(16, (() => {
      const r = new Rng(seed);
      const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      return () => r.pick(items);
    })()),
    weighted: draws(16, (() => {
      const r = new Rng(seed);
      const entries: [string, number][] = [
        ["a", 1],
        ["b", 0],
        ["c", 2.5],
        ["d", -1],
        ["e", 0.25],
      ];
      return () => r.weighted(entries);
    })()),
    shuffle: draws(3, (() => {
      const r = new Rng(seed);
      const items = Array.from({ length: 20 }, (_, i) => i);
      return () => r.shuffle(items);
    })()),
    normal: draws(16, (() => {
      const r = new Rng(seed);
      return () => bits(r.normal(10, 2));
    })()),
  };
});

// Rounding and number-to-text: hand-picked edge cases plus values across every magnitude.
const special = [
  0, -0, 1, -1, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994, -0.49999999999999994, 4503599627370495.5, 4503599627370497, 2.675 * 100, 1.005 * 1000, 0.1, 0.2, 0.1 + 0.2, 1 / 3, 2 / 3, 100, 1e20, 1e21, 1.5e21, 123456789012345680000,
  1e-6, 1e-7, 1.5e-6, 1.5e-7, 0.000001234, 5e-324, 1.7976931348623157e308, 2 ** 53, 2 ** 53 + 2, 2 ** 63, -(2 ** 31), 2 ** 32, 3.65, 3.6500000000000004, 12.34, -0.0001, 1234.5678, 9.95, 99.95, NaN, Infinity, -Infinity,
];
const spread = (() => {
  const r = new Rng("core-vectors/numbers");
  return draws(2000, () => {
    const mag = 10 ** r.int(-12, 24);
    const v = (r.next() * 2 - 1) * mag;
    return r.chance(0.2) ? Math.round(v) : v;
  });
})();
const halves = (() => {
  const r = new Rng("core-vectors/halves");
  return draws(200, () => r.int(-5000, 5000) / 2);
})();
const numbers = [...special, ...spread, ...halves].map((x) => ({ x: bits(x), text: String(x), round: bits(Math.round(x)) }));

const snaps = (() => {
  const r = new Rng("core-vectors/snap");
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 1 / 3, 0.02];
  return draws(400, () => {
    const v = (r.next() * 2 - 1) * 10 ** r.int(-2, 3);
    const step = r.pick(steps);
    return { v: bits(v), step: bits(step), out: bits(snap(v, step)) };
  });
})();

const r3s = spread.slice(0, 300).map((x) => ({ x: bits(x), out: bits(r3(x)) }));

// Rectangle maths that is pure + - * / (no trig), so it must match exactly.
const rects = (() => {
  const r = new Rng("core-vectors/rects");
  const rr = (): Rect => rect(r.int(-20, 20) * 0.25 + r.next() * 0.01, r.int(-20, 20) * 0.25, r.int(-20, 20) * 0.25, r.int(-20, 20) * 0.25 + r.next() * 0.01);
  const box = (b: Rect) => [b.x0, b.z0, b.x1, b.z1].map(bits);
  return draws(300, () => {
    const a = rr();
    const holes = draws(r.int(0, 3), rr);
    const b = rr();
    const i = intersect(a, b);
    const o = overlap1(a.x0, a.x1, b.x0, b.x1);
    return {
      a: box(a),
      holes: holes.map(box),
      minus: rectMinus(a, holes).map(box),
      b: box(b),
      intersect: i ? box(i) : null,
      overlap1: o ? o.map(bits) : null,
    };
  });
})();

const footprints = (() => {
  const r = new Rng("core-vectors/footprint");
  return draws(100, () => {
    const cx = r.range(-10, 10);
    const cz = r.range(-10, 10);
    const w = r.range(0.2, 4);
    const d = r.range(0.2, 4);
    const yaw = r.int(-8, 8) * (Math.PI / 2) + r.range(-0.3, 0.3);
    const f = footprint(cx, cz, w, d, yaw);
    return { cx: bits(cx), cz: bits(cz), w: bits(w), d: bits(d), yaw: bits(yaw), out: [f.x0, f.z0, f.x1, f.z1].map(bits) };
  });
})();

// Sorting: JavaScript's sort is stable; ties must keep their order in C# too.
const sorts = (() => {
  const r = new Rng("core-vectors/sort");
  return draws(20, () => {
    const items = draws(r.int(1, 300), () => ({ id: 0, k: r.int(0, 9) + (r.chance(0.2) ? 0.5 : 0) }));
    items.forEach((it, i) => (it.id = i));
    const sorted = items.slice().sort((a, b) => a.k - b.k);
    return { keys: items.map((it) => it.k), order: sorted.map((it) => it.id) };
  });
})();
const strings = ["b", "a", "B", "A", "10", "9", "_x", "é", "e", "Z", "z", "a-b", "a_b", "aa", "", "ü", "😀", "ß", "ss"];
const stringSort = strings.slice().sort();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ rng, numbers, snaps, r3s, rects, footprints, sorts, strings, stringSort }) + "\n");
console.log(`wrote ${OUT}`);
