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
 *  - Only disrupting the brain or brainstem stops someone at once. Cutting the cord high in the neck drops
 *    them and stops their breathing, but they stay conscious until the oxygen in their blood runs out. Everything
 *    else works through blood loss and takes time: stop the brain's blood supply entirely and consciousness goes
 *    in 4–10 s (Rossen, Kabat and Anderson, 1942, neck-cuff occlusion in volunteers); with the heart destroyed a
 *    man may keep acting for 10–15 s (FBI, Handgun Wounding Factors and Effectiveness, 1989). A cut femoral
 *    artery takes minutes. Lungs, liver, spleen and gut take minutes to hours. Breaking a hip joint or thigh
 *    bone drops someone mechanically, still conscious. Most people also drop when hit even when nothing forces
 *    them to, and a few do not drop with wounds that will kill them.
 *
 * Everything is deterministic for a seed (the shot number), so a still and its readout agree.
 */
import { PARTS, classify, inBody, onRib, partVolume, sdf, type CordLevel, type Part, type Tissue, type Vec3 } from './anatomy';

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
 * diameter follow the striking speed by about v^0.8, as fitted to the 200 m / 800 m sniper-round study (≈1.44×).
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
 * output at low pressure; lung tissue itself bleeds little and mostly stops. A hole through the heart's wall
 * lets out what the ventricle pumps into it.
 */
const BLEED: Partial<Record<Tissue, number>> = {
  heart: 60, artery: 0, vein: 0, hilum: 55, lung: 6, liver: 30, spleen: 12, kidney: 12, stomach: 4, gut: 4, face: 6, airway: 2,
};
/**
 * Vessels: by name, bleeding at normal pressure when cut (mL/s). The aorta and pulmonary trunk carry the whole
 * cardiac output; cut across, they empty the circulation itself (see `assess`).
 */
const VESSEL_BLEED: Record<string, number> = {
  'aorta-asc': 85, 'aorta-arch': 85, 'aorta-t': 80, 'aorta-a': 70, pulmonary: 70, svc: 35, ivc: 40,
  'carotid-l': 18, 'carotid-r': 18, 'jugular-l': 10, 'jugular-r': 10, 'vertebral-l': 4, 'vertebral-r': 4,
  'subclavian-l': 15, 'subclavian-r': 15, 'iliac-l': 28, 'iliac-r': 28, 'ext-iliac-l': 22, 'ext-iliac-r': 22,
  'femoral-l': 18, 'femoral-r': 18,
};
/** Cut across, these collapse the circulation at once, like the heart failing. */
const GREAT_VESSELS = new Set(['aorta-asc', 'aorta-arch', 'aorta-t', 'pulmonary']);
/** Solid and hollow organs bleed from their substance: little from a narrow track, a lot once torn apart. */
const PARENCHYMA = new Set<Tissue>(['lung', 'liver', 'spleen', 'kidney', 'stomach', 'gut', 'face', 'airway']);
/** The most a body can bleed (mL/s): all of a stressed heart's output. */
const MAX_BLEED = 100;

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
  /** For a vessel or the cord: how much of its width the permanent channel cut through (0–1). */
  cut: number;
}

export type Outcome = 'killed' | 'downed' | 'wounded';

export interface Wound {
  /** Killed: dead within the hour without help (as "killed in action" counts it). Downed: down and out of the
   * fight but alive an hour on. Wounded: still on their feet and able to act. */
  outcome: Outcome;
  /** What happens, in a few words. */
  cause: string;
  /** Seconds after the hit: they fall (any reason) and lose consciousness. Infinity = not within the hour. */
  fallS: number;
  unconsciousS: number;
  /** Seconds after the hit they come round again (a concussion), Infinity if they do not. */
  wakeS: number;
  /**
   * Seconds after the hit they can no longer do anything on purpose (fight, aim, crawl to cover, call out
   * sensibly) though they may still be awake: arms paralysed, dazed, confused by shock, the last seconds as
   * the brain's blood runs out. Never later than unconsciousS. Infinity = not within the hour.
   */
  incapacitatedS: number;
  /** Seconds after the hit they can act again (a concussion clearing), Infinity if they do not. */
  recoverS: number;
  /** Heart and breathing both stopped (clinical death). */
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
  const cut = new Map<Part, number>();
  // Two directions across the track, for sampling the disc around it.
  const ax: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit([d[1] * ax[2] - d[2] * ax[1], d[2] * ax[0] - d[0] * ax[2], d[0] * ax[1] - d[1] * ax[0]]);
  const v2: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
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
    const here = classify(p);
    const rib = !here || here.tissue === 'lung' ? onRib(p) : false;
    const tissue: Tissue | null = rib ? 'rib' : here?.tissue ?? null;
    const isBone = tissue !== null && BONE.has(tissue);
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
    // What throws tissue outward is the drag through it; the work of breaking bone goes into the bone (its
    // shards are counted in the channel).
    const dEds = (Math.min(dE, 0.5 * TISSUE_RHO * cdA * v * v * STEP) + fragDE) / STEP;
    // Channels: the crushed width (the bullet's presented size, fragments and bone shards widen it) and the cavity.
    const presented = b.diaM * Math.abs(Math.cos(yaw)) + b.lenM * sideways;
    const perm = presented / 2 + (fragDE > 0 || (fragments > 0 && s >= neck && s < neck + 0.12) ? 0.025 * (fragments / 0.3) : 0) + (shards > 0 ? 0.008 : 0) + 0.002;
    const cavity = Math.max(perm, cavityRadius(dEds));
    shards = Math.max(0, shards - STEP);
    if (i % 5 === 0) track.push({ p: [p[0], p[1], p[2]], perm, cavity });
    // Damage, sampled on a disc across the track: whatever lies inside the permanent channel is destroyed;
    // within the cavity each tissue tears as far as its fragility lets it. Each sample belongs to one structure.
    const reach = perm + Math.max(0, cavity - TEAR_FROM_M);
    const spin = i * 0.618;
    for (const [r0, r1, rings, around] of reach > perm ? [[0, perm, 3, 12], [perm, reach, 6, 16]] as const : [[0, perm, 3, 12]] as const) {
      for (let k = 0; k < rings; k++) {
        const a0 = r0 + ((r1 - r0) * k) / rings, a1 = r0 + ((r1 - r0) * (k + 1)) / rings;
        const r = Math.sqrt((a0 * a0 + a1 * a1) / 2);
        const area = (Math.PI * (a1 * a1 - a0 * a0)) / around;
        for (let j = 0; j < around; j++) {
          const th = ((j + spin + k * 0.5) / around) * 2 * Math.PI;
          const c = Math.cos(th) * r, sn = Math.sin(th) * r;
          const q: Vec3 = [p[0] + u[0] * c + v2[0] * sn, p[1] + u[1] * c + v2[1] * sn, p[2] + u[2] * c + v2[2] * sn];
          if (!inBody(q)) continue;
          const part = classify(q);
          if (!part || r > perm + FRAGILITY[part.tissue] * Math.max(0, cavity - TEAR_FROM_M)) continue;
          vol.set(part, (vol.get(part) ?? 0) + area * STEP);
          if (r <= perm) direct.add(part);
        }
      }
    }
    // Vessels and the cord: how much of their width the channel cuts (a thin one can slip between samples).
    for (const part of THIN) {
      const gap = sdf(part.shape, p);
      if (gap >= perm) continue;
      const w = (part.shape as { r: number }).r;
      cut.set(part, Math.max(cut.get(part) ?? 0, Math.min(1, (perm - gap) / (2 * w))));
      direct.add(part);
    }
    p[0] += d[0] * STEP; p[1] += d[1] * STEP; p[2] += d[2] * STEP;
    s += STEP;
  }
  // It never went in (a near miss of the outline).
  if (s < 0) return { damage: [], energyJ: 0, exitSpeed: w.speed, trackM: 0, track, bone };
  const exitSpeed = v > 25 ? v : 0;
  const energyJ = e0 - (exitSpeed > 0 ? 0.5 * mass * exitSpeed * exitSpeed : 0);
  const damage: Damage[] = [];
  for (const part of new Set([...vol.keys(), ...direct])) {
    const frac = Math.min(1, (vol.get(part) ?? 0) / partVolume(part));
    // A vessel or the cord counts once the channel reaches it; a brush of the cavity on a big organ does not.
    if (frac < 0.002 && !direct.has(part)) continue;
    damage.push({ part, frac, direct: direct.has(part), cut: cut.get(part) ?? 0 });
  }
  damage.sort((a, b2) => severity(b2) - severity(a));
  return { damage, energyJ, exitSpeed, trackM: Math.max(0, s), track, bone };
}

/** Vessels and the cord: thin capsules whose cut matters more than their volume. */
const THIN = PARTS.filter((p) => p.shape.kind === 'c' && (p.tissue === 'artery' || p.tissue === 'vein' || p.tissue === 'cord'));

/** The whole brain's volume (m³). */
const brainVolume = () => PARTS.filter((p) => p.tissue === 'brain' || p.tissue === 'brainstem').reduce((a, p) => a + partVolume(p), 0);

const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Rough order for listing: what matters most first. */
function severity(d: Damage): number {
  const t = d.part.tissue;
  const base = t === 'brainstem' || t === 'brain' ? 100 : t === 'cord' ? 90 : t === 'heart' ? 80 : t === 'artery' || t === 'vein' || t === 'hilum' ? 70
    : t === 'liver' || t === 'spleen' || t === 'kidney' ? 50 : t === 'hip' || t === 'pelvis' || t === 'femur' || t === 'vertebra' ? 45 : t === 'lung' ? 40 : 20;
  return base + d.frac * 10 + (d.direct ? 5 : 0);
}

/**
 * Mean arterial pressure (as a fraction of normal) against the fraction of blood volume lost in a fast bleed,
 * after the ATLS classes: held by vasoconstriction to 15 %; through class II (15–30 %) the systolic pressure is
 * still normal and the mean only a little lower; it falls through class III (30–40 %, systolic under 90 mmHg)
 * and class IV (over 40 %), and is gone toward 55 %.
 */
export function pressureAt(loss: number): number {
  if (loss < 0.15) return 1;
  if (loss < 0.3) return 1 - ((loss - 0.15) / 0.15) * 0.1;
  if (loss < 0.4) return 0.9 - ((loss - 0.3) / 0.1) * 0.25;
  if (loss < 0.5) return 0.65 - ((loss - 0.4) / 0.1) * 0.35;
  return Math.max(0, 0.3 - ((loss - 0.5) / 0.05) * 0.3);
}

/** A person hit: the wound and what it does to them. */
export function assess(w: WoundInput): Wound {
  const t = woundTrack(w);
  const R = (i: number) => rnd(w.seed, 100 + i);
  // The person: blood volume 70 mL/kg give or take.
  const blood = 5000 * (0.9 + 0.2 * R(0));
  // How long the brain stays conscious with no blood reaching it: 4–10 s when the neck's arteries are clamped
  // (Rossen, Kabat and Anderson), up to 10–15 s with a destroyed heart's last weak beats (FBI 1989).
  const reserveS = 6 + 8 * R(1);
  // Once the circulation has failed, how long until the heart stops for good and the last gasps end.
  const arrestS = 45 + 75 * R(13);
  const hit = (pred: (d: Damage) => boolean) => t.damage.filter(pred);
  const has = (tissue: Tissue, direct = true) => t.damage.some((d) => d.part.tissue === tissue && (!direct || d.direct));
  // The channel through the cord cuts it; the cavity's stretch alone stuns it (a spinal concussion) and
  // the paralysis mostly passes.
  const cord = (level: CordLevel) => t.damage.some((d) => d.part.level === level && d.direct);
  const cordStunned = t.damage.some((d) => d.part.tissue === 'cord' && !d.direct && d.frac > 0.25);

  let fallS = Infinity, unconsciousS = Infinity, wakeS = Infinity, deathS = Infinity;
  // Out of action for good (incapS), or for a while (dazed from dazeS to dazeEnd: a concussion).
  let incapS = Infinity, dazeS = Infinity, dazeEnd = Infinity;
  let reflexFall = false;
  const causes: string[] = [];

  // ---- the central nervous system ----
  const brain = hit((d) => d.part.tissue === 'brain' && d.direct);
  const brainFrac = brain.reduce((a, d) => a + d.frac * partVolume(d.part), 0) / brainVolume();
  const brainstem = has('brainstem') || t.damage.some((d) => d.part.tissue === 'brainstem' && d.frac > 0.1);
  if (brainstem) {
    // The centres for consciousness, breathing and blood pressure: down and out at once, breathing stops; the
    // heart beats on without oxygen for a few minutes.
    fallS = unconsciousS = incapS = 0;
    deathS = 120 + 180 * R(2);
    causes.push('brainstem destroyed: breathing stops');
  } else if (brain.length) {
    // A bullet through the brain. What kills (civilian and military head-wound series): a track across both
    // hemispheres (but not one across both frontal lobes only), through the ventricles and deep nuclei, or into
    // the posterior fossa, and a fast bullet's cavity bursting the closed skull. A small, low-energy wound
    // through one lobe can leave someone conscious and alive.
    const inBrain = t.track.filter((q) => { const c = classify(q.p); return !!c && (c.tissue === 'brain' || c.tissue === 'brainstem'); });
    const bihemispheric = inBrain.some((q) => q.p[0] > 0.01) && inBrain.some((q) => q.p[0] < -0.01) && !inBrain.every((q) => q.p[2] > 0.015);
    const deep = brain.some((d) => d.part.id === 'deep');
    const posterior = brain.some((d) => d.part.id === 'cerebellum');
    const massive = brainFrac > 0.25;
    const minor = !deep && !posterior && !bihemispheric && brainFrac < 0.03 && t.energyJ < 700;
    fallS = 0;
    // Of the few who stay awake, about half are too stunned to do anything; the rest can still act.
    if (minor && R(15) < 0.3) { fallS = 0.3 + R(16); if (R(20) < 0.5) incapS = 0; }
    else unconsciousS = incapS = 0;
    const pFatal = massive || deep || posterior || bihemispheric ? 1 : minor ? 0.25 : Math.min(0.95, 0.3 + 3 * brainFrac + 0.3 * Math.min(1, t.energyJ / 1500));
    if (R(3) < pFatal) {
      // Most die where they fall; some hours later as the brain swells.
      deathS = massive ? 60 + 240 * R(4) : R(17) < 0.7 ? 180 + 2400 * R(4) : Infinity;
      causes.push(massive ? 'head: brain destroyed' : deathS < Infinity ? 'head: fatal brain wound' : 'head: brain wound, fatal within hours');
    } else causes.push('head: brain wound');
  } else if (has('skull') || hit((d) => d.part.tissue === 'skull' && d.frac > 0.02).length) {
    // Through the scalp and bone but not into the brain: a grazing head wound often stuns, sometimes knocks
    // them out for a while.
    // Stunned, they are dazed for a minute or two; knocked out, they come round confused and stay so for minutes
    // (the confusion after a concussion).
    if (R(5) < 0.6) {
      fallS = dazeS = 0.2;
      dazeEnd = 10 + 110 * R(21);
      if (R(6) < 0.5) { unconsciousS = 0.2; wakeS = 20 + 280 * R(18); dazeEnd = wakeS + 60 + 540 * R(21); }
    }
    causes.push('head: grazed the skull');
  }
  if (brainstem) { /* already down for good */ }
  else if (cord('C1-C4')) {
    // The diaphragm's nerves (C3–C5) are cut off: they drop, paralysed from the neck down and unable to breathe,
    // but conscious until their blood runs out of oxygen (sooner for the blood pressure falling as the cord's
    // control of the vessels goes). The heart stops from lack of oxygen a few minutes later.
    fallS = incapS = 0;
    unconsciousS = Math.min(unconsciousS, 45 + 75 * R(2));
    deathS = Math.min(deathS, 240 + 240 * R(14));
    causes.push('spinal cord cut high in the neck: cannot breathe');
  } else if (cord('C5-T1')) {
    // The hands and most of the arms go with it (C5–T1 is the brachial plexus): they cannot hold or use anything.
    fallS = incapS = 0;
    causes.push('spinal cord cut at the neck: paralysed from the chest down, hands useless');
  }
  else if (cord('T2-L1')) { fallS = Math.min(fallS, 0.1); causes.push('spinal cord cut: legs paralysed'); }
  else if (cord('cauda')) { fallS = Math.min(fallS, 0.3); causes.push('nerves to the legs cut'); }
  else if (cordStunned) {
    fallS = Math.min(fallS, 0.2);
    // Stunned in the neck, all four limbs go for a while (transient quadriplegia: minutes, sometimes hours).
    if (t.damage.some((d) => d.part.tissue === 'cord' && !d.direct && d.frac > 0.25 && (d.part.level === 'C1-C4' || d.part.level === 'C5-T1'))) {
      dazeS = Math.min(dazeS, 0.2);
      dazeEnd = 600 + 6600 * R(23);
    }
    causes.push('spinal cord stunned: limbs give way');
  }

  // ---- the skeleton ----
  // The hip joint and the thigh bone carry the weight: broken, the leg folds. A hole through the pelvic ring
  // itself (wing, sacrum, pubis) leaves it standing; whether they stay up is down to the pain.
  if (has('hip') || has('femur')) {
    fallS = Math.min(fallS, 0.3 + 0.4 * R(7));
    causes.push(has('hip') ? 'hip joint broken: cannot stand' : 'thigh bone broken: cannot stand');
  } else if (hit((d) => d.part.tissue === 'pelvis' && d.direct).length) {
    if (R(8) < 0.5) fallS = Math.min(fallS, 0.5 + R(8));
    causes.push('pelvis broken');
  }
  if (has('vertebra') && !causes.some((c) => c.includes('cord'))) {
    if (R(9) < 0.6) fallS = Math.min(fallS, 0.3);
    causes.push('spine broken');
  }

  // ---- bleeding, breathing and the heart ----
  const hearts = t.damage.filter((d) => d.part.tissue === 'heart');
  const heartVol = PARTS.filter((p) => p.tissue === 'heart').reduce((a, p) => a + partVolume(p), 0);
  const heart = hearts.length ? { frac: hearts.reduce((a, d) => a + d.frac * partVolume(d.part), 0) / heartVol, direct: hearts.some((d) => d.direct) } : null;
  // A rifle bullet through a chamber (not a graze of its surface) mostly stops the heart pumping at once: the
  // brain has its reserve and no more. A small hole now and then lets it beat on, bleeding fast.
  const pumpFails = !!heart && (heart.frac > 0.12 || (heart.direct && heart.frac > 0.008 && R(10) < 0.9));
  // The aorta or pulmonary trunk cut across: the heart's output pours out through it and none reaches the brain.
  const collapse = t.damage.some((d) => GREAT_VESSELS.has(d.part.id) && d.direct && d.cut >= 0.6);
  let bleed = 0, clotting = 0;
  const sources: { name: string; q: number }[] = [];
  // The heart's two parts bleed as one.
  const organs: Damage[] = [...t.damage.filter((d) => d.part.tissue !== 'heart'), ...(heart ? [{ ...hearts[0]!, frac: heart.frac, direct: heart.direct }] : [])];
  for (const d of organs) {
    const vesselQ = VESSEL_BLEED[d.part.id];
    let q: number;
    // A vessel the channel crosses is cut (a partial cut bleeds as freely as a clean one, which retracts and
    // narrows); one only the cavity reaches may be torn.
    if (vesselQ !== undefined) q = d.direct ? vesselQ * (d.cut > 0.3 ? 1 : 0.5) : vesselQ * 0.25 * Math.min(1, d.frac * 20);
    // The kidneys lie behind the peritoneum, which holds their bleeding back in part.
    else {
      const full = (BLEED[d.part.tissue] ?? 0) * (d.part.tissue === 'kidney' ? 0.6 : 1);
      // An organ: a narrow track (a grade III tear) oozes and often stops; torn across (grade IV–V) it pours.
      // The heart's and the lung roots' big vessels bleed in proportion to the hole.
      q = PARENCHYMA.has(d.part.tissue)
        ? full * (Math.min(1, (d.frac / 0.4) ** 1.5) + (d.direct ? 0.03 : 0))
        : full * Math.min(1, 0.3 * (d.direct ? 1 : 0) + 2 * d.frac);
      if (!d.direct) q *= 0.5;
    }
    // Small tears in an organ (and vessels only stretched by the cavity) mostly clot within minutes: most low-grade
    // liver, spleen and kidney injuries stop by themselves. Big ones keep bleeding.
    const clots = vesselQ !== undefined ? (d.direct ? 0 : 1) : Math.max(0, 1 - d.frac / 0.25);
    bleed += q * (1 - clots);
    clotting += q * clots;
    if (q > 0.5 && d.part.tissue !== 'heart') sources.push({ name: d.part.name, q });
  }
  sources.sort((a, b2) => b2.q - a.q);
  // Muscle, broken bone, and the entry and exit wounds: small vessels, which clot over minutes.
  const ooze = 0.3 + 0.6 * t.trackM + 1.2 * t.damage.filter((d) => BONE.has(d.part.tissue) && d.direct).length;
  const lungs = new Set(hit((d) => d.part.tissue === 'lung' && d.direct).map((d) => d.part.id)).size;
  // The larynx or windpipe torn open: blood runs into the lungs and swelling closes it, about half the time.
  const airway = t.damage.some((d) => d.part.tissue === 'airway' && d.direct && d.frac > 0.2) && R(19) < 0.5;
  // Both carotids cut: only the vertebral arteries feed the brain.
  const carotids = t.damage.filter((d) => d.part.id.startsWith('carotid') && d.direct && d.cut > 0.3).length;

  // Step the blood volume and the brain's oxygen through the hour. Bleeding follows the pressure, which follows
  // the volume lost (pressureAt).
  let lost = 0, debt = 0, lost60 = 0, lowFor = 0;
  let bleedFall = Infinity, faint = Infinity, arrest = Infinity, shock = Infinity, greying = Infinity;
  // The last seconds before they faint: sight greys and goes, the eyes fix, the limbs stop obeying (Rossen's
  // neck-cuff subjects; the pilots' "almost loss of consciousness" under g).
  const greyAt = Math.max(0.6 * reserveS, reserveS - 3);
  const dt = 0.25;
  for (let time = 0; time <= 3600; time += dt) {
    const loss = lost / blood;
    let P = pumpFails ? 0 : pressureAt(loss);
    // Both lungs open to the air, or the airway: breathing fails over a few minutes.
    if (lungs >= 2 || airway) P *= time > 120 ? Math.max(0.2, 1 - (time - 120) / 600) : 1;
    // What reaches the brain and the heart's own arteries.
    const Pb = (collapse ? 0.15 : 1) * (carotids >= 2 ? 0.35 : 1) * P;
    lost += Math.min(MAX_BLEED, bleed + clotting * Math.exp(-time / 480) + ooze * Math.exp(-time / 300)) * Math.max(P, 0.05) * dt;
    if (time <= 60) lost60 = lost;
    // The brain runs on its reserve once pressure falls below what it needs (≈ 45 % of normal).
    debt = Pb < 0.45 ? debt + ((0.45 - Pb) / 0.45) * dt : Math.max(0, debt - dt * 0.2);
    if (greying === Infinity && debt >= greyAt) greying = time;
    if (faint === Infinity && debt >= reserveS) faint = time;
    // Class III shock: they can no longer stay on their feet. Class IV: confused and listless, past doing anything.
    if (bleedFall === Infinity && loss >= 0.35) bleedFall = time;
    if (shock === Infinity && loss >= 0.4) shock = time;
    // The heart stops once too little pressure has fed it for a while, or the blood is gone.
    lowFor = Pb < 0.2 ? lowFor + dt : 0;
    if (lowFor >= arrestS || loss >= 0.55) { arrest = time; break; }
  }
  if (faint < Infinity) {
    unconsciousS = Math.min(unconsciousS, faint);
    wakeS = Infinity;
    fallS = Math.min(fallS, faint, bleedFall);
  } else if (bleedFall < Infinity) fallS = Math.min(fallS, bleedFall);
  if (arrest < Infinity) deathS = Math.min(deathS, arrest);
  unconsciousS = Math.min(unconsciousS, deathS);
  // Fighting for breath with both lungs open or the airway full of blood leaves room for nothing else.
  const breathless = lungs >= 2 || airway ? 30 + 90 * R(22) : Infinity;
  incapS = Math.min(incapS, greying, shock, breathless, wakeS === Infinity ? unconsciousS : Infinity);
  // A concussion that clears before anything else puts them out of action is the only incapacity that passes.
  const passes = dazeEnd < incapS && dazeEnd <= 3600;
  const incapacitatedS = Math.min(incapS, dazeS, unconsciousS);
  const recoverS = passes && incapacitatedS < Infinity ? dazeEnd : Infinity;
  if (incapacitatedS < Infinity && !passes) fallS = Math.min(fallS, incapacitatedS);
  if (pumpFails) causes.push('heart torn open');
  else if (collapse) causes.push(`${t.damage.find((d) => GREAT_VESSELS.has(d.part.id) && d.cut >= 0.6)!.part.name} cut across`);
  else if (bleed + clotting > 1.5 && sources.length) {
    const from = sources.slice(0, 2).map((x) => x.name).join(' and ');
    const q = bleed + 0.3 * clotting;
    causes.push(`${q > 25 ? 'massive' : q > 6 ? 'heavy' : 'slow'} bleeding from the ${from}`);
  }
  if (lungs) causes.push(lungs >= 2 ? 'both lungs holed' : 'a lung holed');
  if (airway) causes.push('airway torn: chokes on blood');
  // Organs holed without much bleeding still count: the gut leaks, a kidney bleeds into its own space.
  const holed = [...new Set(t.damage.filter((d) => d.direct && PARENCHYMA.has(d.part.tissue) && d.part.tissue !== 'lung' && d.part.tissue !== 'face' && !(airway && d.part.tissue === 'airway')
    && !causes.some((c) => c.includes(d.part.name))).map((d) => d.part.name))];
  if (holed.length) causes.push(`${holed.slice(0, 2).join(' and ')} holed`);

  // Most people drop when a rifle bullet hits them, from pain, shock or expectation, whether or not the wound
  // forces it; more often the more it tears. The rest keep going for as long as their body lets them.
  // A reflex drop before a fall the wound forces later is still a fall they will not get up from.
  const forced = fallS;
  if (fallS > 2 && t.trackM > 0) {
    const torso = t.track.some((q) => q.p[1] > 0.86 && q.p[1] < 1.47);
    const pDrop = Math.min(0.92, 0.35 + 0.35 * Math.sqrt(Math.min(1, t.energyJ / 1500)) + (torso ? 0.15 : 0));
    if (R(11) < pDrop) { fallS = 0.3 + 1.2 * R(12); reflexFall = forced === Infinity; }
  }

  const outcome: Outcome = deathS <= 3600 ? 'killed' : forced < Infinity ? 'downed' : 'wounded';
  if (!causes.length) causes.push(t.trackM > 0 ? 'flesh wound' : 'no wound');
  return {
    outcome,
    cause: causes.join(', '),
    fallS,
    unconsciousS,
    wakeS: unconsciousS < Infinity ? wakeS : Infinity,
    incapacitatedS,
    recoverS,
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
