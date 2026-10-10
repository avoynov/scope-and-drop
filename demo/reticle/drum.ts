/**
 * The elevation drum on top of the scope: its detents and the engraving round its side. The number at the
 * index line on the saddle is what the rifle is zeroed to (1 = 100 m). It clicks in 50 m detents.
 */

/** Drum rotation per detent. The bolt dial's 19 clicks from 0 to 10 then take 285°, leaving a clear gap between its ends. */
export const DRUM_STEP = (15 * Math.PI) / 180;
/** The detent of the drum's 1 (100 m), which faces the index when the drum is not turned. */
export const drumHome = (marks: readonly number[]) => Math.max(0, marks.indexOf(100));
/** Radius of the drum's engraved side. */
export const DRUM_R_MM = 19;

export interface Drum {
  /** A drum with these marks (metres), set to `index`. */
  set(marks: readonly number[], index: number): void;
  /** Turns by `clicks` detents (clamped at the ends). */
  turn(clicks: number): void;
  /** Eases the drum's position toward its detent; call once a frame. */
  step(dt: number): void;
  /** The drum's position in detents, as it turns from one to the next. */
  readonly pos: number;
}

export function createDrum(onTurn: (index: number) => void): Drum {
  let marks: readonly number[] = [100];
  let index = 0;
  let pos = 0;
  return {
    set(m, i) {
      marks = m;
      index = pos = i;
    },
    turn(clicks) {
      const next = Math.max(0, Math.min(marks.length - 1, index + clicks));
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
 * as many detents round from the rear as it is from the 1, so the 1 faces the eye when the drum is not turned. Knurling on the
 * top third, numbers on the hundreds, a line on every detent: paint-filled engraving in black anodising.
 */
export function paintDrum(marks: readonly number[]): HTMLCanvasElement {
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
    g.fillRect(x, 0, ridge * 0.45, H * 0.3);
    g.fillStyle = '#040404';
    g.fillRect(x + ridge * 0.55, 0, ridge * 0.3, H * 0.3);
  }
  g.fillStyle = '#000';
  g.fillRect(0, H * 0.3, W, H * 0.02);
  const paint = '#d8d8d0';
  g.fillStyle = paint;
  g.font = `600 ${Math.round(H * 0.2)}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const home = drumHome(marks);
  marks.forEach((m, i) => {
    let u = ((i - home) * DRUM_STEP) / (2 * Math.PI);
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
