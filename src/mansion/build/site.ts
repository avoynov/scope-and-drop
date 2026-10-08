/** Site mesher: terrain, terrace, gardens, fountain, trees (instanced). */
import * as THREE from 'three';
import type { MansionBlueprint, Tree } from '../core/types';
import { terrainHeight } from '../site/terrain';
import type { ArchContext } from './arch';
import { parapet } from './arch';
import { GeometryBuilder } from './geometry';
import type { MaterialLibrary } from './materials';
import { fbm, hash2i } from './noise';

/** Terrain grid with world-space UVs, tint variation and exterior scope. */
export function buildTerrain(bp: MansionBlueprint, quality: number): THREE.BufferGeometry {
  const site = bp.site;
  const lawn = site.lawn;
  const step = quality >= 2 ? 2.0 : quality === 1 ? 3.0 : 4.0;
  const cols = Math.ceil((lawn.x1 - lawn.x0) / step);
  const rows = Math.ceil((lawn.z1 - lawn.z0) / step);
  const n = (cols + 1) * (rows + 1);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const scope = new Float32Array(n).fill(-1);
  const t = site.terrain;
  const base = new THREE.Color('#ffffff');
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i;
      const x = lawn.x0 + i * step;
      const z = lawn.z0 + j * step;
      const y = terrainHeight(t, x, z) - 0.02;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x;
      uv[k * 2 + 1] = z;
      // Lush/dry patches, and rougher meadow grass beyond the formal lawn.
      const patch = fbm(x / 60 + 10, z / 60 + 10, 1e6, 3, 3);
      const r = Math.hypot(x, z);
      const meadow = Math.min(1, Math.max(0, (r - t.flatRadius) / 40));
      const c = base.clone().multiplyScalar(0.85 + patch * 0.3);
      c.r *= 1 + meadow * 0.15;
      c.g *= 1 - meadow * 0.08;
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array(cols * rows * 6);
  let q = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aScope', new THREE.BufferAttribute(scope, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildGardens(ctx: ArchContext): void {
  const { bp, g, style } = ctx;
  const site = bp.site;
  const terr = site.terrace;
  const lift = 0.03;
  g.scope = -1;
  // Terrace platform.
  g.setTint('#ffffff');
  g.box('terrace', terr.rect.x0, terr.y - 0.001, terr.rect.z0, terr.rect.x1, terr.y, terr.rect.z1, 4);
  g.setTint(new THREE.Color(style.wallMaterial === 'brick' ? '#cdc4b4' : style.wallColor).multiplyScalar(0.85));
  g.box('ext-base', terr.rect.x0, -0.4, terr.rect.z0, terr.rect.x1, terr.y, terr.rect.z1, 1 | 2 | 16);
  g.setTint(style.trimColor);
  // Coping along the terrace edge.
  g.box('ext-trim', terr.rect.x0 - 0.08, terr.y - 0.12, terr.rect.z1 - 0.3, terr.rect.x1 + 0.08, terr.y + 0.03, terr.rect.z1 + 0.08);
  for (const b of terr.balustrades) {
    const axis = Math.abs(b.a.z - b.b.z) < 1e-6 ? 'x' : 'z';
    const line = axis === 'x' ? b.a.z : b.a.x;
    const t0 = axis === 'x' ? Math.min(b.a.x, b.b.x) : Math.min(b.a.z, b.b.z);
    const t1 = axis === 'x' ? Math.max(b.a.x, b.b.x) : Math.max(b.a.z, b.b.z);
    parapet(ctx, axis, line, 1, t0, t1, terr.y);
  }
  for (const s of terr.steps) {
    const n = s.count;
    const run = s.dir === '+z' || s.dir === '-z' ? s.rect.z1 - s.rect.z0 : s.rect.x1 - s.rect.x0;
    const tread = run / n;
    for (let i = 0; i < n; i++) {
      const top = s.y0 - (i + 1) * ((s.y0 - s.y1) / n) + (s.y0 - s.y1) / n;
      if (s.dir === '+z') g.box('ext-trim', s.rect.x0, -0.3, s.rect.z0 + i * tread, s.rect.x1, top, s.rect.z0 + (i + 1) * tread);
      else if (s.dir === '-z') g.box('ext-trim', s.rect.x0, -0.3, s.rect.z1 - (i + 1) * tread, s.rect.x1, top, s.rect.z1 - i * tread);
      else if (s.dir === '+x') g.box('ext-trim', s.rect.x0 + i * tread, -0.3, s.rect.z0, s.rect.x0 + (i + 1) * tread, top, s.rect.z1);
      else g.box('ext-trim', s.rect.x1 - (i + 1) * tread, -0.3, s.rect.z0, s.rect.x1 - i * tread, top, s.rect.z1);
    }
    // Cheek walls.
    if (s.dir === '+z' || s.dir === '-z') {
      for (const x of [s.rect.x0 - 0.35, s.rect.x1]) g.box('ext-trim', x, -0.3, s.rect.z0, x + 0.35, s.y0 + 0.15, s.rect.z1);
    } else {
      for (const z of [s.rect.z0 - 0.35, s.rect.z1]) g.box('ext-trim', s.rect.x0, -0.3, z, s.rect.x1, s.y0 + 0.15, z + 0.35);
    }
  }
  // Paths.
  g.setTint('#ffffff');
  for (const p of site.paths) g.box('gravel', p.rect.x0, lift - 0.02, p.rect.z0, p.rect.x1, lift, p.rect.z1, 4);
  // Parterres: box hedges framing beds, with a pattern inside.
  for (const pt of site.parterres) {
    const r = pt.rect;
    g.setTint('#ffffff');
    g.box('soil', r.x0, lift - 0.02, r.z0, r.x1, lift + 0.005, r.z1, 4);
    g.setTint('#6f8a5c');
    const hw = 0.22;
    const hh = 0.55;
    const hedge = (x0: number, z0: number, x1: number, z1: number) => g.box('hedge', x0, 0, z0, x1, hh, z1, 1 | 2 | 4 | 16 | 32);
    hedge(r.x0, r.z0, r.x1, r.z0 + hw * 2);
    hedge(r.x0, r.z1 - hw * 2, r.x1, r.z1);
    hedge(r.x0, r.z0, r.x0 + hw * 2, r.z1);
    hedge(r.x1 - hw * 2, r.z0, r.x1, r.z1);
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    if (pt.pattern === 'cross' || pt.pattern === 'quarters') {
      hedge(cx - hw, r.z0, cx + hw, r.z1);
      hedge(r.x0, cz - hw, r.x1, cz + hw);
    }
    if (pt.pattern === 'diamond' || pt.pattern === 'quarters') {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const b = ((i + 1) / n) * Math.PI * 2;
        const px = (u: number) => cx + (Math.cos(u) * W) / 3.2;
        const pz = (u: number) => cz + (Math.sin(u) * D) / 3.2;
        const dx = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
        if (pt.pattern === 'diamond') {
          // Diamond: four straight runs approximated by stepped blocks.
          const tx = cx + (Math.sign(Math.cos(a)) * (W / 3) * Math.abs(Math.cos(a))) / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
          const tz = cz + (Math.sign(Math.sin(a)) * (D / 3) * Math.abs(Math.sin(a))) / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
          g.box('hedge', tx - hw, 0, tz - hw, tx + hw, hh, tz + hw, 1 | 2 | 4 | 16 | 32);
        } else {
          g.box('hedge', Math.min(px(a), px(b)) - hw, 0, Math.min(pz(a), pz(b)) - hw, Math.max(px(a), px(b)) + hw, hh, Math.max(pz(a), pz(b)) + hw, 1 | 2 | 4 | 16 | 32);
        }
        void dx;
      }
    }
    if (pt.pattern === 'ring') {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * Math.min(W, D) * 0.3;
        const z = cz + Math.sin(a) * Math.min(W, D) * 0.3;
        g.box('hedge', x - 0.35, 0, z - 0.35, x + 0.35, hh, z + 0.35, 1 | 2 | 4 | 16 | 32);
      }
      g.setTint('#ffffff');
      g.frame(cx, 0, cz, 0);
      g.lathe('ext-trim', 0, 0, [[0.3, 0], [0.2, 0.2], [0.18, 0.9], [0.32, 1.0], [0.2, 1.35]], 10, true);
      g.frame();
      g.setTint('#6f8a5c');
    }
  }
  // Topiary.
  g.setTint('#7a9563');
  for (const t of site.topiary) {
    g.frame(t.x, terrainHeight(site.terrain, t.x, t.z), t.z, 0);
    if (t.shape === 'cone') g.lathe('hedge', 0, 0, [[t.radius, 0.15], [t.radius * 0.9, t.height * 0.3], [0.05, t.height]], 10, true);
    else if (t.shape === 'ball') {
      g.cylinder('bark', 0, 0, 0, 0.06, 0.05, t.height * 0.5, 6, false);
      g.sphere('hedge', 0, t.height * 0.68, 0, t.radius, t.radius, t.radius, 10, 7);
    } else {
      for (let i = 0; i < 4; i++) g.sphere('hedge', 0, 0.35 + i * (t.height / 4.3), 0, t.radius * (1 - i * 0.2), t.height / 9, t.radius * (1 - i * 0.2), 10, 5);
    }
    g.setTint('#d9d2c4');
    g.box('ext-trim', -t.radius - 0.1, 0, -t.radius - 0.1, t.radius + 0.1, 0.15, t.radius + 0.1, 1 | 2 | 4 | 16 | 32);
    g.setTint('#7a9563');
    g.frame();
  }
  // Fountain: stone basin, dark water, tiered centre.
  const f = site.fountain;
  if (f) {
    g.setTint(style.trimColor);
    g.frame(f.x, 0, f.z, 0);
    g.lathe('ext-trim', 0, 0, [[f.radius + 0.35, 0], [f.radius + 0.35, 0.5], [f.radius + 0.45, 0.55], [f.radius + 0.45, 0.62]], 40, false);
    g.lathe('ext-trim', 0, 0, [[f.radius + 0.45, 0.62], [f.radius, 0.62], [f.radius, 0.3]], 40, false);
    g.setTint('#ffffff');
    g.disc('water', 0, 0.42, 0, f.radius, 40, true);
    g.setTint(style.trimColor);
    let y = 0.42;
    let r = f.radius * 0.45;
    for (let i = 0; i < f.tiers; i++) {
      g.lathe('ext-trim', 0, 0, [[0.25 - i * 0.04, y], [0.18 - i * 0.03, y + 0.8], [r, y + 0.95], [r, y + 1.08], [0.1, y + 1.12]], 24, true);
      g.setTint('#ffffff');
      g.disc('water', 0, y + 1.07, 0, r - 0.06, 24, true);
      g.setTint(style.trimColor);
      y += 1.1;
      r *= 0.6;
    }
    g.sphere('ext-trim', 0, y + 0.2, 0, 0.16, 0.22, 0.16, 8, 6);
    g.frame();
  }
}

/* ------------------------------------------------------------------ */
/* Trees                                                               */
/* ------------------------------------------------------------------ */

type Archetype = 'round' | 'round-lo' | 'cedar' | 'column' | 'cone';

function archetypeOf(k: Tree['kind']): Archetype {
  switch (k) {
    case 'cedar':
      return 'cedar';
    case 'cypress':
    case 'poplar':
      return 'column';
    case 'yew':
      return 'cone';
    default:
      return 'round';
  }
}

/** Unit tree (height 1, crown radius 1) as two geometries: bark, foliage. */
function unitTree(kind: Archetype, variant: number): Map<string, THREE.BufferGeometry> {
  const g = new GeometryBuilder();
  g.scope = -1;
  g.setTint('#ffffff');
  const rnd = (i: number) => hash2i(variant, i, 77);
  if (kind === 'round') {
    g.cylinder('bark', 0, 0, 0, 0.05, 0.03, 0.55, 7, false);
    for (let i = 0; i < 4; i++) {
      const a = rnd(i) * Math.PI * 2;
      g.cylinder('bark', Math.cos(a) * 0.12, 0.38, Math.sin(a) * 0.12, 0.022, 0.012, 0.3, 5, false);
    }
    // Many overlapping lobes of varied size: a ragged, natural crown silhouette.
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 * 2.4 + rnd(i + 10) * 1.3;
      const shell = i < 2 ? 0.15 : 0.5 + rnd(i + 20) * 0.35;
      const y = i < 2 ? 0.66 + rnd(i) * 0.12 : 0.42 + rnd(i + 30) * 0.42;
      const s = i < 2 ? 0.52 : 0.27 + rnd(i + 40) * 0.2;
      const shade = 0.72 + rnd(i + 50) * 0.4 + (y - 0.5) * 0.3;
      g.setTint([shade, shade, shade]);
      g.sphere('foliage', Math.cos(a) * shell * 0.9, y, Math.sin(a) * shell * 0.9, s, s * 0.62, s, 9, 6);
    }
  } else if (kind === 'round-lo') {
    // Horizon filler: a handful of coarse lobes, never seen up close.
    g.cylinder('bark', 0, 0, 0, 0.05, 0.03, 0.5, 5, false);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd(i);
      const r = i === 0 ? 0 : 0.45;
      g.setTint([0.8, 0.8, 0.8]);
      g.sphere('foliage', Math.cos(a) * r, i === 0 ? 0.68 : 0.52, Math.sin(a) * r, i === 0 ? 0.6 : 0.45, 0.3, i === 0 ? 0.6 : 0.45, 7, 4);
    }
  } else if (kind === 'cedar') {
    g.cylinder('bark', 0, 0, 0, 0.06, 0.02, 0.92, 7, false);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const y = 0.32 + i * 0.15;
      const r = 1 - i * 0.17;
      const shade = 0.7 + rnd(i) * 0.3;
      g.setTint([shade, shade, shade]);
      g.sphere('foliage', (rnd(i + 5) - 0.5) * 0.2, y, (rnd(i + 6) - 0.5) * 0.2, r, 0.06, r * (0.85 + rnd(i + 7) * 0.2), 12, 4);
    }
  } else if (kind === 'column') {
    g.cylinder('bark', 0, 0, 0, 0.06, 0.03, 0.2, 6, false);
    for (let i = 0; i < 3; i++) {
      const shade = 0.75 + rnd(i) * 0.3;
      g.setTint([shade, shade, shade]);
      g.sphere('foliage', 0, 0.35 + i * 0.22, 0, 1 - i * 0.18, 0.32, 1 - i * 0.18, 8, 6);
    }
  } else {
    g.cylinder('bark', 0, 0, 0, 0.08, 0.05, 0.2, 6, false);
    g.setTint([0.8, 0.8, 0.8]);
    g.lathe('foliage', 0, 0, [[0.9, 0.12], [1, 0.3], [0.7, 0.65], [0.05, 1]], 9, true);
  }
  const geos = g.build();
  const uvScale = kind === 'column' ? 2.5 : 4;
  for (const geo of geos.values()) {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  }
  return geos;
}

const TREE_TINT: Record<Tree['kind'], string> = {
  oak: '#5c7046',
  beech: '#647a4a',
  cedar: '#3f5844',
  cypress: '#3a5039',
  yew: '#344a33',
  poplar: '#61774a',
};

export function buildTrees(bp: MansionBlueprint, materials: MaterialLibrary, extraFar = true): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  type Inst = { m: THREE.Matrix4; c: THREE.Color };
  const byKey = new Map<string, Inst[]>();
  const add = (arch: Archetype, variant: number, x: number, y: number, z: number, h: number, r: number, yaw: number, tint: string, k: number, far = false) => {
    const key = `${arch}:${variant}:${far ? 1 : 0}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(r, h, r));
    list.push({ m, c: new THREE.Color(tint).multiplyScalar(k) });
  };
  const fp = bp.stats.footprint;
  const hx = (fp.x0 + fp.x1) / 2;
  const hz = (fp.z0 + fp.z1) / 2;
  bp.site.trees.forEach((t, i) => {
    const arch = archetypeOf(t.kind);
    // Only trees near the house fall inside the shadow map; the rest skip the shadow pass.
    const far = Math.hypot(t.x - hx, t.z - hz) > 110;
    add(arch, i % 3, t.x, t.y, t.z, t.height, t.crown, hash2i(i, 3, 9) * Math.PI * 2, TREE_TINT[t.kind], 0.85 + hash2i(i, 4, 9) * 0.3, far);
  });
  if (extraFar) {
    // A dark tree line on the horizon so the sky glow has silhouettes to sit behind.
    const n = 520;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash2i(i, 1, 5) * 0.02;
      const r = 300 + hash2i(i, 2, 5) * 240;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const h = 16 + hash2i(i, 3, 5) * 14;
      add(hash2i(i, 4, 5) < 0.2 ? 'column' : 'round-lo', i % 3, x, terrainHeight(bp.site.terrain, x, z) - 1, z, h, 6 + hash2i(i, 6, 5) * 5, a, '#2f3d2c', 0.7, true);
    }
  }
  const tmp = new THREE.Matrix4();
  for (const [key, list] of byKey) {
    const [arch, v, farFlag] = key.split(':') as [Archetype, string, string];
    const geos = unitTree(arch, Number(v));
    for (const [mk, geo] of geos) {
      const mesh = new THREE.InstancedMesh(geo, materials.get(mk === 'foliage' ? 'foliage' : 'bark'), list.length);
      list.forEach((inst, i) => {
        tmp.copy(inst.m);
        mesh.setMatrixAt(i, tmp);
        mesh.setColorAt(i, mk === 'foliage' ? inst.c : new THREE.Color('#ffffff'));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = farFlag !== '1';
      mesh.receiveShadow = farFlag !== '1';
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}
