// Synthesised sound for Solmar Bay: every effect is built with the Web Audio
// API at run time, so the game ships zero audio files and makes zero requests.
// Engine hum, sirens, gunshots, crashes, pickups and UI blips.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.enabled = true;
    this._sirenOn = false;
  }

  /** Must be called from a user gesture at least once. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Engine: a low sawtooth whose pitch follows the player's speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      this.engineOsc.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      // Siren: a triangle wave wobbling between two notes.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 780;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.55;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 170;
      this.sirenLfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.sirenLfo.start();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  /** Engine pitch/volume from the player's car speed (0..1). */
  engine(speedNorm, driving) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speedNorm * 0.06 : 0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(52 + speedNorm * 150, t, 0.08);
  }

  /** Siren fades in while the player is wanted, out otherwise. */
  siren(wanted) {
    if (!this.ctx || !this.enabled) return;
    const on = wanted > 0;
    if (on === this._sirenOn) return;
    this._sirenOn = on;
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, this.ctx.currentTime, 0.4);
  }

  _noiseBurst(duration, volume, filterFreq, type = 'lowpass') {
    if (!this.ctx || !this.enabled) return;
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  _tone(freq, duration, volume, type = 'sine', slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  gunshot() { this._noiseBurst(0.14, 0.5, 1800, 'highpass'); }
  punch() { this._noiseBurst(0.09, 0.35, 300); }
  crash() { this._noiseBurst(0.25, 0.5, 500); }
  horn() { this._tone(340, 0.35, 0.18, 'square', 300); }
  pickup() { this._tone(660, 0.09, 0.2); setTimeout(() => this._tone(990, 0.14, 0.2), 90); }
  missionDone() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.22, 'triangle'), i * 110));
  }
  busted() { this._tone(220, 0.5, 0.25, 'sawtooth', 110); }
  click() { this._tone(880, 0.05, 0.12, 'square'); }
  wantedUp() { this._tone(392, 0.18, 0.2, 'square', 523); }
}
