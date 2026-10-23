/**
 * The one-man prone hide from inside (kit `hide`): cloth walls and a roof round the shooter and the low window the
 * rifle looks out of, facing between the two mannequins. It is part of the range's scene, at the eye, so the naked
 * eye sees it round the view and the scope sees its frame only at the ends of the arc the window allows, where the
 * barrel meets it. Unlit: in daylight the inside of a hide is in its own shade, lit a little from the window.
 * Nothing in it stops a bullet or a laser: the muzzle is out past the window.
 */
import * as THREE from "three";

/** The window's distance ahead of the eye (m), and how far past the rifle's arc it is cut (rad), for the scope's field. */
const WINDOW_M = 0.8;
const MARGIN = (2.5 * Math.PI) / 180;

export function buildHide(scene: THREE.Scene, eye: THREE.Vector3, yaw: number, pitch: number, arcRad: number, arcPitchRad: number): { group: THREE.Group } {
  const group = new THREE.Group();
  group.position.copy(eye);
  group.rotation.set(pitch, yaw, 0, "YXZ");
  group.visible = false;
  scene.add(group);

  const hw = WINDOW_M * Math.tan(arcRad + MARGIN);
  const hh = WINDOW_M * Math.tan(arcPitchRad + MARGIN);
  // The cloth: a faint weave and a falloff toward the back, where less light from the window reaches.
  const weave = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + 0.04 * ((i * 7) % 3)})`;
      g.fillRect(i, 0, 1, 64);
      g.fillRect(0, i, 64, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 40);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const cloth = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, map: weave, side: THREE.DoubleSide, fog: false });

  // The front panel, the window cut in it, its edges bound in a darker tape.
  const front = new THREE.Shape();
  front.moveTo(-1.4, -0.9);
  front.lineTo(1.4, -0.9);
  front.lineTo(1.4, 0.7);
  front.lineTo(-1.4, 0.7);
  front.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-hw, -hh);
  hole.lineTo(-hw, hh);
  hole.lineTo(hw, hh);
  hole.lineTo(hw, -hh);
  hole.closePath();
  front.holes.push(hole);
  const panel = new THREE.Mesh(new THREE.ShapeGeometry(front), cloth(0x403d2f));
  panel.position.z = -WINDOW_M;
  group.add(panel);
  const tape = cloth(0x1d1c16);
  for (const [w, h, x, y] of [
    [2 * hw + 0.05, 0.025, 0, hh + 0.012],
    [2 * hw + 0.05, 0.025, 0, -hh - 0.012],
    [0.025, 2 * hh, hw + 0.012, 0],
    [0.025, 2 * hh, -hw - 0.012, 0],
  ] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tape);
    m.position.set(x, y, -WINDOW_M + 0.002);
    group.add(m);
  }
  // Walls and roof back past the shooter's head, darker away from the window.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), cloth(0x24231b));
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, 0.42, -WINDOW_M + 0.7);
  group.add(roof);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.6), cloth(0x2c2a21));
    wall.rotation.y = Math.PI / 2;
    wall.position.set(s * 1.4, -0.1, -WINDOW_M + 0.7);
    group.add(wall);
  }
  group.traverse((o) => {
    o.frustumCulled = false;
    o.renderOrder = 1;
  });
  return { group };
}
