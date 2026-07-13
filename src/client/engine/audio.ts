/**
 * Procedural score + SFX via the Web Audio API. The music is a playful 3/4
 * waltz in D harmonic-minor — a silly, carnival-esque Danny-Elfman nod — and
 * the SFX cover engine revs, launches, thuds, part snaps and crashes.
 */

const ROOT = 50; // D3
const SCALE = [0, 2, 3, 5, 7, 8, 11, 12, 14, 15];
const PROGRESSION: number[][] = [
  [0, 3, 7],
  [5, 8, 12],
  [7, 11, 14],
  [0, 3, 7],
  [-2, 3, 6],
  [5, 8, 12],
  [7, 11, 14],
  [7, 11, 14],
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuffer!: AudioBuffer;

  private rollSrc: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;

  private timer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private muted = false;
  private thudCooldown = 0;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.6, 2.4);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.2;
    this.reverb.connect(reverbGain).connect(this.master);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.42;
    this.musicGain.connect(this.master);
    this.musicGain.connect(this.reverb);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.95;
    this.sfxGain.connect(this.master);
    this.sfxGain.connect(this.reverb);

    this.noiseBuffer = this.makeNoise(2);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, t + 0.15);
    }
  }
  get isMuted(): boolean {
    return this.muted;
  }

  startMusic(): void {
    if (!this.ctx || this.timer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.scheduler(), 25);
  }

  private scheduler(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const secPerEighth = 60 / 132 / 2;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secPerEighth;
      this.step = (this.step + 1) % 48;
    }
  }

  private scheduleStep(step: number, when: number): void {
    const bar = Math.floor(step / 6) % PROGRESSION.length;
    const beatPos = step % 6;
    const chord = PROGRESSION[bar]!;
    if (beatPos === 0) {
      this.pluck(midiToFreq(ROOT + chord[0]! - 12), when, 0.34, 0.22);
    } else if (beatPos === 2 || beatPos === 4) {
      const note = chord[1 + (beatPos === 4 ? 1 : 0)] ?? chord[0]!;
      this.pluck(midiToFreq(ROOT + note), when, 0.18, 0.12);
    }
    const playMelody = beatPos % 2 === 0 ? Math.random() < 0.68 : Math.random() < 0.38;
    if (playMelody) {
      const chordTone = Math.random() < 0.65;
      const semis = chordTone
        ? chord[Math.floor(Math.random() * chord.length)]!
        : SCALE[Math.floor(Math.random() * SCALE.length)]!;
      const octave = Math.random() < 0.3 ? 24 : 12;
      this.bell(midiToFreq(ROOT + semis + octave), when, 0.16);
    }
  }

  private bell(freq: number, when: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.18, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(g);
    osc2.connect(g);
    g.connect(this.musicGain);
    osc.start(when);
    osc2.start(when);
    osc.stop(when + dur + 0.02);
    osc2.stop(when + dur + 0.02);
  }

  private pluck(freq: number, when: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(filt).connect(g).connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  // ---- SFX -------------------------------------------------------------
  /** Rolling rumble whose loudness/brightness tracks speed (0..1). */
  setRollIntensity(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (intensity > 0.02 && !this.rollSrc) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g).connect(this.sfxGain);
      src.start();
      this.rollSrc = src;
      this.rollGain = g;
      this.rollFilter = filt;
    }
    if (this.rollGain && this.rollFilter) {
      const t = ctx.currentTime;
      this.rollGain.gain.cancelScheduledValues(t);
      this.rollGain.gain.linearRampToValueAtTime(0.13 * intensity, t + 0.06);
      this.rollFilter.frequency.linearRampToValueAtTime(260 + intensity * 900, t + 0.06);
    }
    if (intensity <= 0.02 && this.rollSrc) {
      try {
        this.rollSrc.stop();
      } catch {
        /* already stopped */
      }
      this.rollSrc = null;
      this.rollGain = null;
      this.rollFilter = null;
    }
  }

  launch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(filt).connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.52);
  }

  thud(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t < this.thudCooldown) return;
    this.thudCooldown = t + 0.05;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.16);
    const g = ctx.createGain();
    const vol = Math.min(0.32, 0.05 + intensity * 0.02);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.22);
    if (intensity > 12) this.noiseBurst(0.12, 1200, 0.1);
  }

  snap(): void {
    this.noiseBurst(0.16, 2600, 0.16);
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  crash(): void {
    this.noiseBurst(0.5, 900, 0.28);
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.52);
  }

  private noiseBurst(dur: number, cutoff: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(midiToFreq(ROOT + 24), t, 0.1);
  }

  fanfare(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = ROOT + 12;
    [0, 4, 7, 12, 16, 19].forEach((n, i) => {
      this.bell(midiToFreq(base + n), ctx.currentTime + i * 0.09, 0.5);
    });
  }
}
