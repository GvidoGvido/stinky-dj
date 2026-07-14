import type { DrumSound, MixSettings, VoiceTrack } from '../shared/api';
import type { BassPreset, DrumKit, SynthPreset } from '../shared/synth';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function nowSec(ctx: AudioContext): number {
  return ctx.currentTime;
}

const DEFAULT_MIX: MixSettings = { echo: 0.22, reverb: 0.18, attack: 0.35, vox: 0.55 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private drumBus: GainNode | null = null;
  private synthBus: GainNode | null = null;
  private bassBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private voiceInputHpf: BiquadFilterNode | null = null;
  private voiceHpfRestoreHz: number | null = null;
  private voiceDelaySend: GainNode | null = null;
  private voiceReverbSend: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayWet: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbWet: GainNode | null = null;
  private wobbleOsc: OscillatorNode | null = null;
  private wobbleGain: GainNode | null = null;
  private mix: MixSettings = { ...DEFAULT_MIX };
  private drumKit: DrumKit = 'classic';
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceTrack: VoiceTrack | null = null;
  private voiceBuffer: AudioBuffer | null = null;
  private voiceOffsetSec = 0;
  private voiceStartCtxTime = 0;
  private voiceComp: DynamicsCompressorNode | null = null;
  private voxFx: 'dry' | 'echo' | 'verb' | 'space' = 'space';
  private synthFxSend: GainNode | null = null;
  private bassFxSend: GainNode | null = null;
  private drumFxSend: GainNode | null = null;
  private playbackFxSendRestore: { synth: number; bass: number; drum: number; voiceDelay: number; voiceReverb: number } | null =
    null;

  ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.84;

    this.synthBus = this.ctx.createGain();
    this.synthBus.gain.value = 0.78;
    this.bassBus = this.ctx.createGain();
    this.bassBus.gain.value = 0.74;
    this.drumBus = this.ctx.createGain();
    this.drumBus.gain.value = 0.72;
    this.voiceBus = this.ctx.createGain();
    this.voiceBus.gain.value = 0.62;

    this.voiceDelaySend = this.ctx.createGain();
    this.voiceDelaySend.gain.value = 0.8;
    this.voiceReverbSend = this.ctx.createGain();
    this.voiceReverbSend.gain.value = 0.8;

    this.voiceComp = this.ctx.createDynamicsCompressor();
    this.voiceComp.threshold.value = -20;
    this.voiceComp.knee.value = 12;
    this.voiceComp.ratio.value = 2.2;
    this.voiceComp.attack.value = 0.004;
    this.voiceComp.release.value = 0.16;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;

    this.delay = this.ctx.createDelay(1.2);
    this.delay.delayTime.value = 0.22;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.32;
    this.delayWet = this.ctx.createGain();
    this.delayWet.gain.value = 0.22;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(this.ctx, 2.4, 0.55);
    this.reverbWet = this.ctx.createGain();
    this.reverbWet.gain.value = 0.18;

    this.wobbleOsc = this.ctx.createOscillator();
    this.wobbleOsc.type = 'sine';
    this.wobbleOsc.frequency.value = 0.28;
    this.wobbleGain = this.ctx.createGain();
    this.wobbleGain.gain.value = 0.0;
    this.wobbleOsc.connect(this.wobbleGain);
    this.wobbleOsc.start();

    const routeStem = (bus: GainNode, pan: number, onSend?: (send: GainNode) => void): void => {
      const panner = this.ctx!.createStereoPanner();
      panner.pan.value = pan;
      const send = this.ctx!.createGain();
      send.gain.value = 0.38;
      onSend?.(send);
      bus.connect(panner);
      panner.connect(this.master!);
      bus.connect(send);
      send.connect(this.delay!);
      send.connect(this.reverb!);
    };
    routeStem(this.synthBus, -0.42, (send) => {
      this.synthFxSend = send;
    });
    routeStem(this.bassBus, -0.14, (send) => {
      this.bassFxSend = send;
    });
    routeStem(this.drumBus, 0.04, (send) => {
      this.drumFxSend = send;
      send.gain.value = 0;
    });
    const voicePanner = this.ctx.createStereoPanner();
    voicePanner.pan.value = 0.44;
    this.voiceInputHpf = this.ctx.createBiquadFilter();
    this.voiceInputHpf.type = 'highpass';
    this.voiceInputHpf.frequency.value = 72;
    this.voiceInputHpf.Q.value = 0.7;
    this.voiceBus.connect(this.voiceInputHpf);
    this.voiceInputHpf.connect(voicePanner);
    voicePanner.connect(this.voiceComp!);
    this.voiceComp!.connect(this.master);
    this.voiceBus.connect(this.voiceDelaySend);
    this.voiceDelaySend.connect(this.delay);
    this.voiceBus.connect(this.voiceReverbSend);
    this.voiceReverbSend.connect(this.reverb);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.master);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.master);

    this.master.connect(this.limiter!);
    this.limiter!.connect(this.ctx.destination);
    this.applyMix();
    this.applyVoxFx();
    return this.ctx;
  }

  async resume(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state !== 'running') await ctx.resume();
    if (this.wobbleGain) this.wobbleGain.gain.value = 6.0;
  }

  setMix(m: Partial<MixSettings>): void {
    this.mix = { ...this.mix, ...m };
    this.applyMix();
  }

  getMix(): MixSettings {
    return { ...this.mix };
  }

  cycleEcho(): void {
    this.mix.echo = this.mix.echo >= 0.85 ? 0 : this.mix.echo + 0.17;
    this.applyMix();
  }

  cycleReverb(): void {
    this.mix.reverb = this.mix.reverb >= 0.85 ? 0 : this.mix.reverb + 0.17;
    this.applyMix();
  }

  cycleAttack(): void {
    this.mix.attack = this.mix.attack >= 0.85 ? 0 : this.mix.attack + 0.17;
    this.applyMix();
  }

  nudgeMix(key: keyof MixSettings, dir: 1 | -1): void {
    const step = 0.17;
    const cur = this.mix[key];
    const next = dir > 0 ? (cur >= 0.85 ? 0 : cur + step) : cur <= 0 ? 0.85 : cur - step;
    this.mix[key] = Math.round(next * 100) / 100;
    this.applyMix();
  }

  private liveVoices = new Map<
    number,
    { gain: GainNode; stop: () => void }
  >();
  private playbackVoiceSeq = 1;

  /** Gate a note — holds until noteOff, or until releaseAt when scheduled for playback. */
  noteOn(
    voiceId: number,
    midi: number,
    velocity: number,
    preset: SynthPreset | BassPreset,
    isBass: boolean,
    detuneCents = 0,
    tone = 0.65,
    when?: number,
    releaseAt?: number,
  ): void {
    this.noteOff(voiceId);
    const ctx = this.ensure();
    const bus = isBass ? this.bassBus! : this.synthBus!;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const v = clamp(velocity, 0, 1);
    const t0 = when ?? nowSec(ctx);
    const attack = this.attackSec(preset as SynthPreset);
    const oscStop = releaseAt !== undefined ? releaseAt + 0.15 : undefined;

    const osc = ctx.createOscillator();
    osc.type = preset === 'fm' || preset === 'bell' ? 'sine' : this.oscType(preset);
    osc.detune.value = detuneCents;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = isBass || preset === 'piano' ? 'lowpass' : preset === 'guitar' ? 'bandpass' : 'lowpass';
    const baseCutoff = isBass
      ? 180
      : preset === 'sax'
        ? 1200
        : preset === 'guitar'
          ? 900
          : preset === 'piano'
            ? 2800
            : preset === 'chip'
              ? 2200
              : preset === 'brass'
                ? 2800
                : 400;
    const toneMul = isBass ? 800 : preset === 'lofi' ? 1800 : 4200;
    filter.frequency.value = baseCutoff + tone * toneMul;
    filter.Q.value =
      preset === 'pluck' || preset === 'guitar'
        ? 2.8
        : preset === 'wobble' || preset === 'acid'
          ? 5
          : preset === 'sax'
            ? 3.5
            : 0.7 + tone * 0.8;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    const peak = isBass
      ? 0.28 * v
      : preset === 'piano'
        ? 0.24 * v
        : preset === 'organ'
          ? 0.19 * v
          : 0.21 * v;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (releaseAt !== undefined) {
      const releaseStart = Math.max(t0 + attack, releaseAt - 0.12);
      gain.gain.setValueAtTime(peak, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);
    }

    const stoppers: Array<{ stop: () => void }> = [];
    const reg = (node: OscillatorNode | AudioBufferSourceNode) => {
      node.start(t0);
      if (oscStop !== undefined) {
        try {
          node.stop(oscStop);
        } catch {
          /* already stopped */
        }
      }
      stoppers.push({
        stop: () => {
          try {
            node.stop();
          } catch {
            /* already stopped */
          }
        },
      });
    };

    reg(osc);

    if (preset === 'piano') {
      for (const mult of [2, 3]) {
        const h = ctx.createOscillator();
        h.type = 'sine';
        h.frequency.value = freq * mult;
        const hg = ctx.createGain();
        hg.gain.value = (mult === 2 ? 0.12 : 0.06) * v;
        h.connect(hg);
        hg.connect(gain);
        reg(h);
      }
    }

    if (preset === 'organ') {
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.08 * v;
      o2.connect(g2);
      g2.connect(gain);
      reg(o2);
    }

    if (preset === 'sax' || preset === 'brass') {
      const vib = ctx.createOscillator();
      const vibG = ctx.createGain();
      vib.frequency.value = preset === 'sax' ? 5.5 : 4.2;
      vibG.gain.value = preset === 'sax' ? 8 : 5;
      vib.connect(vibG);
      vibG.connect(osc.detune);
      reg(vib);
    }

    if (preset === 'wobble' && isBass) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 3.2;
      lfoGain.gain.value = 400;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      reg(lfo);
    }

    if (preset === 'acid' && isBass) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 2.4;
      lfoGain.gain.value = 600;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      reg(lfo);
    }

    this.liveVoices.set(voiceId, {
      gain,
      stop: () => {
        for (const s of stoppers) s.stop();
      },
    });
  }

  noteOff(voiceId: number): void {
    const voice = this.liveVoices.get(voiceId);
    if (!voice) return;
    this.liveVoices.delete(voiceId);
    const ctx = this.ensure();
    const t = nowSec(ctx);
    voice.gain.gain.cancelScheduledValues(t);
    const level = Math.max(voice.gain.gain.value, 0.0001);
    voice.gain.gain.setValueAtTime(level, t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    window.setTimeout(() => {
      voice.stop();
    }, 130);
  }

  noteOffAll(): void {
    for (const id of [...this.liveVoices.keys()]) this.noteOff(id);
  }

  /** Clear delay feedback buildup between looped hook playbacks. */
  resetDelayFeedback(): void {
    if (!this.ctx || !this.delayFeedback) return;
    const t = this.ctx.currentTime;
    this.delayFeedback.gain.cancelScheduledValues(t);
    this.delayFeedback.gain.setValueAtTime(0, t);
    this.delayFeedback.gain.linearRampToValueAtTime(0.12 + this.mix.echo * 0.28, t + 0.05);
  }

  private playbackMixRestore: MixSettings | null = null;
  private playbackGainRestore: { lead: number; bass: number; drum: number } | null = null;
  private playbackVoiceGainRestore: number | null = null;
  private limiterRestore: { threshold: number; ratio: number } | null = null;
  private recordingMonitorRestore: {
    delayWet: number;
    delayFeedback: number;
    reverbWet: number;
    synthFx: number;
    bassFx: number;
    masterGain: number;
  } | null = null;

  /** Silence scheduled hook/monitor playback without tearing down mix state (pause). */
  mutePlaybackStems(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (const bus of [this.synthBus, this.bassBus, this.drumBus, this.voiceBus]) {
      if (!bus) continue;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(0, t);
    }
  }

  /** Restore stem levels after pauseHookPlayback. */
  unmutePlaybackStems(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const gains = this.playbackGainRestore;
    if (this.synthBus) {
      this.synthBus.gain.cancelScheduledValues(t);
      this.synthBus.gain.setValueAtTime(gains?.lead ?? this.synthBus.gain.value, t);
    }
    if (this.bassBus) {
      this.bassBus.gain.cancelScheduledValues(t);
      this.bassBus.gain.setValueAtTime(gains?.bass ?? this.bassBus.gain.value, t);
    }
    if (this.drumBus) {
      this.drumBus.gain.cancelScheduledValues(t);
      this.drumBus.gain.setValueAtTime(gains?.drum ?? this.drumBus.gain.value, t);
    }
    if (this.voiceBus && this.playbackVoiceGainRestore !== null) {
      this.voiceBus.gain.cancelScheduledValues(t);
      this.voiceBus.gain.setValueAtTime(this.playbackVoiceGainRestore, t);
    }
  }

  /** Restore live stem levels after review/monitor playback or an abort. */
  restoreLiveStemGains(lead: number, bass: number, drum: number): void {
    if (this.synthBus) this.synthBus.gain.value = clamp(lead, 0, 1);
    if (this.bassBus) this.bassBus.gain.value = clamp(bass, 0, 1);
    if (this.drumBus) this.drumBus.gain.value = clamp(drum, 0, 1);
    if (this.drumFxSend) this.drumFxSend.gain.value = 0;
  }

  beginHookPlayback(opts?: {
    gains?: { lead: number; bass: number; drum: number };
    review?: boolean;
    hasVoice?: boolean;
  }): void {
    this.noteOffAll();
    this.stopVoice();
    this.flushFxTails();
    if (!this.playbackMixRestore) {
      this.playbackMixRestore = { ...this.mix };
    }
    if (opts?.gains) {
      this.playbackGainRestore = {
        lead: clamp(opts.gains.lead, 0, 1),
        bass: clamp(opts.gains.bass, 0, 1),
        drum: clamp(opts.gains.drum, 0, 1),
      };
    } else if (!this.playbackGainRestore) {
      this.playbackGainRestore = {
        lead: this.synthBus?.gain.value ?? 0.78,
        bass: this.bassBus?.gain.value ?? 0.74,
        drum: this.drumBus?.gain.value ?? 0.72,
      };
    }
    if (!this.playbackFxSendRestore) {
      this.playbackFxSendRestore = {
        synth: this.synthFxSend?.gain.value ?? 0.38,
        bass: this.bassFxSend?.gain.value ?? 0.38,
        drum: this.drumFxSend?.gain.value ?? 0.38,
        voiceDelay: this.voiceDelaySend?.gain.value ?? 0.8,
        voiceReverb: this.voiceReverbSend?.gain.value ?? 0.8,
      };
    }
    if (this.wobbleGain) this.wobbleGain.gain.value = 0;
    const mix = this.playbackMixRestore ?? this.mix;
    const review = opts?.review ?? false;
    const dryReview = review;
    const echoMul = dryReview ? 0 : 0.75;
    const revMul = dryReview ? 0 : 0.7;
    const fbBase = dryReview ? 0 : 0.08;
    const fbEcho = dryReview ? 0 : 0.22;
    const stemEcho = dryReview ? 0 : 0.22;
    const stemEchoRange = dryReview ? 0 : 0.12;
    const stemBassEcho = dryReview ? 0 : 0.18;
    const stemBassRange = dryReview ? 0 : 0.1;
    const gainBoost = dryReview ? 1.22 : 1;
    if (review && this.limiter) {
      if (!this.limiterRestore) {
        this.limiterRestore = {
          threshold: this.limiter.threshold.value,
          ratio: this.limiter.ratio.value,
        };
      }
      this.limiter.threshold.value = -2.5;
      this.limiter.ratio.value = 5;
    }
    if (review && this.voiceBus) {
      if (this.playbackVoiceGainRestore === null) {
        this.playbackVoiceGainRestore = this.voiceBus.gain.value;
      }
      const voxMix = clamp(this.mix.vox, 0, 1);
      this.voiceBus.gain.value = opts?.hasVoice ? 0.22 + voxMix * 0.28 : 0.32 + voxMix * 0.38;
    }
    if (review && opts?.hasVoice && this.voiceInputHpf) {
      if (this.voiceHpfRestoreHz === null) {
        this.voiceHpfRestoreHz = this.voiceInputHpf.frequency.value;
      }
      // Cut room bleed of kick/bass from the mic track so stems stay single.
      this.voiceInputHpf.frequency.value = 320;
    }
    if (this.delayWet) this.delayWet.gain.value = mix.echo * echoMul;
    if (this.reverbWet) this.reverbWet.gain.value = mix.reverb * revMul;
    if (this.delayFeedback) this.delayFeedback.gain.value = fbBase + mix.echo * fbEcho;
    if (this.synthFxSend) this.synthFxSend.gain.value = stemEcho + mix.echo * stemEchoRange;
    if (this.bassFxSend) this.bassFxSend.gain.value = stemBassEcho + mix.echo * stemBassRange;
    if (this.drumFxSend) this.drumFxSend.gain.value = 0;
    if (this.voiceDelaySend) this.voiceDelaySend.gain.value = 0;
    if (this.voiceReverbSend) this.voiceReverbSend.gain.value = 0;
    if (this.synthBus) this.synthBus.gain.value = this.playbackGainRestore.lead * gainBoost;
    if (this.bassBus) this.bassBus.gain.value = this.playbackGainRestore.bass * gainBoost;
    if (this.drumBus) this.drumBus.gain.value = this.playbackGainRestore.drum * gainBoost;
  }

  /** Cut review/monitor playback immediately — cancels scheduled hits still in the queue. */
  abortHookPlayback(liveGains?: { lead: number; bass: number; drum: number }): void {
    const ctx = this.ctx;
    const t = ctx ? ctx.currentTime : 0;
    this.noteOffAll();
    this.stopVoice();
    for (const bus of [this.synthBus, this.bassBus, this.drumBus, this.voiceBus]) {
      if (!bus) continue;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(0, t);
    }
    this.endHookPlayback();
    if (liveGains) {
      this.restoreLiveStemGains(liveGains.lead, liveGains.bass, liveGains.drum);
    } else if ((this.synthBus?.gain.value ?? 1) < 0.01) {
      this.restoreLiveStemGains(0.78, 0.74, 0.72);
    }
  }

  endHookPlayback(): void {
    this.noteOffAll();
    this.stopVoice();
    if (this.wobbleGain) this.wobbleGain.gain.value = 6.0;
    if (this.playbackFxSendRestore) {
      if (this.synthFxSend) this.synthFxSend.gain.value = this.playbackFxSendRestore.synth;
      if (this.bassFxSend) this.bassFxSend.gain.value = this.playbackFxSendRestore.bass;
      if (this.drumFxSend) this.drumFxSend.gain.value = 0;
      if (this.voiceDelaySend) this.voiceDelaySend.gain.value = this.playbackFxSendRestore.voiceDelay;
      if (this.voiceReverbSend) this.voiceReverbSend.gain.value = this.playbackFxSendRestore.voiceReverb;
      this.playbackFxSendRestore = null;
    }
    this.resetDelayFeedback();
    if (this.playbackGainRestore) {
      if (this.synthBus) this.synthBus.gain.value = this.playbackGainRestore.lead;
      if (this.bassBus) this.bassBus.gain.value = this.playbackGainRestore.bass;
      if (this.drumBus) this.drumBus.gain.value = this.playbackGainRestore.drum;
      this.playbackGainRestore = null;
    }
    if (this.playbackMixRestore) {
      this.setMix(this.playbackMixRestore);
      this.playbackMixRestore = null;
    }
    if (this.playbackVoiceGainRestore !== null && this.voiceBus) {
      this.voiceBus.gain.value = this.playbackVoiceGainRestore;
      this.playbackVoiceGainRestore = null;
    }
    if (this.limiterRestore && this.limiter) {
      this.limiter.threshold.value = this.limiterRestore.threshold;
      this.limiter.ratio.value = this.limiterRestore.ratio;
      this.limiterRestore = null;
    }
    if (this.voiceHpfRestoreHz !== null && this.voiceInputHpf) {
      this.voiceInputHpf.frequency.value = this.voiceHpfRestoreHz;
      this.voiceHpfRestoreHz = null;
    }
  }

  private flushFxTails(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.delayFeedback) {
      this.delayFeedback.gain.cancelScheduledValues(t);
      this.delayFeedback.gain.setValueAtTime(0, t);
    }
    if (this.delayWet) {
      this.delayWet.gain.cancelScheduledValues(t);
      this.delayWet.gain.setValueAtTime(0, t);
    }
    if (this.reverbWet) {
      this.reverbWet.gain.cancelScheduledValues(t);
      this.reverbWet.gain.setValueAtTime(0, t);
    }
  }

  private applyMix(): void {
    if (this.delayWet) this.delayWet.gain.value = this.mix.echo;
    if (this.delayFeedback) this.delayFeedback.gain.value = 0.15 + this.mix.echo * 0.45;
    if (this.reverbWet) this.reverbWet.gain.value = this.mix.reverb;
    if (this.delay) this.delay.delayTime.value = 0.14 + this.mix.echo * 0.28;
    if (this.voiceBus) this.voiceBus.gain.value = 0.45 + clamp(this.mix.vox, 0, 1) * 0.75;
    if (this.drumFxSend) this.drumFxSend.gain.value = 0;
  }

  prepareForRecording(): void {
    this.noteOffAll();
    this.stopVoice();
    if (this.playbackMixRestore || this.playbackFxSendRestore) {
      this.endHookPlayback();
    } else {
      this.resetDelayFeedback();
    }
  }

  /** Dry instrument monitoring while recording — no delay/reverb on keys/bass. */
  beginRecordingMonitor(): void {
    if (this.recordingMonitorRestore) return;
    this.noteOffAll();
    this.flushFxTails();
    this.recordingMonitorRestore = {
      delayWet: this.delayWet?.gain.value ?? 0,
      delayFeedback: this.delayFeedback?.gain.value ?? 0,
      reverbWet: this.reverbWet?.gain.value ?? 0,
      synthFx: this.synthFxSend?.gain.value ?? 0,
      bassFx: this.bassFxSend?.gain.value ?? 0,
      masterGain: this.master?.gain.value ?? 0.84,
    };
    if (this.delayWet) this.delayWet.gain.value = 0;
    if (this.delayFeedback) this.delayFeedback.gain.value = 0;
    if (this.reverbWet) this.reverbWet.gain.value = 0;
    if (this.synthFxSend) this.synthFxSend.gain.value = 0;
    if (this.bassFxSend) this.bassFxSend.gain.value = 0;
    if (this.drumFxSend) this.drumFxSend.gain.value = 0;
    if (this.master) this.master.gain.value = 0.68;
  }

  endRecordingMonitor(): void {
    if (!this.recordingMonitorRestore) return;
    const snap = this.recordingMonitorRestore;
    this.recordingMonitorRestore = null;
    if (this.delayWet) this.delayWet.gain.value = snap.delayWet;
    if (this.delayFeedback) this.delayFeedback.gain.value = snap.delayFeedback;
    if (this.reverbWet) this.reverbWet.gain.value = snap.reverbWet;
    if (this.synthFxSend) this.synthFxSend.gain.value = snap.synthFx;
    if (this.bassFxSend) this.bassFxSend.gain.value = snap.bassFx;
    if (this.drumFxSend) this.drumFxSend.gain.value = 0;
    if (this.master) this.master.gain.value = snap.masterGain;
  }

  cycleVoxFx(): 'dry' | 'echo' | 'verb' | 'space' {
    const order: Array<'dry' | 'echo' | 'verb' | 'space'> = ['dry', 'echo', 'verb', 'space'];
    const idx = order.indexOf(this.voxFx);
    this.voxFx = order[(idx + 1) % order.length]!;
    this.applyVoxFx();
    return this.voxFx;
  }

  getVoxFx(): 'dry' | 'echo' | 'verb' | 'space' {
    return this.voxFx;
  }

  private applyVoxFx(): void {
    if (!this.voiceDelaySend || !this.voiceReverbSend) return;
    const set = (d: number, r: number) => {
      this.voiceDelaySend!.gain.value = clamp(d, 0, 1);
      this.voiceReverbSend!.gain.value = clamp(r, 0, 1);
    };
    switch (this.voxFx) {
      case 'dry':
        set(0, 0);
        break;
      case 'echo':
        set(1, 0.25);
        break;
      case 'verb':
        set(0.2, 1);
        break;
      case 'space':
        set(0.8, 0.8);
        break;
    }
  }

  setDrumGain(g: number): void {
    if (this.drumBus) this.drumBus.gain.value = clamp(g, 0, 1);
  }

  setLeadGain(g: number): void {
    if (this.synthBus) this.synthBus.gain.value = clamp(g, 0, 1);
  }

  setBassGain(g: number): void {
    if (this.bassBus) this.bassBus.gain.value = clamp(g, 0, 1);
  }

  setDrumKit(kit: DrumKit): void {
    this.drumKit = kit;
  }

  setVibe(v: number): void {
    const vibe = clamp(v, 0, 1);
    this.setMix({
      echo: 0.1 + vibe * 0.22,
      reverb: 0.1 + vibe * 0.2,
      attack: 0.25 + vibe * 0.25,
    });
  }

  playMelody(
    midi: number,
    velocity: number,
    preset: SynthPreset,
    detuneCents: number,
    tone: number,
    duration: number,
    when?: number,
  ): void {
    const ctx = this.ensure();
    const t0 = when ?? nowSec(ctx);
    const voiceId = 1_000_000 + this.playbackVoiceSeq++;
    this.noteOn(voiceId, midi, velocity, preset, false, detuneCents, tone, t0, t0 + duration);
  }

  playBass(
    midi: number,
    velocity: number,
    preset: BassPreset,
    duration: number,
    _gain = 0.85,
    when?: number,
  ): void {
    const ctx = this.ensure();
    const t0 = when ?? nowSec(ctx);
    const voiceId = 1_000_000 + this.playbackVoiceSeq++;
    this.noteOn(voiceId, midi, velocity, preset, true, 0, 0.35, t0, t0 + duration);
  }

  private attackSec(preset: SynthPreset | BassPreset): number {
    const base =
      preset === 'pluck' || preset === 'guitar' || preset === 'piano'
        ? 0.002
        : preset === 'strings' || preset === 'flute'
          ? 0.08
          : preset === 'sax' || preset === 'brass'
            ? 0.04
            : 0.012;
    return base + this.mix.attack * 0.12;
  }

  private oscType(preset: SynthPreset | BassPreset): OscillatorType {
    if (preset === 'saw' || preset === 'brass' || preset === 'sax' || preset === 'strings' || preset === 'guitar')
      return 'sawtooth';
    if (preset === 'triangle' || preset === 'warm' || preset === 'lofi' || preset === 'flute') return 'triangle';
    if (preset === 'bell' || preset === 'fm' || preset === 'sub' || preset === 'piano') return 'sine';
    if (preset === 'acid') return 'square';
    return 'square';
  }

  drumHit(sound: DrumSound, gainMul = 1, when?: number): void {
    const ctx = this.ensure();
    const bus = this.drumBus!;
    const t0 = when ?? nowSec(ctx);
    const kit = this.drumKit;

    if (sound === 'kick') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      const startF = kit === 'classic' ? 105 : kit === '909' ? 160 : kit === 'electro' ? 180 : kit === 'lofi' ? 110 : 140;
      const endF = kit === 'classic' ? 42 : kit === '909' ? 48 : kit === 'electro' ? 42 : kit === 'lofi' ? 55 : 52;
      const kickDecay = kit === 'classic' ? 0.22 : 0.14;
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.exponentialRampToValueAtTime(endF, t0 + (kit === 'classic' ? 0.07 : 0.11));
      const amp = kit === 'lofi' ? 0.7 : kit === 'electro' ? 1.0 : kit === 'classic' ? 0.95 : 0.9;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp * gainMul, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + kickDecay);
      osc.connect(g);
      g.connect(bus);
      osc.start(t0);
      osc.stop(t0 + kickDecay + 0.02);

      // Acoustic kicks have a beater click on top of the thump
      if (kit === 'classic') {
        const clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.015), ctx.sampleRate);
        const cd = clickBuf.getChannelData(0);
        for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
        const click = ctx.createBufferSource();
        click.buffer = clickBuf;
        const cf = ctx.createBiquadFilter();
        cf.type = 'highpass';
        cf.frequency.value = 2500;
        const cg = ctx.createGain();
        cg.gain.value = 0.3 * gainMul;
        click.connect(cf);
        cf.connect(cg);
        cg.connect(bus);
        click.start(t0);
        click.stop(t0 + 0.02);
      }
      return;
    }

    // Acoustic snare: tuned drum-body tone underneath the noise crack
    if (sound === 'snare' && kit === 'classic') {
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(220, t0);
      body.frequency.exponentialRampToValueAtTime(160, t0 + 0.08);
      const bodyG = ctx.createGain();
      bodyG.gain.setValueAtTime(0.0001, t0);
      bodyG.gain.linearRampToValueAtTime(0.32 * gainMul, t0 + 0.003);
      bodyG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      body.connect(bodyG);
      bodyG.connect(bus);
      body.start(t0);
      body.stop(t0 + 0.14);
      // The noise part continues below with classic-tuned filter values.
    }

    const len = sound === 'hat' ? (kit === 'classic' ? 0.14 : 0.1) : kit === 'classic' ? 0.24 : 0.18;
    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    const noiseCurve = kit === 'lofi' ? 2.2 : kit === 'classic' ? 1.2 : 1.6;
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, noiseCurve);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = sound === 'hat' ? 'highpass' : 'bandpass';
    filter.frequency.value =
      sound === 'hat'
        ? kit === 'classic'
          ? 8200
          : kit === '909'
            ? 7500
            : 6500
        : sound === 'clap'
          ? kit === 'classic'
            ? 2600
            : kit === 'lofi'
              ? 1800
              : 2200
          : kit === 'classic'
            ? 2800
            : kit === '909'
              ? 2000
              : 1800;
    filter.Q.value = sound === 'hat' ? (kit === 'classic' ? 0.5 : 0.7) : kit === 'classic' ? 0.8 : 1.2;

    const g = ctx.createGain();
    const amp =
      sound === 'snare'
        ? kit === 'classic'
          ? 0.5
          : kit === '909'
            ? 0.62
            : kit === 'lofi'
              ? 0.42
              : 0.55
        : sound === 'clap'
          ? kit === 'classic'
            ? 0.4
            : 0.45
          : kit === 'classic'
            ? 0.2
            : 0.25;
    const tail = sound === 'hat' ? (kit === 'classic' ? 0.09 : 0.06) : kit === 'classic' ? 0.19 : 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(amp * gainMul, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + tail);

    src.connect(filter);
    filter.connect(g);
    g.connect(bus);
    src.start(t0);
    src.stop(t0 + len + 0.05);
  }

  async preloadVoice(track: VoiceTrack): Promise<void> {
    const ctx = this.ensure();
    const res = await fetch(`data:${track.mime};base64,${track.data}`);
    this.voiceBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
    this.voiceTrack = track;
  }

  playVoice(track: VoiceTrack, when?: number, offsetSec = 0): void {
    this.stopVoiceSource();
    this.voiceTrack = track;
    void this.ensureVoiceBuffer(track).then(() => {
      const ctx = this.ensure();
      const startAt = when ?? ctx.currentTime + 0.02;
      this.startVoiceAt(startAt, offsetSec);
    });
  }

  private async ensureVoiceBuffer(track: VoiceTrack): Promise<AudioBuffer> {
    if (!this.voiceBuffer || this.voiceTrack?.data !== track.data) {
      await this.preloadVoice(track);
    }
    if (!this.voiceBuffer) throw new Error('voice decode failed');
    return this.voiceBuffer;
  }

  private startVoiceAt(when: number, offsetSec: number): void {
    const ctx = this.ensure();
    const bus = this.voiceBus;
    if (!bus || !this.voiceBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.voiceBuffer;
    src.connect(bus);
    const startAt = Math.max(ctx.currentTime + 0.01, when);
    this.voiceOffsetSec = offsetSec;
    this.voiceStartCtxTime = startAt;
    src.start(startAt, offsetSec);
    this.voiceSource = src;
    src.onended = () => {
      if (this.voiceSource === src) this.voiceSource = null;
    };
  }

  pauseVoicePlayback(): number {
    if (!this.voiceSource || !this.ctx) return this.voiceOffsetSec;
    const elapsed = this.voiceOffsetSec + Math.max(0, this.ctx.currentTime - this.voiceStartCtxTime);
    this.voiceOffsetSec = elapsed;
    this.stopVoiceSource();
    return this.voiceOffsetSec;
  }

  resumeVoicePlayback(): void {
    if (!this.voiceTrack) return;
    void this.ensureVoiceBuffer(this.voiceTrack).then(() => {
      this.startVoiceAt(this.ensure().currentTime + 0.02, this.voiceOffsetSec);
    });
  }

  private stopVoiceSource(): void {
    if (this.voiceSource) {
      try {
        this.voiceSource.stop();
      } catch {
        /* already stopped */
      }
      this.voiceSource = null;
    }
  }

  stopVoice(): void {
    this.stopVoiceSource();
    this.voiceTrack = null;
    this.voiceBuffer = null;
    this.voiceOffsetSec = 0;
    this.voiceStartCtxTime = 0;
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const amp = Math.pow(1 - t, 2.0) * Math.exp(-decay * t * 6);
        data[i] = (Math.random() * 2 - 1) * amp;
      }
    }
    return impulse;
  }
}
