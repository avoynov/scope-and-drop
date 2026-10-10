/**
 * The elevation drum on top of the scope, as the shooter reads it: the side of the knurled drum from
 * behind, with its range marks running round it past the index line on the scope body. It clicks in 50 m
 * detents; the number at the index is what the rifle is zeroed to (1 = 100 m). Drag it sideways, scroll
 * over it, tap either side, or press [ and ].
 */

/** Drum rotation per detent. The SVD's 19 clicks then fill 342° of the drum. */
export const DRUM_STEP = (18 * Math.PI) / 180;

export interface DrumDial {
  /** Shows a drum with these marks (metres), set to `index`. */
  set(marks: readonly number[], index: number): void;
  /** Turns by `clicks` detents (clamped at the ends). */
  turn(clicks: number): void;
  /** The drum's displayed position in detents, eased toward the set one (for the 3D drum). */
  readonly pos: number;
}

export function createDrum(el: HTMLCanvasElement, onTurn: (index: number) => void, still = false): DrumDial {
  const ctx = el.getContext('2d')!;
  let marks: readonly number[] = [0, 100];
  let index = 1;
  let pos = 1;
  let raf = 0;

  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = el.clientWidth || 220;
    const h = el.clientHeight || 64;
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    return { w, h, dpr };
  };

  function draw(): void {
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    // The drum's radius on screen: a little more than half the canvas, so about ±70° of it shows.
    const R = w * 0.5;
    const top = 4;
    const knurl = 11;
    const band = h - 22;
    const visible = (th: number) => Math.abs(th) < 1.3;
    // Scope body under the drum: the turret saddle, a little wider than the drum, lit from above.
    const by = top + band;
    const bg = ctx.createLinearGradient(0, by - 2, 0, h);
    bg.addColorStop(0, '#2c2c30');
    bg.addColorStop(0.25, '#151517');
    bg.addColorStop(1, '#070708');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, by - 2, w, h - by + 2, [3, 3, 6, 6]);
    ctx.fill();
    // Anodised drum: a dark cylinder, lit from the upper left.
    const dx = w * 0.04;
    const g = ctx.createLinearGradient(dx, 0, w - dx, 0);
    g.addColorStop(0, '#050506');
    g.addColorStop(0.32, '#26262a');
    g.addColorStop(0.55, '#141416');
    g.addColorStop(1, '#040405');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(dx, top, w - 2 * dx, band, [4, 4, 0, 0]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Knurled grip: ridges every 3° round the drum, turning with it.
    const ridge = (3 * Math.PI) / 180;
    const base = -((pos * DRUM_STEP) % ridge);
    for (let th = base - 1.5; th < 1.5; th += ridge) {
      if (!visible(th)) continue;
      const x = cx + R * Math.sin(th);
      const lit = 0.25 + 0.5 * Math.max(0, Math.cos(th + 0.5));
      ctx.strokeStyle = `rgba(200,200,205,${0.18 * lit})`;
      ctx.lineWidth = Math.max(0.6, 1.4 * Math.cos(th));
      ctx.beginPath();
      ctx.moveTo(x, top + 1);
      ctx.lineTo(x, top + knurl);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, top + knurl, w, 1.5);
    // Engraved, paint-filled marks: numbers on the hundreds, short lines on the 50 m clicks between.
    const y0 = top + knurl + 3;
    marks.forEach((m, i) => {
      const th = (i - pos) * DRUM_STEP;
      if (!visible(th)) return;
      const x = cx + R * Math.sin(th);
      const c = Math.cos(th);
      ctx.globalAlpha = Math.min(1, 0.25 + c * 0.9);
      ctx.strokeStyle = ctx.fillStyle = '#ece6d6';
      const whole = m % 100 === 0;
      ctx.lineWidth = 1.3 * c;
      ctx.beginPath();
      ctx.moveTo(x, band + top - (whole ? 9 : 6));
      ctx.lineTo(x, band + top);
      ctx.stroke();
      if (whole) {
        ctx.save();
        ctx.translate(x, y0 + 9);
        ctx.scale(c, 1);
        ctx.font = '600 15px "DIN Alternate", "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(m / 100), 0, 0);
        ctx.restore();
      }
    });
    ctx.globalAlpha = 1;
    // Shade the drum's far sides.
    const sh = ctx.createLinearGradient(dx, 0, w - dx, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.9)');
    sh.addColorStop(0.18, 'rgba(0,0,0,0)');
    sh.addColorStop(0.82, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, top, w, band);
    // The cap's machined edge catches the sky.
    ctx.fillStyle = 'rgba(220,225,235,0.22)';
    ctx.fillRect(dx, top, w - 2 * dx, 1);
    ctx.restore();
    // The fixed index line on the body, which the marks are read against.
    ctx.fillStyle = '#ece6d6';
    ctx.beginPath();
    ctx.moveTo(cx, by + 1);
    ctx.lineTo(cx - 4, by + 7);
    ctx.lineTo(cx + 4, by + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 0.6, by + 7, 1.2, h - by - 9);
  }

  function animate(): void {
    raf = 0;
    const d = index - pos;
    // A detent snaps the drum over in a few frames.
    pos = Math.abs(d) < 0.01 ? index : pos + d * 0.45;
    draw();
    if (pos !== index) raf = requestAnimationFrame(animate);
  }
  const kick = () => {
    if (still) { pos = index; draw(); return; }
    if (!raf) raf = requestAnimationFrame(animate);
  };

  function turn(clicks: number): void {
    const next = Math.max(0, Math.min(marks.length - 1, index + clicks));
    if (next === index) return;
    index = next;
    onTurn(index);
    kick();
  }

  // Drag: one detent per drum step of arc under the finger. A tap without a drag clicks once toward that side.
  let drag: { x: number; moved: number; acc: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, moved: 0, acc: 0 };
    e.stopPropagation();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    drag.moved += Math.abs(dx);
    drag.acc -= dx;
    const arc = el.clientWidth * 0.5 * DRUM_STEP;
    while (Math.abs(drag.acc) >= arc) {
      const s = Math.sign(drag.acc);
      turn(s);
      drag.acc -= s * arc;
    }
    e.stopPropagation();
  });
  el.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 4) {
      const r = el.getBoundingClientRect();
      turn(e.clientX < r.left + r.width / 2 ? -1 : 1);
    }
    drag = null;
    e.stopPropagation();
  });
  let wheel = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wheel += e.deltaY + e.deltaX;
    while (Math.abs(wheel) >= 40) {
      const s = Math.sign(wheel);
      turn(-s);
      wheel -= s * 40;
    }
  }, { passive: false });
  addEventListener('resize', draw);

  return {
    set(m, i) {
      marks = m;
      index = i;
      pos = i;
      draw();
    },
    turn,
    get pos() {
      return pos;
    },
  };
}
