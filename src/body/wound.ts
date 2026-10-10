/**
 * What a bullet does to a person: the wound track through the body (src/body/anatomy.ts), what it destroys,
 * and from that whether and when they go down, lose consciousness and die.
 *
 * The model follows the wound-ballistics literature rather than "energy dump" or "stopping power":
 *  - A bullet crushes a permanent channel about its presented width, which grows when it yaws (rifle bullets
 *    travel point-forward for a "neck" of 7–26 cm, then turn sideways and usually end base-forward; Fackler's
 *    wound profiles). Striking bone yaws it at once (Mabbott et al., rib impacts with 7.62 × 51).
 *  - It also throws tissue outward into a temporary cavity, whose cross-section scales with the energy it
 *    gives up per centimetre. Elastic tissue (lung, muscle, bowel, vessel walls) stretches and recovers;
 *    inelastic, solid organs (liver, spleen, kidney, brain) tear. So the cavity matters with a fast bullet and
 *    in the wrong organ, and hardly at all for a subsonic one. The cavity's diameter falls with striking speed:
 *    the same 7.62 mm chest hit makes one 1.14× wider at 200 m than at 400 m and 1.44× wider than at 800 m,
 *    and its probability of death falls from 97 % to 60 % (Acta Armamentarii 2024, 7.62 mm sniper round).
 *  - Only disrupting the brain, brainstem or upper spinal cord stops someone at once. Everything else works
 *    through blood loss and takes time: with the heart destroyed the brain still holds oxygen for 10–15 s of
 *    full voluntary action (FBI, Handgun Wounding Factors and Effectiveness, 1989). A cut femoral artery takes
 *    2–4 min. Lungs, liver, spleen and gut take minutes. Breaking the pelvis or a hip joint drops someone
 *    mechanically, still conscious. Most people also drop when hit even when nothing forces them to, and a few
 *    do not drop with wounds that will kill them.
 *
 * Everything is deterministic for a seed (the shot number), so a still and its readout agree.
 */
import { PARTS, inBody, onRib, sdf, volume, type CordLevel, type Part, type Tissue, type Vec3 } from './anatomy';

/** How a bullet behaves in tissue. */
export interface Terminal {
  massKg: number;
  diaM: number;
  lenM: number;
  /** Point-forward travel in soft tissue before it yaws (m), the median; shots vary ±35 %. */
  neckM: number;
  /** Above this striking speed part of the bullet breaks up (m/s), and how much of it at most. */
  fragmentAbove: number;
  fragmentFrac: number;
}

/**
 * The loads in the lab.
 *  - 7N1 (SVD): 9.8 g steel-core boat-tail with an air space in the nose; the space shifts the centre of mass
 *    back so it yaws sooner than plain 7.62 × 54R ball (whose neck is ≈ 16 cm, like US M80). ≈ 11 cm taken.
 *    The steel core and jacket stay whole.
 *  - M118LR: 175 gr Sierra MatchKing open tip. It yaws early, ≈ 7 cm in gelatin, and above roughly 1900 ft/s
 *    (580 m/s) the nose breaks at the yaw and sheds fragments.
 *  - SP-5 (VSS): 16.2 g, 36 mm long, steel and lead core with an air space in the nose, made to yaw in tissue.
 *    Long for its calibre (3.9 calibres), so it turns readily once it slows: ≈ 12 cm taken. Subsonic, so its
 *    temporary cavity stays small; it wounds by tumbling, a 36 mm bullet going sideways.
 */
export const TERMINAL = {
  '7n1': { massKg: 0.0098, diaM: 0.00792, lenM: 0.0323, neckM: 0.11, fragmentAbove: Infinity, fragmentFrac: 0 },
  m118lr: { massKg: 0.01134, diaM: 0.00782, lenM: 0.0315, neckM: 0.07, fragmentAbove: 580, fragmentFrac: 0.3 },
  sp5: { massKg: 0.0162, diaM: 0.00925, lenM: 0.036, neckM: 0.12, fragmentAbove: Infinity, fragmentFrac: 0 },
} as const satisfies Record<string, Terminal>;
export type TerminalId = keyof typeof TERMINAL;

/** Soft tissue's density. */
const TISSUE_RHO = 1060;
/** Within this radius of the track the stretch is within what any tissue takes. */
const TEAR_FROM_M = 0.025;
/**
 * The temporary cavity's radius against the energy the bullet gives up per metre: R = 11 cm × (E′ / 31 kJ/m)^0.4.
 * Anchored on a 7.62 mm bullet tumbling at 700 m/s (E′ ≈ 31 kJ/m) opening ≈ 22 cm (Fackler's 7.62 NATO wound
 * profile). The 0.4 power (rather than the 0.5 a cavity of fixed energy density would give) is what makes the
 * diameter follow the striking speed by about v^0.8, as in the 200 m / 800 m sniper-round study (≈1.44×).
 */
const cavityRadius = (dEds: number) => 0.11 * Math.pow(Math.max(0, dEds) / 31000, 0.4);
/** Drag coefficients in tissue: point-forward, sideways (on length × diameter), base-forward. */
const CD_NOSE = 0.3, CD_SIDE = 0.6, CD_BASE = 0.45;
/** Yaw from point-forward to sideways over this much travel, and then on to base-forward over this much. */
const YAW_TO_SIDE_M = 0.07, SIDE_TO_BASE_M = 0.08;
const STEP = 0.002;

/**
 * How much of the temporary cavity tears each tissue: 0 = stretches and recovers, 1 = tears wherever the
 * cavity reaches past TEAR_FROM_M (below that the stretch is within what any tissue takes). Solid organs
 * and the brain are inelastic; lung is mostly air and stretches well; muscle and bowel stretch.
 */
const FRAGILITY: Record<Tissue, number> = {
  brain: 1, brainstem: 1, cord: 0.6, skull: 0.3, face: 0.3,
  heart: 0.5, artery: 0.25, vein: 0.25, hilum: 0.35, lung: 0.1, airway: 0.2,
  liver: 1, spleen: 1, kidney: 0.8, stomach: 0.3, gut: 0.15,
  vertebra: 0, pelvis: 0, hip: 0, femur: 0, sternum: 0, rib: 0,
};
const BONE = new Set<Tissue>(['skull', 'vertebra', 'pelvis', 'hip', 'femur', 'sternum', 'rib']);

/**
 * Bleeding at normal blood pressure (mL/s) with the structure fully opened, from the blood flow through it:
 * the aorta carries the whole cardiac output (5 L/min ≈ 85 mL/s), the liver a quarter of it, each kidney a
 * tenth, the spleen a twentieth (its open artery bleeds faster than it flows). The lung root carries the whole
 * output at low pressure; lung tissue itself bleeds little and mostly stops.
 */
const BLEED: Partial<Record<Tissue, number>> = {
  heart: 90, artery: 0, vein: 0, hilum: 55, lung: 6, liver: 30, spleen: 12, kidney: 12, stomach: 4, gut: 4, face: 6, airway: 2,
};
/** Vessels: by name, flow when cut through. */
const VESSEL_BLEED: Record<string, number> = {
  'aorta-arch': 85, 'aorta-t': 80, 'aorta-a': 70, svc: 35, ivc: 40, 'carotid-l': 18, 'carotid-r': 18,
  'jugular-l': 10, 'jugular-r': 10, 'iliac-l': 28, 'iliac-r': 28, 'femoral-l': 18, 'femoral-r': 18,
};

export interface WoundInput {
  /** Entry point and direction of travel in the body's frame (anatomy.ts). */
  entry: Vec3;
  dir: Vec3;
  /** Striking speed (m/s). */
  speed: number;
  round: TerminalId;
  /** Shot number: the person's and the bullet's variation. */
  seed: number;
  /**
   * After glass (src/scope/glass.ts): the yaw it arrives with (rad), and what is left of it if the jacket
   * came off. A yawed bullet presents more of its side and turns at once instead of after its neck.
   */
  yawRad?: number;
  massKg?: number;
}

export interface Damage {
  part: Part;
  /** Fraction of the structure destroyed (permanent channel plus torn cavity). */
  frac: number;
  /** The permanent channel itself went through it (not only the cavity's stretch). */
  direct: boolean;
}

export type Outcome = 'killed' | 'downed' | 'wounded';

export interface Wound {
  /** Killed: dead within the hour without help (as "killed in action" counts it). Downed: down and out of the
   * fight but alive an hour on. Wounded: still on their feet and able to act. */
  outcome: Outcome;
  /** What happens, in a few words. */
  cause: string;
  /** Seconds after the hit: they fall (any reason), lose consciousness, and their heart stops. Infinity = not within the hour. */
  fallS: number;
  unconsciousS: number;
  deathS: number;
  /** The fall is a reflex or a choice, not forced: they could get up again. */
  reflexFall: boolean;
  /** Blood lost after a minute and at the end (mL). */
  bloodLost60: number;
  /** What it went through, worst first. */
  damage: Damage[];
  /** Energy left in the body (J), speed out (0 if it stayed in), and track length (m). */
  energyJ: number;
  exitSpeed: number;
  trackM: number;
  /** The track, sampled: position, permanent-channel radius, temporary-cavity radius (for drawing). */
  track: { p: Vec3; perm: number; cavity: number }[];
}

/** Repeatable random numbers in [0, 1) for a seed and a stream. */
function rnd(seed: number, i: number): number {
  let h = Math.imul(seed * 2654435761 + i * 40503, 0x27d4eb2d) ^ 0x3c6ef372;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The bullet through the body: where it goes, how it slows, and what it tears. */
export function woundTrack(w: WoundInput): Pick<Wound, 'damage' | 'energyJ' | 'exitSpeed' | 'trackM' | 'track'> & { bone: string[] } {
  const b: Terminal = TERMINAL[w.round];
  const n = Math.hypot(...w.dir);
  const d: Vec3 = [w.dir[0] / n, w.dir[1] / n, w.dir[2] / n];
  // Arriving yawed, the overturning moment in tissue takes over at once: by ~20° there is no neck left.
  const yaw0 = Math.min(Math.PI / 2, Math.max(0, w.yawRad ?? 0));
  let neck = b.neckM * (0.65 + 0.7 * rnd(w.seed, 1)) * Math.max(0.08, 1 - yaw0 / 0.35);
  const frontA = (Math.PI * b.diaM * b.diaM) / 4;
  const sideA = b.lenM * b.diaM * 0.8;
  const fragments = w.speed > b.fragmentAbove ? b.fragmentFrac * Math.min(1, (w.speed - b.fragmentAbove) / 150) : 0;
  const mass0 = Math.min(b.massKg, w.massKg ?? b.massKg);
  let mass = mass0;
  let v = w.speed;
  // Back up a little so the walk starts outside the skin.
  const p: Vec3 = [w.entry[0] - d[0] * 0.01, w.entry[1] - d[1] * 0.01, w.entry[2] - d[2] * 0.01];
  let s = -1;
  let inBone = '';
  const bone: string[] = [];
  /** Bone fragments thrown ahead of the bullet: extra crushed width for a few cm after a bone. */
  let shards = 0;
  const vol = new Map<Part, number>();
  const direct = new Set<Part>();
  const track: Wound['track'] = [];
  const e0 = 0.5 * mass * v * v;
  for (let i = 0; i < 1000 && v > 25; i++) {
    const inside = inBody(p);
    if (s < 0 && !inside) { p[0] += d[0] * STEP; p[1] += d[1] * STEP; p[2] += d[2] * STEP; continue; }
    if (s >= 0 && !inside) break;
    if (s < 0) s = 0;
    // Yaw: point-forward, then sideways, then base-forward.
    const turn = s < neck ? 0 : Math.min(Math.PI, (Math.PI / 2) * Math.min(1, (s - neck) / YAW_TO_SIDE_M) + (Math.PI / 2) * Math.max(0, Math.min(1, (s - neck - YAW_TO_SIDE_M) / SIDE_TO_BASE_M)));
    const yaw = Math.max(yaw0, turn);
    const sideways = Math.abs(Math.sin(yaw));
    const cdA = (sideways > 0 ? CD_SIDE * sideA * sideways : 0) + (yaw > Math.PI / 2 ? CD_BASE : CD_NOSE) * frontA * Math.abs(Math.cos(yaw));
    // What the point is in.
    let here: Part | null = null;
    for (const part of PARTS) if (sdf(part.shape, p) < 0) { here = part; break; }
    const rib = !here || here.tissue === 'lung' ? onRib(p) : false;
    const tissue: Tissue | null = rib ? 'rib' : here?.tissue ?? null;
    const isBone = tissue !== null && BONE.has(tissue) && !(tissue === 'skull' && sdfInner(p) < 0);
    // Bone is ~1.8× as dense and much stronger: it slows the bullet more, yaws it, and throws fragments.
    const rho = isBone ? 1900 : TISSUE_RHO;
    let dE = 0.5 * rho * cdA * v * v * STEP;
    if (isBone) dE += 60e6 * frontA * STEP;
    const boneName = isBone ? (rib ? 'rib' : here!.name) : '';
    if (isBone && boneName !== inBone) {
      bone.push(boneName);
      neck = Math.min(neck, s + 0.015);
      shards = 0.05;
    }
    inBone = boneName;
    // The bullet breaks where it starts to yaw, if it is fast enough to: fragments shed into the cavity.
    let fragDE = 0;
    if (fragments > 0 && s >= neck && s < neck + 0.02) {
      const lose = (mass0 * fragments * STEP) / 0.02;
      fragDE = 0.5 * lose * v * v;
      mass -= lose;
    }
    const e = 0.5 * mass * v * v;
    dE = Math.min(dE, e);
    v = Math.sqrt(Math.max(0, (2 * (e - dE)) / mass));
    const dEds = (dE + fragDE) / STEP;
    // Channels: the crushed width (the bullet's presented size, fragments and bone shards widen it) and the cavity.
    const presented = b.diaM * Math.abs(Math.cos(yaw)) + b.lenM * sideways;
    const perm = presented / 2 + (fragDE > 0 || (fragments > 0 && s >= neck && s < neck + 0.12) ? 0.025 * (fragments / 0.3) : 0) + (shards > 0 ? 0.008 : 0) + 0.002;
    const cavity = Math.max(perm, cavityRadius(dEds));
    shards = Math.max(0, shards - STEP);
    if (i % 5 === 0) track.push({ p: [p[0], p[1], p[2]], perm, cavity });
    // Damage: whatever lies inside the permanent channel is destroyed; inelastic tissue within the cavity tears.
    for (const part of PARTS) {
      const dist = sdf(part.shape, p);
      const tear = perm + FRAGILITY[part.tissue] * Math.max(0, cavity - TEAR_FROM_M);
      if (dist > tear) continue;
      if (dist < perm) direct.add(part);
      // The slice of a disc of radius `tear` that lies inside the structure, approximately.
      const r = tear;
      const inside = dist <= -r ? 1 : (r - dist) / (2 * r);
      const area = Math.PI * r * r * Math.min(1, inside);
      vol.set(part, (vol.get(part) ?? 0) + area * STEP);
    }
    p[0] += d[0] * STEP; p[1] += d[1] * STEP; p[2] += d[2] * STEP;
    s += STEP;
  }
  // It never went in (a near miss of the outline).
  if (s < 0) return { damage: [], energyJ: 0, exitSpeed: w.speed, trackM: 0, track, bone };
  const exitSpeed = v > 25 ? v : 0;
  const energyJ = e0 - (exitSpeed > 0 ? 0.5 * mass * exitSpeed * exitSpeed : 0);
  const damage: Damage[] = [];
  for (const [part, v3] of vol) {
    const frac = Math.min(1, v3 / volume(part.shape));
    // A vessel or the cord counts once the channel reaches it; a brush of the cavity on a big organ does not.
    if (frac < 0.002 && !direct.has(part)) continue;
    damage.push({ part, frac, direct: direct.has(part) });
  }
  damage.sort((a, b2) => severity(b2) - severity(a));
  return { damage, energyJ, exitSpeed, trackM: Math.max(0, s), track, bone };
}

/** The brain's own ellipsoid: inside it the skull's bone is not in the way. */
function sdfInner(p: Vec3): number {
  let m = Infinity;
  for (const part of PARTS) if (part.tissue === 'brain' || part.tissue === 'brainstem') m = Math.min(m, sdf(part.shape, p));
  return m;
}

/** Rough order for listing: what matters most first. */
function severity(d: Damage): number {
  const t = d.part.tissue;
  const base = t === 'brainstem' || t === 'brain' ? 100 : t === 'cord' ? 90 : t === 'heart' ? 80 : t === 'artery' || t === 'vein' || t === 'hilum' ? 70
    : t === 'liver' || t === 'spleen' || t === 'kidney' ? 50 : t === 'hip' || t === 'pelvis' || t === 'femur' || t === 'vertebra' ? 45 : t === 'lung' ? 40 : 20;
  return base + d.frac * 10 + (d.direct ? 5 : 0);
}

/**
 * Blood pressure (as a fraction of normal) against the fraction of blood volume lost: held by vasoconstriction
 * to about 15 %, falling through class III shock (30–40 %), and gone toward 55–60 % (ATLS classes).
 */
export function pressureAt(loss: number): number {
  if (loss < 0.15) return 1;
  if (loss < 0.3) return 1 - ((loss - 0.15) / 0.15) * 0.25;
  if (loss < 0.45) return 0.75 - ((loss - 0.3) / 0.15) * 0.45;
  return Math.max(0, 0.3 - ((loss - 0.45) / 0.13) * 0.3);
}

/** A person hit: the wound and what it does to them. */
export function assess(w: WoundInput): Wound {
  const t = woundTrack(w);
  const R = (i: number) => rnd(w.seed, 100 + i);
  // The person: blood volume 70 mL/kg give or take, and how long the brain lasts once its supply stops.
  const blood = 5000 * (0.9 + 0.2 * R(0));
  const reserveS = 8 + 7 * R(1);
  const hit = (pred: (d: Damage) => boolean) => t.damage.filter(pred);
  const has = (tissue: Tissue, direct = true) => t.damage.some((d) => d.part.tissue === tissue && (!direct || d.direct));
  const cord = (level: CordLevel) => t.damage.some((d) => d.part.level === level && (d.direct || d.frac > 0.25));

  let fallS = Infinity, unconsciousS = Infinity, deathS = Infinity;
  let reflexFall = false;
  const causes: string[] = [];

  // ---- the central nervous system ----
  const brain = hit((d) => d.part.tissue === 'brain' && d.direct);
  const brainFrac = brain.reduce((a, d) => a + d.frac, 0);
  const brainstem = has('brainstem') || t.damage.some((d) => d.part.tissue === 'brainstem' && d.frac > 0.1);
  if (brainstem || cord('C1-C4')) {
    // The centres for breathing and the heart: down and out at once, breathing stops.
    fallS = unconsciousS = 0;
    deathS = brainstem ? 20 + 40 * R(2) : 150 + 120 * R(2);
    causes.push(brainstem ? 'brainstem destroyed' : 'neck spinal cord cut: stops breathing');
  } else if (brain.length) {
    // A rifle bullet through the brain: down at once. Fast ones burst the closed skull with their cavity.
    fallS = unconsciousS = 0;
    const crossesMidline = t.track.some((q) => q.p[0] > 0.012) && t.track.some((q) => q.p[0] < -0.012) && brain.some((d) => d.part.id === 'cerebrum');
    const fatal = brainFrac > 0.12 || crossesMidline || brain.some((d) => d.part.id === 'cerebellum') || R(3) < 0.75;
    if (fatal) deathS = brainFrac > 0.3 ? 30 + 60 * R(4) : 300 + 900 * R(4);
    causes.push(brainFrac > 0.3 ? 'head: brain destroyed' : 'head: brain wound');
  } else if (has('skull') || hit((d) => d.part.tissue === 'skull' && d.frac > 0.02).length) {
    // Through the scalp and bone but not into the brain: a grazing head wound often stuns.
    if (R(5) < 0.6) { fallS = 0.2; unconsciousS = R(6) < 0.5 ? 0.2 : Infinity; }
    causes.push('head: grazed the skull');
  }
  if (brainstem || cord('C1-C4')) { /* already down for good */ }
  else if (cord('C5-T1')) { fallS = Math.min(fallS, 0); causes.push('spinal cord cut at the neck: paralysed from the chest down, arms weak'); }
  else if (cord('T2-L1')) { fallS = Math.min(fallS, 0.1); causes.push('spinal cord cut: legs paralysed'); }
  else if (cord('cauda')) { fallS = Math.min(fallS, 0.3); causes.push('nerves to the legs cut'); }

  // ---- the skeleton ----
  if (has('hip') || has('femur') || hit((d) => (d.part.id === 'sacrum' || d.part.id === 'pubis') && d.direct).length) {
    fallS = Math.min(fallS, 0.3 + 0.4 * R(7));
    causes.push('pelvis broken: cannot stand');
  } else if (hit((d) => d.part.tissue === 'pelvis' && d.direct).length && R(8) < 0.5) {
    fallS = Math.min(fallS, 0.5 + R(8));
    causes.push('pelvis broken');
  }
  if (has('vertebra') && !causes.some((c) => c.includes('cord'))) {
    if (R(9) < 0.6) fallS = Math.min(fallS, 0.3);
    causes.push('spine broken');
  }

  // ---- bleeding, breathing and the heart ----
  const heart = t.damage.find((d) => d.part.tissue === 'heart');
  // A heart torn open (not just grazed) stops pumping: the brain has its reserve and no more.
  const pumpFails = !!heart && (heart.frac > 0.12 || (heart.direct && heart.frac > 0.04 && R(10) < 0.85));
  let bleed = 0, clotting = 0;
  const sources: { name: string; q: number }[] = [];
  for (const d of t.damage) {
    const vesselQ = VESSEL_BLEED[d.part.id];
    let q: number;
    // A vessel the channel crosses is cut; one only the cavity reaches may be torn.
    if (vesselQ !== undefined) q = d.direct ? vesselQ * (d.frac > 0.05 ? 1 : 0.5) : vesselQ * 0.25 * Math.min(1, d.frac * 20);
    // The kidneys lie behind the peritoneum, which holds their bleeding back in part.
    else q = (BLEED[d.part.tissue] ?? 0) * Math.min(1, 0.1 + 2 * d.frac) * (d.direct ? 1 : 0.5) * (d.part.tissue === 'kidney' ? 0.6 : 1);
    // Small tears in an organ (and vessels only stretched by the cavity) mostly clot within minutes: most low-grade
    // liver, spleen and kidney injuries stop by themselves. Big ones keep bleeding.
    const clots = vesselQ !== undefined ? (d.direct ? 0 : 1) : Math.max(0, 1 - d.frac / 0.15);
    bleed += q * (1 - clots);
    clotting += q * clots;
    if (q > 0.5 && d.part.tissue !== 'heart') sources.push({ name: d.part.name, q });
  }
  sources.sort((a, b2) => b2.q - a.q);
  // Muscle, broken bone, and the entry and exit wounds: small vessels, which clot over minutes.
  const ooze = 0.3 + 0.6 * t.trackM + 1.2 * t.damage.filter((d) => BONE.has(d.part.tissue) && d.direct).length;
  const lungs = hit((d) => d.part.tissue === 'lung' && d.direct).length;
  const airway = has('airway');

  // Step the blood volume and the brain's oxygen through the hour.
  let lost = 0, debt = 0, lost60 = 0;
  let bleedFall = Infinity, bleedOut = Infinity, faint = Infinity;
  const dt = 0.25;
  for (let time = 0; time <= 3600; time += dt) {
    const loss = lost / blood;
    let P = pumpFails ? 0 : pressureAt(loss);
    // Both lungs open to the air: breathing fails over a few minutes.
    if (lungs >= 2 || airway) P *= time > 120 ? Math.max(0.2, 1 - (time - 120) / 600) : 1;
    lost += (bleed + clotting * Math.exp(-time / 480) + ooze * Math.exp(-time / 300)) * Math.max(P, 0.05) * dt;
    if (time <= 60) lost60 = lost;
    // The brain runs on its reserve once pressure falls below what it needs (≈ 45 % of normal).
    debt = P < 0.45 ? debt + ((0.45 - P) / 0.45) * dt : Math.max(0, debt - dt * 0.2);
    if (faint === Infinity && debt >= reserveS) faint = time;
    // Class III shock (~33 % lost) and the person can no longer stay up.
    if (bleedFall === Infinity && loss >= 0.33) bleedFall = time;
    if (bleedOut === Infinity && (loss >= 0.58 || (pumpFails && time >= reserveS + 60))) bleedOut = time;
    if (bleedOut < Infinity) break;
  }
  if (faint < Infinity) {
    unconsciousS = Math.min(unconsciousS, faint);
    fallS = Math.min(fallS, faint, bleedFall);
  } else if (bleedFall < Infinity) fallS = Math.min(fallS, bleedFall);
  if (bleedOut < Infinity) deathS = Math.min(deathS, bleedOut);
  if (pumpFails) causes.push('heart torn open');
  else if (bleed + clotting > 1.5 && sources.length) {
    const from = sources.slice(0, 2).map((x) => x.name).join(' and ');
    const q = bleed + 0.3 * clotting;
    causes.push(`${q > 25 ? 'massive' : q > 6 ? 'heavy' : 'slow'} bleeding from the ${from}`);
  }
  if (lungs) causes.push(lungs >= 2 ? 'both lungs holed' : 'a lung holed');

  // Most people drop when a rifle bullet hits them, from pain, shock or expectation, whether or not the wound
  // forces it; more often the more it tears. The rest keep going for as long as their body lets them.
  if (fallS > 2) {
    const torso = t.track.some((q) => q.p[1] > 0.86 && q.p[1] < 1.47);
    const pDrop = Math.min(0.92, 0.35 + 0.35 * Math.sqrt(Math.min(1, t.energyJ / 1500)) + (torso ? 0.15 : 0));
    if (R(11) < pDrop) { fallS = 0.3 + 1.2 * R(12); reflexFall = true; }
  }

  const outcome: Outcome = deathS <= 3600 ? 'killed' : fallS < Infinity && !reflexFall ? 'downed' : 'wounded';
  if (!causes.length) causes.push(t.trackM > 0 ? 'flesh wound' : 'no wound');
  return {
    outcome,
    cause: causes.join(', '),
    fallS,
    unconsciousS,
    deathS,
    reflexFall: reflexFall && outcome === 'wounded',
    bloodLost60: Math.round(lost60),
    damage: t.damage,
    energyJ: t.energyJ,
    exitSpeed: t.exitSpeed,
    trackM: t.trackM,
    track: t.track,
  };
}
