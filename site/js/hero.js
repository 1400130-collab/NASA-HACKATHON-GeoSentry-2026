// Home page hero: the real terrain with the flagged slopes on it.
// Reads the small files k07_site_images.py (nationwide) or p10_site_images.py (regional) write: hero.json, hero_height, hero_points.
// Heights of 0 are off the map (sea, North Korea, Japan) and are drawn as flat dark water.
// The closing slide shows the same scene from another angle: the one canvas moves there when that slide comes into
// view and back again for the hero, so there is only ever one WebGL context.
import * as THREE from 'three';
import { fetchBin } from './data.js';


export async function startHero(section, closer = null, dir = 'data/korea/') {
  const canvas = section.querySelector('canvas');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [info, hb, pb] = await Promise.all([
    fetch(dir + 'hero.json').then((r) => r.json()), fetchBin(dir + 'hero_height.bin.gz'), fetchBin(dir + 'hero_points.bin.gz'),
  ]);
  // the scene is always ~110 units across, whatever the area; EX is scene units per km of height
  const S = 110 / Math.max(info.w_km, info.h_km), EX = info.exag ?? 5.5, DOT = info.dot ?? 1;
  // camera: elevation (rad), distance, look-at point on wide and narrow screens, and where the fog starts/ends
  const C = { el: 0.5, R: 86, Rn: 98, wide: [-6, 16], narrow: [0, 10], fog: [80, 205], ...info.cam };
  const { w: W, h: H } = info, Wkm = info.w_km * S, Hkm = info.h_km * S;
  const h16 = new Uint16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2);
  // a 3 x 3 box blur, run a few times: once over the heights so ridges read as landforms and not as needles (the grid
  // is 360 m, drawn several times taller than life), and wider over the land mask so the coast fades instead of stepping
  const soften = (src, passes) => {
    let a = src, b = new Float32Array(src.length);
    for (let n = 0; n < passes; n++) {
      for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
        let sum = 0, cnt = 0;
        for (let di = -1; di <= 1; di++) { const y = i + di; if (y < 0 || y >= H) continue; for (let dj = -1; dj <= 1; dj++) { const x = j + dj; if (x < 0 || x >= W) continue; sum += a[y * W + x]; cnt++; } }
        b[i * W + j] = sum / cnt;
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const hs = soften(Float32Array.from(h16, (v) => v / info.height_scale / 1000 * EX), 1);     // scene heights
  const land = soften(Float32Array.from(h16, (v) => (v > 0 ? 1 : 0)), 6);
  const hAt = (fx, fz) => {                                    // fx, fz in 0..1 -> scene height
    const x = Math.min(fx * (W - 1), W - 1.001), z = Math.min(fz * (H - 1), H - 1.001), j = x | 0, i = z | 0, a = x - j, b = z - i, k = i * W + j;
    return (hs[k] * (1 - a) + hs[k + 1] * a) * (1 - b) + (hs[k + W] * (1 - a) + hs[k + W + 1] * a) * b;
  };

  // multisampling only on low-density screens: on a retina screen the contour lines are already smoothed in the shader
  // and the edges are a pixel wide anyway, and 4x samples over ~3.8 million pixels was most of each frame's cost
  const Q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.has('aa') || devicePixelRatio < 1.5, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 800);
  // uSweep: where the radar pass is, as a z position; far off the map when there is none
  const U = { uGrow: { value: still ? 1 : 0 }, uT: { value: 0 }, uPx: { value: 1 }, uFog: { value: new THREE.Vector2(...C.fog) }, uSweep: { value: 1e4 },
    uCam: { value: cam.position }, uHalf: { value: new THREE.Vector2(Wkm / 2, Hkm / 2) } };
  // shared by the terrain and the dots, so both fade out together: an oval island of terrain in the dark, thinning
  // with distance, and a band of light that follows the radar pass (sharp leading edge, long tail behind it)
  const FADE = `uniform vec2 uHalf, uFog; uniform vec3 uCam; uniform float uSweep;
    float fade(vec3 p) { float r = 1. - smoothstep(.6, 1., length(p.xz / uHalf)); return r * r * (1. - smoothstep(uFog.x, uFog.y, distance(p, uCam))); }
    float sweep(vec3 p) { float d = p.z - uSweep; return d > 0. ? exp(-d * d * 3.) : exp(d / 7.); }`;

  // terrain: row 0 of the grid is north, which is -z after the plane is laid flat
  const geo = new THREE.PlaneGeometry(Wkm, Hkm, W - 1, H - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hs[i]);
  geo.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { ...U, uLight: { value: new THREE.Vector3(-0.8, 0.26, -0.42).normalize() } },
    vertexShader: `attribute float aLand; uniform float uGrow; varying vec3 vN; varying float vH; varying vec3 vW; varying float vL;
      void main() { vN = normal; vH = position.y; vL = aLand; vec3 p = position; p.y *= uGrow; vW = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: `uniform vec3 uLight; uniform float uGrow; varying vec3 vN; varying float vH; varying vec3 vW; varying float vL;
      ${FADE}
      // one-pixel lines at whole values of v; where a pixel spans a good part of the gap between two lines (far away,
      // or seen edge-on) the lines are dropped, or they would merge into a bright smear with holes in it
      float lines(float v) { float w = fwidth(v); return (1. - clamp(abs(fract(v - .5) - .5) / w, 0., 1.)) * (1. - smoothstep(.18, .5, w)); }
      void main() {
        // drawn like an elevation map from a survey: height tinted from deep blue through teal to ice, shaded by a low
        // light, with contour lines and a 10 km grid laid over the ground
        vec3 n = normalize(mix(vec3(0., 1., 0.), normalize(vN), uGrow));
        float d = dot(n, uLight), l = pow(clamp(d * .5 + .5, 0., 1.), 1.8);
        float t = smoothstep(0., 3.8, vH);
        vec3 tint = mix(vec3(.035, .1, .19), vec3(.1, .4, .5), smoothstep(0., .42, t));
        tint = mix(tint, vec3(.78, .93, .95), smoothstep(.36, 1., t));
        vec3 col = tint * (.24 + 1.1 * l) + vec3(.8, .95, 1.) * pow(clamp(d, 0., 1.), 12.) * .1;
        float c = vH / ${((info.contour_km ?? 0.1) * EX).toFixed(4)};                      // a contour line every 100 m (200 m nationwide), every fifth one heavier
        float land = step(.03, vH), line = lines(c) * land, index = lines(c / 5.) * land;
        float grid = max(lines(vW.x / ${(10 * S).toFixed(3)}), lines(vW.z / ${(10 * S).toFixed(3)}));     // every 10 km
        vec3 ice = vec3(.62, .9, 1.);
        col += ice * (line * .1 + index * .12 + grid * .09);
        float s = sweep(vW);                                                       // the radar pass lights the lines it crosses
        col += ice * s * (line * .5 + grid * .5 + .07);
        vec3 sea = vec3(.02, .05, .085) + ice * grid * (.05 + .3 * s);              // the sea (and anything off the map) is flat, dark water under the same grid
        col = mix(sea, col, smoothstep(.25, .75, vL));
        float a = fade(vW);
        col = mix(vec3(.04, .05, .062), col, smoothstep(.06, .6, a));             // far ridges flatten into haze before they go, so the edge is soft
        if (a < .003) discard;
        gl_FragColor = vec4(col * a, a);                                           // really see-through where it fades, so the glow behind the horizon shows
      }`,
  })));

  // flagged slopes, as points on the map: check-first in red with a pale centre (they pulse slowly and flare as the
  // radar pass crosses them), watch as fine amber dust. A dot too far away to cover two pixels is dimmed by as much
  // as it is enlarged, so the thousands of distant ones never add up to a haze.
  const p16 = new Uint16Array(pb.buffer, pb.byteOffset, pb.byteLength / 2);
  // each sprite is drawn only as big as the part of it that shows (k of its full width): the amber dust is just its
  // core, and the red halo is below one step of brightness past 80% out, so the rest of the square was blended for nothing
  const cloud = (from, n, lift, color, size, pulse, gain, core, halo, hot, k) => {
    const p = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fx = p16[(from + i) * 2] / 65535, fz = p16[(from + i) * 2 + 1] / 65535;
      p[i * 3] = (fx - 0.5) * Wkm; p[i * 3 + 1] = hAt(fx, fz) + lift; p[i * 3 + 2] = (fz - 0.5) * Hkm; ph[i] = Math.random() * 6.283;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...U, uCol: { value: new THREE.Color(color).multiplyScalar(gain) }, uSize: { value: size }, uPulse: { value: pulse }, uCore: { value: core }, uHalo: { value: halo }, uHot: { value: hot }, uK: { value: k } },
      // light is added to what is there and the canvas's own opacity is left alone: with the stock additive blend
      // every sprite made its whole square opaque, which showed as black blocks wherever there was no terrain under it
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: `attribute float aPhase; uniform float uT, uSize, uGrow, uPx, uPulse, uK; varying float vA, vK;
        ${FADE}
        void main() { vec3 p = position; p.y *= uGrow; vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
          float s = 1. - uPulse + uPulse * (.5 + .5 * sin(uT * 1.4 + aPhase)), b = sweep(p);
          float px = uSize * uPx * (.85 + .3 * s + .45 * b) / -mv.z;
          vA = smoothstep(.55, 1., uGrow) * (.55 + .45 * s + 1.3 * b) * smoothstep(.1, .55, fade(p)) * min(1., px * px / 4.);
          if (vA < .002) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; vK = 1.; return; }   // faded out: skip it
          float sz = max(px * uK, 2.); vK = sz / max(px, 2.);
          gl_PointSize = sz; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uCore, uHalo, uHot; varying float vA, vK;
        void main() { float d = length(gl_PointCoord - .5) * 2. * vK;              // 0 at the centre, 1 at the edge of the full sprite
          float halo = exp(-d * d * 6.) * (1. - smoothstep(.8, 1., d)), core = smoothstep(uCore, uCore * .55, d);
          vec3 c = uCol * halo * uHalo + mix(uCol, vec3(1., .82, .66), uHot * smoothstep(uCore * .8, 0., d)) * core;
          gl_FragColor = vec4(c * vA, 1.); }`,
    })));
  };
  cloud(info.n_check, info.n_watch, 0.12, '#ffb020', 0.28 * DOT, 0, 0.5, 0.5, 0, 0, 0.5);
  cloud(0, info.n_check, 0.22, '#ff4d2e', 1.5 * DOT, 0.6, 1, 0.3, 0.12, 0.5, 0.8);

  let w = 0, h = 0, mx = 0, my = 0, tx = 0, ty = 0, scroll = 0, visible = true, t0 = performance.now(), raf = 0, last = 0;
  let host = section, enter = 0;                                   // enter: how far the closing slide has come into view, 0..1
  let budget = 3.8e6, slow = 0, timed = 0, drops = 0;              // pixels drawn per frame, lowered if this machine can't keep up
  const resize = () => {
    w = host.clientWidth; h = host.clientHeight;
    renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(budget / Math.max(w * h, 1)))));   // sharp, but never more than the budget (~3.8 million pixels)
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix(); U.uPx.value = h * renderer.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
  };
  const frame = (now) => {
    raf = 0;
    const end = host !== section;
    if (!end && scroll >= 0.6) return;                             // the hero has faded out by now: draw nothing
    // a steady 60 fps (at most: a 120 Hz screen draws every other frame); the drift used to drop to 30, which showed as stepping
    if (now - last < 15) { if (visible) raf = requestAnimationFrame(frame); return; }
    const dt = Math.min((now - (last || now - 16.7)) / 1000, 0.1);
    // a slower graphics chip: if a third of a run of 60 frames came late, draw fewer pixels (twice at most)
    if (last && now - last < 100 && now - t0 > 3000 && drops < 2) {    // (a longer gap is the loop waking up, not a slow frame)
      timed++; if (dt > 0.024) slow++;
      if (timed === 60) { if (slow > 20) { budget *= 0.55; drops++; resize(); } timed = slow = 0; }
    }
    last = now;
    const t = (now - t0) / 1000;
    U.uT.value = t; U.uGrow.value = still ? 1 : 1 - Math.pow(1 - Math.min(t / 2.6, 1), 3);
    // the radar pass: every 11 s a band of light crosses the map from north to south in 5 s
    const ph = still ? 1 : ((t - 3) % 11) / 5, passing = t > 3 && ph < 1;
    U.uSweep.value = passing ? -Hkm / 2 - 6 + ph * (Hkm + 34) : 1e4;
    const ease = 1 - Math.exp(-1.3 * dt);                          // eased in time, not frames, so it feels the same at any frame rate
    mx += (tx - mx) * ease; my += (ty - my) * ease;
    const wide = Math.min(Math.max(cam.aspect, 0.5), 2.2), s = end ? 0 : scroll;
    // the closing slide looks back across the same hills from the other side, lower and closer, settling as it arrives
    const az = (end ? -2.5 : 0.25) + (still ? 0 : 0.2 * Math.sin(t * 0.07)) + mx * 0.1;       // drifts, never spins
    const el = (end ? 0.36 + (1 - enter) * 0.16 : C.el + s * 0.45) - my * 0.04;
    const R = (wide < 1 ? C.Rn : C.R) * (end ? 0.86 : 1) + s * 40 + (1 - U.uGrow.value) * 22;
    const [cx, cz] = end ? [-2, 2] : wide > 1.3 ? C.wide : C.narrow;
    U.uFog.value.set(C.fog[0] / C.R * R, C.fog[1] / C.R * R);          // fog keeps its place when the camera backs off (phones, scrolling)
    cam.position.set(cx + R * Math.cos(el) * Math.sin(az), R * Math.sin(el), cz + R * Math.cos(el) * Math.cos(az));
    cam.lookAt(cx, 0, cz);
    renderer.render(scene, cam);
    // keep going only while someone is there: it stops 10 s after the last pointer move or scroll and
    // picks up again on the next one. index.html?live=1 never stops (for an unattended screen).
    // A pass that has started is always finished, so the band never freezes half way across.
    if (visible && (LIVE || now < awakeUntil || passing) && !(still && U.uGrow.value === 1 && t > 0.2)) raf = requestAnimationFrame(frame);
  };
  const LIVE = new URLSearchParams(location.search).has('live');
  let awakeUntil = performance.now() + 14000;
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const wake = () => { awakeUntil = performance.now() + 10000; kick(); };
  addEventListener('resize', () => { resize(); wake(); });
  addEventListener('pointermove', (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; wake(); });
  const place = (el) => { if (host === el) return; host = el; el.querySelector('.stage').append(canvas); resize(); last = 0; wake(); };
  const seen = new Map([[section, true]]);
  const onScroll = () => {
    scroll = Math.min(Math.max(scrollY / Math.max(section.clientHeight, 1), 0), 1);
    if (closer) enter = Math.min(Math.max(1 - closer.getBoundingClientRect().top / innerHeight, 0), 1);
    wake();
  };
  addEventListener('scroll', onScroll, { passive: true });
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => seen.set(e.target, e.isIntersecting));
    if (closer && seen.get(closer)) place(closer); else if (seen.get(section)) place(section);
    visible = !!seen.get(host); if (visible) kick();
  });
  io.observe(section); if (closer) io.observe(closer);
  // the map's own legend, top right: every figure is the scene's real scale
  const key = section.querySelector('.readout');
  if (key) {
    const size = `${Math.round(info.w_km)} × ${Math.round(info.h_km)} km`, step = Math.round((info.contour_km ?? 0.1) * 1000);
    key.innerHTML = `<span lang="en">${size} · contours every ${step} m · grid 10 km · heights ×${EX}</span><span lang="ko">${size} · 등고선 ${step} m 간격 · 격자 10 km · 높이 ${EX}배</span>`;
  }
  resize(); onScroll(); renderer.render(scene, cam); section.classList.add('ready'); kick();
}
