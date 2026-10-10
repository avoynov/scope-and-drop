/**
 * The rifle and scope as the eye sees them from a few centimetres away: a 4–20×50 tactical scope on whichever
 * rifle is chosen, with the hands that work its action (actions.ts), modelled to scale in the scope's own frame
 * (metres; origin at the exit pupil, −Z down the bore, +Y up). It is rendered from the eye with the naked-eye
 * mapping, then defocused: the eye is focused on the target, so a point d metres away spreads into a disc
 * pupil/d radians wide. Near the eyepiece that is tens of pixels, at the muzzle a few. When the eye looks down
 * at the elevation drum or at the hands it focuses there instead, at distance f, and the disc is
 * pupil·|1/d − 1/f|.
 *
 * Passes, all at half resolution:
 *  1. `near`: colour (premultiplied, alpha = coverage) and aux (r = eyepiece glass, g = distance).
 *  2. `tile`: the largest blur radius around each 16 px tile, so the gather knows how far to look.
 *  3. `bokeh`: scatter-as-gather. Each tap is a point that spreads its light over its own blur disc; it
 *     reaches this pixel if its disc covers it, weighted by (gather radius / its radius)² so a disc's
 *     light is conserved whatever its size. Head motion adds a smear along the ocular's screen velocity.
 */
import * as THREE from 'three';
import type { HandlingPose } from '../../src/scope/handling';
import { SCOPE } from '../../src/scope/optics';
import type { RifleId } from '../../src/scope/shot';
import { buildActions } from './actions';
import { DRUM_R_MM, paintDrum } from './drum';

const mm = (v: number) => v / 1000;
const EYEPIECE = 1;
const BODY = 2;

const NEAR_VS = /* glsl */ `
  out vec3 vN;
  out vec3 vP;
  out vec2 vUv;
  void main(){
    vUv = uv;
    vN = normalize(mat3(modelMatrix)*normal);
    vec4 w = modelMatrix*vec4(position, 1.);
    vP = w.xyz;
    gl_Position = projectionMatrix*viewMatrix*w;
  }`;

const NEAR_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 oCol;
  layout(location = 1) out vec4 oAux;
  in vec3 vN;
  in vec3 vP;
  in vec2 vUv;
  uniform vec3 uBase, uSun, uSunCol, uSky, uGround;
  uniform float uGloss, uSpec, uLens, uMapped;
  uniform sampler2D tMap;
  vec3 hemi(float y){ return mix(uGround, uSky, .5 + .5*y); }
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vP);
    if (dot(n, v) < 0.) n = -n;
    float ndl = max(dot(n, uSun), 0.);
    float F = .04 + .96*pow(1. - max(dot(n, v), 0.), 5.);
    vec3 r = reflect(-v, n);
    // The shooter's own head: faces turned back at the eye, close to it, lose most of the sun and sky,
    // and what they mirror is the face, not the sky.
    float dist = length(cameraPosition - vP);
    float head = smoothstep(.2, .9, n.z)*exp(-dist/.25);
    float face = smoothstep(.1, .7, r.z)*exp(-dist/.4);
    vec3 env = mix(hemi(r.y), vec3(.035, .028, .024), face);
    vec3 col;
    if (uLens > .5) {
      // Eyepiece: multi-coated glass over a black barrel. A faint green-magenta sheen of the sky, nothing more;
      // the light that passes through it is added in the composite.
      vec3 coat = mix(vec3(.55, 1., .62), vec3(1., .55, .9), smoothstep(.2, .9, 1. - dot(n, v)));
      col = env*(.006 + F*.5)*coat + uSunCol*pow(max(dot(r, uSun), 0.), 400.)*.6*(1. - head);
    } else {
      // Anodised aluminium or polymer: dark diffuse, a satin sheen of the sky and a broad sun highlight.
      vec3 h = normalize(uSun + v);
      float spec = pow(max(dot(n, h), 0.), uGloss)*(uGloss + 8.)/25.;
      // The drum's engraving (paint-filled numbers and marks, knurling) comes from its texture.
      vec3 base = uMapped > .5 ? texture(tMap, vUv).rgb : uBase;
      col = (base*(uSunCol*ndl + hemi(n.y)*.8) + uSpec*(F*.6 + .4)*(env*.35 + uSunCol*spec*ndl))*(1. - .8*head);
    }
    oCol = vec4(col, 1.);
    oAux = vec4(uLens, dist, 0., 1.);
  }`;

export interface NearLayer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Light from the range, in the scope's frame. */
  setLight(sunDir: THREE.Vector3): void;
  /** Turns the elevation drum this far from its 1 (radians, clockwise seen from above). */
  setDrum(angle: number): void;
  /** Engraves the drum with these range marks (metres), one per detent. */
  setDrumMarks(marks: readonly number[]): void;
  /** The drum's meshes, for picking it with the pointer. */
  drum: THREE.Object3D;
  /** Which rifle is under the scope. */
  setRifle(id: RifleId): void;
  /** Where its moving parts and the hands are. */
  pose(p: HandlingPose): void;
}

export function buildRifle(): NearLayer {
  const scene = new THREE.Scene();
  const mats: THREE.ShaderMaterial[] = [];
  const mat = (base: number, gloss: number, spec: number, lens = 0, map: THREE.Texture | null = null) => {
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      vertexShader: NEAR_VS,
      fragmentShader: NEAR_FS,
      uniforms: {
        uBase: { value: new THREE.Color(base) },
        uGloss: { value: gloss },
        uSpec: { value: spec },
        uLens: { value: lens },
        uMapped: { value: map ? 1 : 0 },
        tMap: { value: map },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(0xfff2de).multiplyScalar(1.9) },
        uSky: { value: new THREE.Color(0xc5d6ea) },
        uGround: { value: new THREE.Color(0x8a7656) },
      },
    });
    mats.push(m);
    return m;
  };
  const anod = mat(0x0b0b0c, 30, 0.22);
  const polymer = mat(0x1a1a18, 8, 0.1);
  const steel = mat(0x121212, 60, 0.35);
  const glass = mat(0x000000, 0, 0, 1);
  const paint = mat(0xd8d8d0, 4, 0.05);

  // The eyepiece end is drawn and blurred apart from the rest: it sits two to ten times closer to the eye,
  // and one gather across both depths turns the far parts' edges to grain.
  let layer = EYEPIECE;
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.frustumCulled = false;
    o.layers.set(layer);
    scene.add(o);
    return o;
  };
  /** A body of revolution about the bore line from (radius, distance ahead of the exit pupil) pairs in mm. */
  const lathe = (pts: [number, number][], m: THREE.Material, y = 0) => {
    const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(mm(r), mm(h))), 64);
    g.rotateX(-Math.PI / 2); // lathe height +Y → down the bore, −Z
    return add(g, m, 0, y);
  };
  /** Cylinder whose axis runs along the bore. */
  const tube = (r0: number, r1: number, h0: number, h1: number, m: THREE.Material, x = 0, y = 0) => {
    const g = new THREE.CylinderGeometry(mm(r1), mm(r0), mm(h1 - h0), 40, 1, true);
    g.rotateX(-Math.PI / 2);
    return add(g, m, mm(x), mm(y), -mm((h0 + h1) / 2));
  };

  const relief = SCOPE.eyeReliefMm;
  // Scope body, rear to front. Eyepiece glass 41 mm across, recessed 2.5 mm in a 47 mm ocular bell.
  const ribs: [number, number][] = [];
  for (let h = 150; h < 174; h += 2) ribs.push([21.6, h], [22.4, h + 1]);
  lathe([
    [20.5, relief + 2.5], [20.5, relief + 0.6], [21.6, relief], [23.2, relief + 0.4], [23.6, relief + 1.5],
    [23.6, relief + 52], [22.6, relief + 56], [21.6, 148], ...ribs, [21.6, 175], [19.5, 178],
  ], anod);
  add(new THREE.CircleGeometry(mm(20.5), 64), glass, 0, 0, -mm(relief + 2.5));
  // Throw lever on the power ring, at 3 o'clock.
  add(new THREE.BoxGeometry(mm(14), mm(5), mm(8)), polymer, mm(27), mm(2), -mm(162));
  layer = BODY;
  lathe([
    [19.5, 178], [15.2, 186], [15, 190], [15, 400], [17, 410], [24, 428], [28.6, 444], [29.6, 452], [29.6, 497],
    [28.2, 500], [26, 500],
  ], anod);
  // Turret saddle with elevation (top), windage (right) and side focus (left).
  add(new THREE.BoxGeometry(mm(34), mm(31), mm(84)), anod, 0, 0, -mm(275));
  // Elevation drum: range numbers engraved round its side, read against the index line on the saddle behind it.
  // It turns about its own axis as it clicks.
  const drum = new THREE.Group();
  drum.position.set(0, 0, -mm(272));
  scene.add(drum);
  const drumTex = new THREE.CanvasTexture(document.createElement('canvas'));
  drumTex.colorSpace = THREE.SRGBColorSpace;
  drumTex.anisotropy = 8;
  const engraved = mat(0xffffff, 30, 0.22, 0, drumTex);
  const elev = new THREE.CylinderGeometry(mm(DRUM_R_MM), mm(DRUM_R_MM), mm(30), 96, 1, true);
  const drumSide = add(elev, engraved, 0, mm(30), 0);
  drumSide.name = 'drum';
  drum.add(drumSide);
  const capTop = add(new THREE.CylinderGeometry(mm(17.5), mm(DRUM_R_MM), mm(2), 48), anod, 0, mm(46), 0);
  capTop.name = 'drum';
  drum.add(capTop);
  // Index line on the saddle, just behind the drum: a white line pointing at the number the rifle is zeroed to.
  add(new THREE.BoxGeometry(mm(1.2), mm(0.4), mm(14)), paint, 0, mm(15.7), -mm(272 - DRUM_R_MM - 8));
  const wind = new THREE.CylinderGeometry(mm(16.5), mm(16.5), mm(26), 48);
  wind.rotateZ(Math.PI / 2);
  add(wind, anod, mm(30), 0, -mm(272));
  const focus = new THREE.CylinderGeometry(mm(22), mm(22), mm(14), 48);
  focus.rotateZ(Math.PI / 2);
  add(focus, anod, -mm(24), 0, -mm(272));
  // Rings and their bases, on the rail or the side mount (actions.ts).
  for (const h of [205, 362]) {
    tube(18.6, 18.6, h - 11, h + 11, steel);
    add(new THREE.BoxGeometry(mm(28), mm(18), mm(22)), steel, 0, -mm(24), -mm(h));
  }
  // The rifle under the scope, its moving parts and the hands, in millimetres.
  const below = new THREE.Group();
  below.scale.setScalar(0.001);
  scene.add(below);
  const actions = buildActions(below, (b, g, s) => mat(b, g, s), (o) => o.layers.set(BODY));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.004, 5);
  return {
    scene,
    camera,
    setLight(sunDir) {
      for (const m of mats) m.uniforms.uSun!.value.copy(sunDir);
    },
    setDrum(angle) {
      drum.rotation.y = -angle;
    },
    setDrumMarks(marks) {
      drumTex.image = paintDrum(marks);
      drumTex.needsUpdate = true;
    },
    drum,
    setRifle: (id) => actions.setRifle(id),
    pose: (p) => actions.apply(p),
  };
}

const FULLSCREEN_VS = 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }';

const TILE_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 oTile;
  uniform sampler2D tAux;
  uniform vec2 uSrc;
  uniform float uK, uTile, uReach, uInvF;
  void main(){
    vec2 c = (floor(gl_FragCoord.xy) + .5)*uTile;
    float m = 0.;
    for (int j = -6; j <= 6; j++) for (int i = -6; i <= 6; i++) {
      vec2 p = c + vec2(float(i), float(j))*(uReach/6.);
      vec4 a = texture(tAux, p/uSrc);
      if (a.a > .5) m = max(m, max(uK*abs(1./max(a.g, .02) - uInvF), 1.));
    }
    oTile = vec4(m, 0., 0., 1.);
  }`;

const BOKEH_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 oCol;
  layout(location = 1) out vec4 oLens;
  uniform sampler2D tCol, tAux, tTile;
  uniform vec2 uRes, uVel;
  uniform float uK, uSeed, uInvF;
  float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
  void main(){
    vec2 uv = gl_FragCoord.xy/uRes;
    float Rg = max(texture(tTile, uv).r, 1.);
    float rot = h21(gl_FragCoord.xy + uSeed)*6.2832;
    vec4 acc = vec4(0.);
    float lens = 0.;
    const int N = 48;
    for (int i = 0; i < N; i++) {
      float f = (float(i) + .5)/float(N);
      float rr = sqrt(f)*Rg;
      float an = float(i)*2.39996 + rot;
      vec2 o = rr*vec2(cos(an), sin(an)) + uVel*(h21(gl_FragCoord.xy*.37 + float(i)) - .5);
      vec2 q = uv + o/uRes;
      vec4 c = texture(tCol, q);
      vec4 a = texture(tAux, q);
      if (c.a < .5) continue;
      // In focus a point still covers a pixel: the gather's weights need a disc at least that big.
      float coc = max(uK*abs(1./max(a.g, .02) - uInvF), 1.);
      float w = clamp(coc - rr + .5, 0., 1.)*min(Rg*Rg/max(coc*coc, .25), 64.);
      acc += w*c;
      lens += w*a.r;
    }
    acc /= float(N);
    lens /= float(N);
    // The tap pattern resolves a covered interior to ~0.97, and 3 % of a bright range through dark glass
    // would show: treat 0.95 and up as solid.
    float A = min(acc.a/.95, 1.);
    float k = A/max(acc.a, 1e-4);
    oCol = vec4(acc.rgb*k, A);
    oLens = vec4(min(lens*k, 1.), 0., 0., 1.);
    // Focused on the drum, its disc is about a pixel: the few taps that land inside it can't stand for it, and it
    // would turn see-through against the bright range. Use the pixel itself there.
    vec4 c0 = texture(tCol, uv);
    if (uInvF > 0. && c0.a > .5) {
      float own = max(uK*abs(1./max(texture(tAux, uv).g, .02) - uInvF), 1.);
      float s = max(1. - smoothstep(1.5, 3., own), smoothstep(3., 6., Rg/own))*min(uInvF, 1.);
      oCol = mix(oCol, c0, s);
      oLens = mix(oLens, vec4(texture(tAux, uv).r, 0., 0., 1.), s);
    }
  }`;

/** Half-resolution render targets and passes that turn the rifle into what an eye focused far away sees. */
export function createNearPasses(renderer: THREE.WebGLRenderer, rifle: NearLayer) {
  const TILE = 16;
  const tri = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quadCam = new THREE.Camera();
  const pass = (fs: string, uniforms: Record<string, THREE.IUniform>) => {
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(tri, m);
    mesh.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(mesh);
    return { m, s };
  };
  const layers = [EYEPIECE, BODY].map((id) => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const tileRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const out = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType });
    const tile = pass(TILE_FS, {
      tAux: { value: rt.textures[1] }, uSrc: { value: new THREE.Vector2() }, uK: { value: 1 }, uTile: { value: TILE }, uReach: { value: 40 }, uInvF: { value: 0 },
    });
    const bokeh = pass(BOKEH_FS, {
      tCol: { value: rt.textures[0] }, tAux: { value: rt.textures[1] }, tTile: { value: tileRT.texture },
      uRes: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector2() }, uK: { value: 1 }, uSeed: { value: 0 }, uInvF: { value: 0 },
    });
    return { id, rt, tileRT, out, tile, bokeh };
  });
  const clear = new THREE.Color(0, 0, 0);
  const [eyepiece, body] = layers;

  return {
    /** Eyepiece end (premultiplied colour, coverage) and where its glass shows; the rest of the rifle behind it. */
    eyepiece: eyepiece!.out.textures[0]!,
    lens: eyepiece!.out.textures[1]!,
    body: body!.out.textures[0]!,
    setSize(bw: number, bh: number) {
      const w = Math.ceil(bw / 2);
      const h = Math.ceil(bh / 2);
      for (const L of layers) {
        L.rt.setSize(w, h);
        L.out.setSize(w, h);
        L.tileRT.setSize(Math.ceil(w / TILE), Math.ceil(h / TILE));
        L.tile.m.uniforms.uSrc!.value.set(w, h);
        L.bokeh.m.uniforms.uRes!.value.set(w, h);
      }
    },
    /**
     * k: blur radius in half-res px of a point 1 m away (radius ∝ 1/distance). vel: smear over one
     * exposure, half-res px. seed: changes the gather's grain each frame. invF: 1 / the distance the eye is
     * focused at (0 for far away).
     */
    render(k: number, vel: THREE.Vector2, seed: number, invF = 0) {
      const prevClear = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(clear, 0);
      for (const L of layers) {
        rifle.camera.layers.set(L.id);
        renderer.setRenderTarget(L.rt);
        renderer.clear();
        renderer.render(rifle.scene, rifle.camera);
        L.tile.m.uniforms.uK!.value = k;
        L.tile.m.uniforms.uInvF!.value = invF;
        L.bokeh.m.uniforms.uInvF!.value = invF;
        L.tile.m.uniforms.uReach!.value = Math.min(64, (1.1 * k) / 0.06);
        renderer.setRenderTarget(L.tileRT);
        renderer.render(L.tile.s, quadCam);
        L.bokeh.m.uniforms.uK!.value = k;
        L.bokeh.m.uniforms.uVel!.value.copy(vel);
        L.bokeh.m.uniforms.uSeed!.value = seed;
        renderer.setRenderTarget(L.out);
        renderer.render(L.bokeh.s, quadCam);
      }
      renderer.setClearColor(prevClear, prevAlpha);
    },
  };
}
