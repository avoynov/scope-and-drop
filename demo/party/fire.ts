/**
 * Fire from the perch (armoury task 8): a shot from the treeline at whoever is picked, or at the dome hall's
 * centre when nobody is, along a straight line from the perch's eye, with a rifle and its kit as the armoury
 * fits them (rigFor). Who heard the report, the crack and the strike goes in the log and in the sound overlay.
 * The shot is a query: the evening runs on as if it never went off (what guests make of it is milestone 4).
 *
 *   fire=svd | svd,can | bolt | bolt,can | bolt,sub | vss   fires once at t= on load
 *   glass=single|double|laminated|tempered   windows=shut|french|all
 */
import { emptyLoadout, type Loadout } from "../../src/armoury/loadout";
import { rigFor } from "../../src/armoury/rig";
import type { MansionBlueprint } from "../../src/mansion/core/types";
import type { Party } from "../../src/party";
import { CHEST, chestOf, hearShot, SHOT_SOUNDS, straightShot, type ShotHeard, type ShotIn, type ShotSound } from "../../src/party/shot";
import type { GlazingId } from "../../src/scope/glass";
import type { RifleId } from "../../src/scope/shot";

type Kit = "open" | "can" | "sub";
const RIFLES: Record<RifleId, { label: string; kits: Kit[] }> = {
  svd: { label: "SVD", kits: ["open", "can"] },
  bolt: { label: "Sako .308", kits: ["open", "can", "sub"] },
  vss: { label: "VSS", kits: ["open"] },
};
const KIT_LABEL: Record<Kit, string> = { open: "open muzzle", can: "can", sub: "can, subsonic" };
const GLASS: readonly GlazingId[] = ["single", "double", "laminated", "tempered"];
type Windows = "shut" | "french" | "all";
const WINDOWS_LABEL: Record<Windows, string> = { shut: "windows shut", french: "French windows open", all: "every window open" };
/** The overlay's colour for each sound. */
export const SHOT_RGB: Record<ShotSound, string> = { report: "224, 181, 106", crack: "226, 106, 96", strike: "143, 199, 229" };

export interface FiredShot {
  t: number;
  /** "SVD, open muzzle" and the like, and at whom. */
  label: string;
  at: string;
  shot: ShotIn & { blocked: boolean };
  heard: ShotHeard;
}

const loadoutFor = (rifle: RifleId, kit: Kit): Loadout => {
  const l = emptyLoadout(rifle);
  if (rifle !== "vss" && kit !== "open") l.items.muzzle = "can";
  if (rifle === "bolt" && kit === "sub") l.items.ammo = "sub200";
  return l;
};

export class FireLab {
  readonly shots: FiredShot[] = [];
  private rifle: RifleId = "svd";
  private kit: Kit = "open";
  private glass: GlazingId = "single";
  private windows: Windows = "shut";

  constructor(
    params: URLSearchParams,
    private readonly host: { party(): Party; bp(): MansionBlueprint; selected(): number; changed(): void },
    root: HTMLElement,
  ) {
    const g = params.get("glass") as GlazingId | null;
    if (g && GLASS.includes(g)) this.glass = g;
    const w = params.get("windows") as Windows | null;
    if (w && w in WINDOWS_LABEL) this.windows = w;
    const f = params.get("fire")?.split(",");
    if (f && f[0]! in RIFLES) {
      this.rifle = f[0] as RifleId;
      const k = f[1] as Kit | undefined;
      if (k && RIFLES[this.rifle].kits.includes(k)) this.kit = k;
    }
    this.build(root);
  }

  /** The URL's shot, once the evening has reached t=. */
  fireFromUrl(params: URLSearchParams): void {
    if (params.get("fire")) this.fire();
  }

  /** A new evening: the shots fired into the last one are gone with it. */
  reset(): void {
    this.shots.length = 0;
  }

  private build(root: HTMLElement): void {
    root.textContent = "";
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "shot";
    const rifle = document.createElement("select");
    rifle.setAttribute("aria-label", "Rifle");
    for (const id of Object.keys(RIFLES) as RifleId[]) rifle.add(new Option(RIFLES[id].label, id, id === this.rifle, id === this.rifle));
    const kit = document.createElement("select");
    kit.setAttribute("aria-label", "Kit");
    const kits = () => {
      kit.textContent = "";
      const ks = RIFLES[this.rifle].kits;
      if (!ks.includes(this.kit)) this.kit = ks[0]!;
      // The VSS's can is its own: it is never fired without it.
      for (const k of ks) kit.add(new Option(this.rifle === "vss" ? "its own can" : KIT_LABEL[k], k, k === this.kit, k === this.kit));
    };
    kits();
    rifle.onchange = () => {
      this.rifle = rifle.value as RifleId;
      kits();
    };
    kit.onchange = () => (this.kit = kit.value as Kit);
    const go = document.createElement("button");
    go.textContent = "fire from the perch";
    go.title = "A shot from the perch along a straight line to whoever is picked (else the dome hall's centre): who hears it goes in the log and the sound overlay. Nothing in the evening reacts.";
    go.onclick = () => this.fire();
    row.append(label, rifle, kit, go);
    const row2 = document.createElement("div");
    row2.className = "row";
    const glass = document.createElement("select");
    glass.setAttribute("aria-label", "The house's glass");
    for (const id of GLASS) glass.add(new Option(`${id} glass`, id, id === this.glass, id === this.glass));
    glass.onchange = () => (this.glass = glass.value as GlazingId);
    const windows = document.createElement("select");
    windows.setAttribute("aria-label", "Windows");
    for (const id of Object.keys(WINDOWS_LABEL) as Windows[]) windows.add(new Option(WINDOWS_LABEL[id], id, id === this.windows, id === this.windows));
    windows.onchange = () => (this.windows = windows.value as Windows);
    row2.append(glass, windows);
    root.append(row, row2);
  }

  /** The openings standing open, by the windows choice. */
  private openings(): ReadonlySet<string> {
    if (this.windows === "shut") return new Set();
    const ids = new Set<string>();
    for (const w of this.host.bp().walls) {
      if (!w.exterior) continue;
      for (const o of w.openings) if ((o.kind === "french-window" && o.passable) || (this.windows === "all" && o.glazed)) ids.add(o.id);
    }
    return ids;
  }

  fire(): void {
    const party = this.host.party();
    const bp = this.host.bp();
    const rig = rigFor(loadoutFor(this.rifle, this.kit));
    const p = party.people[this.host.selected()];
    let aim;
    let at: string;
    if (p?.present) {
      aim = chestOf(p);
      at = p.name;
    } else {
      const a = bp.atrium;
      const hall = a ? bp.rooms.find((r) => r.id === a.roomId) : undefined;
      const t = bp.site.perch.target;
      aim = a && hall ? { x: a.dome.x, y: hall.floorY + CHEST, z: a.dome.z, room: hall.index, level: hall.level, who: -1 } : { x: t.x, y: t.y, z: t.z, room: -1, level: 0, who: -1 };
      at = hall ? `the ${hall.label.toLowerCase()}'s centre` : "the garden front";
    }
    const shot = straightShot(party, bp.site.perch.eye, aim, { report: rig.report, round: rig.rifle.round, glazing: this.glass, open: this.openings() });
    const n = this.shots.filter((s) => s.t === party.t).length;
    const heard = hearShot(party, { ...shot, n });
    const label = `${RIFLES[this.rifle].label}, ${this.rifle === "vss" ? "its own can" : KIT_LABEL[this.kit]}`;
    this.shots.push({ t: party.t, label, at, shot, heard });
    this.host.changed();
  }

  /** The log's lines for the shots fired so far, newest first. */
  lines(t: number): { t: number; text: string }[] {
    const out: { t: number; text: string }[] = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (s.t > t) continue;
      const h = s.heard;
      const what = s.shot.blocked ? "struck the wall" : s.shot.struck === "body" ? "struck them" : "struck";
      const n = (k: ShotSound) => `${k} ${h.heard[k].length}`;
      const sounds = SHOT_SOUNDS.filter((k) => k !== "crack" || h.cracked)
        .map(n)
        .join(", ");
      out.push({ t: s.t, text: `shot from the perch (${s.label}) at ${s.at}, ${what}: heard by ${h.heardBy} (${sounds}${h.cracked ? "" : "; no crack"})` });
    }
    return out;
  }

  /** Shots still drawn at t (in-game s), newest last. */
  recent(t: number, fade: number): FiredShot[] {
    return this.shots.filter((s) => t >= s.t && t - s.t <= fade);
  }
}
