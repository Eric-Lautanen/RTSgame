export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.3;
    this._initOnInteraction = () => this._init();
    window.addEventListener('click', this._initOnInteraction, { once: true });
    window.addEventListener('keydown', this._initOnInteraction, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    });
  }

  _init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _playTone(freq, duration, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  _playToneAt(freq, time, duration, type = 'sine') {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(this.volume * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }

  selectMultiple() {
    if (!this.ctx) return;
    const notes = [500, 650, 800, 1000];
    const now = this.ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      this._playToneAt(notes[i], now + i * 0.05, 0.04, 'sine');
    }
  }

  selectUnit(def) {
    if (!this.ctx) return;
    const notes = def?.selectSound;
    if (!notes || !Array.isArray(notes)) {
      this._playTone(800, 0.08);
      return;
    }
    const now = this.ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      this._playToneAt(notes[i].freq, now + i * 0.07, notes[i].dur, notes[i].wave || 'sine');
    }
  }
  move() { this._playTone(400, 0.05, 'triangle'); }
  gather() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(660, t, 0.06, 'sine');
    this._playToneAt(880, t + 0.06, 0.08, 'sine');
  }
  attack() { this._playTone(150, 0.15, 'sawtooth'); }
  death() { this._playTone(200, 0.4, 'sine'); }
  victory() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(this.volume, this.ctx.currentTime + i * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.3 + 0.5);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.3);
      osc.stop(this.ctx.currentTime + i * 0.3 + 0.5);
    });
  }

  uiClick() { this._playTone(600, 0.04, 'sine'); }
  uiClose() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(400, t, 0.03, 'sine');
    this._playToneAt(250, t + 0.04, 0.04, 'sine');
  }
  uiToggleOn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(700, t, 0.03, 'sine');
    this._playToneAt(900, t + 0.035, 0.04, 'sine');
  }
  uiToggleOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(500, t, 0.03, 'sine');
    this._playToneAt(350, t + 0.035, 0.04, 'sine');
  }
  uiError() { this._playTone(200, 0.1, 'square'); }
  selectNone() { this._playTone(300, 0.03, 'sine'); }
  queueUnit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(600, t, 0.035, 'sine');
    this._playToneAt(750, t + 0.04, 0.04, 'sine');
  }
  unitComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(600, t, 0.035, 'sine');
    this._playToneAt(800, t + 0.045, 0.035, 'sine');
    this._playToneAt(1000, t + 0.09, 0.04, 'sine');
  }
  buildStart() { this._playTone(220, 0.1, 'triangle'); }
  buildComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(400, t, 0.05, 'sine');
    this._playToneAt(600, t + 0.07, 0.06, 'sine');
  }
  upgradeStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(330, t, 0.04, 'sine');
    this._playToneAt(550, t + 0.05, 0.05, 'sine');
  }
  upgradeComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(500, t, 0.04, 'sine');
    this._playToneAt(700, t + 0.05, 0.04, 'sine');
    this._playToneAt(900, t + 0.1, 0.05, 'sine');
  }
  researchStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(450, t, 0.05, 'sine');
    this._playToneAt(650, t + 0.06, 0.06, 'sine');
  }
  researchComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(600, t, 0.04, 'sine');
    this._playToneAt(800, t + 0.05, 0.04, 'sine');
    this._playToneAt(1000, t + 0.1, 0.04, 'sine');
    this._playToneAt(1200, t + 0.15, 0.05, 'sine');
  }
  ageAdvanceStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(200, t, 0.08, 'sine');
    this._playToneAt(300, t + 0.1, 0.08, 'sine');
    this._playToneAt(400, t + 0.2, 0.1, 'sine');
  }
  ageAdvanceComplete() {
    if (!this.ctx) return;
    [262, 330, 392, 523].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(this.volume * 0.8, this.ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.15);
      osc.stop(this.ctx.currentTime + i * 0.15 + 0.4);
    });
  }
  gameOverDefeat() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(400, t, 0.15, 'sine');
    this._playToneAt(300, t + 0.2, 0.15, 'sine');
    this._playToneAt(200, t + 0.4, 0.2, 'sine');
    this._playToneAt(150, t + 0.6, 0.3, 'sine');
  }
  underAttack() { this._playTone(500, 0.1, 'square'); }
  scuttle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(200, t, 0.1, 'sawtooth');
    this._playToneAt(150, t + 0.12, 0.12, 'sawtooth');
    this._playToneAt(100, t + 0.25, 0.15, 'sawtooth');
  }
  placementError() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._playToneAt(180, t, 0.06, 'square');
    this._playToneAt(120, t + 0.07, 0.08, 'square');
  }
}
