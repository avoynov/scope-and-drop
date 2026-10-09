/**
 * Final pass: the eye's view through the scope.
 * Layers, back to front: the naked-eye world (blurred and over-exposed while the eye is on the glass, as in
 * the footage; sharp and normally exposed with the head up), the rifle and scope (a few centimetres from
 * an eye focused far away, so defocused; see near.ts), then through the eyepiece glass the magnified image
 * with eyebox transmission, field stop, pincushion, lateral colour, mirage, parallax and focus.
 * Recoil tilts the scope against the eye and, while it moves fast, the inside of the lens is averaged
 * over a 1/60 s exposure.
 */
import * as THREE from 'three';

export function createComposite(tScope: THREE.Texture, tWide: THREE.Texture, tRet: THREE.Texture, tNear: THREE.Texture, tLens: THREE.Texture, tBody: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tScope: { value: tScope },
      tWide: { value: tWide },
      tRet: { value: tRet },
      tNear: { value: tNear },
      tLens: { value: tLens },
      tBody: { value: tBody },
      uExposure: { value: 1 },
      uWorldBlur: { value: 9 },
      uRoll: { value: 0 },
      uWideLod: { value: 0 },
      uRes: { value: new THREE.Vector2() },
      uR: { value: 300 },
      uTanHalf: { value: 0.2 },
      uMag: { value: 10 },
      uExitR: { value: 2.5 },
      uEye: { value: new THREE.Vector3() },
      uEyePupilR: { value: 1.5 },
      uTnorm: { value: 1 },
      uPar: { value: new THREE.Vector2() },
      uTilt: { value: new THREE.Vector2() },
      uSweep: { value: new THREE.Vector2() },
      uBlur: { value: new THREE.Vector2() },
      uEyeSweep: { value: new THREE.Vector3() },
      uFocus: { value: 0 },
      uTime: { value: 0 },
      uMirage: { value: 0 },
      uCA: { value: 0.006 },
      uDist: { value: 0.025 },
      uEdge: { value: 0 },
      uRetCol: { value: new THREE.Vector3(0.02, 0.02, 0.02) },
    },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tScope, tWide, tRet, tNear, tLens, tBody;
      uniform vec2 uRes, uPar, uTilt, uSweep, uBlur;
      uniform vec3 uEye, uEyeSweep, uRetCol;
      uniform float uR, uTanHalf, uMag, uExitR, uEyePupilR, uExposure, uWorldBlur, uRoll, uWideLod, uTnorm, uFocus, uTime, uMirage, uCA, uDist, uEdge;
      const float PI = 3.14159265;

      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }

      // Same as circleOverlap() in src/scope/optics.ts.
      float overlap(float a, float b, float d){
        if (d >= a + b) return 0.;
        float r = min(a, b);
        if (d <= abs(a - b)) return PI*r*r;
        float a2 = a*a, b2 = b*b;
        float al = acos(clamp((d*d + a2 - b2)/(2.*d*a), -1., 1.));
        float be = acos(clamp((d*d + b2 - a2)/(2.*d*b), -1., 1.));
        return a2*(al - sin(2.*al)*.5) + b2*(be - sin(2.*be)*.5);
      }

      vec3 disc(sampler2D t, vec2 uv, vec2 rad, int n){
        vec3 s = vec3(0.);
        for (int i = 0; i < 24; i++){
          if (i >= n) break;
          float f = float(i) + .5;
          float r = sqrt(f/float(n));
          float a = f*2.39996;
          s += texture2D(t, uv + vec2(cos(a), sin(a))*r*rad).rgb;
        }
        return s/float(n);
      }

      vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }

      // What the eye gets through the eyepiece from direction ts (tan, from the scope's axis) with the eye
      // at eye (mm from the exit pupil): the magnified image, its uv nudged by o, the FFP reticle, the
      // eyebox transmission and the field stop. focus: apply the parallax/focus and rim blur.
      vec3 glass(vec2 ts, vec3 eye, vec2 o, bool focus){
        vec2 q = ts/uTanHalf;                    // 1 at the field stop
        float r2 = dot(q, q);
        vec2 qd = q*(1. - uDist*r2);             // pincushion (shared by image and FFP reticle)
        float ca = uCA*r2;
        vec2 uR_ = .5 + .5*qd*(1. + ca), uG_ = .5 + .5*qd, uB_ = .5 + .5*qd*(1. - ca);
        // Field curvature / coma: a good eyepiece is sharp over most of the field and softens only at the rim.
        vec2 fr = vec2(uFocus + uEdge*r2*r2*r2);
        vec3 img;
        if (focus && fr.x > .0006) {
          img = vec3(disc(tScope, uR_ + o, fr, 16).r, disc(tScope, uG_ + o, fr, 16).g, disc(tScope, uB_ + o, fr, 16).b);
        } else {
          img = vec3(texture2D(tScope, uR_ + o).r, texture2D(tScope, uG_ + o).g, texture2D(tScope, uB_ + o).b);
        }
        // Veiling glare: a little light scattered across the field lifts the blacks, as in real glass.
        img = img*.9 + .035*vec3(.95, .97, 1.);
        // Reticle sits in the first focal plane: distorted with the image, shifted by parallax, never by mirage.
        vec4 rR = texture2D(tRet, uR_ + uPar), rG = texture2D(tRet, uG_ + uPar), rB = texture2D(tRet, uB_ + uPar);
        img.r = mix(img.r, rG.r*rG.r*1.6 + uRetCol.r, rR.a);
        img.g = mix(img.g, rG.g*rG.g*1.6 + uRetCol.g, rG.a);
        img.b = mix(img.b, rG.b*rG.b*1.6 + uRetCol.b, rB.a);

        // Eyebox: fraction of the eye pupil the bundle for this direction still reaches.
        float d = length(eye.xy + eye.z*ts);
        float T = overlap(uExitR, uEyePupilR, d)/(PI*uEyePupilR*uEyePupilR)/uTnorm;
        float stop = 1. - smoothstep(1. - 1.2/uR, 1. + .6/uR, sqrt(r2));
        return img*T*stop*(1. - .16*r2);
      }

      // Mip-filtered disc: wide blurs without hundreds of taps.
      vec3 discLod(sampler2D t, vec2 uv, vec2 rad, float lod){
        vec3 s = vec3(0.);
        for (int i = 0; i < 24; i++){
          float f = float(i) + .5;
          float r = sqrt(f/24.);
          float a = f*2.39996;
          s += textureLod(t, uv + vec2(cos(a), sin(a))*r*rad, lod).rgb;
        }
        return s/24.;
      }

      void main(){
        vec2 frag = gl_FragCoord.xy;
        // Residual roll of the head while it moves: every layer turns together about the line of sight.
        float cr = cos(uRoll), sr = sin(uRoll);
        vec2 p = mat2(cr, sr, -sr, cr)*(frag - .5*uRes);
        vec2 suv = (p + .5*uRes)/uRes;
        vec2 t = p/uR*uTanHalf;                 // tan of the apparent direction of this pixel
        // Relative to the scope's axis, which recoil can tilt against the head for a moment.
        vec2 ts = t - uTilt;

        // Naked-eye world. On the glass it is blurred and blown out like a camera exposed for the image;
        // head up, the eye adapts to it and it is sharp.
        vec3 world = uWorldBlur > .4
          ? discLod(tWide, suv, uWorldBlur/uRes, max(log2(max(uWorldBlur*.35, 1.)) + uWideLod, 0.))
          : texture2D(tWide, suv).rgb;
        world *= 1.7;

        // Rifle and scope, defocused (premultiplied, alpha = coverage), and where the eyepiece glass shows.
        vec4 body = texture2D(tBody, suv);
        vec4 near = texture2D(tNear, suv);
        float aperture = texture2D(tLens, suv).r;
        vec3 col = world*(1. - body.a) + body.rgb*1.7;
        col = col*(1. - near.a) + near.rgb*1.7;

        // Magnified image. Mirage moves the image only, never the reticle.
        vec3 img = vec3(0.);
        if (aperture > .002) {
          vec2 q = ts/uTanHalf;
          vec2 trueAng = q*(1. - uDist*dot(q, q))*uTanHalf/uMag*1000.;   // mrad, object space
          vec2 mir = vec2(vn(trueAng*1.6 + vec2(uTime*1.1, uTime*.35)) - .5, vn(trueAng*1.6 + vec2(17. + uTime*.9, 5. - uTime*.5)) - .5);
          mir += .5*vec2(vn(trueAng*4. + vec2(uTime*2.6, 3.)) - .5, vn(trueAng*4. + vec2(9., uTime*2.)) - .5);
          vec2 mq = mir*uMirage;
          if (length(uBlur) > .002 || length(uSweep) > .5*uTanHalf/uR || length(uEyeSweep) > .3) {
            // Recoil: across the exposure the picture swings in the eye's view, the scene sweeps through it
            // and the eye slides over the exit pupil. Stratified, jittered taps turn ghosting into grain.
            float j = h21(frag + 51.7);
            for (int i = 0; i < 16; i++) {
              float f = (float(i) + j)/16. - .5;
              img += glass(ts - uSweep*f, uEye + uEyeSweep*f, mq + uBlur*f, false);
            }
            img /= 16.;
          } else {
            img = glass(ts, uEye, mq, true);
          }
        }

        col += img*aperture;
        col = aces(col*1.05*uExposure);
        col = pow(col, vec3(1./2.2));
        col += (h21(frag + fract(uTime)*91.) - .5)*.018;
        gl_FragColor = vec4(col, 1.);
      }
    `,
  });
}
