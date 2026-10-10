/**
 * The wound card: what the last bullet into a mannequin would have done to a person, drawn on the body's
 * front and side with the organs, the permanent channel and the temporary cavity, and a timeline of what
 * happens to them (on their feet, down, incapacitated, unconscious, dead) running from the moment it struck.
 */
import { HEAD, PARTS, TORSO_BASE, TORSO_PROFILE, type Shape } from '../../src/body/anatomy';
import type { Tissue } from '../../src/body/anatomy';
import type { Wound } from '../../src/body/wound';

const PX = 190; // pixels per metre
const Y0 = 1.76, Y1 = 0.8;
const H = (Y0 - Y1) * PX;

/** Tissue colours, muted: the hit ones are drawn over them in red. */
const TINT: Partial<Record<Tissue, string>> = {
  brain: '#b9a4c8', brainstem: '#b9a4c8', cord: '#e0d38a', heart: '#c46a5e', artery: '#c94a3e', vein: '#5a6fb8', hilum: '#a0605a',
  lung: '#d7a5a0', airway: '#9fb7c8', liver: '#8a4a3a', spleen: '#7a3d55', kidney: '#9a5040', stomach: '#c8a080', gut: '#c8a68a',
  vertebra: '#d8d2c0', pelvis: '#d8d2c0', hip: '#d8d2c0', femur: '#d8d2c0', sternum: '#d8d2c0',
};

type View = 'front' | 'side';
/** Body coordinates to the card: front view looks at the person (their left on the right); side view from their left (front on the left). */
function to(view: View, ox: number, x: number, y: number, z: number): [number, number] {
  return [ox + (view === 'front' ? x : -z) * PX, (Y0 - y) * PX];
}

function shape(view: View, ox: number, s: Shape, attrs: string): string {
  if (s.kind === 'e') {
    const [cx, cy] = to(view, ox, s.c[0], s.c[1], s.c[2]);
    return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${((view === 'front' ? s.r[0] : s.r[2]) * PX).toFixed(1)}" ry="${(s.r[1] * PX).toFixed(1)}" ${attrs}/>`;
  }
  const [ax, ay] = to(view, ox, s.a[0], s.a[1], s.a[2]);
  const [bx, by] = to(view, ox, s.b[0], s.b[1], s.b[2]);
  return `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke-width="${(2 * s.r * PX).toFixed(1)}" stroke-linecap="round" ${attrs}/>`;
}

function outline(view: View, ox: number): string {
  const pts = TORSO_PROFILE.map(([r, h, f]) => to(view, ox, view === 'front' ? r : r * f, TORSO_BASE + h, -r * f));
  const back = [...pts].reverse().map(([x, y]) => [2 * ox - x, y] as [number, number]);
  const d = [...pts, ...back].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
  const [hx, hy] = to(view, ox, HEAD.c[0], HEAD.c[1], HEAD.c[2]);
  const hr = (view === 'front' ? HEAD.r[0] : HEAD.r[2]) * PX;
  const style = 'fill="rgba(233,228,216,0.06)" stroke="rgba(233,228,216,0.45)" stroke-width="1"';
  return `<path d="${d}" ${style}/><ellipse cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" rx="${hr.toFixed(1)}" ry="${(HEAD.r[1] * PX).toFixed(1)}" ${style}/>`;
}

function view(w: Wound, v: View, ox: number): string {
  const hit = new Map(w.damage.map((d) => [d.part, d]));
  let s = outline(v, ox);
  // Back to front in depth, so the near organs draw over the far ones.
  const order = [...PARTS].filter((p) => TINT[p.tissue]).reverse();
  for (const p of order) s += shape(v, ox, p.shape, p.shape.kind === 'e' ? `fill="${TINT[p.tissue]}" fill-opacity="0.22" stroke="${TINT[p.tissue]}" stroke-opacity="0.5" stroke-width="0.6"` : `stroke="${TINT[p.tissue]}" stroke-opacity="0.55"`);
  for (const [p, d] of hit) {
    const a = (0.15 + 0.85 * Math.min(1, d.frac * 4)).toFixed(2);
    s += shape(v, ox, p.shape, p.shape.kind === 'e' ? `fill="#ff4a3d" fill-opacity="${a}" stroke="#ff7a6d" stroke-width="1"` : `stroke="#ff4a3d" stroke-opacity="${a}"`);
  }
  // The temporary cavity (a pale band) and the permanent channel along the track.
  const tr = w.track;
  for (const key of ['cavity', 'perm'] as const) {
    for (let i = 0; i < tr.length - 1; i++) {
      const [ax, ay] = to(v, ox, ...tr[i]!.p);
      const [bx, by] = to(v, ox, ...tr[i + 1]!.p);
      const wpx = Math.max(key === 'perm' ? 1.4 : 0, 2 * tr[i]![key] * PX);
      s += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${key === 'perm' ? '#ffd9a0' : '#ffb070'}" stroke-opacity="${key === 'perm' ? 0.95 : 0.16}" stroke-width="${wpx.toFixed(1)}" stroke-linecap="round"/>`;
    }
  }
  if (tr.length) {
    const [ex, ey] = to(v, ox, ...tr[0]!.p);
    s += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.2" fill="#ffd9a0"/>`;
  }
  return s;
}

/** The body diagram for a wound, front and side. */
export function woundSvg(w: Wound): string {
  const fx = 0.27 * PX, sx = 0.27 * 2 * PX + 0.16 * PX;
  const width = sx + 0.16 * PX;
  const label = (x: number, t: string) => `<text x="${x}" y="${H - 2}" fill="#9a9486" font-size="9" text-anchor="middle">${t}</text>`;
  return `<svg viewBox="0 0 ${width.toFixed(0)} ${H.toFixed(0)}" width="${width.toFixed(0)}" height="${H.toFixed(0)}">${view(w, 'front', fx)}${view(w, 'side', sx)}${label(fx, 'front')}${label(sx, 'side')}</svg>`;
}

const time = (s: number) => (s < 1 ? 'at once' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** Where they are `since` seconds after the hit. */
export function woundNow(w: Wound, since: number): string {
  if (since >= w.deathS) return 'dead';
  if (since >= w.unconsciousS && since < w.wakeS) return 'down, unconscious';
  if (since >= w.incapacitatedS && since < w.recoverS) return since >= w.fallS ? 'down, awake but helpless' : 'awake but helpless';
  if (since >= w.fallS) return w.reflexFall ? 'dropped, could get up' : w.outcome === 'wounded' ? 'down' : 'down, conscious';
  return 'on their feet';
}

/** What glass did to the bullet before it struck: share of its speed lost, its yaw on striking, and its jacket. */
export interface GlassNote {
  lost: number;
  yawRad: number;
  stripped: boolean;
}

/** The card's text: verdict, cause, timeline and what the bullet did. */
export function woundText(w: Wound, speed: number, since: number, glass?: GlassNote | null): string {
  const verdict = w.outcome === 'killed' ? 'KILLED' : w.outcome === 'downed' ? 'DOWNED' : 'WOUNDED';
  const line = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;
  const organs = w.damage.filter((d) => d.direct || d.frac > 0.05).slice(0, 5).map((d) => d.part.name).join(', ') || '—';
  return `<div class="wound-head"><b class="${w.outcome}">${verdict}</b><span>${woundNow(w, since)}</span></div>` +
    `<div class="wound-cause">${w.cause}</div><dl>` +
    line('Struck at', `${Math.round(speed)} m/s · ${Math.round(w.energyJ)} J left in`) +
    (glass ? line('Glass', `${Math.round(glass.lost * 100)} % slower · ${Math.round((glass.yawRad * 180) / Math.PI)}° yaw${glass.stripped ? ' · jacket off' : ''}`) : '') +
    line('Bullet', w.exitSpeed > 0 ? `through, out at ${Math.round(w.exitSpeed)} m/s` : `stayed in, ${Math.round(w.trackM * 100)} cm deep`) +
    line('Hit', organs) +
    line('Falls', w.fallS < Infinity ? time(w.fallS) + (w.reflexFall ? ' (reflex)' : '') : 'stays up') +
    line('Incapacitated', w.incapacitatedS < Infinity ? time(w.incapacitatedS) + (w.recoverS < Infinity ? `, recovers at ${time(w.recoverS)}` : '') : '—') +
    line('Unconscious', w.unconsciousS < Infinity ? time(w.unconsciousS) + (w.wakeS < Infinity ? `, comes round at ${time(w.wakeS)}` : '') : '—') +
    line('Dies', w.deathS < Infinity ? time(w.deathS) : 'not within the hour') +
    line('Lost in 1 min', `${w.bloodLost60} mL`) +
    `</dl>`;
}
