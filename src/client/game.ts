import { showToast } from '@devvit/web/client';
import type {
  ActionResponse,
  DrumHitEvent,
  DrumSound,
  HookData,
  HookPreview,
  InitResponse,
  MixSettings,
  NoteEvent,
  PlayerState,
} from '../shared/api';
import { MAX_RECORD_SEC } from '../shared/api';
import type { BassPreset, DrumKit, SynthPreset } from '../shared/synth';
import {
  bassPresetLabel,
  drumKitLabel,
  leadPresetLabel,
  nextBassPreset,
  nextDrumKit,
  nextLeadPreset,
  prevBassPreset,
  prevDrumKit,
  prevLeadPreset,
} from '../shared/synth';
import {
  DRUM_PATTERNS,
  drumPatternLabel,
  nextDrumPattern,
  prevDrumPattern,
  type DrumPatternName,
} from '../shared/drum-patterns';
import { AudioEngine } from './audio-engine';
import { closeComposeInstruments, openComposeArm, type ComposePanelMounts } from './compose-panels';
import { Studio3D, type NoteSource } from './studio-3d';
import { mountTour } from './studio-tour';
import { mountTouchKeys } from './touch-keys';
import { mountTouchDrums } from './touch-drums';
import { mountTouchConsole } from './touch-console';
import { mountPanelToggleIcons } from './panel-icons';
import { HookRecorder, type InstrumentTake } from './hook-recorder';
import {
  classifyLayer,
  findLayerForArm,
  flattenSession,
  layerArmLabel,
  MAX_TRACK_LAYERS,
  mountMultitrackPanel,
  sessionMaxEventSec,
  type BackingTrackChip,
  type LayerArm,
  type MultitrackSession,
  type RecordedLayer,
} from './multitrack-ui';

const MIN_RECORD_SEC = 0.4;
/** Default multitrack canvas — 8 bars @ 120 BPM. Grows with content up to MAX_RECORD_SEC. */
const DEFAULT_SESSION_SEC = 16;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function humanizeVel(base: number, spread: number): number {
  return clamp(base + (Math.random() * 2 - 1) * spread, 0.35, 1);
}

function captureVelocity(pressure: number | undefined, base: number, spread: number): number {
  if (typeof pressure === 'number' && pressure > 0 && Math.abs(pressure - 0.5) > 0.001) {
    return clamp(0.45 + pressure * 0.55, 0.4, 1);
  }
  return humanizeVel(base, spread);
}

function drumStepVelocity(step: number, stepsPerBar: number, sound: DrumSound, gain: number): number {
  const quarter = Math.max(1, Math.round(stepsPerBar / 4));
  const eighth = Math.max(1, Math.round(quarter / 2));
  const onQuarter = step % quarter === 0;
  const onEighth = step % eighth === 0;
  let accent: number;
  if (sound === 'hat') accent = onQuarter ? 1 : step % 2 === 0 ? 0.8 : 0.62;
  else if (sound === 'clap') accent = onQuarter ? 1 : 0.82;
  else accent = onQuarter ? 1.06 : onEighth ? 0.9 : 0.74;
  const jitter = (Math.random() * 2 - 1) * 0.05;
  return clamp(gain * (accent + jitter), 0.15, 1.15);
}

async function apiInit(): Promise<InitResponse> {
  const res = await fetch('/api/init');
  if (!res.ok) throw new Error(`init failed (${res.status})`);
  return (await res.json()) as InitResponse;
}

async function apiSubmitHook(hook: HookData): Promise<ActionResponse> {
  const res = await fetch('/api/submit-hook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `submit failed (${res.status})`);
  }
  return (await res.json()) as ActionResponse;
}

async function apiVote(hookId: string): Promise<ActionResponse> {
  const res = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hookId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `vote failed (${res.status})`);
  }
  return (await res.json()) as ActionResponse;
}

async function apiGetHook(hookId: string): Promise<HookData> {
  const res = await fetch(`/api/hook/${encodeURIComponent(hookId)}`);
  if (!res.ok) throw new Error(`hook fetch failed (${res.status})`);
  const data = (await res.json()) as { hook: HookData };
  return data.hook;
}

function renderReveal(reveal: InitResponse['prevReveal']): void {
  const banner = el<HTMLDivElement>('reveal-banner');
  if (!reveal) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const winners = reveal.coWinners
    .slice(0, 3)
    .map((w) => `u/${w.authorUsername}`)
    .join(', ');
  banner.classList.remove('hidden');
  banner.innerHTML = `<strong>Yesterday winner(s) · ${reveal.topUpvotes} votes</strong>${winners}`;
}

function renderHooks(list: HookPreview[]): void {
  const container = el<HTMLDivElement>('hooks-list');
  container.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hooks-empty';
    empty.textContent = 'No jingles yet today — be the first to drop one!';
    container.appendChild(empty);
    return;
  }
  for (const h of list) {
    const card = document.createElement('div');
    card.className = `hook-card${h.isMine ? ' you' : ''}`;

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'hook-title';
    title.textContent = h.title?.trim() ? h.title.trim() : `u/${h.authorUsername}`;
    const meta = document.createElement('div');
    meta.className = 'hook-meta';
    meta.textContent = h.title?.trim()
      ? `u/${h.authorUsername} · ${h.upvotes}▲`
      : `${h.upvotes}▲`;
    left.appendChild(title);
    left.appendChild(meta);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'hook-btn primary';
    playBtn.textContent = 'Play';
    playBtn.dataset.action = 'play';
    playBtn.dataset.hookId = h.hookId;

    const voteBtn = document.createElement('button');
    voteBtn.type = 'button';
    voteBtn.className = `hook-btn${h.isVoted ? ' primary' : ''}`;
    voteBtn.textContent = h.isVoted ? 'Voted' : 'Vote';
    voteBtn.dataset.action = 'vote';
    voteBtn.dataset.hookId = h.hookId;

    card.appendChild(left);
    card.appendChild(playBtn);
    card.appendChild(voteBtn);
    container.appendChild(card);
  }
}

function toast(msg: string): void {
  try {
    showToast(msg);
  } catch {
    /* local dev — Devvit toast unavailable */
  }
}

async function init(): Promise<void> {
  mountPanelToggleIcons();
  const dialogue = el<HTMLDivElement>('dialogue');
  const recStatus = el<HTMLDivElement>('rec-status');
  const applauseEl = el<HTMLDivElement>('applause');
  const hooksListEl = el<HTMLDivElement>('hooks-list');
  const hooksToggle = el<HTMLButtonElement>('hooks-toggle');
  const hooksBackdrop = el<HTMLDivElement>('hooks-backdrop');
  const hooksCloseBtn = el<HTMLButtonElement>('hooks-close-btn');
  const helpToggle = el<HTMLButtonElement>('help-toggle');
  const tourToggle = el<HTMLButtonElement>('tour-toggle');
  const helpOverlay = el<HTMLDivElement>('help-overlay');
  const helpPanel = el<HTMLDivElement>('help-panel');
  const tourOverlay = el<HTMLDivElement>('tour-overlay');
  const gearSynth = el<HTMLParagraphElement>('gear-synth');

  const studioRoot = el<HTMLDivElement>('studio-root');
  const studio = new Studio3D(studioRoot);
  studio.start();

  const audio = new AudioEngine();
  audio.setVibe(0.78);

  let player: PlayerState | null = null;
  let bpm = 120;
  let preset: SynthPreset = 'piano';
  let bassPreset: BassPreset = 'sub';
  let drumKit: DrumKit = 'classic';
  let drumPatternName: DrumPatternName = 'BLANK';
  let bassGain = 1;
  let leadGain = 1;
  let drumGain = 1;
  const detune = 0;
  const tone = 0.65;
  let drumsOn = true;
  /** User pressed ▶ on the drum machine — loop the current step pattern (preset or hand-drawn). */
  let patternPreviewPlaying = false;
  let sustainOn = false;
  const swing = 0;
  let submitted = false;
  let mix: MixSettings = { echo: 0.22, reverb: 0.18, attack: 0.35, vox: 0.55 };
  audio.setMix(mix);
  audio.setDrumKit(drumKit);
  audio.setLeadGain(leadGain);
  audio.setBassGain(bassGain);
  audio.setDrumGain(drumGain);
  const stepsPerBar = 16;
  const bars = 2;

  const pattern: HookData['drum']['pattern'] = {
    kick: Array.from({ length: stepsPerBar }, () => 0),
    snare: Array.from({ length: stepsPerBar }, () => 0),
    hat: Array.from({ length: stepsPerBar }, () => 0),
    clap: Array.from({ length: stepsPerBar }, () => 0),
  };

  let pendingHook: HookData | null = null;
  let transportTimer: number | null = null;
  let transportStartTimer: number | null = null;
  let previewTimers: number[] = [];
  let transportStep = 0;
  let recProgressTimer: number | null = null;
  let recMaxTimer: number | null = null;
  let recordElapsedSec = 0;
  let nextVoiceId = 0;
  const activeVoices = new Map<string, { voiceId: number }>();

  type HookPlaybackSession = {
    hook: HookData;
    restorePattern: boolean;
    patternSnap: Record<DrumSound, number[]>;
    startedAt: number;
    pausedAt: number | null;
    totalPausedMs: number;
    endTimerId: number | null;
    usingTransport: boolean;
    reviewUi: boolean;
    isOverdubMonitor?: boolean;
    previewArms?: LayerArm[];
  };

  type MultitrackSessionLocal = MultitrackSession;

  let hookPlayback: HookPlaybackSession | null = null;
  const reviewPlayBtn = el<HTMLButtonElement>('review-play');

  let mtSession: MultitrackSessionLocal | null = null;
  let overdubOn = !window.matchMedia('(pointer: coarse)').matches;
  let layerArm: LayerArm = 'drums';
  let overdubLoopActive = false;
  let overdubLoopPlaying = false;
  let reRecordArm: LayerArm | null = null;
  /** Layers muted from the auto-backing / mix loop (per-track ⏸ in the backing strip). */
  const backingMutedArms = new Set<LayerArm>();
  let mtPanelExpanded = false;
  let nextLayerId = 1;
  let multitrackPanel: ReturnType<typeof mountMultitrackPanel> | null = null;
  /** Studio tape REC = capture everything at once; layer REC = one multitrack slot. */
  let fullTakeRecording = false;

  let recTimeAnchor = 0;
  let recordingInstruments = false;
  const hookRecorder = new HookRecorder(() =>
    recordingInstruments ? Math.max(0, audio.ensure().currentTime - recTimeAnchor) : 0,
  );
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const DJ_WELCOME = 'DJ: Drop one jingle today — tap REC when you\'re ready.';

  /** Desktop-only DJ banner; on mobile use rec-status + toasts instead. */
  function setDialogue(text: string): void {
    dialogue.textContent = text;
    const hide = isCoarsePointer || text === DJ_WELCOME;
    dialogue.classList.toggle('hidden', hide);
    if (!isCoarsePointer) return;
    if (text === DJ_WELCOME || hookRecorder.active) return;
    toast(text.replace(/^DJ:\s*/, ''));
  }

  function shouldRecordLayer(layer: 'melody' | 'bass'): boolean {
    if (!hookRecorder.active) return false;
    if (fullTakeRecording || !overdubOn) return true;
    return layer === 'melody' ? layerArm === 'keys' : layerArm === 'bass';
  }

  function patternHasSteps(drum: HookData['drum']): boolean {
    for (const s of ['kick', 'snare', 'hat', 'clap'] as DrumSound[]) {
      if (drum.pattern[s]?.some((v) => v)) return true;
    }
    return false;
  }

  function livePatternHasSteps(): boolean {
    return patternHasSteps({ pattern, swing, gain: drumGain, kit: drumKit });
  }

  function mergeDrumPatterns(
    ...sources: Array<HookData['drum']['pattern'] | undefined>
  ): HookData['drum']['pattern'] {
    const merged = emptyDrumPattern();
    for (const src of sources) {
      if (!src) continue;
      for (const s of ['kick', 'snare', 'hat', 'clap'] as DrumSound[]) {
        for (let i = 0; i < stepsPerBar; i++) {
          if (src[s]?.[i]) merged[s][i] = 1;
        }
      }
    }
    return merged;
  }

  function drumPatternForSession(session: MultitrackSessionLocal): HookData['drum']['pattern'] {
    return mergeDrumPatterns(
      session.pattern,
      ...session.layers.map((l) => l.drumPattern),
    );
  }

  /** Capture sequencer hits during drums-layer and full-take recording. */
  function shouldCaptureTransportDrums(): boolean {
    if (!hookRecorder.active) return false;
    if (fullTakeRecording) return true;
    if (overdubOn && layerArm === 'drums') return true;
    return false;
  }

  function shouldSnapshotDrumPattern(): boolean {
    return layerArm === 'drums' || livePatternHasSteps();
  }

  function syncLiveInstrumentGains(): void {
    audio.restoreLiveStemGains(leadGain, bassGain, drumGain);
  }

  function recordDrumHit(sound: DrumSound, gainMul: number): void {
    audio.drumHit(sound, gainMul);
    if (shouldCaptureTransportDrums()) hookRecorder.drumHit(sound, gainMul);
  }

  function emptyDrumPattern(): HookData['drum']['pattern'] {
    const row = () => Array.from({ length: stepsPerBar }, () => 0);
    return { kick: row(), snare: row(), hat: row(), clap: row() };
  }

  /** Quantize captured drum hits into a step grid for pattern-based playback. */
  function patternFromDrumHits(hits: DrumHitEvent[]): HookData['drum']['pattern'] {
    const out = emptyDrumPattern();
    const stepSec = stepDurationSec();
    for (const hit of hits) {
      const step = Math.floor(hit.t / stepSec) % stepsPerBar;
      out[hit.sound][step] = 1;
    }
    return out;
  }

  function snapshotPatternCopy(): HookData['drum']['pattern'] {
    return {
      kick: [...pattern.kick],
      snare: [...pattern.snare],
      hat: [...pattern.hat],
      clap: [...pattern.clap],
    };
  }

  function sessionRecordCapSec(): number {
    return MAX_RECORD_SEC;
  }

  function updateSessionLoopSec(session: MultitrackSessionLocal, passSec?: number): void {
    const fromEvents = sessionMaxEventSec(session);
    const next = Math.max(DEFAULT_SESSION_SEC, fromEvents, passSec ?? 0);
    session.loopSec = Math.min(MAX_RECORD_SEC, next);
  }

  /** Build a hook from a chosen set of layers (drums only included when the drums arm is selected). */
  function buildHookFromArms(session: MultitrackSessionLocal, arms: LayerArm[]): HookData {
    const armSet = new Set(arms);
    const selected = session.layers.filter(
      (l) => l.kind !== 'mix' && armSet.has(l.kind as LayerArm),
    );
    const notes: NoteEvent[] = [];
    const bassNotes: NoteEvent[] = [];
    const drumHits: DrumHitEvent[] = [];
    let drumPattern = emptyDrumPattern();
    for (const layer of selected) {
      notes.push(...layer.notes);
      bassNotes.push(...layer.bassNotes);
      if (layer.kind === 'drums') {
        if (layer.drumPattern) drumPattern = mergeDrumPatterns(drumPattern, layer.drumPattern);
        drumHits.push(...layer.drumHits);
      }
    }
    if (armSet.has('drums') && !patternHasSteps({ pattern: drumPattern, swing, gain: drumGain, kit: drumKit })) {
      drumPattern = mergeDrumPatterns(drumPattern, session.pattern);
    }
    const usePattern = patternHasSteps({ pattern: drumPattern, swing, gain: drumGain, kit: drumKit });
    return {
      bpm,
      stepsPerBar,
      bars,
      synth: { preset, detune, tone, gain: leadGain },
      bass: { preset: bassPreset, gain: bassGain, notes: bassNotes },
      drum: {
        swing,
        pattern: drumPattern,
        gain: drumGain,
        kit: drumKit,
        ...(!usePattern && drumHits.length ? { hits: drumHits } : {}),
      },
      mix,
      notes,
      recordedSec: session.loopSec,
    };
  }

  /** Layers currently playing together in a per-track slot preview (empty for mix/review/none). */
  function previewPlaybackArms(): LayerArm[] {
    if (!hookPlayback?.previewArms || hookPlayback.isOverdubMonitor || hookPlayback.reviewUi) return [];
    return hookPlayback.previewArms;
  }

  /**
   * Per-track ▶ toggles that layer in/out of a single synchronized preview so
   * drums, keys, and bass can play together. While recording we keep the old
   * single-layer monitor behaviour so the take flow is untouched.
   */
  function toggleLayerPreview(arm: LayerArm): void {
    if (!mtSession) return;
    if (hookRecorder.active && arm === layerArm) {
      toast('Finish this take before previewing it');
      return;
    }
    const layer = findLayerForArm(mtSession, arm);
    if (!layer) {
      toast(`No ${layerArmLabel(arm).toLowerCase()} layer yet`);
      return;
    }

    const recording = hookRecorder.active;
    const current = new Set(previewPlaybackArms());
    const mixPlaying = !recording && overdubLoopPlaying && !!hookPlayback?.isOverdubMonitor;
    if (mixPlaying) {
      for (const l of mtSession.layers) {
        if (l.kind !== 'mix' && !backingMutedArms.has(l.kind as LayerArm)) {
          current.add(l.kind as LayerArm);
        }
      }
    }
    const wasPlayingThis = current.has(arm) && hookPlayback?.pausedAt === null;

    if (current.has(arm)) {
      current.delete(arm);
    } else {
      if (recording) current.clear(); // solo the monitored layer while recording
      current.add(arm);
    }

    const arms = mtSession.layers
      .map((l) => l.kind)
      .filter((k): k is LayerArm => k !== 'mix' && current.has(k as LayerArm));

    if (arms.length === 0) {
      // Turning the last track off stops the preview without disturbing the take.
      if (recording) stopMonitorPlaybackOnly();
      else {
        stopOverdubLoopPlayback();
        finishHookPlayback();
      }
      renderMultitrackPanel();
      setDialogue(wasPlayingThis ? 'DJ: Preview stopped.' : 'DJ: Nothing selected to play.');
      return;
    }

    if (!recording) {
      stopOverdubLoopPlayback();
      finishHookPlayback();
    }

    void playHook(buildHookFromArms(mtSession, arms), {
      restorePattern: false,
      reviewUi: false,
      isOverdubMonitor: false,
      previewArms: arms,
    });
    const names = arms.map((a) => layerArmLabel(a)).join(' + ');
    setDialogue(
      recording
        ? `DJ: Backing — ${names}. Keep recording your ${layerArmLabel(layerArm).toLowerCase()} take.`
        : `DJ: Playing ${names} — tap a track’s ▶ to add or remove it.`,
    );
  }

  function layerFlowHint(arm: LayerArm, hasTake: boolean): string {
    if (hasTake) {
      return `DJ: ${layerArmLabel(arm)} — tap ▶ to listen, ● Record to re-do, or Submit ✓ with what you have.`;
    }
    return `DJ: ${layerArmLabel(arm)} selected — tap ● Record on that track when ready.`;
  }
  function buildHookForOverdub(): HookData | null {
    if (!mtSession) return null;
    const excludeArm = hookRecorder.active && !fullTakeRecording ? layerArm : undefined;
    const layers = mtSession.layers.filter((l) => {
      if (l.kind === 'mix') return false;
      if (excludeArm && l.kind === excludeArm) return false;
      if (backingMutedArms.has(l.kind as LayerArm)) return false;
      return true;
    });
    if (layers.length === 0) return null;
    return buildHookFromSession({ ...mtSession, layers });
  }

  function backingTracksForUi(): BackingTrackChip[] {
    if (!mtSession) return [];
    const recording = hookRecorder.active && !fullTakeRecording;
    const excludeArm = recording ? layerArm : undefined;
    const mixActive = overdubLoopPlaying && !!hookPlayback?.isOverdubMonitor;
    const mixPaused = mixActive && hookPlayback!.pausedAt !== null;
    const chips: BackingTrackChip[] = [];
    let trackNum = 0;
    for (const layer of mtSession.layers) {
      if (layer.kind === 'mix') continue;
      const arm = layer.kind as LayerArm;
      if (excludeArm && arm === excludeArm) continue;
      trackNum += 1;
      const muted = backingMutedArms.has(arm);
      let status: BackingTrackChip['status'];
      if (muted) status = 'muted';
      else if (mixActive && !mixPaused) status = 'playing';
      else if (mixActive && mixPaused) status = 'paused';
      else status = 'idle';
      chips.push({ arm, trackNum, label: layerArmLabel(arm), status });
    }
    return chips;
  }

  function buildHookFromSession(session: MultitrackSessionLocal): HookData {
    const flat = flattenSession(session);
    let drumPattern = drumPatternForSession(session);
    if (!patternHasSteps({ pattern: drumPattern, swing, gain: drumGain, kit: drumKit }) && flat.drumHits.length) {
      drumPattern = patternFromDrumHits(flat.drumHits);
    }
    return {
      bpm,
      stepsPerBar,
      bars,
      synth: { preset, detune, tone, gain: leadGain },
      bass: { preset: bassPreset, gain: bassGain, notes: flat.bassNotes },
      drum: {
        swing,
        pattern: drumPattern,
        gain: drumGain,
        kit: drumKit,
        ...(flat.drumHits.length && !patternHasSteps({ pattern: drumPattern, swing, gain: drumGain, kit: drumKit })
          ? { hits: flat.drumHits }
          : {}),
      },
      mix,
      notes: flat.notes,
      recordedSec: session.loopSec,
      ...(flat.voice ? { voice: flat.voice } : {}),
    };
  }

  function createLayerFromPass(pass: InstrumentTake, passSec: number): RecordedLayer {
    const kind = classifyLayer(pass, layerArm);
    const snap = snapshotPatternCopy();
    const snapHasSteps = patternHasSteps({
      pattern: snap,
      swing,
      gain: drumGain,
      kit: drumKit,
    });
    const drumPattern =
      snapHasSteps && (layerArm === 'drums' || kind === 'drums' || shouldSnapshotDrumPattern())
        ? snap
        : (kind === 'drums' || layerArm === 'drums') && pass.drumHits.length
          ? patternFromDrumHits(pass.drumHits)
          : undefined;
    return {
      id: `L${nextLayerId++}`,
      kind,
      notes: pass.notes,
      bassNotes: pass.bassNotes,
      drumHits: [...pass.drumHits],
      ...(drumPattern ? { drumPattern } : {}),
      durationSec: passSec,
    };
  }

  function beginMultitrackSession(): MultitrackSessionLocal {
    if (!mtSession) {
      mtSession = {
        layers: [],
        loopSec: DEFAULT_SESSION_SEC,
        pattern: snapshotPatternCopy(),
      };
    }
    return mtSession;
  }

  function isAtMaxLayers(): boolean {
    if (!mtSession) return false;
    const filledSlots = new Set(
      mtSession.layers.map((l) => (l.kind === 'mix' ? null : l.kind)).filter(Boolean),
    );
    return filledSlots.size >= MAX_TRACK_LAYERS;
  }

  function upsertLayer(
    session: MultitrackSessionLocal,
    layer: RecordedLayer,
    passSec: number,
  ): boolean {
    if (layer.kind !== 'mix') {
      const idx = session.layers.findIndex((l) => l.kind === layer.kind);
      if (idx >= 0) {
        session.layers[idx] = layer;
        updateSessionLoopSec(session, passSec);
        return true;
      }
    }
    if (session.layers.length >= MAX_TRACK_LAYERS) return false;
    session.layers.push(layer);
    updateSessionLoopSec(session, passSec);
    return true;
  }

  function multitrackPanelVisible(): boolean {
    return overdubOn || !!mtSession || mtPanelExpanded || isCoarsePointer;
  }

  function useMultitrackLayerPicker(): boolean {
    return mtPanelExpanded && (overdubOn || isCoarsePointer);
  }

  function renderMultitrackPanel(): void {
    const show = multitrackPanelVisible();
    const backingTracks = backingTracksForUi();
    multitrackPanel?.setVisible(show);
    multitrackPanel?.render({
      session: mtSession,
      arm: layerArm,
      recording: hookRecorder.active && !fullTakeRecording,
      recordSec: recordElapsedSec,
      loopPlaying: overdubLoopPlaying,
      loopPaused: !!(overdubLoopPlaying && hookPlayback?.isOverdubMonitor && hookPlayback.pausedAt !== null),
      atMaxLayers: isAtMaxLayers() && !reRecordArm,
      reRecordArm,
      expanded: mtPanelExpanded,
      previewPlayingArms: hookPlayback?.pausedAt === null ? previewPlaybackArms() : [],
      previewPausedArms: hookPlayback?.pausedAt !== null ? previewPlaybackArms() : [],
      canSubmit: !!mtSession && mtSession.layers.length > 0 && !hookRecorder.active,
      backingTracks,
      showBackingStrip: backingTracks.length > 0,
    });
    syncComposeLayout();
  }

  function toggleMultitrackPanelExpanded(): void {
    mtPanelExpanded = !mtPanelExpanded;
    if (mtPanelExpanded) closeHooksDrawer();
    if (mtPanelExpanded && !mtSession) beginMultitrackSession();
    renderMultitrackPanel();
    if (mtPanelExpanded) {
      requestAnimationFrame(() => {
        el<HTMLDivElement>('multitrack-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }

  function expandMultitrackPanel(): void {
    if (!mtPanelExpanded) {
      closeHooksDrawer();
      mtPanelExpanded = true;
      renderMultitrackPanel();
    }
  }

  function removeLayer(layerId: string): void {
    if (!mtSession) return;
    const layer = mtSession.layers.find((l) => l.id === layerId);
    if (!layer) return;
    if (hookRecorder.active && layer.kind === layerArm) {
      toast("Can't remove the layer you're recording");
      return;
    }
    if (layer.kind !== 'mix') backingMutedArms.delete(layer.kind as LayerArm);
    const before = mtSession.layers.length;
    mtSession.layers = mtSession.layers.filter((l) => l.id !== layerId);
    if (mtSession.layers.length === before - 1) {
      toast('Layer removed');
    }
    reRecordArm = null;
    if (mtSession.layers.length === 0) {
      mtSession.loopSec = DEFAULT_SESSION_SEC;
      stopOverdubLoopPlayback();
      renderMultitrackPanel();
      return;
    }
    updateSessionLoopSec(mtSession);
    if (hookRecorder.active && !fullTakeRecording) {
      void restartOverdubLoopIfActive();
    } else if (overdubLoopPlaying && hookPlayback?.isOverdubMonitor) {
      void restartOverdubLoopIfActive();
    } else {
      stopOverdubLoopPlayback();
    }
    renderMultitrackPanel();
  }

  function selectLayer(arm: LayerArm): void {
    if (hookRecorder.active) return;
    stopOverdubLoopPlayback();
    finishHookPlayback();
    beginMultitrackSession();
    expandMultitrackPanel();
    layerArm = arm;
    reRecordArm = null;
    openInstrumentForArm(arm);
    renderMultitrackPanel();
  }

  /** Switch armed layer + instrument when multitrack is already expanded (top bar). */
  function switchMultitrackLayer(arm: LayerArm): void {
    if (hookRecorder.active) return;
    stopOverdubLoopPlayback();
    finishHookPlayback();
    layerArm = arm;
    reRecordArm = null;
    openInstrumentForArm(arm);
    renderMultitrackPanel();
  }

  function armForRecording(arm: LayerArm): void {
    selectLayer(arm);
  }

  function requestReRecord(arm: LayerArm): void {
    if (hookRecorder.active) return;
    selectLayer(arm);
    reRecordArm = arm;
    renderMultitrackPanel();
    setDialogue(`DJ: Re-recording ${layerArmLabel(arm)} — tap ● Start recording when ready.`);
  }

  function backingLayerCount(excludeArm?: LayerArm): number {
    if (!mtSession) return 0;
    return mtSession.layers.filter((l) => l.kind !== 'mix' && (!excludeArm || l.kind !== excludeArm)).length;
  }

  function audibleBackingCount(excludeArm?: LayerArm): number {
    if (!mtSession) return 0;
    return mtSession.layers.filter((l) => {
      if (l.kind === 'mix') return false;
      if (excludeArm && l.kind === excludeArm) return false;
      if (backingMutedArms.has(l.kind as LayerArm)) return false;
      return true;
    }).length;
  }

  function stopOverdubLoop(): void {
    overdubLoopActive = false;
  }

  function stopOverdubLoopPlayback(): void {
    stopOverdubLoop();
    overdubLoopPlaying = false;
    clearPreviewTimers();
    if (hookPlayback?.isOverdubMonitor) {
      finishHookPlayback({ restartLiveTransport: false });
    } else if (transportIsRunning()) {
      stopTransport();
    }
  }

  async function restartOverdubLoopIfActive(): Promise<void> {
    const shouldPlay =
      (overdubLoopPlaying && hookPlayback?.isOverdubMonitor) ||
      (hookRecorder.active && !fullTakeRecording && audibleBackingCount(layerArm) > 0);
    if (!shouldPlay) return;
    const wasPaused = !!(hookPlayback?.isOverdubMonitor && hookPlayback.pausedAt !== null);
    if (hookPlayback?.isOverdubMonitor) finishHookPlayback();
    const hook = buildHookForOverdub();
    if (!hook) {
      overdubLoopPlaying = false;
      overdubLoopActive = false;
      renderMultitrackPanel();
      return;
    }
    overdubLoopActive = true;
    overdubLoopPlaying = true;
    await playHook(hook, {
      restorePattern: false,
      reviewUi: false,
      isOverdubMonitor: true,
    });
    if (wasPaused) pauseHookPlayback();
    renderMultitrackPanel();
  }

  function toggleBackingMute(arm: LayerArm): void {
    if (backingMutedArms.has(arm)) backingMutedArms.delete(arm);
    else backingMutedArms.add(arm);

    const excludeArm = hookRecorder.active && !fullTakeRecording ? layerArm : undefined;
    if (audibleBackingCount(excludeArm) === 0) {
      stopOverdubLoopPlayback();
    } else {
      void restartOverdubLoopIfActive();
    }
    renderMultitrackPanel();
  }

  function startOverdubLoop(): void {
    if (!mtSession || pendingHook) return;
    const excludeArm = hookRecorder.active && !fullTakeRecording ? layerArm : undefined;
    if (audibleBackingCount(excludeArm) === 0) {
      if (hookRecorder.active && backingLayerCount(excludeArm) > 0) {
        toast('Unmute a backing track or tap ▶ Play');
      } else if (hookRecorder.active) {
        toast('Record another layer first to use as backing');
      }
      return;
    }
    overdubLoopActive = true;
    overdubLoopPlaying = true;
    const hook = buildHookForOverdub();
    if (!hook) return;
    void playHook(hook, {
      restorePattern: false,
      reviewUi: false,
      isOverdubMonitor: true,
    });
    renderMultitrackPanel();
  }

  function toggleOverdubLoopPlayback(): void {
    if (overdubLoopPlaying && hookPlayback?.isOverdubMonitor && hookPlayback.pausedAt === null) {
      pauseHookPlayback();
      return;
    }
    if (overdubLoopPlaying && hookPlayback?.isOverdubMonitor && hookPlayback.pausedAt !== null) {
      resumeHookPlayback();
      return;
    }
    if (overdubLoopPlaying) {
      stopOverdubLoopPlayback();
      renderMultitrackPanel();
      return;
    }
    startOverdubLoop();
  }

  function cancelMultitrackSession(): void {
    mtSession = null;
    reRecordArm = null;
    backingMutedArms.clear();
    mtPanelExpanded = false;
    stopOverdubLoopPlayback();
    if (composePanelMounts) closeComposeInstruments(composePanelNodes, composePanelMounts);
    renderMultitrackPanel();
    setRecStatus('Ready');
    setDialogue('DJ: Multitrack wiped. Hit REC whenever you’re ready.');
    ensureLiveTransport();
  }

  async function finishMultitrackSession(): Promise<void> {
    if (!mtSession || mtSession.layers.length === 0) {
      toast('Record at least one layer first');
      return;
    }
    stopOverdubLoopPlayback();
    reRecordArm = null;
    const hook = buildHookFromSession(mtSession);
    const flat = flattenSession(mtSession);
    if (flat.voice) {
      try {
        await audio.preloadVoice(flat.voice);
      } catch {
        /* preview decode failed */
      }
    }
    pendingHook = hook;
    mtSession = null;
    renderMultitrackPanel();
    const loopSec = hookPlaybackMs(hook) / 1000;
    setRecStatus(`Take ready · ${loopSec.toFixed(1)}s`);
    setDialogue('DJ: Hook ready — name it, listen back, then tap Submit ✓.');
    showReviewBar(true);
    setReviewPlayButton('play');
  }

  function stepDurationSec(): number {
    return 60 / bpm / 4;
  }

  function startTransport(forHookPlayback = false): void {
    startTransportAt(0, forHookPlayback);
  }

  function startTransportAt(elapsedSec: number, forHookPlayback = false): void {
    if (reviewBarOpen() && !forHookPlayback) return;
    if (hookPlayback?.reviewUi && !forHookPlayback) return;
    stopTransport();
    const stepMs = Math.max(50, Math.round(stepDurationSec() * 1000));
    const totalSteps = Math.floor((elapsedSec * 1000) / stepMs);
    transportStep = totalSteps % stepsPerBar;
    const offsetInStep = elapsedSec * 1000 - totalSteps * stepMs;
    const firstDelay = Math.max(0, stepMs - offsetInStep);

    const tick = () => {
      if (drumsOn || patternPreviewPlaying) {
        const s = transportStep;
        if (pattern.kick[s]) recordDrumHit('kick', drumStepVelocity(s, stepsPerBar, 'kick', 0.95));
        if (pattern.snare[s]) recordDrumHit('snare', drumStepVelocity(s, stepsPerBar, 'snare', 0.95));
        if (pattern.hat[s]) recordDrumHit('hat', drumStepVelocity(s, stepsPerBar, 'hat', 0.95));
        if (pattern.clap[s]) recordDrumHit('clap', drumStepVelocity(s, stepsPerBar, 'clap', 0.95));
      }
      transportStep = (transportStep + 1) % stepsPerBar;
    };

    const startInterval = () => {
      tick();
      transportTimer = window.setInterval(tick, stepMs);
    };

    if (firstDelay <= 0) {
      startInterval();
    } else {
      transportStartTimer = window.setTimeout(() => {
        transportStartTimer = null;
        startInterval();
      }, firstDelay);
    }
  }

  function stopTransport(): void {
    if (transportStartTimer) window.clearTimeout(transportStartTimer);
    transportStartTimer = null;
    if (transportTimer) window.clearInterval(transportTimer);
    transportTimer = null;
  }

  function schedulePreview(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    previewTimers.push(id);
  }

  function clearPreviewTimers(): void {
    for (const id of previewTimers) window.clearTimeout(id);
    previewTimers = [];
  }

  function clearHookPreview(): void {
    clearPreviewTimers();
    audio.stopVoice();
  }

  function playbackElapsedMs(): number {
    if (!hookPlayback) return 0;
    const { startedAt, pausedAt, totalPausedMs } = hookPlayback;
    if (pausedAt !== null) return pausedAt - startedAt - totalPausedMs;
    return performance.now() - startedAt - totalPausedMs;
  }

  function setReviewPlayButton(mode: 'play' | 'pause'): void {
    reviewPlayBtn.textContent = mode === 'pause' ? '⏸ Pause' : '▶ Play';
    reviewPlayBtn.setAttribute('aria-label', mode === 'pause' ? 'Pause playback' : 'Play recording');
  }

  function stopMonitorPlaybackOnly(): void {
    if (!hookPlayback) return;
    const { endTimerId, usingTransport, isOverdubMonitor, previewArms } = hookPlayback;
    if (!isOverdubMonitor && !previewArms?.length) {
      finishHookPlayback();
      return;
    }
    if (endTimerId) window.clearTimeout(endTimerId);
    clearPreviewTimers();
    audio.pauseVoicePlayback();
    audio.noteOffAll();
    hookPlayback = null;
    clearHookPreview();
    audio.endHookPlayback();
    if (usingTransport) stopTransport();
    syncLiveInstrumentGains();
    if (hookRecorder.active) {
      audio.beginRecordingMonitor();
      syncRecordingTransport();
    }
    syncInstrumentsBlocked();
    renderMultitrackPanel();
  }

  function finishHookPlayback(opts?: { restartLiveTransport?: boolean }): void {
    if (!hookPlayback) return;
    const { restorePattern: shouldRestore, patternSnap, usingTransport, endTimerId, isOverdubMonitor, previewArms, pausedAt } =
      hookPlayback;
    const shouldRestartOverdub =
      !!isOverdubMonitor &&
      overdubLoopActive &&
      mtSession !== null &&
      pendingHook === null &&
      pausedAt === null;
    const restartLive = opts?.restartLiveTransport ?? true;
    if (endTimerId) window.clearTimeout(endTimerId);
    hookPlayback = null;
    clearHookPreview();
    audio.endHookPlayback();
    syncLiveInstrumentGains();
    syncInstrumentsBlocked();
    if (usingTransport) stopTransport();
    if (shouldRestore) restorePattern(patternSnap);
    if (!isOverdubMonitor && !reviewBarOpen() && restartLive) {
      ensureLiveTransport();
      setReviewPlayButton('play');
    } else if (!isOverdubMonitor) {
      setReviewPlayButton('play');
    }
    updateGearStatus();
    touchDrums?.refresh();
    if (hookRecorder.active) {
      audio.beginRecordingMonitor();
      syncRecordingTransport();
    }
    if (shouldRestartOverdub) {
      overdubLoopPlaying = true;
      window.setTimeout(() => startOverdubLoop(), 180);
    } else if (isOverdubMonitor || previewArms?.length) {
      overdubLoopPlaying = false;
      renderMultitrackPanel();
    }
  }

  function scheduleHookEndTimer(): void {
    if (!hookPlayback) return;
    if (hookPlayback.endTimerId) window.clearTimeout(hookPlayback.endTimerId);
    const loopOverride = hookPlayback.isOverdubMonitor && mtSession ? mtSession.loopSec : undefined;
    const remainingMs = hookPlaybackMs(hookPlayback.hook, loopOverride) - playbackElapsedMs();
    hookPlayback.endTimerId = window.setTimeout(() => {
      finishHookPlayback();
    }, Math.max(0, remainingMs));
  }

  function scheduleHookEvents(
    hook: HookData,
    fromSec: number,
    session: HookPlaybackSession,
    playAt?: number,
  ): void {
    const untilSec = hook.recordedSec ?? hookContentSec(hook);
    const drumHits = hook.drum.hits ?? [];
    const usePattern = patternHasSteps(hook.drum);
    const useHits = !usePattern && drumHits.length > 0;

    const runAt = (fn: () => void): void => {
      if (playAt !== undefined) {
        const ctx = audio.ensure();
        const delayMs = Math.max(0, Math.ceil((playAt - ctx.currentTime) * 1000));
        if (delayMs === 0) fn();
        else schedulePreview(fn, delayMs);
      } else {
        fn();
      }
    };

    if (usePattern) {
      runAt(() => scheduleHookPatternDrums(hook.drum, fromSec, untilSec, playAt));
      return;
    }
    if (useHits) {
      runAt(() => scheduleHookDrumHits(hook.drum, drumHits, fromSec, untilSec, playAt));
      return;
    }

    if (playAt !== undefined) return;

    if (fromSec <= 0) {
      drumsOn = true;
      startTransport(true);
      session.usingTransport = true;
      return;
    }

    drumsOn = true;
    startTransportAt(fromSec, true);
    session.usingTransport = true;
  }

  function pauseHookPlayback(): void {
    if (!hookPlayback || hookPlayback.pausedAt !== null) return;
    hookPlayback.pausedAt = performance.now();
    audio.pauseVoicePlayback();
    audio.noteOffAll();
    audio.mutePlaybackStems();
    if (hookPlayback.endTimerId) window.clearTimeout(hookPlayback.endTimerId);
    hookPlayback.endTimerId = null;
    clearPreviewTimers();
    if (hookPlayback.usingTransport) stopTransport();
    if (hookPlayback.reviewUi) setReviewPlayButton('play');
    renderMultitrackPanel();
  }

  function resumeHookPlayback(): void {
    if (!hookPlayback || hookPlayback.pausedAt === null) return;
    hookPlayback.totalPausedMs += performance.now() - hookPlayback.pausedAt;
    hookPlayback.pausedAt = null;
    audio.unmutePlaybackStems();
    const elapsedSec = playbackElapsedMs() / 1000;
    const hook = hookPlayback.hook;
    const ctx = audio.ensure();
    const playAt = ctx.currentTime + 0.05;
    scheduleHookEvents(hook, elapsedSec, hookPlayback, playAt);
    for (const n of hook.notes) {
      if (n.t + n.d <= elapsedSec + 0.001) continue;
      audio.playMelody(
        n.n,
        n.v,
        hook.synth.preset,
        hook.synth.detune,
        hook.synth.tone,
        n.d,
        playAt + Math.max(0, n.t - elapsedSec),
      );
    }
    const bass = hook.bass ?? { preset: 'sub' as BassPreset, gain: 0.85, notes: [] };
    for (const n of bass.notes ?? []) {
      if (n.t + n.d <= elapsedSec + 0.001) continue;
      audio.playBass(
        n.n,
        n.v,
        bass.preset,
        n.d,
        bass.gain,
        playAt + Math.max(0, n.t - elapsedSec),
      );
    }
    if (hook.voice?.data) audio.playVoice(hook.voice, playAt, elapsedSec);
    audio.resumeVoicePlayback();
    scheduleHookEndTimer();
    if (hookPlayback.reviewUi) setReviewPlayButton('pause');
    renderMultitrackPanel();
  }

  function transportIsRunning(): boolean {
    return transportTimer !== null || transportStartTimer !== null;
  }

  /** Live drum sequencer — only when this take needs it; never restart mid-loop. */
  function syncRecordingTransport(): void {
    if (hookPlayback?.isOverdubMonitor) {
      stopTransport();
      return;
    }
    const layerMode = overdubOn && !fullTakeRecording;
    const recordingDrumsTrack = !layerMode || layerArm === 'drums' || fullTakeRecording;
    const wantDrums =
      recordingDrumsTrack && (drumsOn || patternPreviewPlaying || hookRecorder.active);
    if (!wantDrums) {
      stopTransport();
      return;
    }
    if (transportIsRunning()) return;
    startTransport();
  }

  function ensureLiveTransport(): void {
    if (submitted || hookRecorder.active || hookPlayback || reviewBarOpen()) return;
    if (!patternPreviewPlaying) {
      stopTransport();
      return;
    }
    if (transportIsRunning()) return;
    startTransport();
  }

  function isPatternPlaying(): boolean {
    return transportIsRunning();
  }

  function canTogglePatternPlay(): boolean {
    if (submitted || reviewBarOpen() || hookPlayback) return false;
    if (hookRecorder.active) {
      if (fullTakeRecording) return true;
      if (overdubOn && layerArm !== 'drums') return false;
      return true;
    }
    return true;
  }

  function togglePatternPlay(): void {
    if (!canTogglePatternPlay()) return;
    void audio.resume();
    if (transportIsRunning()) {
      patternPreviewPlaying = false;
      stopTransport();
      touchDrums?.refresh();
      return;
    }
    patternPreviewPlaying = true;
    startTransport();
    touchDrums?.refresh();
  }

  function hookContentSec(hook: HookData, loopSecOverride?: number): number {
    if (loopSecOverride !== undefined) return Math.min(MAX_RECORD_SEC, loopSecOverride);
    let maxT = hook.recordedSec ?? 0;
    for (const n of hook.notes) maxT = Math.max(maxT, n.t + n.d);
    for (const n of hook.bass?.notes ?? []) maxT = Math.max(maxT, n.t + n.d);
    for (const h of hook.drum.hits ?? []) maxT = Math.max(maxT, h.t + 0.08);
    const barSec = (60 / hook.bpm) * 4;
    maxT = Math.max(maxT, barSec * (hook.bars ?? 2));
    return Math.min(MAX_RECORD_SEC, maxT);
  }

  function hookPlaybackMs(hook: HookData, loopSecOverride?: number): number {
    const contentSec = hookContentSec(hook, loopSecOverride);
    return Math.min(MAX_RECORD_SEC * 1000, Math.max(2500, Math.ceil(contentSec * 1000) + 900));
  }

  function scheduleHookDrumHits(
    drum: HookData['drum'],
    hits: DrumHitEvent[],
    fromSec: number,
    untilSec: number,
    playAt?: number,
  ): void {
    for (const hit of hits) {
      if (hit.t < fromSec - 0.001 || hit.t >= untilSec - 0.001) continue;
      const gain = (hit.v ?? 0.9) * drum.gain;
      if (playAt !== undefined) {
        audio.drumHit(hit.sound, gain, playAt + Math.max(0, hit.t - fromSec));
      } else {
        schedulePreview(() => {
          audio.drumHit(hit.sound, gain);
        }, Math.max(0, Math.floor((hit.t - fromSec) * 1000)));
      }
    }
  }

  function scheduleHookPatternDrums(
    drum: HookData['drum'],
    fromSec: number,
    untilSec: number,
    playAt?: number,
  ): void {
    const stepSec = stepDurationSec();
    const sounds = ['kick', 'snare', 'hat', 'clap'] as DrumSound[];
    let t = fromSec;
    while (t < untilSec - 0.001) {
      const step = Math.floor(t / stepSec) % stepsPerBar;
      for (const sound of sounds) {
        if (drum.pattern[sound]?.[step]) {
          const gainMul = drumStepVelocity(step, stepsPerBar, sound, drum.gain);
          const offset = t - fromSec;
          if (playAt !== undefined) {
            audio.drumHit(sound, gainMul, playAt + offset);
          } else {
            schedulePreview(() => audio.drumHit(sound, gainMul), Math.max(0, Math.floor(offset * 1000)));
          }
        }
      }
      t += stepSec;
    }
  }

  function snapshotPattern(): Record<DrumSound, number[]> {
    return {
      kick: [...pattern.kick],
      snare: [...pattern.snare],
      hat: [...pattern.hat],
      clap: [...pattern.clap],
    };
  }

  function restorePattern(snap: Record<DrumSound, number[]>): void {
    for (const s of ['kick', 'snare', 'hat', 'clap'] as DrumSound[]) {
      for (let i = 0; i < stepsPerBar; i++) pattern[s][i] = snap[s][i] ?? 0;
    }
  }

  function finalizeRecordedNote(source: NoteSource, inputId: number): void {
    hookRecorder.noteUp(`${source}:${inputId}`);
  }

  function recordTimeSec(): number {
    return hookRecorder.timeSec();
  }

  function applyDrumPattern(name: DrumPatternName): void {
    drumPatternName = name;
    const src = DRUM_PATTERNS[name];
    for (const s of ['kick', 'snare', 'hat', 'clap'] as DrumSound[]) {
      for (let i = 0; i < stepsPerBar; i++) pattern[s][i] = src[s][i] ?? 0;
    }
    updateGearStatus();
    touchDrums?.refresh();
  }

  function updateGearStatus(): void {
    gearSynth.textContent = `Lead: ${leadPresetLabel(preset)} · Bass: ${bassPresetLabel(bassPreset)} · Kit: ${drumKitLabel(drumKit)} · Pat: ${drumPatternLabel(drumPatternName)} · BPM: ${bpm}`;
  }

  function mixPct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }

  /** Step volume through fixed levels. */
  function stepVol(v: number, dir: 'up' | 'down'): number {
    const levels = [0, 0.25, 0.5, 0.75, 1];
    const idx = levels.reduce((best, l, i) => (Math.abs(l - v) < Math.abs(levels[best]! - v) ? i : best), 0);
    const next = dir === 'up' ? Math.min(levels.length - 1, idx + 1) : Math.max(0, idx - 1);
    return levels[next]!;
  }

  function setRecStatus(text: string): void {
    recStatus.textContent = text;
    const idle = text === 'Ready' || text === 'Already submitted' || text === 'Submitted ✓';
    recStatus.classList.toggle('hidden', idle);
    syncComposeToolbar();
  }

  function syncComposeToolbar(): void {
    const recBtn = document.getElementById('compose-rec') as HTMLButtonElement | null;
    const timer = document.getElementById('compose-rec-timer') as HTMLSpanElement | null;
    if (!recBtn || !timer) return;
    const rec = hookRecorder.active && !fullTakeRecording;
    recBtn.classList.toggle('recording', rec);
    recBtn.textContent = rec ? '■ STOP' : '● REC';
    recBtn.disabled = submitted || !!player?.myHookId || !document.body.classList.contains('instrument-open');
    timer.classList.toggle('hidden', !rec);
    if (rec) timer.textContent = `${recordElapsedSec.toFixed(1)}s`;
  }

  function releaseHeldNote(source: NoteSource, inputId: number, voiceId?: number): void {
    const slot = `${source}:${inputId}`;
    const entry = activeVoices.get(slot);
    if (!entry) return;
    if (voiceId !== undefined && entry.voiceId !== voiceId) return;
    audio.noteOff(entry.voiceId);
    activeVoices.delete(slot);
  }

  function releaseAllHeldNotes(): void {
    for (const slot of [...activeVoices.keys()]) {
      const entry = activeVoices.get(slot);
      if (!entry) continue;
      audio.noteOff(entry.voiceId);
      activeVoices.delete(slot);
    }
  }

  function reviewBarOpen(): boolean {
    return !el<HTMLDivElement>('review-overlay').classList.contains('hidden');
  }

  function silenceStudioForReview(): void {
    stopOverdubLoopPlayback();
    finishHookPlayback();
    stopTransport();
    releaseAllHeldNotes();
    studio.releaseInstrumentInput();
    touchKeysMount?.releaseAll();
    audio.prepareForRecording();
    studio.setComposeCoverage(0);
  }

  function instrumentsBlocked(): boolean {
    if (hookRecorder.active) return false;
    if (reviewBarOpen()) return true;
    if (hookPlayback) return true;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
    return false;
  }

  function syncInstrumentsBlocked(): void {
    const blocked = instrumentsBlocked();
    document.body.classList.toggle('instruments-blocked', blocked);
    if (blocked) {
      releaseAllHeldNotes();
      studio.releaseInstrumentInput();
    }
  }

  function onNoteDown(
    midi: number,
    source: NoteSource,
    inputId: number,
    layer: 'melody' | 'bass',
    pressure?: number,
  ): void {
    if (instrumentsBlocked()) return;
    void audio.resume();
    const slot = `${source}:${inputId}`;
    const vel = captureVelocity(pressure, 0.86, 0.1);
    if (hookRecorder.active) {
      if (shouldRecordLayer(layer)) hookRecorder.noteDown(slot, midi, vel, layer);
    }
    releaseHeldNote(source, inputId);

    const voiceId = ++nextVoiceId;
    activeVoices.set(slot, { voiceId });

    if (layer === 'bass') {
      audio.setBassGain(bassGain);
      audio.noteOn(voiceId, midi, vel, bassPreset, true);
    } else {
      audio.setLeadGain(leadGain);
      audio.noteOn(voiceId, midi, vel, preset, false, detune, tone);
    }
  }

  function onNoteUp(_midi: number, source: NoteSource, inputId: number, _layer: 'melody' | 'bass'): void {
    releaseHeldNote(source, inputId);
    finalizeRecordedNote(source, inputId);
  }

  function clearRecTimers(): void {
    if (recProgressTimer) window.clearInterval(recProgressTimer);
    if (recMaxTimer) window.clearTimeout(recMaxTimer);
    recProgressTimer = null;
    recMaxTimer = null;
  }

  function showReviewBar(show: boolean): void {
    const overlay = el<HTMLDivElement>('review-overlay');
    overlay.classList.toggle('hidden', !show);
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    document.body.classList.toggle('review-open', show);
    if (show) {
      closeHelp();
      silenceStudioForReview();
      const titleInput = el<HTMLInputElement>('review-title');
      titleInput.value = pendingHook?.title?.trim() ?? '';
      window.setTimeout(() => titleInput.focus(), 120);
    } else {
      finishHookPlayback({ restartLiveTransport: pendingHook !== null });
      releaseAllHeldNotes();
      studio.releaseInstrumentInput();
      syncLiveInstrumentGains();
      if (pendingHook === null) stopTransport();
    }
    syncInstrumentsBlocked();
  }

  function finishRecordingAudio(): void {
    recordingInstruments = false;
    audio.endRecordingMonitor();
  }

  async function stopRecording(): Promise<void> {
    if (!hookRecorder.active || submitted) return;
    clearRecTimers();
    releaseAllHeldNotes();
    recordElapsedSec = recordTimeSec();

    if (recordElapsedSec < MIN_RECORD_SEC) {
      hookRecorder.cancel();
      fullTakeRecording = false;
      finishRecordingAudio();
      setRecStatus('Too short — keep jamming');
      setDialogue('DJ: That was a blip. Record at least half a second.');
      toast('Hold REC a little longer');
      renderMultitrackPanel();
      return;
    }

    const instruments = hookRecorder.stop();
    finishRecordingAudio();

    if (overdubOn && !fullTakeRecording) {
      const layer = createLayerFromPass(instruments, recordElapsedSec);
      const session = beginMultitrackSession();
      if (!upsertLayer(session, layer, recordElapsedSec)) {
        toast(`Max ${MAX_TRACK_LAYERS} layers — remove one first`);
        fullTakeRecording = false;
        return;
      }
      if (layer.kind === 'drums' || layerArm === 'drums') {
        if (layer.drumPattern) session.pattern = layer.drumPattern;
        else if (livePatternHasSteps()) session.pattern = snapshotPatternCopy();
      } else if (livePatternHasSteps()) {
        session.pattern = mergeDrumPatterns(session.pattern, snapshotPatternCopy());
      }
      reRecordArm = null;
      fullTakeRecording = false;
      patternPreviewPlaying = false;
      stopTransport();
      renderMultitrackPanel();
      setDialogue(`DJ: ${layerArmLabel(layerArm)} saved (${recordElapsedSec.toFixed(1)}s). Tap ▶ on the slot or Submit ✓ when ready.`);
      setRecStatus(`${session.layers.length} layer(s) · ${session.loopSec.toFixed(1)}s total`);
      return;
    }

    fullTakeRecording = false;
    const fullPattern = snapshotPatternCopy();
    const fullHasPattern = patternHasSteps({
      pattern: fullPattern,
      swing,
      gain: drumGain,
      kit: drumKit,
    });
    const hook: HookData = {
      bpm,
      stepsPerBar,
      bars,
      synth: { preset, detune, tone, gain: leadGain },
      bass: { preset: bassPreset, gain: bassGain, notes: instruments.bassNotes },
      drum: {
        swing,
        pattern: fullPattern,
        gain: drumGain,
        kit: drumKit,
        ...(instruments.drumHits.length && !fullHasPattern ? { hits: instruments.drumHits } : {}),
      },
      mix,
      notes: instruments.notes,
      recordedSec: recordElapsedSec,
    };

    pendingHook = hook;
    setRecStatus(`Take ready · ${recordElapsedSec.toFixed(1)}s`);
    setDialogue('DJ: Got the take. Name it, listen back, or send it in.');
    showReviewBar(true);
    setReviewPlayButton('play');
  }

  function deletePendingHook(): void {
    pendingHook = null;
    mtSession = null;
    stopOverdubLoop();
    clearPreviewTimers();
    if (hookPlayback?.endTimerId) window.clearTimeout(hookPlayback.endTimerId);
    hookPlayback = null;
    stopTransport();
    audio.abortHookPlayback({ lead: leadGain, bass: bassGain, drum: drumGain });
    audio.endRecordingMonitor();
    syncLiveInstrumentGains();
    renderMultitrackPanel();
    showReviewBar(false);
    setRecStatus('Ready');
    setDialogue('DJ: Tape wiped. Hit REC whenever you’re ready for a new take.');
    toast('Recording deleted');
  }

  async function submitPendingHook(): Promise<void> {
    if (!pendingHook || submitted) return;
    if (!player) {
      toast('Still loading — try again in a second');
      return;
    }
    const titleInput = el<HTMLInputElement>('review-title');
    const rawTitle = titleInput.value.trim().slice(0, 40);
    const hookToSubmit: HookData = {
      ...pendingHook,
      ...(rawTitle ? { title: rawTitle } : {}),
    };
    setRecStatus('Processing tape…');
    finishHookPlayback();
    try {
      const res = await apiSubmitHook(hookToSubmit);
      player = res.player;
      submitted = true;
      pendingHook = null;
      showReviewBar(false);
      renderReveal(res.prevReveal);
      renderHooks(res.hooks);
      syncInstrumentsBlocked();
      ensureLiveTransport();
      applauseEl.classList.remove('hidden');
      window.setTimeout(() => applauseEl.classList.add('hidden'), 900);
      toast('Hook recorded!');
      setDialogue('DJ: Submitted. Vote on today’s jingles!');
      setRecStatus('Submitted ✓');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Submit failed');
      setDialogue('DJ: Tape jammed. Try submitting again.');
      setRecStatus('Error — try again');
    }
  }

  async function startRecording(mode: 'layer' | 'full' = 'layer'): Promise<void> {
    if (submitted || player?.myHookId) {
      toast('Already submitted today — one jingle per day');
      return;
    }
    fullTakeRecording = mode === 'full';
    await audio.resume();

    stopOverdubLoopPlayback();
    finishHookPlayback();
    releaseAllHeldNotes();
    studio.releaseInstrumentInput();
    touchKeysMount?.releaseAll();
    audio.prepareForRecording();
    audio.beginRecordingMonitor();
    syncInstrumentsBlocked();

    if (!fullTakeRecording) {
      overdubOn = true;
      beginMultitrackSession();
      expandMultitrackPanel();
      renderMultitrackPanel();
      if (layerArm === 'drums') {
        openInstrumentForArm(layerArm);
      }
    } else {
      pendingHook = null;
      showReviewBar(false);
    }

    recTimeAnchor = audio.ensure().currentTime;
    recordingInstruments = true;
    hookRecorder.start();
    const layerMode = !fullTakeRecording;
    if (layerMode && layerArm !== 'drums') patternPreviewPlaying = false;
    syncRecordingTransport();

    recordElapsedSec = 0;
    const layerHint = layerMode ? layerArmLabel(layerArm).toLowerCase() : 'keys, bass, and drums';
    const capSec = layerMode ? sessionRecordCapSec() : MAX_RECORD_SEC;
    if (layerMode && audibleBackingCount(layerArm) > 0) {
      window.setTimeout(() => startOverdubLoop(), 150);
    }
    setDialogue(
      layerMode
        ? backingLayerCount(layerArm) > 0
          ? audibleBackingCount(layerArm) > 0
            ? `DJ: Recording ${layerHint} over your other layers — up to ${capSec.toFixed(0)}s.`
            : `DJ: Recording ${layerHint} — backing tracks are muted. Unmute in the strip above.`
          : `DJ: Recording ${layerHint} — up to ${capSec.toFixed(0)}s. Tap ■ Stop & save when done.`
        : 'DJ: Recording full take — everything at once. Tap STOP on the tape deck when done.',
    );
    setRecStatus(
      layerMode
        ? `● REC ${layerArmLabel(layerArm)} · ${capSec.toFixed(0)}s max`
        : '● FULL REC — tap STOP when done',
    );

    recProgressTimer = window.setInterval(() => {
      recordElapsedSec = recordTimeSec();
      const cap = layerMode ? sessionRecordCapSec() : MAX_RECORD_SEC;
      const left = Math.max(0, cap - recordElapsedSec);
      setRecStatus(
        layerMode
          ? `● REC ${layerArmLabel(layerArm)} ${recordElapsedSec.toFixed(1)}s · ${left.toFixed(0)}s left`
          : `● FULL REC ${recordElapsedSec.toFixed(1)}s · ${left.toFixed(0)}s left`,
      );
      renderMultitrackPanel();
    }, 100);

    const maxSec = layerMode ? sessionRecordCapSec() : MAX_RECORD_SEC;
    recMaxTimer = window.setTimeout(() => {
      setDialogue(
        layerMode
          ? 'DJ: Layer time is up — saved. Listen back or add another layer.'
          : 'DJ: Tape full — review your take below.',
      );
      void stopRecording();
    }, maxSec * 1000);
  }

  function toggleStudioRec(): void {
    if (submitted || player?.myHookId) {
      toast('Already submitted today — one jingle per day');
      setDialogue('DJ: You already dropped today’s jingle.');
      return;
    }
    if (hookRecorder.active) {
      void stopRecording();
    } else {
      void startRecording('full');
    }
  }

  function toggleLayerRec(arm?: LayerArm): void {
    if (submitted || player?.myHookId) {
      toast('Already submitted today — one jingle per day');
      setDialogue('DJ: You already dropped today’s jingle.');
      return;
    }
    if (arm && layerArm !== arm) selectLayer(arm);
    if (hookRecorder.active) {
      void stopRecording();
    } else {
      void startRecording('layer');
    }
  }

  function getConsoleLabels(): Record<string, string> {
    return {
      syn: leadPresetLabel(preset),
      bass: bassPresetLabel(bassPreset),
      bpm: `${bpm}`,
      drm: drumsOn ? 'ON' : 'OFF',
      echo: mixPct(mix.echo),
      rev: mixPct(mix.reverb),
      atk: mixPct(mix.attack),
      dub: overdubOn ? 'ON' : 'OFF',
      lay: layerArmLabel(layerArm),
      leadvol: mixPct(leadGain),
      bassvol: mixPct(bassGain),
      drumvol: mixPct(drumGain),
      sust: sustainOn ? 'ON' : 'OFF',
    };
  }

  function handleCtrl(action: string, dir: 'up' | 'down'): void {
    if (instrumentsBlocked()) return;
    const up = dir === 'up';
    switch (action) {
      case 'syn':
        preset = up ? nextLeadPreset(preset) : prevLeadPreset(preset);
        toast(`Lead: ${leadPresetLabel(preset)}`);
        break;
      case 'bass':
        bassPreset = up ? nextBassPreset(bassPreset) : prevBassPreset(bassPreset);
        toast(`Bass: ${bassPresetLabel(bassPreset)}`);
        break;
      case 'bpm':
        bpm = up ? (bpm >= 160 ? 100 : bpm + 10) : bpm <= 100 ? 160 : bpm - 10;
        if (hookRecorder.active) {
          if (transportIsRunning()) {
            stopTransport();
            syncRecordingTransport();
          }
        } else if (transportIsRunning()) {
          stopTransport();
          startTransport();
        }
        break;
      case 'drm':
        drumsOn = up;
        if (!drumsOn && !patternPreviewPlaying && !hookRecorder.active) stopTransport();
        if (hookRecorder.active) syncRecordingTransport();
        else ensureLiveTransport();
        break;
      case 'kit':
        drumKit = up ? nextDrumKit(drumKit) : prevDrumKit(drumKit);
        audio.setDrumKit(drumKit);
        toast(`Drums: ${drumKitLabel(drumKit)}`);
        break;
      case 'pat': {
        const next = up ? nextDrumPattern(drumPatternName) : prevDrumPattern(drumPatternName);
        applyDrumPattern(next);
        toast(`Pattern: ${drumPatternLabel(next)}`);
        break;
      }
      case 'echo':
        audio.nudgeMix('echo', up ? 1 : -1);
        mix = audio.getMix();
        break;
      case 'rev':
        audio.nudgeMix('reverb', up ? 1 : -1);
        mix = audio.getMix();
        break;
      case 'atk':
        audio.nudgeMix('attack', up ? 1 : -1);
        mix = audio.getMix();
        break;
      case 'dub':
        overdubOn = up;
        if (!overdubOn && mtSession) cancelMultitrackSession();
        else if (overdubOn) beginMultitrackSession();
        renderMultitrackPanel();
        toast(overdubOn ? 'Multitrack DUB ON' : 'Multitrack DUB OFF');
        break;
      case 'lay': {
        const arms: LayerArm[] = ['drums', 'keys', 'bass'];
        const idx = arms.indexOf(layerArm);
        const next = up
          ? arms[(idx + 1) % arms.length]!
          : arms[(idx - 1 + arms.length) % arms.length]!;
        armForRecording(next);
        toast(`Record next: ${layerArmLabel(next)}`);
        break;
      }
      case 'leadvol':
        leadGain = stepVol(leadGain, dir);
        audio.setLeadGain(leadGain);
        toast(`Keys volume: ${mixPct(leadGain)}`);
        break;
      case 'bassvol':
        bassGain = stepVol(bassGain, dir);
        audio.setBassGain(bassGain);
        toast(`Bass volume: ${mixPct(bassGain)}`);
        break;
      case 'drumvol':
        drumGain = stepVol(drumGain, dir);
        audio.setDrumGain(drumGain);
        toast(`Drums volume: ${mixPct(drumGain)}`);
        break;
      case 'sust':
        sustainOn = up;
        if (!sustainOn) releaseAllHeldNotes();
        toast(sustainOn ? 'Sustain ON' : 'Sustain OFF');
        break;
    }
    updateGearStatus();
    touchConsole?.refresh();
    touchDrums?.refresh();
  }

  let touchConsole: ReturnType<typeof mountTouchConsole> | null = null;
  let touchDrums: ReturnType<typeof mountTouchDrums> | null = null;
  let touchKeysMount: ReturnType<typeof mountTouchKeys> | null = null;

  studio.setCallbacks({
    onNoteDown,
    onNoteUp,
    onStepToggle: (sound, step) => {
      if (instrumentsBlocked()) return;
      void audio.resume();
      pattern[sound][step] = pattern[sound][step] ? 0 : 1;
      {
        const dv = humanizeVel(0.72, 0.12);
        audio.drumHit(sound, dv);
        if (hookRecorder.active) hookRecorder.drumHit(sound, dv);
      }
      touchDrums?.refresh();
    },
    onRecPress: toggleStudioRec,
    onCtrl: handleCtrl,
    onPatternPlayToggle: togglePatternPlay,
    getPatternPlaying: isPatternPlaying,
    getRecordingProgress: () => clamp(recordTimeSec() / MAX_RECORD_SEC, 0, 1),
    isRecording: () => hookRecorder.active,
    getPattern: () => pattern,
    getStepHighlight: () => transportStep,
    getPresetLabel: () => leadPresetLabel(preset),
    getBassLabel: () => bassPresetLabel(bassPreset),
    getBpmLabel: () => `${bpm}`,
    getDrumsLabel: () => (drumsOn ? 'ON' : 'OFF'),
    getDrumKitLabel: () => drumKitLabel(drumKit),
    getDrumPatternLabel: () => drumPatternLabel(drumPatternName),
    getEchoLabel: () => mixPct(mix.echo),
    getReverbLabel: () => mixPct(mix.reverb),
    getAttackLabel: () => mixPct(mix.attack),
    getDubLabel: () => (overdubOn ? 'ON' : 'OFF'),
    getLeadVolLabel: () => mixPct(leadGain),
    getBassVolLabel: () => mixPct(bassGain),
    getDrumVolLabel: () => mixPct(drumGain),
    getSustainLabel: () => (sustainOn ? 'ON' : 'OFF'),
  });

  async function playHook(
    hook: HookData,
    opts?: {
      restorePattern?: boolean;
      reviewUi?: boolean;
      isOverdubMonitor?: boolean;
      previewArms?: LayerArm[];
    },
  ): Promise<void> {
    const restorePatternAfter = opts?.restorePattern ?? true;
    const reviewUi = opts?.reviewUi ?? false;
    const isOverdubMonitor = opts?.isOverdubMonitor ?? false;
    const previewArms = opts?.previewArms ?? [];
    const monitorDuringRec = hookRecorder.active && (isOverdubMonitor || previewArms.length > 0);
    if (monitorDuringRec) {
      stopMonitorPlaybackOnly();
    } else {
      finishHookPlayback();
      stopTransport();
    }
    const patternSnap = snapshotPattern();

    hookPlayback = {
      hook,
      restorePattern: restorePatternAfter,
      patternSnap,
      startedAt: performance.now(),
      pausedAt: null,
      totalPausedMs: 0,
      endTimerId: null,
      usingTransport: false,
      reviewUi,
      isOverdubMonitor,
      previewArms,
    };
    if (previewArms.length || isOverdubMonitor) renderMultitrackPanel();
    syncInstrumentsBlocked();

    await audio.resume();
    if (hook.mix) {
      mix = { ...hook.mix };
    }
    const bass = hook.bass ?? { preset: 'sub' as BassPreset, gain: 0.85, notes: [] };
    audio.beginHookPlayback({
      gains: {
        lead: hook.synth.gain ?? 0.95,
        bass: bass.gain,
        drum: hook.drum.gain,
      },
      review: reviewUi,
      hasVoice: !!hook.voice?.data,
    });
    if (hook.drum.kit) {
      drumKit = hook.drum.kit;
      audio.setDrumKit(drumKit);
    }
    bpm = hook.bpm;
    const playbackPattern = {
      kick: [...(hook.drum.pattern.kick ?? [])],
      snare: [...(hook.drum.pattern.snare ?? [])],
      hat: [...(hook.drum.pattern.hat ?? [])],
      clap: [...(hook.drum.pattern.clap ?? [])],
    };
    if (!reviewUi && !monitorDuringRec) {
      for (const s of ['kick', 'snare', 'hat', 'clap'] as DrumSound[]) {
        for (let i = 0; i < stepsPerBar; i++) pattern[s][i] = playbackPattern[s][i] ? 1 : 0;
      }
    }

    const ctx = audio.ensure();
    const playAt = ctx.currentTime + 0.06;
    const playbackDrum = { ...hook.drum, pattern: playbackPattern };
    scheduleHookEvents({ ...hook, drum: playbackDrum }, 0, hookPlayback, playAt);
    if (hook.voice?.data) audio.playVoice(hook.voice, playAt);
    for (const n of hook.notes) {
      audio.playMelody(n.n, n.v, hook.synth.preset, hook.synth.detune, hook.synth.tone, n.d, playAt + n.t);
    }
    for (const n of bass.notes ?? []) {
      audio.playBass(n.n, n.v, bass.preset, n.d, bass.gain, playAt + n.t);
    }
    scheduleHookEndTimer();
    if (reviewUi) setReviewPlayButton('pause');
    if (previewArms.length || isOverdubMonitor) renderMultitrackPanel();
    updateGearStatus();
  }

  try {
    const data = await apiInit();
    if (data.type !== 'init') throw new Error('bad init');
    player = data.player;
    renderReveal(data.prevReveal);
    renderHooks(data.hooks);
    if (player.myHookId) {
      submitted = true;
      setDialogue('DJ: You already dropped today’s jingle. Vote below!');
      setRecStatus('Already submitted');
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Init failed');
  }

  updateGearStatus();

  const helpCloseBtn = el<HTMLButtonElement>('help-close-btn');

  const tour = mountTour(studio, tourOverlay, () => {
    tourToggle.setAttribute('aria-expanded', 'false');
    tourToggle.textContent = 'Tour ▾';
  });

  function closeTour(): void {
    tour.hide();
    tourToggle.setAttribute('aria-expanded', 'false');
    tourToggle.textContent = 'Tour ▾';
  }

  function closeHelp(): void {
    helpOverlay.classList.add('hidden');
    helpOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('help-open');
    helpToggle.setAttribute('aria-expanded', 'false');
    helpToggle.textContent = 'Help ▾';
  }

  function openHelp(): void {
    closeTour();
    helpOverlay.classList.remove('hidden');
    helpOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('help-open');
    helpToggle.setAttribute('aria-expanded', 'true');
    helpToggle.textContent = 'Help ▴';
  }

  tourToggle.addEventListener('click', () => {
    const isOpen = !tourOverlay.classList.contains('hidden');
    if (isOpen) {
      closeTour();
    } else {
      closeHelp();
      tour.show();
      tourToggle.setAttribute('aria-expanded', 'true');
      tourToggle.textContent = 'Tour ▴';
    }
  });

  const tourTick = () => {
    tour.tick();
    requestAnimationFrame(tourTick);
  };
  requestAnimationFrame(tourTick);

  helpCloseBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeHelp();
  });

  helpOverlay.addEventListener('click', (ev) => {
    if (ev.target === helpOverlay) closeHelp();
  });

  helpPanel.addEventListener('click', (ev) => ev.stopPropagation());

  helpToggle.addEventListener('click', () => {
    const isOpen = !helpOverlay.classList.contains('hidden');
    if (isOpen) closeHelp();
    else openHelp();
  });

  function closeHooksDrawer(): void {
    const drawer = el<HTMLDivElement>('hooks-drawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    hooksBackdrop.classList.add('hidden');
    hooksBackdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('hooks-drawer-open');
    hooksToggle.setAttribute('aria-expanded', 'false');
    hooksToggle.textContent = 'Today\u2019s jingles ▾';
  }

  function openHooksDrawer(): void {
    const drawer = el<HTMLDivElement>('hooks-drawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    hooksBackdrop.classList.remove('hidden');
    hooksBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('hooks-drawer-open');
    hooksToggle.setAttribute('aria-expanded', 'true');
    hooksToggle.textContent = 'Today\u2019s jingles ▴';
  }

  hooksToggle.addEventListener('click', () => {
    const drawer = el<HTMLDivElement>('hooks-drawer');
    const open = drawer.classList.contains('open');
    if (open) closeHooksDrawer();
    else openHooksDrawer();
  });

  hooksCloseBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeHooksDrawer();
  });

  hooksBackdrop.addEventListener('click', () => {
    closeHooksDrawer();
  });

  function updateComposeStackHeight(): void {
    const keysOpen = touchKeysMount!.isVisible();
    const consoleOpen = touchConsole!.isVisible();
    const drumsOpen = touchDrums!.isVisible();
    const instrumentOpen = keysOpen || drumsOpen;
    const anyOpen = instrumentOpen || consoleOpen;
    const hooksVisible = isCoarsePointer && !instrumentOpen && !consoleOpen;
    const composeH = composeEl.offsetHeight;
    const hooksReserve = hooksVisible ? 52 : 0;
    const stripReserve = isCoarsePointer && multitrackPanelVisible() && !anyOpen && !mtPanelExpanded ? 88 : 0;
    const covered = (composeH + hooksReserve + stripReserve) / Math.max(window.innerHeight, 1);
    const reservePx = Math.ceil(composeH + hooksReserve + stripReserve + 10);
    document.documentElement.style.setProperty('--compose-stack-h', `${reservePx}px`);
    studio.setComposeCoverage(Math.min(0.72, covered > 0 ? covered : isCoarsePointer ? 0.16 : 0));
  }

  // On-screen compose panels (console, drums, keys) + mobile REC bar
  const composeEl = el<HTMLDivElement>('mobile-compose');
  const composeToolbar = el<HTMLDivElement>('compose-toolbar');
  const composeRec = el<HTMLButtonElement>('compose-rec');
  const composeStackEl = el<HTMLDivElement>('mobile-compose-stack');
  const composeScrollEl = el<HTMLDivElement>('mobile-compose-scroll');
  const composePanelNodes = {
    console: el<HTMLDivElement>('touch-console'),
    drums: el<HTMLDivElement>('touch-drums'),
    keys: el<HTMLDivElement>('touch-keys'),
    stack: composeStackEl,
    scroll: composeScrollEl,
    toolbar: composeToolbar,
    composeRoot: composeEl,
  };
  let composePanelMounts: ComposePanelMounts | null = null;

  function openInstrumentForArm(arm: LayerArm): void {
    if (!composePanelMounts) return;
    openComposeArm(arm, composePanelNodes, composePanelMounts);
    syncComposeToolbar();
    syncComposeLayout();
    setDialogue(
      layerFlowHint(arm, mtSession ? !!findLayerForArm(mtSession, arm) : false),
    );
  }
  const consoleToggle = el<HTMLButtonElement>('console-toggle');
  const drumsToggle = el<HTMLButtonElement>('drums-toggle');
  const keysToggle = el<HTMLButtonElement>('keys-toggle');

  touchConsole = mountTouchConsole({
    container: el<HTMLDivElement>('touch-console'),
    onCtrl: handleCtrl,
    getLabels: getConsoleLabels,
    onClose: () => setConsoleOpen(false),
  });
  touchDrums = mountTouchDrums({
    container: el<HTMLDivElement>('touch-drums'),
    onStepToggle: (sound, step) => {
      if (instrumentsBlocked()) return;
      void audio.resume();
      pattern[sound][step] = pattern[sound][step] ? 0 : 1;
      {
        const dv = humanizeVel(0.72, 0.12);
        audio.drumHit(sound, dv);
        if (hookRecorder.active) hookRecorder.drumHit(sound, dv);
      }
    },
    onCtrl: handleCtrl,
    onPatternPlayToggle: togglePatternPlay,
    getPatternPlaying: isPatternPlaying,
    getKitLabel: () => drumKitLabel(drumKit),
    getPatLabel: () => drumPatternLabel(drumPatternName),
    getPattern: () => pattern,
    getStepHighlight: () => transportStep,
    onClose: () => setDrumsOpen(false),
  });
  touchKeysMount = mountTouchKeys({
    container: composePanelNodes.keys,
    onNoteDown: (midi, id, layer, velocity) => onNoteDown(midi, 'touch-keys', id, layer, velocity),
    onNoteUp: (midi, id, layer) => onNoteUp(midi, 'touch-keys', id, layer),
    onClose: () => setKeysOpen(false),
  });

  composePanelMounts = {
    setConsoleVisible: (open) => touchConsole!.setVisible(open),
    setDrumsVisible: (open) => touchDrums!.setVisible(open),
    setKeysVisible: (open) => setKeysOpen(open),
    setKeysFocus: (layer) => touchKeysMount!.setFocusLayer(layer),
  };

  function syncComposeLayout(): void {
    const keysOpen = touchKeysMount!.isVisible();
    const consoleOpen = touchConsole!.isVisible();
    const drumsOpen = touchDrums!.isVisible();
    const instrumentOpen = keysOpen || drumsOpen;
    const anyOpen = instrumentOpen || consoleOpen;

    consoleToggle.setAttribute('aria-expanded', consoleOpen ? 'true' : 'false');
    drumsToggle.setAttribute('aria-expanded', drumsOpen ? 'true' : 'false');
    keysToggle.setAttribute('aria-expanded', keysOpen ? 'true' : 'false');

    composeToolbar.classList.toggle('hidden', !anyOpen);
    document.body.classList.toggle('compose-open', anyOpen || multitrackPanelVisible());
    document.body.classList.toggle('console-open', consoleOpen);
    document.body.classList.toggle('instrument-open', instrumentOpen);
    document.body.classList.toggle('keys-open', keysOpen);
    composeEl.classList.toggle('mt-expanded', mtPanelExpanded);
    composeEl.classList.toggle('instrument-open', instrumentOpen);
    composeEl.classList.toggle('console-open', consoleOpen);
    document.body.classList.toggle('mt-expanded', mtPanelExpanded);

    syncComposeToolbar();

    requestAnimationFrame(() => {
      updateComposeStackHeight();
      requestAnimationFrame(updateComposeStackHeight);
    });
  }

  const setConsoleOpen = (open: boolean) => {
    if (open) closeHooksDrawer();
    touchConsole!.setVisible(open);
    composePanelNodes.console.classList.toggle('hidden', !open);
    syncComposeLayout();
    if (open) {
      requestAnimationFrame(() => {
        composePanelNodes.console.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  };
  const setDrumsOpen = (open: boolean) => {
    if (open) closeHooksDrawer();
    touchDrums!.setVisible(open);
    composePanelNodes.drums.classList.toggle('hidden', !open);
    syncComposeLayout();
    if (open) {
      requestAnimationFrame(() => {
        composePanelNodes.drums.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  };
  const setKeysOpen = (open: boolean) => {
    if (open) closeHooksDrawer();
    touchKeysMount!.setVisible(open);
    composePanelNodes.keys.classList.toggle('hidden', !open);
    if (!open) {
      touchKeysMount!.setFocusLayer('all');
    } else if (mtPanelExpanded && (layerArm === 'keys' || layerArm === 'bass')) {
      touchKeysMount!.setFocusLayer(layerArm === 'keys' ? 'melody' : 'bass');
    } else if (!mtPanelExpanded) {
      touchKeysMount!.setFocusLayer('all');
    }
    syncComposeLayout();
    if (open) {
      requestAnimationFrame(() => {
        composePanelNodes.keys.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  };

  multitrackPanel = mountMultitrackPanel({
    root: el<HTMLDivElement>('multitrack-panel'),
    loopLabel: el<HTMLDivElement>('mt-loop-label'),
    collapsedSummary: el<HTMLDivElement>('mt-collapsed-summary'),
    collapseToggle: el<HTMLButtonElement>('mt-collapse-toggle'),
    backingStrip: el<HTMLDivElement>('mt-backing-strip'),
    slotsGrid: el<HTMLDivElement>('mt-slots-grid'),
    armRow: el<HTMLDivElement>('mt-arm-row'),
    submitBtn: el<HTMLButtonElement>('mt-submit'),
    playLoopBtn: el<HTMLButtonElement>('mt-play-loop'),
    onArm: (arm) => armForRecording(arm),
    onRecordLayer: (arm) => toggleLayerRec(arm),
    onSubmit: () => {
      void finishMultitrackSession();
    },
    onClear: () => {
      cancelMultitrackSession();
      toast('All layers cleared');
    },
    onPlayLoop: () => toggleOverdubLoopPlayback(),
    onStopLoop: () => stopOverdubLoopPlayback(),
    onReRecord: (arm) => requestReRecord(arm),
    onRemoveLayer: (id) => removeLayer(id),
    onPreviewLayer: (arm) => toggleLayerPreview(arm),
    onToggleBackingMute: (arm) => toggleBackingMute(arm),
    onToggleExpanded: () => toggleMultitrackPanelExpanded(),
  });

  composeRec.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    touchKeysMount?.releaseAll();
    toggleLayerRec(layerArm);
  });

  consoleToggle.addEventListener('click', () => {
    setConsoleOpen(!touchConsole!.isVisible());
  });
  drumsToggle.addEventListener('click', () => {
    const visible = touchDrums!.isVisible();
    if (useMultitrackLayerPicker() && !hookRecorder.active && (!visible || layerArm !== 'drums')) {
      switchMultitrackLayer('drums');
    } else {
      setDrumsOpen(!visible);
    }
  });
  keysToggle.addEventListener('click', () => {
    const visible = touchKeysMount!.isVisible();
    if (useMultitrackLayerPicker() && !hookRecorder.active && (!visible || layerArm !== 'keys')) {
      switchMultitrackLayer('keys');
    } else {
      setKeysOpen(!visible);
    }
  });

  // Phones/tablets: compact multitrack strip only until user picks a layer
  if (isCoarsePointer) {
    document.body.classList.add('mobile-layout');
    beginMultitrackSession();
    const composeResize = new ResizeObserver(() => updateComposeStackHeight());
    composeResize.observe(composeEl);
  }
  renderMultitrackPanel();
  syncComposeLayout();

  // Keep drum pad highlight in sync with transport
  const drumUiTick = () => {
    if (touchDrums?.isVisible()) touchDrums.refresh();
    requestAnimationFrame(drumUiTick);
  };
  requestAnimationFrame(drumUiTick);

  window.addEventListener('resize', () => syncComposeLayout());

  el<HTMLButtonElement>('review-play').addEventListener('click', () => {
    if (!pendingHook) return;
    if (hookPlayback?.reviewUi && hookPlayback.pausedAt === null) {
      pauseHookPlayback();
      return;
    }
    if (hookPlayback?.reviewUi && hookPlayback.pausedAt !== null) {
      resumeHookPlayback();
      return;
    }
    setDialogue('DJ: Rolling the tape back for you…');
    void playHook(pendingHook, { restorePattern: false, reviewUi: true });
  });

  el<HTMLButtonElement>('review-delete').addEventListener('click', () => {
    deletePendingHook();
  });

  el<HTMLButtonElement>('review-submit').addEventListener('click', () => {
    void submitPendingHook();
  });

  const reviewTitleInput = el<HTMLInputElement>('review-title');
  reviewTitleInput.addEventListener('focus', () => syncInstrumentsBlocked());
  reviewTitleInput.addEventListener('blur', () => {
    window.setTimeout(() => syncInstrumentsBlocked(), 0);
  });
  reviewTitleInput.addEventListener('keydown', (ev) => ev.stopPropagation());
  reviewTitleInput.addEventListener('keyup', (ev) => ev.stopPropagation());

  hooksListEl.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest('button.hook-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const hookId = btn.dataset.hookId;
    const action = btn.dataset.action;
    if (!hookId || !action) return;

    try {
      if (action === 'play') {
        const hook = await apiGetHook(hookId);
        setDialogue('DJ: Listen up…');
        void playHook(hook);
        return;
      }
      if (action === 'vote') {
        const res = await apiVote(hookId);
        player = res.player;
        renderReveal(res.prevReveal);
        renderHooks(res.hooks);
        setDialogue('DJ: Vote locked.');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed');
    }
  });

  document.body.addEventListener(
    'pointerdown',
    () => {
      void audio.resume();
    },
    { once: true },
  );

  window.addEventListener('blur', () => releaseAllHeldNotes());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAllHeldNotes();
  });

  setDialogue(DJ_WELCOME);
}

void init();
