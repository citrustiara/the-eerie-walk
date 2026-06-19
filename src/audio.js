// audio.js — the entire soundscape is synthesised with the Web Audio API.
//
// Three persistent layers establish the place:
//   * mains hum  — stacked low oscillators (60/120/180 Hz) with a slow breathing LFO
//   * fluorescent whine — a faint high tone, modulated by the light flicker event
//   * a convolution reverb that everything bleeds into, for the big-empty feel
// On top of that, one-shots are fired by the player (footsteps) and the horror
// director (phantom steps behind you, whispers, drones).

import { AUDIO } from './config.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  // Must be called from a user gesture (the canvas click / pointer lock).
  start() {
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.started = true;

    // Master bus.
    this.master = ctx.createGain();
    this.master.gain.value = AUDIO.masterVolume;
    this.master.connect(ctx.destination);

    // Reverb send -> convolver -> master.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this._buildHum();
    this._noise = this._noiseBuffer(0.4);
  }

  // --- helpers --------------------------------------------------------------
  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Exponentially-decaying noise = a cheap, convincing room impulse response.
  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _buildHum() {
    const ctx = this.ctx;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = AUDIO.humVolume;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    this.humGain.connect(lp).connect(this.master);
    lp.connect(this.reverb);

    // 60 Hz + harmonics with falling amplitude.
    [[60, 1], [120, 0.5], [180, 0.28]].forEach(([f, a]) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g).connect(this.humGain);
      o.start();
    });

    // Slow "breathing" LFO on the hum level.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = AUDIO.humVolume * 0.4;
    lfo.connect(lfoGain).connect(this.humGain.gain);
    lfo.start();
  }

  // --- live tuning ----------------------------------------------------------
  // Dread slowly thickens the hum.
  update(dread) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(AUDIO.humVolume * (1 + dread * 0.8), t, 1.5);
  }

  duck(target, time = 0.4) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, time);
  }

  quietBeat({ target = 0.18, attack = 0.12, hold = 1.1, release = 1.2 } = {}) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(Math.max(0.0001, target), t, attack);
    this.master.gain.setTargetAtTime(AUDIO.masterVolume, t + attack + hold, release);
  }

  // A short electrical buzz tied to the visible light flicker. (The constant
  // high-pitched whine was removed by request; only this transient buzz remains.)
  flickerWhine(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;

    const src = ctx.createBufferSource(); src.buffer = this._noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * intensity, t + 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    src.start(t); src.stop(t + 0.55);
  }

  // --- one-shots ------------------------------------------------------------
  // Generic footstep: layered low thud + high scuff with a fast envelope.
  playFootstep({ pan = 0, volume = AUDIO.footstepVolume, muffled = false, reverbSend = 0.15 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.3;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muffled ? 420 : 1300;

    const g = ctx.createGain();
    const panner = ctx.createStereoPanner(); panner.pan.value = pan;
    src.connect(lp).connect(g).connect(panner);
    panner.connect(this.master);
    const send = ctx.createGain(); send.gain.value = reverbSend;
    panner.connect(send).connect(this.reverb);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (muffled ? 0.22 : 0.16));
    src.start(t); src.stop(t + 0.3);
  }

  // Phantom step: muffled, reverberant, panned — meant to sit behind you.
  playPhantomStep(pan, volume) {
    this.playFootstep({ pan, volume, muffled: true, reverbSend: 0.5 });
  }

  playGunPickup() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 1.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp).connect(g).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.25; g.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.start(t); src.stop(t + 0.18);
  }

  playGunReady() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 1.15;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.start(t); src.stop(t + 0.22);
  }

  // Breathy whisper: band-passed noise swell, panned, drenched in reverb.
  playWhisper({ pan = 0, volume = 0.09 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise; src.loop = true;
    src.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1600, t + 1.4);
    const g = ctx.createGain(); g.gain.value = 0;
    const panner = ctx.createStereoPanner(); panner.pan.value = pan;
    src.connect(bp).connect(g).connect(panner);
    panner.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.7;
    panner.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.8);
    src.start(t); src.stop(t + 2.0);
  }

  // Low sub-bass swell for anomalies — felt more than heard.
  playDrone({ freq = 42, dur = 4, volume = 0.18 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.005;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g); o2.connect(g); g.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.4; g.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
}
