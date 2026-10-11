/**
 * How long an evening takes headless, stage by stage (the `profile` option). The budget is
 * generous for slow machines; the lab's profile line shows the real numbers.
 */
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { Party } from "../src/party/sim";

describe("an evening’s cost", () => {
  it("times every stage of the step, and a whole evening stays within budget", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "perf", profile: true });
    const t0 = performance.now();
    while (!party.over) party.advance(60);
    const total = performance.now() - t0;
    const prof = party.profile!;
    for (const stage of ["people", "separate", "body", "talk", "senses", "mood", "memory"]) expect(prof[stage], stage).toBeGreaterThan(0);
    const staged = Object.values(prof).reduce((a, b) => a + b, 0);
    expect(staged).toBeLessThanOrEqual(total + 1);
    // Five seconds is the target on a desktop; allow for a slow test runner.
    expect(total).toBeLessThan(15_000);
    // Without the option, nothing is timed.
    expect(new Party(generateMansion({ seed: "gala-night" }), { seed: "perf" }).profile).toBeNull();
  }, 60_000);
});
