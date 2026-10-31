import { describe, expect, it } from "vitest";
import { emptyLoadout } from "../src/armoury/loadout";

/** The sweep (scripts/kit-sweep.ts), loaded by path so the typecheck (browser code, without Node's types) doesn't take it in. */
const SWEEP = "../scripts/kit-sweep.ts";
interface Sweep {
  SKILLS: { name: string; wind: number; trigger: number; pause: boolean }[];
  hitChance(l: ReturnType<typeof emptyLoadout>, skill: Sweep["SKILLS"][number], n: number, seed?: number): { killed: number; downed: number; wounded: number };
  failureCost(s: number, fee: number): number;
}

describe("the kit sweep's headless shooter", () => {
  it("is the same on the same seed, and a rest and bag help a novice at the Sako's ranges", async () => {
    const s = (await import(/* @vite-ignore */ SWEEP)) as Sweep;
    const novice = s.SKILLS[0]!;
    const bare = emptyLoadout("bolt");
    const kit = emptyLoadout("bolt");
    kit.items.front = "atlas";
    kit.items.rear = "bag";
    const a = s.hitChance(bare, novice, 400, 3);
    expect(s.hitChance(bare, novice, 400, 3)).toEqual(a);
    const b = s.hitChance(kit, novice, 400, 3);
    expect(b.killed + b.downed).toBeGreaterThan(a.killed + a.downed);
    expect(s.failureCost(0, 6000)).toBe(0);
    expect(s.failureCost(9, 6000)).toBeGreaterThan(s.failureCost(2, 6000));
  }, 300_000);
});
