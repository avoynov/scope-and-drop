/**
 * Pre-mission briefing: the floor plan with what the sniper would see, and a
 * dial to choose the bearing to shoot from. Nothing here changes the house;
 * moving the dial calls movePerch(), which only recomputes sightlines.
 */
import { movePerch, POI_VISIBLE, type MansionBlueprint } from '../src/mansion';

const INK = '#e9e4d8';
const MUTED = '#9a9486';
const ACCENT = '#e0b56a';
const SNIPER = '#ff5a5a';
const LEVEL_NAMES = ['ground', 'first', 'second', 'third'];

/** Unseen = deep slate, clearly seen = amber. One hue, so lightness alone carries the value. */
function ramp(v: number): [number, number, number] {
  const e = Math.pow(v, 0.8);
  return [Math.round(34 + (255 - 34) * e), Math.round(40 + (190 - 40) * e), Math.round(54 + (84 - 54) * e)];
}

function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function drawPlan(canvas: HTMLCanvasElement, bp: MansionBlueprint, level: number): void {
  const { ctx, w, h } = fit(canvas);
  const fp = bp.stats.footprint;
  const t = bp.site.terrace.rect;
  const pad = 2.5;
  const X0 = Math.min(fp.x0, t.x0) - pad;
  const X1 = Math.max(fp.x1, t.x1) + pad;
  const Z0 = fp.z0 - pad;
  const Z1 = Math.max(fp.z1, t.z1) + pad + 4;
  const s = Math.min(w / (X1 - X0), h / (Z1 - Z0));
  const ox = (w - (X1 - X0) * s) / 2;
  const oz = (h - (Z1 - Z0) * s) / 2;
  const sx = (x: number) => ox + (x - X0) * s;
  const sz = (z: number) => oz + (z - Z0) * s;

  // Sightline heat for this storey, straight from the nav grid.
  const n = bp.nav.levels.find((l) => l.level === level);
  if (n) {
    const img = new ImageData(n.cols, n.rows);
    const partyOrHall = bp.rooms.map((r) => r.role === 'party' || r.role === 'circulation');
    for (let k = 0; k < n.walk.length; k++) {
      if (!n.walk[k]) continue;
      const [r, g, b] = ramp(n.vis[k]! / 255);
      const ri = n.room[k]!;
      img.data[k * 4] = r;
      img.data[k * 4 + 1] = g;
      img.data[k * 4 + 2] = b;
      // Rooms guests do not use are drawn fainter.
      img.data[k * 4 + 3] = ri === -2 || (ri >= 0 && partyOrHall[ri]) ? 255 : 120;
    }
    const off = document.createElement('canvas');
    off.width = n.cols;
    off.height = n.rows;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, sx(n.originX), sz(n.originZ), n.cols * n.cell * s, n.rows * n.cell * s);
  }

  const path = (pts: { x: number; z: number }[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))));
    if (close) ctx.closePath();
  };

  // Dome hall: stair, gallery edge, void, curved walls.
  const a = bp.atrium;
  if (a) {
    const stair = bp.stairs.find((q) => q.id === a.stairId);
    if (level <= 1) {
      ctx.strokeStyle = level === 0 ? 'rgba(233,228,216,0.5)' : 'rgba(233,228,216,0.22)';
      ctx.lineCap = 'butt';
      for (const arm of stair?.arms ?? []) {
        ctx.lineWidth = arm.width * s;
        path(arm.path, false);
        ctx.stroke();
      }
    }
    const g = a.galleries.find((q) => q.level === level);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = ACCENT;
    if (g) for (const rail of g.rails) (path(rail, false), ctx.stroke());
    else if (level === 0) (path(a.void, false), ctx.stroke());
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 0.3 * s);
    for (const run of a.curvedWalls) (path(run, false), ctx.stroke());
    ctx.fillStyle = INK;
    for (const c of a.columns) {
      ctx.beginPath();
      ctx.arc(sx(c.x), sz(c.z), Math.max(1.5, a.columnRadius * s), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Walls with their openings: glass in blue, doorways left open.
  for (const wl of bp.walls) {
    if (wl.level !== level) continue;
    const base = wl.axis === 'x' ? wl.a.x : wl.a.z;
    const end = wl.axis === 'x' ? wl.b.x : wl.b.z;
    const line = wl.axis === 'x' ? wl.a.z : wl.a.x;
    const seg = (p: number, q: number, stroke: string, width: number) => {
      if (q - p < 0.02) return;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      if (wl.axis === 'x') (ctx.moveTo(sx(p), sz(line)), ctx.lineTo(sx(q), sz(line)));
      else (ctx.moveTo(sx(line), sz(p)), ctx.lineTo(sx(line), sz(q)));
      ctx.stroke();
    };
    const solid = Math.max(1.5, wl.thickness * s);
    let cur = base;
    for (const o of [...wl.openings].sort((p, q) => p.u0 - q.u0)) {
      seg(cur, base + o.u0, INK, solid);
      if (o.glazed) seg(base + o.u0, base + o.u1, o.frosted || o.curtain === 'drawn' ? '#5b6170' : '#7fd6ff', Math.max(1, solid * 0.35));
      cur = base + o.u1;
    }
    seg(cur, end, INK, solid);
  }

  // Room names.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(9, Math.min(12, s * 0.75))}px ui-monospace, Menlo, Consolas, monospace`;
  for (const r of bp.rooms) {
    if (r.level !== level) continue;
    const rw = (r.rect.x1 - r.rect.x0) * s;
    if (rw < 46) continue;
    const label = r.label.length * 6.4 > rw ? r.label.split(' ').pop()! : r.label;
    const x = sx((r.rect.x0 + r.rect.x1) / 2);
    const z = sz((r.rect.z0 + r.rect.z1) / 2);
    ctx.fillStyle = 'rgba(7,8,12,0.72)';
    ctx.fillRect(x - label.length * 3.3 - 4, z - 8, label.length * 6.6 + 8, 16);
    ctx.fillStyle = INK;
    ctx.fillText(label, x, z);
  }

  // Mission objects on this storey: filled when the sniper can watch them.
  for (const p of bp.pois) {
    if (p.level !== level) continue;
    ctx.beginPath();
    ctx.arc(sx(p.stand.x), sz(p.stand.z), 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#0b0d13';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = p.visibility >= POI_VISIBLE ? '#ffffff' : '#0b0d13';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // Line of fire, from the foot of the plan toward the garden front.
  const zG = bp.site.perch.target.z;
  const e = bp.site.perch.eye;
  const len = Math.hypot(e.x, e.z - zG);
  const ux = e.x / len;
  const uz = (e.z - zG) / len;
  const k1 = (Z1 - 0.6 - zG) / uz;
  const k0 = (Z1 - 4.6 - zG) / uz;
  ctx.strokeStyle = SNIPER;
  ctx.fillStyle = SNIPER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(ux * k1), sz(Z1 - 0.6));
  ctx.lineTo(sx(ux * k0), sz(Z1 - 4.6));
  ctx.stroke();
  const ax = sx(ux * k0);
  const az = sz(Z1 - 4.6);
  const ang = Math.atan2(-uz, -ux);
  ctx.beginPath();
  ctx.moveTo(ax + Math.cos(ang) * 7, az + Math.sin(ang) * 7);
  ctx.lineTo(ax + Math.cos(ang + 2.5) * 6, az + Math.sin(ang + 2.5) * 6);
  ctx.lineTo(ax + Math.cos(ang - 2.5) * 6, az + Math.sin(ang - 2.5) * 6);
  ctx.fill();
}

/** Bearing dial: the house at the top, the perch arc below it, bars showing how much each bearing sees. */
function drawDial(canvas: HTMLCanvasElement, bp: MansionBlueprint, az: number): { cx: number; cy: number; R: number } {
  const { ctx, w, h } = fit(canvas);
  const cx = w / 2;
  const cy = 26;
  const R = Math.min(h - 58, w * 0.62);
  const [lo, hi] = bp.site.perch.arcDeg;
  const pt = (deg: number, r: number): [number, number] => [cx + Math.sin((deg * Math.PI) / 180) * r, cy + Math.cos((deg * Math.PI) / 180) * r];
  // House.
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 26, cy - 12, 52, 12);
  ctx.fillStyle = MUTED;
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('garden front', cx, cy + 12);
  // What each sampled bearing sees.
  const best = Math.max(...bp.site.perch.options.map((o) => o.partyVisible), 0.01);
  for (const o of bp.site.perch.options) {
    const [x0, y0] = pt(o.azimuthDeg, R + 6);
    const [x1, y1] = pt(o.azimuthDeg, R + 6 + 26 * (o.partyVisible / best));
    ctx.strokeStyle = 'rgba(224,181,106,0.75)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // Arc.
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI / 2 - (hi * Math.PI) / 180, Math.PI / 2 - (lo * Math.PI) / 180);
  ctx.stroke();
  // Line of fire and the sniper.
  const [kx, ky] = pt(az, R);
  ctx.strokeStyle = SNIPER;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = SNIPER;
  ctx.beginPath();
  ctx.arc(kx, ky, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#07080c';
  ctx.lineWidth = 2;
  ctx.stroke();
  return { cx, cy, R };
}

export interface Briefing {
  open(bp: MansionBlueprint): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createBriefing(onDeploy: (bp: MansionBlueprint) => void): Briefing {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const root = $('brief');
  const plan = $<HTMLCanvasElement>('brief-plan');
  const dial = $<HTMLCanvasElement>('brief-dial');
  const slider = $<HTMLInputElement>('brief-az');
  let base: MansionBlueprint | null = null;
  let shown: MansionBlueprint | null = null;
  let level = 0;
  let geom = { cx: 0, cy: 0, R: 1 };
  let pending = 0;

  const render = () => {
    if (!shown) return;
    drawPlan(plan, shown, level);
    geom = drawDial(dial, shown, shown.site.perch.azimuthDeg);
    const sl = shown.sightlines;
    const seen = shown.pois.filter((p) => p.visibility >= POI_VISIBLE).length;
    const az = shown.site.perch.azimuthDeg;
    $('brief-title').textContent = `${shown.style.name} · ${shown.atrium?.shape === 'rotunda' ? 'rotunda' : 'galleried'} dome hall · ${shown.levels.length} storeys`;
    $('brief-bearing').textContent = `${az > 0 ? '+' : ''}${az.toFixed(0)}° ${Math.abs(az) < 0.5 ? 'dead centre' : az > 0 ? 'east of the axis' : 'west of the axis'} · ${shown.site.perch.distance.toFixed(0)} m`;
    $('brief-party').textContent = `${Math.round(sl.partyVisible * 100)}%`;
    $('brief-terrace').textContent = `${Math.round(sl.terrace * 100)}%`;
    $('brief-hidden').textContent = `${Math.round(sl.hiddenShare * 100)}%`;
    $('brief-pois').textContent = `${seen} of ${shown.pois.length}`;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#brief-floors button')) b.classList.toggle('on', Number(b.dataset.level) === level);
  };

  const setAz = (deg: number) => {
    if (!base) return;
    const [lo, hi] = base.site.perch.arcDeg;
    const az = Math.max(lo, Math.min(hi, Math.round(deg)));
    slider.value = String(az);
    // Recomputing sightlines takes a few tens of milliseconds: do it once per frame at most.
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      shown = movePerch(base!, az);
      render();
    });
  };

  slider.addEventListener('input', () => setAz(Number(slider.value)));
  const fromPointer = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    setAz((Math.atan2(e.clientX - r.left - geom.cx, e.clientY - r.top - geom.cy) * 180) / Math.PI);
  };
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  dial.addEventListener('pointermove', (e) => e.buttons && fromPointer(e));
  $('brief-deploy').onclick = () => {
    if (shown) onDeploy(shown);
    api.close();
  };
  addEventListener('resize', () => root.classList.contains('on') && render());
  addEventListener('keydown', (e) => {
    if (!root.classList.contains('on') || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') setAz(Number(slider.value) - 2);
    else if (e.key === 'ArrowRight') setAz(Number(slider.value) + 2);
    else if (e.key === 'Enter') $('brief-deploy').click();
  });

  const api: Briefing = {
    open(bp) {
      base = bp;
      shown = bp;
      level = 0;
      const [lo, hi] = bp.site.perch.arcDeg;
      slider.min = String(lo);
      slider.max = String(hi);
      slider.value = String(Math.round(bp.site.perch.azimuthDeg));
      const floors = $('brief-floors');
      floors.replaceChildren();
      for (const lv of bp.levels) {
        const b = document.createElement('button');
        b.textContent = LEVEL_NAMES[lv.index] ?? `level ${lv.index}`;
        b.dataset.level = String(lv.index);
        b.onclick = () => {
          level = lv.index;
          render();
        };
        floors.appendChild(b);
      }
      root.classList.add('on');
      render();
    },
    close() {
      root.classList.remove('on');
    },
    get isOpen() {
      return root.classList.contains('on');
    },
  };
  return api;
}
