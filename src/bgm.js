// ============================================================
// 程序化 BGM v2（Web Audio 合成）— 更响、更稳、更丰富
// setInterval 驱动 + 低音和声 + 主旋律，三端通用
// ============================================================
export class BgmPlayer {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.timer = null;
    this.step = 0;
    // 温馨 C 大调旋律（C4 E4 G4 A4 G4 E4 D4 C4）+ 低音
    this.melody = [261.63, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66, 261.63];
    this.bass = [130.81, 164.81, 196.00, 220.00, 196.00, 164.81, 146.83, 130.81];
  }

  ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }

  play() {
    this.ensure();
    if (!this.ctx || this.playing) return;
    this.playing = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // setInterval 驱动（比 setTimeout 循环更稳）
    this.timer = setInterval(() => this.tick(), 350);
    this.tick();
  }

  tick() {
    if (!this.playing || !this.ctx) return;
    const t = this.ctx.currentTime;
    const i = this.step % this.melody.length;
    const note = this.melody[i];
    const bass = this.bass[i];
    // 主旋律（音量 0.12）
    const o1 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.value = note;
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o1.connect(g1).connect(this.ctx.destination);
    o1.start(t); o1.stop(t + 0.35);
    // 低音（音量 0.1）
    const o2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = bass;
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o2.connect(g2).connect(this.ctx.destination);
    o2.start(t); o2.stop(t + 0.35);
    this.step++;
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
