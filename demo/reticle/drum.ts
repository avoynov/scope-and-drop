/**
 * The elevation dial on top of the scope: its detents and the engraving round its side, read at the index line
 * on the saddle. A range drum (SVD, VSS) is engraved with what the rifle is zeroed to (1 = 100 m) and clicks in
 * 50 m detents. The bolt rifle's mil turret clicks 0.1 mil, 10 mil a turn, and climbs its thread as it turns,
 * uncovering a line on the saddle for each full turn.
 */
import { dialHome, type Dial } from '../../src/scope/shot';

/** Dial rotation per detent: 15° on a range drum, 3.6° (100 clicks a turn) on the mil turret. */
export const drumStep = (d: Dial) => (d.kind === 'range' ? 15 : 360 / d.clicksPerRev) * (Math.PI / 180);
/** The detent of the 100 m zero, which faces the index when the dial is not turned. */
export const drumHome = dialHome;
/** Radius of the drum's engraved side. */
export const DRUM_R_MM = 19;
/** How far the mil turret climbs per turn (its thread pitch), so a full turn uncovers a line on the saddle. */
export const TURN_LIFT_MM = 1.2;

export interface Drum {
  /** A drum with `detents` detents, set to `index`. */
  set(detents: number, index: number): void;
  /** Turns by `clicks` detents (clamped at the ends). */
  turn(clicks: number): void;
  /** Eases the drum's position toward its detent; call once a frame. */
  step(dt: number): void;
  /** The drum's position in detents, as it turns from one to the next. */
  readonly pos: number;
}

export function createDrum(onTurn: (index: number) => void): Drum {
  let count = 1;
  let index = 0;
  let pos = 0;
  return {
    set(n, i) {
      count = n;
      index = pos = i;
    },
    turn(clicks) {
      const next = Math.max(0, Math.min(count - 1, index + clicks));
      if (next === index) return;
      index = next;
      onTurn(index);
    },
    step(dt) {
      // A detent snaps the drum over in a few hundredths of a second.
      const d = index - pos;
      pos = Math.abs(d) < 0.005 ? index : pos + d * (1 - Math.exp(-dt / 0.025));
    },
    get pos() {
      return pos;
    },
  };
}

/**
 * The drum's side as a texture, unrolled: the canvas runs once round the drum (u = angle / 2π from the
 * rear, increasing to the right as the shooter sees it) and from its top (y = 0) to the saddle. Each mark sits
 * as many detents round from the rear as it is from the zero, so the zero faces the eye when the drum is not
 * turned. Knurling on the top, paint-filled engraving in black anodising.
 */
export function paintDrum(dial: Dial): HTMLCanvasElement {
  return dial.kind === 'range' ? paintRangeDrum(dial.marksM, dial) : paintMilTurret(dial);
}

function blankDrum(knurl: number): [HTMLCanvasElement, CanvasRenderingContext2D, number, number] {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, W, H);
  // Straight knurling: ridges every 3°.
  const ridge = W / 120;
  for (let x = 0; x < W; x += ridge) {
    g.fillStyle = '#1d1d20';
    g.fillRect(x, 0, ridge * 0.45, H * knurl);
    g.fillStyle = '#040404';
    g.fillRect(x + ridge * 0.55, 0, ridge * 0.3, H * knurl);
  }
  g.fillStyle = '#000';
  g.fillRect(0, H * knurl, W, H * 0.02);
  g.fillStyle = '#d8d8d0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  return [c, g, W, H];
}

/**
 * Mil turret, after Leupold's M5C3: a line every click, longer on the half and whole mils, and three rows of
 * numbers, one per turn (0–9, 10–19, 20–29), so the row that matches the lines showing on the saddle gives the
 * mils dialled without counting turns.
 */
function paintMilTurret(d: Extract<Dial, { kind: 'mil' }>): HTMLCanvasElement {
  const [c, g, W, H] = blankDrum(0.22);
  const perMil = Math.round(1 / d.clickMil);
  const turns = Math.ceil(d.clicks / d.clicksPerRev);
  const rows = Array.from({ length: turns }, (_, k) => H * (0.34 + k * 0.14));
  for (let i = 0; i < d.clicksPerRev; i++) {
    const u = i / d.clicksPerRev;
    for (const x of [u * W, u * W - W, u * W + W]) {
      const whole = i % perMil === 0;
      const half = !whole && i % (perMil / 2) === 0;
      const w = whole ? W / 500 : W / 900;
      g.fillRect(x - w / 2, whole ? H * 0.74 : half ? H * 0.8 : H * 0.86, w, H);
      if (!whole) continue;
      rows.forEach((y, k) => {
        const mil = k * (d.clicksPerRev / perMil) + i / perMil;
        if (mil * perMil > d.clicks) return;
        g.font = `600 ${Math.round(H * (k === 0 ? 0.13 : 0.1))}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
        g.fillText(String(mil), x, y);
      });
    }
  }
  return c;
}

function paintRangeDrum(marks: readonly number[], dial: Dial): HTMLCanvasElement {
  const [c, g, W, H] = blankDrum(0.3);
  g.font = `600 ${Math.round(H * 0.2)}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  const home = drumHome(dial);
  const step = drumStep(dial);
  marks.forEach((m, i) => {
    let u = ((i - home) * step) / (2 * Math.PI);
    u -= Math.floor(u);
    for (const x of [u * W, u * W - W, u * W + W]) {
      const whole = m % 100 === 0;
      const w = W / 400;
      g.fillRect(x - w / 2, whole ? H * 0.78 : H * 0.86, w, H);
      if (whole) g.fillText(String(m / 100), x, H * 0.56);
    }
  });
  return c;
}
