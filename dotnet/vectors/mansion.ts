/**
 * Writes the mansion test vectors the C# generator is checked against: for a spread of seeds and
 * forced options, a digest of each part of today's TypeScript blueprint.
 *
 * Run from the repo root: npx tsx dotnet/vectors/mansion.ts [dumpDir]
 * Output: dotnet/Sim.Tests/Vectors/mansion.json (committed; regenerate only if the TypeScript changes).
 * With dumpDir, also writes each blueprint's canonical text there (for diffing against the C# dump).
 *
 * Canonical text (mirrored by Sim.Tests/Mansion/Canonical.cs): keys sorted ordinally; null, undefined
 * and false left out; numbers rounded to 1e-6 and printed shortest-round-trip; nav grids replaced by
 * counts and FNV-1a hashes; generationMs left out.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateMansion, movePerch } from "../../src/mansion";
import type { MansionBlueprint, MansionOptions, NavLevel } from "../../src/mansion";

const OUT = "dotnet/Sim.Tests/Vectors/mansion.json";
const dumpDir = process.argv[2];

function num(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  const v = Math.round(x * 1e6) / 1e6;
  return String(v === 0 ? 0 : v);
}

function fnv(values: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    // Each value as a 16-bit pattern, low byte then high byte.
    const v = values[i]! & 0xffff;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function navSummary(n: NavLevel): Record<string, unknown> {
  let walk = 0;
  let vis = 0;
  for (let k = 0; k < n.walk.length; k++) {
    walk += n.walk[k]!;
    vis += n.vis[k]!;
  }
  return {
    ...n,
    walk: { cells: n.walk.length, count: walk, hash: fnv(n.walk) },
    room: { hash: fnv(n.room) },
    vis: { sum: vis, hash: fnv(n.vis) },
  };
}

function canon(v: unknown): string | undefined {
  if (v === null || v === undefined || v === false) return undefined;
  if (v === true) return "true";
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => canon(x) ?? "null").join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) {
      if (k === "generationMs") continue;
      const c = canon(o[k]);
      if (c !== undefined) parts.push(JSON.stringify(k) + ":" + c);
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`cannot canonicalise ${typeof v}`);
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** The blueprint's parts, in a fixed order, each as canonical text. */
function parts(bp: MansionBlueprint): [string, string][] {
  const b = bp as unknown as Record<string, unknown>;
  const keys = Object.keys(b).sort();
  return keys.map((k) => {
    const value = k === "nav" ? { ...bp.nav, levels: bp.nav.levels.map(navSummary) } : b[k];
    return [k, canon(value) ?? "null"];
  });
}

interface Case {
  name: string;
  options: MansionOptions;
  /** Also move the perch to this bearing and elevation. */
  move?: [number, number];
}

const cases: Case[] = [];
for (let i = 0; i < 24; i++) cases.push({ name: `random-${i}`, options: { seed: `random-${i}` } });
cases.push({
  name: "structure",
  options: { seed: "structure", massing: "h", size: "grand" },
});
cases.push({ name: "sight", options: { seed: "sight", massing: "block" } });
cases.push({
  name: "rotunda",
  options: { seed: "rotunda-1", hall: "rotunda" },
});
cases.push({
  name: "compact-orangery",
  options: { seed: "c-o", size: "compact", style: "orangery" },
});
cases.push({
  name: "palatial-beauxarts-u",
  options: {
    seed: "p-b",
    size: "palatial",
    style: "beauxarts",
    massing: "u-garden",
  },
});
cases.push({
  name: "georgian-u-entrance",
  options: { seed: "g-u", style: "georgian", massing: "u-entrance" },
});
cases.push({ name: "min-visible", options: { seed: "mv", minVisible: 0.5 } });
cases.push({
  name: "perch",
  options: {
    seed: "perch",
    perchDistance: 140,
    perchAzimuthDeg: 10,
    perchElevationDeg: 6,
  },
});
cases.push({ name: "moved", options: { seed: "moved" }, move: [-12, 9] });

const out = cases.map((c) => {
  const bp = generateMansion(c.options);
  const ps = parts(bp);
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(join(dumpDir, `${c.name}.txt`), ps.map(([k, s]) => `${k}=${s}`).join("\n") + "\n");
  }
  const entry: Record<string, unknown> = {
    name: c.name,
    options: c.options,
    attempt: bp.attempt,
    ok: bp.validation.ok,
    issues: bp.validation.issues.map((i) => i.code),
    partyVisible: bp.sightlines.partyVisible,
    parts: Object.fromEntries(ps.map(([k, s]) => [k, sha(s)])),
  };
  if (c.move) {
    const moved = movePerch(bp, c.move[0], c.move[1]);
    const ms = parts(moved);
    if (dumpDir) writeFileSync(join(dumpDir, `${c.name}.moved.txt`), ms.map(([k, s]) => `${k}=${s}`).join("\n") + "\n");
    entry.move = c.move;
    entry.moved = Object.fromEntries(ms.map(([k, s]) => [k, sha(s)]));
  }
  console.log(`${c.name}: attempt ${bp.attempt}, ok ${bp.validation.ok}`);
  return entry;
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ cases: out }, null, 1) + "\n");
console.log(`wrote ${OUT}`);
