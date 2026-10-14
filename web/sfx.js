// 声音全部现场合成，不用任何音频文件。
export class Sfx {
  constructor(isOn) {
    this.isOn = isOn;
    this.ctx = null;
    this.level = 0;
    this.last = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } else if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch {
      this.ctx = null;
    }
  }

  /** 自己合成声音前先问一下：有节流，倍速很高时不会吵成一片。priority 2 = 重要音效。 */
  ok(priority = 1) {
    if (!this.isOn() || !this.ctx) return false;
    const now = performance.now();
    this.level = Math.max(0, this.level - (now - this.last) * 0.012);
    this.last = now;
    if (this.level > 9 && priority < 2) return false;
    this.level += 1;
    return true;
  }

  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(freq, dur, vol, type = 'sine', to = null, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(weapon) {
    if (!this.ok(weapon === 'AWP' || weapon === 'AWM' ? 2 : 1)) return;
    if (weapon === 'AWP' || weapon === 'AWM') {
      this.burst(0.35, 1100, 0.7);
      this.tone(110, 0.25, 0.3, 'triangle', 50);
    } else if (['侦察', 'Recon', 'Deagle', 'USP-S', 'Glock-18'].includes(weapon)) {
      this.burst(0.07, 3200, 0.22);
    } else {
      this.burst(0.09, 1900, 0.34);
    }
  }
  headshot() { if (this.ok(2)) this.tone(1500, 0.14, 0.16, 'triangle'); }
  bite() { if (this.ok()) this.tone(170, 0.1, 0.14, 'square', 80); }
  boom(big) {
    if (!this.ok(2)) return;
    this.burst(big ? 1.1 : 0.5, big ? 260 : 420, big ? 0.9 : 0.5);
    this.tone(big ? 70 : 90, big ? 0.8 : 0.35, 0.4, 'sine', 30);
  }
  beep() { if (this.ok(2)) this.tone(2200, 0.06, 0.08); }
  good() {
    if (!this.ok(2)) return;
    this.tone(880, 0.12, 0.12, 'triangle');
    this.tone(1320, 0.18, 0.12, 'triangle', null, 0.1);
  }
  round(win) {
    if (!this.ok(2)) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.22, 0.1, 'triangle', null, i * 0.12));
  }
  /** 大字播报的提示音：好事上扬，坏事下沉。 */
  announce(bad) {
    if (!this.ok(2)) return;
    const notes = bad ? [622, 466, 349] : [784, 988, 1319];
    notes.forEach((f, i) => this.tone(f, 0.12, 0.07, 'triangle', null, i * 0.06));
  }
  stage() {
    if (!this.ok(2)) return;
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 0.1, 'square', null, i * 0.07));
  }
}
