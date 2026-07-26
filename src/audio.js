// audio.js — the entire soundscape is synthesised with the Web Audio API.
//
// Three persistent layers establish the place:
//   * mains hum  — stacked low oscillators (60/120/180 Hz) with a slow breathing LFO
//   * a heartbeat that only exists when something is close to you
//   * a convolution reverb that everything bleeds into, for the big-empty feel
// On top of that, one-shots are fired by the player (footsteps, the gun) and the
// horror director (phantom steps, whispers, drones, the creature).
//
// Most of the horror budget is spent here. A gunshot in a corridor this size has
// to be genuinely startling and then leave your ears ringing, or the twelve
// rounds do not feel like they cost anything.

import { AUDIO } from './config.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.heart = 0;          // 0..1 intensity, driven by creature proximity
    this._nextBeat = 0;
    this._nextBreath = 0;
    this.breath = 0;         // 0..1 creature breathing loudness
    this.breathPan = 0;
  }

  // Must be called from a user gesture (the canvas click / pointer lock).
  start() {
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.started = true;

    // Master bus, with a lowpass we can clamp down for the post-gunshot
    // deafness and the "silence" anomaly.
    this.master = ctx.createGain();
    this.master.gain.value = AUDIO.masterVolume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);

    // Reverb send -> convolver -> master.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.1, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this._buildHum();
    this._noise = this._noiseBuffer(0.6);
    this._longNoise = this._noiseBuffer(2.5);
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

  // Shared plumbing for a one-shot: source -> filter -> gain -> pan -> out.
  _voice({ buffer, rate = 1, loop = false, type, freq, Q = 1, pan = 0, send = 0.2 }) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    let src;
    if (buffer) {
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = loop;
      src.playbackRate.value = rate;
    } else {
      src = ctx.createOscillator();
      src.type = type || 'sine';
      src.frequency.value = freq || 200;
    }
    let node = src;
    let filter = null;
    if (type && buffer) {
      filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = Q;
      node = src.connect(filter);
    }
    node.connect(g).connect(panner);
    panner.connect(this.master);
    if (send > 0) {
      const s = ctx.createGain(); s.gain.value = send;
      panner.connect(s).connect(this.reverb);
    }
    return { src, g, filter, panner, t: ctx.currentTime };
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
  // Dread slowly thickens the hum; the heartbeat and creature breath are
  // scheduled here so they stay in sync with the frame loop.
  update(dread, dt = 0.016) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.humGain.gain.setTargetAtTime(AUDIO.humVolume * (1 + dread * 0.8), t, 1.5);

    if (this.heart > 0.01) {
      // Faster and harder the closer it is: 62 bpm at rest, 140 at its worst.
      const bpm = 62 + this.heart * 78;
      if (t >= this._nextBeat) {
        this._thump(0.030 + this.heart * 0.085);
        // The double-thump of a real beat.
        this._nextBeat = t + 0.16;
        setTimeout(() => this._thump(0.018 + this.heart * 0.05), 150);
        this._nextBeat = t + 60 / bpm;
      }
    } else {
      this._nextBeat = 0;
    }

    if (this.breath > 0.02 && t >= this._nextBreath) {
      this._breathIn(this.breath, this.breathPan);
      this._nextBreath = t + 1.5 + Math.random() * 1.4;
    }
  }

  setHeartbeat(k) { this.heart = k; }
  setBreath(k, pan = 0) { this.breath = k; this.breathPan = pan; }

  duck(target, time = 0.4) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, time);
  }

  // Roll the whole mix off at the top end — used for the "silence" anomaly and
  // for the seconds after a gunshot.
  muffleFor(freq, seconds) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(freq, t);
    this.muffle.frequency.exponentialRampToValueAtTime(20000, t + seconds);
  }

  quietBeat({ target = 0.18, attack = 0.12, hold = 1.1, release = 1.2 } = {}) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(Math.max(0.0001, target), t, attack);
    this.master.gain.setTargetAtTime(AUDIO.masterVolume, t + attack + hold, release);
  }

  // A short electrical buzz tied to the visible light flicker.
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

  // The torch cutting out. A relay snapping open, the filament coil letting go,
  // and then nothing. Deliberately mechanical and unmusical — it is the sound of
  // hardware failing, not of anything supernatural, which is what makes the
  // stutter that things now leave behind read as your batteries rather than as a
  // transition effect.
  playLightFail(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;

    // The relay: a single very short click, high and dry.
    const clk = ctx.createBufferSource(); clk.buffer = this._noise;
    clk.playbackRate.value = 1.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const cg = ctx.createGain(); cg.gain.value = 0;
    clk.connect(hp).connect(cg).connect(this.master);
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.linearRampToValueAtTime(0.10 * intensity, t + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    clk.start(t); clk.stop(t + 0.06);

    // The coil: a short pitched whine that dies as the current goes.
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1450 + Math.random() * 500, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.09);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
    bp.frequency.value = 1200;
    const og = ctx.createGain(); og.gain.value = 0;
    osc.connect(bp).connect(og).connect(this.master);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.035 * intensity, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.start(t); osc.stop(t + 0.15);
  }

  // Air moving in a hole in the floor. Wide, slow, tuned low enough that you
  // feel where it is coming from before you work out what it is.
  playPitDraft(pan = 0, volume = 0.2) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 0.55;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(150, t);
    bp.frequency.linearRampToValueAtTime(70, t + 2.6);
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.7;
    p.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.9);
    src.start(t); src.stop(t + 3.0);
  }

  // Going down one. Air past your ears: broadband noise opening up and rising
  // as it goes, with the reverb wound right up because the shaft is the only
  // genuinely large space in the building. Two and a half seconds is longer
  // than the fall, which is fine — the impact cuts it off.
  playFallRush() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(1150, t + 1.5);
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.85;
    g.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.35);
    g.gain.linearRampToValueAtTime(0.52, t + 1.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.5);
    src.start(t); src.stop(t + 2.6);
    // ...and one long note underneath it, going down with you.
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 1.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const og = ctx.createGain(); og.gain.value = 0;
    o.connect(lp).connect(og).connect(this.master);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.10, t + 0.5);
    og.gain.linearRampToValueAtTime(0.0001, t + 1.9);
    o.start(t); o.stop(t + 2.0);
  }

  // The bottom. One very short, very loud crack of noise over a body-thump, and
  // then a long tail of the shaft above you having heard it. Nothing after this
  // — the death screen comes up while it is still ringing.
  playFallImpact() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._thump(0.95, 40);
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.9;
    g.connect(send).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.start(t); src.stop(t + 0.6);
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

  // The creature's own footfall: a heavy, wet, bone-on-carpet impact.
  playCreatureStep(pan, volume) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._thump(volume * 0.9, 46, pan);
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(lp).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.55; p.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.7), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.start(t); src.stop(t + 0.4);
  }

  // A low body-thump. The heartbeat, the creature's steps and the gun's punch
  // all sit on one of these.
  _thump(volume, freq = 62, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.14);
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.start(t); o.stop(t + 0.35);
  }

  // Wet inhale-exhale. Played on a loose timer whenever the creature is near
  // enough to hear, panned to its bearing — you hear it before you see it.
  _breathIn(volume, pan) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const mk = (start, dur, f0, f1, vol) => {
      const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
      src.playbackRate.value = 0.35;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
      bp.frequency.setValueAtTime(f0, t + start);
      bp.frequency.exponentialRampToValueAtTime(f1, t + start + dur);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      src.connect(bp).connect(g).connect(p).connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.5; p.connect(s).connect(this.reverb);
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.linearRampToValueAtTime(vol, t + start + dur * 0.45);
      g.gain.linearRampToValueAtTime(0.0001, t + start + dur);
      src.start(t + start); src.stop(t + start + dur + 0.05);
    };
    mk(0, 0.55, 320, 780, volume * 0.16);        // in
    mk(0.72, 0.75, 620, 220, volume * 0.13);     // out, longer and lower
  }

  // It goes.
  //
  // The old version of this was a pair of detuned saws sliding down through a
  // tanh waveshaper — a cartoon monster shriek, and the single most obviously
  // *authored* sound in the game. Nothing about it belonged in a building where
  // everything else is a room tone. This is the opposite: no pitched material at
  // all, just a sub-bass drop under an inhale-shaped band of noise falling out
  // of the top of your hearing, and then a hole in the mix where the room used
  // to be. It sounds like pressure leaving, not like a creature.
  playVanish(volume = 0.55, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;

    // Sub drop — felt more than heard, and the reason it lands in the chest.
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(66, t);
    sub.frequency.exponentialRampToValueAtTime(23, t + 0.62);
    const sg = ctx.createGain(); sg.gain.value = 0;
    sub.connect(sg).connect(this.master);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(volume * 1.15, t + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    sub.start(t); sub.stop(t + 0.8);

    // Air: a wide band of noise sliding down and out. Fast attack, no sustain —
    // the shape of a breath taken in and then simply stopping.
    const air = ctx.createBufferSource(); air.buffer = this._longNoise; air.loop = true;
    air.playbackRate.value = 0.9;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(1700, t);
    bp.frequency.exponentialRampToValueAtTime(115, t + 0.52);
    const ag = ctx.createGain(); ag.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    air.connect(bp).connect(ag).connect(p).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.85;
    p.connect(send).connect(this.reverb);
    ag.gain.setValueAtTime(0.0001, t);
    ag.gain.linearRampToValueAtTime(volume * 0.8, t + 0.03);
    ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    air.start(t); air.stop(t + 0.7);

    // And then the room is muffled for a moment, as though it went with it.
    this.muffleFor(620, 0.85);
  }

  // Something a long way off has answered. Low, slow, and heard through walls —
  // the point is that you cannot tell how far away it is or what made it, only
  // that it was not there a second ago.
  playDistantCall(volume = 0.4, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 340; lp.Q.value = 0.6;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(lp).connect(p).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 1.0;
    p.connect(send).connect(this.reverb);

    // Two nearly-unison partials with slow independent drift, so it beats
    // against itself instead of sitting on a note.
    for (const [f0, f1, amp] of [[132, 104, 0.5], [88, 71, 0.42], [197, 158, 0.16]]) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f1, t + 1.9);
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      lfo.frequency.value = 3.1 + Math.random() * 1.4;
      const lg = ctx.createGain(); lg.gain.value = 2.6;
      lfo.connect(lg).connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 2.3);
      lfo.start(t); lfo.stop(t + 2.3);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.45);
    g.gain.linearRampToValueAtTime(volume * 0.7, t + 1.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  }

  // It caught you. Everything at once, then the room drops out.
  playScream() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.playVanish(0.9, 0);
    this._thump(0.9, 90);
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 0.8;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    src.start(t); src.stop(t + 1.4);
    this.muffleFor(400, 3.5);
  }

  // --- the hunter -----------------------------------------------------------

  // Its footfall. Much heavier and much lower than the creature's, with a drag
  // on the tail, and it carries three times as far — hearing it start is meant
  // to happen well before seeing it.
  playHunterStep(pan = 0, volume = 0.4) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    p.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.75;
    p.connect(send).connect(this.reverb);

    // The impact: a short sine drop, felt in the floor.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(31, t + 0.16);
    const og = ctx.createGain(); og.gain.value = 0;
    o.connect(og).connect(p);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(volume, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.start(t); o.stop(t + 0.4);

    // The drag: whatever it walks on does not lift cleanly off the carpet.
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.35;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520, t + 0.05); bp.Q.value = 0.9;
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.32);
    const ng = ctx.createGain(); ng.gain.value = 0;
    src.connect(bp).connect(ng).connect(p);
    ng.gain.setValueAtTime(0.0001, t + 0.05);
    ng.gain.linearRampToValueAtTime(volume * 0.32, t + 0.10);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    src.start(t); src.stop(t + 0.45);
  }

  // It has arrived, and it wants you to know. A long rising swell that never
  // quite becomes a note — two sub partials sliding up under a band of breath.
  playHunterCall(volume = 0.6, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    p.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.9;
    p.connect(send).connect(this.reverb);

    for (const [f0, f1, amp, type] of [[41, 63, 0.62, 'sine'], [58, 94, 0.34, 'triangle']]) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 1.5);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + 2.4);
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(p);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(volume * amp, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      o.start(t); o.stop(t + 2.6);
    }
    // Breath over the top, sweeping the other way so the two never lock.
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 0.55;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(880, t + 1.2);
    bp.frequency.exponentialRampToValueAtTime(160, t + 2.4);
    const ng = ctx.createGain(); ng.gain.value = 0;
    src.connect(bp).connect(ng).connect(p);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(volume * 0.30, t + 0.9);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.start(t); src.stop(t + 2.5);
  }

  // It has stopped moving, and that is worse. A rising whine cut off by the
  // moment it commits — the half second you get to react to a charge.
  playHunterCharge(volume = 0.75) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    g.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.5;
    g.connect(send).connect(this.reverb);

    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 1.1;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.42);
    src.connect(bp).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume * 0.5, t + 0.40);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.56);
    src.start(t); src.stop(t + 0.6);

    // And a sub that arrives underneath as it launches.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(96, t + 0.30);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.95);
    const og = ctx.createGain(); og.gain.value = 0;
    o.connect(og).connect(this.master);
    og.gain.setValueAtTime(0.0001, t + 0.30);
    og.gain.linearRampToValueAtTime(volume, t + 0.36);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.start(t + 0.30); o.stop(t + 1.2);
  }

  // It has you. One hit, everything at once, and then the room is gone.
  playJumpscare() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._thump(1.0, 54);
    this._thump(0.8, 88);

    // The transient: full-band, instant, brutal.
    const crack = ctx.createBufferSource(); crack.buffer = this._noise;
    crack.playbackRate.value = 1.4;
    const cg = ctx.createGain(); cg.gain.value = 0;
    crack.connect(cg).connect(this.master);
    const cs = ctx.createGain(); cs.gain.value = 0.9; cg.connect(cs).connect(this.reverb);
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    crack.start(t); crack.stop(t + 0.7);

    // Under it, a sub that keeps falling after the picture has already cut.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(19, t + 1.5);
    const og = ctx.createGain(); og.gain.value = 0;
    o.connect(og).connect(this.master);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.95, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.start(t); o.stop(t + 1.8);

    // Its voice, if that is the word: a formant-filtered roar that decays into
    // the reverb rather than ending.
    for (const [f, q, amp] of [[220, 9, 0.5], [640, 7, 0.34], [1420, 6, 0.2]]) {
      const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
      src.playbackRate.value = 0.7;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * 1.5, t);
      bp.frequency.exponentialRampToValueAtTime(f * 0.55, t + 1.1);
      bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s).connect(this.reverb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      src.start(t); src.stop(t + 1.5);
    }
    this.muffleFor(300, 4.0);
  }

  // Hurt, not killed. A short, wet grunt with a bone crack on top.
  playCreatureHit(pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this._thump(0.3, 120, pan);
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.45;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.5; p.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.start(t); src.stop(t + 0.5);
  }

  // --- the gun --------------------------------------------------------------

  // A gunshot in a sealed corridor. Four layers: firing-pin click, the crack,
  // the low body, and a long reverb tail — then the room goes muffled and your
  // ears ring, because twelve rounds should feel expensive.
  playGunshot() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const V = AUDIO.gunshotVolume;

    // Crack: broadband noise, brutally fast decay.
    const crack = ctx.createBufferSource(); crack.buffer = this._noise;
    crack.playbackRate.value = 2.0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const cg = ctx.createGain(); cg.gain.value = 0;
    crack.connect(hp).connect(cg).connect(this.master);
    const cs = ctx.createGain(); cs.gain.value = 0.7; cg.connect(cs).connect(this.reverb);
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(V, t + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    crack.start(t); crack.stop(t + 0.2);

    // Body: a lowpassed blast that gives it weight in the chest.
    const body = ctx.createBufferSource(); body.buffer = this._noise;
    body.playbackRate.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    const bg = ctx.createGain(); bg.gain.value = 0;
    body.connect(lp).connect(bg).connect(this.master);
    const bs = ctx.createGain(); bs.gain.value = 0.9; bg.connect(bs).connect(this.reverb);
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(V * 0.85, t + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    body.start(t); body.stop(t + 0.45);

    this._thump(V * 0.55, 110);

    // Tinnitus. A pure tone that fades over three seconds while the world is
    // rolled off underneath it.
    const ring = ctx.createOscillator(); ring.type = 'sine'; ring.frequency.value = 4180;
    const rg = ctx.createGain(); rg.gain.value = 0;
    ring.connect(rg).connect(ctx.destination);
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.linearRampToValueAtTime(0.030, t + 0.03);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    ring.start(t); ring.stop(t + 3.1);
    this.muffleFor(900, 2.6);
  }

  // Hammer falls on nothing. The worst sound in the game.
  playDryFire() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 2.6;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.start(t); src.stop(t + 0.1);
  }

  // Brass on concrete, a beat after the shot.
  playShellDrop(pan = 0.25) {
    if (!this.started) return;
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const delay = 0.42 + i * (0.09 + Math.random() * 0.07);
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = 2400 + Math.random() * 1600;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      o.connect(g).connect(p).connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.35; p.connect(s).connect(this.reverb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 / (i + 1), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.start(t); o.stop(t + 0.12);
    }
  }

  // Round into drywall: a dull slap plus a little grit falling.
  playBulletImpact(pan = 0, dist = 4) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.min(0.09, dist * 0.003);
    const vol = 0.24 / (1 + dist * 0.12);
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 1.3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.6; p.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.start(t); src.stop(t + 0.25);
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

  // Slide racked, round chambered. Two clacks, not one.
  playGunReady() {
    if (!this.started) return;
    const ctx = this.ctx;
    for (const [delay, rate, vol] of [[0, 1.1, 0.075], [0.11, 1.5, 0.095]]) {
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource(); src.buffer = this._noise;
      src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 * rate; bp.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.3; g.connect(s).connect(this.reverb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.start(t); src.stop(t + 0.14);
    }
  }

  // --- ambience one-shots ---------------------------------------------------

  // Breathy whisper: band-passed noise swell, panned, drenched in reverb.
  playWhisper({ pan = 0, volume = 0.09 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
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

  // Something heavy shut, a long way off, in a building with no doors.
  playDistantBang(pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(lp).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.9; p.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.start(t); src.stop(t + 0.7);
    this._thump(0.10, 44, pan);
  }

  // A child laughing two rooms over. Used sparingly; it does not need help.
  playChildLaugh(pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const t = t0 + i * 0.155;
      const o = ctx.createOscillator(); o.type = 'triangle';
      const base = 640 - i * 34;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.11);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
      o.connect(bp).connect(g).connect(p).connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.85; p.connect(s).connect(this.reverb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.start(t); o.stop(t + 0.16);
    }
  }

  // A dead radio finding a station for half a second.
  playStaticBurst(pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._longNoise; src.loop = true;
    src.playbackRate.value = 1.2;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.linearRampToValueAtTime(2600, t + 0.9);
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.5; p.connect(s).connect(this.reverb);
    g.gain.setValueAtTime(0.0001, t);
    // Stuttering carrier — it keeps almost tuning in.
    for (let i = 0; i < 7; i++) {
      const tt = t + i * 0.12;
      g.gain.linearRampToValueAtTime(i % 2 ? 0.002 : 0.055, tt);
    }
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    src.start(t); src.stop(t + 1.1);
  }
}
