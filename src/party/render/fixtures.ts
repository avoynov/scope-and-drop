/**
 * The mansion's moving fittings: interior door leaves, window drapes and sheers. The builder
 * leaves them out of its merged mesh and hands them back as data (BuildOptions.dynamicDoors /
 * dynamicCurtains); here they are instanced boxes and pleated panels, lit by the room scope
 * they hang in (an instanced `aScope`, as the crowd is).
 *
 * A fully open door and a curtain in its starting state are drawn where the baked ones were,
 * with the same extents and pleat depths. A drape keeps its number of pleats as it moves, so
 * drawing an open curtain spreads its folds and opening a drawn one bunches them up.
 */
import * as THREE from "three";
import type { CurtainSpec, DoorLeafSpec } from "../../mansion/build";
import type { ScopedLighting } from "../../mansion/build/lighting";
import { RECIPES, type MaterialLibrary } from "../../mansion/build/materials";

export interface FixturesOptions {
  /**
   * The mansion's material library: leaves, drapes and sheers then share the baked trim,
   * fabric and sheer materials (textures, env map) and match them exactly. Without it they
   * get plain materials of the same tone.
   */
  materials?: MaterialLibrary;
}

/** Pleats per drape: about the baked pitch in the state the window starts in (7 cm open, 6 cm drawn). */
const PLEATS = { open: 9, drawn: 17 } as const;
/** Drape geometry, as the builder hangs it: off the wall at the back, out to the crests, past the window at the outer edge. */
const BACK = 0.02;
const DEPTH = { open: 0.09, drawn: 0.1 } as const;
const OUTER = { open: 0.32, drawn: 0.25 } as const;
/** Drawn drapes overlap this far past the middle. */
const MEET = 0.02;
/** The sheer hangs this far into the room and this far past the window each side. */
const SHEER_DEPTH = 0.06;
const SHEER_PAST = 0.1;
/** Nominal size (m) the unit drape's UVs stand for, so fabric textures keep about their scale. */
const DRAPE_UV: [number, number] = [0.6, 3];

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpB = new THREE.Box3();
const tmpC = new THREE.Color();

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Leaf instances of one opening (double doors have two, consecutive). */
interface LeafRange {
  first: number;
  count: number;
}

export class Fixtures {
  readonly root = new THREE.Group();
  private readonly leaves: DoorLeafSpec[];
  private readonly curtains: CurtainSpec[];
  private readonly doors: THREE.InstancedMesh;
  /** Drapes of windows that start open or sheer, and of those that start drawn (different pleat counts). */
  private readonly drapes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly sheers: THREE.InstancedMesh;
  private readonly owned: THREE.Material[] = [];
  private readonly leafIndex = new Map<string, LeafRange>();
  private readonly windowIndex = new Map<string, number>();
  /** Per leaf: 0 closed .. 1 open. */
  private readonly open: Float32Array;
  /** Per window: 0 open .. 1 drawn; sheer shown; which drape mesh and its pair of slots there. */
  private readonly drawn: Float32Array;
  private readonly sheer: Uint8Array;
  private readonly group: Uint8Array;
  private readonly slot: Uint32Array;
  private readonly leafDirty: Uint8Array;
  private readonly windowDirty: Uint8Array;
  private leavesChanged = true;
  private windowsChanged = true;

  constructor(leaves: DoorLeafSpec[], curtains: CurtainSpec[], lighting: ScopedLighting, opts: FixturesOptions = {}) {
    this.root.name = "fixtures";
    this.leaves = leaves;
    this.curtains = curtains;
    const lib = opts.materials;
    const own = (key: string, tone = 1, roughness?: number) => {
      const m = lighting.patch(plain(key, tone, roughness));
      this.owned.push(m);
      return m;
    };
    // Texture means (sRGB) stand in for the plaster and fabric textures.
    const leafMat = lib?.get("int-trim") ?? own("int-trim", 0.95);
    const drapeMat = lib?.get("fabric") ?? own("fabric", 0.82, 0.82);
    const sheerMat = lib?.get("sheer") ?? own("sheer");

    // Door leaves: a box from the hinge along +z, thickness across x, standing on y = 0.
    const nl = leaves.length;
    this.doors = this.instanced("doors", new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5), leafMat, nl, (i) => leaves[i]!.scope);
    leaves.forEach((l, i) => {
      this.doors.setColorAt(i, tmpC.set(l.color));
      const r = this.leafIndex.get(l.opening);
      if (r) r.count++;
      else this.leafIndex.set(l.opening, { first: i, count: 1 });
    });
    this.open = new Float32Array(nl).fill(1);
    this.leafDirty = new Uint8Array(nl).fill(1);

    // Curtains: two drapes per window in the mesh with its starting pleat count, one sheer.
    const nw = curtains.length;
    this.drawn = new Float32Array(nw);
    this.sheer = new Uint8Array(nw);
    this.group = new Uint8Array(nw);
    this.slot = new Uint32Array(nw);
    this.windowDirty = new Uint8Array(nw).fill(1);
    const members: [number[], number[]] = [[], []];
    curtains.forEach((c, w) => {
      this.windowIndex.set(c.opening, w);
      this.drawn[w] = c.start === "drawn" ? 1 : 0;
      this.sheer[w] = c.start === "sheer" ? 1 : 0;
      const g = c.start === "drawn" ? 1 : 0;
      this.group[w] = g;
      this.slot[w] = members[g].length;
      members[g].push(w);
    });
    this.drapes = ([0, 1] as const).map((g) => {
      const list = members[g];
      const mesh = this.instanced(g ? "drapes-drawn" : "drapes-open", pleatGeometry(g ? PLEATS.drawn : PLEATS.open), drapeMat, list.length * 2, (i) => curtains[list[i >> 1]!]!.scope);
      list.forEach((w, s) => {
        tmpC.set(curtains[w]!.color);
        mesh.setColorAt(s * 2, tmpC);
        mesh.setColorAt(s * 2 + 1, tmpC);
      });
      return mesh;
    }) as [THREE.InstancedMesh, THREE.InstancedMesh];
    this.sheers = this.instanced("sheers", sheerGeometry(), sheerMat, nw, (i) => curtains[i]!.scope);
    this.sheers.castShadow = false;
    this.sheers.receiveShadow = false;
    this.sheers.renderOrder = 2;
    this.update();
  }

  private instanced(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, scope: (i: number) => number): THREE.InstancedMesh {
    // Library materials take vertex colours; white leaves the instance colour as the tint.
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3).fill(1), 3));
    const scopes = new Float32Array(Math.max(1, n));
    for (let i = 0; i < n; i++) scopes[i] = scope(i);
    geo.setAttribute("aScope", new THREE.InstancedBufferAttribute(scopes, 1));
    geo.computeBoundingBox();
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.name = `fixtures-${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** 0 closed .. 1 open (open = the old baked pose). Unknown openings are ignored. */
  setDoor(opening: string, open: number): void {
    const r = this.leafIndex.get(opening);
    if (!r) return;
    const v = clamp01(open);
    for (let i = r.first; i < r.first + r.count; i++) {
      if (this.open[i] === v) continue;
      this.open[i] = v;
      this.leafDirty[i] = 1;
      this.leavesChanged = true;
    }
  }

  /** 0 open .. 1 drawn; sheer shows the sheer panel (left as it is when omitted). Unknown openings are ignored. */
  setCurtain(opening: string, drawn: number, sheer?: boolean): void {
    const w = this.windowIndex.get(opening);
    if (w === undefined) return;
    const v = clamp01(drawn);
    const s = sheer === undefined ? this.sheer[w]! : sheer ? 1 : 0;
    if (this.drawn[w] === v && this.sheer[w] === s) return;
    this.drawn[w] = v;
    this.sheer[w] = s;
    this.windowDirty[w] = 1;
    this.windowsChanged = true;
  }

  /** Write changed instance matrices; cheap when nothing changed. */
  update(): void {
    if (this.leavesChanged) {
      this.leavesChanged = false;
      for (let i = 0; i < this.leaves.length; i++) {
        if (!this.leafDirty[i]) continue;
        this.leafDirty[i] = 0;
        this.doors.setMatrixAt(i, this.leafMatrix(i, tmpM));
      }
      this.doors.instanceMatrix.needsUpdate = true;
    }
    if (this.windowsChanged) {
      this.windowsChanged = false;
      for (let w = 0; w < this.curtains.length; w++) {
        if (!this.windowDirty[w]) continue;
        this.windowDirty[w] = 0;
        const mesh = this.drapes[this.group[w]!];
        const s = this.slot[w]! * 2;
        mesh.setMatrixAt(s, this.drapeMatrix(w, -1, tmpM));
        mesh.setMatrixAt(s + 1, this.drapeMatrix(w, 1, tmpM));
        mesh.instanceMatrix.needsUpdate = true;
        this.sheers.setMatrixAt(w, this.sheer[w] ? this.sheerMatrix(w, tmpM) : ZERO);
      }
      this.sheers.instanceMatrix.needsUpdate = true;
    }
  }

  /** World box around an opening's moving parts as last drawn by update(): its leaves, or its drapes and sheer. Empty if the opening has none. */
  bounds(opening: string, target: THREE.Box3): THREE.Box3 {
    target.makeEmpty();
    const r = this.leafIndex.get(opening);
    if (r) for (let i = r.first; i < r.first + r.count; i++) target.union(this.instanceBox(this.doors, i));
    const w = this.windowIndex.get(opening);
    if (w !== undefined) {
      const mesh = this.drapes[this.group[w]!];
      target.union(this.instanceBox(mesh, this.slot[w]! * 2));
      target.union(this.instanceBox(mesh, this.slot[w]! * 2 + 1));
      if (this.sheer[w]) target.union(this.instanceBox(this.sheers, w));
    }
    return target;
  }

  private instanceBox(mesh: THREE.InstancedMesh, i: number): THREE.Box3 {
    mesh.getMatrixAt(i, tmpM);
    return tmpB.copy(mesh.geometry.boundingBox!).applyMatrix4(tmpM);
  }

  /** Leaf turned about its hinge by swing × open × 90° from closed. */
  private leafMatrix(i: number, m: THREE.Matrix4): THREE.Matrix4 {
    const l = this.leaves[i]!;
    tmpQ.setFromAxisAngle(UP, l.closedYaw + l.swing * this.open[i]! * (Math.PI / 2));
    return m.compose(tmpP.set(l.hingeX, l.y0, l.hingeZ), tmpQ, tmpS.set(l.thickness, l.height, l.width));
  }

  /** One drape (side -1 at t0, +1 at t1): from its outer edge to its leading edge, which slides from framing the glass to the middle. */
  private drapeMatrix(w: number, side: -1 | 1, m: THREE.Matrix4): THREE.Matrix4 {
    const c = this.curtains[w]!;
    const k = this.drawn[w]!;
    const edge = side < 0 ? c.t0 : c.t1;
    const mid = (c.t0 + c.t1) / 2;
    const outer = edge + side * lerp(OUTER.open, OUTER.drawn, k);
    const lead = lerp(edge - side * c.over, mid - side * MEET, k);
    return wallMatrix(c, outer, lead, c.yBot, c.yTop, BACK, lerp(DEPTH.open, DEPTH.drawn, k) - BACK, m);
  }

  /** The sheer hangs where it was baked while the drapes are open, and steps back behind them as they draw (it would cut through their folds). */
  private sheerMatrix(w: number, m: THREE.Matrix4): THREE.Matrix4 {
    const c = this.curtains[w]!;
    const depth = lerp(SHEER_DEPTH, BACK / 2, Math.min(1, this.drawn[w]! * 4));
    return wallMatrix(c, c.t0 - SHEER_PAST, c.t1 + SHEER_PAST, c.sheerY0, c.sheerY1, depth, 1, m);
  }

  dispose(): void {
    for (const mesh of [this.doors, ...this.drapes, this.sheers]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.owned) m.dispose();
  }
}

/**
 * Map a unit panel onto a wall: local x 0..1 runs along the wall from `ta` to `tb`, y 0..1 from
 * y0 to y1, z 0..1 from `n0` to `n0 + dn` into the room off the face. When that would mirror the
 * panel (and show the room its back faces) it is hung upside down instead.
 */
function wallMatrix(c: CurtainSpec, ta: number, tb: number, y0: number, y1: number, n0: number, dn: number, m: THREE.Matrix4): THREE.Matrix4 {
  const T = tb - ta;
  const D = c.inward * dn;
  const N = c.face + c.inward * n0;
  const flip = (c.axis === "x" ? T * D : -T * D) < 0;
  const H = flip ? y0 - y1 : y1 - y0;
  const Y = flip ? y1 : y0;
  if (c.axis === "x") return m.set(T, 0, 0, ta, 0, H, 0, Y, 0, 0, D, N, 0, 0, 0, 1);
  return m.set(0, 0, D, N, 0, H, 0, Y, T, 0, 0, ta, 0, 0, 0, 1);
}

/** Unit pleated drape (x across, y up, z from the wall to the crests): flat-shaded zig-zag facets like the baked pleats. */
function pleatGeometry(n: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const xa = i / n;
    const xb = (i + 1) / n;
    const za = i % 2 ? 1 : 0;
    const zb = i % 2 ? 0 : 1;
    const len = Math.hypot(zb - za, xb - xa);
    const nx = -(zb - za) / len;
    const nz = (xb - xa) / len;
    const v = i * 4;
    pos.push(xa, 0, za, xb, 0, zb, xb, 1, zb, xa, 1, za);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uv.push(xa * DRAPE_UV[0], 0, xb * DRAPE_UV[0], 0, xb * DRAPE_UV[0], DRAPE_UV[1], xa * DRAPE_UV[0], DRAPE_UV[1]);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Unit sheer: two coincident quads facing either way, as the baked sheer is hung. */
function sheerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

/** A library material's recipe without its texture: `tone` (sRGB) stands in for the texture's mean, `roughness` for its roughness map. */
function plain(key: string, tone = 1, roughness?: number): THREE.MeshStandardMaterial {
  const r = RECIPES[key]!;
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(r.color ?? "#ffffff").multiply(new THREE.Color().setRGB(tone, tone, tone, THREE.SRGBColorSpace)),
    roughness: roughness ?? r.roughness ?? 1,
    metalness: r.metalness ?? 0,
    transparent: r.transparent ?? false,
    opacity: r.opacity ?? 1,
    side: r.side ?? THREE.FrontSide,
    depthWrite: r.depthWrite ?? true,
  });
  m.name = `fixtures-${key}`;
  return m;
}
