// Drone mode: sound, all made in the browser (no audio files): rotor hum that rises with throttle, wind with speed, rain,
// the low rumble of a debris flow that grows as you get close, thunder that arrives late if the strike was far, and the
// cracks and crunches of trees and buildings going. Starts on the first click (browsers require a gesture).
export class Audio {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC(), out = this.out = c.createGain(); out.gain.value = this.muted ? 0 : .8;
    const comp = c.createDynamicsCompressor(); out.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 3, white = c.createBuffer(1, len, c.sampleRate), brown = c.createBuffer(1, len, c.sampleRate), w = white.getChannelData(0), b = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + .02 * w[i]) / 1.02; b[i] = last * 3.5; }
    this.white = white; this.brown = brown;
    const loop = (buf, type, freq, q = .7) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(out); s.start(); return { f, g }; };
    this.wind = loop(white, 'bandpass', 500, .6); this.rain = loop(white, 'highpass', 2600); this.rumble = loop(brown, 'lowpass', 110); this.grit = loop(white, 'bandpass', 900, .4);
    this.rotor = []; const rg = this.rotorGain = c.createGain(); rg.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(rg); rg.connect(out);
    for (const [type, mul] of [['sawtooth', 1], ['sawtooth', 1.012], ['square', 2.02], ['triangle', .5]]) { const o = c.createOscillator(); o.type = type; const g = c.createGain(); g.gain.value = mul > 1.5 ? .12 : .3; o.connect(g); g.connect(lp); o.start(); this.rotor.push([o, mul]); }
  }
  mute(m) { this.muted = m; if (this.out) this.out.gain.setTargetAtTime(m ? 0 : .8, this.ctx.currentTime, .05); }
  set(p, v, tc = .12) { p.setTargetAtTime(v, this.ctx.currentTime, tc); }
  // every frame: throttle 0..1, speed m/s, storm 0..1, rumble 0..1, fpv, alive
  update(throttle, speed, storm, rumble, fpv, alive) {
    if (!this.ctx) return;
    const base = 92 + throttle * 95 + Math.min(speed, 90) * .5; for (const [o, mul] of this.rotor) this.set(o.frequency, base * mul, .08);
    this.set(this.rotorGain.gain, alive ? (fpv ? .1 : .065) * (.7 + .5 * throttle) : 0);
    this.set(this.wind.g.gain, Math.min(.5, speed / 90 * .42 + storm * .05)); this.set(this.wind.f.frequency, 350 + speed * 11);
    this.set(this.rain.g.gain, storm * .075); this.set(this.rumble.g.gain, Math.min(1, rumble) * .95, .25); this.set(this.grit.g.gain, Math.min(1, rumble) * .16, .25);
  }
  burst(buf, type, f0, f1, dur, gain, delay = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .015); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 2); s.stop(t + dur + .1);
  }
  thunder(dist) { const k = 1 / (1 + dist / 2500); this.burst(this.brown, 'lowpass', 600 * k + 120, 50, 3.5 + dist / 1500, 1.1 * k + .1, dist / 343); if (dist < 1500) this.burst(this.white, 'highpass', 1800, 500, .5, .5 * k, dist / 343); }
  crack(dist) { if (dist < 700) this.burst(this.white, 'bandpass', 2400, 700, .22, .4 / (1 + dist / 120)); }
  crunch(dist) { if (dist < 1500) { const k = 1 / (1 + dist / 220); this.burst(this.brown, 'lowpass', 500, 60, 1.4, 1.2 * k); this.burst(this.white, 'bandpass', 1500, 300, .7, .55 * k); } }
  crash() { this.burst(this.white, 'lowpass', 5000, 200, .9, .9); this.burst(this.brown, 'lowpass', 300, 40, 1.2, 1.2); }
  blip(f = 880) { if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.frequency.value = f; g.gain.setValueAtTime(.07, t); g.gain.exponentialRampToValueAtTime(.001, t + .12); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + .13); }
}
