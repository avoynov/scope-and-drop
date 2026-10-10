import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  FOREARM,
  GRASP,
  knobAt,
  planHandling,
  poseAt,
  PROTRACT,
  qRot,
  restPose,
  SHOULDER,
  UPPER_ARM,
  wristBend,
  type HandlingKind,
  type HandlingPose,
  type HandState,
  type Plan,
  type V3,
} from '../src/scope/handling';
import type { RifleId } from '../src/scope/shot';
import { render, type Synth } from '../demo/reticle/synth';

const CASES: [RifleId, HandlingKind][] = [
  ['bolt', 'cycle'],
  ['bolt', 'reload'],
  ['svd', 'reload'],
  ['vss', 'reload'],
];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Where a hand's held point is, from its wrist. */
const held = (h: HandState, grasp: V3): V3 => {
  const o = qRot(h.wrist.q, grasp);
  return [h.wrist.p[0] + o[0], h.wrist.p[1] + o[1], h.wrist.p[2] + o[2]];
};
const sample = (plan: Plan, f: (p: HandlingPose, t: number) => void) => {
  for (let t = 0; t <= plan.dur; t += 0.01) f(poseAt(plan, t), t);
};

describe('working the action', () => {
  it('ends with the rifle ready: action shut, magazine home, hands back, eyes downrange', () => {
    for (const [rifle, kind] of CASES) {
      for (let seed = 0; seed < 6; seed++) {
        const rounds = kind === 'reload' ? 0 : 3;
        const plan = planHandling(rifle, kind, rounds, seed);
        const end = poseAt(plan, plan.dur);
        const rest = restPose(rifle, rounds);
        expect(end.bolt.lift).toBe(0);
        expect(end.bolt.travel).toBe(0);
        expect(end.carrier).toBe(0);
        expect(Math.hypot(...end.head)).toBeLessThan(0.01);
        expect(Math.abs(end.gaze.yaw) + Math.abs(end.gaze.pitch) + end.invF).toBeLessThan(1e-6);
        for (const s of ['R', 'L'] as const) expect(dist(end.hands[s].wrist.p, rest.hands[s].wrist.p)).toBeLessThan(0.01);
        if (kind === 'reload') {
          expect(end.mags[0].visible).toBe(false);
          expect(end.mags[1].visible).toBe(true);
          // In the well, where the old one was, one round down for the one chambered.
          expect(dist(end.mags[1].frame.p, rest.mags[0].frame.p)).toBeLessThan(0.01);
          expect(end.mags[1].rounds).toBe(ACTIONS[rifle].mag.rounds - 1);
        } else {
          expect(end.mags[0].rounds).toBe(rounds - 1);
        }
        expect(end.cases).toHaveLength(0);
        expect(end.feed).toBeNull();
      }
    }
  });

  it('takes a practised shooter about as long as it does on the range', () => {
    const dur = (r: RifleId, k: HandlingKind) => planHandling(r, k, 0, 3).dur;
    expect(dur('bolt', 'cycle')).toBeGreaterThan(1.2);
    expect(dur('bolt', 'cycle')).toBeLessThan(1.7);
    for (const r of ['bolt', 'svd', 'vss'] as const) {
      expect(dur(r, 'reload')).toBeGreaterThan(2.8);
      expect(dur(r, 'reload')).toBeLessThan(4.5);
    }
  });

  it('puts the hand on the bolt knob and keeps it there while the bolt moves', () => {
    const b = ACTIONS.bolt.bolt!;
    const plan = planHandling('bolt', 'cycle', 3, 1);
    let checked = 0;
    sample(plan, (p, t) => {
      // From when the hand arrives until it lets go for the grip.
      if (t < 0.3 * 1.07 || t > 0.95 * 0.94) return;
      expect(dist(held(p.hands.R, GRASP.pinch), knobAt(b, p.bolt.lift, p.bolt.travel))).toBeLessThan(0.5);
      checked++;
    });
    expect(checked).toBeGreaterThan(40);
  });

  it('hooks the charging handle and rides it back', () => {
    for (const rifle of ['svd', 'vss'] as const) {
      const c = ACTIONS[rifle].carrier!;
      const plan = planHandling(rifle, 'reload', 0, 2);
      const back = plan.cues.find((q) => q.ev === 'charge-back')!.t;
      const release = plan.cues.find((q) => q.ev === 'charge-release')!.t;
      for (let t = back; t < release; t += 0.01) {
        const p = poseAt(plan, t);
        const knob: V3 = [c.knob[0], c.knob[1], c.knob[2] + c.stroke * p.carrier];
        expect(dist(held(p.hands.R, GRASP.hook), knob)).toBeLessThan(0.5);
      }
      expect(poseAt(plan, release).carrier).toBeCloseTo(1, 6);
    }
  });

  it('never bends a wrist past what a wrist can do', () => {
    for (const [rifle, kind] of CASES) {
      const plan = planHandling(rifle, kind, kind === 'reload' ? 0 : 3, 4);
      sample(plan, (p) => {
        for (const s of ['R', 'L'] as const) expect(wristBend(p.hands[s])).toBeLessThan(1.4);
      });
    }
  });

  it('keeps the arms the length they are', () => {
    for (const [rifle, kind] of CASES) {
      const plan = planHandling(rifle, kind, kind === 'reload' ? 0 : 3, 5);
      sample(plan, (p) => {
        for (const s of ['R', 'L'] as const) {
          const a = p.hands[s].arm;
          expect(dist(a.elbow, a.shoulder)).toBeCloseTo(UPPER_ARM, 3);
          expect(dist(a.wrist, a.elbow)).toBeCloseTo(FOREARM, 3);
          // A long reach rolls the shoulder forward, as far as it goes and no further.
          expect(dist(a.shoulder, SHOULDER[s])).toBeLessThanOrEqual(PROTRACT + 1e-9);
        }
      });
    }
  });

  it('cues each sound in order, inside the handling, as the part moves', () => {
    for (const [rifle, kind] of CASES) {
      const plan = planHandling(rifle, kind, kind === 'reload' ? 0 : 3, 0);
      const t = plan.cues.map((c) => c.t);
      expect(t).toEqual([...t].sort((a, b) => a - b));
      expect(t[0]).toBeGreaterThanOrEqual(0);
      expect(t.at(-1)!).toBeLessThan(plan.dur);
      const at = (ev: string) => plan.cues.find((c) => c.ev === ev)?.t;
      if (rifle === 'bolt') {
        expect(poseAt(plan, at('bolt-back')! - 0.01).bolt.lift).toBeCloseTo(1, 6);
        expect(poseAt(plan, at('bolt-down')! - 0.01).bolt.travel).toBe(0);
      }
      if (kind === 'reload') expect(at('mag-release')!).toBeLessThan(at('mag-in')!);
    }
  });

  it('lets the SVD carrier slam shut when the empty magazine comes out, and only the SVD', () => {
    const svd = planHandling('svd', 'reload', 0, 0);
    expect(poseAt(svd, 0).carrier).toBe(1);
    expect(svd.cues.some((c) => c.ev === 'carrier-close')).toBe(true);
    const out = svd.cues.find((c) => c.ev === 'mag-out')!.t;
    expect(poseAt(svd, out + 0.2).carrier).toBe(0);
    const vss = planHandling('vss', 'reload', 0, 0);
    expect(poseAt(vss, 0).carrier).toBe(0);
    expect(vss.cues.some((c) => c.ev === 'carrier-close')).toBe(false);
  });

  it('throws the bolt rifle\'s case out to the right and strips a round into the chamber', () => {
    const plan = planHandling('bolt', 'cycle', 3, 0);
    const te = plan.ejects[0]!;
    const c = poseAt(plan, te + 0.1).cases[0]!;
    expect(c.p[0]).toBeGreaterThan(ACTIONS.bolt.bolt!.port[0] + 100);
    const [f0, f1] = plan.feeds[0]!;
    const early = poseAt(plan, f0 + 0.01).feed!;
    const late = poseAt(plan, f1 - 0.005).feed!;
    expect(late.p[2]).toBeLessThan(early.p[2]);
    expect(late.p[1]).toBeGreaterThan(early.p[1]);
    // No round to feed from an empty magazine.
    expect(planHandling('bolt', 'cycle', 0, 0).feeds).toHaveLength(0);
  });
});

describe('synthesised action sounds', () => {
  const EVENTS: Synth[] = ['shot', 'bolt-up', 'bolt-back', 'bolt-forward', 'bolt-down', 'case-land', 'mag-release', 'mag-out', 'mag-in', 'carrier-close', 'charge-back', 'charge-release'];
  it('are finite and peak at full scale', () => {
    for (const rifle of ['bolt', 'svd', 'vss'] as const) {
      for (const ev of EVENTS) {
        const d = render(ev, rifle, 1, 48000);
        let peak = 0;
        for (const x of d) {
          expect(Number.isFinite(x)).toBe(true);
          peak = Math.max(peak, Math.abs(x));
        }
        expect(peak).toBeCloseTo(1, 5);
      }
    }
  });

  it('vary from take to take and repeat for the same take', () => {
    const a = render('bolt-back', 'bolt', 0, 48000);
    const b = render('bolt-back', 'bolt', 0, 48000);
    const c = render('bolt-back', 'bolt', 1, 48000);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
