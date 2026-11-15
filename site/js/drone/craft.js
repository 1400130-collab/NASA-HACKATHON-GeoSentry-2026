// Drone mode: the aircraft. A survey quadcopter that goes where you look: W/S along the view, A/D sideways, Space/C up
// and down, Shift for the long-range sprint. It hovers when you let go. Two cameras: a chase camera on a short spring
// behind it, and the drone's own nose camera, which banks with it. It can hit the ground: fast enough and it is gone.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function model() {
  const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: .55, metalness: .35 }), grey = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: .4, metalness: .6 }), red = new THREE.MeshStandardMaterial({ color: 0xff4d2e, roughness: .5 });
  const add = (geo, mat, x, y, z, p = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); p.add(m); return m; };
  add(new THREE.BoxGeometry(.34, .13, .62), dark, 0, 0, 0); add(new THREE.BoxGeometry(.26, .06, .4), red, 0, .09, .02); add(new THREE.BoxGeometry(.2, .1, .16), grey, 0, -.02, -.36);
  const cam = add(new THREE.SphereGeometry(.085, 12, 10), dark, 0, -.13, -.3); add(new THREE.CylinderGeometry(.04, .04, .05, 10), new THREE.MeshBasicMaterial({ color: 0x0a1626 }), 0, 0, -.07, cam).rotation.x = Math.PI / 2;
  const props = [];
  for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const arm = add(new THREE.BoxGeometry(.075, .05, .78), dark, sx * .3, .01, sz * .3); arm.rotation.y = Math.atan2(sx, sz);
    add(new THREE.CylinderGeometry(.062, .07, .11, 12), grey, sx * .56, .06, sz * .56);
    const p = new THREE.Group(); p.position.set(sx * .56, .135, sz * .56); g.add(p);
    const blade = new THREE.MeshBasicMaterial({ color: 0x15171a, transparent: true, opacity: .32, depthWrite: false });
    add(new THREE.BoxGeometry(.72, .008, .045), blade, 0, 0, 0, p); add(new THREE.BoxGeometry(.045, .008, .72), blade, 0, 0, 0, p);
    const disc = add(new THREE.CircleGeometry(.37, 20), new THREE.MeshBasicMaterial({ color: 0x8f959c, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide }), 0, .004, 0, p); disc.rotation.x = -Math.PI / 2;
    props.push([p, sx * sz]);
    add(new THREE.SphereGeometry(.03, 8, 6), new THREE.MeshBasicMaterial({ color: sz < 0 ? 0xffffff : 0xff2a1a, toneMapped: false }), sx * .56, -.01, sz * .56);
    add(new THREE.BoxGeometry(.03, .2, .03), dark, sx * .22, -.15, sz * .2);
  }
  add(new THREE.BoxGeometry(.03, .03, .56), dark, .22, -.25, 0); add(new THREE.BoxGeometry(.03, .03, .56), dark, -.22, -.25, 0);
  const strobe = add(new THREE.SphereGeometry(.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35ff7a, toneMapped: false }), 0, .14, .26);
  g.scale.setScalar(1.5);
  return { g, props, strobe };
}

export class Craft {
  constructor(land, scene, camera) {
    this.land = land; this.camera = camera; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.fpv = false;
    this.roll = 0; this.tilt = 0; this.dead = 0; this.speed = 0; this.agl = 0; this.throttle = 0; this.onCrash = null; this.shake = 0;
    const m = model(); this.body = m.g; this.props = m.props; this.strobe = m.strobe; scene.add(this.body);
    this.look = new THREE.Vector3(0, 0, -1); this._n = new THREE.Vector3(); this._a = new THREE.Vector3(); this._c = new THREE.Vector3(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this.camPos = new THREE.Vector3(); this.spin = 0; this._lc = [0, 0, 0, 0];
  }
  place(x, z, agl, yaw, pitch = -.12) {
    this.pos.set(x, this.land.hAt(x, z) + agl, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = pitch; this.dead = 0; this.body.visible = !this.fpv; this.snap = true;
  }
  // input: f, s, u in -1..1 | boost | dx, dy look (radians)
  update(dt, I, now, mudAt) {
    const { land, pos, vel } = this, n = this._n, a = this._a;
    this.yaw -= I.dx; this.pitch = clamp(this.pitch - I.dy, -1.5, 1.5);
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); this.look.set(-sy * cp, Math.sin(this.pitch), -cy * cp);
    if (this.dead > 0) {                                           // down: wait, then lift off again from where it fell
      this.dead -= dt; vel.multiplyScalar(Math.exp(-dt * 3));
      if (this.dead <= 0) { pos.y = land.hAt(pos.x, pos.z) + 22; vel.set(0, 0, 0); this.body.visible = !this.fpv; this.snap = true; }
    } else {
      a.set(-sy * cp * I.f + cy * I.s, Math.sin(this.pitch) * I.f + I.u, -cy * cp * I.f - sy * I.s);
      const al = a.length(), maxV = I.boost ? 88 : 32, acc = I.boost ? 72 : 36; if (al > 1) a.multiplyScalar(1 / al);
      this.throttle += (Math.min(1, al) * (I.boost ? 1 : .6) - this.throttle) * Math.min(1, dt * 6);
      vel.addScaledVector(a, acc * dt); vel.multiplyScalar(Math.exp(-dt * (acc / maxV + (al < .05 ? 1.4 : 0))));
      const gust = I.gust || 0; vel.x += Math.sin(now * 1.3) * Math.sin(now * .37) * gust * dt; vel.z += Math.cos(now * 1.1) * Math.sin(now * .53) * gust * dt; vel.y += Math.sin(now * 2.3) * gust * .4 * dt;
      pos.addScaledVector(vel, dt);
      const bx = land.hx - 1200, bz = land.hz - 1200;                 // the edge of the mapped box
      if (Math.abs(pos.x) > bx) { pos.x = Math.sign(pos.x) * bx; vel.x *= -.3; } if (Math.abs(pos.z) > bz) { pos.z = Math.sign(pos.z) * bz; vel.z *= -.3; }
      if (pos.y > 2600) { pos.y = 2600; vel.y = Math.min(vel.y, 0); }
      const m = mudAt ? mudAt(pos.x, pos.z) : 0, gy = land.hAt(pos.x, pos.z) + m, floor = gy + .7;
      land.lcAt(pos.x, pos.z, this._lc);
      if (this._lc[0] > .6 && pos.y - gy < 9 && pos.y > floor) { vel.multiplyScalar(Math.exp(-dt * 1.6)); this.shake = Math.max(this.shake, Math.min(.5, vel.length() * .02)); }   // through the canopy
      if (pos.y < floor) {
        land.normalAt(pos.x, pos.z, n, 2); const into = -vel.dot(n);
        if (into > 13 || vel.length() > 42) { this.dead = 1.6; this.body.visible = false; this.onCrash?.(pos, vel); vel.set(0, 0, 0); }
        else { pos.y = floor; if (into > 0) vel.addScaledVector(n, into * 1.25); vel.multiplyScalar(Math.exp(-dt * 2)); }
      }
      this.agl = pos.y - gy;
    }
    this.speed = vel.length();

    // how the airframe leans into what it is doing
    const fwd = -vel.x * sy - vel.z * cy, side = vel.x * cy - vel.z * sy, k = Math.min(1, dt * 7);
    this.tilt += (clamp(-fwd / 60, -.6, .6) - this.tilt) * k; this.roll += (clamp(-side / 45 - I.dx * 9, -.7, .7) - this.roll) * k;
    this.body.position.copy(pos); this.body.rotation.set(this.tilt, this.yaw, this.roll, 'YXZ');
    this.spin += dt * (38 + this.throttle * 60); for (const [p, s] of this.props) p.rotation.y = this.spin * s;
    this.strobe.visible = (now % 1.1) < .09;

    // cameras
    const cam = this.camera, sh = this.shake, e = this._e; this.shake = Math.max(0, this.shake - dt * 2.2);
    const jx = (Math.random() - .5) * sh * .03, jy = (Math.random() - .5) * sh * .03, jz = (Math.random() - .5) * sh * .04;
    let fov;
    if (this.fpv) {
      cam.position.copy(pos).addScaledVector(this.look, .35); cam.position.y += .05;
      e.set(this.pitch + jx, this.yaw + jy, this.roll * .55 + jz); cam.quaternion.setFromEuler(e); fov = 86 + Math.min(1, this.speed / 88) * 22;
    } else {
      const d = 6.2 + Math.min(1, this.speed / 88) * 3.4, want = this._c.copy(pos).addScaledVector(this.look, -d); want.y += 1.9;
      if (this.snap) this.camPos.copy(want); else this.camPos.lerp(want, 1 - Math.exp(-dt * 13));
      const gy = land.hAt(this.camPos.x, this.camPos.z) + 1.3; if (this.camPos.y < gy) this.camPos.y = gy;
      cam.position.copy(this.camPos); e.set(this.pitch + jx, this.yaw + jy, jz + this.roll * .12); cam.quaternion.setFromEuler(e); fov = 66 + Math.min(1, this.speed / 88) * 20;
    }
    this.snap = false;
    if (Math.abs(cam.fov - fov) > .05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
  setView(fpv) { this.fpv = fpv; this.body.visible = !fpv && this.dead <= 0; this.snap = true; }
}
