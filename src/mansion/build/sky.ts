/**
 * Blue-hour sky: deep blue zenith, lavender haze, a warm sunset glow low on
 * one side, the rosy Belt of Venus opposite, thin cirrus lit from below,
 * stars and a crescent moon lit by the (set) sun. HDR output, also baked into
 * a PMREM environment map for façade/glass/water reflections.
 */
import * as THREE from 'three';
import type { SkySpec } from '../core/types';

const DEG = Math.PI / 180;

export function dirFromAzEl(azDeg: number, elDeg: number): THREE.Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export interface SkyParams {
  /** Overall sky brightness multiplier (linear). */
  intensity: number;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uCloud;
uniform float uIntensity;
uniform float uStars;
varying vec3 vDir;

float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vn( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { s += a * vn( p ); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize( vDir );
  float e = d.y;
  float eu = max( e, 0.0 );
  vec2 sh = normalize( uSun.xz + 1e-5 );
  vec2 dh = normalize( d.xz + 1e-5 );
  float toSun = dot( dh, sh );                       // -1 .. 1 around the horizon
  float sunSide = toSun * 0.5 + 0.5;

  // Base gradient: lavender-blue haze to deep blue zenith.
  vec3 haze = vec3( 0.20, 0.22, 0.36 );
  vec3 mid = vec3( 0.055, 0.085, 0.20 );
  vec3 zen = vec3( 0.012, 0.024, 0.075 );
  vec3 col = mix( haze, mid, smoothstep( 0.0, 0.28, eu ) );
  col = mix( col, zen, smoothstep( 0.25, 1.0, eu ) );

  // Sunset glow: warm amber at the horizon fading through rose into the blue.
  float glow = pow( sunSide, 5.0 ) * exp( -eu * 9.0 );
  float halo = pow( sunSide, 14.0 ) * exp( -eu * 3.5 );
  vec3 warm = mix( vec3( 1.25, 0.52, 0.2 ), vec3( 0.75, 0.32, 0.36 ), smoothstep( 0.0, 0.16, eu ) );
  col += warm * glow * 0.9 + vec3( 0.55, 0.3, 0.3 ) * halo * 0.25;

  // Belt of Venus and the Earth's shadow opposite the sun.
  float anti = pow( 1.0 - sunSide, 2.0 );
  col += vec3( 0.16, 0.08, 0.11 ) * anti * exp( -pow( ( e - 0.11 ) / 0.06, 2.0 ) );
  col *= 1.0 - 0.25 * anti * exp( -pow( ( e - 0.02 ) / 0.04, 2.0 ) );

  // Cirrus: thin bands on a sky plane, lit warm toward the sun, dark elsewhere.
  if ( e > 0.0 ) {
    vec2 p = d.xz / ( e + 0.12 ) * 0.9;
    float c = fbm( p * vec2( 1.0, 3.2 ) + vec2( 3.1, 1.7 ) );
    c = smoothstep( 0.58 - uCloud * 0.25, 0.92, c ) * smoothstep( 0.0, 0.06, e ) * ( 1.0 - smoothstep( 0.5, 0.9, e ) );
    vec3 lit = mix( vec3( 0.07, 0.07, 0.13 ), vec3( 1.1, 0.48, 0.32 ), pow( sunSide, 3.0 ) * exp( -eu * 3.0 ) );
    col = mix( col, lit, c * 0.75 );
  }

  // Stars.
  if ( e > 0.08 ) {
    vec3 q = d * 380.0;
    vec3 cell = floor( q );
    float s = fract( sin( dot( cell, vec3( 12.9898, 78.233, 45.164 ) ) ) * 43758.5453 );
    float star = step( 0.9965, s ) * smoothstep( 0.45, 0.0, length( fract( q ) - 0.5 ) );
    col += vec3( 0.9, 0.95, 1.0 ) * star * uStars * smoothstep( 0.08, 0.5, e ) * ( 1.0 - glow * 3.0 ) * 1.2;
  }

  // Crescent moon lit by the set sun, with a faint halo and earthshine.
  float md = acos( clamp( dot( d, uMoon ), -1.0, 1.0 ) );
  float R = 0.0095;
  if ( md < R ) {
    vec3 t = normalize( cross( uMoon, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 b = cross( t, uMoon );
    vec2 uv = vec2( dot( d - uMoon, t ), dot( d - uMoon, b ) ) / R;
    float z = sqrt( max( 0.0, 1.0 - dot( uv, uv ) ) );
    vec3 n = normalize( uv.x * t + uv.y * b - z * uMoon );
    float lit = smoothstep( -0.02, 0.06, dot( n, normalize( uSun ) ) );
    float mare = 0.82 + 0.18 * vn( uv * 4.0 + 7.0 );
    col = mix( col, vec3( 1.9, 1.8, 1.6 ) * mare, lit ) + vec3( 0.02, 0.025, 0.035 ) * ( 1.0 - lit );
  }
  col += vec3( 0.08, 0.085, 0.1 ) * exp( -md * 90.0 ) * 0.35;

  // Below the horizon: the ground's own haze.
  if ( e < 0.0 ) col = mix( haze * 0.6, vec3( 0.02, 0.025, 0.035 ), smoothstep( 0.0, -0.12, e ) );

  gl_FragColor = vec4( col * uIntensity, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class TwilightSky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly sunDir: THREE.Vector3;
  readonly moonDir: THREE.Vector3;
  /** Linear colour of the haze at the horizon (for fog). */
  readonly hazeColor = new THREE.Color(0.2, 0.22, 0.36);

  constructor(spec: SkySpec, params: SkyParams = { intensity: 1 }) {
    this.sunDir = dirFromAzEl(spec.sunAzimuthDeg, spec.sunElevationDeg);
    this.moonDir = dirFromAzEl(spec.moonAzimuthDeg, spec.moonElevationDeg);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSun: { value: this.sunDir },
        uMoon: { value: this.moonDir },
        uCloud: { value: spec.cloudiness },
        uIntensity: { value: params.intensity },
        uStars: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.hazeColor.multiplyScalar(params.intensity);
  }

  /** Bake the sky into a PMREM environment map (no geometry, just sky). */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.material);
    scene.add(mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(scene, 0, 0.1, 100);
    pmrem.dispose();
    mesh.geometry.dispose();
    return rt.texture;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
