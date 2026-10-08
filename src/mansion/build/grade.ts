/**
 * Colour grade for the 30% "appeal": split-tone (cool shadows, warm
 * highlights), gentle saturation and a soft vignette. Runs on linear HDR
 * before the output (tone-mapping) pass.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface GradeOptions {
  shadowTint?: THREE.ColorRepresentation;
  highlightTint?: THREE.ColorRepresentation;
  /** 0 = off. */
  splitStrength?: number;
  saturation?: number;
  vignette?: number;
}

export function createGradePass(o: GradeOptions = {}): ShaderPass {
  return new ShaderPass({
    name: 'MansionGrade',
    uniforms: {
      tDiffuse: { value: null },
      uShadow: { value: new THREE.Color(o.shadowTint ?? '#3f5aa8') },
      uHigh: { value: new THREE.Color(o.highlightTint ?? '#ffb36b') },
      uSplit: { value: o.splitStrength ?? 0.18 },
      uSat: { value: o.saturation ?? 1.12 },
      uVig: { value: o.vignette ?? 0.28 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 uShadow;
      uniform vec3 uHigh;
      uniform float uSplit;
      uniform float uSat;
      uniform float uVig;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D( tDiffuse, vUv );
        float l = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        // Luminance-weighted split tone, measured on a soft log curve so it works in HDR.
        float t = clamp( log2( l * 8.0 + 1.0 ) / 4.0, 0.0, 1.0 );
        vec3 tint = mix( uShadow, uHigh, smoothstep( 0.15, 0.75, t ) );
        vec3 graded = mix( c.rgb, c.rgb * tint * 1.6, uSplit * ( 1.0 - abs( t - 0.45 ) ) );
        graded = mix( vec3( dot( graded, vec3( 0.2126, 0.7152, 0.0722 ) ) ), graded, uSat );
        vec2 d = vUv - 0.5;
        graded *= 1.0 - uVig * smoothstep( 0.25, 0.75, dot( d, d ) * 2.0 );
        gl_FragColor = vec4( max( graded, 0.0 ), c.a );
      }`,
  });
}
